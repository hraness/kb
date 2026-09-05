import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const blockSize = 512;
const packagePrefix = "package/";
const maximumTarBytes = 6_500_000;
const ustarSignature = Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0x00, 0x30, 0x30]);

const packageBudget = Object.freeze({
  entryCount: { min: 190, max: 420 },
  fileCount: { min: 190, max: 210 },
  packedBytes: { min: 950_000, max: 1_200_000 },
  unpackedBytes: { min: 4_500_000, max: 5_250_000 },
});

const requiredPaths = Object.freeze([
  "DISCLOSURE",
  "LICENSE",
  "README.md",
  "package.json",
  "dist/cli.js",
  "dist/evaluation-builder.js",
  "dist/index.js",
  "skills/kb/AGENTS.md",
  "skills/kb/SKILL.md",
  "skills/kb/agents/openai.yaml",
  "skills/kb/references/query.md",
  "skills/kb/references/save-url.md",
  "src/cli.ts",
  "src/clip/metadata-search-tool/Cargo.lock",
  "src/clip/metadata-search-tool/Cargo.toml",
  "src/clip/metadata-search-tool/runner.ts",
  "src/clip/metadata-search-tool/src/main.rs",
  "src/evaluation-builder.ts",
  "src/index.ts",
]);

export type PackageArtifactEntry = Readonly<{
  contentSha256?: string;
  contentSha512?: string;
  mode: number;
  path: string;
  size: number;
  type: "directory" | "file";
}>;

export type PackageArtifactFile = Readonly<{
  contentSha256: string;
  contentSha512: string;
  mode: number;
  path: string;
  size: number;
}>;

export interface PackageArtifactInventory {
  readonly directories: readonly PackageArtifactEntry[];
  readonly entries: readonly PackageArtifactEntry[];
  readonly entryCount: number;
  readonly fileCount: number;
  readonly files: readonly PackageArtifactFile[];
  readonly packedBytes: number;
  readonly unpackedBytes: number;
}

function readString(block: Buffer, start: number, length: number, label: string): string {
  const end = block.indexOf(0, start);
  const boundedEnd = end === -1 || end > start + length ? start + length : end;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(block.subarray(start, boundedEnd));
  } catch {
    throw new Error(`Package tar ${label} is not valid UTF-8`);
  }
}

function readOctal(block: Buffer, start: number, length: number, label: string): number {
  const value = readString(block, start, length, label).trim();
  if (!/^[0-7]+$/u.test(value)) {
    throw new Error(`Package tar ${label} is not an octal integer`);
  }
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Package tar ${label} is outside the safe integer range`);
  }
  return parsed;
}

function verifyHeaderChecksum(block: Buffer, offset: number): void {
  const expected = readOctal(block, 148, 8, `header checksum at byte ${String(offset)}`);
  let actual = 0;
  for (let index = 0; index < block.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : block[index] ?? 0;
  }
  if (actual !== expected) {
    throw new Error(
      `Package tar header checksum at byte ${String(offset)} is ${String(actual)}, expected ${String(expected)}`,
    );
  }
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function relativePackagePath(path: string, type: "directory" | "file"): string {
  if (!path.startsWith(packagePrefix)) {
    throw new Error(`Package tar entry is outside ${packagePrefix}: ${path}`);
  }
  const untrimmed = path.slice(packagePrefix.length);
  const relative = type === "directory" && untrimmed.endsWith("/")
    ? untrimmed.slice(0, -1)
    : untrimmed;
  const parts = relative.split("/");
  if (
    relative.length === 0
    || Buffer.byteLength(relative, "utf8") > 1_024
    || relative.startsWith("/")
    || relative.includes("\\")
    || hasControlCharacters(relative)
    || parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Package tar entry has an unsafe path: ${path}`);
  }
  return relative;
}

function verifyAllowedPath(path: string, type: "directory" | "file"): void {
  const allowed = type === "file"
    ? path === "DISCLOSURE"
      || path === "LICENSE"
      || path === "README.md"
      || path === "package.json"
      || path.startsWith("dist/")
      || path.startsWith("skills/kb/")
      || path.startsWith("src/")
    : path === "dist"
      || path.startsWith("dist/")
      || path === "skills"
      || path === "skills/kb"
      || path.startsWith("skills/kb/")
      || path === "src"
      || path.startsWith("src/");
  if (!allowed) throw new Error(`Unexpected package path: ${path}`);
  if (type === "file" && /\.(?:property\.)?test\.[cm]?[jt]sx?$/u.test(path)) {
    throw new Error(`Test source entered the package: ${path}`);
  }
  if (type === "file" && path.endsWith("/AGENTS.md") && path !== "skills/kb/AGENTS.md") {
    throw new Error(`Repository guidance entered the package: ${path}`);
  }
  if (/(?:^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$)|node_modules(?:\/|$))/u.test(path)) {
    throw new Error(`Private or development state entered the package: ${path}`);
  }
}

function verifyMode(path: string, type: "directory" | "file", mode: number): void {
  const allowed = type === "directory" ? mode === 0o755 : mode === 0o644 || mode === 0o755;
  if (!allowed) {
    throw new Error(`Package tar entry ${path} has unsupported mode ${mode.toString(8)}`);
  }
}

function verifyBound(label: string, value: number, range: Readonly<{ min: number; max: number }>): void {
  if (value < range.min || value > range.max) {
    throw new Error(
      `Package ${label} ${String(value)} is outside the reviewed range ${String(range.min)}-${String(range.max)}`,
    );
  }
}

function verifyTrailer(tar: Buffer, offset: number): void {
  if (offset + blockSize * 2 > tar.length) {
    throw new Error("Package tar is missing its two-block zero trailer");
  }
  for (let index = offset; index < tar.length; index += 1) {
    if (tar[index] !== 0) {
      throw new Error("Package tar contains data after its zero trailer");
    }
  }
}

export async function inspectPackageArtifact(
  archive: string,
): Promise<PackageArtifactInventory> {
  const compressed = await readFile(archive);
  verifyBound("packed byte count", compressed.byteLength, packageBudget.packedBytes);

  let tar: Buffer;
  try {
    tar = gunzipSync(compressed, { maxOutputLength: maximumTarBytes });
  } catch (error) {
    throw new Error("Package tarball could not be safely decompressed", { cause: error });
  }
  if (tar.length % blockSize !== 0) {
    throw new Error("Package tar length is not aligned to 512-byte records");
  }

  const entries: PackageArtifactEntry[] = [];
  const files: PackageArtifactFile[] = [];
  const directories: PackageArtifactEntry[] = [];
  const seen = new Set<string>();
  let foundTrailer = false;

  let offset = 0;
  while (offset + blockSize <= tar.length) {
    const header = tar.subarray(offset, offset + blockSize);
    if (header.every((byte) => byte === 0)) {
      verifyTrailer(tar, offset);
      foundTrailer = true;
      break;
    }
    verifyHeaderChecksum(header, offset);
    if (!header.subarray(257, 265).equals(ustarSignature)) {
      throw new Error(
        `Package tar header at byte ${String(offset)} lacks the exact USTAR magic/version`,
      );
    }

    const name = readString(header, 0, 100, `entry name at byte ${String(offset)}`);
    const prefix = readString(
      header,
      345,
      header[475] === 0 ? 130 : 155,
      `entry prefix at byte ${String(offset)}`,
    );
    const path = prefix.length > 0 ? `${prefix}/${name}` : name;
    const size = readOctal(header, 124, 12, `entry size for ${path}`);
    const mode = readOctal(header, 100, 8, `entry mode for ${path}`);
    const typeFlag = header[156] ?? 0;
    const type = typeFlag === 0 || typeFlag === 48
      ? "file"
      : typeFlag === 53
        ? "directory"
        : undefined;
    if (type === undefined) {
      throw new Error(
        `Unsupported package tar entry type ${JSON.stringify(String.fromCharCode(typeFlag))}: ${path}`,
      );
    }

    const nextOffset = offset + blockSize + Math.ceil(size / blockSize) * blockSize;
    if (nextOffset > tar.length) {
      throw new Error(`Package tar entry exceeds the archive: ${path}`);
    }
    if (type === "directory" && size !== 0) {
      throw new Error(`Package tar directory has non-zero size: ${path}`);
    }

    const relative = relativePackagePath(path, type);
    verifyAllowedPath(relative, type);
    verifyMode(relative, type, mode);
    if (seen.has(relative)) throw new Error(`Duplicate package path: ${relative}`);
    seen.add(relative);

    if (type === "file") {
      const content = tar.subarray(offset + blockSize, offset + blockSize + size);
      const file = Object.freeze({
        contentSha256: createHash("sha256").update(content).digest("hex"),
        contentSha512: createHash("sha512").update(content).digest("hex"),
        mode,
        path: relative,
        size,
      });
      files.push(file);
      entries.push(Object.freeze({ ...file, type }));
    } else {
      const directory = Object.freeze({ mode, path: relative, size, type });
      directories.push(directory);
      entries.push(directory);
    }
    offset = nextOffset;
  }

  if (!foundTrailer) throw new Error("Package tar is missing its zero trailer");
  entries.sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.type, right.type));
  files.sort((left, right) => compareUtf8(left.path, right.path));
  directories.sort((left, right) => compareUtf8(left.path, right.path));
  for (const path of requiredPaths) {
    if (!files.some((file) => file.path === path)) {
      throw new Error(`Required package path is missing: ${path}`);
    }
  }

  const unpackedBytes = files.reduce((total, file) => total + file.size, 0);
  verifyBound("entry count", entries.length, packageBudget.entryCount);
  verifyBound("file count", files.length, packageBudget.fileCount);
  verifyBound("unpacked byte count", unpackedBytes, packageBudget.unpackedBytes);

  console.log(`Reviewed package inventory (${String(files.length)} files):`);
  for (const file of files) {
    console.log(
      `${file.mode.toString(8).padStart(4, "0")} ${String(file.size).padStart(8, " ")}  ${file.path}  ${file.contentSha256}`,
    );
  }
  console.log(
    `Package budget: ${String(compressed.byteLength)} packed bytes; ${String(unpackedBytes)} unpacked bytes; ${String(files.length)} files; ${String(directories.length)} directories.`,
  );

  return Object.freeze({
    directories: Object.freeze(directories),
    entries: Object.freeze(entries),
    entryCount: entries.length,
    fileCount: files.length,
    files: Object.freeze(files),
    packedBytes: compressed.byteLength,
    unpackedBytes,
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === undefined) {
    throw new Error("Usage: bun run scripts/package-artifact.ts <package.tgz>");
  }
  await inspectPackageArtifact(args[0]);
}
