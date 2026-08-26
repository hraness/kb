// @bun
// src/note-lock.ts
import { createHash, randomUUID } from "crypto";
import { constants } from "fs";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink
} from "fs/promises";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";
var LOCK_SCHEMA_VERSION = 1;
var MAX_LOCK_BYTES = 4 * 1024;
var DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
var DEFAULT_HEARTBEAT_MS = 5000;
var DEFAULT_POLL_INTERVAL_MS = 20;
var DEFAULT_WAIT_TIMEOUT_MS = 30000;
var MAX_RECLAIM_ATTEMPTS = 8;

class NoteLockBusyError extends Error {
  lockPath;
  constructor(lockPath) {
    super("this note is already being edited");
    this.name = "NoteLockBusyError";
    this.lockPath = lockPath;
  }
}

class NoteLockLostError extends Error {
  lockPath;
  constructor(lockPath) {
    super("the note lock is no longer owned by this process");
    this.name = "NoteLockLostError";
    this.lockPath = lockPath;
  }
}
function isErrno(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function within(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}
function defaultCacheHome() {
  const configured = process.env.XDG_CACHE_HOME;
  return configured !== undefined && isAbsolute(configured) ? configured : join(homedir(), ".cache");
}
function defaultDependencies() {
  return {
    pid: process.pid,
    now: () => new Date,
    monotonicNow: () => performance.now(),
    token: () => randomUUID(),
    isProcessAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return !isErrno(error, "ESRCH");
      }
    },
    sleep: async (milliseconds) => {
      await new Promise((resolveSleep) => {
        setTimeout(resolveSleep, milliseconds);
      });
    },
    staleAfterMs: DEFAULT_STALE_AFTER_MS,
    heartbeatMs: DEFAULT_HEARTBEAT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS
  };
}
function resolvedDependencies(overrides) {
  const dependencies = { ...defaultDependencies(), ...overrides };
  if (!Number.isSafeInteger(dependencies.pid) || dependencies.pid <= 0) {
    throw new TypeError("a note lock requires a positive process ID");
  }
  for (const [label, value] of [
    ["staleAfterMs", dependencies.staleAfterMs],
    ["heartbeatMs", dependencies.heartbeatMs],
    ["pollIntervalMs", dependencies.pollIntervalMs]
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`${label} must be a positive finite duration`);
    }
  }
  return dependencies;
}
async function lockPathFor(vaultRootInput, canonicalNoteId, cacheHomeInput) {
  if (canonicalNoteId === "" || canonicalNoteId.includes("\x00") || canonicalNoteId.includes(`
`) || canonicalNoteId.includes("\r")) {
    throw new TypeError("a note lock requires a non-empty single-line note ID");
  }
  const vaultRoot = await realpath(resolve(vaultRootInput));
  const cacheHome = resolve(cacheHomeInput ?? defaultCacheHome());
  const requestedDirectory = join(cacheHome, "hraness-kb", "note-locks", sha256(vaultRoot));
  await mkdir(requestedDirectory, { recursive: true, mode: 448 });
  const requestedMetadata = await lstat(requestedDirectory);
  if (!requestedMetadata.isDirectory() || requestedMetadata.isSymbolicLink()) {
    throw new Error("the note lock root must be a real directory");
  }
  const lockDirectory = await realpath(requestedDirectory);
  if (within(vaultRoot, lockDirectory)) {
    throw new Error("the note lock root must remain outside the vault");
  }
  return join(lockDirectory, `${sha256(canonicalNoteId)}.lock`);
}
function parseOwner(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const record = value;
  const version = record["version"];
  const pid = record["pid"];
  const token = record["token"];
  const acquiredAt = record["acquiredAt"];
  if (version !== LOCK_SCHEMA_VERSION || typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0 || typeof token !== "string" || !/^[0-9a-z-]{16,128}$/iu.test(token) || typeof acquiredAt !== "string" || Number.isNaN(Date.parse(acquiredAt))) {
    return null;
  }
  return { version, pid, token, acquiredAt };
}
async function observeLock(path) {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    if (isErrno(error, "ENOENT"))
      return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n || metadata.size > BigInt(MAX_LOCK_BYTES)) {
    return { kind: "unsafe" };
  }
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    return isErrno(error, "ENOENT") ? null : { kind: "unsafe" };
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size || opened.size > BigInt(MAX_LOCK_BYTES)) {
      return { kind: "unsafe" };
    }
    const bytes = new Uint8Array(Number(opened.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0)
        return { kind: "unsafe" };
      offset += result.bytesRead;
    }
    const overflow = new Uint8Array(1);
    if ((await handle.read(overflow, 0, 1, Number(opened.size))).bytesRead !== 0) {
      return { kind: "unsafe" };
    }
    const finished = await handle.stat({ bigint: true });
    let finalPath;
    try {
      finalPath = await lstat(path, { bigint: true });
    } catch (error) {
      if (isErrno(error, "ENOENT"))
        return null;
      throw error;
    }
    if (!finalPath.isFile() || finalPath.isSymbolicLink() || finalPath.nlink !== 1n || finalPath.dev !== opened.dev || finalPath.ino !== opened.ino || finalPath.size !== opened.size || finished.size !== opened.size || finished.mtimeNs !== opened.mtimeNs || finished.ctimeNs !== opened.ctimeNs) {
      return { kind: "unsafe" };
    }
    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      value = null;
    }
    return {
      kind: "regular",
      device: opened.dev,
      inode: opened.ino,
      modifiedAtMs: Number(opened.mtimeMs),
      owner: parseOwner(value)
    };
  } finally {
    await handle.close();
  }
}
function sameIdentity(left, right) {
  return left.device === right.device && left.inode === right.inode;
}
async function restoreUnexpectedLock(tombstone, lockPath) {
  try {
    await link(tombstone, lockPath);
  } catch {
    return;
  }
  try {
    await unlink(tombstone);
  } catch {}
}
async function reclaimObservedLock(lockPath, observed, token, dependencies) {
  const tombstone = `${lockPath}.stale-${token}`;
  try {
    await rename(lockPath, tombstone);
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "EEXIST"))
      return false;
    throw error;
  }
  await dependencies.afterTombstoneMove?.(tombstone, lockPath);
  const moved = await observeLock(tombstone);
  if (moved === null || moved.kind !== "regular" || !sameIdentity(observed, moved)) {
    await restoreUnexpectedLock(tombstone, lockPath);
    return false;
  }
  await unlink(tombstone);
  return true;
}
async function releaseOwnedLock(lockPath, owner, dependencies) {
  const tombstone = `${lockPath}.release-${owner.token}`;
  try {
    await rename(lockPath, tombstone);
  } catch (error) {
    if (isErrno(error, "ENOENT"))
      return;
    throw error;
  }
  await dependencies.afterTombstoneMove?.(tombstone, lockPath);
  const moved = await observeLock(tombstone);
  if (moved?.kind !== "regular" || moved.owner?.token !== owner.token) {
    await restoreUnexpectedLock(tombstone, lockPath);
    return;
  }
  await unlink(tombstone);
}
async function tryAcquire(lockPath, dependencies) {
  for (let attempt = 0;attempt < MAX_RECLAIM_ATTEMPTS; attempt += 1) {
    const owner = {
      version: LOCK_SCHEMA_VERSION,
      pid: dependencies.pid,
      token: dependencies.token(),
      acquiredAt: dependencies.now().toISOString()
    };
    let handle;
    try {
      handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 384);
    } catch (error) {
      if (!isErrno(error, "EEXIST"))
        throw error;
      const observed = await observeLock(lockPath);
      if (observed === null)
        continue;
      if (observed.kind === "unsafe")
        throw new NoteLockBusyError(lockPath);
      const ageMs = Math.max(0, dependencies.now().getTime() - observed.modifiedAtMs);
      const ownerAlive = observed.owner !== null && dependencies.isProcessAlive(observed.owner.pid);
      if (ownerAlive || observed.owner === null && ageMs <= dependencies.staleAfterMs) {
        throw new NoteLockBusyError(lockPath);
      }
      if (await reclaimObservedLock(lockPath, observed, owner.token, dependencies)) {
        continue;
      }
      continue;
    }
    try {
      await handle.writeFile(`${JSON.stringify(owner)}
`, { encoding: "utf8" });
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => {
        return;
      });
      const created = await observeLock(lockPath);
      if (created?.kind === "regular") {
        await reclaimObservedLock(lockPath, created, owner.token, dependencies).catch(() => {
          return;
        });
      }
      throw error;
    }
    let leaseOperationTail = Promise.resolve();
    const runLeaseOperation = (operation) => {
      const result = leaseOperationTail.then(operation);
      leaseOperationTail = result.then(() => {
        return;
      }, () => {
        return;
      });
      return result;
    };
    let heartbeatQueued = false;
    let released = false;
    let releasePromise;
    const timer = setInterval(() => {
      if (heartbeatQueued || releasePromise !== undefined)
        return;
      heartbeatQueued = true;
      runLeaseOperation(async () => {
        if (released)
          return;
        const now = dependencies.now();
        await handle.utimes(now, now);
      }).catch(() => {
        return;
      }).finally(() => {
        heartbeatQueued = false;
      });
    }, dependencies.heartbeatMs);
    timer.unref();
    return {
      path: lockPath,
      assertOwned: () => runLeaseOperation(async () => {
        if (released)
          throw new NoteLockLostError(lockPath);
        const observed = await observeLock(lockPath);
        if (observed?.kind !== "regular" || observed.owner?.token !== owner.token) {
          throw new NoteLockLostError(lockPath);
        }
      }),
      release: async () => {
        if (releasePromise !== undefined)
          return releasePromise;
        clearInterval(timer);
        releasePromise = runLeaseOperation(async () => {
          released = true;
          await handle.close();
          await releaseOwnedLock(lockPath, owner, dependencies);
        });
        return releasePromise;
      }
    };
  }
  throw new NoteLockBusyError(lockPath);
}
async function acquireNoteLock(vaultRoot, canonicalNoteId, options = {}) {
  const lockPath = await lockPathFor(vaultRoot, canonicalNoteId, options.cacheHome);
  return acquireFileLease(lockPath, options);
}
async function acquireFileLease(lockPathInput, options = {}) {
  if (typeof lockPathInput !== "string" || lockPathInput.trim() === "") {
    throw new TypeError("a file lease requires a non-empty path");
  }
  const lockPath = resolve(lockPathInput);
  const requestedDirectory = dirname(lockPath);
  const directory = await realpath(requestedDirectory);
  const metadata = await lstat(directory);
  if (directory !== requestedDirectory || !metadata.isDirectory() || metadata.isSymbolicLink() || dirname(lockPath) !== directory) {
    throw new Error("the file lease parent must be one canonical real directory");
  }
  const dependencies = resolvedDependencies(options.dependencies);
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
  if (!Number.isFinite(waitTimeoutMs) || waitTimeoutMs < 0) {
    throw new TypeError("waitTimeoutMs must be a non-negative finite duration");
  }
  const deadline = dependencies.monotonicNow() + waitTimeoutMs;
  for (;; ) {
    try {
      return await tryAcquire(lockPath, dependencies);
    } catch (error) {
      if (!(error instanceof NoteLockBusyError))
        throw error;
      const remaining = deadline - dependencies.monotonicNow();
      if (remaining <= 0)
        throw error;
      await dependencies.sleep(Math.min(dependencies.pollIntervalMs, remaining));
    }
  }
}

export { acquireNoteLock, acquireFileLease };
