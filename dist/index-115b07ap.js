// @bun
import {
  MAX_NOTE_UTF8_BYTES,
  MAX_SCANNED_NOTES,
  MAX_VAULT_UTF8_BYTES,
  VaultScanBudgetError,
  scanVault
} from "./index-0k2x4nn9.js";
import {
  fuseRankedCandidates,
  validateSearchQuery
} from "./index-why54q5p.js";

// src/semantic.ts
import { createHash as createHash2 } from "crypto";
import { constants as constants2 } from "fs";
import {
  chmod,
  lstat as lstat2,
  mkdir as mkdir2,
  mkdtemp,
  open as open2,
  realpath as realpath2,
  rm as rm2,
  stat
} from "fs/promises";
import { homedir, tmpdir } from "os";
import { dirname as dirname2, isAbsolute as isAbsolute2, join as join2, relative as relative2, resolve as resolve2, sep as sep2 } from "path";

// src/semantic-runtime.ts
import { createHash, randomUUID } from "crypto";
import {
  constants
} from "fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
  writeFile
} from "fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
var LEASE_VERSION = 1;
var PROJECTION_VERSION = 2;
var DEFAULT_LEASE_WAIT_MS = 30000;
var DEFAULT_LEASE_POLL_MS = 25;
var MAX_LEASE_WAIT_MS = 10 * 60000;
var MAX_LEASE_POLL_MS = 1000;
var GENERATION_PREFIX = "generation-";
var READER_PREFIX = ".reader-";
var MANIFEST_NAME = "manifest.json";
var OWNER_NAME = "owner.json";
var SNAPSHOT_OWNER_NAME = ".hraness-kb-semantic-cache.json";
var SNAPSHOT_OWNER_VERSION = 1;
var SNAPSHOT_OWNER_KIND = "@hraness/kb/semantic-projection-cache";
var MAX_OWNER_BYTES = 4 * 1024;
var MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
var MAX_CACHE_DIRECTORY_ENTRIES = 1024;
var MAX_INDEX_IDENTITY_BYTES = 16 * 1024;
var MAX_INDEX_IDENTITY_STRING_BYTES = 4 * 1024;
var MAX_INDEX_IDENTITY_ENTRIES = 64;
function errorCode(error) {
  if (typeof error !== "object" || error === null || !("code" in error))
    return;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}
function checkedLeaseBound(value, fallback, maximum, label) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new RangeError(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return result;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function checkedIdentityString(value, label) {
  const bytes = Buffer.byteLength(value, "utf8");
  if (value === "" || bytes > MAX_INDEX_IDENTITY_STRING_BYTES) {
    throw new RangeError(`${label} must contain from 1 through ${MAX_INDEX_IDENTITY_STRING_BYTES.toLocaleString("en-US")} UTF-8 bytes.`);
  }
  return value;
}
function validatedIndexIdentity(identity) {
  if (!Number.isSafeInteger(identity.producer.schema) || identity.producer.schema < 1) {
    throw new RangeError("Semantic index producer schema must be a positive safe integer.");
  }
  if (identity.collection.ignore.length > MAX_INDEX_IDENTITY_ENTRIES || identity.collection.pathContexts.length > MAX_INDEX_IDENTITY_ENTRIES) {
    throw new RangeError(`Semantic index identity collections are limited to ${MAX_INDEX_IDENTITY_ENTRIES} entries.`);
  }
  const validated = {
    producer: {
      package: checkedIdentityString(identity.producer.package, "Semantic index producer package"),
      schema: identity.producer.schema
    },
    indexer: {
      package: checkedIdentityString(identity.indexer.package, "Semantic indexer package"),
      version: checkedIdentityString(identity.indexer.version, "Semantic indexer version")
    },
    collection: {
      name: checkedIdentityString(identity.collection.name, "Semantic collection name"),
      pattern: checkedIdentityString(identity.collection.pattern, "Semantic collection pattern"),
      ignore: identity.collection.ignore.map((pattern) => checkedIdentityString(pattern, "Semantic collection ignore pattern")),
      globalContext: checkedIdentityString(identity.collection.globalContext, "Semantic collection global context"),
      pathContexts: identity.collection.pathContexts.map((entry) => ({
        path: checkedIdentityString(entry.path, "Semantic collection context path"),
        context: checkedIdentityString(entry.context, "Semantic collection path context")
      }))
    },
    embedding: {
      model: checkedIdentityString(identity.embedding.model, "Semantic embedding model"),
      chunkStrategy: checkedIdentityString(identity.embedding.chunkStrategy, "Semantic embedding chunk strategy")
    }
  };
  if (Buffer.byteLength(JSON.stringify(validated), "utf8") > MAX_INDEX_IDENTITY_BYTES) {
    throw new RangeError(`Semantic index identity exceeds the ${MAX_INDEX_IDENTITY_BYTES.toLocaleString("en-US")}-byte limit.`);
  }
  return validated;
}
async function boundedMetadataText(path, maximum, label) {
  const pathBefore = await lstat(path, { bigint: true });
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile() || pathBefore.nlink !== 1n) {
    throw new Error(`${label} must be a regular, singly linked file.`);
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.dev !== pathBefore.dev || before.ino !== pathBefore.ino) {
      throw new Error(`${label} must be a regular, singly linked file.`);
    }
    if (before.size > BigInt(maximum)) {
      throw new RangeError(`${label} exceeds the ${maximum.toLocaleString("en-US")}-byte metadata limit.`);
    }
    const chunks = [];
    let bytes = 0;
    for (;; ) {
      const remaining = maximum - bytes;
      const buffer = new Uint8Array(Math.min(64 * 1024, remaining + 1));
      const result = await handle.read(buffer, 0, buffer.byteLength, null);
      if (result.bytesRead === 0)
        break;
      bytes += result.bytesRead;
      if (bytes > maximum) {
        throw new RangeError(`${label} exceeds the ${maximum.toLocaleString("en-US")}-byte metadata limit.`);
      }
      chunks.push(buffer.slice(0, result.bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    let pathAfter;
    try {
      pathAfter = await lstat(path, { bigint: true });
    } catch {
      throw new Error(`${label} changed while it was being read; retry.`);
    }
    if (!after.isFile() || after.nlink !== 1n || after.dev !== before.dev || after.ino !== before.ino || after.size !== BigInt(bytes) || pathAfter.dev !== before.dev || pathAfter.ino !== before.ino) {
      throw new Error(`${label} changed while it was being read; retry.`);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(joined);
  } finally {
    await handle.close();
  }
}
async function safeDirectory(path, label) {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink())
      throw new Error(`${label} must not be a symbolic link.`);
    if (!metadata.isDirectory())
      throw new Error(`${label} must be a directory.`);
    return "directory";
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return "absent";
    throw error;
  }
}
async function canonicalProspectiveDirectory(path) {
  const missing = [];
  let candidate = resolve(path);
  for (;; ) {
    try {
      return resolve(await realpath(candidate), ...missing.toReversed());
    } catch (error) {
      if (errorCode(error) !== "ENOENT")
        throw error;
      const parent = dirname(candidate);
      if (parent === candidate)
        throw error;
      missing.push(basename(candidate));
      candidate = parent;
    }
  }
}
async function validateSemanticDatabaseFile(path) {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return;
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error("Semantic database must not be a symbolic link.");
  }
  if (!metadata.isFile() || metadata.nlink !== 1n) {
    throw new Error("Semantic database must be a regular, singly linked file.");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const current = await handle.stat({ bigint: true });
    if (!current.isFile() || current.nlink !== 1n || current.dev !== metadata.dev || current.ino !== metadata.ino) {
      throw new Error("Semantic database must be a regular, singly linked file.");
    }
  } finally {
    await handle.close();
  }
}
async function canonicalSemanticDatabasePath(database) {
  const requested = resolve(database);
  const canonicalParent = await canonicalProspectiveDirectory(dirname(requested));
  const canonical = join(canonicalParent, basename(requested));
  await validateSemanticDatabaseFile(canonical);
  try {
    return await realpath(canonical);
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return canonical;
    throw error;
  }
}
async function settledSemanticDatabasePath(database) {
  const canonical = await canonicalSemanticDatabasePath(database);
  await mkdir(dirname(canonical), { recursive: true, mode: 448 });
  const settledParent = await realpath(dirname(canonical));
  if (settledParent !== dirname(canonical)) {
    throw new Error("Semantic database parent changed while settling its identity; retry.");
  }
  let created;
  try {
    created = await open(canonical, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 384);
  } catch (error) {
    if (errorCode(error) !== "EEXIST")
      throw error;
  } finally {
    await created?.close();
  }
  await validateSemanticDatabaseFile(canonical);
  return await realpath(canonical);
}
function pathIsWithin(root, candidate) {
  return candidate === root || confinedPath(root, candidate);
}
function assertSemanticCacheOutsideVault(root, database) {
  const ownedPaths = [
    database,
    `${database}.writer-lease`,
    `${database}.snapshot`
  ];
  if (ownedPaths.some((path) => pathIsWithin(root, path) || pathIsWithin(path, root))) {
    throw new Error("Semantic database, lease, and snapshot paths must not overlap the vault root.");
  }
}
async function resolveSemanticDatabase(database, root) {
  const [canonicalDatabase, canonicalRoot] = await Promise.all([
    canonicalSemanticDatabasePath(database),
    realpath(root)
  ]);
  assertSemanticCacheOutsideVault(canonicalRoot, canonicalDatabase);
  return canonicalDatabase;
}
function parsedOwner(value) {
  if (!isRecord(value) || value.version !== LEASE_VERSION || !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.token !== "string" || value.token.length < 16 || value.token.length > 128 || typeof value.acquiredAt !== "string") {
    return null;
  }
  return {
    version: LEASE_VERSION,
    pid: value.pid,
    token: value.token,
    acquiredAt: value.acquiredAt
  };
}
async function readOwner(path) {
  try {
    return parsedOwner(JSON.parse(await boundedMetadataText(join(path, OWNER_NAME), MAX_OWNER_BYTES, "Semantic lease owner")));
  } catch (error) {
    if (error instanceof RangeError)
      throw error;
    return null;
  }
}
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}
async function recoverDeadLease(path) {
  if (await safeDirectory(path, "Semantic writer lease") === "absent")
    return false;
  const owner = await readOwner(path);
  if (owner === null || processIsAlive(owner.pid))
    return false;
  const confirmed = await readOwner(path);
  if (confirmed?.pid !== owner.pid || confirmed.token !== owner.token)
    return false;
  const tombstone = `${path}.dead-${owner.token}-${randomUUID()}`;
  try {
    await rename(path, tombstone);
  } catch (error) {
    if (["ENOENT", "EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? ""))
      return false;
    throw error;
  }
  await rm(tombstone, { recursive: true, force: true });
  return true;
}
async function acquireWriterLeaseState(database, options) {
  const waitMs = checkedLeaseBound(options.waitMs, DEFAULT_LEASE_WAIT_MS, MAX_LEASE_WAIT_MS, "Semantic writer lease wait");
  const pollMs = checkedLeaseBound(options.pollMs, DEFAULT_LEASE_POLL_MS, MAX_LEASE_POLL_MS, "Semantic writer lease poll interval");
  const canonicalDatabase = await settledSemanticDatabasePath(database);
  const path = `${canonicalDatabase}.writer-lease`;
  const owner = {
    version: LEASE_VERSION,
    pid: process.pid,
    token: randomUUID(),
    acquiredAt: new Date().toISOString()
  };
  const startedAt = Date.now();
  for (;; ) {
    await safeDirectory(path, "Semantic writer lease");
    const claim = `${path}.claim-${process.pid}-${owner.token}`;
    await mkdir(claim, { mode: 448 });
    try {
      await writeFile(join(claim, OWNER_NAME), `${JSON.stringify(owner)}
`, {
        encoding: "utf8",
        flag: "wx",
        mode: 384
      });
      try {
        await rename(claim, path);
        const lease = { path, owner, database: canonicalDatabase };
        try {
          await validateSemanticDatabaseFile(canonicalDatabase);
          return lease;
        } catch (error) {
          await releaseWriterLease(lease);
          throw error;
        }
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? ""))
          throw error;
      }
    } finally {
      await rm(claim, { recursive: true, force: true });
    }
    if (await recoverDeadLease(path))
      continue;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= waitMs) {
      throw new Error(`Timed out after ${waitMs}ms waiting for the semantic writer lease for ${JSON.stringify(resolve(database))}.`);
    }
    await Bun.sleep(Math.min(pollMs, waitMs - elapsed));
  }
}
async function releaseWriterLease(lease) {
  if (await safeDirectory(lease.path, "Semantic writer lease") === "absent")
    return;
  const current = await readOwner(lease.path);
  if (current?.pid !== lease.owner.pid || current.token !== lease.owner.token)
    return;
  const tombstone = `${lease.path}.release-${lease.owner.token}`;
  try {
    await rename(lease.path, tombstone);
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return;
    throw error;
  }
  await rm(tombstone, { recursive: true, force: true });
}
async function acquireSemanticWriterLease(database, options = {}) {
  const lease = await acquireWriterLeaseState(database, options);
  let released = false;
  return {
    release: async () => {
      if (released)
        return;
      released = true;
      await releaseWriterLease(lease);
    }
  };
}
function confinedPath(root, path) {
  const candidate = relative(root, path);
  return candidate !== "" && candidate !== ".." && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate);
}
function validatedProjectionNotes(notes) {
  if (notes.length > MAX_SCANNED_NOTES) {
    throw new VaultScanBudgetError("notes", MAX_SCANNED_NOTES, `Vault scan exceeds the ${MAX_SCANNED_NOTES} Markdown note limit.`);
  }
  const paths = new Set;
  const validated = [];
  let totalBytes = 0;
  for (const note of notes) {
    const path = note.path;
    const segments = path.split("/");
    if (path === "" || isAbsolute(path) || path.includes("\\") || !path.endsWith(".md") || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`Semantic projection note path ${JSON.stringify(path)} is invalid.`);
    }
    if (paths.has(path)) {
      throw new Error(`Semantic projection note path ${JSON.stringify(path)} is duplicated.`);
    }
    paths.add(path);
    const bytes = Buffer.byteLength(note.content, "utf8");
    if (bytes > MAX_NOTE_UTF8_BYTES) {
      throw new VaultScanBudgetError("note-bytes", MAX_NOTE_UTF8_BYTES, `Vault note ${JSON.stringify(path)} exceeds the ${MAX_NOTE_UTF8_BYTES}-byte UTF-8 limit.`);
    }
    totalBytes += bytes;
    if (totalBytes > MAX_VAULT_UTF8_BYTES) {
      throw new VaultScanBudgetError("total-bytes", MAX_VAULT_UTF8_BYTES, `Vault scan exceeds the ${MAX_VAULT_UTF8_BYTES}-byte cumulative UTF-8 limit.`);
    }
    validated.push({
      path,
      sha256: createHash("sha256").update(note.content).digest("hex"),
      bytes
    });
  }
  return { notes: validated, totalBytes };
}
async function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close().catch(() => {
      return;
    });
    await rm(temporary, { force: true }).catch(() => {
      return;
    });
  }
}
function snapshotCacheOwner(database) {
  return {
    version: SNAPSHOT_OWNER_VERSION,
    kind: SNAPSHOT_OWNER_KIND,
    databaseIdentity: resolve(database)
  };
}
async function assertOwnedSnapshotCache(database, snapshotDirectory) {
  if (await safeDirectory(snapshotDirectory, "Semantic snapshot cache") === "absent") {
    return "absent";
  }
  const expected = snapshotCacheOwner(database);
  let actual;
  try {
    actual = JSON.parse(await boundedMetadataText(join(snapshotDirectory, SNAPSHOT_OWNER_NAME), MAX_OWNER_BYTES, "Semantic snapshot cache owner"));
  } catch {
    throw new Error(`Semantic snapshot cache ${JSON.stringify(snapshotDirectory)} is unowned or has an incompatible ownership marker; remove this disposable directory explicitly before retrying.`);
  }
  if (!isRecord(actual) || actual.version !== expected.version || actual.kind !== expected.kind || actual.databaseIdentity !== expected.databaseIdentity) {
    throw new Error(`Semantic snapshot cache ${JSON.stringify(snapshotDirectory)} is unowned or has an incompatible ownership marker; remove this disposable directory explicitly before retrying.`);
  }
  return "owned";
}
async function ensureOwnedSnapshotCache(database, snapshotDirectory) {
  if (await assertOwnedSnapshotCache(database, snapshotDirectory) === "owned")
    return;
  const temporary = `${snapshotDirectory}.initialize-${process.pid}-${randomUUID()}`;
  await mkdir(temporary, { mode: 448 });
  try {
    await writeFile(join(temporary, SNAPSHOT_OWNER_NAME), `${JSON.stringify(snapshotCacheOwner(database))}
`, { encoding: "utf8", flag: "wx", mode: 384 });
    try {
      await rename(temporary, snapshotDirectory);
      return;
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? ""))
        throw error;
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  await assertOwnedSnapshotCache(database, snapshotDirectory);
}
async function existingGenerationMatches(generationPath, manifest, manifestText) {
  try {
    if (await safeDirectory(generationPath, "Semantic projection generation") === "absent") {
      return false;
    }
    if (await boundedMetadataText(join(generationPath, MANIFEST_NAME), MAX_MANIFEST_BYTES, "Semantic projection manifest") !== manifestText) {
      return false;
    }
    for (const entry of manifest.notes) {
      const path = resolve(generationPath, ...entry.path.split("/"));
      if (!confinedPath(generationPath, path))
        return false;
      const content = await boundedMetadataText(path, MAX_NOTE_UTF8_BYTES, `Semantic projection note ${JSON.stringify(entry.path)}`);
      if (Buffer.byteLength(content, "utf8") !== entry.bytes || createHash("sha256").update(content).digest("hex") !== entry.sha256) {
        return false;
      }
    }
    const expectedNotes = new Set(manifest.notes.map(({ path }) => join(...path.split("/"))));
    const expectedDirectories = new Set;
    for (const path of expectedNotes) {
      let parent = dirname(path);
      while (parent !== ".") {
        expectedDirectories.add(parent);
        parent = dirname(parent);
      }
    }
    const pending = [generationPath];
    let entries = 0;
    const maximumEntries = manifest.notes.length + expectedDirectories.size + MAX_CACHE_DIRECTORY_ENTRIES + 1;
    while (pending.length > 0) {
      const directoryPath = pending.pop();
      if (directoryPath === undefined)
        break;
      const directory = await opendir(directoryPath);
      try {
        for await (const entry of directory) {
          entries += 1;
          if (entries > maximumEntries || entry.isSymbolicLink())
            return false;
          const absolute = join(directoryPath, entry.name);
          const path = relative(generationPath, absolute);
          if (entry.isDirectory()) {
            if (!expectedDirectories.has(path))
              return false;
            pending.push(absolute);
            continue;
          }
          if (!entry.isFile())
            return false;
          if (path === MANIFEST_NAME || expectedNotes.has(path))
            continue;
          if (dirname(path) === "." && entry.name.startsWith(READER_PREFIX) && entry.name.endsWith(".json")) {
            continue;
          }
          return false;
        }
      } finally {
        try {
          await directory.close();
        } catch {}
      }
    }
    return true;
  } catch (error) {
    if (error instanceof RangeError || error instanceof Error && error.message.includes("symbolic link")) {
      throw error;
    }
    return false;
  }
}
async function materializeGeneration(snapshotDirectory, generationPath, manifest, manifestText, notesByPath) {
  if (await existingGenerationMatches(generationPath, manifest, manifestText))
    return;
  if (await safeDirectory(generationPath, "Semantic projection generation") === "directory") {
    if (await activeGenerationReaders(generationPath) > 0) {
      throw new Error("Semantic projection cache verification failed while this generation still has active readers; close those sessions and retry the repair.");
    }
    await rm(generationPath, { recursive: true, force: true });
  }
  const temporary = join(snapshotDirectory, `.temporary-${process.pid}-${randomUUID()}`);
  await mkdir(temporary, { recursive: true, mode: 448 });
  try {
    for (const entry of manifest.notes) {
      const note = notesByPath.get(entry.path);
      if (note === undefined) {
        throw new Error(`Semantic projection lost note ${JSON.stringify(entry.path)}.`);
      }
      const bytes = Buffer.byteLength(note.content, "utf8");
      const sha256 = createHash("sha256").update(note.content).digest("hex");
      if (bytes !== entry.bytes || sha256 !== entry.sha256) {
        throw new Error(`Semantic projection note ${JSON.stringify(entry.path)} changed after validation.`);
      }
      const destination = resolve(temporary, ...entry.path.split("/"));
      if (!confinedPath(temporary, destination)) {
        throw new Error(`Semantic projection path ${JSON.stringify(entry.path)} escapes its generation.`);
      }
      await mkdir(dirname(destination), { recursive: true, mode: 448 });
      await writeFile(destination, note.content, {
        encoding: "utf8",
        flag: "wx",
        mode: 384
      });
    }
    await atomicWrite(join(temporary, MANIFEST_NAME), manifestText);
    await rename(temporary, generationPath);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
function readerOwnerName(owner) {
  return `${READER_PREFIX}${owner.pid}-${owner.token}.json`;
}
async function activeGenerationReaders(generation) {
  let directory;
  try {
    directory = await opendir(generation);
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      return 0;
    throw error;
  }
  let active = 0;
  let readerEntries = 0;
  try {
    for await (const entry of directory) {
      if (!entry.isFile() || !entry.name.startsWith(READER_PREFIX) || !entry.name.endsWith(".json")) {
        continue;
      }
      readerEntries += 1;
      if (readerEntries > MAX_CACHE_DIRECTORY_ENTRIES) {
        throw new RangeError("Semantic projection generation has too many reader entries.");
      }
      const path = join(generation, entry.name);
      let owner;
      try {
        owner = parsedOwner(JSON.parse(await boundedMetadataText(path, MAX_OWNER_BYTES, "Semantic projection reader")));
      } catch (error) {
        if (error instanceof RangeError)
          throw error;
        owner = null;
      }
      if (owner !== null && processIsAlive(owner.pid)) {
        active += 1;
      } else {
        await rm(path, { force: true });
      }
    }
  } finally {
    try {
      await directory.close();
    } catch {}
  }
  return active;
}
async function activeReaderGenerations(database) {
  const canonicalDatabase = await canonicalSemanticDatabasePath(database);
  const snapshotDirectory = `${canonicalDatabase}.snapshot`;
  if (await assertOwnedSnapshotCache(canonicalDatabase, snapshotDirectory) === "absent") {
    return new Set;
  }
  const active = new Set;
  const directory = await opendir(snapshotDirectory);
  let entries = 0;
  try {
    for await (const entry of directory) {
      entries += 1;
      if (entries > MAX_CACHE_DIRECTORY_ENTRIES) {
        throw new RangeError("Semantic snapshot cache has too many metadata entries.");
      }
      if (!entry.isDirectory() || !entry.name.startsWith(GENERATION_PREFIX))
        continue;
      if (await activeGenerationReaders(join(snapshotDirectory, entry.name)) > 0) {
        active.add(entry.name);
      }
    }
  } finally {
    try {
      await directory.close();
    } catch {}
  }
  return active;
}
async function withSemanticGenerationWriterLease(database, generation, operation, options = {}) {
  if (!generation.startsWith(GENERATION_PREFIX)) {
    throw new Error("Semantic projection generation is invalid.");
  }
  if (options.excludeReaders !== undefined && typeof options.excludeReaders !== "boolean") {
    throw new TypeError("Semantic writer excludeReaders must be a boolean.");
  }
  const waitMs = checkedLeaseBound(options.waitMs, DEFAULT_LEASE_WAIT_MS, MAX_LEASE_WAIT_MS, "Semantic writer lease wait");
  const pollMs = checkedLeaseBound(options.pollMs, DEFAULT_LEASE_POLL_MS, MAX_LEASE_POLL_MS, "Semantic writer lease poll interval");
  const readerDescription = options.excludeReaders === true ? "semantic projection readers" : "readers of an older semantic projection";
  const startedAt = Date.now();
  for (;; ) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= waitMs) {
      throw new Error(`Timed out after ${waitMs}ms waiting for ${readerDescription} to close.`);
    }
    const lease = await acquireSemanticWriterLease(database, {
      waitMs: Math.max(1, waitMs - elapsed),
      pollMs
    });
    let compatible = false;
    try {
      const active = await activeReaderGenerations(database);
      compatible = options.excludeReaders === true ? active.size === 0 : [...active].every((candidate) => candidate === generation);
      if (compatible)
        return await operation();
    } finally {
      await lease.release();
    }
    const waited = Date.now() - startedAt;
    if (waited >= waitMs) {
      throw new Error(`Timed out after ${waitMs}ms waiting for ${readerDescription} to close.`);
    }
    await Bun.sleep(Math.min(pollMs, waitMs - waited));
  }
}
async function cleanUnusedGenerations(snapshotDirectory, currentGeneration) {
  const directory = await opendir(snapshotDirectory);
  let entries = 0;
  try {
    for await (const entry of directory) {
      entries += 1;
      if (entries > MAX_CACHE_DIRECTORY_ENTRIES) {
        throw new RangeError("Semantic snapshot cache has too many metadata entries.");
      }
      if (!entry.isDirectory())
        continue;
      const path = join(snapshotDirectory, entry.name);
      if (entry.name.startsWith(".temporary-")) {
        await rm(path, { recursive: true, force: true });
        continue;
      }
      if (!entry.name.startsWith(GENERATION_PREFIX) || entry.name === currentGeneration)
        continue;
      if (await activeGenerationReaders(path) === 0) {
        await rm(path, { recursive: true, force: true });
      }
    }
  } finally {
    try {
      await directory.close();
    } catch {}
  }
}
async function describeSemanticProjection(database, root, notes, indexIdentity) {
  const [canonicalRoot, prospectiveDatabase] = await Promise.all([
    realpath(root),
    canonicalSemanticDatabasePath(database)
  ]);
  assertSemanticCacheOutsideVault(canonicalRoot, prospectiveDatabase);
  const validated = validatedProjectionNotes(notes);
  const validatedIdentity = validatedIndexIdentity(indexIdentity);
  const canonicalDatabase = await settledSemanticDatabasePath(prospectiveDatabase);
  assertSemanticCacheOutsideVault(canonicalRoot, canonicalDatabase);
  const identity = createHash("sha256").update(JSON.stringify({
    version: PROJECTION_VERSION,
    indexIdentity: validatedIdentity,
    root: canonicalRoot,
    notes: validated.notes,
    totalBytes: validated.totalBytes
  })).digest("hex");
  const generation = `${GENERATION_PREFIX}${identity.slice(0, 32)}`;
  const snapshotDirectory = `${canonicalDatabase}.snapshot`;
  const generationPath = join(snapshotDirectory, generation);
  const manifest = {
    version: PROJECTION_VERSION,
    indexIdentity: validatedIdentity,
    root: canonicalRoot,
    generation,
    notes: validated.notes,
    totalBytes: validated.totalBytes
  };
  const manifestText = `${JSON.stringify(manifest)}
`;
  if (Buffer.byteLength(manifestText) > MAX_MANIFEST_BYTES) {
    throw new RangeError(`Semantic projection manifest exceeds the ${MAX_MANIFEST_BYTES}-byte metadata limit.`);
  }
  return {
    database: canonicalDatabase,
    snapshotDirectory,
    generationPath,
    manifest,
    manifestText
  };
}
async function prepareSemanticProjection(description, notes) {
  const { database, snapshotDirectory, generationPath, manifest, manifestText } = description;
  const validated = validatedProjectionNotes(notes);
  if (validated.totalBytes !== manifest.totalBytes || JSON.stringify(validated.notes) !== JSON.stringify(manifest.notes)) {
    throw new Error("Semantic projection notes changed after validation.");
  }
  const notesByPath = new Map(notes.map((note) => [note.path, note]));
  await ensureOwnedSnapshotCache(database, snapshotDirectory);
  await materializeGeneration(snapshotDirectory, generationPath, manifest, manifestText, notesByPath);
  const reader = {
    version: LEASE_VERSION,
    pid: process.pid,
    token: randomUUID(),
    acquiredAt: new Date().toISOString()
  };
  const readerPath = join(generationPath, readerOwnerName(reader));
  await writeFile(readerPath, `${JSON.stringify(reader)}
`, {
    encoding: "utf8",
    flag: "wx",
    mode: 384
  });
  try {
    await atomicWrite(join(snapshotDirectory, MANIFEST_NAME), manifestText);
    await cleanUnusedGenerations(snapshotDirectory, manifest.generation);
  } catch (error) {
    await rm(readerPath, { force: true });
    throw error;
  }
  let released = false;
  return {
    root: generationPath,
    manifest,
    release: async () => {
      if (released)
        return;
      released = true;
      await rm(readerPath, { force: true });
    }
  };
}

// src/semantic.ts
var recommendedEmbeddingModel = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf#0f741b5a6585bd53aeb15cd1372c56f2a0f65e12";
var recommendedEmbeddingModelSha256 = "b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63";
var MAX_EMBEDDING_MODEL_BYTES = 2 * 1024 * 1024 * 1024;
var MAX_SEMANTIC_DATABASE_IDENTITY_BYTES = 16 * 1024;
var MAX_SEMANTIC_READ_SNAPSHOT_BYTES = 16 * 1024 * 1024 * 1024;
var SHA256 = /^[0-9a-f]{64}$/u;
var semanticIndexSchema = 1;
var qmdIndexerVersion = "2.5.3+hraness.aa993dceb3ef8cfb71d470554ca437570f5a2b3c";
var collectionName = "kb";
var markdownPattern = "**/*.md";
var ignoredPatterns = ["index.md", "**/AGENTS.md"];
var embeddingChunkStrategy = "regex";
var globalContext = "A Markdown knowledge base. Source records preserve evidence; maintained notes contain current synthesis; explicit wikilinks define structural relationships.";
var collectionContext = {
  "/": "Knowledge-base notes, clipped sources, plans, reports, and explicit contextual links.",
  "/articles": "Captured source records and their acquisition provenance.",
  "/notes": "Maintained concepts, comparisons, and current synthesis.",
  "/plans": "Decisions, constraints, execution state, and verification evidence.",
  "/riffs": "Voice-preserving first-person source thought."
};
var recommendedEmbeddingModelIdentity = `${recommendedEmbeddingModel}@sha256:${recommendedEmbeddingModelSha256}`;
var semanticIndexIdentity = {
  producer: { package: "@hraness/kb", schema: semanticIndexSchema },
  indexer: { package: "@tobilu/qmd", version: qmdIndexerVersion },
  collection: {
    name: collectionName,
    pattern: markdownPattern,
    ignore: ignoredPatterns,
    globalContext,
    pathContexts: Object.entries(collectionContext).map(([path, context]) => ({ path, context }))
  },
  embedding: {
    model: recommendedEmbeddingModelIdentity,
    chunkStrategy: embeddingChunkStrategy
  }
};
var qmdModuleSpecifier = "@tobilu/qmd";
async function sha256EmbeddingModelFile(path) {
  const handle = await open2(path, constants2.O_RDONLY | constants2.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile())
      throw new TypeError("The embedding model must be a regular file.");
    if (metadata.size > MAX_EMBEDDING_MODEL_BYTES) {
      throw new RangeError(`The embedding model exceeds ${MAX_EMBEDDING_MODEL_BYTES.toLocaleString("en-US")} bytes.`);
    }
    const hash = createHash2("sha256");
    const buffer = new Uint8Array(1024 * 1024);
    let observed = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0)
        break;
      observed += bytesRead;
      if (observed > MAX_EMBEDDING_MODEL_BYTES) {
        throw new RangeError(`The embedding model exceeds ${MAX_EMBEDDING_MODEL_BYTES.toLocaleString("en-US")} bytes.`);
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (after.size !== metadata.size || observed !== metadata.size) {
      throw new Error("The embedding model changed while its digest was computed; retry.");
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
var verifiedEmbeddingModelLeaseStates = new WeakMap;
async function writeEmbeddingModelBytes(destination, bytes) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await destination.write(bytes, offset, bytes.byteLength - offset, null);
    if (written.bytesWritten < 1)
      throw new Error("The embedding model snapshot write stalled.");
    offset += written.bytesWritten;
  }
}
async function verifiedIndexEmbeddingModelSource(path, dependencies) {
  if (path === undefined) {
    return Object.freeze({ source: recommendedEmbeddingModel, release: () => Promise.resolve() });
  }
  const sourcePath = resolve2(path);
  const directory = await mkdtemp(join2(tmpdir(), "hraness-wordcell-embedding-model-"));
  const destinationPath = join2(directory, "pinned-model.gguf");
  let source;
  let destination;
  try {
    source = await open2(sourcePath, constants2.O_RDONLY | constants2.O_NOFOLLOW);
    destination = await open2(destinationPath, constants2.O_WRONLY | constants2.O_CREAT | constants2.O_EXCL | constants2.O_NOFOLLOW, 256);
    const before = await source.stat();
    if (!before.isFile())
      throw new TypeError("The embedding model must be a regular file.");
    if (before.size > MAX_EMBEDDING_MODEL_BYTES) {
      throw new RangeError(`The embedding model exceeds ${MAX_EMBEDDING_MODEL_BYTES.toLocaleString("en-US")} bytes.`);
    }
    const hash = createHash2("sha256");
    const buffer = new Uint8Array(1024 * 1024);
    let observed = 0;
    for (;; ) {
      const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0)
        break;
      observed += bytesRead;
      if (observed > MAX_EMBEDDING_MODEL_BYTES) {
        throw new RangeError(`The embedding model exceeds ${MAX_EMBEDDING_MODEL_BYTES.toLocaleString("en-US")} bytes.`);
      }
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes);
      await writeEmbeddingModelBytes(destination, bytes);
    }
    const after = await source.stat();
    const copied = await destination.stat();
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || observed !== before.size || copied.size !== observed) {
      throw new Error("The embedding model changed while its private snapshot was created; retry.");
    }
    await destination.sync();
    await destination.close();
    destination = undefined;
    await source.close();
    source = undefined;
    const digest = dependencies.digestEmbeddingModelFile === undefined ? hash.digest("hex") : await dependencies.digestEmbeddingModelFile(destinationPath);
    if (digest !== recommendedEmbeddingModelSha256) {
      throw new Error("The local embedding model does not match the pinned recommended model SHA-256.");
    }
    await chmod(destinationPath, 256);
    let released = false;
    return Object.freeze({
      source: destinationPath,
      release: async () => {
        if (released)
          return;
        released = true;
        await rm2(directory, { recursive: true, force: true });
      }
    });
  } catch (error) {
    await destination?.close().catch(() => {
      return;
    });
    await source?.close().catch(() => {
      return;
    });
    await rm2(directory, { recursive: true, force: true });
    throw error;
  }
}
function releaseEmbeddingModelReference(state) {
  if (state.references < 1) {
    throw new Error("Verified embedding-model lease reference accounting underflowed.");
  }
  state.references -= 1;
  if (state.references !== 0)
    return Promise.resolve();
  state.cleanupPromise ??= state.cleanup();
  return state.cleanupPromise;
}
function retainVerifiedEmbeddingModelLease(lease) {
  const state = verifiedEmbeddingModelLeaseStates.get(lease);
  if (state === undefined) {
    throw new TypeError("embeddingModelLease must be created by createVerifiedEmbeddingModelLease.");
  }
  if (!state.acceptingReaders) {
    throw new Error("The verified embedding-model lease is closed.");
  }
  state.references += 1;
  let released = false;
  return Object.freeze({
    source: state.source,
    release: () => {
      if (released)
        return Promise.resolve();
      released = true;
      return releaseEmbeddingModelReference(state);
    }
  });
}
async function createVerifiedEmbeddingModelLease(embeddingModelFile, dependencies = {}) {
  if (typeof embeddingModelFile !== "string" || embeddingModelFile.trim() === "") {
    throw new TypeError("embeddingModelFile must be a non-empty path string.");
  }
  const copied = await verifiedIndexEmbeddingModelSource(embeddingModelFile, dependencies);
  const state = {
    source: copied.source,
    cleanup: copied.release,
    references: 1,
    acceptingReaders: true
  };
  let ownerClosePromise;
  const lease = Object.freeze({
    model: recommendedEmbeddingModel,
    close: () => {
      if (ownerClosePromise !== undefined)
        return ownerClosePromise;
      state.acceptingReaders = false;
      ownerClosePromise = releaseEmbeddingModelReference(state);
      return ownerClosePromise;
    }
  });
  verifiedEmbeddingModelLeaseStates.set(lease, state);
  return lease;
}
function requiredStoreLocalVectorBoundary(value) {
  if (value === undefined)
    return false;
  if (typeof value !== "boolean") {
    throw new TypeError("requireStoreLocalVectorBoundary must be a boolean.");
  }
  return value;
}
async function sessionEmbeddingModelSource(options, dependencies) {
  if (options.embeddingModelFile !== undefined && options.embeddingModelLease !== undefined) {
    throw new TypeError("embeddingModelFile and embeddingModelLease are mutually exclusive.");
  }
  if (options.embeddingModelLease !== undefined) {
    return retainVerifiedEmbeddingModelLease(options.embeddingModelLease);
  }
  if (options.embeddingModelFile === undefined) {
    return Object.freeze({
      source: recommendedEmbeddingModel,
      release: () => Promise.resolve()
    });
  }
  const owner = await createVerifiedEmbeddingModelLease(options.embeddingModelFile, dependencies);
  try {
    const retained = retainVerifiedEmbeddingModelLease(owner);
    await owner.close();
    return retained;
  } catch (error) {
    await owner.close().catch(() => {
      return;
    });
    throw error;
  }
}
function cacheHome(dependencies) {
  const configured = dependencies.cacheHome ?? process.env.XDG_CACHE_HOME;
  if (configured !== undefined && configured.trim() !== "") {
    return isAbsolute2(configured) ? configured : resolve2(configured);
  }
  return join2(homedir(), ".cache");
}
function semanticDatabasePath(root, dependencies = {}) {
  const identity = createHash2("sha256").update(resolve2(root)).digest("hex").slice(0, 20);
  return join2(cacheHome(dependencies), "hraness-kb", "indexes", `${identity}.sqlite`);
}
async function resolvedDirectory(path) {
  const root = await realpath2(resolve2(path));
  if (!(await stat(root)).isDirectory())
    throw new Error("Knowledge-base root must be a directory.");
  return root;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundaryRecord(value, label) {
  if (!isRecord2(value))
    throw new Error(`${label} must be an object.`);
  return value;
}
function boundaryString(value, label) {
  if (typeof value !== "string")
    throw new Error(`${label} must be a string.`);
  return value;
}
function boundaryNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}
function boundaryCount(value, label) {
  const number = boundaryNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return number;
}
function boundaryArray(value, label) {
  if (!Array.isArray(value))
    throw new Error(`${label} must be an array.`);
  return value;
}
function parseUpdateResult(value) {
  const result = boundaryRecord(value, "QMD update result");
  return {
    collections: boundaryCount(result.collections, "QMD update result.collections"),
    indexed: boundaryCount(result.indexed, "QMD update result.indexed"),
    updated: boundaryCount(result.updated, "QMD update result.updated"),
    unchanged: boundaryCount(result.unchanged, "QMD update result.unchanged"),
    removed: boundaryCount(result.removed, "QMD update result.removed"),
    needsEmbedding: boundaryCount(result.needsEmbedding, "QMD update result.needsEmbedding")
  };
}
function parseEmbeddingFailure(value, index) {
  const label = `QMD embedding result.failures[${index}]`;
  const failure = boundaryRecord(value, label);
  return {
    path: boundaryString(failure.path, `${label}.path`),
    hash: boundaryString(failure.hash, `${label}.hash`),
    seq: boundaryCount(failure.seq, `${label}.seq`),
    attempts: boundaryCount(failure.attempts, `${label}.attempts`),
    reason: boundaryString(failure.reason, `${label}.reason`)
  };
}
function parseEmbeddingResult(value) {
  const result = boundaryRecord(value, "QMD embedding result");
  const failures = result.failures === undefined ? undefined : boundaryArray(result.failures, "QMD embedding result.failures").map((failure, index) => parseEmbeddingFailure(failure, index));
  return {
    docsProcessed: boundaryCount(result.docsProcessed, "QMD embedding result.docsProcessed"),
    chunksEmbedded: boundaryCount(result.chunksEmbedded, "QMD embedding result.chunksEmbedded"),
    errors: boundaryCount(result.errors, "QMD embedding result.errors"),
    ...failures === undefined ? {} : { failures },
    durationMs: boundaryNumber(result.durationMs, "QMD embedding result.durationMs")
  };
}
function parseSearchDocument(value, index) {
  const label = `QMD search result[${index}]`;
  const result = boundaryRecord(value, label);
  const source = result.source;
  if (source !== "fts" && source !== "vec") {
    throw new Error(`${label}.source must be "fts" or "vec".`);
  }
  const chunkPos = result.chunkPos === undefined ? undefined : boundaryCount(result.chunkPos, `${label}.chunkPos`);
  return {
    filepath: boundaryString(result.filepath, `${label}.filepath`),
    title: boundaryString(result.title, `${label}.title`),
    hash: boundaryString(result.hash, `${label}.hash`),
    docid: boundaryString(result.docid, `${label}.docid`),
    modifiedAt: boundaryString(result.modifiedAt, `${label}.modifiedAt`),
    score: boundaryNumber(result.score, `${label}.score`),
    source,
    ...chunkPos === undefined ? {} : { chunkPos }
  };
}
function boundedResultArray(value, label, maximum) {
  const results = boundaryArray(value, label);
  if (results.length > maximum) {
    throw new Error(`${label} returned more than the requested ${maximum} results.`);
  }
  return results;
}
function parseSearchResults(value, maximum) {
  return boundedResultArray(value, "QMD search results", maximum).map((result, index) => parseSearchDocument(result, index));
}
function boundUnknownMethod(owner, name, label) {
  const method = owner[name];
  if (typeof method !== "function")
    throw new Error(`${label}.${name} must be a function.`);
  return async (...arguments_) => {
    const returned = Reflect.apply(method, owner, arguments_);
    return await returned;
  };
}
function measuredDuration(startedAt, finishedAt) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
    throw new Error("The query-embedding monotonic clock returned an invalid interval.");
  }
  const duration = finishedAt - startedAt;
  return duration;
}
function internalVectorBoundary(store, modelIdentity, now) {
  if (store.internal === undefined)
    return null;
  const internal = boundaryRecord(store.internal, "QMD store.internal");
  const llm = boundaryRecord(internal.llm, "QMD store.internal.llm");
  const getHashesNeedingEmbedding = boundUnknownMethod(internal, "getHashesNeedingEmbedding", "QMD store.internal");
  const searchVec = boundUnknownMethod(internal, "searchVec", "QMD store.internal");
  const embed = boundUnknownMethod(llm, "embed", "QMD store.internal.llm");
  const countTokens = boundUnknownMethod(llm, "countTokens", "QMD store.internal.llm");
  return {
    pendingEmbeddingCount: async () => boundaryCount(await getHashesNeedingEmbedding(modelIdentity), "QMD store.internal.getHashesNeedingEmbedding result"),
    searchVector: async (query, options) => {
      let calls = 0;
      let inputTokens = 0;
      let durationMs = 0;
      const session = Object.freeze({
        countTokens: async (text) => boundaryCount(await countTokens(boundaryString(text, "QMD query embedding text")), "QMD store.internal.llm.countTokens result"),
        embed: async (text, embedOptions) => {
          const exactText = boundaryString(text, "QMD query embedding text");
          if (calls !== 0) {
            throw new Error("QMD query-vector search must perform exactly one query embedding.");
          }
          inputTokens = boundaryCount(await countTokens(exactText), "QMD store.internal.llm.countTokens result");
          calls = 1;
          const startedAt = now();
          try {
            return await embed(exactText, embedOptions);
          } finally {
            durationMs = measuredDuration(startedAt, now());
          }
        }
      });
      const results = parseSearchResults(await searchVec(query, modelIdentity, options.limit, options.collection, session), options.limit);
      if (calls !== 1) {
        throw new Error(`QMD query-vector search must perform exactly one query embedding; observed ${calls}.`);
      }
      return {
        results,
        accounting: Object.freeze({ calls, inputTokens, durationMs })
      };
    }
  };
}
function parseSearchStore(value, modelIdentity, options) {
  const store = boundaryRecord(value, "QMD store");
  const close = boundUnknownMethod(store, "close", "QMD store");
  const embed = boundUnknownMethod(store, "embed", "QMD store");
  const searchLex = boundUnknownMethod(store, "searchLex", "QMD store");
  const searchVector = boundUnknownMethod(store, "searchVector", "QMD store");
  const update = boundUnknownMethod(store, "update", "QMD store");
  let internalVector = null;
  try {
    internalVector = internalVectorBoundary(store, modelIdentity, options.now);
  } catch (error) {
    if (options.requireStoreLocalVectorBoundary)
      throw error;
  }
  if (options.requireStoreLocalVectorBoundary && internalVector === null) {
    throw new Error("QMD store-local vector search is required, but store.internal.searchVec with its LLM boundary is unavailable.");
  }
  return {
    close: async () => {
      await close();
    },
    embed: async (options2) => parseEmbeddingResult(await embed(options2)),
    searchLex: async (query, options2) => parseSearchResults(await searchLex(query, options2), options2.limit),
    searchVector: internalVector?.searchVector ?? (async (query, vectorOptions) => ({
      results: parseSearchResults(await searchVector(query, vectorOptions), vectorOptions.limit),
      accounting: null
    })),
    update: async (options2) => {
      const result = parseUpdateResult(await update(options2));
      if (internalVector === null)
        return result;
      return {
        ...result,
        needsEmbedding: await internalVector.pendingEmbeddingCount()
      };
    }
  };
}
function parseWarmSearchStore(value, now) {
  const store = boundaryRecord(value, "QMD warm search store");
  const close = boundUnknownMethod(store, "close", "QMD warm search store");
  const searchLex = boundUnknownMethod(store, "searchLex", "QMD warm search store");
  const internalVector = internalVectorBoundary(store, recommendedEmbeddingModel, now);
  if (internalVector === null) {
    throw new Error("QMD warm search requires store.internal.searchVec with its store-local LLM boundary.");
  }
  return Object.freeze({
    close: async () => {
      await close();
    },
    pendingEmbeddingCount: internalVector.pendingEmbeddingCount,
    searchLex: async (query, options) => parseSearchResults(await searchLex(query, options), options.limit),
    searchVector: internalVector.searchVector
  });
}
async function closeMalformedStore(value) {
  if (!isRecord2(value))
    return;
  const close = value.close;
  if (typeof close !== "function")
    return;
  try {
    const returned = Reflect.apply(close, value, []);
    await returned;
  } catch {}
}
async function openedSearchStore(value, modelIdentity, options) {
  try {
    return parseSearchStore(value, modelIdentity, options);
  } catch (error) {
    await closeMalformedStore(value);
    throw error;
  }
}
async function openedWarmSearchStore(value, now) {
  try {
    return parseWarmSearchStore(value, now);
  } catch (error) {
    await closeMalformedStore(value);
    throw error;
  }
}
function sameStableFileMetadata(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function missingFile(error) {
  return isRecord2(error) && error.code === "ENOENT";
}
async function writeAll(handle, bytes, length, position) {
  let written = 0;
  while (written < length) {
    const result = await handle.write(bytes, written, length - written, position + written);
    if (result.bytesWritten === 0) {
      throw new Error("The isolated QMD snapshot stopped accepting bytes.");
    }
    written += result.bytesWritten;
  }
}
async function copyStableSnapshotFile(source, destination, label, maximumBytes, expected) {
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || expected.bytes > maximumBytes || !SHA256.test(expected.sha256))
    throw new TypeError(`${label} seal is invalid.`);
  const pathBefore = await lstat2(source, { bigint: true });
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile() || pathBefore.nlink !== 1n || pathBefore.size > BigInt(maximumBytes) || pathBefore.size !== BigInt(expected.bytes)) {
    throw new Error(`${label} must be one bounded, singly linked regular file.`);
  }
  const sourceHandle = await open2(source, constants2.O_RDONLY | constants2.O_NOFOLLOW);
  let destinationHandle;
  try {
    const before = await sourceHandle.stat({ bigint: true });
    if (!sameStableFileMetadata(pathBefore, before)) {
      throw new Error(`${label} changed before its isolated read snapshot was opened.`);
    }
    destinationHandle = await open2(destination, constants2.O_WRONLY | constants2.O_CREAT | constants2.O_EXCL | constants2.O_NOFOLLOW, 384);
    const buffer = new Uint8Array(1024 * 1024);
    const hash = createHash2("sha256");
    let copied = 0;
    while (copied < Number(before.size)) {
      const requested = Math.min(buffer.byteLength, Number(before.size) - copied);
      const { bytesRead } = await sourceHandle.read(buffer, 0, requested, copied);
      if (bytesRead === 0) {
        throw new Error(`${label} ended before its declared size.`);
      }
      await writeAll(destinationHandle, buffer, bytesRead, copied);
      hash.update(buffer.subarray(0, bytesRead));
      copied += bytesRead;
    }
    await destinationHandle.sync();
    const [after, pathAfter] = await Promise.all([
      sourceHandle.stat({ bigint: true }),
      lstat2(source, { bigint: true })
    ]);
    if (copied !== Number(before.size) || !sameStableFileMetadata(before, after) || !sameStableFileMetadata(after, pathAfter)) {
      throw new Error(`${label} changed while its isolated read snapshot was copied.`);
    }
    const observed = Object.freeze({ bytes: copied, sha256: hash.digest("hex") });
    if (observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256) {
      throw new Error(`${label} does not match its sealed byte commitment.`);
    }
    return observed;
  } finally {
    await Promise.allSettled([
      sourceHandle.close(),
      destinationHandle?.close() ?? Promise.resolve()
    ]);
  }
}
async function assertAbsentSnapshotSidecar(path, label) {
  try {
    await lstat2(path);
  } catch (error) {
    if (missingFile(error))
      return;
    throw error;
  }
  throw new Error(`${label} appeared while the isolated read snapshot was copied.`);
}
async function createIsolatedQmdDatabaseSnapshot(database, seal) {
  const directory = await mkdtemp(join2(tmpdir(), "hraness-wordcell-qmd-reader."));
  await chmod(directory, 448);
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned)
      return;
    cleaned = true;
    await rm2(directory, { recursive: true, force: true });
  };
  try {
    const isolatedDatabase = join2(directory, "snapshot.sqlite");
    if (seal.wal !== null || seal.shm !== null || seal.journal !== null) {
      throw new TypeError("Strict warm semantic snapshots require checkpointed SQLite state.");
    }
    const sourceWal = `${database}-wal`;
    const sourceShm = `${database}-shm`;
    const sourceJournal = `${database}-journal`;
    await Promise.all([
      assertAbsentSnapshotSidecar(sourceWal, "Semantic database WAL"),
      assertAbsentSnapshotSidecar(sourceShm, "Semantic database SHM"),
      assertAbsentSnapshotSidecar(sourceJournal, "Semantic database rollback journal")
    ]);
    const databaseSeal = await copyStableSnapshotFile(database, isolatedDatabase, "Semantic database", MAX_SEMANTIC_READ_SNAPSHOT_BYTES, seal.database);
    await Promise.all([
      assertAbsentSnapshotSidecar(sourceWal, "Semantic database WAL"),
      assertAbsentSnapshotSidecar(sourceShm, "Semantic database SHM"),
      assertAbsentSnapshotSidecar(sourceJournal, "Semantic database rollback journal")
    ]);
    if (databaseSeal.bytes > MAX_SEMANTIC_READ_SNAPSHOT_BYTES) {
      throw new RangeError("Semantic database exceeds the read-snapshot byte bound.");
    }
    return Object.freeze({ database: isolatedDatabase, cleanup });
  } catch (error) {
    await cleanup();
    throw error;
  }
}
function aggregateCloseFailures(settlements, label) {
  const failures = settlements.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(failures.map(({ reason }) => reason), `${label} did not close cleanly.`);
  }
}
async function closeIsolatedStore(close, snapshot, label) {
  const settlements = [];
  try {
    await close();
    settlements.push({ status: "fulfilled", value: undefined });
  } catch (reason) {
    settlements.push({ status: "rejected", reason });
  }
  try {
    await snapshot.cleanup();
    settlements.push({ status: "fulfilled", value: undefined });
  } catch (reason) {
    settlements.push({ status: "rejected", reason });
  }
  aggregateCloseFailures(settlements, label);
}
function isolatedWarmSearchStore(store, snapshot) {
  let closePromise;
  return Object.freeze({
    ...store,
    close: () => {
      closePromise ??= closeIsolatedStore(store.close, snapshot, "Isolated QMD warm store");
      return closePromise;
    }
  });
}
function isolatedAttestationStore(store, snapshot) {
  let closePromise;
  return Object.freeze({
    ...store,
    close: () => {
      closePromise ??= closeIsolatedStore(store.close, snapshot, "Isolated QMD attestation store");
      return closePromise;
    }
  });
}
function storeConfig(root, embeddingModelSource) {
  return {
    global_context: globalContext,
    collections: {
      [collectionName]: {
        path: root,
        pattern: markdownPattern,
        ignore: ignoredPatterns,
        context: collectionContext
      }
    },
    models: { embed: embeddingModelSource }
  };
}
async function defaultCreateStore(options) {
  const loaded = await import(qmdModuleSpecifier);
  const module = boundaryRecord(loaded, "QMD module");
  const createStore = boundUnknownMethod(module, "createStore", "QMD module");
  return await createStore(options);
}
async function defaultCreateWarmSearchStore(options) {
  const loaded = await import(qmdModuleSpecifier);
  const module = boundaryRecord(loaded, "QMD module");
  const createStore = boundUnknownMethod(module, "createStore", "QMD module");
  const created = await createStore({ dbPath: options.dbPath });
  let localLlm;
  try {
    const store = boundaryRecord(created, "QMD warm search store");
    const internal = boundaryRecord(store.internal, "QMD warm search store.internal");
    const previousLlm = boundaryRecord(internal.llm, "QMD warm search store.internal.llm");
    const previousDispose = boundUnknownMethod(previousLlm, "dispose", "QMD warm search store.internal.llm");
    const llmSpecifier = new URL("./llm.js", import.meta.resolve(qmdModuleSpecifier)).href;
    const loadedLlm = await import(llmSpecifier);
    const llmModule = boundaryRecord(loadedLlm, "QMD LLM module");
    if (typeof llmModule.LlamaCpp !== "function") {
      throw new Error("QMD LLM module.LlamaCpp must be a constructor.");
    }
    const constructed = Reflect.construct(llmModule.LlamaCpp, [{
      embedModel: options.embeddingModelSource,
      inactivityTimeoutMs: 300000,
      disposeModelsOnInactivity: true
    }]);
    localLlm = boundaryRecord(constructed, "QMD warm local LLM");
    if (localLlm.embedModelName !== options.embeddingModelSource) {
      throw new Error("QMD warm local LLM did not retain the verified model source.");
    }
    const localDispose = boundUnknownMethod(localLlm, "dispose", "QMD warm local LLM");
    if (!Reflect.set(internal, "llm", localLlm)) {
      throw new Error("QMD warm store rejected its verified local LLM boundary.");
    }
    await previousDispose();
    const close = boundUnknownMethod(store, "close", "QMD warm search store");
    let closed = false;
    return Object.freeze({
      ...store,
      internal,
      close: async () => {
        if (closed)
          return;
        closed = true;
        const settlements = await Promise.allSettled([localDispose(), close()]);
        const failures = settlements.filter((result) => result.status === "rejected");
        if (failures.length > 0) {
          throw new AggregateError(failures.map(({ reason }) => reason), "QMD warm store did not close cleanly.");
        }
      }
    });
  } catch (error) {
    if (localLlm !== undefined) {
      const dispose = localLlm.dispose;
      if (typeof dispose === "function") {
        await Promise.resolve(Reflect.apply(dispose, localLlm, [])).catch(() => {
          return;
        });
      }
    }
    await closeMalformedStore(created);
    throw error;
  }
}
async function defaultCreateAttestationStore(options) {
  const loaded = await import(qmdModuleSpecifier);
  const module = boundaryRecord(loaded, "QMD module");
  const createStore = boundUnknownMethod(module, "createStore", "QMD module");
  return await createStore(options);
}
async function defaultOpenCheckpointDatabase(database) {
  const moduleSpecifier = "bun:sqlite";
  const loaded = await import(moduleSpecifier);
  const module = boundaryRecord(loaded, "Bun SQLite module");
  if (typeof module.Database !== "function") {
    throw new TypeError("Bun SQLite module.Database must be a constructor.");
  }
  const opened = boundaryRecord(Reflect.construct(module.Database, [database, { create: false, strict: true }]), "Bun SQLite checkpoint database");
  const query = boundUnknownMethod(opened, "query", "Bun SQLite checkpoint database");
  const close = boundUnknownMethod(opened, "close", "Bun SQLite checkpoint database");
  return Object.freeze({
    checkpoint: async () => {
      const walStatement = boundaryRecord(await query("PRAGMA wal_checkpoint(TRUNCATE)"), "Bun SQLite WAL checkpoint statement");
      const walGet = boundUnknownMethod(walStatement, "get", "Bun SQLite WAL checkpoint statement");
      const modeStatement = boundaryRecord(await query("PRAGMA journal_mode = DELETE"), "Bun SQLite journal-mode statement");
      const modeGet = boundUnknownMethod(modeStatement, "get", "Bun SQLite journal-mode statement");
      return Object.freeze({ wal: await walGet(), mode: await modeGet() });
    },
    close: async () => {
      await close();
    }
  });
}
async function openedCheckpointDatabase(value) {
  try {
    const database = boundaryRecord(value, "Semantic checkpoint database");
    const checkpoint = boundUnknownMethod(database, "checkpoint", "Semantic checkpoint database");
    const close = boundUnknownMethod(database, "close", "Semantic checkpoint database");
    return Object.freeze({
      checkpoint: async () => {
        return await checkpoint();
      },
      close: async () => {
        await close();
      }
    });
  } catch (error) {
    await closeMalformedStore(value);
    throw error;
  }
}
function parseSemanticAttestationStore(value) {
  const store = boundaryRecord(value, "QMD attestation store");
  const close = boundUnknownMethod(store, "close", "QMD attestation store");
  const internal = boundaryRecord(store.internal, "QMD attestation store.internal");
  const llm = boundaryRecord(internal.llm, "QMD attestation store.internal.llm");
  const getHashesNeedingEmbedding = boundUnknownMethod(internal, "getHashesNeedingEmbedding", "QMD attestation store.internal");
  boundUnknownMethod(internal, "searchVec", "QMD attestation store.internal");
  boundUnknownMethod(llm, "countTokens", "QMD attestation store.internal.llm");
  boundUnknownMethod(llm, "embed", "QMD attestation store.internal.llm");
  return Object.freeze({
    close: async () => {
      await close();
    },
    pendingEmbeddingCount: async () => boundaryCount(await getHashesNeedingEmbedding(recommendedEmbeddingModel), "QMD attestation store.internal.getHashesNeedingEmbedding result")
  });
}
async function openedSemanticAttestationStore(value) {
  try {
    return parseSemanticAttestationStore(value);
  } catch (error) {
    await closeMalformedStore(value);
    throw error;
  }
}
async function openStore(root, database, embeddingModelSource, dependencies, requireStoreLocalVectorBoundary = false) {
  await mkdir2(dirname2(database), { recursive: true });
  const created = await (dependencies.createStore ?? defaultCreateStore)({
    dbPath: database,
    config: storeConfig(root, embeddingModelSource)
  });
  return await openedSearchStore(created, recommendedEmbeddingModel, {
    requireStoreLocalVectorBoundary,
    now: dependencies.now ?? performance.now.bind(performance)
  });
}
async function assertExactWarmProjectionFile(path, expected, label) {
  const handle = await open2(path, constants2.O_RDONLY | constants2.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== expected.byteLength) {
      throw new Error(`${label} does not match the immutable warm projection.`);
    }
    const observed = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || !observed.equals(expected)) {
      throw new Error(`${label} does not match the immutable warm projection.`);
    }
  } finally {
    await handle.close();
  }
}
async function assertExistingWarmProjection(description, notes) {
  let canonicalGeneration;
  try {
    canonicalGeneration = await realpath2(description.generationPath);
  } catch (error) {
    throw new Error("The immutable warm semantic projection is absent.", { cause: error });
  }
  if (canonicalGeneration !== description.generationPath) {
    throw new Error("The immutable warm semantic projection changed identity.");
  }
  await assertExactWarmProjectionFile(join2(canonicalGeneration, "manifest.json"), Buffer.from(description.manifestText, "utf8"), "Semantic projection manifest");
  const notesByPath = new Map(notes.map((note) => [note.path, note]));
  if (notesByPath.size !== description.manifest.notes.length) {
    throw new Error("The immutable warm semantic projection note population drifted.");
  }
  for (const entry of description.manifest.notes) {
    const note = notesByPath.get(entry.path);
    if (note === undefined) {
      throw new Error(`Semantic projection note ${JSON.stringify(entry.path)} is absent.`);
    }
    const expected = Buffer.from(note.content, "utf8");
    if (expected.byteLength !== entry.bytes || createHash2("sha256").update(expected).digest("hex") !== entry.sha256) {
      throw new Error(`Semantic projection note ${JSON.stringify(entry.path)} drifted.`);
    }
    await assertExactWarmProjectionFile(resolve2(canonicalGeneration, ...entry.path.split("/")), expected, `Semantic projection note ${JSON.stringify(entry.path)}`);
  }
}
async function openWarmSearchStore(database, databaseSnapshotSeal, embeddingModelSource, dependencies) {
  const snapshot = await createIsolatedQmdDatabaseSnapshot(database, databaseSnapshotSeal);
  try {
    const created = await (dependencies.createWarmSearchStore ?? defaultCreateWarmSearchStore)({
      dbPath: snapshot.database,
      embeddingModelSource
    });
    const store = await openedWarmSearchStore(created, dependencies.now ?? performance.now.bind(performance));
    return isolatedWarmSearchStore(store, snapshot);
  } catch (error) {
    await snapshot.cleanup();
    throw error;
  }
}
async function openAttestationStore(database, databaseSnapshotSeal, dependencies) {
  const snapshot = await createIsolatedQmdDatabaseSnapshot(database, databaseSnapshotSeal);
  try {
    const created = await (dependencies.createAttestationStore ?? defaultCreateAttestationStore)({ dbPath: snapshot.database });
    const store = await openedSemanticAttestationStore(created);
    return isolatedAttestationStore(store, snapshot);
  } catch (error) {
    await snapshot.cleanup();
    throw error;
  }
}
async function checkpointSemanticWarmCache(options, dependencies = {}) {
  const root = await resolvedDirectory(options.root);
  const database = await resolveSemanticDatabase(databaseFor(root, options.database, dependencies), root);
  const before = await lstat2(database);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
    throw new TypeError("The semantic database to checkpoint must be a singly linked regular file.");
  }
  const opened = await (dependencies.openCheckpointDatabase ?? defaultOpenCheckpointDatabase)(database);
  const checkpoint = await openedCheckpointDatabase(opened);
  try {
    const outcome = boundaryRecord(await checkpoint.checkpoint(), "Semantic checkpoint result");
    const wal = boundaryRecord(outcome.wal, "Semantic checkpoint result.wal");
    const busy = boundaryCount(wal.busy, "Semantic checkpoint result.wal.busy");
    const log = boundaryCount(wal.log, "Semantic checkpoint result.wal.log");
    const checkpointed = boundaryCount(wal.checkpointed, "Semantic checkpoint result.wal.checkpointed");
    const mode = boundaryRecord(outcome.mode, "Semantic checkpoint result.mode");
    if (busy !== 0 || log !== checkpointed) {
      throw new Error("Semantic WAL checkpoint did not copy every committed frame.");
    }
    if (boundaryString(mode.journal_mode, "Semantic checkpoint result.mode.journal_mode") !== "delete") {
      throw new Error("Semantic database did not leave WAL journal mode.");
    }
  } catch (error) {
    try {
      await checkpoint.close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Semantic database checkpoint and cleanup both failed.", { cause: error });
    }
    throw error;
  }
  await checkpoint.close();
  for (const sidecar of [`${database}-wal`, `${database}-shm`]) {
    let metadata;
    try {
      metadata = await lstat2(sidecar);
    } catch (error) {
      if (missingFile(error))
        continue;
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
      throw new TypeError("Semantic checkpoint sidecars must be singly linked regular files.");
    }
    await rm2(sidecar);
  }
  await Promise.all([
    assertAbsentSnapshotSidecar(`${database}-wal`, "Semantic database WAL"),
    assertAbsentSnapshotSidecar(`${database}-shm`, "Semantic database SHM"),
    assertAbsentSnapshotSidecar(`${database}-journal`, "Semantic database rollback journal")
  ]);
  return Object.freeze({ database, wal: null, shm: null, journal: null });
}
async function attestSemanticWarmCache(options, dependencies = {}) {
  const embeddingModel = retainVerifiedEmbeddingModelLease(options.embeddingModelLease);
  try {
    const root = await resolvedDirectory(options.root);
    const database = await resolveSemanticDatabase(databaseFor(root, options.database, dependencies), root);
    if (Buffer.byteLength(database, "utf8") > MAX_SEMANTIC_DATABASE_IDENTITY_BYTES) {
      throw new RangeError(`Semantic database identity exceeds ${MAX_SEMANTIC_DATABASE_IDENTITY_BYTES.toLocaleString("en-US")} UTF-8 bytes.`);
    }
    let databaseState;
    try {
      databaseState = await stat(database);
    } catch (error) {
      throw new Error("The warm semantic database must already exist.", { cause: error });
    }
    if (!databaseState.isFile()) {
      throw new Error("The warm semantic database must already be a regular file.");
    }
    const store = await openAttestationStore(database, options.databaseSnapshotSeal, dependencies);
    try {
      const pendingEmbeddings = await store.pendingEmbeddingCount();
      if (pendingEmbeddings !== 0) {
        throw new Error(`Warm semantic cache is not ready: ${pendingEmbeddings} embedding input(s) remain pending.`);
      }
      return Object.freeze({
        model: recommendedEmbeddingModel,
        database,
        pendingEmbeddings: 0
      });
    } finally {
      await store.close();
    }
  } finally {
    await embeddingModel.release();
  }
}
async function openSemanticWarmSearchSession(options, dependencies = {}) {
  const embeddingModel = retainVerifiedEmbeddingModelLease(options.embeddingModelLease);
  let store;
  try {
    const root = await resolvedDirectory(options.root);
    const database = await resolveSemanticDatabase(databaseFor(root, options.database, dependencies), root);
    const databaseState = await stat(database).catch((error) => {
      throw new Error("The warm semantic database must already exist.", { cause: error });
    });
    if (!databaseState.isFile()) {
      throw new Error("The warm semantic database must already be a regular file.");
    }
    const snapshot = await semanticSnapshot(root, dependencies);
    const description = await describeSemanticProjection(database, root, snapshot.notes, semanticIndexIdentity);
    await assertExistingWarmProjection(description, snapshot.notes);
    store = await openWarmSearchStore(database, options.databaseSnapshotSeal, embeddingModel.source, dependencies);
    const pendingEmbeddings = await store.pendingEmbeddingCount();
    if (pendingEmbeddings !== 0) {
      throw new Error(`Warm semantic cache is not ready: ${pendingEmbeddings} embedding input(s) remain pending.`);
    }
    const notesByPath = new Map(snapshot.notes.map((note) => [note.path, note]));
    const contentHashesByPath = new Map(description.manifest.notes.map(({ path, sha256 }) => [path, sha256]));
    const notesByQmdPath = qmdNoteLookup(snapshot.notes, contentHashesByPath);
    const connectionsById = new Map(snapshot.analysis.noteConnections.map((connection) => [connection.id, connection]));
    const update = Object.freeze({
      collections: 1,
      indexed: 0,
      updated: 0,
      unchanged: snapshot.notes.length,
      removed: 0,
      needsEmbedding: 0
    });
    const context = {
      root,
      projectionRoot: description.generationPath,
      database,
      store,
      update,
      ensureEmbedding: () => Promise.resolve(null),
      notesByPath,
      notesByQmdPath,
      contentHashesByPath,
      connectionsById
    };
    let tail = Promise.resolve();
    let closeRequested = false;
    let closePromise;
    const serialize = (operation) => {
      const result = tail.then(operation);
      tail = result.then(() => {
        return;
      }, () => {
        return;
      });
      return result;
    };
    const ownedStore = store;
    store = undefined;
    return Object.freeze({
      root,
      database,
      model: recommendedEmbeddingModel,
      update,
      search: (searchOptions) => {
        if (closeRequested) {
          return Promise.reject(new Error("Semantic warm search session is closed."));
        }
        return serialize(() => executeSemanticSearch(context, searchOptions));
      },
      close: () => {
        if (closePromise !== undefined)
          return closePromise;
        closeRequested = true;
        closePromise = serialize(async () => {
          try {
            await ownedStore.close();
          } finally {
            await embeddingModel.release();
          }
        });
        return closePromise;
      }
    });
  } catch (error) {
    try {
      await store?.close();
    } finally {
      await embeddingModel.release();
    }
    throw error;
  }
}
function databaseFor(root, requested, dependencies) {
  if (requested === undefined)
    return semanticDatabasePath(root, dependencies);
  return resolve2(requested);
}
async function embedChanged(store, update, force) {
  if (!force && update.needsEmbedding === 0)
    return null;
  return await store.embed({
    collection: collectionName,
    force,
    model: recommendedEmbeddingModel,
    chunkStrategy: embeddingChunkStrategy
  });
}
async function semanticSnapshot(root, dependencies) {
  return await (dependencies.scanVault ?? ((vaultRoot) => scanVault(vaultRoot, { mentionScope: false })))(root);
}
async function indexSemanticVault(options, dependencies = {}) {
  const embeddingModel = await verifiedIndexEmbeddingModelSource(options.embeddingModelFile, dependencies);
  try {
    const root = await resolvedDirectory(options.root);
    const databaseCandidate = await resolveSemanticDatabase(databaseFor(root, options.database, dependencies), root);
    const snapshot = await semanticSnapshot(root, dependencies);
    const description = await describeSemanticProjection(databaseCandidate, root, snapshot.notes, semanticIndexIdentity);
    const database = description.database;
    return await withSemanticGenerationWriterLease(database, description.manifest.generation, async () => {
      const projection = await prepareSemanticProjection(description, snapshot.notes);
      let store;
      try {
        store = await openStore(projection.root, database, embeddingModel.source, dependencies);
        const update = await store.update({ collections: [collectionName] });
        const embedding = await embedChanged(store, update, options.force ?? false);
        return { root, database, model: recommendedEmbeddingModel, update, embedding };
      } finally {
        try {
          await store?.close();
        } finally {
          await projection.release();
        }
      }
    }, {
      ...dependencies.writerLease,
      excludeReaders: options.force === true
    });
  } finally {
    await embeddingModel.release();
  }
}
function qmdEmojiToHex(value) {
  return value.replace(/(?:\p{So}\p{Mn}?|\p{Sk})+/gu, (run) => [...run].filter((character) => /\p{So}|\p{Sk}/u.test(character)).map((character) => character.codePointAt(0)?.toString(16) ?? "").join("-"));
}
function qmdHandelize(path) {
  if (path.trim() === "")
    return null;
  const segments = path.split("/").filter((segment) => segment !== "");
  const lastSegment = segments.at(-1) ?? "";
  const filenameWithoutExtension = lastSegment.replace(/\.[^.]+$/u, "");
  if (!/[\p{L}\p{N}\p{So}\p{Sk}$]/u.test(filenameWithoutExtension))
    return null;
  const result = path.replaceAll("___", "/").split("/").map((rawSegment, index, allSegments) => {
    const segment = qmdEmojiToHex(rawSegment);
    if (index === allSegments.length - 1) {
      const extension = segment.match(/(\.[a-z0-9]+)$/iu)?.[1] ?? "";
      const name = extension === "" ? segment : segment.slice(0, -extension.length);
      return name.replace(/[^\p{L}\p{N}$]+/gu, "-").replace(/^-+|-+$/gu, "") + extension;
    }
    return segment.replace(/[^\p{L}\p{N}$]+/gu, "-").replace(/^-+|-+$/gu, "");
  }).filter((segment) => segment !== "").join("/");
  return result === "" ? null : result;
}
function qmdNoteLookup(notes, contentHashesByPath) {
  const lookup = new Map;
  for (const note of notes) {
    const qmdPath = qmdHandelize(note.path);
    if (qmdPath === null)
      continue;
    const contentHash = contentHashesByPath.get(note.path);
    if (contentHash === undefined) {
      throw new Error(`Semantic projection lost the hash for ${JSON.stringify(note.path)}.`);
    }
    const byHash = lookup.get(qmdPath) ?? new Map;
    const candidates = byHash.get(contentHash) ?? [];
    candidates.push(note);
    byHash.set(contentHash, candidates);
    lookup.set(qmdPath, byHash);
  }
  return lookup;
}
function qmdVirtualNotePath(filepath) {
  if (!filepath.startsWith("qmd://"))
    return;
  const prefix = `qmd://${collectionName}/`;
  if (!filepath.startsWith(prefix))
    return null;
  const path = filepath.slice(prefix.length);
  const segments = path.split("/");
  const hasControlCharacter = [...path].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (path === "" || path.includes("\\") || path.includes("?") || path.includes("#") || path.includes("%") || hasControlCharacter || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return path;
}
async function resolvedSearchNote(projectionRoot, result, notesByPath, notesByQmdPath, contentHashesByPath) {
  const virtualPath = qmdVirtualNotePath(result.filepath);
  if (virtualPath !== undefined) {
    if (virtualPath === null)
      return null;
    const candidates = notesByQmdPath.get(virtualPath)?.get(result.hash) ?? [];
    const candidate2 = candidates[0];
    return candidates.length === 1 && candidate2 !== undefined && contentHashesByPath.get(candidate2.path) === result.hash ? candidate2 : null;
  }
  if (!isAbsolute2(result.filepath))
    return null;
  let filepath;
  try {
    filepath = await realpath2(resolve2(result.filepath));
  } catch {
    return null;
  }
  const candidate = relative2(projectionRoot, filepath);
  if (candidate === "" || candidate === ".." || candidate.startsWith(`..${sep2}`) || isAbsolute2(candidate)) {
    return null;
  }
  const note = notesByPath.get(candidate.split(sep2).join("/"));
  return note !== undefined && contentHashesByPath.get(note.path) === result.hash ? note : null;
}
function queryOffset(body, query, suggested) {
  if (suggested !== undefined && Number.isSafeInteger(suggested) && suggested >= 0 && suggested <= body.length) {
    return suggested;
  }
  const terms = query.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const lowerBody = body.toLocaleLowerCase("en-US");
  for (const term of terms.toSorted((left, right) => right.length - left.length)) {
    const offset = lowerBody.indexOf(term);
    if (offset !== -1)
      return offset;
  }
  return 0;
}
function boundedSnippet(body, offset) {
  const normalized = body.replaceAll(`\r
`, `
`).replaceAll("\r", `
`);
  const maximum = 600;
  const start = Math.max(0, Math.min(normalized.length, offset) - 180);
  const end = Math.min(normalized.length, start + maximum);
  const value = normalized.slice(start, end).replace(/\s+/gu, " ").trim();
  return `${start > 0 ? "\u2026" : ""}${value}${end < normalized.length ? "\u2026" : ""}`;
}
async function searchHit(projectionRoot, query, result, notesByPath, notesByQmdPath, contentHashesByPath, connectionsById) {
  const note = await resolvedSearchNote(projectionRoot, result, notesByPath, notesByQmdPath, contentHashesByPath);
  if (note === null)
    return null;
  const connection = connectionsById.get(note.id);
  const body = note.content;
  const offset = queryOffset(body, query, result.chunkPos);
  return {
    path: note.path,
    title: note.title,
    score: result.score,
    source: result.source,
    docid: result.docid,
    modifiedAt: result.modifiedAt,
    ...body === "" ? {} : { line: body.slice(0, offset).split(`
`).length },
    snippet: boundedSnippet(body, offset),
    tags: note.tags,
    metadata: note.metadata,
    inboundContextualCount: connection?.inboundContextualCount ?? 0,
    outboundContextualCount: connection?.outboundContextualCount ?? 0,
    backlinks: connection?.backlinks ?? []
  };
}
function semanticDocumentKey(document) {
  return JSON.stringify([document.filepath, document.hash]);
}
function firstDocumentsByKey(documents) {
  const byKey = new Map;
  for (const document of documents) {
    const key = semanticDocumentKey(document);
    if (!byKey.has(key))
      byKey.set(key, document);
  }
  return byKey;
}
function fusedHybridDocuments(lexical, vector, candidateLimit) {
  const lexicalByKey = firstDocumentsByKey(lexical);
  const vectorByKey = firstDocumentsByKey(vector);
  return fuseRankedCandidates([
    { name: "keyword", weight: 1, ids: lexical.map(semanticDocumentKey) },
    { name: "semantic", weight: 1, ids: vector.map(semanticDocumentKey) }
  ]).slice(0, candidateLimit).map((candidate) => {
    const lexicalDocument = lexicalByKey.get(candidate.id);
    const vectorDocument = vectorByKey.get(candidate.id);
    const document = vectorDocument ?? lexicalDocument;
    if (document === undefined) {
      throw new Error("Fused QMD candidate lost its source document.");
    }
    return {
      document,
      score: candidate.score,
      signals: {
        keyword: candidate.contributions.some(({ lane }) => lane === "keyword"),
        semantic: candidate.contributions.some(({ lane }) => lane === "semantic")
      }
    };
  });
}
async function hybridSearchHit(projectionRoot, query, result, notesByPath, notesByQmdPath, contentHashesByPath, connectionsById) {
  const hit = await searchHit(projectionRoot, query, result.document, notesByPath, notesByQmdPath, contentHashesByPath, connectionsById);
  if (hit === null)
    return null;
  return {
    ...hit,
    score: result.score,
    source: "hybrid",
    signals: result.signals
  };
}
function boundedLimit(value, maximum) {
  if (value === undefined)
    return 10;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Search limit must be an integer from 1 through ${maximum}.`);
  }
  return value;
}
function boundedCandidateLimit(value, resultLimit) {
  if (value === undefined)
    return Math.max(40, resultLimit * 4);
  if (!Number.isSafeInteger(value) || value < resultLimit || value > 500) {
    throw new Error(`Search candidate limit must be an integer from ${resultLimit} through 500.`);
  }
  return value;
}
function boundedScore(value) {
  if (value === undefined)
    return 0;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Minimum score must be a number from 0 through 1.");
  }
  return value;
}
function boundedMode(value) {
  const mode = value ?? "semantic";
  if (mode !== "hybrid" && mode !== "keyword" && mode !== "semantic") {
    throw new Error('Search mode must be "hybrid", "keyword", or "semantic".');
  }
  return mode;
}
async function executeSemanticSearch(context, options) {
  const query = validateSearchQuery(options.query).query;
  const mode = boundedMode(options.mode);
  const limit = boundedLimit(options.limit, 500);
  const candidateLimit = boundedCandidateLimit(options.candidateLimit, limit);
  const minScore = boundedScore(options.minScore);
  const embedding = mode === "keyword" ? null : await context.ensureEmbedding();
  let queryEmbedding = mode === "keyword" ? Object.freeze({ calls: 0, inputTokens: 0, durationMs: 0 }) : null;
  let hits;
  let rawRequested;
  let rawReturned;
  let rawDiscarded;
  let rawThresholdRejected;
  let rawExhausted;
  if (mode === "hybrid") {
    const lexical = await context.store.searchLex(query, {
      collection: collectionName,
      limit: candidateLimit
    });
    const vectorSearch = await context.store.searchVector(query, {
      collection: collectionName,
      limit: candidateLimit
    });
    queryEmbedding = vectorSearch.accounting;
    const fused = fusedHybridDocuments(lexical, vectorSearch.results, candidateLimit);
    const considered = fused.filter(({ score }) => score >= minScore);
    rawRequested = candidateLimit;
    rawReturned = fused.length;
    rawThresholdRejected = fused.length - considered.length;
    rawExhausted = fused.length < candidateLimit && lexical.length < candidateLimit && vectorSearch.results.length < candidateLimit;
    hits = await Promise.all(considered.map((result) => hybridSearchHit(context.projectionRoot, query, result, context.notesByPath, context.notesByQmdPath, context.contentHashesByPath, context.connectionsById)));
    rawDiscarded = considered.length - hits.filter((hit) => hit !== null).length;
  } else {
    const vectorSearch = mode === "semantic" ? await context.store.searchVector(query, {
      collection: collectionName,
      limit: candidateLimit
    }) : null;
    const matches = vectorSearch === null ? await context.store.searchLex(query, {
      collection: collectionName,
      limit: candidateLimit
    }) : vectorSearch.results;
    if (vectorSearch !== null)
      queryEmbedding = vectorSearch.accounting;
    rawRequested = candidateLimit;
    rawReturned = matches.length;
    const considered = matches.filter(({ score }) => score >= minScore);
    rawThresholdRejected = matches.length - considered.length;
    rawExhausted = matches.length < candidateLimit;
    hits = await Promise.all(considered.map((result) => searchHit(context.projectionRoot, query, result, context.notesByPath, context.notesByQmdPath, context.contentHashesByPath, context.connectionsById)));
    rawDiscarded = considered.length - hits.filter((hit) => hit !== null).length;
  }
  const verified = hits.filter((hit) => hit !== null);
  return {
    root: context.root,
    database: context.database,
    model: recommendedEmbeddingModel,
    mode,
    query,
    update: context.update,
    embedding,
    queryEmbedding,
    rawWindow: {
      requested: rawRequested,
      returned: rawReturned,
      discarded: rawDiscarded,
      thresholdRejected: rawThresholdRejected,
      exhausted: rawExhausted
    },
    results: verified.slice(0, limit)
  };
}
async function openSemanticSearchSession(options, dependencies = {}) {
  const root = await resolvedDirectory(options.root);
  const databaseCandidate = await resolveSemanticDatabase(databaseFor(root, options.database, dependencies), root);
  const snapshot = await semanticSnapshot(root, dependencies);
  const description = await describeSemanticProjection(databaseCandidate, root, snapshot.notes, semanticIndexIdentity);
  const notesByPath = new Map(snapshot.notes.map((note) => [note.path, note]));
  const contentHashesByPath = new Map(description.manifest.notes.map(({ path, sha256 }) => [path, sha256]));
  const notesByQmdPath = qmdNoteLookup(snapshot.notes, contentHashesByPath);
  const connectionsById = new Map(snapshot.analysis.noteConnections.map((connection) => [connection.id, connection]));
  const requireStoreLocalVectorBoundary = requiredStoreLocalVectorBoundary(options.requireStoreLocalVectorBoundary);
  const embeddingModel = await sessionEmbeddingModelSource(options, dependencies);
  const database = description.database;
  let retained;
  let initialized;
  try {
    initialized = await withSemanticGenerationWriterLease(database, description.manifest.generation, async () => {
      const projection2 = await prepareSemanticProjection(description, snapshot.notes);
      let store2;
      try {
        store2 = await openStore(projection2.root, database, embeddingModel.source, dependencies, requireStoreLocalVectorBoundary);
        retained = { store: store2, projection: projection2 };
        const update2 = await store2.update({ collections: [collectionName] });
        return { store: store2, projection: projection2, update: update2 };
      } catch (error) {
        try {
          await store2?.close();
        } finally {
          await projection2.release();
          retained = undefined;
        }
        throw error;
      }
    }, dependencies.writerLease);
  } catch (error) {
    await retained?.store.close().catch(() => {
      return;
    });
    await retained?.projection.release().catch(() => {
      return;
    });
    await embeddingModel.release().catch(() => {
      return;
    });
    throw error;
  }
  const { store, projection, update } = initialized;
  let embeddingPromise;
  const ensureEmbedding = () => {
    embeddingPromise ??= update.needsEmbedding === 0 ? Promise.resolve(null) : withSemanticGenerationWriterLease(database, projection.manifest.generation, async () => {
      const refreshed = await store.update({ collections: [collectionName] });
      return await embedChanged(store, refreshed, false);
    }, dependencies.writerLease);
    return embeddingPromise;
  };
  let tail = Promise.resolve();
  let closeRequested = false;
  let closePromise;
  const serialize = (operation) => {
    const result = tail.then(operation);
    tail = result.then(() => {
      return;
    }, () => {
      return;
    });
    return result;
  };
  const context = {
    root,
    projectionRoot: projection.root,
    database,
    store,
    update,
    ensureEmbedding,
    notesByPath,
    notesByQmdPath,
    contentHashesByPath,
    connectionsById
  };
  return {
    root,
    database,
    model: recommendedEmbeddingModel,
    update,
    search: (searchOptions) => {
      if (closeRequested) {
        return Promise.reject(new Error("Semantic search session is closed."));
      }
      return serialize(() => executeSemanticSearch(context, searchOptions));
    },
    close: () => {
      if (closePromise !== undefined)
        return closePromise;
      closeRequested = true;
      closePromise = serialize(async () => {
        try {
          await store.close();
        } finally {
          try {
            await projection.release();
          } finally {
            await embeddingModel.release();
          }
        }
      });
      return closePromise;
    }
  };
}
async function searchSemanticVault(options, dependencies = {}) {
  const query = validateSearchQuery(options.query).query;
  const mode = boundedMode(options.mode);
  const limit = boundedLimit(options.limit, 100);
  const candidateLimit = boundedCandidateLimit(options.candidateLimit, limit);
  const minScore = boundedScore(options.minScore);
  const session = await openSemanticSearchSession({
    root: options.root,
    ...options.database === undefined ? {} : { database: options.database }
  }, dependencies);
  try {
    return await session.search({
      query,
      mode,
      limit,
      candidateLimit,
      minScore
    });
  } finally {
    await session.close();
  }
}

export { recommendedEmbeddingModel, recommendedEmbeddingModelSha256, MAX_EMBEDDING_MODEL_BYTES, MAX_SEMANTIC_DATABASE_IDENTITY_BYTES, qmdIndexerVersion, sha256EmbeddingModelFile, createVerifiedEmbeddingModelLease, semanticDatabasePath, checkpointSemanticWarmCache, attestSemanticWarmCache, openSemanticWarmSearchSession, indexSemanticVault, openSemanticSearchSession, searchSemanticVault };
