import { describe, expect, test } from "bun:test";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateNpmPublishWorkflow,
  validateOwnerTagWorkflow,
  validateWorkflowYaml,
} from "./check-workflow-yaml.ts";
import {
  admitActiveCiWorkflow,
  admitCiRequiredJob,
  admitCiRun,
  admitOwner,
  admitReleaseEnvironment,
  admitReleaseRulesets,
  admitRemoteReleaseTags,
  admitRemoteRoutes,
  admitRepository,
  parseReleaseVersion,
} from "./push-npm-release-tag.ts";

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
    const finalGuard = 'git --git-dir="$current_main" fetch --quiet --no-tags --depth=1';
    const finalGuardIndex = source.lastIndexOf(finalGuard);
    expect(finalGuardIndex).toBeGreaterThan(-1);
    const missingFinalGuard =
      source.slice(0, finalGuardIndex) +
      "git status --short" +
      source.slice(finalGuardIndex + finalGuard.length);
    expect(() => validateNpmPublishWorkflow(source, "npm-stage.yml")).not.toThrow();
    expect(() => validateNpmPublishWorkflow(
      missingFinalGuard,
      "npm-stage.yml",
    )).toThrow("must recheck current default-branch HEAD");
  });

  test("keeps npm publishing version-selected, environment-bound, tokenless, and artifact-bound", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/npm-stage.yml");
    const source = await readFile(path, "utf8");

    for (const required of [
      'tags:\n      - "v*"',
      "name: Authorize owner release tag",
      'EXPECTED_ACTOR_ID: "894119"',
      'EXPECTED_REPOSITORY_ID: "1308971873"',
      "GITHUB_ACTOR_ID",
      'event.sender?.type !== "User"',
      'event.repository?.visibility !== "public"',
      "name: Select publishable package version",
      "github.ref_protected",
      "needs: select",
      "if: needs.select.outputs.should_publish == 'true'",
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
      "npm publish \"$TARBALL\"",
      "--tag \"$PUBLISH_TAG\"",
      "dist.attestations.provenance?.predicateType",
      "--registry=https://registry.npmjs.org",
    ] as const) {
      expect(source).toContain(required);
    }

    expect(source).not.toContain("secrets.NPM_TOKEN");
    expect(source).not.toContain("NODE_AUTH_TOKEN");
    expect(source).not.toMatch(/\bnpm\s+(?:stage|dist-tag)\b/u);
    expect(source).not.toContain("workflow_dispatch:");
    expect(source).not.toContain("actions: write");
    expect(source).not.toContain("authorization_run_id");
    expect(source.match(/id-token: write/gu) ?? []).toHaveLength(1);
    const publish = source.slice(source.indexOf("\n  publish:\n"));
    expect(publish).not.toContain("actions/checkout@");
    expect(publish).not.toContain("setup-bun@");
    expect(publish).not.toContain("./scripts/");
  });

  test("requires the exact environment and fail-closed owner identity", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/npm-stage.yml");
    const source = await readFile(path, "utf8");
    expect(() => validateNpmPublishWorkflow(
      source.replace("environment: npm-stage", "environment: unprotected"),
      "npm-stage.yml",
    )).toThrow("exact npm-stage environment");
    expect(() => validateNpmPublishWorkflow(
      source.replace(
        '"$GITHUB_ACTOR_ID" != "$EXPECTED_ACTOR_ID"',
        '"$GITHUB_ACTOR_ID" == "$EXPECTED_ACTOR_ID"',
      ),
      "npm-stage.yml",
    )).toThrow("owner authorization is missing");
    expect(() => validateNpmPublishWorkflow(
      source.replace(
        "event.sender?.id !== Number(process.env.EXPECTED_ACTOR_ID)",
        "event.sender?.id !== 894120",
      ),
      "npm-stage.yml",
    )).toThrow("owner authorization is missing");
    expect(() => validateNpmPublishWorkflow(
      source.replace(
        'event.sender?.type !== "User"',
        'event.sender?.type !== "Bot"',
      ),
      "npm-stage.yml",
    )).toThrow("owner authorization is missing");
    expect(() => validateNpmPublishWorkflow(
      source.replace('event.repository?.visibility !== "public"', 'event.repository?.visibility !== "private"'),
      "npm-stage.yml",
    )).toThrow("owner authorization is missing");
    expect(() => validateNpmPublishWorkflow(
      source.replace("needs: authorize", "needs: untrusted"),
      "npm-stage.yml",
    )).toThrow("select must follow owner authorization");
  });

  test("requires exact owner actor and sender guards before release checkout", async () => {
    const source = await readFile(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8");
    expect(() => validateOwnerTagWorkflow(source, "release.yml")).not.toThrow();
    expect(() => validateOwnerTagWorkflow(
      source.replace(
        '"$GITHUB_ACTOR_ID" != "$EXPECTED_ACTOR_ID"',
        '"$GITHUB_ACTOR_ID" == "$EXPECTED_ACTOR_ID"',
      ),
      "release.yml",
    )).toThrow("owner authorization is missing");
    expect(() => validateOwnerTagWorkflow(
      source.replace(
        "event.sender?.id !== Number(process.env.EXPECTED_ACTOR_ID)",
        "event.sender?.id !== 894120",
      ),
      "release.yml",
    )).toThrow("owner authorization is missing");
  });

  test("keeps local release-tag creation owner-scoped, CI-gated, monotonic, and exact-ref only", async () => {
    const source = await readFile(resolve(import.meta.dir, "push-npm-release-tag.ts"), "utf8");
    for (const required of [
      "PROCESS_TIMEOUT_MS = 30_000",
      "MAXIMUM_OUTPUT_BYTES = 1024 * 1024",
      'GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0"',
      '["git", "remote", "get-url", "--push", "--all", "origin"]',
      'admitOwner(await jsonCommand(["gh", "api", "user"]',
      "admitProtectedBranch(",
      "admitActiveCiWorkflow(",
      "admitCiRun(runInventory",
      "admitCiRequiredJob(jobs",
      "admitReleaseEnvironment(",
      "admitReleaseRulesets(rulesetList, rulesetDetails)",
      "repos/${EXPECTED_REPOSITORY}/rulesets",
      "/deployment-branch-policies",
      "const secondAdmission = admitRemoteReleaseTags",
      "refusing an inherited tag object",
      '["git", "tag", "--annotate"',
      '`refs/tags/${release.tag}:refs/tags/${release.tag}`',
      '["git", "update-ref", "-d", `refs/tags/${release.tag}`, createdTagObject]',
    ]) expect(source).toContain(required);
    const ciIndex = source.indexOf("const jobId = admitCiRequiredJob");
    const environmentIndex = source.indexOf("  admitReleaseEnvironment(\n    await jsonCommand(");
    const rulesetIndex = source.indexOf("  admitReleaseRulesets(rulesetList, rulesetDetails)");
    const monotonicIndex = source.indexOf("const secondAdmission = admitRemoteReleaseTags");
    const mutationIndex = source.indexOf('["git", "tag", "--annotate"');
    const pushIndex = source.indexOf('`refs/tags/${release.tag}:refs/tags/${release.tag}`');
    const compareDeleteIndex = source.indexOf('["git", "update-ref", "-d", `refs/tags/${release.tag}`, createdTagObject]');
    expect(ciIndex).toBeGreaterThan(-1);
    expect(environmentIndex).toBeGreaterThan(-1);
    expect(rulesetIndex).toBeGreaterThan(-1);
    expect(monotonicIndex).toBeGreaterThan(ciIndex);
    expect(mutationIndex).toBeGreaterThan(monotonicIndex);
    expect(mutationIndex).toBeGreaterThan(environmentIndex);
    expect(mutationIndex).toBeGreaterThan(rulesetIndex);
    expect(pushIndex).toBeGreaterThan(mutationIndex);
    expect(compareDeleteIndex).toBeGreaterThan(pushIndex);

    const sha = "a".repeat(40);
    const otherSha = "b".repeat(40);
    admitOwner({ id: 894119, type: "User" });
    admitRepository({ archived: false, default_branch: "main", disabled: false, full_name: "hraness/kb", id: 1308971873, private: false, visibility: "public" });
    const releaseEnvironment = {
      can_admins_bypass: false,
      deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
      name: "npm-stage",
      protection_rules: [{ type: "branch_policy" }],
    };
    const releasePolicies = { branch_policies: [{ name: "v*", type: "tag" }], total_count: 1 };
    expect(() => admitReleaseEnvironment(releaseEnvironment, releasePolicies)).not.toThrow();
    expect(() => admitReleaseEnvironment({ ...releaseEnvironment, can_admins_bypass: true }, releasePolicies)).toThrow("administrator bypass");
    expect(() => admitReleaseEnvironment({
      ...releaseEnvironment,
      deployment_branch_policy: { custom_branch_policies: false, protected_branches: true },
    }, releasePolicies)).toThrow("branch_policy");
    expect(() => admitReleaseEnvironment({
      ...releaseEnvironment,
      protection_rules: [{ type: "branch_policy" }, { type: "required_reviewers" }],
    }, releasePolicies)).toThrow("only branch_policy");
    expect(() => admitReleaseEnvironment(releaseEnvironment, {
      branch_policies: [{ name: "main", type: "branch" }],
      total_count: 1,
    })).toThrow("v* tag policy");
    const ruleset = (id: number, name: string, rules: readonly string[], bypassOwner = false) => ({
      bypass_actors: bypassOwner
        ? [{ actor_id: 894119, actor_type: "User", bypass_mode: "always" }]
        : [],
      conditions: { ref_name: { exclude: [], include: ["refs/tags/v*"] } },
      enforcement: "active",
      id,
      name,
      rules: rules.map((type) => ({ type })),
      target: "tag",
    });
    const rulesetList = [
      { id: 1, name: "Release tag creation" },
      { id: 2, name: "Immutable version tags" },
    ];
    const rulesetDetails = new Map<string, unknown>([
      ["Release tag creation", ruleset(1, "Release tag creation", ["creation"], true)],
      ["Immutable version tags", ruleset(2, "Immutable version tags", ["update", "deletion"])],
    ]);
    expect(() => admitReleaseRulesets(rulesetList, rulesetDetails)).not.toThrow();
    rulesetDetails.set("Release tag creation", {
      ...ruleset(1, "Release tag creation", ["creation"], true),
      bypass_actors: [{ actor_id: 15368, actor_type: "Integration", bypass_mode: "always" }],
    });
    expect(() => admitReleaseRulesets(rulesetList, rulesetDetails)).toThrow("unexpected bypass authority");
    rulesetDetails.set("Release tag creation", ruleset(1, "Release tag creation", ["creation"], true));
    rulesetDetails.set("Immutable version tags", ruleset(2, "Immutable version tags", ["creation", "update", "deletion"]));
    expect(() => admitReleaseRulesets(rulesetList, rulesetDetails)).toThrow("unexpected rules");
    expect(() => admitOwner({ id: 894119, type: "Bot" })).toThrow("owner User");
    expect(() => admitRepository({ archived: false, default_branch: "main", disabled: false, full_name: "hraness/kb", id: 1308971873, private: true, visibility: "private" })).toThrow();
    admitRemoteRoutes("https://github.com/hraness/kb.git\n", "git@github.com:hraness/kb.git\n");
    expect(() => admitRemoteRoutes("https://github.com/hraness/kb.git\n", "https://github.com/hraness/kb.git\nhttps://github.com/attacker/kb.git\n")).toThrow();
    const workflowId = admitActiveCiWorkflow({ id: 9, name: "CI", path: ".github/workflows/ci.yml", state: "active" });
    const exactRun = { conclusion: "success", event: "push", head_branch: "main", head_repository: { full_name: "hraness/kb" }, head_sha: sha, id: 10, name: "CI", path: ".github/workflows/ci.yml", repository: { full_name: "hraness/kb" }, run_attempt: 2, status: "completed", workflow_id: workflowId };
    const run = admitCiRun({ total_count: 1, workflow_runs: [exactRun] }, workflowId, sha);
    expect(() => admitCiRun({ total_count: 1, workflow_runs: [{ ...exactRun, event: "workflow_dispatch" }] }, workflowId, sha)).toThrow("exactly one exact CI push run");
    expect(admitCiRequiredJob({ jobs: [{ conclusion: "success", head_sha: sha, id: 11, name: "Required", run_attempt: 2, run_id: 10, status: "completed" }], total_count: 1 }, run, sha)).toBe(11);
    expect(() => admitCiRequiredJob({ jobs: [{ conclusion: "success", head_sha: sha, id: 11, name: "Required", run_attempt: 1, run_id: 10, status: "completed" }], total_count: 1 }, run, sha)).toThrow();
    const inventory = `${otherSha}\trefs/tags/v0.19.0\n`;
    expect(admitRemoteReleaseTags(inventory, "0.20.0", sha)).toBe("absent");
    expect(admitRemoteReleaseTags(inventory, "0.19.1-beta.0", sha)).toBe("absent");
    expect(() => admitRemoteReleaseTags(inventory, "0.18.0", sha)).toThrow("monotonically");
    const exact = `${otherSha}\trefs/tags/v0.20.0\n${sha}\trefs/tags/v0.20.0^{}\n`;
    expect(admitRemoteReleaseTags(exact, "0.20.0", sha)).toBe("same-annotated-commit");
    expect(() => admitRemoteReleaseTags(`${otherSha}\trefs/tags/v0.20.0\n`, "0.20.0", sha)).toThrow("conflicts");
    expect(() => parseReleaseVersion("0.20.0-beta.01")).toThrow("canonical");
  });

  test("gates the immutable GitHub release on the exact public npm artifact", async () => {
    const path = resolve(import.meta.dir, "../.github/workflows/release.yml");
    const source = await readFile(path, "utf8");

    expect(source).toContain("Verify canonical npm delivery");
    expect(source).toContain('tags:\n      - "v*"\n      - "!v*-beta.*"');
    expect(source).toContain("Authorize owner release tag");
    expect(source).toContain('EXPECTED_REPOSITORY_ID: "1308971873"');
    expect(source).toContain('event.repository?.visibility !== "public"');
    expect(source).toContain("github.ref_protected");
    expect(source).not.toContain("workflow_dispatch:");
    expect(source).not.toContain("publication_run_id");
    expect(source).toContain("Release tag must be annotated");
    expect(source).toContain("for registry_poll in {1..60}");
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
