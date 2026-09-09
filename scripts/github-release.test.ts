import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";

import { parseReleaseManifest, publishVerifiedRelease, releaseBody, stableVersion, uniqueReleaseId, verifyAttestationRun, verifyCanonicalRun, verifyProviderRelease, verifyReleaseFiles, type ReleaseManifest } from "./github-release.js";

const archive = Buffer.from("Synthetic packed-byte identity fixture; real USTAR admission is covered by package-artifact tests.");
const digest = (bytes: Uint8Array, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const manifest: ReleaseManifest = {
  schema: "hraness-github-release-v1", repository: "hraness/kb", repositoryId: 1308971873,
  package: "@hraness/kb", version: "0.19.4", tag: "v0.19.4", sourceSha: "a".repeat(40),
  workflow: ".github/workflows/release.yml", workflowSha: "b".repeat(40), runId: 123, runAttempt: 2,
  archive: { name: "hraness-kb-0.19.4.tgz", bytes: archive.length, sha256: digest(archive), sha512: digest(archive, "sha512") },
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
  expect(() => stableVersion("0.19.4\n")).toThrow();
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

test("temporary draft asset URLs remain same-repository and never admit published assets", () => {
  const temporaryUrl = "https://github.com/hraness/kb/releases/download/untagged-ef6c1bd779e9dd4032bb/SHA256SUMS";
  const sha256 = "7439c234c0a6d0166efef952e3d8ee76dfde2178934ffe8dcdebb84cd1dfe162";
  const assets = [{ name: "SHA256SUMS", bytes: 256, sha256 }];
  const asset = { id: 552772852, name: "SHA256SUMS", size: 256, digest: `sha256:${sha256}`, state: "uploaded",
    browser_download_url: temporaryUrl, url: "https://api.github.com/repos/hraness/kb/releases/assets/552772852" };
  const draft = { id: 385518557, tag_name: manifest.tag, target_commitish: manifest.sourceSha, name: `KB ${manifest.tag}`,
    body: releaseBody(manifest), draft: true, immutable: false, prerelease: false,
    author: { id: 41898282, login: "github-actions[bot]", type: "Bot" }, assets: [asset] };
  expect(verifyProviderRelease(draft, manifest, assets, true)).toEqual([]);
  for (const url of [
    temporaryUrl.replace("hraness/kb", "other/kb"), temporaryUrl.replace("SHA256SUMS", "npm-pack.json"),
    temporaryUrl.replace("ef6c1bd779e9dd4032bb", "ef6c1bd779e9dd4032b"),
    temporaryUrl.replace("ef6c1bd779e9dd4032bb", "EF6C1BD779E9DD4032BB"),
    `${temporaryUrl}?token=anything`, `${temporaryUrl}#fragment`, temporaryUrl.replace("untagged-", "refs/untagged-"),
  ]) expect(() => verifyProviderRelease({ ...draft, assets: [{ ...asset, browser_download_url: url }] }, manifest, assets, true)).toThrow();
  for (const allowDraft of [true, false]) {
    expect(() => verifyProviderRelease({ ...draft, draft: false, immutable: true }, manifest, assets, allowDraft)).toThrow();
  }
  fc.assert(fc.property(fc.array(fc.constantFrom(..."0123456789abcdef"), { minLength: 20, maxLength: 20 }), (digits) => {
    const url = `https://github.com/hraness/kb/releases/download/untagged-${digits.join("")}/SHA256SUMS`;
    expect(verifyProviderRelease({ ...draft, assets: [{ ...asset, browser_download_url: url }] }, manifest, assets, true)).toEqual([]);
  }));
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

test("draft publication survives by-tag 404 through one retained release ID without duplicate writes", () => {
  const remoteBytes = Buffer.from("0123456789");
  const assets = [manifest.archive.name, "npm-pack.json", "release-manifest.json", "SHA256SUMS", "provenance.jsonl"]
    .map((name) => ({ name, bytes: remoteBytes.length, sha256: digest(remoteBytes) }));
  const descriptor = (name: string, id: number) => ({
    id, name, size: remoteBytes.length, digest: `sha256:${digest(remoteBytes)}`, state: "uploaded",
    browser_download_url: `https://github.com/hraness/kb/releases/download/untagged-ef6c1bd779e9dd4032bb/${name}`,
    url: `https://api.github.com/repos/hraness/kb/releases/assets/${id}`,
  });
  const fixture = (existing: boolean, conflict = false, fault?: "bytes" | "id" | "published-bytes" | "creation-status" | "creation-identity") => {
    let created = existing;
    const release = {
      id: 77, tag_name: manifest.tag, target_commitish: manifest.sourceSha, name: `KB ${manifest.tag}`,
      body: conflict ? "a different original attempt" : releaseBody(manifest),
      draft: true, immutable: false, prerelease: false,
      author: { id: 41898282, login: "github-actions[bot]", type: "Bot" },
      assets: existing ? [descriptor(assets[0]!.name, 1)] : [] as ReturnType<typeof descriptor>[],
    };
    const calls: string[] = [];
    let draftTagRequests = 0;
    const run = (_program: string, args: readonly string[]): string => {
      const prior = calls.at(-1);
      calls.push(args.join(" "));
      const mutation = args[0] === "release" || args[2] === "POST" || args[2] === "PATCH";
      if (mutation && prior !== "authority") throw new Error("Mutation was not immediately reauthorized");
      const endpoint = args[3];
      if (args[2] === "POST" && endpoint === "/repos/hraness/kb/releases") {
        if (created) throw new Error("Draft must never be recreated");
        created = true;
        expect(args).toContain(`target_commitish=${manifest.sourceSha}`);
        expect(args).toContain("draft=true");
        expect(args).toContain("make_latest=false");
        return `HTTP/2.0 ${fault === "creation-status" ? 200 : 201} Created\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(fault === "creation-identity" ? { ...release, id: 0 } : release)}`;
      }
      if (args[2] === "GET" && endpoint?.endsWith("releases?per_page=100")) {
        expect(args).toContain("--paginate");
        expect(args).toContain("--slurp");
        // The provider index intentionally never exposes a draft created here.
        return JSON.stringify([[{ id: 1, tag_name: "v0.1.0" }], existing ? [{ id: 77, tag_name: manifest.tag }] : []]);
      }
      if (args[2] === "POST" && endpoint?.startsWith("https://uploads.github.com/repos/hraness/kb/releases/77/assets?name=")) {
        expect(args).toContain("Content-Length: 10");
        expect(args).toContain("Content-Type: application/octet-stream");
        const name = new URL(endpoint).searchParams.get("name")!;
        if (release.assets.some((asset) => asset.name === name)) throw new Error("Asset must never be overwritten");
        release.assets.push(descriptor(name, release.assets.length + 1));
        if (fault === "id") release.id = 78;
        return "{}";
      }
      if (args[2] === "PATCH" && endpoint === "/repos/hraness/kb/releases/77") {
        expect(args).toContain("draft=false");
        expect(args).toContain("make_latest=true");
        release.draft = false; release.immutable = true;
        for (const asset of release.assets) asset.browser_download_url = `https://github.com/hraness/kb/releases/download/${manifest.tag}/${asset.name}`;
        return JSON.stringify(release);
      }
      if (args[2] === "GET" && endpoint === `/repos/hraness/kb/releases/tags/${manifest.tag}` && release.draft) {
        draftTagRequests += 1;
        throw new Error("HTTP 404: GitHub hides drafts from by-tag lookup");
      }
      if (args[2] === "GET" && ["/repos/hraness/kb/releases/77", `/repos/hraness/kb/releases/tags/${manifest.tag}`, "/repos/hraness/kb/releases/latest"].includes(endpoint ?? "")) return JSON.stringify(release);
      throw new Error(`Unexpected provider command ${args.join(" ")}`);
    };
    const download = (id: number, expectedBytes: number): Uint8Array => {
      calls.push(`download ${id}`);
      if (!release.assets.some((asset) => asset.id === id)) throw new Error("Download must identify one retained asset");
      expect(expectedBytes).toBe(remoteBytes.length);
      return fault === "bytes" || (fault === "published-bytes" && !release.draft) ? Buffer.from("CORRUPTED!") : remoteBytes;
    };
    return { calls, release, run, download, authorize: () => { calls.push("authority"); }, draftTagRequests: () => draftTagRequests };
  };
  for (const existing of [true, false]) {
    const provider = fixture(existing);
    expect(() => publishVerifiedRelease("/synthetic-release", manifest, assets, provider.run, provider.authorize, provider.download)).not.toThrow();
    expect(provider.draftTagRequests()).toBe(0);
    expect(provider.release.assets).toHaveLength(5);
    expect(provider.release.immutable).toBe(true);
    expect(provider.calls.filter((call) => call.startsWith("api --method POST /repos/hraness/kb/releases "))).toHaveLength(existing ? 0 : 1);
    expect(provider.calls.filter((call) => call.startsWith("api --method POST https://uploads.github.com"))).toHaveLength(existing ? 4 : 5);
    expect(provider.calls.filter((call) => call.includes("--paginate"))).toHaveLength(1);
    expect(provider.calls.filter((call) => call.startsWith("download "))).toHaveLength(10);
  }
  const conflict = fixture(true, true);
  expect(() => publishVerifiedRelease("/synthetic-release", manifest, assets, conflict.run, conflict.authorize, conflict.download)).toThrow("reconcile the original run");
  expect(conflict.calls).not.toContain("authority");
  for (const fault of ["bytes", "id", "published-bytes"] as const) {
    const provider = fixture(true, false, fault);
    expect(() => publishVerifiedRelease("/synthetic-release", manifest, assets, provider.run, provider.authorize, provider.download))
      .toThrow(fault === "id" ? "Release ID changed" : "Downloaded release asset differs");
    expect(provider.calls.filter((call) => call.startsWith("api --method PATCH"))).toHaveLength(fault === "published-bytes" ? 1 : 0);
    if (fault === "id") expect(provider.calls.filter((call) => call.startsWith("api --method POST"))).toHaveLength(1);
  }
  for (const fault of ["creation-status", "creation-identity"] as const) {
    const provider = fixture(false, false, fault);
    expect(() => publishVerifiedRelease("/synthetic-release", manifest, assets, provider.run, provider.authorize, provider.download)).toThrow();
    expect(provider.calls.filter((call) => call.startsWith("api --method POST"))).toHaveLength(1);
    expect(provider.calls.filter((call) => call.startsWith("api --method PATCH"))).toHaveLength(0);
  }
  expect(() => uniqueReleaseId([[{ id: 1, tag_name: manifest.tag }], [{ id: 2, tag_name: manifest.tag }]], manifest.tag)).toThrow("Multiple");
  expect(() => uniqueReleaseId([[{ id: 1, tag_name: manifest.tag }], [{ id: 1, tag_name: manifest.tag }]], manifest.tag)).toThrow("repeats an ID");
  expect(() => uniqueReleaseId([{ id: 1, tag_name: manifest.tag }], manifest.tag)).toThrow("page is malformed");
});
