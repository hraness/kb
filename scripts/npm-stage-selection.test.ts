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
      currentManifest: manifest("0.17.3"),
      eventName: "push",
      previousManifest: manifest("0.17.2"),
    })).toEqual({
      currentVersion: "0.17.3",
      previousVersion: "0.17.2",
      reason: "stable-version-increase",
      shouldStage: true,
    });
  });

  test("makes an unrelated package.json edit a successful no-op", () => {
    expect(selectNpmStage({
      currentManifest: manifest("0.17.3"),
      eventName: "push",
      previousManifest: manifest("0.17.3"),
    })).toEqual({
      currentVersion: "0.17.3",
      previousVersion: "0.17.3",
      reason: "version-unchanged",
      shouldStage: false,
    });
  });

  test("retains a manual current-version recovery request", () => {
    expect(selectNpmStage({
      currentManifest: manifest("0.17.3"),
      eventName: "workflow_dispatch",
    })).toEqual({
      currentVersion: "0.17.3",
      reason: "manual-recovery",
      shouldStage: true,
    });
  });

  test("rejects downgrades, prereleases, foreign packages, and incomplete pushes", () => {
    expect(() => selectNpmStage({
      currentManifest: manifest("0.17.0"),
      eventName: "push",
      previousManifest: manifest("0.17.3"),
    })).toThrow("Package version must increase");
    expect(() => selectNpmStage({
      currentManifest: manifest("0.18.0-beta.1"),
      eventName: "push",
      previousManifest: manifest("0.17.3"),
    })).toThrow("stable semantic version");
    expect(() => selectNpmStage({
      currentManifest: manifest("0.18.0", "@hraness/not-kb"),
      eventName: "push",
      previousManifest: manifest("0.17.3"),
    })).toThrow("must identify @hraness/kb");
    expect(() => selectNpmStage({
      currentManifest: manifest("0.18.0"),
      eventName: "push",
    })).toThrow("must provide the previous package.json");
  });

  test("accepts and compares every version component through Number.MAX_SAFE_INTEGER", () => {
    expect(selectNpmStage({
      currentManifest: manifest("9007199254740991.9007199254740991.9007199254740991"),
      eventName: "push",
      previousManifest: manifest("9007199254740991.9007199254740991.9007199254740990"),
    }).shouldStage).toBe(true);
  });

  test("rejects a current or previous component above Number.MAX_SAFE_INTEGER", () => {
    for (const version of [
      "9007199254740992.0.0",
      "0.9007199254740992.0",
      "0.0.9007199254740992",
    ]) {
      expect(() => selectNpmStage({
        currentManifest: manifest(version),
        eventName: "workflow_dispatch",
      })).toThrow("components must not exceed Number.MAX_SAFE_INTEGER");
    }
    expect(() => selectNpmStage({
      currentManifest: manifest("9007199254740991.0.0"),
      eventName: "push",
      previousManifest: manifest("9007199254740992.0.0"),
    })).toThrow("components must not exceed Number.MAX_SAFE_INTEGER");
  });

  test("matches lexicographic numeric ordering for stable versions", () => {
    const versionPart = fc.bigInt({ min: 0n, max: BigInt(Number.MAX_SAFE_INTEGER) });
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
        writeFile(currentManifest, manifest("0.17.3")),
        writeFile(previousManifest, manifest("0.17.2")),
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
      expect(output).toContain("Stage @hraness/kb@0.17.3: stable-version-increase");
      expect(await readFile(githubOutput, "utf8")).toBe(
        "current_version=0.17.3\n"
        + "reason=stable-version-increase\n"
        + "should_stage=true\n"
        + "previous_version=0.17.2\n",
      );
    } finally {
      await rm(work, { force: true, recursive: true });
    }
  });
});
