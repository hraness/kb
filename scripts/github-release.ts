import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "hraness/kb";
const repositoryId = 1308971873;
const packageName = "@hraness/kb";
const maximumFileBytes = 128 * 1024 * 1024;
const metadataNames = ["npm-pack.json", "release-manifest.json", "SHA256SUMS"];

export type ReleaseManifest = Readonly<{
  schema: "hraness-github-release-v1";
  repository: "hraness/kb";
  repositoryId: 1308971873;
  package: "@hraness/kb";
  version: string;
  tag: string;
  sourceSha: string;
  workflow: ".github/workflows/release.yml";
  workflowSha: string;
  runId: number;
  runAttempt: number;
  archive: Readonly<{ name: string; bytes: number; sha256: string; sha512: string }>;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has missing or unexpected fields`);
  }
}

export function stableVersion(value: unknown): string {
  if (typeof value !== "string") throw new Error("Release version must be a string");
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(value);
  if (match === null || match[0] !== value || match.slice(1).some((part) => BigInt(part) > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new Error("Release version must have canonical safe stable components");
  }
  return value;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value as number;
}

function exactHex(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length === length && /^[a-f0-9]+$/u.test(value);
}

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  const manifest = record(value, "Release manifest");
  exactKeys(manifest, ["schema", "repository", "repositoryId", "package", "version", "tag", "sourceSha", "workflow", "workflowSha", "runId", "runAttempt", "archive"], "Release manifest");
  const version = stableVersion(manifest.version);
  const archive = record(manifest.archive, "Release archive");
  exactKeys(archive, ["name", "bytes", "sha256", "sha512"], "Release archive");
  if (
    manifest.schema !== "hraness-github-release-v1" || manifest.repository !== repository
    || manifest.repositoryId !== repositoryId || manifest.package !== packageName
    || manifest.tag !== `v${version}` || manifest.workflow !== ".github/workflows/release.yml"
    || !exactHex(manifest.sourceSha, 40)
    || !exactHex(manifest.workflowSha, 40)
    || archive.name !== `hraness-kb-${version}.tgz`
    || !exactHex(archive.sha256, 64)
    || !exactHex(archive.sha512, 128)
  ) throw new Error("Release manifest does not identify the canonical KB artifact");
  positive(manifest.runId, "Release run ID");
  positive(manifest.runAttempt, "Release run attempt");
  if (positive(archive.bytes, "Archive bytes") > maximumFileBytes) throw new Error("Release archive exceeds byte budget");
  return manifest as ReleaseManifest;
}

function hash(bytes: Uint8Array, algorithm = "sha256"): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

async function boundedFile(path: string, maximum = maximumFileBytes): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximum) {
    throw new Error(`Release file is not a bounded regular file: ${basename(path)}`);
  }
  const bytes = await readFile(path);
  if (bytes.length !== stat.size) throw new Error("Release file changed during inspection");
  return bytes;
}

export async function verifyReleaseFiles(directory: string, includeProvenance = true): Promise<ReleaseManifest> {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Release directory is unsafe");
  const manifest = parseReleaseManifest(JSON.parse((await boundedFile(join(directory, "release-manifest.json"), 16_384)).toString("utf8")) as unknown);
  const expected = [manifest.archive.name, ...metadataNames, ...(includeProvenance ? ["provenance.jsonl"] : [])].sort();
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(expected)) {
    throw new Error("Release directory has missing or unexpected files");
  }
  const bytes = new Map<string, Buffer>();
  for (const name of expected) bytes.set(name, await boundedFile(join(directory, name)));
  const archive = bytes.get(manifest.archive.name)!;
  if (archive.length !== manifest.archive.bytes || hash(archive) !== manifest.archive.sha256 || hash(archive, "sha512") !== manifest.archive.sha512) {
    throw new Error("Release archive differs from the exact manifest bytes");
  }
  const packValue = JSON.parse(bytes.get("npm-pack.json")!.toString("utf8")) as unknown;
  if (!Array.isArray(packValue) || packValue.length !== 1) throw new Error("Release pack receipt must contain exactly one package");
  const pack = record(packValue[0], "Release pack receipt");
  if (pack.name !== packageName || pack.version !== manifest.version || pack.filename !== manifest.archive.name
    || pack.size !== archive.length || pack.integrity !== `sha512-${createHash("sha512").update(archive).digest("base64")}`
    || pack.shasum !== hash(archive, "sha1")) throw new Error("Release pack receipt does not bind the canonical archive");
  const checksumNames = [manifest.archive.name, "npm-pack.json", "release-manifest.json"];
  const expectedChecksums = checksumNames.map((name) => `${hash(bytes.get(name)!)}  ${name}\n`).join("");
  if (bytes.get("SHA256SUMS")!.toString("utf8") !== expectedChecksums) throw new Error("Release checksums do not bind the exact artifact and identity");
  return manifest;
}

export function releaseBody(manifest: ReleaseManifest): string {
  return `Canonical GitHub release for ${packageName}@${manifest.version}.\n\nSource commit: ${manifest.sourceSha}\nWorkflow run: ${manifest.runId}\nWorkflow attempt: ${manifest.runAttempt}\nArchive SHA-256: ${manifest.archive.sha256}`;
}

export type AssetIdentity = Readonly<{ name: string; bytes: number; sha256: string }>;

function exactAssetBrowserUrl(value: unknown, name: string, tag: string, draft: boolean): boolean {
  const prefix = `https://github.com/${repository}/releases/download/`;
  if (value === `${prefix}${tag}/${name}`) return true;
  if (!draft || typeof value !== "string" || !value.startsWith(`${prefix}untagged-`)
    || !value.endsWith(`/${name}`)) return false;
  const temporaryId = value.slice(`${prefix}untagged-`.length, -(`/${name}`.length));
  return /^[a-f0-9]{20}$/u.test(temporaryId);
}

export function verifyProviderRelease(value: unknown, manifest: ReleaseManifest, assets: readonly AssetIdentity[], allowDraft: boolean): readonly string[] {
  const release = record(value, "GitHub Release");
  const author = record(release.author, "Release author");
  if (release.tag_name !== manifest.tag || release.target_commitish !== manifest.sourceSha || release.name !== `KB ${manifest.tag}` || release.body !== releaseBody(manifest)
    || release.prerelease !== false || (!allowDraft && (release.draft !== false || release.immutable !== true))
    || (allowDraft && release.draft !== true && (release.draft !== false || release.immutable !== true))
    || (release.draft === true && release.immutable !== false)
    || author.id !== 41898282 || author.login !== "github-actions[bot]" || author.type !== "Bot"
    || !Array.isArray(release.assets)) throw new Error("GitHub Release is not the exact Actions-authored artifact; reconcile the original run before retrying");
  positive(release.id, "Release ID");
  const present = new Set<string>();
  const assetIds = new Set<number>();
  for (const item of release.assets) {
    const asset = record(item, "GitHub asset");
    const expected = assets.find((candidate) => candidate.name === asset.name);
    if (expected === undefined || present.has(expected.name) || asset.size !== expected.bytes
      || asset.digest !== `sha256:${expected.sha256}` || asset.state !== "uploaded"
      || !exactAssetBrowserUrl(asset.browser_download_url, expected.name, manifest.tag, release.draft === true)
      || asset.url !== `https://api.github.com/repos/${repository}/releases/assets/${String(asset.id)}`) {
      throw new Error("GitHub release has an unexpected, duplicate, or mismatched asset");
    }
    const id = positive(asset.id, "Release asset ID");
    if (assetIds.has(id)) throw new Error("GitHub release repeats an asset ID");
    assetIds.add(id);
    present.add(expected.name);
  }
  const missing = assets.filter((asset) => !present.has(asset.name)).map((asset) => asset.name);
  if (release.draft === false && missing.length !== 0) throw new Error("Published release is missing canonical assets");
  return missing;
}

function command(program: string, args: readonly string[]): string {
  return execFileSync(program, [...args], { encoding: "utf8", timeout: 90_000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function binaryAsset(id: number, expectedBytes: number): Buffer {
  return execFileSync("gh", ["api", "--method", "GET", `/repos/${repository}/releases/assets/${id}`,
    "-H", "Accept: application/octet-stream"], {
    timeout: 90_000, maxBuffer: expectedBytes + 1, stdio: ["ignore", "pipe", "pipe"],
  });
}

function api(path: string): unknown {
  return JSON.parse(command("gh", ["api", "--method", "GET", path])) as unknown;
}

export function verifyAttestationRun(value: unknown, manifest: ReleaseManifest, subjects: readonly AssetIdentity[]): void {
  if (!Array.isArray(value) || value.length === 0) throw new Error("No verified GitHub attestations returned");
  const names = [manifest.archive.name, ...metadataNames].sort();
  if (subjects.length !== 4 || JSON.stringify(subjects.map((subject) => subject.name).sort()) !== JSON.stringify(names)) throw new Error("Expected exactly four canonical attestation subjects");
  const invocation = `https://github.com/${repository}/actions/runs/${manifest.runId}/attempts/${manifest.runAttempt}`;
  if (!value.some((item: unknown) => {
    const result = record(item, "Verified attestation");
    const verification = record(result.verificationResult, "Attestation verification result");
    const signature = record(verification.signature, "Verified signature");
    const certificate = record(signature.certificate, "Verified signing certificate");
    const workflowUri = `https://github.com/${repository}/${manifest.workflow}@refs/tags/${manifest.tag}`;
    if (certificate.runInvocationURI !== invocation
      || certificate.issuer !== "https://token.actions.githubusercontent.com"
      || certificate.sourceRepositoryIdentifier !== String(repositoryId)
      || certificate.sourceRepositoryOwnerIdentifier !== "307125679"
      || certificate.sourceRepositoryOwnerURI !== "https://github.com/hraness"
      || certificate.sourceRepositoryURI !== `https://github.com/${repository}`
      || certificate.sourceRepositoryDigest !== manifest.sourceSha
      || certificate.sourceRepositoryRef !== `refs/tags/${manifest.tag}`
      || certificate.buildSignerDigest !== manifest.sourceSha || certificate.buildConfigDigest !== manifest.sourceSha
      || certificate.buildSignerURI !== workflowUri || certificate.buildConfigURI !== workflowUri
      || certificate.runnerEnvironment !== "github-hosted" || certificate.buildTrigger !== "push"
      || certificate.sourceRepositoryVisibilityAtSigning !== "public") return false;
    if (!Array.isArray(verification.verifiedTimestamps) || verification.verifiedTimestamps.length === 0) return false;
    const statement = record(verification.statement, "Verified attestation statement");
    if (statement._type !== "https://in-toto.io/Statement/v1" || statement.predicateType !== "https://slsa.dev/provenance/v1"
      || !Array.isArray(statement.subject) || statement.subject.length !== 4) return false;
    const found = new Set<string>();
    return statement.subject.every((candidate: unknown) => {
      const item = record(candidate, "Verified subject");
      const digest = record(item.digest, "Verified subject digest");
      const expected = subjects.find((subject) => subject.name === item.name);
      if (expected === undefined || found.has(expected.name) || digest.sha256 !== expected.sha256 || Object.keys(digest).length !== 1) return false;
      found.add(expected.name);
      return true;
    });
  })) throw new Error("Verified GitHub attestation does not bind the release run and attempt");
}

export function verifyAttestations(directory: string, manifest: ReleaseManifest): void {
  const subjects = [manifest.archive.name, ...metadataNames].map((name) => {
    const bytes = readFileSync(join(directory, name));
    return { name, bytes: bytes.length, sha256: hash(bytes) };
  });
  for (const name of [manifest.archive.name, ...metadataNames]) {
    const result = JSON.parse(command("gh", ["attestation", "verify", join(directory, name),
      "--repo", repository, "--signer-workflow", `${repository}/.github/workflows/release.yml`,
      "--signer-digest", manifest.sourceSha, "--source-digest", manifest.sourceSha,
      "--source-ref", `refs/tags/${manifest.tag}`, "--deny-self-hosted-runners",
      "--bundle", join(directory, "provenance.jsonl"), "--format", "json"])) as unknown;
    verifyAttestationRun(result, manifest, subjects);
  }
}

export function verifyCanonicalRun(value: unknown, manifest: ReleaseManifest): void {
  const run = record(value, "Canonical release run");
  const owner = record(run.actor, "Canonical release actor");
  const triggering = record(run.triggering_actor, "Canonical triggering actor");
  const source = record(run.repository, "Canonical run repository");
  if (run.id !== manifest.runId || run.run_attempt !== manifest.runAttempt
    || run.workflow_id !== 320004141 || run.name !== "Release" || run.path !== manifest.workflow
    || run.status !== "completed" || run.conclusion !== "success" || run.event !== "push"
    || run.head_branch !== manifest.tag || run.head_sha !== manifest.sourceSha
    || owner.id !== 894119 || owner.type !== "User" || triggering.id !== 894119 || triggering.type !== "User"
    || source.id !== repositoryId || source.full_name !== repository || source.private !== false) {
    throw new Error("Canonical release does not have the exact completed successful source and publication gate");
  }
}

async function assetIdentities(directory: string): Promise<readonly AssetIdentity[]> {
  return Promise.all((await readdir(directory)).sort().map(async (name) => {
    const bytes = await boundedFile(join(directory, name));
    return { name, bytes: bytes.length, sha256: hash(bytes) };
  }));
}

async function prepare(directory: string): Promise<void> {
  const version = stableVersion(process.env.RELEASE_VERSION);
  const archiveName = `hraness-kb-${version}.tgz`;
  const archive = await boundedFile(join(directory, archiveName));
  const manifest = parseReleaseManifest({
    schema: "hraness-github-release-v1", repository, repositoryId, package: packageName,
    version, tag: `v${version}`, sourceSha: process.env.VERIFIED_SOURCE_SHA,
    workflow: ".github/workflows/release.yml", workflowSha: process.env.WORKFLOW_SHA,
    runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    archive: { name: archiveName, bytes: archive.length, sha256: hash(archive), sha512: hash(archive, "sha512") },
  });
  await writeFile(join(directory, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  const sums: string[] = [];
  for (const name of [archiveName, "npm-pack.json", "release-manifest.json"]) {
    sums.push(`${hash(await boundedFile(join(directory, name)))}  ${name}\n`);
  }
  await writeFile(join(directory, "SHA256SUMS"), sums.join(""), { flag: "wx" });
  await verifyReleaseFiles(directory, false);
}

function verifyCurrentControls(manifest: ReleaseManifest): void {
  const ref = record(api(`/repos/${repository}/git/ref/heads/main`), "Current main ref");
  const object = record(ref.object, "Current main object");
  if (object.type !== "commit" || !exactHex(object.sha, 40)) throw new Error("Current main identity is malformed");
  command("git", ["fetch", "--no-tags", "--force", "origin", "refs/heads/main:refs/remotes/kb-release-current/main"]);
  const current = command("git", ["rev-parse", "refs/remotes/kb-release-current/main"]);
  if (current !== object.sha) throw new Error("Current main moved during release authorization");
  command("git", ["merge-base", "--is-ancestor", manifest.sourceSha, current]);
  command("git", ["merge-base", "--is-ancestor", manifest.workflowSha, current]);
  const controls = [".github/workflows/release.yml", "scripts/github-release.ts", "scripts/package-artifact.ts", "scripts/npm-package-identity.ts", "scripts/package-smoke.ts", "scripts/prepare-npm-package.ts"];
  for (const authority of [manifest.sourceSha, manifest.workflowSha]) {
    command("git", ["diff", "--quiet", "--no-ext-diff", "--no-textconv", authority, current, "--", ...controls]);
  }
  const tagRef = record(api(`/repos/${repository}/git/ref/tags/${manifest.tag}`), "Current release tag");
  const tagObject = record(tagRef.object, "Current annotated tag");
  if (tagObject.type !== "tag" || !exactHex(tagObject.sha, 40)) throw new Error("Release tag is no longer annotated");
  const tag = record(api(`/repos/${repository}/git/tags/${tagObject.sha}`), "Current tag identity");
  const source = record(tag.object, "Current tag source");
  if (source.type !== "commit" || source.sha !== manifest.sourceSha || tag.tag !== manifest.tag) throw new Error("Release tag changed after verification");
}

export function uniqueReleaseId(pages: unknown, tag: string): number | undefined {
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 1_000) {
    throw new Error("Authenticated release inventory is malformed or exceeds its bound");
  }
  const identities = new Set<number>();
  const matches: number[] = [];
  for (const page of pages) {
    if (!Array.isArray(page) || page.length > 100) throw new Error("Authenticated release page is malformed");
    for (const value of page) {
      const release = record(value, "Listed release");
      const id = positive(release.id, "Listed release ID");
      if (identities.has(id)) throw new Error("Authenticated release inventory repeats an ID");
      identities.add(id);
      if (typeof release.tag_name !== "string") throw new Error("Listed release tag is malformed");
      if (release.tag_name === tag) matches.push(id);
    }
  }
  if (matches.length > 1) throw new Error("Multiple GitHub releases claim the exact tag");
  return matches[0];
}

export function publishVerifiedRelease(
  directory: string,
  manifest: ReleaseManifest,
  assets: readonly AssetIdentity[],
  run: (program: string, args: readonly string[]) => string = command,
  authorize: () => void = () => verifyCurrentControls(manifest),
  download: (id: number, expectedBytes: number) => Uint8Array = binaryAsset,
): void {
  const read = (path: string): unknown => JSON.parse(run("gh", ["api", "--method", "GET", path])) as unknown;
  const discover = (): number | undefined => uniqueReleaseId(JSON.parse(run("gh", [
    "api", "--method", "GET", `/repos/${repository}/releases?per_page=100`, "--paginate", "--slurp",
  ])) as unknown, manifest.tag);
  // GitHub's by-tag endpoint can return 404 for an existing draft. Enumerate
  // authenticated releases and retain one exact ID throughout its lifecycle.
  let releaseId = discover();
  if (releaseId === undefined) {
    authorize();
    const response = run("gh", ["api", "--method", "POST", `/repos/${repository}/releases`, "--include",
      "-f", `tag_name=${manifest.tag}`, "-f", `target_commitish=${manifest.sourceSha}`,
      "-f", `name=KB ${manifest.tag}`, "-f", `body=${releaseBody(manifest)}`,
      "-F", "draft=true", "-F", "prerelease=false", "-f", "make_latest=false"]);
    const separator = response.search(/\r?\n\r?\n/u);
    if (!/^HTTP\/(?:1\.1|2(?:\.0)?) 201(?: [^\r\n]*)?\r?\n/u.test(response) || separator < 0) {
      throw new Error("Draft creation did not return an exact 201 receipt; reconcile provider state before retrying");
    }
    const created = record(JSON.parse(response.slice(separator).trim()) as unknown, "Created draft");
    if (created.draft !== true || verifyProviderRelease(created, manifest, assets, true).length !== assets.length) {
      throw new Error("Created draft response is not the exact empty draft");
    }
    // The list response may omit a successful creation. Its exact 201
    // response owns the new ID; never rediscover or create again in this run.
    releaseId = positive(created.id, "Created draft ID");
  }
  const releasePath = `/repos/${repository}/releases/${releaseId}`;
  const readExact = (): unknown => {
    const release = record(read(releasePath), "Exact release");
    if (release.id !== releaseId) throw new Error("Release ID changed during publication");
    return release;
  };
  const verifyRemoteBytes = (value: unknown): void => {
    const release = record(value, "Complete release");
    if (!Array.isArray(release.assets) || release.assets.length !== assets.length) throw new Error("Remote asset inventory is incomplete");
    for (const value of release.assets) {
      const asset = record(value, "Remote asset");
      const expected = assets.find((candidate) => candidate.name === asset.name);
      if (expected === undefined || expected.bytes <= 0 || expected.bytes > maximumFileBytes) throw new Error("Remote asset exceeds its admitted byte bound");
      const bytes = download(positive(asset.id, "Remote asset ID"), expected.bytes);
      if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) throw new Error("Downloaded release asset differs from the admitted canonical bytes");
    }
  };
  let release = readExact();
  let missing = verifyProviderRelease(release, manifest, assets, true);
  for (const name of missing) {
    authorize();
    run("gh", ["api", "--method", "POST", `https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
      "--input", join(directory, name), "-H", "Content-Type: application/octet-stream",
      "-H", `Content-Length: ${assets.find((asset) => asset.name === name)!.bytes}`]);
    release = readExact();
    missing = verifyProviderRelease(release, manifest, assets, true);
  }
  if (missing.length !== 0) throw new Error("Draft release is missing canonical assets");
  release = readExact();
  if (verifyProviderRelease(release, manifest, assets, true).length !== 0) throw new Error("Draft release became incomplete before publication");
  if (record(release, "Release").draft === true) {
    verifyRemoteBytes(release);
    authorize();
    run("gh", ["api", "--method", "PATCH", releasePath, "-F", "draft=false", "-f", "make_latest=true"]);
  }
  release = readExact();
  verifyProviderRelease(release, manifest, assets, false);
  verifyRemoteBytes(release);
  const published = record(read(`/repos/${repository}/releases/tags/${manifest.tag}`), "Published release");
  if (published.id !== releaseId) throw new Error("Published tag resolves to another release ID");
  verifyProviderRelease(published, manifest, assets, false);
  const latest = record(read(`/repos/${repository}/releases/latest`), "Latest release");
  if (latest.id !== releaseId || latest.tag_name !== manifest.tag) throw new Error("Canonical release is not GitHub Latest");
}

async function publish(directory: string): Promise<void> {
  const manifest = await verifyReleaseFiles(directory);
  if (manifest.sourceSha !== process.env.VERIFIED_SOURCE_SHA || manifest.workflowSha !== process.env.WORKFLOW_SHA
    || manifest.tag !== process.env.VERIFIED_TAG || String(manifest.runId) !== process.env.GITHUB_RUN_ID
    || String(manifest.runAttempt) !== process.env.GITHUB_RUN_ATTEMPT) throw new Error("Release handoff differs from the authorized run outputs");
  verifyAttestations(directory, manifest);
  publishVerifiedRelease(directory, manifest, await assetIdentities(directory));
}

async function download(directory: string, version: string): Promise<void> {
  const tag = `v${stableVersion(version)}`;
  await mkdir(directory, { recursive: false });
  const expected = [`hraness-kb-${version}.tgz`, ...metadataNames, "provenance.jsonl"];
  for (const name of expected) command("gh", ["release", "download", tag, "--repo", repository, "--dir", directory, "--pattern", name]);
  const manifest = await verifyReleaseFiles(directory);
  if (manifest.version !== version || manifest.sourceSha !== process.env.VERIFIED_SOURCE_SHA) throw new Error("Canonical GitHub source differs from the reviewed mirror source");
  verifyAttestations(directory, manifest);
  verifyProviderRelease(api(`/repos/${repository}/releases/tags/${tag}`), manifest, await assetIdentities(directory), false);
  verifyCanonicalRun(api(`/repos/${repository}/actions/runs/${manifest.runId}/attempts/${manifest.runAttempt}`), manifest);
  const ref = record(api(`/repos/${repository}/git/ref/tags/${tag}`), "Canonical tag");
  const object = record(ref.object, "Annotated tag object");
  if (object.type !== "tag" || !exactHex(object.sha, 40)) throw new Error("Canonical release tag is not annotated");
  const tagged = record(api(`/repos/${repository}/git/tags/${object.sha}`), "Annotated tag");
  const source = record(tagged.object, "Tagged source");
  if (source.type !== "commit" || source.sha !== manifest.sourceSha || tagged.tag !== tag) throw new Error("Canonical tag does not bind its attested source");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, directory, version] = process.argv.slice(2);
  if (directory === undefined) throw new Error("Usage: node scripts/github-release.ts prepare|verify|publish|download <directory> [version]");
  if (mode === "prepare" && version === undefined) await prepare(resolve(directory));
  else if (mode === "verify" && version === undefined) { const manifest = await verifyReleaseFiles(resolve(directory)); verifyAttestations(resolve(directory), manifest); }
  else if (mode === "publish" && version === undefined) await publish(resolve(directory));
  else if (mode === "download" && version !== undefined) await download(resolve(directory), version);
  else throw new Error("Unsupported GitHub release command");
}
