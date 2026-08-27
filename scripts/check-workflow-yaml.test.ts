import { describe, expect, test } from "bun:test";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateNpmStageWorkflow,
  validateWorkflowYaml,
} from "./check-workflow-yaml.ts";

describe("GitHub workflow YAML", () => {
  test("accepts commands with YAML-significant text inside block scalars", () => {
    expect(() => validateWorkflowYaml(`
name: CI
on:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: >-
          node -e 'const value = { type: "json" }'
`, "workflow.yml")).not.toThrow();
  });

  test("rejects YAML-significant command text in a plain scalar", () => {
    expect(() => validateWorkflowYaml(`
name: CI
on:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: node -e 'const value = { type: "json" }'
`, "workflow.yml")).toThrow("invalid YAML");
  });

  test("requires a fresh default-branch HEAD guard at the final publication boundary", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/npm-stage.yml");
    const source = await readFile(path, "utf8");
    const finalGuard = 'git fetch origin "$DEFAULT_BRANCH"';
    const finalGuardIndex = source.lastIndexOf(finalGuard);
    expect(finalGuardIndex).toBeGreaterThan(-1);
    const missingFinalGuard =
      source.slice(0, finalGuardIndex) +
      "git status --short" +
      source.slice(finalGuardIndex + finalGuard.length);
    expect(() => validateNpmStageWorkflow(source, "npm-stage.yml")).not.toThrow();
    expect(() => validateNpmStageWorkflow(
      missingFinalGuard,
      "npm-stage.yml",
    )).toThrow("must recheck current default-branch HEAD");
  });

  test("keeps npm staging manual, tokenless, artifact-bound, and stage-only", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/npm-stage.yml");
    const source = await readFile(path, "utf8");

    for (const required of [
      "workflow_dispatch:",
      "contents: read",
      "id-token: write",
      "runs-on: ubuntu-latest",
      "node-version: \"24\"",
      "package-manager-cache: false",
      "npm@11.19.0",
      "bun-version: \"1.3.14\"",
      "bun install --frozen-lockfile --ignore-scripts",
      "bun run check",
      "git status --porcelain --untracked-files=all -- dist bun.lock",
      "npm pack --json --ignore-scripts",
      "scripts/package-smoke.ts --archive",
      "archive_sha512",
      "npm stage publish \"$archive\"",
      "--registry=https://registry.npmjs.org",
    ] as const) {
      expect(source).toContain(required);
    }

    expect(source).not.toContain("secrets.NPM_TOKEN");
    expect(source).not.toContain("NODE_AUTH_TOKEN");
    expect(source).not.toMatch(/\n\s+push:/u);
    expect(source).not.toMatch(/\bnpm publish\b/u);
  });

  test("gates the immutable GitHub release on the exact public npm artifact", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/release.yml");
    const source = await readFile(path, "utf8");

    expect(source).toContain("Verify published npm artifact");
    expect(source).toContain("$package_name@$package_version");
    expect(source).toContain("source[0].integrity !== registry[0]?.integrity");
    expect(source).toContain("--registry=https://registry.npmjs.org");
    expect(source).toContain("scripts/package-smoke.ts --archive");
  });

  test("pins publication to the canonical npm registry", async () => {
    const path = resolve(import.meta.dir, "../package.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as {
      readonly publishConfig?: unknown;
    };

    expect(manifest.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org",
    });
  });
});
