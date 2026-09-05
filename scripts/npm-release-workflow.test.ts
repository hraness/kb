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

const stageWorkflowUrl = new URL("../.github/workflows/npm-stage.yml", import.meta.url);
const releaseWorkflowUrl = new URL("../.github/workflows/release.yml", import.meta.url);
const ciWorkflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);
const manifestUrl = new URL("../package.json", import.meta.url);
const readmeUrl = new URL("../README.md", import.meta.url);
const packageSmokeUrl = new URL("./package-smoke.ts", import.meta.url);
const packagePreparationUrl = new URL("./prepare-npm-package.ts", import.meta.url);
const packageArtifactUrl = new URL("./package-artifact.ts", import.meta.url);
const packageIdentityUrl = new URL("./npm-package-identity.ts", import.meta.url);
const publishingGuideUrl = new URL("../docs/publishing.md", import.meta.url);
const agentGuideUrl = new URL("../AGENTS.md", import.meta.url);
const npmRegistry = "https://registry.npmjs.org";
const repository = fileURLToPath(new URL("../", import.meta.url));
const firstPublicSourceCommit = "58bd07b69dd40ad83bb2e49b5368adac75fb12fc";

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
    filename: `hraness-kb-${version}.tgz`,
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
      tarball: `${npmRegistry}/${name}/-/kb-${version}.tgz`,
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
      version: "0.19.0",
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
      ],
    }));
    const opening = readme.slice(0, 1_500).replace(/\s+/gu, " ").toLowerCase();
    expect(opening).toContain(String(manifest.description).toLowerCase());
    for (const link of [
      "[Install `@hraness/kb` from npm](https://www.npmjs.com/package/@hraness/kb)",
      "[KB source on GitHub](https://github.com/hraness/kb)",
      "[KB overview](https://hraness.com/kb)",
    ]) expect(readme).toContain(link);
  });

  test("keeps the exact terminal OIDC stage independent from repository code", async () => {
    const workflow = await readFile(stageWorkflowUrl, "utf8");
    const selectStart = workflow.indexOf("\n  select:\n");
    const verifyStart = workflow.indexOf("\n  verify:\n");
    const stageStart = workflow.indexOf("\n  stage:\n");
    expect(selectStart).toBeGreaterThan(-1);
    expect(verifyStart).toBeGreaterThan(selectStart);
    expect(stageStart).toBeGreaterThan(verifyStart);
    const selectJob = workflow.slice(selectStart, verifyStart);
    const verifyJob = workflow.slice(verifyStart, stageStart);
    const stageJob = workflow.slice(stageStart);

    for (const required of [
      "name: Select stable package version",
      "permissions:\n      contents: read",
      "should_stage: ${{ steps.selection.outputs.should_stage }}",
      "BEFORE_SHA: ${{ github.event.before }}",
      'expected_ref="refs/heads/$DEFAULT_BRANCH"',
      'git merge-base --is-ancestor "$BEFORE_SHA" "$default_head"',
      'git show "$BEFORE_SHA:package.json"',
      'bun run ./scripts/npm-stage-selection.ts "${selection_args[@]}"',
    ] as const) expect(selectJob).toContain(required);
    expect(selectJob).not.toContain("id-token: write");

    for (const required of [
      "publish_to_npm:",
      "required: false",
      "default: false",
      "type: boolean",
    ] as const) expect(workflow).toContain(required);

    for (const required of [
      "name: Verify exact package",
      "needs: select",
      "if: needs.select.outputs.should_stage == 'true'",
      "permissions:\n      contents: read",
      "source_sha: ${{ steps.identity.outputs.source_sha }}",
      "artifact_name: ${{ steps.artifact.outputs.artifact_name }}",
      "package_version: ${{ steps.artifact.outputs.package_version }}",
      "tarball_name: ${{ steps.artifact.outputs.tarball_name }}",
      "bun install --frozen-lockfile --ignore-scripts",
      "bun run check",
      "scripts/prepare-npm-package.ts",
      "scripts/package-smoke.ts",
      "npm-package.sha256",
      "$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT",
      "Reviewed npm artifact must contain exactly three files",
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    ] as const) expect(verifyJob).toContain(required);
    expect(verifyJob).not.toContain("id-token: write");
    expect(verifyJob).not.toContain("npm stage publish");

    for (const required of [
      "if: inputs.publish_to_npm == true",
      "environment: npm-stage",
      "permissions:\n      actions: read\n      id-token: write",
      "Reauthorize current npm staging attempt",
      'EXPECTED_WORKFLOW_ID: "344070109"',
      'PUBLISH_TO_NPM: ${{ inputs.publish_to_npm }}',
      'REF_PROTECTED: ${{ github.ref_protected }}',
      "attempt.triggering_actor?.id !== actorId",
      "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
      "Downloaded npm artifact must contain exactly the tarball, npm-pack.json, and npm-package.sha256",
      'expected_tarball_name="hraness-kb-$EXPECTED_VERSION.tgz"',
      'const expectedName = "@hraness/kb"',
      "const minimumFiles = 190",
      "const maximumFiles = 210",
      "packageRecord.files.length !== packageRecord.entryCount",
      "unpackedSize !== packageRecord.unpackedSize",
      'createHash("sha1")',
      'createHash("sha512")',
      'createHash("sha256")',
      'git init --quiet --bare "$current_main"',
      '"https://github.com/$GITHUB_REPOSITORY.git"',
      'EXPECTED_VERSION: ${{ needs.verify.outputs.package_version }}',
      'release_tag="v$EXPECTED_VERSION"',
      "git ls-remote --exit-code --refs",
      '"refs/tags/$release_tag" > "$tag_lookup_output"',
      'tag_lookup_status=$?',
      '[[ "$tag_lookup_status" -ne 2 || -s "$tag_lookup_output" ]]',
      "Could not prove that tag $release_tag is still absent from origin",
      'current_archive_sha256="$(sha256sum "$TARBALL"',
      'current_metadata_sha256="$(sha256sum "$METADATA"',
      'current_digest_sha256="$(sha256sum "$DIGEST"',
      'npm stage publish "$TARBALL"',
      "--ignore-scripts",
      "--provenance",
      "--tag latest",
      `--registry=${npmRegistry}`,
    ] as const) expect(stageJob).toContain(required);
    expect(workflow.match(/id-token: write/gu) ?? []).toHaveLength(1);
    expect(stageJob).not.toContain("contents: read");
    expect(stageJob).not.toContain("actions/checkout@");
    expect(stageJob).not.toContain("setup-bun@");
    expect(stageJob).not.toMatch(/\bbun\b/u);
    expect(stageJob).not.toContain("./scripts/");
    expect(stageJob.match(/npm stage publish/gu) ?? []).toHaveLength(1);
    const authorizationIndex = stageJob.indexOf("Reauthorize current npm staging attempt");
    const setupIndex = stageJob.indexOf("actions/setup-node@");
    const fetchIndex = stageJob.lastIndexOf('git --git-dir="$current_main" fetch');
    const tagLookupIndex = stageJob.lastIndexOf("git ls-remote --exit-code --refs");
    const rehashIndex = stageJob.lastIndexOf('current_archive_sha256="$(sha256sum "$TARBALL"');
    const stageIndex = stageJob.indexOf('npm stage publish "$TARBALL"');
    expect(authorizationIndex).toBeGreaterThan(-1);
    expect(authorizationIndex).toBeLessThan(setupIndex);
    expect(fetchIndex).toBeGreaterThan(-1);
    expect(fetchIndex).toBeLessThan(tagLookupIndex);
    expect(tagLookupIndex).toBeLessThan(rehashIndex);
    expect(rehashIndex).toBeLessThan(stageIndex);
    expect(workflow).not.toContain("secrets.NPM_TOKEN");
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
    expect(workflow).not.toMatch(/\bnpm publish\b/u);
    expect(workflow).toContain('branches: [main]\n    paths:\n      - "package.json"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("publish_to_npm:");
  });

  test("the staging job reauthorizes the exact attempt and rejects collaborator reruns", async () => {
    const workflow = await readFile(stageWorkflowUrl, "utf8");
    const stageJob = workflow.slice(workflow.indexOf("\n  stage:\n"));
    const authorizationIndex = stageJob.indexOf("Reauthorize current npm staging attempt");
    const setupIndex = stageJob.indexOf("actions/setup-node@");
    const mutationIndex = stageJob.indexOf('npm stage publish "$TARBALL"');
    expect(stageJob).toContain("permissions:\n      actions: read\n      id-token: write");
    expect(authorizationIndex).toBeGreaterThan(-1);
    expect(authorizationIndex).toBeLessThan(setupIndex);
    expect(setupIndex).toBeLessThan(mutationIndex);

    const script = workflowStepScript(workflow, "Reauthorize current npm staging attempt");
    const directory = await mkdtemp(join(tmpdir(), "kb-stage-attempt-"));
    const binaryDirectory = join(directory, "bin");
    const attemptPath = join(directory, "attempt.json");
    const workflowPath = join(directory, "workflow.json");
    const repositoryPath = join(directory, "repository.json");
    const commandLog = join(directory, "gh.log");
    const sourceSha = "a".repeat(40);
    const attempt = {
      id: 45678,
      run_attempt: 2,
      workflow_id: 344070109,
      name: "Stage npm package",
      path: ".github/workflows/npm-stage.yml",
      event: "workflow_dispatch",
      head_branch: "main",
      head_sha: sourceSha,
      status: "in_progress",
      conclusion: null,
      actor: { id: 894119, type: "User" },
      triggering_actor: { id: 894119, type: "User" },
      repository: {
        id: 1308971873,
        full_name: "hraness/kb",
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
          '  /repos/hraness/kb) cat "$MOCK_REPOSITORY_JSON" ;;',
          '  *) echo "unexpected gh endpoint: $endpoint" >&2; exit 2 ;;',
          "esac",
        ].join("\n"),
      );
      await chmod(join(binaryDirectory, "gh"), 0o755);
      await Promise.all([
        writeFile(attemptPath, JSON.stringify(attempt)),
        writeFile(workflowPath, JSON.stringify({
          id: 344070109,
          name: "Stage npm package",
          path: ".github/workflows/npm-stage.yml",
          state: "active",
        })),
        writeFile(repositoryPath, JSON.stringify({
          id: 1308971873,
          full_name: "hraness/kb",
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
        EXPECTED_REPOSITORY: "hraness/kb",
        EXPECTED_REPOSITORY_ID: "1308971873",
        EXPECTED_SOURCE_SHA: sourceSha,
        EXPECTED_WORKFLOW_ID: "344070109",
        EXPECTED_WORKFLOW_NAME: "Stage npm package",
        EXPECTED_WORKFLOW_PATH: ".github/workflows/npm-stage.yml",
        PUBLISH_TO_NPM: "true",
        REF_PROTECTED: "true",
        GITHUB_RUN_ID: "45678",
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_ACTOR_ID: "894119",
        GITHUB_REPOSITORY: "hraness/kb",
        GITHUB_REPOSITORY_ID: "1308971873",
        GITHUB_REF: "refs/heads/main",
        GITHUB_SHA: sourceSha,
      };
      const admitted = await runWorkflowScript(script, environment);
      expect(admitted.exitCode).toBe(0);
      expect(await readFile(commandLog, "utf8")).toContain(
        "actions/runs/45678/attempts/2",
      );

      await writeFile(attemptPath, JSON.stringify({
        ...attempt,
        triggering_actor: { id: 123456, type: "User" },
      }));
      const hostileRerun = await runWorkflowScript(script, environment);
      expect(hostileRerun.exitCode).not.toBe(0);
      expect(hostileRerun.stderr).toContain(
        "Current npm staging attempt is not owner-authorized",
      );

      await writeFile(attemptPath, JSON.stringify({ ...attempt, head_sha: "b".repeat(40) }));
      const sourceDrift = await runWorkflowScript(script, environment);
      expect(sourceDrift.exitCode).not.toBe(0);
      expect(sourceDrift.stderr).toContain(
        "Current npm staging attempt is not owner-authorized",
      );

      const falseInput = await runWorkflowScript(script, {
        ...environment,
        PUBLISH_TO_NPM: "false",
      });
      expect(falseInput.exitCode).not.toBe(0);
      expect(falseInput.stdout).toContain(
        "Current npm staging attempt is not the explicit owner-authorized protected-main dispatch",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("the source-free staging boundary accepts MAX_SAFE_INTEGER and rejects larger components", async () => {
    const workflow = await readFile(stageWorkflowUrl, "utf8");
    const script = workflowStepScript(workflow, "Bind artifact reference");
    const sourceSha = "a".repeat(40);
    const maximum = "9007199254740991";
    const baseEnvironment = {
      ARTIFACT_NAME: "",
      EXPECTED_SOURCE_SHA: sourceSha,
      EXPECTED_VERSION: "",
      GITHUB_RUN_ATTEMPT: "3",
      GITHUB_RUN_ID: "45678",
    };
    const maximumVersion = `${maximum}.${maximum}.${maximum}`;
    const admitted = await runWorkflowScript(script, {
      ...baseEnvironment,
      ARTIFACT_NAME: `npm-package-${maximumVersion}-${sourceSha}-45678-3`,
      EXPECTED_VERSION: maximumVersion,
    });
    expect(admitted.exitCode).toBe(0);

    for (const unsafeVersion of [
      "9007199254740992.0.0",
      "0.9007199254740992.0",
      "0.0.9007199254740992",
    ]) {
      const rejected = await runWorkflowScript(script, {
        ...baseEnvironment,
        ARTIFACT_NAME: `npm-package-${unsafeVersion}-${sourceSha}-45678-3`,
        EXPECTED_VERSION: unsafeVersion,
      });
      expect(rejected.exitCode).not.toBe(0);
      expect(rejected.stderr).toContain(
        "Verified package version components exceed Number.MAX_SAFE_INTEGER",
      );
    }
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
    const mutationIndex = publishJob.indexOf('gh release create "$VERIFIED_TAG"');
    const npmLatestIndex = publishJob.indexOf('npm view "@hraness/kb" dist-tags.latest');
    expect(publishJob).toContain("permissions:\n      actions: read\n      contents: write");
    expect(authorizationIndex).toBeGreaterThan(-1);
    expect(authorizationIndex).toBeLessThan(liveTagIndex);
    expect(liveTagIndex).toBeLessThan(mutationIndex);
    expect(npmLatestIndex).toBeGreaterThan(liveTagIndex);
    expect(npmLatestIndex).toBeLessThan(mutationIndex);
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
        full_name: "hraness/kb",
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
          '  /repos/hraness/kb) cat "$MOCK_REPOSITORY_JSON" ;;',
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
          full_name: "hraness/kb",
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
        EXPECTED_REPOSITORY: "hraness/kb",
        EXPECTED_REPOSITORY_ID: "1308971873",
        EXPECTED_WORKFLOW_ID: "320004141",
        EXPECTED_WORKFLOW_NAME: "Release",
        EXPECTED_WORKFLOW_PATH: ".github/workflows/release.yml",
        GITHUB_RUN_ID: "67890",
        GITHUB_RUN_ATTEMPT: "3",
        GITHUB_EVENT_NAME: "push",
        GITHUB_REPOSITORY: "hraness/kb",
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
        full_name: "hraness/kb",
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
      await chmod(join(binaryDirectory, "gh"), 0o755);
      const environment = {
        PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
        DEFAULT_BRANCH: "main",
        GH_COMMAND_LOG: commandLog,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/tags/v0.20.0",
        GITHUB_REPOSITORY: "hraness/kb",
        GITHUB_SHA: sourceSha,
        MOCK_RELEASES: "",
        MOCK_SOURCE_SHA: sourceSha,
        MOCK_TAGS: "v0.20.0",
        VERIFIED_SOURCE_SHA: sourceSha,
        VERIFIED_TAG: "v0.20.0",
        WORKFLOW_SHA: sourceSha,
      };

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

  test("gates immutable releases on an owner-created protected stable tag and exact npm delivery", async () => {
    const [workflow, artifact, identity] = await Promise.all([
      readFile(releaseWorkflowUrl, "utf8"),
      readFile(packageArtifactUrl, "utf8"),
      readFile(packageIdentityUrl, "utf8"),
    ]);
    for (const required of [
      'tags:\n      - "v*"\n      - "!v*-beta.*"',
      "Authorize owner release tag",
      'EXPECTED_ACTOR_ID: "894119"',
      'EXPECTED_REPOSITORY_ID: "1308971873"',
      'event.sender?.type !== "User"',
      'event.repository?.visibility !== "public"',
      "REF_PROTECTED: ${{ github.ref_protected }}",
      'release_ref="refs/kb-release-tags/$release_tag"',
      "Release tag must be annotated",
      'git merge-base --is-ancestor "$tag_commit" "$default_head"',
      "Tag $release_tag is not the newest stable tag",
      'git worktree add --detach "$source_tree" "$SOURCE_SHA"',
      'current_prepare="$GITHUB_WORKSPACE/scripts/prepare-npm-package.ts"',
      'current_identity="$GITHUB_WORKSPACE/scripts/npm-package-identity.ts"',
      'current_attestation="$GITHUB_WORKSPACE/scripts/npm-release-attestation.ts"',
      'current_smoke="$GITHUB_WORKSPACE/scripts/package-smoke.ts"',
      'git -C "$GITHUB_WORKSPACE" rev-parse "$WORKFLOW_SHA:$relative_tool"',
      'git hash-object "$current_tool"',
      "bun --no-env-file --config=/dev/null run",
      '--source-pack-json "$source_pack_json"',
      '--registry-pack-json "$registry_pack_json"',
      '--registry-view-json "$registry_view_json"',
      'npm view "$package_spec" name version dist',
      'npm view "$EXPECTED_NAME" dist-tags.latest',
      'npm install "$package_spec"',
      "npm audit signatures",
      "--include-attestations",
      '--expected-source-sha "$EXPECTED_SOURCE_SHA"',
      '--expected-tarball-sha512 "$registry_tarball_sha512"',
      '--registry-latest-json "$registry_latest_json"',
      'npm view "@hraness/kb" dist-tags.latest',
      'current_tag_sha="$(gh api',
      'compare/$VERIFIED_SOURCE_SHA...$current_default_sha',
    ] as const) expect(workflow).toContain(required);
    const auditIndex = workflow.indexOf("npm audit signatures");
    const attestationIndex = workflow.indexOf('bun --no-env-file --config=/dev/null run "$current_attestation"');
    const publishJobIndex = workflow.indexOf("\n  publish:\n");
    const liveLatestIndex = workflow.lastIndexOf('npm view "@hraness/kb" dist-tags.latest');
    const releaseMutationIndex = workflow.indexOf('gh release create "$VERIFIED_TAG"');
    expect(auditIndex).toBeGreaterThan(workflow.indexOf("npm@11.19.0"));
    expect(attestationIndex).toBeGreaterThan(auditIndex);
    expect(attestationIndex).toBeLessThan(publishJobIndex);
    expect(liveLatestIndex).toBeGreaterThan(publishJobIndex);
    expect(liveLatestIndex).toBeLessThan(releaseMutationIndex);
    expect(workflow.match(/Stable version components exceed Number\.MAX_SAFE_INTEGER/gu) ?? [])
      .toHaveLength(3);
    expect(workflow).not.toContain('cmp "$source_archive" "$registry_archive"');
    expect(workflow).not.toContain("bun run ./scripts/prepare-npm-package.ts");
    expect(workflow).not.toContain("bun run ./scripts/package-smoke.ts");
    expect(workflow).not.toMatch(/\bnpm (?:publish|stage publish)\b/u);
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(workflow.match(/contents: write/gu) ?? []).toHaveLength(1);
    for (const required of [
      "contentSha256",
      "contentSha512",
      "Unsupported package tar entry type",
      "Package tar contains data after its zero trailer",
      "maxOutputLength",
      "actual.mode !== file.mode",
      "npm registry metadata differs from the downloaded canonical package",
      "canonicalRegistryTarball",
    ] as const) expect(`${artifact}\n${identity}`).toContain(required);
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

  test("documents the terminal authority and recovery boundary", async () => {
    const [guide, agents] = await Promise.all([
      readFile(publishingGuideUrl, "utf8"),
      readFile(agentGuideUrl, "utf8"),
    ]);
    for (const required of [
      "automatically starts",
      "one-time `0.17.1` bootstrap",
      "Do not reuse the\ninteractive path for a later release",
      "[Stage a later version](#stage-a-later-version)",
      "version is unchanged",
      "exact `npm-stage` environment",
      "disable administrator bypass",
      "allows only `main`",
      "original actor and triggering actor",
      "current attempt",
      "`actions: read` and `id-token: write`",
      "`Number.MAX_SAFE_INTEGER`",
      "`npm audit signatures --json",
      "`dist-tags.latest`",
      "owner ID `307125679`",
      "`--tag latest`",
      "rebinds the release helpers to their reviewed Git blobs",
      "invokes those files by absolute path",
      "`npm pack --ignore-scripts`",
      npmRegistry,
    ] as const) expect(guide).toContain(required);
    const normalizedGuide = guide.replace(/\s+/gu, " ");
    expect(normalizedGuide).toContain(
      "selected branch `main` with type `branch`",
    );
    expect(guide).toMatch(/the only job with\s+OIDC authority/u);
    expect(guide).toMatch(/explicitly opted-in staging job\s+starts after verification/u);
    expect(guide).toMatch(/approve the staged package through npm with two-factor\s+authentication/u);
    expect(guide).toMatch(/checks out no\s+source and runs no\s+repository\s+code/u);
    expect(guide).toMatch(/exactly the tarball,\s+`npm-pack\.json`, and `npm-package\.sha256`/u);
    expect(guide).toMatch(/new bare\s+Git directory/u);
    expect(guide).toMatch(/do not import a\s+script from the tagged tree/u);
    expect(agents).toContain("Trust only `.github/workflows/npm-stage.yml` with `npm stage publish` permission");
    expect(agents).toContain("selected default branch `main`");
    expect(agents).toContain("administrator bypass disabled");
    expect(agents).toContain("public promotion remains human-gated by two-factor authentication");
    expect(agents).toContain("boolean `publish_to_npm=true`");
    expect(agents).toContain("`actions: read` plus `id-token: write`");
    expect(agents).toContain("explicit `--tag latest`");
    expect(agents).toContain("pinned npm `11.19.0`");
    expect(agents).toContain("sole main source commit");
    expect(agents).toContain("The protected tag workflow must bind the actor and event sender");
    expect(agents).toContain("public repository ID `1308971873`");
  });

  test("pins publication to the canonical npm registry", async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
      readonly publishConfig?: unknown;
    };
    expect(manifest.publishConfig).toEqual({ access: "public", registry: npmRegistry });
  });
});

describe("canonical npm package identity", () => {
  test("accepts gzip transport drift and rejects content, mode, and link drift", async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
      readonly name: string;
      readonly version: string;
    };
    const filename = `hraness-kb-${manifest.version}.tgz`;
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
      expect(verified.fileCount).toBe(204);
      expect(verified.unpackedBytes).toBe(4_980_722);
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

  test("current tools recover exact v0.17.1 source without historical helpers", async () => {
    const work = await mkdtemp(join(tmpdir(), "kb-release-recovery-test-"));
    try {
      const sourceArchive = join(work, "v0.17.1-source.tar");
      const sourceTree = join(work, "source");
      const packageOutput = join(work, "package");
      await mkdir(sourceTree);
      await run(["git", "cat-file", "-e", `${firstPublicSourceCommit}^{commit}`], repository);
      await run([
        "git",
        "archive",
        "--format=tar",
        `--output=${sourceArchive}`,
        firstPublicSourceCommit,
      ], repository);
      await run(["tar", "-xf", sourceArchive, "-C", sourceTree], repository);
      const manifest = JSON.parse(await readFile(join(sourceTree, "package.json"), "utf8")) as {
        readonly name?: unknown;
        readonly scripts?: Readonly<Record<string, unknown>>;
        readonly version?: unknown;
      };
      expect(manifest.name).toBe("@hraness/kb");
      expect(manifest.version).toBe("0.17.1");
      expect(manifest.scripts?.prepack).toBe("bun run check");
      await rm(join(sourceTree, "scripts"), { recursive: true });
      expect(await readdir(sourceTree)).not.toContain("node_modules");
      await run([
        process.execPath,
        "--no-env-file",
        "--config=/dev/null",
        "run",
        fileURLToPath(packagePreparationUrl),
        packageOutput,
      ], sourceTree);
      const filename = "hraness-kb-0.17.1.tgz";
      expect(new Set(await readdir(packageOutput))).toEqual(new Set([filename, "npm-pack.json"]));
      const inventory = await inspectPackageArtifact(join(packageOutput, filename));
      expect(inventory.fileCount).toBe(200);
      expect(inventory.unpackedBytes).toBe(4_860_250);
      await run([
        process.execPath,
        "--no-env-file",
        "--config=/dev/null",
        "run",
        fileURLToPath(packageSmokeUrl),
        "--archive",
        join(packageOutput, filename),
        "--pack-json",
        join(packageOutput, "npm-pack.json"),
      ], sourceTree);
      const finalSourceEntries = await readdir(sourceTree);
      expect(finalSourceEntries).not.toContain("scripts");
      expect(finalSourceEntries).not.toContain("node_modules");
    } finally {
      await rm(work, { force: true, recursive: true });
    }
  }, 300_000);
});
