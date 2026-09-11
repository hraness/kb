import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { parse } from "yaml";

import {
  inspectPackageArtifact,
  type PackageArtifactInventory,
} from "./package-artifact.js";
import {
  requiresOhAdoptionPreparerExport,
  verifyNpmPackageIdentity,
} from "./npm-package-identity.js";

const releaseWorkflowUrl = new URL("../.github/workflows/release.yml", import.meta.url);
const ciWorkflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);
const manifestUrl = new URL("../package.json", import.meta.url);
const readmeUrl = new URL("../README.md", import.meta.url);
const packageSmokeUrl = new URL("./package-smoke.ts", import.meta.url);
const packagePreparationUrl = new URL("./prepare-npm-package.ts", import.meta.url);
const packageArtifactUrl = new URL("./package-artifact.ts", import.meta.url);
const packageIdentityUrl = new URL("./npm-package-identity.ts", import.meta.url);
const npmRegistry = "https://registry.npmjs.org";
const repository = fileURLToPath(new URL("../", import.meta.url));

async function run(command: readonly string[], cwd: string): Promise<void> {
  const child = Bun.spawn([...command], { cwd, stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${String(exitCode)}): ${command.join(" ")}`);
}

function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

function integrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function persistPackedTarMutation(
  artifactDirectory: string,
  tarballName: string,
  tar: Buffer,
  metadata: Array<Record<string, unknown>>,
): Promise<void> {
  const tarballPath = join(artifactDirectory, tarballName);
  const metadataPath = join(artifactDirectory, "npm-pack.json");
  const digestPath = join(artifactDirectory, "npm-package.sha256");
  if (metadata.length !== 1 || metadata[0] === undefined) {
    throw new Error("Test npm-pack.json is invalid");
  }
  const archive = gzipSync(tar);
  metadata[0].size = archive.byteLength;
  metadata[0].integrity = integrity(archive);
  metadata[0].shasum = sha1(archive);
  const metadataBytes = Buffer.from(`${JSON.stringify(metadata)}\n`, "utf8");
  await Promise.all([
    writeFile(tarballPath, archive),
    writeFile(metadataPath, metadataBytes),
    writeFile(
      digestPath,
      `${sha256(archive)}  ${tarballName}\n${sha256(metadataBytes)}  npm-pack.json\n`,
    ),
  ]);
}

async function injectPackedTopLevelTag(
  artifactDirectory: string,
  tarballName: string,
): Promise<void> {
  const tarballPath = join(artifactDirectory, tarballName);
  const metadataPath = join(artifactDirectory, "npm-pack.json");
  const tar = gunzipSync(await readFile(tarballPath));
  let offset = 0;
  let replaced = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const readText = (start: number, length: number): string => {
      const field = header.subarray(start, start + length);
      const zero = field.indexOf(0);
      return (zero < 0 ? field : field.subarray(0, zero)).toString("ascii");
    };
    const name = readText(0, 100);
    const prefix = readText(345, 155);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const sizeText = readText(124, 12).trim();
    if (!/^[0-7]+$/u.test(sizeText)) throw new Error("Test tar entry size is invalid");
    const size = Number.parseInt(sizeText, 8);
    if (path === "package/package.json") {
      const source = tar.subarray(offset, offset + size).toString("utf8");
      const original = '"type": "module",';
      const hostile = '"tag": "beta",   ';
      if (original.length !== hostile.length || !source.includes(original)) {
        throw new Error("Packed manifest lacks the fixed-width mutation target");
      }
      Buffer.from(source.replace(original, hostile), "utf8").copy(tar, offset);
      replaced = true;
    }
    offset += Math.ceil(size / 512) * 512;
  }
  if (!replaced) throw new Error("Packed manifest was not mutated");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Array<Record<string, unknown>>;
  await persistPackedTarMutation(artifactDirectory, tarballName, tar, metadata);
}

async function corruptPackedUstarVersion(
  artifactDirectory: string,
  tarballName: string,
): Promise<void> {
  const tarballPath = join(artifactDirectory, tarballName);
  const metadataPath = join(artifactDirectory, "npm-pack.json");
  const tar = gunzipSync(await readFile(tarballPath));
  const signature = Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0x00, 0x30, 0x30]);
  if (!tar.subarray(257, 265).equals(signature)) {
    throw new Error("Test archive lacks an exact USTAR magic/version header");
  }
  tar[263] = 0x78;
  tar[264] = 0x78;
  writeHeaderChecksum(tar, 0);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Array<Record<string, unknown>>;
  await persistPackedTarMutation(artifactDirectory, tarballName, tar, metadata);
}

async function injectPackedExtendedPrefixTraversal(
  artifactDirectory: string,
  tarballName: string,
): Promise<void> {
  const tarballPath = join(artifactDirectory, tarballName);
  const metadataPath = join(artifactDirectory, "npm-pack.json");
  const tar = gunzipSync(await readFile(tarballPath));
  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Array<Record<string, unknown>>;
  const record = metadata[0];
  if (record === undefined || !Array.isArray(record.files)) {
    throw new Error("Test npm-pack.json lacks its file inventory");
  }
  const target = record.files.find((value) => (
    typeof value === "object"
    && value !== null
    && typeof (value as Record<string, unknown>).path === "string"
    && String((value as Record<string, unknown>).path).startsWith("dist/")
    && ![
      "dist/cli.js",
      "dist/evaluation-builder.js",
      "dist/index.js",
    ].includes(String((value as Record<string, unknown>).path))
  )) as Record<string, unknown> | undefined;
  if (target === undefined || typeof target.path !== "string") {
    throw new Error("Test npm-pack.json lacks a mutable dist file");
  }

  let offset = 0;
  let mutated = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = readTarOctal(tar, offset + 124);
    const field = (start: number, length: number): string => {
      const bytes = header.subarray(start, start + length);
      const zero = bytes.indexOf(0);
      return (zero < 0 ? bytes : bytes.subarray(0, zero)).toString("ascii");
    };
    const name = field(0, 100);
    const prefix = field(345, header[475] === 0 ? 130 : 155);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    if (path === `package/${target.path}`) {
      const safePrefix = `package/dist/${"a".repeat(117)}`;
      if (Buffer.byteLength(safePrefix, "ascii") !== 130) {
        throw new Error("Test USTAR prefix fixture has the wrong width");
      }
      header.fill(0, 0, 100);
      header.write("fixture.js", 0, "ascii");
      header.fill(0, 345, 500);
      header.write(safePrefix, 345, "ascii");
      header.write("/../hostile", 475, "ascii");
      target.path = `${safePrefix.slice("package/".length)}/fixture.js`;
      writeHeaderChecksum(tar, offset);
      mutated = true;
      break;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!mutated) throw new Error("Test package lacks the selected tar entry");
  await persistPackedTarMutation(artifactDirectory, tarballName, tar, metadata);
}

function requireOwnerReleaseAuthorization(workflow: string): void {
  const start = workflow.indexOf("  authorize:\n");
  const end = workflow.indexOf("\n  verify:\n");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("release.yml is missing the leading authorization job");
  }
  const authorize = workflow.slice(start, end);
  if (!authorize.includes('"$GITHUB_ACTOR_ID" != "$EXPECTED_ACTOR_ID"')) {
    throw new Error("release.yml is missing the exact event actor guard");
  }
  if (!authorize.includes("event.sender?.id !== Number(process.env.EXPECTED_ACTOR_ID)")) {
    throw new Error("release.yml is missing the exact event sender guard");
  }
  if (!authorize.includes('event.sender?.type !== "User"')) {
    throw new Error("release.yml is missing the immutable sender type guard");
  }
  const firstCheckout = workflow.indexOf("actions/checkout@");
  if (firstCheckout === -1 || firstCheckout < end) {
    throw new Error("release.yml must authorize before checkout");
  }
}

function workflowStepScript(workflow: string, name: string): string {
  const parsed = parse(workflow) as Readonly<{
    jobs?: Readonly<Record<string, Readonly<{
      steps?: readonly Readonly<{ name?: unknown; run?: unknown }>[];
    }>>>;
  }>;
  for (const job of Object.values(parsed.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (step.name === name && typeof step.run === "string") return step.run;
    }
  }
  throw new Error(`Workflow run step not found: ${name}`);
}

async function runWorkflowScript(
  script: string,
  environment: Readonly<Record<string, string>>,
): Promise<Readonly<{ exitCode: number; stderr: string; stdout: string }>> {
  const child = Bun.spawn(["/bin/bash", "-c", script], {
    cwd: repository,
    env: { ...process.env, ...environment },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  return Object.freeze({ exitCode, stderr, stdout });
}

async function writeReleaseControlGitMock(binaryDirectory: string): Promise<void> {
  const path = join(binaryDirectory, "git");
  await writeFile(path, [
    "#!/bin/bash",
    "set -euo pipefail",
    'case "$*" in',
    '  "fetch --no-tags --force origin "*) exit 0 ;;',
    '  "rev-parse refs/remotes/kb-release-current/main") printf \'%s\\n\' "$MOCK_SOURCE_SHA" ;;',
    '  "merge-base --is-ancestor "*) exit 0 ;;',
    '  "diff --quiet --no-ext-diff --no-textconv "*) [[ "${MOCK_CONTROL_DRIFT:-false}" != true ]] ;;',
    '  *) echo "unexpected git invocation: $*" >&2; exit 2 ;;',
    "esac",
  ].join("\n"));
  await chmod(path, 0o755);
}

describe("package smoke version policy", () => {
  test("requires the Oh adoption preparer only from its stable introduction", () => {
    expect(requiresOhAdoptionPreparerExport("0.17.1")).toBe(false);
    expect(requiresOhAdoptionPreparerExport("0.17.3")).toBe(false);
    expect(requiresOhAdoptionPreparerExport("0.18.0")).toBe(true);
    expect(requiresOhAdoptionPreparerExport("0.18.1")).toBe(true);
    expect(requiresOhAdoptionPreparerExport("0.19.0")).toBe(true);
    expect(requiresOhAdoptionPreparerExport("1.0.0")).toBe(true);
    expect(requiresOhAdoptionPreparerExport(
      "9007199254740991.9007199254740991.9007199254740991",
    )).toBe(true);
  });

  test("rejects noncanonical or non-stable package versions", () => {
    for (const version of [
      "",
      "v0.18.0",
      "0.18",
      "0.18.0-beta.1",
      "00.18.0",
      "0.018.0",
      "0.18.00",
    ]) {
      expect(() => requiresOhAdoptionPreparerExport(version)).toThrow(
        "canonical stable semantic version",
      );
    }
    for (const version of [
      "9007199254740992.0.0",
      "0.9007199254740992.0",
      "0.0.9007199254740992",
    ]) {
      expect(() => requiresOhAdoptionPreparerExport(version)).toThrow(
        "Number.MAX_SAFE_INTEGER",
      );
    }
  });
});

function packJson(
  bytes: Uint8Array,
  inventory: PackageArtifactInventory,
  name: string,
  version: string,
  reverseFiles = false,
): string {
  const files = reverseFiles ? [...inventory.files].reverse() : inventory.files;
  return `${JSON.stringify([{
    bundled: [],
    entryCount: inventory.fileCount,
    filename: `hraness-wordcell-${version}.tgz`,
    files: files.map((file) => ({ mode: file.mode, path: file.path, size: file.size })),
    id: `${name}@${version}`,
    integrity: integrity(bytes),
    name,
    shasum: sha1(bytes),
    size: bytes.byteLength,
    unpackedSize: inventory.unpackedBytes,
    version,
  }], null, 2)}\n`;
}

function registryView(
  bytes: Uint8Array,
  inventory: PackageArtifactInventory,
  name: string,
  version: string,
): string {
  return `${JSON.stringify({
    dist: {
      fileCount: inventory.fileCount,
      integrity: integrity(bytes),
      shasum: sha1(bytes),
      tarball: `${npmRegistry}/${name}/-/wordcell-${version}.tgz`,
      unpackedSize: inventory.unpackedBytes,
    },
    name,
    version,
  }, null, 2)}\n`;
}

function readTarOctal(tar: Buffer, offset: number): number {
  const value = tar.subarray(offset, offset + 12).toString("ascii").replace(/\0.*$/u, "").trim();
  return Number.parseInt(value, 8);
}

function firstRegularHeader(tar: Buffer): Readonly<{ offset: number; size: number }> {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = readTarOctal(tar, offset + 124);
    const type = tar[offset + 156] ?? 0;
    if ((type === 0 || type === 48) && size > 0) return Object.freeze({ offset, size });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("Test package contains no non-empty regular file");
}

function writeHeaderChecksum(tar: Buffer, offset: number): void {
  tar.fill(32, offset + 148, offset + 156);
  let checksum = 0;
  for (let index = offset; index < offset + 512; index += 1) checksum += tar[index] ?? 0;
  tar.write(`${checksum.toString(8).padStart(6, "0")}\0 `, offset + 148, 8, "ascii");
}

describe("npm release workflows", () => {
  test("keeps npm discoverability metadata focused and aligned with the README", async () => {
    const [manifestSource, readme] = await Promise.all([
      readFile(manifestUrl, "utf8"),
      readFile(readmeUrl, "utf8"),
    ]);
    const manifest = JSON.parse(manifestSource) as {
      readonly description?: unknown;
      readonly keywords?: unknown;
      readonly version?: unknown;
    };
    expect(manifest).toEqual(expect.objectContaining({
      version: "0.21.1",
      description: "A knowledge base for coding agents, built from Markdown, backlinks, semantic search, and Git context.",
      keywords: [
        "knowledge-base",
        "coding-agents",
        "agent-memory",
        "repository-context",
        "markdown",
        "obsidian",
        "agents-md",
        "web-clipper",
        "backlinks",
        "knowledge-graph",
        "semantic-search",
        "local-first",
        "agent-skills",
        "claude-code",
        "codex",
        "typescript-sdk",
      ],
    }));
    const opening = readme.slice(0, 1_500).replace(/\s+/gu, " ").toLowerCase();
    expect(opening).toContain(String(manifest.description).toLowerCase());
    for (const link of [
      "[Install Wordcell from GitHub Releases](https://github.com/hraness/wordcell/releases)",
      "[Wordcell source on GitHub](https://github.com/hraness/wordcell)",
      "[Wordcell overview](https://wordcell.io)",
    ]) expect(readme).toContain(link);
  });

  test("hostile actor or sender drift cannot reach the protected release workflow", async () => {
    const workflow = await readFile(releaseWorkflowUrl, "utf8");
    expect(() => requireOwnerReleaseAuthorization(workflow)).not.toThrow();

    const actorDrift = workflow.replace(
      '"$GITHUB_ACTOR_ID" != "$EXPECTED_ACTOR_ID"',
      '"$GITHUB_ACTOR_ID" == "$EXPECTED_ACTOR_ID"',
    );
    expect(actorDrift).not.toBe(workflow);
    expect(() => requireOwnerReleaseAuthorization(actorDrift)).toThrow(
      "exact event actor guard",
    );

    const senderDrift = workflow.replace(
      "event.sender?.id !== Number(process.env.EXPECTED_ACTOR_ID)",
      "event.sender?.id !== 894120",
    );
    expect(senderDrift).not.toBe(workflow);
    expect(() => requireOwnerReleaseAuthorization(senderDrift)).toThrow(
      "exact event sender guard",
    );
  });

  test("the write job reauthorizes the exact run attempt and rejects collaborator reruns", async () => {
    const workflow = await readFile(releaseWorkflowUrl, "utf8");
    const publishJob = workflow.slice(workflow.indexOf("\n  publish:\n"));
    const authorizationIndex = publishJob.indexOf("Reauthorize current release attempt");
    const liveTagIndex = publishJob.indexOf('current_tag_sha="$(gh api');
    const mutationIndex = publishJob.indexOf('node scripts/github-release.ts publish "$RUNNER_TEMP/kb-github-handoff"');
    expect(publishJob).toContain("permissions:\n      actions: read\n      contents: write");
    expect(authorizationIndex).toBeGreaterThan(-1);
    expect(authorizationIndex).toBeLessThan(liveTagIndex);
    expect(liveTagIndex).toBeLessThan(mutationIndex);
    expect(publishJob).toContain(
      '"/repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT"',
    );
    expect(publishJob).toContain('EXPECTED_WORKFLOW_ID: "320004141"');
    expect(publishJob).toContain("attempt.triggering_actor?.id !== actorId");
    expect(publishJob).toContain('attempt.triggering_actor?.type !== "User"');
    expect(publishJob).toContain('repository.visibility !== "public"');

    const script = workflowStepScript(workflow, "Reauthorize current release attempt");
    const directory = await mkdtemp(join(tmpdir(), "kb-release-attempt-"));
    const binaryDirectory = join(directory, "bin");
    const attemptPath = join(directory, "attempt.json");
    const workflowPath = join(directory, "workflow.json");
    const repositoryPath = join(directory, "repository.json");
    const commandLog = join(directory, "gh.log");
    const sourceSha = "b".repeat(40);
    const attempt = {
      id: 67890,
      run_attempt: 3,
      workflow_id: 320004141,
      name: "Release",
      path: ".github/workflows/release.yml",
      event: "push",
      head_branch: "v0.20.0",
      head_sha: sourceSha,
      status: "in_progress",
      conclusion: null,
      actor: { id: 894119, type: "User" },
      triggering_actor: { id: 894119, type: "User" },
      repository: {
        id: 1308971873,
        full_name: "hraness/wordcell",
        private: false,
      },
    };

    try {
      await mkdir(binaryDirectory, { recursive: true });
      await writeFile(
        join(binaryDirectory, "gh"),
        [
          "#!/bin/bash",
          "set -euo pipefail",
          'printf \'%s\\n\' "$*" >> "$GH_COMMAND_LOG"',
          'endpoint=""',
          'for argument in "$@"; do endpoint="$argument"; done',
          'case "$endpoint" in',
          '  */actions/runs/*) cat "$MOCK_ATTEMPT_JSON" ;;',
          '  */actions/workflows/*) cat "$MOCK_WORKFLOW_JSON" ;;',
          '  /repos/hraness/wordcell) cat "$MOCK_REPOSITORY_JSON" ;;',
          '  *) echo "unexpected gh endpoint: $endpoint" >&2; exit 2 ;;',
          "esac",
        ].join("\n"),
      );
      await chmod(join(binaryDirectory, "gh"), 0o755);
      await Promise.all([
        writeFile(attemptPath, JSON.stringify(attempt)),
        writeFile(workflowPath, JSON.stringify({
          id: 320004141,
          name: "Release",
          path: ".github/workflows/release.yml",
          state: "active",
        })),
        writeFile(repositoryPath, JSON.stringify({
          id: 1308971873,
          full_name: "hraness/wordcell",
          visibility: "public",
          private: false,
          default_branch: "main",
        })),
      ]);
      const environment = {
        PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
        GH_COMMAND_LOG: commandLog,
        MOCK_ATTEMPT_JSON: attemptPath,
        MOCK_WORKFLOW_JSON: workflowPath,
        MOCK_REPOSITORY_JSON: repositoryPath,
        RUNNER_TEMP: directory,
        EXPECTED_ACTOR_ID: "894119",
        EXPECTED_REPOSITORY: "hraness/wordcell",
        EXPECTED_REPOSITORY_ID: "1308971873",
        EXPECTED_WORKFLOW_ID: "320004141",
        EXPECTED_WORKFLOW_NAME: "Release",
        EXPECTED_WORKFLOW_PATH: ".github/workflows/release.yml",
        GITHUB_RUN_ID: "67890",
        GITHUB_RUN_ATTEMPT: "3",
        GITHUB_EVENT_NAME: "push",
        GITHUB_REPOSITORY: "hraness/wordcell",
        GITHUB_REPOSITORY_ID: "1308971873",
        GITHUB_REF: "refs/tags/v0.20.0",
        VERIFIED_SOURCE_SHA: sourceSha,
        VERIFIED_TAG: "v0.20.0",
      };
      const admitted = await runWorkflowScript(script, environment);
      expect(admitted.exitCode).toBe(0);
      expect(await readFile(commandLog, "utf8")).toContain(
        "actions/runs/67890/attempts/3",
      );

      await writeFile(attemptPath, JSON.stringify({
        ...attempt,
        triggering_actor: { id: 123456, type: "User" },
      }));
      const hostileRerun = await runWorkflowScript(script, environment);
      expect(hostileRerun.exitCode).not.toBe(0);
      expect(hostileRerun.stderr).toContain(
        "Current release attempt is not owner-authorized",
      );

      await writeFile(attemptPath, JSON.stringify(attempt));
      await writeFile(repositoryPath, JSON.stringify({
        id: 1308971873,
        full_name: "hraness/wordcell",
        visibility: "private",
        private: true,
        default_branch: "main",
      }));
      const privateRepository = await runWorkflowScript(script, environment);
      expect(privateRepository.exitCode).not.toBe(0);
      expect(privateRepository.stderr).toContain(
        "Current release attempt is not owner-authorized",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("release ordering fails closed on oversized numeric tags and releases", async () => {
    const workflow = await readFile(releaseWorkflowUrl, "utf8");
    const script = workflowStepScript(workflow, "Publish verified GitHub Release");
    const directory = await mkdtemp(join(tmpdir(), "kb-release-ordering-"));
    const binaryDirectory = join(directory, "bin");
    const commandLog = join(directory, "gh.log");
    const sourceSha = "b".repeat(40);
    try {
      await mkdir(binaryDirectory, { recursive: true });
      await writeFile(
        join(binaryDirectory, "gh"),
        [
          "#!/bin/bash",
          "set -euo pipefail",
          'printf \'%s\\n\' "$*" >> "$GH_COMMAND_LOG"',
          'case "$*" in',
          '  *"/commits/v0.20.0"*) printf \'%s\\n\' "$MOCK_SOURCE_SHA" ;;',
          '  *"/commits/main"*) printf \'%s\\n\' "$MOCK_SOURCE_SHA" ;;',
          '  *"/compare/"*) printf \'ahead\\n\' ;;',
          '  *"/tags?per_page=100"*) printf \'%s\\n\' "$MOCK_TAGS" ;;',
          '  *"/releases?per_page=100"*) printf \'%s\\n\' "$MOCK_RELEASES" ;;',
          '  *) echo "unexpected gh invocation: $*" >&2; exit 2 ;;',
          "esac",
        ].join("\n"),
      );
      await writeReleaseControlGitMock(binaryDirectory);
      await chmod(join(binaryDirectory, "gh"), 0o755);
      const environment = {
        PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
        DEFAULT_BRANCH: "main",
        GH_COMMAND_LOG: commandLog,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/tags/v0.20.0",
        GITHUB_REPOSITORY: "hraness/wordcell",
        GITHUB_SHA: sourceSha,
        MOCK_RELEASES: "",
        MOCK_SOURCE_SHA: sourceSha,
        MOCK_TAGS: "v0.20.0",
        VERIFIED_SOURCE_SHA: sourceSha,
        VERIFIED_TAG: "v0.20.0",
        WORKFLOW_SHA: sourceSha,
      };

      const controlDrift = await runWorkflowScript(script, {
        ...environment,
        MOCK_CONTROL_DRIFT: "true",
      });
      expect(controlDrift.exitCode).not.toBe(0);
      expect(controlDrift.stderr).toContain(
        "Tagged and current release workflow controls differ",
      );

      const oversizedTag = await runWorkflowScript(script, {
        ...environment,
        MOCK_TAGS: "v0.20.0\nv9007199254740992.0.0",
      });
      expect(oversizedTag.exitCode).not.toBe(0);
      expect(oversizedTag.stderr).toContain(
        "Stable version components exceed Number.MAX_SAFE_INTEGER: v9007199254740992.0.0",
      );

      const oversizedRelease = await runWorkflowScript(script, {
        ...environment,
        MOCK_RELEASES: "v9007199254740992.0.0",
      });
      expect(oversizedRelease.exitCode).not.toBe(0);
      expect(oversizedRelease.stderr).toContain(
        "Stable version components exceed Number.MAX_SAFE_INTEGER: v9007199254740992.0.0",
      );
      expect(await readFile(commandLog, "utf8")).not.toContain("release create");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("canonical GitHub release authority has no npm admission dependency", async () => {
    const workflow = parse(await readFile(releaseWorkflowUrl, "utf8")) as {
      jobs: Record<string, { needs?: unknown; permissions?: unknown; steps: Array<{ name?: string; uses?: string; run?: string }> }>;
    };
    expect(Object.keys(workflow.jobs).sort()).toEqual(["admit_npm", "attest", "authorize", "publish", "publish_npm", "verify"]);
    expect(workflow.jobs.verify?.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.publish?.needs).toEqual(["verify", "attest"]);
    expect(workflow.jobs.publish_npm?.needs).toEqual(["verify", "attest", "publish"]);
    expect(workflow.jobs.admit_npm?.needs).toEqual(["verify", "publish_npm"]);
    expect(workflow.jobs.attest?.steps.some((step) => step.uses?.startsWith("actions/checkout@"))).toBe(false);
    expect(workflow.jobs.publish_npm?.steps.some((step) => step.uses?.startsWith("actions/checkout@"))).toBe(false);
    const canonicalCommands = ["authorize", "verify", "attest", "publish"].flatMap((name) => workflow.jobs[name]?.steps.map((step) => step.run ?? "") ?? []).join("\n");
    expect(canonicalCommands).not.toMatch(/npm (?:view|publish|stage|audit)/u);
    expect(workflow.jobs.verify?.steps.find((step) => step.name === "Check tagged source")?.run).toBe("bun run check");
    expect(workflow.jobs.attest?.steps.findIndex((step) => step.name === "Reauthorize current release attempt")).toBe(0);
  });

  test("provisions exact recovery history and npm in CI", async () => {
    const workflow = await readFile(ciWorkflowUrl, "utf8");
    for (const required of [
      "fetch-depth: 0",
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      'node-version: "24"',
      "package-manager-cache: false",
      'registry-url: "https://registry.npmjs.org"',
      "npm@11.19.0",
      'test "$(npm --version)" = "11.19.0"',
      '[[ "$(node --version)" == v24.* ]]',
    ] as const) expect(workflow).toContain(required);
  });

  test("pins publication to the canonical npm registry", async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
      readonly publishConfig?: unknown;
      readonly tag?: unknown;
    };
    expect(manifest.publishConfig).toEqual({ access: "public", registry: npmRegistry });
    expect(Object.hasOwn(manifest, "tag")).toBe(false);
  });
});

describe("canonical npm package identity", () => {
  test("accepts gzip transport drift and rejects content, mode, and link drift", async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
      readonly name: string;
      readonly version: string;
    };
    const filename = `hraness-wordcell-${manifest.version}.tgz`;
    const work = await mkdtemp(join(tmpdir(), "kb-package-identity-test-"));
    try {
      const sourceDirectory = join(work, "source");
      const registryDirectory = join(work, "registry");
      await mkdir(sourceDirectory);
      await mkdir(registryDirectory);
      const sourceArchive = join(sourceDirectory, filename);
      const registryArchive = join(registryDirectory, filename);
      await run([
        process.execPath,
        "pm",
        "pack",
        "--filename",
        sourceArchive,
        "--ignore-scripts",
        "--quiet",
      ], repository);
      const sourceBytes = await readFile(sourceArchive);
      const transportVariant = Buffer.from(sourceBytes);
      transportVariant[9] = transportVariant[9] === 3 ? 0 : 3;
      expect(transportVariant.equals(sourceBytes)).toBe(false);
      expect(gunzipSync(transportVariant).equals(gunzipSync(sourceBytes))).toBe(true);
      await writeFile(registryArchive, transportVariant);
      const [sourceInventory, registryInventory] = await Promise.all([
        inspectPackageArtifact(sourceArchive),
        inspectPackageArtifact(registryArchive),
      ]);
      const sourcePackJson = join(sourceDirectory, "npm-pack.json");
      const registryPackJson = join(registryDirectory, "npm-pack.json");
      const registryViewJson = join(registryDirectory, "npm-view.json");
      await Promise.all([
        writeFile(sourcePackJson, packJson(sourceBytes, sourceInventory, manifest.name, manifest.version)),
        writeFile(registryPackJson, packJson(
          transportVariant,
          registryInventory,
          manifest.name,
          manifest.version,
          true,
        )),
        writeFile(registryViewJson, registryView(
          transportVariant,
          registryInventory,
          manifest.name,
          manifest.version,
        )),
      ]);
      const validInput = Object.freeze({
        expectedName: manifest.name,
        expectedVersion: manifest.version,
        registryArchive,
        registryPackJson,
        registryViewJson,
        sourceArchive,
        sourcePackJson,
      });
      const verified = await verifyNpmPackageIdentity(validInput);
      expect(verified.fileCount).toBe(sourceInventory.fileCount);
      expect(verified.unpackedBytes).toBe(sourceInventory.unpackedBytes);
      expect(verified.sourceArchiveSha512).not.toBe(verified.registryArchiveSha512);

      const originalTar = gunzipSync(sourceBytes);
      const first = firstRegularHeader(originalTar);
      const modeDirectory = join(work, "mode");
      await mkdir(modeDirectory);
      const modeArchive = join(modeDirectory, filename);
      const modeTar = Buffer.from(originalTar);
      modeTar.write("0000755\0", first.offset + 100, 8, "ascii");
      writeHeaderChecksum(modeTar, first.offset);
      const modeBytes = gzipSync(modeTar, { level: 9 });
      await writeFile(modeArchive, modeBytes);
      const modeInventory = await inspectPackageArtifact(modeArchive);
      const modePackJson = join(modeDirectory, "npm-pack.json");
      const modeViewJson = join(modeDirectory, "npm-view.json");
      await Promise.all([
        writeFile(modePackJson, packJson(modeBytes, modeInventory, manifest.name, manifest.version)),
        writeFile(modeViewJson, registryView(modeBytes, modeInventory, manifest.name, manifest.version)),
      ]);
      await expect(verifyNpmPackageIdentity({
        ...validInput,
        registryArchive: modeArchive,
        registryPackJson: modePackJson,
        registryViewJson: modeViewJson,
      })).rejects.toThrow("Source and registry npm pack file metadata differ");

      const contentDirectory = join(work, "content");
      await mkdir(contentDirectory);
      const contentArchive = join(contentDirectory, filename);
      const contentTar = Buffer.from(originalTar);
      contentTar[first.offset + 512] = (contentTar[first.offset + 512] ?? 0) ^ 0xff;
      const contentBytes = gzipSync(contentTar, { level: 9 });
      await writeFile(contentArchive, contentBytes);
      const contentInventory = await inspectPackageArtifact(contentArchive);
      const contentPackJson = join(contentDirectory, "npm-pack.json");
      const contentViewJson = join(contentDirectory, "npm-view.json");
      await Promise.all([
        writeFile(contentPackJson, packJson(contentBytes, contentInventory, manifest.name, manifest.version)),
        writeFile(contentViewJson, registryView(contentBytes, contentInventory, manifest.name, manifest.version)),
      ]);
      await expect(verifyNpmPackageIdentity({
        ...validInput,
        registryArchive: contentArchive,
        registryPackJson: contentPackJson,
        registryViewJson: contentViewJson,
      })).rejects.toThrow("Source and registry package content differ at canonical entry");

      const linkArchive = join(work, "link", filename);
      await mkdir(join(work, "link"));
      const linkTar = Buffer.from(originalTar);
      linkTar[first.offset + 156] = 50;
      writeHeaderChecksum(linkTar, first.offset);
      await writeFile(linkArchive, gzipSync(linkTar, { level: 9 }));
      await expect(verifyNpmPackageIdentity({
        ...validInput,
        registryArchive: linkArchive,
      })).rejects.toThrow("Unsupported package tar entry type");
    } finally {
      await rm(work, { force: true, recursive: true });
    }
  }, 120_000);

});
