import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parse } from "yaml";
import { parseReleaseManifest } from "./github-release.js";
import { recoveryIdentity, verifyRecoveryAuthority, verifyRecoveryManifest } from "./npm-admission-recovery.js";
import { validateAdmissionRecoveryWorkflow, validateReleaseWorkflow } from "./check-workflow-yaml.js";

const workflowPath = ".github/workflows/admit-published.yml";
const source = readFileSync(new URL(`../${workflowPath}`, import.meta.url), "utf8");
const workflow = parse(source);
const script = workflow.jobs.admit.steps[0].run.split("node <<'NODE'\n")[1].split("\nNODE")[0];
const env = {
  GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "hraness/wordcell",
  GITHUB_REPOSITORY_ID: "1308971873", GITHUB_ACTOR_ID: "894119", GITHUB_SHA: "d".repeat(40), WORKFLOW_SHA: "d".repeat(40),
  GITHUB_WORKFLOW_REF: `hraness/wordcell/${workflowPath}@refs/heads/main`, GITHUB_RUN_ID: "555", GITHUB_RUN_ATTEMPT: "1", GITHUB_EVENT_PATH: "/event.json",
};
const repo = { id: 1308971873, full_name: "hraness/wordcell", private: false, visibility: "public", default_branch: "main", owner: { id: 307125679 } };
const event = { sender: { id: 894119, type: "User" }, repository: repo };
const main = { object: { type: "commit", sha: env.GITHUB_SHA } };
const descriptor = { id: 999, path: workflowPath, state: "active" };
const run = { id: 555, run_attempt: 1, workflow_id: 999, name: "Admit published Wordcell 0.20.0", path: workflowPath,
  head_sha: env.GITHUB_SHA, head_branch: "main", event: "workflow_dispatch", status: "in_progress", conclusion: null,
  actor: event.sender, triggering_actor: event.sender, repository: repo };

type Fixture = { env: Record<string, string>; event: unknown; main: unknown; descriptor: unknown; run: unknown };
const fixture = (): Fixture => ({ env, event, main, descriptor, run });

function beforeCheckout(value: Fixture, fault?: "http" | "json"): void {
  runInNewContext(script, {
    process: { env: value.env },
    require: (module: string) => {
      if (module === "node:fs") return { readFileSync: (path: string) => {
        expect(path).toBe(value.env.GITHUB_EVENT_PATH ?? ""); return JSON.stringify(value.event);
      } };
      if (module === "node:child_process") return { execFileSync: (program: string, args: string[], options: Record<string, unknown>) => {
        expect(program).toBe("gh"); expect(args.slice(0, 3)).toEqual(["api", "--method", "GET"]);
        expect(options.timeout).toBe(90000); expect(options.maxBuffer).toBe(1000000);
        if (fault === "http") throw new Error("Provider HTTP 403");
        if (fault === "json") return "invalid JSON";
        const values: Record<string, unknown> = {
          "/repos/hraness/wordcell/git/ref/heads/main": value.main,
          "/repos/hraness/wordcell/actions/workflows/admit-published.yml": value.descriptor,
          [`/repos/hraness/wordcell/actions/runs/${value.env.GITHUB_RUN_ID}`]: value.run,
        };
        if (!(args[3]! in values)) throw new Error("Unexpected provider endpoint");
        return JSON.stringify(values[args[3]!]);
      } };
      throw new Error("Unexpected authority dependency");
    },
  }, { timeout: 1000 });
}

test("actual pre-checkout and final authority gates accept only the same active owner dispatch on fresh main", () => {
  expect(() => beforeCheckout(fixture())).not.toThrow();
  expect(() => verifyRecoveryAuthority(env, event, main, descriptor, run)).not.toThrow();
  const changes: Fixture[] = [];
  for (const [key, value] of Object.entries({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/other", GITHUB_REPOSITORY: "other/repo",
    GITHUB_REPOSITORY_ID: "1", GITHUB_ACTOR_ID: "1", GITHUB_SHA: "main", WORKFLOW_SHA: "a".repeat(40), GITHUB_WORKFLOW_REF: "other.yml",
    GITHUB_RUN_ID: "0", GITHUB_RUN_ATTEMPT: "2", GITHUB_EVENT_PATH: "" })) {
    if (key !== "GITHUB_EVENT_PATH") changes.push({ ...fixture(), env: { ...env, [key]: value } });
  }
  for (const value of [null, {}, { ...event, sender: { id: 1, type: "User" } }, { ...event, sender: { id: 894119, type: "Bot" } },
    { ...event, repository: { ...repo, private: true } }, { ...event, repository: { ...repo, default_branch: "other" } },
    { ...event, repository: { ...repo, owner: { id: 1 } } }]) changes.push({ ...fixture(), event: value });
  for (const value of [{ object: { type: "tag", sha: env.GITHUB_SHA } }, { object: { type: "commit", sha: "a".repeat(40) } }]) changes.push({ ...fixture(), main: value });
  for (const value of [{ ...descriptor, id: 0 }, { ...descriptor, path: "other.yml" }, { ...descriptor, state: "disabled_manually" }]) changes.push({ ...fixture(), descriptor: value });
  for (const change of [{ id: 1 }, { run_attempt: 2 }, { workflow_id: 1 }, { path: "other.yml" }, { name: "Other" },
    { head_sha: "a".repeat(40) }, { head_branch: "other" }, { event: "push" }, { status: "completed" }, { conclusion: "success" },
    { triggering_actor: { id: 1, type: "User" } }, { actor: { id: 894119, type: "Bot" } }, { repository: { ...repo, owner: { id: 1 } } }]) changes.push({ ...fixture(), run: { ...run, ...change } });
  changes.push({ ...fixture(), env: { ...env, GITHUB_RUN_ID: "555\n" } });
  for (const value of changes) {
    expect(() => beforeCheckout(value)).toThrow();
    expect(() => verifyRecoveryAuthority(value.env, value.event, value.main, value.descriptor, value.run)).toThrow();
  }
  for (const fault of ["http", "json"] as const) expect(() => beforeCheckout(fixture(), fault)).toThrow();
});

test("recovery pins the signed original publication, not the new verifier run", () => {
  const manifest = parseReleaseManifest({
    schema: "hraness-github-release-v1", repository: "hraness/wordcell", repositoryId: 1308971873, package: "@hraness/wordcell",
    version: recoveryIdentity.version, tag: `v${recoveryIdentity.version}`, sourceSha: recoveryIdentity.sourceSha, workflowSha: recoveryIdentity.sourceSha,
    workflow: ".github/workflows/release.yml", runId: recoveryIdentity.runId, runAttempt: recoveryIdentity.runAttempt,
    archive: { name: "hraness-wordcell-0.20.0.tgz", bytes: 1105942, sha256: recoveryIdentity.archiveSha256,
      sha512: Buffer.from(recoveryIdentity.archiveIntegrity.slice(7), "base64").toString("hex") },
  });
  expect(() => verifyRecoveryManifest(manifest)).not.toThrow();
  for (const change of [{ version: "0.20.1" }, { tag: "v0.20.1" }, { sourceSha: env.GITHUB_SHA }, { workflowSha: env.WORKFLOW_SHA },
    { runId: Number(env.GITHUB_RUN_ID) }, { runAttempt: 2 }, { archive: { ...manifest.archive, sha256: "a".repeat(64) } },
    { archive: { ...manifest.archive, sha512: "a".repeat(128) } }]) expect(() => verifyRecoveryManifest({ ...manifest, ...change })).toThrow();
});

test("recovery workflow has only read authority, no inputs or environments, and exact reviewed control flow", () => {
  expect(() => validateAdmissionRecoveryWorkflow(source, workflowPath)).not.toThrow();
  for (const [needle, replacement] of [
    ["  workflow_dispatch:", "  push:"], ["  workflow_dispatch:", "  workflow_dispatch:\n    inputs:\n      version:\n        default: 0.20.1"],
    ["      contents: read", "      contents: write"], ["      actions: read", "      actions: read\n      id-token: write"],
    ["    timeout-minutes: 20", "    timeout-minutes: 20\n    environment: npm-release"],
    ["          ref: ${{ github.sha }}", "          ref: main"],
    ["        run: bun run scripts/npm-admission-recovery.ts", "        run: npm publish other.tgz"],
    ["          GH_TOKEN: ${{ github.token }}", "          GH_TOKEN: ${{ secrets.PAT }}"],
    ["    steps:", "    continue-on-error: true\n    steps:"],
  ] as const) {
    expect(source.includes(needle)).toBe(true);
    expect(() => validateAdmissionRecoveryWorkflow(source.replace(needle, replacement), workflowPath)).toThrow();
  }
  const releaseSource = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  expect(() => validateReleaseWorkflow(releaseSource, "release.yml")).not.toThrow();
  const before = releaseSource.indexOf("      - name: Verify the public registry archive, signatures, and provenance against the canonical asset");
  expect(before).toBeGreaterThan(0);
  expect(releaseSource.slice(before)).toContain("        env:\n          GH_TOKEN: ${{ github.token }}");
  expect(() => validateReleaseWorkflow(releaseSource.slice(0, before) + releaseSource.slice(before).replace("        env:\n          GH_TOKEN: ${{ github.token }}\n", ""), "release.yml")).toThrow();
});
