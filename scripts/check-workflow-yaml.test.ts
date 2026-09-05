import { describe, expect, test } from "bun:test";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateNpmStageWorkflow,
  validateReleaseWorkflow,
  validateWorkflowYaml,
} from "./check-workflow-yaml.ts";

function replaceLast(source: string, needle: string, replacement: string): string {
  const index = source.lastIndexOf(needle);
  if (index < 0) throw new Error(`Missing test fixture: ${needle}`);
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

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

  test("locks workflow-level execution semantics outside jobs", async () => {
    for (const [path, validate] of [
      ["../.github/workflows/npm-stage.yml", validateNpmStageWorkflow],
      ["../.github/workflows/release.yml", validateReleaseWorkflow],
    ] as const) {
      const source = await readFile(resolve(import.meta.dir, path), "utf8");
      for (const injected of [
        'env:\n  NODE_OPTIONS: "--require ./hostile.cjs"',
        "defaults:\n  run:\n    working-directory: scripts",
      ]) {
        const changed = source.replace("\non:\n", `\n${injected}\n\non:\n`);
        expect(changed).not.toBe(source);
        expect(() => validate(changed, path)).toThrow(
          "exact reviewed workflow semantics",
        );
      }
    }
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
    )).toThrow("must re-read current main and npm latest at the final mutation boundary");
  });

  test("requires the prior npm latest release closure at both staging boundaries", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/npm-stage.yml");
    const source = await readFile(path, "utf8");
    const marker = "lacks one annotated Git tag";
    const firstIndex = source.indexOf(marker);
    const finalIndex = source.lastIndexOf(marker);
    expect(firstIndex).toBeGreaterThan(-1);
    expect(finalIndex).toBeGreaterThan(firstIndex);
    for (const message of [
      marker,
      "lacks its exact immutable GitHub Release",
      "is not reachable from current main",
    ]) {
      expect(source.match(new RegExp(message, "gu")) ?? []).toHaveLength(2);
    }
    const withoutFirstClosure =
      source.slice(0, firstIndex) +
      "has no release tag" +
      source.slice(firstIndex + marker.length);
    const withoutFinalClosure =
      source.slice(0, finalIndex) +
      "has no release tag" +
      source.slice(finalIndex + marker.length);
    expect(() => validateNpmStageWorkflow(source, "npm-stage.yml")).not.toThrow();
    expect(() => validateNpmStageWorkflow(
      withoutFirstClosure,
      "npm-stage.yml",
    )).toThrow("pending-stage guard must prove the prior npm latest release closure");
    expect(() => validateNpmStageWorkflow(
      withoutFinalClosure,
      "npm-stage.yml",
    )).toThrow("staged-publication boundary must prove the prior npm latest release closure");

    for (const [needle, replacement, message] of [
      [
        'const priorTag = `v${latestValue}`;',
        'const priorTag = "v0.1.0";',
        "pending-stage guard must prove",
      ],
      [
        'prior_version="$(FINAL_LATEST="$final_latest" node -p',
        'prior_version="$(CURRENT_LATEST="$current_latest" node -p',
        "must",
      ],
      [
        'if (typeof current !== "string" || final !== current)',
        "if (false)",
        "must",
      ],
      [
        '"$final_default_sha" != "$EXPECTED_SOURCE_SHA"',
        "false",
        "must",
      ],
    ] as const) {
      const weakened = needle.includes("final_") || needle.includes("FINAL_LATEST")
        ? replaceLast(source, needle, replacement)
        : source.replace(needle, replacement);
      expect(weakened).not.toBe(source);
      expect(() => validateNpmStageWorkflow(weakened, "npm-stage.yml")).toThrow(message);
    }

    const weakenedFinalComparison = replaceLast(
      source,
      'comparison?.status !== "ahead" && comparison?.status !== "identical"',
      "false",
    );
    expect(() => validateNpmStageWorkflow(
      weakenedFinalComparison,
      "npm-stage.yml",
    )).toThrow("staged-publication boundary must prove");
    const weakenedFinalRelease = replaceLast(
      source,
      "release?.tag_name !== priorTag",
      "false",
    );
    expect(() => validateNpmStageWorkflow(
      weakenedFinalRelease,
      "npm-stage.yml",
    )).toThrow("staged-publication boundary must prove");

    for (const [needle, replacement, message] of [
      [
        'if (typeof final !== "string" || terminal !== final)',
        "if (false)",
        "staged-publication boundary must prove",
      ],
      [
        "entries.length !== 3",
        "entries.length < 0",
        "staged-publication boundary must prove",
      ],
      [
        "headEntries[0]?.sha !== expectedSourceSha",
        "false",
        "staged-publication boundary must prove",
      ],
      [
        'terminalPriorIdentity.get("source") !== initialPriorIdentity.get("source")',
        "false",
        "staged-publication boundary must prove",
      ],
    ] as const) {
      const weakenedTerminalGuard = replaceLast(source, needle, replacement);
      expect(() => validateNpmStageWorkflow(
        weakenedTerminalGuard,
        "npm-stage.yml",
      )).toThrow(message);
    }
    const terminalRegistryDrift = source.replace(
      'terminal_latest="$(npm view "@hraness/kb" dist-tags.latest \\\n' +
        "            --json \\\n" +
        "            --registry=https://registry.npmjs.org)",
      'terminal_latest="$(npm view "@hraness/kb" dist-tags.latest \\\n' +
        "            --json \\\n" +
        "            --registry=https://registry.example.invalid)",
    );
    expect(terminalRegistryDrift).not.toBe(source);
    expect(() => validateNpmStageWorkflow(
      terminalRegistryDrift,
      "npm-stage.yml",
    )).toThrow("terminal npm latest read to the canonical registry");
    const suppressedPeeledIdentity = source.replace(
      "          git ls-remote --exit-code \\\n",
      "          git ls-remote --exit-code --refs \\\n",
    );
    expect(suppressedPeeledIdentity).not.toBe(source);
    expect(() => validateNpmStageWorkflow(
      suppressedPeeledIdentity,
      "npm-stage.yml",
    )).toThrow("must retain peeled annotated-tag identity");
  });

  test("locks the OIDC staging job to its exact reviewed steps and sole mutation", async () => {
    const source = await readFile(
      resolve(import.meta.dir, "../.github/workflows/npm-stage.yml"),
      "utf8",
    );
    const setupNode = "      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0";
    const insertedStep = replaceLast(
      source,
      setupNode,
      "      - name: Hidden registry mutation\n" +
        "        run: npm dist-tag add @hraness/kb@0.18.0 latest\n" +
        setupNode,
    );
    expect(() => validateNpmStageWorkflow(insertedStep, "npm-stage.yml")).toThrow(
      "exact reviewed step sequence",
    );
    const unpinnedAction = replaceLast(
      source,
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      "actions/setup-node@v7",
    );
    expect(() => validateNpmStageWorkflow(unpinnedAction, "npm-stage.yml")).toThrow(
      "exact reviewed step sequence",
    );
    const bypassedReauthorization = source.replace(
      "      - name: Reauthorize current npm staging attempt",
      "      - name: Reauthorize current npm staging attempt\n        continue-on-error: true",
    );
    expect(() => validateNpmStageWorkflow(bypassedReauthorization, "npm-stage.yml")).toThrow(
      "fail-closed step control flow",
    );
    const unconditionalMutation = source.replace(
      "      - name: Revalidate current main and stage exact package",
      "      - name: Revalidate current main and stage exact package\n        if: always()",
    );
    expect(() => validateNpmStageWorkflow(unconditionalMutation, "npm-stage.yml")).toThrow(
      "fail-closed step control flow",
    );
    const extraMutation = source.replace(
      '          npm stage publish "$TARBALL" \\',
      '          npm publish "$TARBALL"\n          npm stage publish "$TARBALL" \\',
    );
    expect(extraMutation).not.toBe(source);
    expect(() => validateNpmStageWorkflow(extraMutation, "npm-stage.yml")).toThrow(
      "unexpected provider mutation command",
    );
    for (const mutation of [
      "npm --registry=https://registry.npmjs.org publish hostile.tgz",
      "git -c user.name=hostile push origin main",
      "gh --repo hraness/kb release edit v0.18.0 --title hostile",
      "GH_TOKEN=hostile gh release edit v0.18.0 --title hostile",
      "gh api repos/hraness/kb --raw-field=hostile=true",
      'node -e \'execute("gh", ["api", "--method", "DELETE"])\'',
    ] as const) {
      const injectedMutation = source.replace(
        '          npm stage publish "$TARBALL" \\',
        `          ${mutation}\n          npm stage publish "$TARBALL" \\`,
      );
      expect(injectedMutation).not.toBe(source);
      expect(() => validateNpmStageWorkflow(injectedMutation, "npm-stage.yml")).toThrow(
        "unexpected provider mutation command",
      );
    }
    const wrappedMutation = source.replace(
      '          npm stage publish "$TARBALL" \\',
      "          bash -c 'npm publish hostile.tgz'\n" +
        '          npm stage publish "$TARBALL" \\',
    );
    expect(() => validateNpmStageWorkflow(wrappedMutation, "npm-stage.yml")).toThrow(
      "exact reviewed workflow semantics",
    );
    for (const [needle, replacement] of [
      ["          GH_TOKEN: ${{ github.token }}", "          GH_TOKEN: ${{ secrets.ADMIN }}"],
      [
        "          EXPECTED_SOURCE_SHA: ${{ needs.verify.outputs.source_sha }}",
        "          EXPECTED_SOURCE_SHA: ${{ github.sha }}",
      ],
      [
        "          TARBALL: ${{ steps.artifact.outputs.tarball }}",
        "          TARBALL: ${{ steps.artifact.outputs.tarball }}\n          EXTRA: hostile",
      ],
    ] as const) {
      const weakenedEnvironment = replaceLast(source, needle, replacement);
      expect(() => validateNpmStageWorkflow(weakenedEnvironment, "npm-stage.yml")).toThrow(
        "exact reviewed environment",
      );
    }
  });

  test("inspects terminal npm mutations before trusting a stage-job display name", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/npm-stage.yml");
    const source = await readFile(path, "utf8");
    const delayed = source
      .replace("const terminalWrites =", "const delayedTerminalWrites =")
      .replace(
        "              const match = /^Stage exact package v",
        "              const terminalWrites = delayedTerminalWrites;\n" +
          "              const match = /^Stage exact package v",
      );
    expect(delayed).not.toBe(source);
    expect(() => validateNpmStageWorkflow(source, "npm-stage.yml")).not.toThrow();
    expect(() => validateNpmStageWorkflow(delayed, "npm-stage.yml")).toThrow(
      "must inspect terminal writes before trusting a job display name",
    );
  });

  test("keeps npm staging version-selected, environment-bound, tokenless, artifact-bound, and stage-only", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/npm-stage.yml");
    const source = await readFile(path, "utf8");

    for (const required of [
      "push:",
      "branches: [main]",
      'paths:\n      - "package.json"',
      "workflow_dispatch:",
      "publish_to_npm:",
      "resolved_stage_version:",
      "required: false",
      "default: false",
      "type: boolean",
      "name: Select stable package version",
      "github.event.before",
      "git merge-base --is-ancestor",
      'git show "$BEFORE_SHA:package.json"',
      "scripts/npm-stage-selection.ts",
      "needs: select",
      "if: needs.select.outputs.should_stage == 'true'",
      "contents: read",
      "environment: npm-stage",
      "if: inputs.publish_to_npm == true",
      "actions: read",
      "contents: read",
      "id-token: write",
      "Reauthorize current npm staging attempt",
      "Reject unresolved stable-stage intent",
      "Record cleared stable-stage intent v${{ inputs.resolved_stage_version }}",
      "Record exclusive stable-stage intent",
      "Verified package version components exceed Number.MAX_SAFE_INTEGER",
      'EXPECTED_WORKFLOW_ID: "344070109"',
      "attempt.triggering_actor?.id !== actorId",
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
      "npm config get tag",
      "Pinned npm's clean default publication tag is not latest",
      "--registry=https://registry.npmjs.org",
    ] as const) {
      expect(source).toContain(required);
    }

    expect(source).not.toContain("secrets.NPM_TOKEN");
    expect(source).not.toContain("NODE_AUTH_TOKEN");
    expect(source).not.toMatch(/\bnpm publish\b/u);
    expect(source).not.toContain("--tag latest");
    expect(source.match(/id-token: write/gu) ?? []).toHaveLength(1);
    expect(source.match(/Verified package version components exceed Number\.MAX_SAFE_INTEGER/gu) ?? [])
      .toHaveLength(3);
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
    expect(() => validateNpmStageWorkflow(
      source.replace("default: false", "default: true"),
      "npm-stage.yml",
    )).toThrow("fail-closed boolean publish_to_npm input");
    expect(() => validateNpmStageWorkflow(
      source.replace('default: ""', 'default: "0.19.0"'),
      "npm-stage.yml",
    )).toThrow("empty-by-default resolved_stage_version");
    expect(() => validateNpmStageWorkflow(
      source.replace(
        "if: inputs.publish_to_npm == true",
        "if: always()",
      ),
      "npm-stage.yml",
    )).toThrow("explicit publish_to_npm opt-in");
    expect(() => validateNpmStageWorkflow(
      source.replace(
        "      actions: read\n      contents: read\n      id-token: write",
        "      contents: read\n      id-token: write",
      ),
      "npm-stage.yml",
    )).toThrow("actions: read, contents: read, and id-token: write");
    expect(() => validateNpmStageWorkflow(
      source.replace(
        "attempt.triggering_actor?.id !== actorId",
        "attempt.triggering_actor?.id !== 123456",
      ),
      "npm-stage.yml",
    )).toThrow("staging attempt authorization is missing");
    expect(() => validateNpmStageWorkflow(
      source.replace("npm config get tag", "npm config get fund"),
      "npm-stage.yml",
    )).toThrow("must recheck current default-branch HEAD");
    expect(() => validateNpmStageWorkflow(
      source.replace(
        "BigInt(Number.MAX_SAFE_INTEGER)",
        "BigInt(9007199254740992)",
      ),
      "npm-stage.yml",
    )).toThrow("must reject unsafe stable-version components");
    expect(() => validateNpmStageWorkflow(
      source.replace(
        "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
        "actions/upload-artifact@v7",
      ),
      "npm-stage.yml",
    )).toThrow("exact reviewed step sequence");
  });

  test("gates the immutable GitHub release on the exact public npm artifact", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/release.yml");
    const source = await readFile(path, "utf8");

    expect(source).toContain("Verify canonical npm delivery");
    expect(source).toContain('package_spec="$EXPECTED_NAME@$package_version"');
    expect(source).toContain("scripts/npm-package-identity.ts");
    expect(source).toContain("scripts/npm-release-attestation.ts");
    expect(source).toContain("--registry-view-json");
    expect(source).toContain("npm audit signatures");
    expect(source).toContain("--include-attestations");
    expect(source).toContain("--registry-latest-json");
    expect(source).toContain('npm view "@hraness/kb" dist-tags.latest');
    expect(source).not.toContain('cmp "$source_archive" "$registry_archive"');
    expect(source).toContain("--registry=https://registry.npmjs.org");
    expect(source).toContain("scripts/package-smoke.ts");
  });

  test("structurally binds release mutation to owner authorization and current controls", async () => {
    const source = await readFile(
      resolve(import.meta.dir, "../.github/workflows/release.yml"),
      "utf8",
    );
    expect(() => validateReleaseWorkflow(source, "release.yml")).not.toThrow();

    const bypassedAuthorization = source.replace(
      "      - name: Verify immutable owner and public repository identity",
      "      - name: Verify immutable owner and public repository identity\n" +
        "        continue-on-error: true",
    );
    expect(() => validateReleaseWorkflow(bypassedAuthorization, "release.yml")).toThrow(
      "immutable owner and public repository",
    );

    for (const [needle, replacement, message] of [
      [
        '"$GITHUB_ACTOR_ID" != "$EXPECTED_ACTOR_ID"',
        '"$GITHUB_ACTOR_ID" == "$EXPECTED_ACTOR_ID"',
        "owner authorization",
      ],
      [
        "          ref: main",
        "          ref: ${{ github.ref }}",
        "current-main checkout",
      ],
      [
        'run "$current_attestation"',
        'run "$current_identity"',
        "npm attestation",
      ],
      [
        "attempt.triggering_actor?.id !== actorId",
        "attempt.triggering_actor?.id !== 1",
        "reauthorize",
      ],
      [
        'final_default_sha="$(verify_current_release_controls)"',
        'final_default_sha="$current_default_sha"',
        "current controls",
      ],
    ] as const) {
      expect(source).toContain(needle);
      expect(() => validateReleaseWorkflow(
        source.replace(needle, replacement),
        "release.yml",
      )).toThrow(message);
    }

    const publishMarker = "      - name: Reauthorize current release attempt";
    const insertedPublishStep = source.replace(
      publishMarker,
      "      - name: Hidden write\n        run: git push origin main\n" + publishMarker,
    );
    expect(() => validateReleaseWorkflow(insertedPublishStep, "release.yml")).toThrow(
      "exact reviewed step sequence",
    );
    const unpinnedPublishCheckout = replaceLast(
      source,
      "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
      "actions/checkout@v7",
    );
    expect(() => validateReleaseWorkflow(unpinnedPublishCheckout, "release.yml")).toThrow(
      "exact reviewed step sequence",
    );
    const unpinnedVerificationAction = source.replace(
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      "oven-sh/setup-bun@v2",
    );
    expect(() => validateReleaseWorkflow(unpinnedVerificationAction, "release.yml")).toThrow(
      "exact reviewed step sequence",
    );
    const bypassedVerification = source.replace(
      "      - name: Verify release identity",
      "      - name: Verify release identity\n        continue-on-error: true",
    );
    expect(() => validateReleaseWorkflow(bypassedVerification, "release.yml")).toThrow(
      "fail-closed step control flow",
    );
    const unconditionalRelease = source.replace(
      "      - name: Publish verified GitHub Release",
      "      - name: Publish verified GitHub Release\n        if: always()",
    );
    expect(() => validateReleaseWorkflow(unconditionalRelease, "release.yml")).toThrow(
      "fail-closed step control flow",
    );
    const extraReleaseMutation = source.replace(
      '          if ! gh release create "$VERIFIED_TAG" \\',
      '          gh release edit "$VERIFIED_TAG" --title hostile\n' +
        '          if ! gh release create "$VERIFIED_TAG" \\',
    );
    expect(extraReleaseMutation).not.toBe(source);
    expect(() => validateReleaseWorkflow(extraReleaseMutation, "release.yml")).toThrow(
      "unexpected provider mutation command",
    );
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
