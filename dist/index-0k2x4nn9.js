// @bun
import {
  MAX_ANALYZED_NOTES,
  analyzeVault,
  isCanonicalNoteId,
  lookupNote,
  normalizeVaultPath,
  parseNote,
  renderCatalog,
  replaceCatalog
} from "./index-ekpwvbra.js";

// src/vault.ts
import { randomUUID } from "crypto";
import { constants } from "fs";
import {
  lstat,
  open,
  readdir,
  realpath,
  rename,
  rm
} from "fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "path";
var MAX_SCANNED_NOTES = MAX_ANALYZED_NOTES;
var MAX_NOTE_UTF8_BYTES = 16 * 1024 * 1024;
var MAX_VAULT_UTF8_BYTES = 256 * 1024 * 1024;

class VaultScanBudgetError extends RangeError {
  kind;
  limit;
  constructor(kind, limit, message) {
    super(message);
    this.name = "VaultScanBudgetError";
    this.kind = kind;
    this.limit = limit;
  }
}
var defaultIgnoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "node_modules"
]);
async function markdownFiles(directory, ignoredDirectories = defaultIgnoredDirectories) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith("."))
      continue;
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name))
        continue;
      files.push(...await markdownFiles(entryPath, ignoredDirectories));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "AGENTS.md") {
      files.push(entryPath);
    }
  }
  return files;
}
function checkedScanLimit(value, hardMaximum, option) {
  const limit = value ?? hardMaximum;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > hardMaximum) {
    throw new RangeError(`${option} must be a safe integer from 0 through ${hardMaximum}.`);
  }
  return limit;
}
function normalizedRawNoteId(rawId) {
  return normalizeVaultPath(rawId).normalize("NFC");
}
function validateScannedNotePaths(root, paths) {
  const files = paths.map((absolutePath) => {
    const vaultPath = relative(root, absolutePath).split(sep).join("/");
    return {
      absolutePath,
      vaultPath,
      rawId: vaultPath.slice(0, -3)
    };
  });
  const pathByNormalizedId = new Map;
  for (const file of files) {
    const normalizedId = normalizedRawNoteId(file.rawId);
    const collision = pathByNormalizedId.get(normalizedId);
    if (collision !== undefined && collision !== file.vaultPath) {
      throw new Error(`Vault note paths ${JSON.stringify(collision)} and ` + `${JSON.stringify(file.vaultPath)} normalize to the same note ID ` + `${JSON.stringify(normalizedId)}.`);
    }
    pathByNormalizedId.set(normalizedId, file.vaultPath);
  }
  for (const file of files) {
    if (isCanonicalNoteId(file.rawId))
      continue;
    if (file.rawId !== file.rawId.normalize("NFC")) {
      throw new Error(`Vault note path ${JSON.stringify(file.vaultPath)} is not NFC; ` + `its extensionless note ID must be exactly ` + `${JSON.stringify(file.rawId.normalize("NFC"))}.`);
    }
    if (file.rawId.includes("\\")) {
      throw new Error(`Vault note path ${JSON.stringify(file.vaultPath)} contains a backslash; ` + "note IDs must use exact vault-root directory separators.");
    }
    throw new Error(`Vault note path ${JSON.stringify(file.vaultPath)} must have an exact ` + "canonical extensionless vault-root note ID.");
  }
  return files;
}
function assertScannableNoteFile(vaultPath, metadata) {
  if (metadata.isSymbolicLink()) {
    throw new Error(`Vault note ${JSON.stringify(vaultPath)} must not be a symbolic link.`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Vault note ${JSON.stringify(vaultPath)} must be a regular file.`);
  }
  if (metadata.nlink !== 1n) {
    throw new Error(`Vault note ${JSON.stringify(vaultPath)} must not be hard-linked.`);
  }
}
function noteBytesError(vaultPath, limit) {
  return new VaultScanBudgetError("note-bytes", limit, `Vault note ${JSON.stringify(vaultPath)} exceeds the ${limit}-byte UTF-8 limit.`);
}
function totalBytesError(limit) {
  return new VaultScanBudgetError("total-bytes", limit, `Vault scan exceeds the ${limit}-byte cumulative UTF-8 limit.`);
}
async function readBoundedNote(handle, vaultPath, maxNoteBytes, remainingTotalBytes, maxTotalBytes) {
  const chunks = [];
  let bytes = 0;
  for (;; ) {
    const remaining = Math.min(maxNoteBytes - bytes, remainingTotalBytes - bytes);
    const buffer = new Uint8Array(Math.min(64 * 1024, Math.max(1, remaining + 1)));
    const result = await handle.read(buffer, 0, buffer.byteLength, null);
    if (result.bytesRead === 0)
      break;
    bytes += result.bytesRead;
    if (bytes > maxNoteBytes)
      throw noteBytesError(vaultPath, maxNoteBytes);
    if (bytes > remainingTotalBytes) {
      throw totalBytesError(maxTotalBytes);
    }
    chunks.push(buffer.slice(0, result.bytesRead));
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(joined),
      bytes
    };
  } catch (error) {
    throw new Error(`Vault note ${JSON.stringify(vaultPath)} is not valid UTF-8.`, { cause: error });
  }
}
async function readVaultNotes(root, ignoredDirectories = defaultIgnoredDirectories, limits = {}) {
  const maxNotes = checkedScanLimit(limits.maxNotes, MAX_SCANNED_NOTES, "maxNotes");
  const maxNoteBytes = checkedScanLimit(limits.maxNoteBytes, MAX_NOTE_UTF8_BYTES, "maxNoteBytes");
  const maxTotalBytes = checkedScanLimit(limits.maxTotalBytes, MAX_VAULT_UTF8_BYTES, "maxTotalBytes");
  const paths = await markdownFiles(root, ignoredDirectories);
  if (paths.length > maxNotes) {
    throw new VaultScanBudgetError("notes", maxNotes, `Vault scan exceeds the ${maxNotes} Markdown note limit.`);
  }
  const files = validateScannedNotePaths(root, paths);
  let declaredTotal = 0n;
  const preflight = [];
  for (const file of files) {
    const metadata = await lstat(file.absolutePath, { bigint: true });
    assertScannableNoteFile(file.vaultPath, metadata);
    if (metadata.size > BigInt(maxNoteBytes)) {
      throw noteBytesError(file.vaultPath, maxNoteBytes);
    }
    declaredTotal += metadata.size;
    if (declaredTotal > BigInt(maxTotalBytes)) {
      throw totalBytesError(maxTotalBytes);
    }
    preflight.push({
      ...file,
      device: metadata.dev,
      inode: metadata.ino
    });
  }
  const notes = [];
  let observedTotal = 0;
  for (const file of preflight) {
    const handle = await open(file.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const beforeRead = await handle.stat({ bigint: true });
      assertScannableNoteFile(file.vaultPath, beforeRead);
      if (beforeRead.dev !== file.device || beforeRead.ino !== file.inode) {
        throw new Error(`Vault note ${JSON.stringify(file.vaultPath)} changed during scan; retry.`);
      }
      if (beforeRead.size > BigInt(maxNoteBytes)) {
        throw noteBytesError(file.vaultPath, maxNoteBytes);
      }
      if (BigInt(observedTotal) + beforeRead.size > BigInt(maxTotalBytes)) {
        throw totalBytesError(maxTotalBytes);
      }
      const read = await readBoundedNote(handle, file.vaultPath, maxNoteBytes, maxTotalBytes - observedTotal, maxTotalBytes);
      const afterRead = await handle.stat({ bigint: true });
      if (afterRead.dev !== file.device || afterRead.ino !== file.inode || afterRead.size !== beforeRead.size || afterRead.size !== BigInt(read.bytes)) {
        throw new Error(`Vault note ${JSON.stringify(file.vaultPath)} changed during scan; retry.`);
      }
      observedTotal += read.bytes;
      notes.push(parseNote(file.vaultPath, read.content));
    } finally {
      await handle.close();
    }
  }
  return notes;
}
function confined(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}
async function assertConfinedIndexParents(root, path) {
  if (!confined(root, path))
    throw new Error("The configured index must be a file inside the vault root.");
  const parent = dirname(path);
  const segments = relative(root, parent).split(sep).filter((segment) => segment !== "");
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error("The configured index path must not traverse a symbolic link.");
    }
    if (!metadata.isDirectory()) {
      throw new Error("Every configured index parent must be a directory.");
    }
  }
  const canonicalParent = await realpath(parent);
  if (!confined(root, join(canonicalParent, basename(path)))) {
    throw new Error("The configured index parent resolves outside the vault root.");
  }
}
async function readIndexRevision(root, path, maxNoteBytes = MAX_NOTE_UTF8_BYTES) {
  await assertConfinedIndexParents(root, path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile())
      throw new Error("The configured index must be a regular file.");
    if (metadata.nlink !== 1n)
      throw new Error("The configured index must not be hard-linked.");
    const canonicalPath = await realpath(path);
    if (!confined(root, canonicalPath)) {
      throw new Error("The configured index resolves outside the vault root.");
    }
    const vaultPath = relative(root, path).split(sep).join("/");
    if (metadata.size > BigInt(maxNoteBytes)) {
      throw noteBytesError(vaultPath, maxNoteBytes);
    }
    const read = await readBoundedNote(handle, vaultPath, maxNoteBytes, maxNoteBytes, maxNoteBytes);
    const afterRead = await handle.stat({ bigint: true });
    if (afterRead.dev !== metadata.dev || afterRead.ino !== metadata.ino || afterRead.size !== metadata.size || afterRead.size !== BigInt(read.bytes)) {
      throw new Error("The configured index changed during scan; retry.");
    }
    return {
      content: read.content,
      device: metadata.dev,
      inode: metadata.ino,
      mode: Number(metadata.mode & 0o777n)
    };
  } finally {
    await handle.close();
  }
}
function sameRevision(left, right) {
  return left.device === right.device && left.inode === right.inode && left.content === right.content;
}
function parsedCatalogMode(value, source) {
  if (value === undefined)
    return;
  if (value === "managed" || value === "authored")
    return value;
  throw new Error(`${source} must be exactly "managed" or "authored".`);
}
function declaredCatalogMode(indexNote) {
  const declaration = Object.entries(indexNote.metadata).find(([name]) => name.toLocaleLowerCase("en-US") === "kb_catalog");
  return parsedCatalogMode(declaration?.[1], `The configured index frontmatter property "kb_catalog"`);
}
async function atomicReplace(root, path, content, expected) {
  const beforeWrite = await readIndexRevision(root, path);
  if (!sameRevision(beforeWrite, expected)) {
    throw new Error("The configured index changed during refresh; retry without overwriting the editor's changes.");
  }
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  await assertConfinedIndexParents(root, path);
  const handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, expected.mode);
  let closed = false;
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    closed = true;
    const beforeRename = await readIndexRevision(root, path);
    if (!sameRevision(beforeRename, expected)) {
      throw new Error("The configured index changed during refresh; retry without overwriting the editor's changes.");
    }
    await assertConfinedIndexParents(root, path);
    await rename(temporaryPath, path);
  } catch (error) {
    if (!closed)
      await handle.close().catch(() => {
        return;
      });
    await rm(temporaryPath, { force: true }).catch(() => {
      return;
    });
    throw error;
  }
}
async function snapshot(rootInput, options, writeIndex) {
  const requestedRoot = resolve(rootInput);
  const root = await realpath(requestedRoot);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory())
    throw new Error("The vault root must be a directory.");
  const indexPath = resolve(root, options.index ?? "index.md");
  const relativeIndex = relative(root, indexPath);
  if (!confined(root, indexPath)) {
    throw new Error("The configured index must be a file inside the vault root.");
  }
  if (!indexPath.toLowerCase().endsWith(".md")) {
    throw new Error("The configured index must be a Markdown file.");
  }
  const vaultIndexPath = relativeIndex.split(sep).join("/");
  const catalogNoteId = vaultIndexPath.toLowerCase().endsWith(".md") ? vaultIndexPath.slice(0, -3) : vaultIndexPath;
  const notes = await readVaultNotes(root, options.ignoredDirectories, {
    ...options.maxNotes === undefined ? {} : { maxNotes: options.maxNotes },
    ...options.maxNoteBytes === undefined ? {} : { maxNoteBytes: options.maxNoteBytes },
    ...options.maxTotalBytes === undefined ? {} : { maxTotalBytes: options.maxTotalBytes }
  });
  const indexRevision = await readIndexRevision(root, indexPath, options.maxNoteBytes ?? MAX_NOTE_UTF8_BYTES);
  const currentIndex = indexRevision.content;
  const indexNote = parseNote(vaultIndexPath, currentIndex);
  const catalogMode = parsedCatalogMode(options.catalogMode, "ScanVaultOptions.catalogMode") ?? declaredCatalogMode(indexNote) ?? "managed";
  let index = "authored";
  if (catalogMode === "managed") {
    const expectedIndex = replaceCatalog(currentIndex, renderCatalog(notes, catalogNoteId));
    const stale = currentIndex !== expectedIndex;
    index = stale ? "stale" : "current";
    if (writeIndex && stale) {
      await atomicReplace(root, indexPath, expectedIndex, indexRevision);
      index = "updated";
      const parsed = parseNote(vaultIndexPath, expectedIndex);
      const noteIndex = notes.findIndex((note) => note.path === vaultIndexPath);
      if (noteIndex === -1)
        notes.push(parsed);
      else
        notes[noteIndex] = parsed;
    }
  }
  const mentionScope = options.mentionScope;
  const mentionIds = new Set;
  if (typeof mentionScope === "string") {
    const lookup = lookupNote(notes, mentionScope);
    if (lookup.kind === "found")
      mentionIds.add(lookup.note.id);
    else if (lookup.kind === "ambiguous") {
      for (const note of lookup.candidates)
        mentionIds.add(note.id);
    }
  }
  const mentionScopePredicate = mentionScope === undefined ? undefined : (note) => mentionScope !== false && mentionIds.has(note.id);
  return {
    root,
    indexPath,
    catalogMode,
    index,
    notes,
    analysis: analyzeVault(notes, {
      catalogNoteId,
      ...options.includeInSuggestions === undefined ? {} : { includeInSuggestions: options.includeInSuggestions },
      ...mentionScopePredicate === undefined ? {} : { mentionScope: mentionScopePredicate },
      ...options.maxNotes === undefined ? {} : { maxNotes: options.maxNotes },
      ...options.maxConnectionObservations === undefined ? {} : { maxConnectionObservations: options.maxConnectionObservations },
      ...options.maxMentionPairs === undefined ? {} : { maxMentionPairs: options.maxMentionPairs },
      ...options.maxMentions === undefined ? {} : { maxMentions: options.maxMentions }
    })
  };
}
async function scanVault(root = ".", options = {}) {
  return snapshot(root, options, false);
}
async function refreshVault(root = ".", options = {}) {
  return snapshot(root, options, true);
}

export { MAX_SCANNED_NOTES, MAX_NOTE_UTF8_BYTES, MAX_VAULT_UTF8_BYTES, VaultScanBudgetError, defaultIgnoredDirectories, markdownFiles, readVaultNotes, scanVault, refreshVault };
