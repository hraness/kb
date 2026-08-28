import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { selectNpmStage } from "./npm-stage-selection.ts";

function manifest(version: unknown, name: unknown = "@hraness/kb"): string {
  return JSON.stringify({ name, version });
}

describe("npm stage selection", () => {
  test("selects a strictly increasing stable version from a push", () => {
    expect(selectNpmStage({
      currentManifest: manifest("0.18.0"),
      eventName: "push",
      previousManifest: manifest("0.17.1"),
    })).toEqual({
      currentVersion: "0.18.0",
      previousVersion: "0.17.1",
      reason: "stable-version-increase",
      shouldStage: true,
    });
  });

  test("makes an unrelated package.json edit a successful no-op", () => {
    expect(selectNpmStage({
      currentManifest: manifest("0.17.1"),
      eventName: "push",
      previousManifest: manifest("0.17.1"),
    })).toEqual({
      currentVersion: "0.17.1",
      previousVersion: "0.17.1",
      reason: "version-unchanged",
      shouldStage: false,
    });
  });

  test("retains a manual current-version recovery request", () => {
    expect(selectNpmStage({
      currentManifest: manifest("0.17.1"),
      eventName: "workflow_dispatch",
    })).toEqual({
      currentVersion: "0.17.1",
      reason: "manual-recovery",
      shouldStage: true,
    });
  });

  test("rejects downgrades, prereleases, foreign packages, and incomplete pushes", () => {
    expect(() => selectNpmStage({
      currentManifest: manifest("0.17.0"),
      eventName: "push",
      previousManifest: manifest("0.17.1"),
    })).toThrow("Package version must increase");
    expect(() => selectNpmStage({
      currentManifest: manifest("0.18.0-beta.1"),
      eventName: "push",
      previousManifest: manifest("0.17.1"),
    })).toThrow("stable semantic version");
    expect(() => selectNpmStage({
      currentManifest: manifest("0.18.0", "@hraness/not-kb"),
      eventName: "push",
      previousManifest: manifest("0.17.1"),
    })).toThrow("must identify @hraness/kb");
    expect(() => selectNpmStage({
      currentManifest: manifest("0.18.0"),
      eventName: "push",
    })).toThrow("must provide the previous package.json");
  });

  test("compares version parts without numeric precision loss", () => {
    expect(selectNpmStage({
      currentManifest: manifest("9007199254740993.0.0"),
      eventName: "push",
      previousManifest: manifest("9007199254740992.999.999"),
    }).shouldStage).toBe(true);
  });

  test("matches lexicographic numeric ordering for stable versions", () => {
    const versionPart = fc.bigInt({ min: 0n, max: 999_999_999_999_999_999_999n });
    const versionParts = fc.tuple(versionPart, versionPart, versionPart);
    fc.assert(fc.property(versionParts, versionParts, (current, previous) => {
      const differenceIndex = current.findIndex((part, index) => part !== previous[index]);
      const ordering = differenceIndex === -1
        ? 0
        : current[differenceIndex]! > previous[differenceIndex]!
          ? 1
          : -1;
      const input = {
        currentManifest: manifest(current.join(".")),
        eventName: "push",
        previousManifest: manifest(previous.join(".")),
      };
      if (ordering < 0) {
        expect(() => selectNpmStage(input)).toThrow("Package version must increase");
        return;
      }
      const selection = selectNpmStage(input);
      expect(selection.shouldStage).toBe(ordering > 0);
      expect(selection.reason).toBe(ordering > 0
        ? "stable-version-increase"
        : "version-unchanged");
    }), { numRuns: 200 });
  });

  test("writes a bounded GitHub Actions selection output", async () => {
    const work = await mkdtemp(join(tmpdir(), "kb-npm-stage-selection-"));
    try {
      const currentManifest = join(work, "current-package.json");
      const previousManifest = join(work, "previous-package.json");
      const githubOutput = join(work, "github-output.txt");
      await Promise.all([
        writeFile(currentManifest, manifest("0.18.0")),
        writeFile(previousManifest, manifest("0.17.1")),
      ]);
      const child = Bun.spawn([
        process.execPath,
        "run",
        fileURLToPath(new URL("./npm-stage-selection.ts", import.meta.url)),
        "--current-manifest",
        currentManifest,
        "--event",
        "push",
        "--github-output",
        githubOutput,
        "--previous-manifest",
        previousManifest,
      ], { stderr: "pipe", stdout: "pipe" });
      const [exitCode, output, error] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(error).toBe("");
      expect(exitCode).toBe(0);
      expect(output).toContain("Stage @hraness/kb@0.18.0: stable-version-increase");
      expect(await readFile(githubOutput, "utf8")).toBe(
        "current_version=0.18.0\n"
        + "reason=stable-version-increase\n"
        + "should_stage=true\n"
        + "previous_version=0.17.1\n",
      );
    } finally {
      await rm(work, { force: true, recursive: true });
    }
  });
});
