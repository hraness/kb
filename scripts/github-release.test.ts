import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";

import { parseReleaseManifest, releaseBody, stableVersion, verifyAttestationRun, verifyCanonicalRun, verifyProviderRelease, verifyReleaseFiles, type ReleaseManifest } from "./github-release.js";

const archive = Buffer.from("Synthetic packed-byte identity fixture; real USTAR admission is covered by package-artifact tests.");
const digest = (bytes: Uint8Array, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const manifest: ReleaseManifest = {
  schema: "hraness-github-release-v1", repository: "hraness/kb", repositoryId: 1308971873,
  package: "@hraness/kb", version: "0.19.3", tag: "v0.19.3", sourceSha: "a".repeat(40),
  workflow: ".github/workflows/release.yml", workflowSha: "b".repeat(40), runId: 123, runAttempt: 2,
  archive: { name: "hraness-kb-0.19.3.tgz", bytes: archive.length, sha256: digest(archive), sha512: digest(archive, "sha512") },
};

test("manifest admits only exact bounded package, source, and run identity", () => {
  expect(parseReleaseManifest(manifest)).toEqual(manifest);
  for (const change of [{ repository: "other/kb" }, { repositoryId: 1 }, { package: "@hraness/other" }, { tag: "v0.19.2" }, { sourceSha: "main" }, { runId: 0 }, { runAttempt: Number.MAX_SAFE_INTEGER + 1 }, { extra: true }, { archive: { ...manifest.archive, name: "../payload.tgz" } }]) {
    expect(() => parseReleaseManifest({ ...manifest, ...change })).toThrow();
  }
  fc.assert(fc.property(fc.tuple(fc.nat(), fc.nat(), fc.nat()), (parts) => {
    const value = parts.join(".");
    expect(stableVersion(value)).toBe(value);
    expect(() => stableVersion(`0${value}`)).toThrow();
    expect(() => stableVersion(`${value}-beta.1`)).toThrow();
  }), { numRuns: 60 });
  expect(() => stableVersion("9007199254740992.0.0")).toThrow();
  expect(() => stableVersion("0.19.3\n")).toThrow();
  for (const change of [
    { sourceSha: `${manifest.sourceSha}\n` }, { workflowSha: `${manifest.workflowSha}\n` },
    { archive: { ...manifest.archive, sha256: `${manifest.archive.sha256}\n` } },
    { archive: { ...manifest.archive, sha512: `${manifest.archive.sha512}\n` } },
  ]) expect(() => parseReleaseManifest({ ...manifest, ...change })).toThrow();
});

test("artifact verification rejects changed bytes, checksums, extra paths, and symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kb-github-identity-"));
  try {
    const pack = [{ name: manifest.package, version: manifest.version, filename: manifest.archive.name, size: archive.length, integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`, shasum: digest(archive, "sha1") }];
    const files = new Map([
      [manifest.archive.name, archive],
      ["npm-pack.json", Buffer.from(JSON.stringify(pack))],
      ["release-manifest.json", Buffer.from(JSON.stringify(manifest))],
      ["provenance.jsonl", Buffer.from("synthetic bundle; signature verification is a separate boundary")],
    ]);
    files.set("SHA256SUMS", Buffer.from([manifest.archive.name, "npm-pack.json", "release-manifest.json"].map((name) => `${digest(files.get(name)!)}  ${name}\n`).join("")));
    for (const [name, bytes] of files) await writeFile(join(directory, name), bytes);
    expect(await verifyReleaseFiles(directory)).toEqual(manifest);
    await writeFile(join(directory, manifest.archive.name), Buffer.from("changed"));
    await expect(verifyReleaseFiles(directory)).rejects.toThrow("archive differs");
    await writeFile(join(directory, manifest.archive.name), archive);
    await writeFile(join(directory, "unexpected"), "payload");
    await expect(verifyReleaseFiles(directory)).rejects.toThrow("unexpected files");
    await rm(join(directory, "unexpected"));
    await rm(join(directory, "npm-pack.json"));
    await symlink(join(directory, "release-manifest.json"), join(directory, "npm-pack.json"));
    await expect(verifyReleaseFiles(directory)).rejects.toThrow("bounded regular file");
    await rm(join(directory, "npm-pack.json"));
    await writeFile(join(directory, "npm-pack.json"), files.get("npm-pack.json")!);
    await writeFile(join(directory, "SHA256SUMS"), "../not-an-asset\n");
    await expect(verifyReleaseFiles(directory)).rejects.toThrow("checksums");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("draft recovery only admits matching existing assets and published releases require all assets", () => {
  const assets = [{ name: manifest.archive.name, bytes: archive.length, sha256: manifest.archive.sha256 }];
  const release = {
    id: 77, tag_name: manifest.tag, target_commitish: manifest.sourceSha, name: `KB ${manifest.tag}`, body: releaseBody(manifest), draft: true, prerelease: false,
    immutable: false, author: { id: 41898282, login: "github-actions[bot]", type: "Bot" }, assets: [],
  };
  expect(verifyProviderRelease(release, manifest, assets, true)).toEqual([manifest.archive.name]);
  const asset = { id: 88, name: manifest.archive.name, size: archive.length, digest: `sha256:${manifest.archive.sha256}`, state: "uploaded", browser_download_url: `https://github.com/hraness/kb/releases/download/${manifest.tag}/${manifest.archive.name}`, url: "https://api.github.com/repos/hraness/kb/releases/assets/88" };
  const complete = { ...release, assets: [asset] };
  expect(verifyProviderRelease(complete, manifest, assets, true)).toEqual([]);
  expect(verifyProviderRelease({ ...complete, draft: false, immutable: true }, manifest, assets, false)).toEqual([]);
  for (const change of [{ target_commitish: "main" }, { immutable: true }, { assets: [{ ...asset, url: "https://api.github.com/repos/other/repo/releases/assets/88" }] }, { assets: [{ ...asset, browser_download_url: "https://example.invalid/payload" }] }, { body: "different run" }, { author: { id: 1 } }, { assets: [asset, asset] }, { assets: [{ ...asset, digest: `sha256:${"f".repeat(64)}` }] }, { assets: [{ ...asset, name: "extra" }] }, { draft: false, immutable: false }]) {
    expect(() => verifyProviderRelease({ ...complete, ...change }, manifest, assets, true)).toThrow();
  }
  expect(() => verifyProviderRelease({ ...release, draft: false, immutable: true }, manifest, assets, false)).toThrow("missing canonical assets");
});

test("verified certificate and subject bind repository, source, workflow, hosted runner, and exact attempt", () => {
  const uri = `https://github.com/hraness/kb/.github/workflows/release.yml@refs/tags/${manifest.tag}`;
  const certificate = {
    issuer: "https://token.actions.githubusercontent.com", runInvocationURI: "https://github.com/hraness/kb/actions/runs/123/attempts/2",
    sourceRepositoryIdentifier: "1308971873", sourceRepositoryOwnerIdentifier: "307125679", sourceRepositoryOwnerURI: "https://github.com/hraness", sourceRepositoryURI: "https://github.com/hraness/kb",
    sourceRepositoryDigest: manifest.sourceSha, sourceRepositoryRef: `refs/tags/${manifest.tag}`,
    buildSignerDigest: manifest.sourceSha, buildConfigDigest: manifest.sourceSha, buildSignerURI: uri, buildConfigURI: uri,
    runnerEnvironment: "github-hosted", buildTrigger: "push", sourceRepositoryVisibilityAtSigning: "public",
  };
  const subjects = [manifest.archive.name, "npm-pack.json", "release-manifest.json", "SHA256SUMS"].map((name) => ({ name, bytes: archive.length, sha256: manifest.archive.sha256 }));
  const statement = { _type: "https://in-toto.io/Statement/v1", predicateType: "https://slsa.dev/provenance/v1", subject: subjects.map((subject) => ({ name: subject.name, digest: { sha256: subject.sha256 } })) };
  const wrap = (cert: unknown, stmt: unknown = statement) => [{ verificationResult: { signature: { certificate: cert }, verifiedTimestamps: [{ type: "transparency-log" }], statement: stmt } }];
  expect(() => verifyAttestationRun(wrap(certificate), manifest, subjects)).not.toThrow();
  for (const field of Object.keys(certificate)) {
    expect(() => verifyAttestationRun(wrap({ ...certificate, [field]: "wrong" }), manifest, subjects)).toThrow();
  }
  expect(() => verifyAttestationRun(wrap(certificate, { ...statement, subject: [{ name: "different.tgz", digest: { sha256: manifest.archive.sha256 } }] }), manifest, subjects)).toThrow();
  expect(() => verifyAttestationRun(wrap(certificate, { ...statement, subject: [{ name: manifest.archive.name, digest: { sha256: "f".repeat(64) } }] }), manifest, subjects)).toThrow();
  expect(() => verifyAttestationRun([{ verificationResult: { statement } }], manifest, subjects)).toThrow();
});

test("npm mirroring requires the exact completed successful canonical run", () => {
  const run = {
    id: manifest.runId, run_attempt: manifest.runAttempt, workflow_id: 320004141, name: "Release", path: manifest.workflow,
    status: "completed", conclusion: "success", event: "push", head_branch: manifest.tag, head_sha: manifest.sourceSha,
    actor: { id: 894119, type: "User" }, triggering_actor: { id: 894119, type: "User" },
    repository: { id: 1308971873, full_name: "hraness/kb", private: false },
  };
  expect(() => verifyCanonicalRun(run, manifest)).not.toThrow();
  for (const change of [{ run_attempt: 1 }, { status: "in_progress" }, { conclusion: "failure" }, { head_sha: manifest.workflowSha }, { workflow_id: 1 }, { triggering_actor: { id: 1, type: "User" } }]) {
    expect(() => verifyCanonicalRun({ ...run, ...change }, manifest)).toThrow();
  }
});
