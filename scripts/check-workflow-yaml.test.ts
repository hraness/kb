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
    const finalGuard = 'git --git-dir="$current_main" fetch';
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

  test("keeps npm staging version-selected, environment-bound, tokenless, artifact-bound, and stage-only", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/npm-stage.yml");
    const source = await readFile(path, "utf8");

    for (const required of [
      "push:",
      "branches: [main]",
      'paths:\n      - "package.json"',
      "workflow_dispatch:",
      "name: Select stable package version",
      "github.event.before",
      "git merge-base --is-ancestor",
      'git show "$BEFORE_SHA:package.json"',
      "scripts/npm-stage-selection.ts",
      "needs: select",
      "if: needs.select.outputs.should_stage == 'true'",
      "contents: read",
      "environment: npm-stage",
      "id-token: write",
      "runs-on: ubuntu-latest",
      "node-version: \"24\"",
      "package-manager-cache: false",
      "npm@11.19.0",
      "bun-version: \"1.3.14\"",
      "bun install --frozen-lockfile --ignore-scripts",
      "bun run check",
      "git status --porcelain --untracked-files=all -- dist bun.lock",
      "scripts/prepare-npm-package.ts",
      "scripts/package-smoke.ts",
      "npm-package.sha256",
      "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      "git init --quiet --bare \"$current_main\"",
      "npm stage publish \"$TARBALL\"",
      "--registry=https://registry.npmjs.org",
    ] as const) {
      expect(source).toContain(required);
    }

    expect(source).not.toContain("secrets.NPM_TOKEN");
    expect(source).not.toContain("NODE_AUTH_TOKEN");
    expect(source).not.toMatch(/\bnpm publish\b/u);
    expect(source.match(/id-token: write/gu) ?? []).toHaveLength(1);
    const stage = source.slice(source.indexOf("\n  stage:\n"));
    expect(stage).not.toContain("actions/checkout@");
    expect(stage).not.toContain("setup-bun@");
    expect(stage).not.toContain("./scripts/");
  });

  test("requires the exact environment and fail-closed version selector", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/npm-stage.yml");
    const source = await readFile(path, "utf8");
    expect(() => validateNpmStageWorkflow(
      source.replace("environment: npm-stage", "environment: unprotected"),
      "npm-stage.yml",
    )).toThrow("exact npm-stage environment");
    expect(() => validateNpmStageWorkflow(
      source.replace(
        'git show "$BEFORE_SHA:package.json"',
        'cp package.json "$previous_manifest"',
      ),
      "npm-stage.yml",
    )).toThrow("package-version selection is missing");
  });

  test("gates the immutable GitHub release on the exact public npm artifact", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/release.yml");
    const source = await readFile(path, "utf8");

    expect(source).toContain("Verify canonical npm delivery");
    expect(source).toContain('package_spec="$EXPECTED_NAME@$package_version"');
    expect(source).toContain("scripts/npm-package-identity.ts");
    expect(source).toContain("--registry-view-json");
    expect(source).not.toContain('cmp "$source_archive" "$registry_archive"');
    expect(source).toContain("--registry=https://registry.npmjs.org");
    expect(source).toContain("scripts/package-smoke.ts");
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
