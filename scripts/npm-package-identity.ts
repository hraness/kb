import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import {
  inspectPackageArtifact,
  type PackageArtifactEntry,
  type PackageArtifactInventory,
} from "./package-artifact.js";

const packageName = "@hraness/kb";
const npmRegistry = "https://registry.npmjs.org";
const stableVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;

type NpmPackFile = Readonly<{ mode: number; path: string; size: number }>;
type NpmPackIdentity = Readonly<{
  bundled: readonly string[];
  entryCount: number;
  filename: string;
  files: readonly NpmPackFile[];
  id: string;
  integrity: string;
  name: string;
  shasum: string;
  size: number;
  unpackedSize: number;
  version: string;
}>;
type VerifiedArtifact = Readonly<{
  archiveSha1: string;
  archiveSha256: string;
  archiveSha512: string;
  inventory: PackageArtifactInventory;
  pack: NpmPackIdentity;
}>;

export type NpmPackageIdentityInput = Readonly<{
  expectedName: string;
  expectedVersion: string;
  registryArchive: string;
  registryPackJson: string;
  registryViewJson: string;
  sourceArchive: string;
  sourcePackJson: string;
}>;

export type VerifiedNpmPackageIdentity = Readonly<{
  canonicalSha256: string;
  directoryCount: number;
  fileCount: number;
  name: string;
  registryArchiveSha512: string;
  sourceArchiveSha512: string;
  unpackedBytes: number;
  version: string;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string, label: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return field;
}

function integerField(value: Record<string, unknown>, key: string, label: string): number {
  const field = value[key];
  if (!Number.isSafeInteger(field) || (field as number) < 0) {
    throw new Error(`${label}.${key} must be a non-negative safe integer`);
  }
  return field as number;
}

function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha512Hex(bytes: Uint8Array): string {
  return createHash("sha512").update(bytes).digest("hex");
}

function sha512Integrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function expectedFilename(name: string, version: string): string {
  if (name !== packageName) {
    throw new Error(`Expected package name must be ${packageName}, received ${name}`);
  }
  if (!stableVersionPattern.test(version)) {
    throw new Error(`Expected package version is not stable semantic version: ${version}`);
  }
  return `hraness-kb-${version}.tgz`;
}

function canonicalRegistryTarball(name: string, version: string): string {
  const unscopedName = name.slice(name.indexOf("/") + 1);
  return `${npmRegistry}/${name}/-/${unscopedName}-${version}.tgz`;
}

function metadataFileIdentity(files: readonly NpmPackFile[]): string {
  return JSON.stringify(
    [...files]
      .sort((left, right) => Buffer.compare(
        Buffer.from(left.path, "utf8"),
        Buffer.from(right.path, "utf8"),
      ))
      .map((file) => ({ mode: file.mode, path: file.path, size: file.size })),
  );
}

function entryIdentity(entry: PackageArtifactEntry): Readonly<Record<string, unknown>> {
  return entry.type === "file"
    ? {
        contentSha256: entry.contentSha256,
        contentSha512: entry.contentSha512,
        mode: entry.mode,
        path: entry.path,
        size: entry.size,
        type: entry.type,
      }
    : { mode: entry.mode, path: entry.path, size: entry.size, type: entry.type };
}

function inventoryIdentity(inventory: PackageArtifactInventory): string {
  return JSON.stringify(inventory.entries.map(entryIdentity));
}

async function verifyPackArtifact(
  archive: string,
  packJson: string,
  expectedName: string,
  expectedVersion: string,
  label: string,
): Promise<VerifiedArtifact> {
  const filename = expectedFilename(expectedName, expectedVersion);
  if (basename(archive) !== filename) {
    throw new Error(`${label} archive filename is not ${filename}`);
  }
  const [archiveBytes, metadataBytes, inventory] = await Promise.all([
    readFile(archive),
    readFile(packJson),
    inspectPackageArtifact(archive),
  ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes)) as unknown;
  } catch (error) {
    throw new Error(`${label} npm-pack.json is not valid UTF-8 JSON`, { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(`${label} npm-pack.json must contain exactly one package`);
  }
  const result = record(parsed[0], `${label} npm pack result`);
  const identity: NpmPackIdentity = Object.freeze({
    bundled: (() => {
      if (!Array.isArray(result.bundled) || result.bundled.some((value) => typeof value !== "string")) {
        throw new Error(`${label} npm pack result.bundled must be a string array`);
      }
      return Object.freeze([...result.bundled] as string[]);
    })(),
    entryCount: integerField(result, "entryCount", `${label} npm pack result`),
    filename: stringField(result, "filename", `${label} npm pack result`),
    files: (() => {
      if (!Array.isArray(result.files)) {
        throw new Error(`${label} npm pack result.files must be an array`);
      }
      const seen = new Set<string>();
      return Object.freeze(result.files.map((value, index) => {
        const fileLabel = `${label} npm pack file ${String(index + 1)}`;
        const file = record(value, fileLabel);
        const path = stringField(file, "path", fileLabel);
        const mode = integerField(file, "mode", fileLabel);
        const size = integerField(file, "size", fileLabel);
        if (
          Buffer.byteLength(path, "utf8") > 1_024
          || path.startsWith("/")
          || path.includes("\\")
          || hasControlCharacters(path)
          || path.split("/").some((part) => part === "" || part === "." || part === "..")
          || seen.has(path)
        ) {
          throw new Error(`${fileLabel}.path is unsafe or duplicated`);
        }
        if (mode !== 0o644 && mode !== 0o755) {
          throw new Error(`${fileLabel}.mode is not 0644 or 0755`);
        }
        seen.add(path);
        return Object.freeze({ mode, path, size });
      }));
    })(),
    id: stringField(result, "id", `${label} npm pack result`),
    integrity: stringField(result, "integrity", `${label} npm pack result`),
    name: stringField(result, "name", `${label} npm pack result`),
    shasum: stringField(result, "shasum", `${label} npm pack result`),
    size: integerField(result, "size", `${label} npm pack result`),
    unpackedSize: integerField(result, "unpackedSize", `${label} npm pack result`),
    version: stringField(result, "version", `${label} npm pack result`),
  });
  if (
    identity.name !== expectedName
    || identity.id !== `${expectedName}@${expectedVersion}`
    || identity.version !== expectedVersion
    || identity.filename !== filename
    || !/^hraness-kb-(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.tgz$/u.test(identity.filename)
  ) {
    throw new Error(`${label} npm pack identity does not match ${expectedName}@${expectedVersion}`);
  }
  if (identity.bundled.length !== 0) {
    throw new Error(`${label} npm pack unexpectedly bundles dependencies`);
  }
  if (
    identity.entryCount !== inventory.fileCount
    || identity.files.length !== inventory.fileCount
    || identity.unpackedSize !== inventory.unpackedBytes
  ) {
    throw new Error(`${label} npm pack counts or unpacked size differ from the tar inventory`);
  }
  if (identity.size !== archiveBytes.byteLength || identity.size !== inventory.packedBytes) {
    throw new Error(`${label} npm pack size differs from the exact tarball`);
  }
  const actualSha1 = sha1(archiveBytes);
  const actualSha512Integrity = sha512Integrity(archiveBytes);
  if (identity.shasum !== actualSha1 || identity.integrity !== actualSha512Integrity) {
    throw new Error(`${label} npm pack SHA-1 or SHA-512 differs from the exact tarball`);
  }
  const actualFiles = new Map(inventory.files.map((file) => [file.path, file] as const));
  for (const file of identity.files) {
    const actual = actualFiles.get(file.path);
    if (actual === undefined || actual.size !== file.size || actual.mode !== file.mode) {
      throw new Error(`${label} npm pack metadata differs from tar path, mode, or size: ${file.path}`);
    }
  }
  if (actualFiles.size !== identity.files.length) {
    throw new Error(`${label} npm pack metadata omits a regular tar entry`);
  }
  return Object.freeze({
    archiveSha1: actualSha1,
    archiveSha256: sha256(archiveBytes),
    archiveSha512: sha512Hex(archiveBytes),
    inventory,
    pack: identity,
  });
}

async function verifyRegistryView(
  path: string,
  expectedName: string,
  expectedVersion: string,
  registry: VerifiedArtifact,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error("npm registry view is not valid JSON", { cause: error });
  }
  const view = record(parsed, "npm registry view");
  const dist = record(view.dist, "npm registry view.dist");
  if (
    stringField(view, "name", "npm registry view") !== expectedName
    || stringField(view, "version", "npm registry view") !== expectedVersion
    || stringField(dist, "integrity", "npm registry view.dist") !== registry.pack.integrity
    || stringField(dist, "shasum", "npm registry view.dist") !== registry.pack.shasum
    || integerField(dist, "fileCount", "npm registry view.dist") !== registry.inventory.fileCount
    || integerField(dist, "unpackedSize", "npm registry view.dist") !== registry.inventory.unpackedBytes
    || stringField(dist, "tarball", "npm registry view.dist")
      !== canonicalRegistryTarball(expectedName, expectedVersion)
  ) {
    throw new Error("npm registry metadata differs from the downloaded canonical package");
  }
}

function compareInventories(
  source: PackageArtifactInventory,
  registry: PackageArtifactInventory,
): string {
  const sourceIdentity = inventoryIdentity(source);
  const registryIdentity = inventoryIdentity(registry);
  if (sourceIdentity !== registryIdentity) {
    const maximum = Math.max(source.entries.length, registry.entries.length);
    for (let index = 0; index < maximum; index += 1) {
      const sourceEntry = source.entries[index];
      const registryEntry = registry.entries[index];
      if (JSON.stringify(sourceEntry === undefined ? null : entryIdentity(sourceEntry))
        !== JSON.stringify(registryEntry === undefined ? null : entryIdentity(registryEntry))) {
        throw new Error(
          `Source and registry package content differ at canonical entry ${String(index + 1)}: ${JSON.stringify({ registry: registryEntry, source: sourceEntry })}`,
        );
      }
    }
    throw new Error("Source and registry package content identities differ");
  }
  return sha256(sourceIdentity);
}

export async function verifyNpmPackageIdentity(
  input: NpmPackageIdentityInput,
): Promise<VerifiedNpmPackageIdentity> {
  expectedFilename(input.expectedName, input.expectedVersion);
  const [source, registry] = await Promise.all([
    verifyPackArtifact(
      input.sourceArchive,
      input.sourcePackJson,
      input.expectedName,
      input.expectedVersion,
      "Source",
    ),
    verifyPackArtifact(
      input.registryArchive,
      input.registryPackJson,
      input.expectedName,
      input.expectedVersion,
      "Registry",
    ),
  ]);
  if (metadataFileIdentity(source.pack.files) !== metadataFileIdentity(registry.pack.files)) {
    throw new Error("Source and registry npm pack file metadata differ");
  }
  if (
    source.pack.entryCount !== registry.pack.entryCount
    || source.pack.unpackedSize !== registry.pack.unpackedSize
    || JSON.stringify(source.pack.bundled) !== JSON.stringify(registry.pack.bundled)
  ) {
    throw new Error("Source and registry npm pack summaries differ");
  }
  const canonicalSha256 = compareInventories(source.inventory, registry.inventory);
  await verifyRegistryView(input.registryViewJson, input.expectedName, input.expectedVersion, registry);
  const result = Object.freeze({
    canonicalSha256,
    directoryCount: source.inventory.directories.length,
    fileCount: source.inventory.fileCount,
    name: input.expectedName,
    registryArchiveSha512: registry.archiveSha512,
    sourceArchiveSha512: source.archiveSha512,
    unpackedBytes: source.inventory.unpackedBytes,
    version: input.expectedVersion,
  });
  console.log(
    `Canonical npm package identity verified: ${result.name}@${result.version}; ${String(result.fileCount)} files; ${String(result.directoryCount)} directories; ${String(result.unpackedBytes)} unpacked bytes; sha256:${result.canonicalSha256}.`,
  );
  console.log(
    `Transport SHA-512 values were independently verified and may differ: source ${result.sourceArchiveSha512}; registry ${result.registryArchiveSha512}.`,
  );
  return result;
}

function resolvePath(repository: string, value: string): string {
  return isAbsolute(value) ? value : resolve(repository, value);
}

function parseArguments(args: readonly string[]): NpmPackageIdentityInput {
  const requiredFlags = [
    "--expected-name",
    "--expected-version",
    "--registry-archive",
    "--registry-pack-json",
    "--registry-view-json",
    "--source-archive",
    "--source-pack-json",
  ] as const;
  if (args.length !== requiredFlags.length * 2) {
    throw new Error(`Usage: bun run scripts/npm-package-identity.ts ${requiredFlags.map((flag) => `${flag} <value>`).join(" ")}`);
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      flag === undefined
      || value === undefined
      || !requiredFlags.includes(flag as (typeof requiredFlags)[number])
      || values.has(flag)
    ) {
      throw new Error("npm package identity arguments are unknown, duplicated, or incomplete");
    }
    values.set(flag, value);
  }
  for (const flag of requiredFlags) {
    if (!values.has(flag)) throw new Error(`Missing npm package identity argument ${flag}`);
  }
  const repository = process.cwd();
  return Object.freeze({
    expectedName: values.get("--expected-name") as string,
    expectedVersion: values.get("--expected-version") as string,
    registryArchive: resolvePath(repository, values.get("--registry-archive") as string),
    registryPackJson: resolvePath(repository, values.get("--registry-pack-json") as string),
    registryViewJson: resolvePath(repository, values.get("--registry-view-json") as string),
    sourceArchive: resolvePath(repository, values.get("--source-archive") as string),
    sourcePackJson: resolvePath(repository, values.get("--source-pack-json") as string),
  });
}

if (import.meta.main) {
  await verifyNpmPackageIdentity(parseArguments(process.argv.slice(2)));
}
