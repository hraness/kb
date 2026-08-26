// @bun
import {
  CAPTURE_MANIFEST_FILENAME,
  CAPTURE_SOURCE_EVIDENCE_PATH
} from "./index-mxxxytys.js";

// src/clip/bundle-reader.ts
import { createHash } from "crypto";
import { constants as fsConstants } from "fs";
import { lstat, open, opendir, realpath } from "fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "path";
var MAX_MANIFEST_BYTES = 1 * 1024 * 1024;
var DEFAULT_MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
var MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
var DEFAULT_MAX_SOURCE_BYTES = 32 * 1024 * 1024;
var MAX_SOURCE_BYTES = 128 * 1024 * 1024;
var MAX_ASSETS = 1e4;
var MAX_LEGACY_DIRECTORY_ENTRIES = 1000;
var DEFAULT_MAX_VERIFIED_ASSETS = 1000;
var DEFAULT_MAX_ASSET_BYTES = 100 * 1024 * 1024;
var DEFAULT_MAX_TOTAL_ASSET_BYTES = 500 * 1024 * 1024;
var MAX_ASSET_BYTES = 8 * 1024 ** 3;
var MAX_TOTAL_ASSET_BYTES = 8 * 1024 ** 3;
var DEFAULT_ASSET_VERIFICATION_MS = 30000;
var MAX_ASSET_VERIFICATION_MS = 5 * 60 * 1000;
var SHA256_PATTERN = /^[0-9a-f]{64}$/u;
function object(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}
function optionalString(value) {
  return typeof value === "string" ? value : null;
}
function boundedInteger(value, fallback, maximum, label) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw new RangeError(`${label} must be an integer from 1 through ${maximum}`);
  }
  return selected;
}
function confinedRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\x00")) {
    throw new Error(`${label} must be a bounded non-empty path`);
  }
  if (isAbsolute(value) || value.includes("\\"))
    throw new Error(`${label} must be a relative POSIX path`);
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} contains an unsafe segment`);
  }
  return value;
}

class MissingCaptureAssetError extends Error {
}
function isMissingPathError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function assertAssetVerificationDeadline(deadline) {
  if (deadline !== undefined && performance.now() >= deadline) {
    throw new Error("capture asset verification exceeded its time budget");
  }
}
function confined(root, relativePath, label) {
  const path = resolve(root.path, relativePath);
  const lexical = relative(root.path, path);
  if (lexical === "" || lexical === ".." || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    throw new Error(`${label} escapes the capture bundle`);
  }
  return path;
}
async function safeDirectory(pathInput) {
  if (pathInput.trim() === "")
    throw new Error("capture bundle path is required");
  const path = resolve(pathInput);
  const canonical = await realpath(path);
  if (canonical !== path)
    throw new Error("capture bundle path must be canonical and cannot traverse a symbolic link");
  const stats = await lstat(path, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error("capture bundle path must be a real directory");
  if (dirname(path) === path)
    throw new Error("refusing a filesystem root as a capture bundle");
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isDirectory() || opened.dev !== stats.dev || opened.ino !== stats.ino) {
      throw new Error("capture bundle root changed while it was opened");
    }
    return { path, handle, device: opened.dev, inode: opened.ino };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function assertBundleRoot(root, deadline) {
  assertAssetVerificationDeadline(deadline);
  const [opened, named, canonical] = await Promise.all([
    root.handle.stat({ bigint: true }),
    lstat(root.path, { bigint: true }),
    realpath(root.path)
  ]);
  assertAssetVerificationDeadline(deadline);
  if (canonical !== root.path || !opened.isDirectory() || !named.isDirectory() || named.isSymbolicLink() || opened.dev !== root.device || opened.ino !== root.inode || named.dev !== root.device || named.ino !== root.inode)
    throw new Error("capture bundle root changed during inspection");
}
async function assertAncestorChain(root, relativePath, label, deadline) {
  await assertBundleRoot(root, deadline);
  const segments = confinedRelativePath(relativePath, label).split("/");
  let current = root.path;
  for (const segment of segments.slice(0, -1)) {
    current = resolve(current, segment);
    assertAssetVerificationDeadline(deadline);
    const metadata = await lstat(current, { bigint: true });
    assertAssetVerificationDeadline(deadline);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`${label} must not traverse a linked or non-directory ancestor`);
    }
    const canonical = await realpath(current);
    assertAssetVerificationDeadline(deadline);
    if (canonical !== current) {
      throw new Error(`${label} must not traverse a filesystem alias`);
    }
  }
  await assertBundleRoot(root, deadline);
}
async function withRegularFile(root, relativePath, maximumBytes, label, read, deadline, missingError) {
  await assertAncestorChain(root, relativePath, label, deadline);
  const path = confined(root, relativePath, label);
  assertAssetVerificationDeadline(deadline);
  let before;
  try {
    before = await lstat(path, { bigint: true });
  } catch (error) {
    assertAssetVerificationDeadline(deadline);
    if (missingError !== undefined && isMissingPathError(error))
      throw missingError;
    throw error;
  }
  assertAssetVerificationDeadline(deadline);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    throw new Error(`${label} must be a regular single-link file`);
  }
  if (before.size > BigInt(maximumBytes))
    throw new Error(`${label} exceeds ${maximumBytes} bytes`);
  const canonical = await realpath(path);
  assertAssetVerificationDeadline(deadline);
  if (canonical !== path)
    throw new Error(`${label} must not traverse a filesystem alias`);
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  assertAssetVerificationDeadline(deadline);
  try {
    const opened = await handle.stat({ bigint: true });
    assertAssetVerificationDeadline(deadline);
    if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
      throw new Error(`${label} changed while it was opened`);
    await assertAncestorChain(root, relativePath, label, deadline);
    const result = await read(handle, Number(opened.size));
    assertAssetVerificationDeadline(deadline);
    const after = await handle.stat({ bigint: true });
    assertAssetVerificationDeadline(deadline);
    const named = await lstat(path, { bigint: true });
    assertAssetVerificationDeadline(deadline);
    await assertAncestorChain(root, relativePath, label, deadline);
    const finalCanonical = await realpath(path);
    assertAssetVerificationDeadline(deadline);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.nlink !== 1n || named.dev !== before.dev || named.ino !== before.ino || named.size !== before.size || named.mtimeNs !== before.mtimeNs || named.nlink !== 1n || named.isSymbolicLink() || finalCanonical !== path)
      throw new Error(`${label} changed while it was read`);
    return result;
  } finally {
    await handle.close();
    assertAssetVerificationDeadline(deadline);
  }
}
async function readRegularFile(root, relativePath, maximumBytes, label) {
  return withRegularFile(root, relativePath, maximumBytes, label, async (handle, size) => {
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0)
        throw new Error(`${label} changed while it was read`);
      offset += result.bytesRead;
    }
    return bytes;
  });
}
async function hashRegularFile(root, relativePath, maximumBytes, deadline, label) {
  assertAssetVerificationDeadline(deadline);
  await assertBundleRoot(root, deadline);
  assertAssetVerificationDeadline(deadline);
  const path = confined(root, relativePath, label);
  assertAssetVerificationDeadline(deadline);
  try {
    await lstat(path, { bigint: true });
  } catch (error) {
    assertAssetVerificationDeadline(deadline);
    if (isMissingPathError(error)) {
      await assertBundleRoot(root, deadline);
      throw new MissingCaptureAssetError(`capture asset ${relativePath} is missing`);
    }
    throw error;
  }
  assertAssetVerificationDeadline(deadline);
  return withRegularFile(root, relativePath, maximumBytes, label, async (handle, size) => {
    assertAssetVerificationDeadline(deadline);
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(Math.min(1 * 1024 * 1024, Math.max(1, size)));
    let offset = 0;
    while (offset < size) {
      assertAssetVerificationDeadline(deadline);
      const result = await handle.read(chunk, 0, Math.min(chunk.byteLength, size - offset), offset);
      assertAssetVerificationDeadline(deadline);
      if (result.bytesRead === 0)
        throw new Error(`${label} changed while it was read`);
      hash.update(chunk.subarray(0, result.bytesRead));
      offset += result.bytesRead;
    }
    assertAssetVerificationDeadline(deadline);
    return { bytes: size, sha256: hash.digest("hex") };
  }, deadline, new MissingCaptureAssetError(`capture asset ${relativePath} is missing`));
}
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function manifestVersion(manifest) {
  const version = manifest.schemaVersion;
  if (version === 1 || version === 2 || version === 3 || version === 4)
    return version;
  throw new Error("capture manifest schemaVersion must be 1, 2, 3, or 4");
}
async function legacyMarkdownPath(root) {
  await assertBundleRoot(root);
  const expected = `${basename(root.path)}.md`;
  const directory = await opendir(root.path);
  const markdown = [];
  let observedEntries = 0;
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null)
        break;
      observedEntries += 1;
      if (observedEntries > MAX_LEGACY_DIRECTORY_ENTRIES) {
        throw new Error(`legacy capture bundle contains more than ${MAX_LEGACY_DIRECTORY_ENTRIES} top-level entries`);
      }
      if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".md")) {
        markdown.push(entry.name);
      }
    }
  } finally {
    await directory.close();
  }
  await assertBundleRoot(root);
  if (markdown.includes(expected))
    return expected;
  if (markdown.length === 1 && markdown[0] !== undefined)
    return markdown[0];
  throw new Error("legacy capture bundle must contain exactly one identifiable top-level Markdown document");
}
function v4Document(manifest) {
  const document = object(manifest.document, "capture manifest document");
  const path = confinedRelativePath(document.path, "capture manifest document.path");
  if (!path.endsWith(".md"))
    throw new Error("capture manifest document.path must name Markdown");
  if (!Number.isSafeInteger(document.bytes) || document.bytes < 0) {
    throw new Error("capture manifest document.bytes must be a non-negative safe integer");
  }
  if (typeof document.sha256 !== "string" || !SHA256_PATTERN.test(document.sha256)) {
    throw new Error("capture manifest document.sha256 must be a lowercase SHA-256 digest");
  }
  return { path, bytes: document.bytes, sha256: document.sha256 };
}
function manifestAssets(manifest) {
  if (manifest.assets === undefined)
    return [];
  if (!Array.isArray(manifest.assets) || manifest.assets.length > MAX_ASSETS) {
    throw new Error(`capture manifest assets must contain at most ${MAX_ASSETS} entries`);
  }
  const seen = new Set;
  return Object.freeze(manifest.assets.map((raw, index) => {
    const asset = object(raw, `capture manifest assets[${index}]`);
    const path = confinedRelativePath(asset.path, `capture manifest assets[${index}].path`);
    if (seen.has(path))
      throw new Error(`capture manifest repeats asset path ${path}`);
    seen.add(path);
    const bytes = Number.isSafeInteger(asset.bytes) && asset.bytes >= 0 ? asset.bytes : null;
    const sha256 = typeof asset.sha256 === "string" && SHA256_PATTERN.test(asset.sha256) ? asset.sha256 : null;
    return { path, bytes, sha256 };
  }));
}
function sourceHtmlPath(manifest) {
  if (manifest.evidence === undefined)
    return null;
  const evidence = object(manifest.evidence, "capture manifest evidence");
  const raw = evidence.sourceHtmlPath;
  if (raw === null || raw === undefined)
    return null;
  const path = confinedRelativePath(raw, "capture manifest evidence.sourceHtmlPath");
  if (path !== CAPTURE_SOURCE_EVIDENCE_PATH) {
    throw new Error("capture manifest source HTML path is not the owned evidence path");
  }
  return path;
}
async function readCaptureBundle(path, options = {}) {
  const root = await safeDirectory(path);
  try {
    const manifestBytes = await readRegularFile(root, CAPTURE_MANIFEST_FILENAME, MAX_MANIFEST_BYTES, "capture manifest");
    let parsed;
    try {
      parsed = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      throw new Error("capture manifest is not valid JSON");
    }
    const manifest = object(parsed, "capture manifest");
    const schemaVersion = manifestVersion(manifest);
    if (typeof manifest.sourceUrl !== "string")
      throw new Error("capture manifest sourceUrl is required");
    const expectedDocument = schemaVersion === 4 ? v4Document(manifest) : null;
    const documentPath = expectedDocument?.path ?? await legacyMarkdownPath(root);
    const documentBytes = await readRegularFile(root, documentPath, boundedInteger(options.maxDocumentBytes, DEFAULT_MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES, "document byte limit"), "capture document");
    const documentSha256 = digest(documentBytes);
    const documentIntegrity = expectedDocument === null ? "unavailable" : expectedDocument.bytes === documentBytes.byteLength && expectedDocument.sha256 === documentSha256 ? "verified" : "mismatch";
    const configuredAssets = manifestAssets(manifest);
    const maximumVerifiedAssets = boundedInteger(options.maxVerifiedAssets, DEFAULT_MAX_VERIFIED_ASSETS, MAX_ASSETS, "verified asset count limit");
    if (options.verifyAssets && configuredAssets.length > maximumVerifiedAssets) {
      throw new Error(`capture asset verification exceeds the ${maximumVerifiedAssets}-file limit`);
    }
    const maximumAssetBytes = boundedInteger(options.maxAssetBytes, DEFAULT_MAX_ASSET_BYTES, MAX_ASSET_BYTES, "asset byte limit");
    const maximumTotalAssetBytes = boundedInteger(options.maxTotalAssetBytes, DEFAULT_MAX_TOTAL_ASSET_BYTES, MAX_TOTAL_ASSET_BYTES, "total asset byte limit");
    if (maximumTotalAssetBytes < maximumAssetBytes) {
      throw new RangeError("total asset byte limit cannot be smaller than the per-asset byte limit");
    }
    const verificationDeadline = performance.now() + boundedInteger(options.maxAssetVerificationMs, DEFAULT_ASSET_VERIFICATION_MS, MAX_ASSET_VERIFICATION_MS, "asset verification time limit");
    let verifiedAssetBytes = 0;
    const assets = [];
    for (const asset of configuredAssets) {
      if (!options.verifyAssets) {
        assets.push(Object.freeze({
          path: asset.path,
          expectedBytes: asset.bytes,
          expectedSha256: asset.sha256,
          integrity: "unavailable"
        }));
        continue;
      }
      assertAssetVerificationDeadline(verificationDeadline);
      const remainingBytes = maximumTotalAssetBytes - verifiedAssetBytes;
      if (remainingBytes < 0)
        throw new Error("capture asset verification exceeds its total byte limit");
      let verified;
      try {
        verified = await hashRegularFile(root, asset.path, Math.min(maximumAssetBytes, remainingBytes), verificationDeadline, `capture asset ${asset.path}`);
      } catch (error) {
        assertAssetVerificationDeadline(verificationDeadline);
        if (!(error instanceof MissingCaptureAssetError))
          throw error;
        assets.push(Object.freeze({
          path: asset.path,
          expectedBytes: asset.bytes,
          expectedSha256: asset.sha256,
          integrity: "mismatch"
        }));
        continue;
      }
      verifiedAssetBytes += verified.bytes;
      const integrity = asset.bytes !== null && asset.sha256 !== null && asset.bytes === verified.bytes && asset.sha256 === verified.sha256 ? "verified" : "mismatch";
      assets.push(Object.freeze({
        path: asset.path,
        expectedBytes: asset.bytes,
        expectedSha256: asset.sha256,
        integrity
      }));
      assertAssetVerificationDeadline(verificationDeadline);
    }
    let sourceHtml;
    if (options.includeSourceHtml) {
      const evidencePath = sourceHtmlPath(manifest);
      if (evidencePath !== null) {
        sourceHtml = (await readRegularFile(root, evidencePath, boundedInteger(options.maxSourceHtmlBytes, DEFAULT_MAX_SOURCE_BYTES, MAX_SOURCE_BYTES, "source HTML byte limit"), "capture source HTML")).toString("utf8");
      }
    }
    await assertBundleRoot(root);
    return Object.freeze({
      root: root.path,
      schemaVersion,
      sourceUrl: manifest.sourceUrl,
      canonicalUrl: optionalString(manifest.canonicalUrl),
      status: optionalString(manifest.status),
      capturedAt: optionalString(manifest.capturedAt),
      document: Object.freeze({
        path: documentPath,
        bytes: documentBytes.byteLength,
        sha256: documentSha256,
        expectedBytes: expectedDocument?.bytes ?? null,
        expectedSha256: expectedDocument?.sha256 ?? null,
        integrity: documentIntegrity,
        markdown: documentBytes.toString("utf8")
      }),
      assets: Object.freeze(assets),
      ...sourceHtml === undefined ? {} : { sourceHtml }
    });
  } finally {
    await root.handle.close();
  }
}
async function verifyCaptureBundle(path, options = {}) {
  const inspection = await readCaptureBundle(path, options);
  const issues = [];
  if (inspection.document.integrity !== "verified") {
    issues.push(Object.freeze({
      kind: "document-integrity",
      path: inspection.document.path,
      message: inspection.document.integrity === "mismatch" ? "Stored Markdown bytes do not match the v4 capture manifest." : "Legacy capture manifest does not contain an authoritative Markdown digest."
    }));
  }
  for (const asset of inspection.assets) {
    if (asset.integrity === "mismatch") {
      issues.push(Object.freeze({
        kind: "asset-integrity",
        path: asset.path,
        message: "Stored asset bytes do not match the capture manifest."
      }));
    }
  }
  return Object.freeze({ ok: issues.length === 0, inspection, issues: Object.freeze(issues) });
}

export { readCaptureBundle, verifyCaptureBundle };
