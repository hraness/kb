import { log } from "node:console";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

// This finite, asset-free inventory is owned by the checker, never the manifest.
export const lanternSnapshotPaths = Object.freeze({
  "lantern-material.css": "src/lantern-material.css",
  "check.mjs": "scripts/check-lantern-material-snapshot.mjs",
  "check.d.mts": "scripts/check-lantern-material-snapshot.d.mts",
  LICENSE: "LICENSE",
});
export const lanternSnapshotFileLimits = Object.freeze({
  "lantern-material.css": 256 * 1024,
  "check.mjs": 128 * 1024,
  "check.d.mts": 64 * 1024,
  LICENSE: 64 * 1024,
});
const names = Object.keys(lanternSnapshotPaths);
const repository = "https://github.com/hraness/design-kit";
const exportedCss = "@hraness/design-kit/lantern-material.css";
const checkerDirectory = dirname(fileURLToPath(import.meta.url));
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const keysEqual = (value, keys) => record(value) && Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const commitPattern = /^[a-f0-9]{40}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;

export function createLanternMaterialSnapshot(commit, files) {
  if (typeof commit !== "string" || !commitPattern.test(commit)) throw new Error("Snapshot source must be a full lowercase Git commit.");
  if (!keysEqual(files, names)) throw new Error("Snapshot has missing or unowned source files.");
  for (const name of names) {
    if (!(files[name] instanceof Uint8Array) || files[name].byteLength === 0 || files[name].byteLength > lanternSnapshotFileLimits[name]) {
      throw new Error(`Invalid ${name} source bytes.`);
    }
  }
  return {
    schemaVersion: 1,
    contractVersion: 1,
    source: { repository, commit, export: exportedCss },
    files: Object.fromEntries(names.map((name) => [name, { path: lanternSnapshotPaths[name], sha256: sha256(files[name]) }])),
  };
}

export function parseLanternMaterialSnapshot(value) {
  if (!keysEqual(value, ["schemaVersion", "contractVersion", "source", "files"])
    || value.schemaVersion !== 1 || value.contractVersion !== 1
    || !keysEqual(value.source, ["repository", "commit", "export"])
    || value.source.repository !== repository || value.source.export !== exportedCss
    || typeof value.source.commit !== "string" || !commitPattern.test(value.source.commit)
    || !keysEqual(value.files, names)) throw new Error("Invalid Lantern material snapshot provenance.");
  for (const name of names) {
    const receipt = value.files[name];
    if (!keysEqual(receipt, ["path", "sha256"]) || receipt.path !== lanternSnapshotPaths[name]
      || typeof receipt.sha256 !== "string" || !hashPattern.test(receipt.sha256)) throw new Error(`Invalid ${name} provenance.`);
  }
  return value;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function physicalFile(path, maximum) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size === 0 || before.size > maximum) {
    throw new Error("Snapshot files must be bounded physical files with one link.");
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    if (!sameIdentity(before, opened) || !opened.isFile() || opened.nlink !== 1 || opened.size !== before.size) {
      throw new Error("Snapshot file changed while opening.");
    }
    // Read only the admitted length plus one sentinel byte. A concurrent
    // append must fail without allocating or reading the growing file to EOF.
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await file.stat();
    const current = await lstat(path);
    if (length !== before.size || !sameIdentity(before, current) || current.isSymbolicLink()
      || current.nlink !== 1 || after.nlink !== 1 || after.size !== before.size
      || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error("Snapshot file changed while reading.");
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

export async function checkLanternMaterialSnapshot(root = checkerDirectory) {
  root = resolve(root);
  const directory = await lstat(root);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Snapshot requires a physical directory.");
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.map((entry) => entry.name).sort().join("\n") !== [...names, "provenance.json"].sort().join("\n")) {
    throw new Error("Snapshot has missing or unowned files.");
  }
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) throw new Error("Snapshot requires only physical files.");
  const provenanceBytes = await physicalFile(join(root, "provenance.json"), 16 * 1024);
  const manifest = parseLanternMaterialSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(provenanceBytes)));
  for (const name of names) {
    const bytes = await physicalFile(join(root, name), lanternSnapshotFileLimits[name]);
    if (sha256(bytes) !== manifest.files[name].sha256) throw new Error(`${name} differs from its immutable snapshot.`);
  }
  if (!provenanceBytes.equals(await physicalFile(join(root, "provenance.json"), 16 * 1024))) throw new Error("Snapshot provenance changed while checking.");
  const after = await lstat(root);
  if (!sameIdentity(directory, after) || !after.isDirectory() || after.isSymbolicLink()
    || (await readdir(root)).sort().join("\n") !== [...names, "provenance.json"].sort().join("\n")) throw new Error("Snapshot directory changed while checking.");
  return manifest;
}

if (process.argv[1] !== undefined && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error("Usage: node check.mjs [SNAPSHOT_DIRECTORY]");
  const manifest = await checkLanternMaterialSnapshot(process.argv[2] === undefined ? checkerDirectory : resolve(process.argv[2]));
  log(`Lantern material snapshot verified at ${manifest.source.commit}.`);
}
