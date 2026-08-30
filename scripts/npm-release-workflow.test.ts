import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  inspectPackageArtifact,
  type PackageArtifactInventory,
} from "./package-artifact.js";
import { verifyNpmPackageIdentity } from "./npm-package-identity.js";

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
      version: "0.18.0",
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
      "environment: npm-stage",
      "permissions:\n      id-token: write",
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
      `--registry=${npmRegistry}`,
    ] as const) expect(stageJob).toContain(required);
    expect(workflow.match(/id-token: write/gu) ?? []).toHaveLength(1);
    expect(stageJob).not.toContain("contents: read");
    expect(stageJob).not.toContain("actions/checkout@");
    expect(stageJob).not.toContain("setup-bun@");
    expect(stageJob).not.toMatch(/\bbun\b/u);
    expect(stageJob).not.toContain("./scripts/");
    expect(stageJob.match(/npm stage publish/gu) ?? []).toHaveLength(1);
    const fetchIndex = stageJob.lastIndexOf('git --git-dir="$current_main" fetch');
    const tagLookupIndex = stageJob.lastIndexOf("git ls-remote --exit-code --refs");
    const rehashIndex = stageJob.lastIndexOf('current_archive_sha256="$(sha256sum "$TARBALL"');
    const stageIndex = stageJob.indexOf('npm stage publish "$TARBALL"');
    expect(fetchIndex).toBeGreaterThan(-1);
    expect(fetchIndex).toBeLessThan(tagLookupIndex);
    expect(tagLookupIndex).toBeLessThan(rehashIndex);
    expect(rehashIndex).toBeLessThan(stageIndex);
    expect(workflow).not.toContain("secrets.NPM_TOKEN");
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
    expect(workflow).not.toMatch(/\bnpm publish\b/u);
    expect(workflow).toContain('branches: [main]\n    paths:\n      - "package.json"');
    expect(workflow).toContain("workflow_dispatch:");
  });

  test("gates immutable releases on canonical content and current-main recovery", async () => {
    const [workflow, artifact, identity] = await Promise.all([
      readFile(releaseWorkflowUrl, "utf8"),
      readFile(packageArtifactUrl, "utf8"),
      readFile(packageIdentityUrl, "utf8"),
    ]);
    for (const required of [
      "workflow_dispatch:",
      "Existing stable tag to recover after npm delivery succeeded",
      "RECOVERY_TAG: ${{ inputs.tag }}",
      "Recovery must run from current $DEFAULT_BRANCH head",
      'release_ref="refs/kb-release-tags/$release_tag"',
      'git merge-base --is-ancestor "$tag_commit" "$default_head"',
      "Tag $release_tag is not the newest stable tag",
      'git worktree add --detach "$source_tree" "$SOURCE_SHA"',
      'current_prepare="$GITHUB_WORKSPACE/scripts/prepare-npm-package.ts"',
      'current_identity="$GITHUB_WORKSPACE/scripts/npm-package-identity.ts"',
      'current_smoke="$GITHUB_WORKSPACE/scripts/package-smoke.ts"',
      'git -C "$GITHUB_WORKSPACE" rev-parse "$WORKFLOW_SHA:$relative_tool"',
      'git hash-object "$current_tool"',
      "bun --no-env-file --config=/dev/null run",
      '--source-pack-json "$source_pack_json"',
      '--registry-pack-json "$registry_pack_json"',
      '--registry-view-json "$registry_view_json"',
      'npm view "$package_spec" name version dist',
      'current_tag_sha="$(gh api',
      'compare/$VERIFIED_SOURCE_SHA...$current_default_sha',
      '"$EVENT_MODE" == recovery && "$current_default_sha" != "$WORKFLOW_SHA"',
    ] as const) expect(workflow).toContain(required);
    expect(workflow).not.toContain('cmp "$source_archive" "$registry_archive"');
    expect(workflow).not.toContain("bun run ./scripts/prepare-npm-package.ts");
    expect(workflow).not.toContain("bun run ./scripts/package-smoke.ts");
    expect(workflow).not.toMatch(/\bnpm (?:publish|stage publish)\b/u);
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
      "configure no required deployment reviewers",
      "allows only `main`",
      "rebinds the release helpers to their reviewed Git blobs",
      "invokes those files by absolute path",
      "`npm pack --ignore-scripts`",
      npmRegistry,
    ] as const) expect(guide).toContain(required);
    expect(guide).toMatch(/the only job with\s+OIDC authority/u);
    expect(guide).toMatch(/has no required reviewers, so the job starts automatically/u);
    expect(guide).toMatch(/approve the staged package through npm with two-factor\s+authentication/u);
    expect(guide).toMatch(/checks out no source and runs no\s+repository\s+code/u);
    expect(guide).toMatch(/exactly the tarball,\s+`npm-pack\.json`, and `npm-package\.sha256`/u);
    expect(guide).toMatch(/new bare\s+Git directory/u);
    expect(guide).toMatch(/do not import a\s+script from the tagged tree/u);
    expect(agents).toContain("only its minimal dependent staging job may request OIDC");
    expect(agents).toContain("use the exact `npm-stage` environment");
    expect(agents).toContain("restrict deployments to `main` without required deployment reviewers");
    expect(agents).toContain("approve its promotion with human 2FA");
    expect(agents).toContain("bind the current workflow helpers to reviewed Git blobs");
    expect(agents).toContain("recovery never depends on or reruns a historical `prepack`");
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
      expect(verified.fileCount).toBe(201);
      expect(verified.unpackedBytes).toBe(4_895_276);
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
