import { describe, expect, test } from "bun:test";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
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

  test("publishes npm only from the environment-bound OIDC job after the immutable Release", async () => {
    const source = await readFile(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8");
    expect(() => validateReleaseWorkflow(source, "release.yml")).not.toThrow();
    for (const [needle, replacement, message] of [
      ["    environment: npm-release", "    environment: npm-stage", "npm-release environment"],
      ["    needs: [verify, attest, publish]", "    needs: [verify, attest]", "must follow the immutable Release"],
      ["          artifact-ids: ${{ needs.attest.outputs.artifact_id }}", "          name: attested-${{ needs.verify.outputs.artifact_name }}", "numeric identity"],
      ['            if (payload.dist.integrity !== expectedIntegrity) {\n              throw new Error(`npm already publishes ${name}@${version} with different bytes; never overwrite it`);\n            }', "", "idempotent registry state"],
      ['          if (latest?.id !== release.id || latest?.tag_name !== release.tag_name) throw new Error("Canonical release is not immutable Latest before npm publication");', "", "bind the immutable Release"],
      ["            --provenance \\\n", "", "provenance"],
      ["            --access public \\\n", "            --access public --tag next \\\n", "default-tag monotonicity"],
      ['            --registry=https://registry.npmjs.org \\\n            --userconfig="$clean_user_config" \\\n            > "$publish_result"', '            --registry=https://registry.example.invalid \\\n            --userconfig="$clean_user_config" \\\n            > "$publish_result"', "canonical registry"],
      ["      - name: Publish the exact canonical archive through npm trusted publishing", "      - name: Hidden registry mutation\n        run: npm dist-tag add @hraness/wordcell@0.18.0 latest\n      - name: Publish the exact canonical archive through npm trusted publishing", "exact reviewed step sequence"],
      ['          ref: ${{ needs.verify.outputs.workflow_sha }}', "          ref: main", "exact reviewed verifier closure"],
      ["            && npm audit signatures --json --include-attestations --omit=dev --registry=https://registry.npmjs.org > \"$work/audit.json\")", '            && printf "{}" > "$work/audit.json")', "signatures, and provenance"],
    ] as const) {
      expect(source).toContain(needle);
      const changed = source.replace(needle, replacement);
      expect(changed).not.toBe(source);
      expect(() => validateReleaseWorkflow(changed, "release.yml")).toThrow(message);
    }
    const extraOidc = source.replace("  admit_npm:\n    name: Admit the public npm package\n    needs: [verify, publish_npm]\n    permissions:\n      contents: read", "  admit_npm:\n    name: Admit the public npm package\n    needs: [verify, publish_npm]\n    permissions:\n      contents: read\n      id-token: write");
    expect(extraOidc).not.toBe(source);
    expect(() => validateReleaseWorkflow(extraOidc, "release.yml")).toThrow("read-only job after publication");
    const publicationJob = source.slice(source.indexOf("\n  publish_npm:\n"), source.indexOf("\n  admit_npm:\n"));
    expect(publicationJob).not.toContain("actions/checkout@");
    expect(publicationJob).not.toContain("setup-bun@");
    expect(publicationJob).not.toContain("./scripts/");
    expect(publicationJob).not.toContain("secrets.");
  });

  test("rejects a canonical release that waits on npm or signs with unchecked authority", async () => {
    const source = await readFile(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8");
    const npmDependency = source.replace(
      '          node "$GITHUB_WORKSPACE/scripts/github-release.ts" prepare "$artifact_directory"',
      '          npm view @hraness/wordcell dist-tags.latest\n' +
        '          node "$GITHUB_WORKSPACE/scripts/github-release.ts" prepare "$artifact_directory"',
    );
    expect(npmDependency).not.toBe(source);
    expect(() => validateReleaseWorkflow(npmDependency, "release.yml")).toThrow("must not depend on npm");
    const uncheckedSigner = source.replace('      attestations: write', '      attestations: write\n      packages: write');
    expect(uncheckedSigner).not.toBe(source);
    expect(() => validateReleaseWorkflow(uncheckedSigner, "release.yml")).toThrow("reviewed signing permissions");
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
        'node "$GITHUB_WORKSPACE/scripts/github-release.ts" prepare "$artifact_directory"',
        'node "$GITHUB_WORKSPACE/scripts/github-release.ts" publish "$artifact_directory"',
        "canonical artifact",
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
      '          node scripts/github-release.ts publish "$RUNNER_TEMP/kb-github-handoff"',
      '          gh release edit "$VERIFIED_TAG" --title hostile\n' +
        '          node scripts/github-release.ts publish "$RUNNER_TEMP/kb-github-handoff"',
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
