import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createGraphSnapshot } from "./graph-facts.js";
import { graphCacheFileSystem as fs } from "./graph-cache-filesystem.js";
import { GraphAuthorityError, GRAPH_LIMITS } from "./graph-authority-model.js";
import type { GraphAuthority, GraphQueryRequest, GraphQueryResult, GraphVerification } from "./graph-authority-model.js";
import { acquireFileLease } from "./note-lock.js";
import type { openOhGraphAdapter as OhAdapterFactory } from "./oh/authority.js";

// Keep Node-compatible package discovery independent of the Bun-only graph runtime.
const openOhGraphAdapter: typeof OhAdapterFactory = async (...args) =>
  await (await import("./oh/authority.js")).openOhGraphAdapter(...args);
import { validateGraphQueryRequest } from "./graph-query.js";
import { scanVault } from "./vault.js";
import type { VaultSnapshot } from "./vault.js";

export * from "./graph-authority-model.js";
export { createGraphSnapshot, validateGraphQueryRequest };
export type GraphOptions = Readonly<{ index?: string }>;
export type GraphRebuildOptions = GraphOptions & Readonly<{ fresh?: boolean }>;
export type GraphReadOptions = GraphOptions & Readonly<{ persisted?: boolean }>;

const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const ignoredCache = "# Disposable Wordcell graph state. Rebuild from Markdown.\n*\n";
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
function errno(value: unknown, code: string): boolean {
  return value !== null && typeof value === "object" && "code" in value && value.code === code;
}
async function rootPath(root: string): Promise<string> {
  if (typeof root !== "string" || root.trim() === "" || root.includes("\0")) {
    throw new GraphAuthorityError("invalid-input", "A graph operation requires a vault root.");
  }
  return await realpath(resolve(root));
}
async function scan(root: string, options: GraphOptions): Promise<VaultSnapshot> {
  return await scanVault(root, { ...options, mentionScope: false,
    maxNotes: GRAPH_LIMITS.notes, maxTotalBytes: GRAPH_LIMITS.sourceBytes,
    maxConnectionObservations: GRAPH_LIMITS.facts });
}
async function directoryIdentity(path: string) {
  const info = await fs.lstat(path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new GraphAuthorityError("unsafe-cache", "Wordcell graph state requires a real directory inside the vault.");
  }
  return { dev: info.dev, ino: info.ino };
}
async function sameDirectory(path: string, expected: Awaited<ReturnType<typeof directoryIdentity>>): Promise<void> {
  const actual = await directoryIdentity(path);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new GraphAuthorityError("unsafe-cache", "The graph cache directory changed during the operation.");
  }
}
/** Read one bounded, private regular file through its observed identity. Never follow a cache symlink. */
async function readCache(path: string, maximumBytes = MAX_CACHE_BYTES): Promise<Buffer | null> {
  let observed;
  try { observed = await fs.lstat(path, { bigint: true }); }
  catch (error) { if (errno(error, "ENOENT")) return null; throw error; }
  if (!observed.isFile() || observed.isSymbolicLink() || observed.nlink !== 1n) {
    throw new GraphAuthorityError("unsafe-cache", "Graph cache files must be regular files with one link.");
  }
  if (observed.size > BigInt(maximumBytes)) throw new GraphAuthorityError("budget", "Graph cache exceeds its byte limit.");
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.dev !== observed.dev || before.ino !== observed.ino) {
      throw new GraphAuthorityError("unsafe-cache", "The graph cache changed before it could be read.");
    }
    if (before.size > BigInt(maximumBytes)) {
      throw new GraphAuthorityError("budget", "Graph cache exceeds its byte limit.");
    }
    if (before.size !== observed.size || before.mtimeNs !== observed.mtimeNs || before.ctimeNs !== observed.ctimeNs) {
      throw new GraphAuthorityError("stale", "The graph cache changed before it could be read.");
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new GraphAuthorityError("stale", "The graph cache changed during its read.");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const current = await fs.lstat(path, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || current.dev !== before.dev || current.ino !== before.ino || current.nlink !== 1n) {
      throw new GraphAuthorityError("stale", "The graph cache changed during its read.");
    }
    return bytes;
  } finally { await handle.close(); }
}
async function requireSingleFileCache(path: string): Promise<void> {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { await fs.lstat(path + suffix); }
    catch (error) { if (errno(error, "ENOENT")) continue; throw error; }
    throw new GraphAuthorityError("unsafe-cache", "Graph cache has an active or foreign SQLite sidecar; close its writer before rebuilding.");
  }
}
async function assertFresh(root: string, options: GraphOptions, revision: string): Promise<void> {
  if (createGraphSnapshot(await scan(root, options)).revision !== revision) {
    throw new GraphAuthorityError("stale", "Markdown changed during the graph operation; retry from a fresh snapshot.");
  }
}

/** A read-only, in-memory authority sharing the caller's exact Markdown snapshot. */
export async function openGraphAuthority(snapshot: VaultSnapshot): Promise<GraphAuthority> {
  return await openOhGraphAdapter(createGraphSnapshot(snapshot));
}

async function withGraph<T>(rootInput: string, options: GraphReadOptions,
  work: (authority: GraphAuthority) => Promise<T>): Promise<T> {
  const root = await rootPath(rootInput);
  const snapshot = createGraphSnapshot(await scan(root, options));
  let authority: GraphAuthority;
  if (options.persisted) {
    const cache = join(root, ".wordcell");
    let identity;
    try { identity = await directoryIdentity(cache); }
    catch (error) {
      if (errno(error, "ENOENT")) throw new GraphAuthorityError("stale", "No graph cache exists; run wordcell graph rebuild first.");
      throw error;
    }
    const path = join(cache, "oh.sqlite");
    await requireSingleFileCache(path);
    const bytes = await readCache(path);
    if (bytes === null) throw new GraphAuthorityError("stale", "No graph cache exists; run wordcell graph rebuild first.");
    await sameDirectory(cache, identity);
    authority = await openOhGraphAdapter(snapshot, { databaseBytes: bytes });
  } else authority = await openOhGraphAdapter(snapshot);
  try {
    const result = await work(authority);
    await assertFresh(root, options, snapshot.revision);
    return result;
  } finally { await authority.close(); }
}

/** Verify persisted state without opening any vault file for writing. */
export async function verifyGraph(root: string, options: GraphOptions = {}): Promise<GraphVerification> {
  return await withGraph(root, { ...options, persisted: true }, async (authority) => await authority.verify());
}

export async function queryGraph(root: string, request: GraphQueryRequest, options: GraphReadOptions = {}): Promise<GraphQueryResult> {
  const checked = validateGraphQueryRequest(request);
  return await withGraph(root, options, async (authority) => await authority.query(checked));
}

/** Reconcile in a private staging database and install only after the source and old cache still match. */
export async function rebuildGraph(rootInput: string, options: GraphRebuildOptions = {}): Promise<GraphVerification> {
  const root = await rootPath(rootInput);
  const rootIdentity = await directoryIdentity(root);
  const snapshot = createGraphSnapshot(await scan(root, options));
  const cache = join(root, ".wordcell");
  try { await mkdir(cache, { mode: 0o700 }); }
  catch (error) { if (!errno(error, "EEXIST")) throw error; }
  const cacheIdentity = await directoryIdentity(cache);
  const lease = await acquireFileLease(join(cache, ".rebuild.lock"));
  let staging: string | undefined;
  let stagingIdentity: Awaited<ReturnType<typeof directoryIdentity>> | undefined;
  try {
    await sameDirectory(root, rootIdentity);
    await sameDirectory(cache, cacheIdentity);
    const ignore = join(cache, ".gitignore");
    const oldIgnore = await readCache(ignore, 4096);
    if (oldIgnore !== null && oldIgnore.toString("utf8") !== ignoredCache) {
      throw new GraphAuthorityError("unsafe-cache", "The graph cache has an unrecognized .gitignore; preserve it and use a separate vault root.");
    }
    if (oldIgnore === null) {
      const handle = await fs.open(ignore, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(ignoredCache); await handle.sync(); } finally { await handle.close(); }
    }
    const path = join(cache, "oh.sqlite");
    await requireSingleFileCache(path);
    const previous = await readCache(path);
    staging = await mkdtemp(join(cache, ".build-"));
    stagingIdentity = await directoryIdentity(staging);
    const stagedPath = join(staging, "oh.sqlite");
    if (previous !== null && !options.fresh) {
      const handle = await fs.open(stagedPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(previous); } finally { await handle.close(); }
    }
    const authority = await openOhGraphAdapter(snapshot, { databasePath: stagedPath, writable: true });
    let result;
    try { result = await authority.verify(); } finally { await authority.close(); }
    const ready = await readCache(stagedPath);
    if (ready === null) throw new GraphAuthorityError("corrupt-cache", "The graph rebuild did not produce a database.");
    await requireSingleFileCache(stagedPath);
    await assertFresh(root, options, snapshot.revision);
    await lease.assertOwned();
    await sameDirectory(root, rootIdentity);
    await sameDirectory(cache, cacheIdentity);
    await requireSingleFileCache(path);
    const current = await readCache(path);
    if ((previous === null) !== (current === null) || (previous !== null && current !== null && hash(previous) !== hash(current))) {
      throw new GraphAuthorityError("stale", "The graph cache changed during rebuild; retry from its current state.");
    }
    const handle = await fs.open(stagedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
    await rename(stagedPath, path);
    const directory = await fs.open(cache, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
    return result;
  } finally {
    try {
      if (staging !== undefined && stagingIdentity !== undefined) {
        // Never recursively remove a replacement directory after losing the original parent.
        let stillOwned = false;
        try {
          await sameDirectory(root, rootIdentity);
          await sameDirectory(cache, cacheIdentity);
          await sameDirectory(staging, stagingIdentity);
          stillOwned = true;
        } catch { /* Preserve uncertain paths for the owner to inspect. */ }
        if (stillOwned) await rm(staging, { recursive: true, force: true });
      }
    }
    finally { await lease.release(); }
  }
}
