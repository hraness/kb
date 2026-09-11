import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { downloadCanonicalRelease, verifyCanonicalPublication, type ReleaseManifest } from "./github-release.js";

export const recoveryIdentity = Object.freeze({
  version: "0.20.0",
  sourceSha: "a3b44090b38aa22228e26b4be8e7727232b3ff17",
  runId: 34540823193,
  runAttempt: 1,
  archiveSha256: "5a3c61436d9d87ea90409e19ae8ad1511d2a5dc3f5c9a529037eb6fd49ce017a",
  archiveIntegrity: "sha512-TCL87uFDUmMIWbsyk/S8Hj1BaiW3H1eOw1mrK/Etm3K4h6aDQE8vgyvYIwp6tlnJmYgA5i34/Ikh5Vgj7Jkvwg==",
});
const repository = "hraness/wordcell";
const workflowPath = ".github/workflows/admit-published.yml";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function positive(value: string | undefined): number {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value)) || String(Number(value)) !== value) throw new Error("Recovery run identity is invalid");
  return Number(value);
}

export function verifyRecoveryAuthority(
  env: Readonly<Record<string, string | undefined>>,
  eventValue: unknown,
  mainValue: unknown,
  workflowValue: unknown,
  runValue: unknown,
): void {
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== repository || env.GITHUB_REPOSITORY_ID !== "1308971873"
    || env.GITHUB_ACTOR_ID !== "894119" || env.GITHUB_SHA?.length !== 40 || !/^[a-f0-9]+$/u.test(env.GITHUB_SHA)
    || env.WORKFLOW_SHA !== env.GITHUB_SHA || env.GITHUB_WORKFLOW_REF !== `${repository}/${workflowPath}@refs/heads/main`) {
    throw new Error("Recovery requires the owner dispatch on exact current main");
  }
  const event = record(eventValue, "Recovery event");
  const sender = record(event.sender, "Recovery sender");
  const eventRepo = record(event.repository, "Recovery repository");
  const main = record(record(mainValue, "Current main").object, "Current main object");
  const workflow = record(workflowValue, "Recovery workflow");
  const run = record(runValue, "Recovery run");
  const actor = record(run.actor, "Recovery actor");
  const triggering = record(run.triggering_actor, "Recovery triggering actor");
  const runRepo = record(run.repository, "Recovery run repository");
  for (const repo of [eventRepo, runRepo]) {
    if (repo.id !== 1308971873 || repo.full_name !== repository || repo.private !== false
      || record(repo.owner, "Repository owner").id !== 307125679) throw new Error("Recovery repository identity differs");
  }
  if (eventRepo.default_branch !== "main" || eventRepo.visibility !== "public"
    || sender.id !== 894119 || sender.type !== "User"
    || main.type !== "commit" || main.sha !== env.GITHUB_SHA
    || workflow.path !== workflowPath || workflow.state !== "active" || !Number.isSafeInteger(workflow.id) || Number(workflow.id) < 1
    || run.id !== positive(env.GITHUB_RUN_ID) || run.run_attempt !== positive(env.GITHUB_RUN_ATTEMPT)
    || run.workflow_id !== workflow.id || run.name !== "Admit published Wordcell 0.20.0" || run.path !== workflowPath
    || run.head_sha !== env.GITHUB_SHA || run.head_branch !== "main" || run.event !== "workflow_dispatch"
    || run.status !== "in_progress" || run.conclusion !== null
    || actor.id !== 894119 || actor.type !== "User" || triggering.id !== 894119 || triggering.type !== "User") {
    throw new Error("Recovery workflow, owner, source, or active attempt differs");
  }
}

export function verifyRecoveryManifest(manifest: ReleaseManifest): void {
  if (manifest.version !== recoveryIdentity.version || manifest.tag !== `v${recoveryIdentity.version}`
    || manifest.sourceSha !== recoveryIdentity.sourceSha || manifest.workflowSha !== recoveryIdentity.sourceSha
    || manifest.runId !== recoveryIdentity.runId || manifest.runAttempt !== recoveryIdentity.runAttempt
    || manifest.archive.sha256 !== recoveryIdentity.archiveSha256
    || `sha512-${Buffer.from(manifest.archive.sha512, "hex").toString("base64")}` !== recoveryIdentity.archiveIntegrity) {
    throw new Error("Recovery receipt differs from the exact original publication");
  }
}

function command(program: string, args: readonly string[], cwd = process.cwd()): string {
  return execFileSync(program, [...args], { cwd, encoding: "utf8", timeout: 300_000, maxBuffer: 24 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"] });
}

function api(path: string): unknown {
  return JSON.parse(command("gh", ["api", "--method", "GET", `/repos/${repository}${path}`])) as unknown;
}

function authorize(): void {
  positive(process.env.GITHUB_RUN_ID); positive(process.env.GITHUB_RUN_ATTEMPT);
  verifyRecoveryAuthority(process.env, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as unknown,
    api("/git/ref/heads/main"), api("/actions/workflows/admit-published.yml"), api(`/actions/runs/${process.env.GITHUB_RUN_ID}`));
  if (command("git", ["rev-parse", "HEAD"]).trim() !== process.env.GITHUB_SHA) throw new Error("Recovery checkout differs from the authorized verifier source");
}

async function recover(): Promise<void> {
  authorize();
  if (process.env.RUNNER_TEMP === undefined) throw new Error("Recovery requires an isolated runner directory");
  const work = await mkdtemp(join(process.env.RUNNER_TEMP, "wordcell-npm-admission-"));
  const canonical = join(work, "canonical");
  const manifest = await downloadCanonicalRelease(canonical, recoveryIdentity.version, recoveryIdentity.sourceSha);
  verifyRecoveryManifest(manifest);
  const release = record(api(`/releases/tags/${manifest.tag}`), "Canonical release");
  const latest = record(api("/releases/latest"), "Latest release");
  if (latest.id !== release.id || latest.tag_name !== manifest.tag || latest.immutable !== true) throw new Error("Recovery requires the exact immutable GitHub Latest release");
  const registry = join(work, "registry");
  const consumer = join(work, "consumer");
  await mkdir(registry); await mkdir(consumer);
  const coordinate = `${manifest.package}@${manifest.version}`;
  const registryArg = "--registry=https://registry.npmjs.org";
  await writeFile(join(registry, "npm-view.json"), command("npm", ["view", coordinate, "--json", registryArg]));
  await writeFile(join(registry, "npm-pack.json"), command("npm", ["pack", coordinate, "--ignore-scripts", "--json", registryArg], registry));
  if (!(await readFile(join(registry, manifest.archive.name))).equals(await readFile(join(canonical, manifest.archive.name)))) {
    throw new Error("Registry archive is not byte-identical to the canonical archive");
  }
  command("bun", ["run", "./scripts/npm-package-identity.ts", "--expected-name", manifest.package,
    "--expected-version", manifest.version, "--registry-archive", join(registry, manifest.archive.name),
    "--registry-pack-json", join(registry, "npm-pack.json"), "--registry-view-json", join(registry, "npm-view.json"),
    "--source-archive", join(canonical, manifest.archive.name), "--source-pack-json", join(canonical, "npm-pack.json")]);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "wordcell-admission-consumer", version: "0.0.0", private: true }));
  command("npm", ["install", coordinate, "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", registryArg], consumer);
  await writeFile(join(work, "audit.json"), command("npm", ["audit", "signatures", "--json", "--include-attestations", "--omit=dev", registryArg], consumer));
  await writeFile(join(registry, "latest.json"), command("npm", ["view", manifest.package, "dist-tags.latest", "--json", registryArg]));
  command("bun", ["run", "./scripts/npm-release-attestation.ts", "--audit-json", join(work, "audit.json"),
    "--expected-source-sha", manifest.sourceSha, "--expected-run-id", String(manifest.runId),
    "--maximum-run-attempt", String(manifest.runAttempt), "--expected-tarball-sha512", manifest.archive.sha512,
    "--expected-version", manifest.version, "--registry-latest-json", join(registry, "latest.json"),
    "--registry-view-json", join(registry, "npm-view.json")]);
  authorize();
  verifyCanonicalPublication(manifest);
  const finalLatest = record(api("/releases/latest"), "Final Latest release");
  if (finalLatest.id !== release.id || finalLatest.tag_name !== manifest.tag || finalLatest.immutable !== true) throw new Error("GitHub Latest changed during recovery");
  process.stdout.write(`${JSON.stringify({ status: "admitted", ...recoveryIdentity,
    verificationRun: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` })}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Recovery accepts no version, source, or run overrides");
  await recover();
}
