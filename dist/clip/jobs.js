// @bun
import {
  acquireFileLease
} from "../index-3rm7cz6h.js";
import {
  redactSensitiveText
} from "../index-mxxxytys.js";
import {
  sanitizeTerminalLine,
  sanitizeTerminalText
} from "../index-1xxnjn0d.js";

// src/clip/jobs.ts
import { Buffer } from "buffer";
import { randomUUID } from "crypto";
import { constants } from "fs";
import {
  link,
  lstat,
  open,
  opendir,
  realpath,
  rename,
  unlink
} from "fs/promises";
import { homedir } from "os";
import { dirname, join, relative, resolve, sep } from "path";
var CAPTURE_JOB_SCHEMA_VERSION = 1;
var MAX_CAPTURE_JOB_BYTES = 512 * 1024;
var MAX_CAPTURE_JOB_ATTEMPTS = 128;
var MAX_CAPTURE_JOB_WARNINGS = 128;
var MAX_CAPTURE_JOB_RECORDS = 1e4;
var MAX_CAPTURE_JOB_LIST_LIMIT = 1000;
var MAX_REVISION = Number.MAX_SAFE_INTEGER;
var MAX_TARGET_BYTES = 16 * 1024;
var MAX_METHOD_BYTES = 256;
var MAX_MESSAGE_BYTES = 8 * 1024;
var MAX_WARNING_BYTES = 8 * 1024;
var MAX_ERROR_BYTES = 16 * 1024;
var MAX_BUNDLE_PATH_BYTES = 16 * 1024;
var UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
var SHA256 = /^[0-9a-f]{64}$/;
var captureJobPhases = [
  "queued",
  "acquiring",
  "extracting",
  "persisting",
  "finalizing",
  "finished"
];
var captureJobStoreBrand = Symbol("captureJobStore");

class CaptureJobSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "CaptureJobSafetyError";
  }
}

class CaptureJobNotFoundError extends Error {
  id;
  constructor(id) {
    super(`Capture job ${id} does not exist.`);
    this.name = "CaptureJobNotFoundError";
    this.id = id;
  }
}

class CaptureJobConflictError extends Error {
  id;
  expectedRevision;
  actualRevision;
  constructor(id, expectedRevision, actualRevision) {
    super(`Capture job ${id} revision changed from ${expectedRevision} to ${actualRevision}.`);
    this.name = "CaptureJobConflictError";
    this.id = id;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

class CaptureJobChangedDuringReadError extends Error {
}
function isErrno(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}
function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}
function normalizedText(value, label, maxBytes, line) {
  if (typeof value !== "string")
    throw new Error(`${label} must be a string.`);
  if (utf8Bytes(value) > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte input limit.`);
  }
  const sanitized = (line ? sanitizeTerminalLine : sanitizeTerminalText)(redactSensitiveText(value)).trim();
  if (sanitized === "")
    throw new Error(`${label} must not be empty.`);
  if (utf8Bytes(sanitized) > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte limit.`);
  }
  return sanitized;
}
function storedText(value, label, maxBytes, line) {
  const normalized = normalizedText(value, label, maxBytes, line);
  if (normalized !== value) {
    throw new CaptureJobSafetyError(`${label} is not in sanitized canonical form.`);
  }
  return normalized;
}
function captureJobId(value) {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new Error("Capture job id must be a canonical lowercase UUID v4.");
  }
  return value;
}
function revision(value, label = "revision") {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_REVISION) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}
function timestamp(value, label) {
  if (typeof value !== "string" || value.length !== 24) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return value;
}
function inputTimestamp(value) {
  const selected = value ?? new Date;
  if (!(selected instanceof Date) || !Number.isFinite(selected.valueOf())) {
    throw new Error("Capture job timestamp must be a valid Date.");
  }
  return selected.toISOString();
}
function phase(value) {
  if (typeof value !== "string" || !captureJobPhases.includes(value)) {
    throw new Error("Capture job phase is invalid.");
  }
  return value;
}
function lifecycle(value) {
  if (value !== "running" && value !== "completed" && value !== "failed") {
    throw new Error("Capture job lifecycle is invalid.");
  }
  return value;
}
function captureStatus(value) {
  if (value !== "complete" && value !== "partial" && value !== "auth-required" && value !== "blocked" && value !== "unsupported") {
    throw new Error("Capture job status is invalid.");
  }
  return value;
}
function attemptOutcome(value) {
  if (value !== "succeeded" && value !== "failed" && value !== "skipped") {
    throw new Error("Capture job attempt outcome is invalid.");
  }
  return value;
}
function normalizeAttempt(value, label, stored) {
  if (!isRecord(value) || !hasExactKeys(value, ["method", "outcome", "message"])) {
    throw new Error(`${label} must contain only method, outcome, and message.`);
  }
  const text = stored ? storedText : normalizedText;
  return {
    method: text(value.method, `${label}.method`, MAX_METHOD_BYTES, true),
    outcome: attemptOutcome(value.outcome),
    message: text(value.message, `${label}.message`, MAX_MESSAGE_BYTES, false)
  };
}
function normalizeAttempts(value, stored) {
  if (!Array.isArray(value))
    throw new Error("Capture job attempts must be an array.");
  if (value.length > MAX_CAPTURE_JOB_ATTEMPTS) {
    throw new Error(`Capture job attempts exceed the ${MAX_CAPTURE_JOB_ATTEMPTS}-item limit.`);
  }
  return value.map((item, index) => normalizeAttempt(item, `attempts[${index}]`, stored));
}
function normalizeWarnings(value, stored) {
  if (!Array.isArray(value))
    throw new Error("Capture job warnings must be an array.");
  if (value.length > MAX_CAPTURE_JOB_WARNINGS) {
    throw new Error(`Capture job warnings exceed the ${MAX_CAPTURE_JOB_WARNINGS}-item limit.`);
  }
  const text = stored ? storedText : normalizedText;
  return value.map((item, index) => text(item, `warnings[${index}]`, MAX_WARNING_BYTES, false));
}
function normalizeBundle(value, stored) {
  if (!isRecord(value) || !hasExactKeys(value, ["path", "sha256"])) {
    throw new Error("Capture job bundle must contain only path and sha256.");
  }
  const text = stored ? storedText : normalizedText;
  const digest = typeof value.sha256 === "string" ? value.sha256 : "";
  if (!SHA256.test(digest))
    throw new Error("Capture job bundle sha256 must be a lowercase SHA-256 digest.");
  return {
    path: text(value.path, "bundle.path", MAX_BUNDLE_PATH_BYTES, true),
    sha256: digest
  };
}
function parseCaptureJob(value) {
  const keys = [
    "schemaVersion",
    "id",
    "revision",
    "lifecycle",
    "captureStatus",
    "startedAt",
    "updatedAt",
    "finishedAt",
    "phase",
    "target",
    "attempts",
    "warnings",
    "bundle",
    "error"
  ];
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    throw new Error("Capture job record has an invalid schema.");
  }
  if (value.schemaVersion !== CAPTURE_JOB_SCHEMA_VERSION) {
    throw new Error(`Unsupported capture job schema version ${String(value.schemaVersion)}.`);
  }
  const parsedLifecycle = lifecycle(value.lifecycle);
  const parsedPhase = phase(value.phase);
  const startedAt = timestamp(value.startedAt, "startedAt");
  const updatedAt = timestamp(value.updatedAt, "updatedAt");
  const finishedAt = value.finishedAt === null ? null : timestamp(value.finishedAt, "finishedAt");
  const parsedStatus = value.captureStatus === null ? null : captureStatus(value.captureStatus);
  const bundle = value.bundle === null ? null : normalizeBundle(value.bundle, true);
  const error = value.error === null ? null : storedText(value.error, "error", MAX_ERROR_BYTES, false);
  if (updatedAt < startedAt)
    throw new Error("updatedAt must not precede startedAt.");
  if (finishedAt !== null && (finishedAt !== updatedAt || finishedAt < startedAt)) {
    throw new Error("finishedAt must equal the terminal updatedAt timestamp.");
  }
  if (parsedLifecycle === "running") {
    if (parsedPhase === "finished" || parsedStatus !== null || finishedAt !== null || bundle !== null || error !== null) {
      throw new Error("Running capture job state is inconsistent.");
    }
  } else if (parsedLifecycle === "completed") {
    if (parsedPhase !== "finished" || parsedStatus === null || finishedAt === null || error !== null) {
      throw new Error("Completed capture job state is inconsistent.");
    }
  } else if (parsedPhase !== "finished" || parsedStatus !== null || finishedAt === null || bundle !== null || error === null) {
    throw new Error("Failed capture job state is inconsistent.");
  }
  return {
    schemaVersion: CAPTURE_JOB_SCHEMA_VERSION,
    id: captureJobId(value.id),
    revision: revision(value.revision),
    lifecycle: parsedLifecycle,
    captureStatus: parsedStatus,
    startedAt,
    updatedAt,
    finishedAt,
    phase: parsedPhase,
    target: storedText(value.target, "target", MAX_TARGET_BYTES, true),
    attempts: normalizeAttempts(value.attempts, true),
    warnings: normalizeWarnings(value.warnings, true),
    bundle,
    error
  };
}
function renderCaptureJob(record) {
  return `${JSON.stringify(record, null, 2)}
`;
}
function sameIdentity(left, right) {
  return left.dev === right.device && left.ino === right.inode;
}
function within(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !fromRoot.includes(sep);
}
function pathFor(store, id) {
  const safeId = captureJobId(id);
  const candidate = join(store.root, `${safeId}.json`);
  if (!within(store.root, candidate))
    throw new CaptureJobSafetyError("Capture job path escapes its store.");
  return candidate;
}
async function directoryIdentity(path) {
  const before = await lstat(path, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new CaptureJobSafetyError("Capture job store must be a real directory, not a link.");
  }
  if ((Number(before.mode) & 63) !== 0) {
    throw new CaptureJobSafetyError("Capture job store must not grant group or world access.");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isDirectory() || (Number(opened.mode) & 63) !== 0 || !sameIdentity(opened, { device: before.dev, inode: before.ino })) {
      throw new CaptureJobSafetyError("Capture job store changed while it was opened.");
    }
    return { device: opened.dev, inode: opened.ino };
  } finally {
    await handle.close();
  }
}
async function openCaptureJobStore(root) {
  if (typeof root !== "string" || root.trim() === "") {
    throw new Error("Capture job store path must not be empty.");
  }
  const selected = resolve(root);
  if (selected === dirname(selected) || selected === resolve(homedir())) {
    throw new CaptureJobSafetyError("Capture job store must be a dedicated subdirectory.");
  }
  let canonical;
  try {
    canonical = await realpath(selected);
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      throw new CaptureJobSafetyError("Capture job store must already exist.");
    }
    throw error;
  }
  if (canonical !== selected) {
    throw new CaptureJobSafetyError("Capture job store path must not contain filesystem aliases or links.");
  }
  const identity = await directoryIdentity(canonical);
  return {
    root: canonical,
    [captureJobStoreBrand]: identity
  };
}
async function assertStore(store) {
  if (!isRecord(store) || typeof store.root !== "string" || !(captureJobStoreBrand in store)) {
    throw new CaptureJobSafetyError("Capture job store was not opened by openCaptureJobStore().");
  }
  const expected = store[captureJobStoreBrand];
  const canonical = await realpath(store.root).catch(() => "");
  if (canonical !== store.root)
    throw new CaptureJobSafetyError("Capture job store path changed or became aliased.");
  const actual = await directoryIdentity(store.root);
  if (actual.device !== expected.device || actual.inode !== expected.inode) {
    throw new CaptureJobSafetyError("Capture job store was replaced after it was opened.");
  }
}
async function fsyncStore(store) {
  await assertStore(store);
  const handle = await open(store.root, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    const expected = store[captureJobStoreBrand];
    if (!stat.isDirectory() || !sameIdentity(stat, expected)) {
      throw new CaptureJobSafetyError("Capture job store changed before synchronization.");
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}
function assertPrivateRegularFile(stat, label) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
    throw new CaptureJobSafetyError(`${label} must be a single-link regular file.`);
  }
  if ((Number(stat.mode) & 63) !== 0) {
    throw new CaptureJobSafetyError(`${label} must not grant group or world access.`);
  }
  if (stat.size < 1n || stat.size > BigInt(MAX_CAPTURE_JOB_BYTES)) {
    throw new CaptureJobSafetyError(`${label} exceeds the bounded record size.`);
  }
}
async function readSnapshotOnce(store, id) {
  await assertStore(store);
  const path = pathFor(store, id);
  let before;
  try {
    before = await lstat(path, { bigint: true });
  } catch (error) {
    if (isErrno(error, "ENOENT"))
      throw new CaptureJobNotFoundError(id);
    throw error;
  }
  assertPrivateRegularFile(before, "Capture job record");
  const identity = { device: before.dev, inode: before.ino };
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (isErrno(error, "ENOENT"))
      throw new CaptureJobChangedDuringReadError;
    throw new CaptureJobSafetyError(`Capture job record could not be opened safely: ${String(error)}`);
  }
  let bytes;
  try {
    const opened = await handle.stat({ bigint: true });
    assertPrivateRegularFile(opened, "Opened capture job record");
    if (!sameIdentity(opened, identity))
      throw new CaptureJobChangedDuringReadError;
    bytes = await handle.readFile();
    const complete = await handle.stat({ bigint: true });
    if (!sameIdentity(complete, identity) || complete.size !== BigInt(bytes.byteLength)) {
      throw new CaptureJobChangedDuringReadError;
    }
  } finally {
    await handle.close();
  }
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_CAPTURE_JOB_BYTES) {
    throw new CaptureJobSafetyError("Capture job record exceeds the bounded record size.");
  }
  const after = await lstat(path, { bigint: true }).catch((error) => {
    if (isErrno(error, "ENOENT"))
      return null;
    throw error;
  });
  if (after === null || !sameIdentity(after, identity))
    throw new CaptureJobChangedDuringReadError;
  assertPrivateRegularFile(after, "Capture job record");
  await assertStore(store);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CaptureJobSafetyError("Capture job record is not valid UTF-8.");
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CaptureJobSafetyError("Capture job record is not valid JSON.");
  }
  const record = parseCaptureJob(raw);
  if (record.id !== id)
    throw new CaptureJobSafetyError("Capture job id does not match its filename.");
  if (renderCaptureJob(record) !== text) {
    throw new CaptureJobSafetyError("Capture job record is not canonical JSON.");
  }
  return { record, identity };
}
async function readSnapshot(store, id) {
  captureJobId(id);
  for (let attempt = 0;attempt < 3; attempt += 1) {
    try {
      return await readSnapshotOnce(store, id);
    } catch (error) {
      if (!(error instanceof CaptureJobChangedDuringReadError) || attempt === 2)
        throw error;
    }
  }
  throw new CaptureJobChangedDuringReadError;
}
async function writeTemporary(store, record) {
  const text = renderCaptureJob(record);
  if (utf8Bytes(text) > MAX_CAPTURE_JOB_BYTES) {
    throw new Error(`Capture job record exceeds the ${MAX_CAPTURE_JOB_BYTES}-byte limit.`);
  }
  await assertStore(store);
  const temporaryPath = join(store.root, `.${record.id}.${randomUUID()}.tmp`);
  if (!within(store.root, temporaryPath))
    throw new CaptureJobSafetyError("Temporary capture job path escapes its store.");
  const handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
  let closed = false;
  let identity = null;
  try {
    const created = await handle.stat({ bigint: true });
    if (!created.isFile() || created.nlink !== 1n || (Number(created.mode) & 63) !== 0) {
      throw new CaptureJobSafetyError("Temporary capture job record is not a private regular file.");
    }
    identity = { device: created.dev, inode: created.ino };
    await handle.writeFile(text, "utf8");
    await handle.sync();
    const complete = await handle.stat({ bigint: true });
    if (!complete.isFile() || complete.nlink !== 1n || !sameIdentity(complete, identity)) {
      throw new CaptureJobSafetyError("Temporary capture job record changed before installation.");
    }
    await handle.close();
    closed = true;
    await assertStore(store);
    const named = await lstat(temporaryPath, { bigint: true });
    if (!sameIdentity(named, identity) || named.nlink !== 1n || !named.isFile()) {
      throw new CaptureJobSafetyError("Temporary capture job name changed before installation.");
    }
    return { path: temporaryPath, identity };
  } catch (error) {
    if (!closed)
      await handle.close().catch(() => {
        return;
      });
    if (identity !== null) {
      await unlinkOwnedTemporary(store, temporaryPath, identity).catch(() => {
        return;
      });
    }
    throw error;
  }
}
async function unlinkOwnedTemporary(store, path, identity) {
  await assertStore(store);
  const current = await lstat(path, { bigint: true }).catch((error) => {
    if (isErrno(error, "ENOENT"))
      return null;
    throw error;
  });
  if (current !== null && current.isFile() && current.nlink === 1n && sameIdentity(current, identity)) {
    await unlink(path);
  }
}
async function assertCurrentSnapshot(store, id, expected) {
  const actual = await readSnapshot(store, id);
  if (actual.record.revision !== expected.record.revision || actual.identity.device !== expected.identity.device || actual.identity.inode !== expected.identity.inode) {
    throw new CaptureJobConflictError(id, expected.record.revision, actual.record.revision);
  }
}
async function installCreatedRecord(store, record, lease) {
  const temporary = await writeTemporary(store, record);
  const path = pathFor(store, record.id);
  let temporaryExists = true;
  try {
    await assertStore(store);
    await lease.assertOwned();
    try {
      await link(temporary.path, path);
    } catch (error) {
      if (isErrno(error, "EEXIST"))
        throw new CaptureJobConflictError(record.id, 0, (await readSnapshot(store, record.id)).record.revision);
      throw error;
    }
    await unlink(temporary.path);
    temporaryExists = false;
    const installed = await readSnapshot(store, record.id);
    if (installed.record.revision !== record.revision || installed.record.id !== record.id) {
      throw new CaptureJobSafetyError("Installed capture job record does not match the requested record.");
    }
    if (renderCaptureJob(installed.record) !== renderCaptureJob(record)) {
      throw new CaptureJobSafetyError("Installed capture job record differs from the requested record.");
    }
    await fsyncStore(store);
  } finally {
    if (temporaryExists)
      await unlinkOwnedTemporary(store, temporary.path, temporary.identity).catch(() => {
        return;
      });
  }
}
async function installUpdatedRecord(store, previous, record, lease) {
  const temporary = await writeTemporary(store, record);
  const path = pathFor(store, record.id);
  let temporaryExists = true;
  try {
    await assertCurrentSnapshot(store, record.id, previous);
    await assertStore(store);
    await lease.assertOwned();
    await rename(temporary.path, path);
    temporaryExists = false;
    const installed = await readSnapshot(store, record.id);
    if (installed.record.revision !== record.revision || renderCaptureJob(installed.record) !== renderCaptureJob(record)) {
      throw new CaptureJobSafetyError("Capture job update was not installed atomically.");
    }
    await fsyncStore(store);
  } finally {
    if (temporaryExists)
      await unlinkOwnedTemporary(store, temporary.path, temporary.identity).catch(() => {
        return;
      });
  }
}
var mutationTails = new Map;
async function withMutation(store, id, action) {
  const key = `${store.root}\x00${id}`;
  const predecessor = mutationTails.get(key) ?? Promise.resolve();
  let release = () => {
    return;
  };
  const gate = new Promise((resolveGate) => {
    release = resolveGate;
  });
  const tail = predecessor.catch(() => {
    return;
  }).then(() => gate);
  mutationTails.set(key, tail);
  await predecessor.catch(() => {
    return;
  });
  let lease;
  try {
    await assertStore(store);
    lease = await acquireFileLease(join(store.root, `.${captureJobId(id)}.lock`));
    await assertStore(store);
    await lease.assertOwned();
    const result = await action(lease);
    return result;
  } finally {
    await lease?.release().catch(() => {
      return;
    });
    release();
    if (mutationTails.get(key) === tail)
      mutationTails.delete(key);
  }
}
function ensureRunning(record) {
  if (record.lifecycle !== "running") {
    throw new Error(`Capture job ${record.id} is terminal and cannot transition again.`);
  }
  if (record.revision >= MAX_REVISION)
    throw new Error("Capture job revision limit reached.");
}
function ensureExpectedRevision(record, expected) {
  const normalized = revision(expected, "expectedRevision");
  if (record.revision !== normalized) {
    throw new CaptureJobConflictError(record.id, normalized, record.revision);
  }
}
function nextTimestamp(record, selected) {
  const next = inputTimestamp(selected);
  if (next < record.updatedAt)
    throw new Error("Capture job timestamp must not move backwards.");
  return next;
}
function appendAttempts(current, appended) {
  const next = [...current, ...normalizeAttempts(appended ?? [], false)];
  if (next.length > MAX_CAPTURE_JOB_ATTEMPTS) {
    throw new Error(`Capture job attempts exceed the ${MAX_CAPTURE_JOB_ATTEMPTS}-item limit.`);
  }
  return next;
}
function appendWarnings(current, appended) {
  const next = [...current, ...normalizeWarnings(appended ?? [], false)];
  if (next.length > MAX_CAPTURE_JOB_WARNINGS) {
    throw new Error(`Capture job warnings exceed the ${MAX_CAPTURE_JOB_WARNINGS}-item limit.`);
  }
  return next;
}
async function createCaptureJob(store, input) {
  await assertStore(store);
  const id = captureJobId(input.id ?? randomUUID());
  return withMutation(store, id, async (lease) => {
    const at = inputTimestamp(input.at);
    const record = {
      schemaVersion: CAPTURE_JOB_SCHEMA_VERSION,
      id,
      revision: 1,
      lifecycle: "running",
      captureStatus: null,
      startedAt: at,
      updatedAt: at,
      finishedAt: null,
      phase: "queued",
      target: normalizedText(input.target, "target", MAX_TARGET_BYTES, true),
      attempts: [],
      warnings: [],
      bundle: null,
      error: null
    };
    await installCreatedRecord(store, record, lease);
    return record;
  });
}
async function readCaptureJob(store, id) {
  return (await readSnapshot(store, id)).record;
}
async function listCaptureJobs(store, options = {}) {
  await assertStore(store);
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CAPTURE_JOB_LIST_LIMIT) {
    throw new Error(`Capture job list limit must be between 1 and ${MAX_CAPTURE_JOB_LIST_LIMIT}.`);
  }
  const ids = [];
  let entries = 0;
  const directory = await opendir(store.root);
  for await (const entry of directory) {
    entries += 1;
    if (entries > MAX_CAPTURE_JOB_RECORDS) {
      throw new Error(`Capture job store exceeds the ${MAX_CAPTURE_JOB_RECORDS}-entry scan limit.`);
    }
    if (!entry.name.endsWith(".json"))
      continue;
    const id = entry.name.slice(0, -5);
    if (UUID_V4.test(id))
      ids.push(id);
  }
  await assertStore(store);
  const records = [];
  for (const id of ids) {
    records.push(await readCaptureJob(store, id));
    records.sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id));
    if (records.length > limit)
      records.pop();
  }
  records.sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id));
  return records;
}
async function updateCaptureJob(store, id, input) {
  captureJobId(id);
  return withMutation(store, id, async (lease) => {
    const previous = await readSnapshot(store, id);
    ensureRunning(previous.record);
    ensureExpectedRevision(previous.record, input.expectedRevision);
    const nextPhase = phase(input.phase);
    if (nextPhase === "finished")
      throw new Error("Running capture job phase cannot be finished.");
    if (captureJobPhases.indexOf(nextPhase) < captureJobPhases.indexOf(previous.record.phase)) {
      throw new Error("Capture job phase cannot move backwards.");
    }
    const at = nextTimestamp(previous.record, input.at);
    const record = {
      ...previous.record,
      revision: previous.record.revision + 1,
      updatedAt: at,
      phase: nextPhase,
      attempts: appendAttempts(previous.record.attempts, input.appendAttempts),
      warnings: appendWarnings(previous.record.warnings, input.appendWarnings)
    };
    await installUpdatedRecord(store, previous, record, lease);
    return record;
  });
}
async function completeCaptureJob(store, id, input) {
  captureJobId(id);
  return withMutation(store, id, async (lease) => {
    const previous = await readSnapshot(store, id);
    ensureRunning(previous.record);
    ensureExpectedRevision(previous.record, input.expectedRevision);
    const at = nextTimestamp(previous.record, input.at);
    const record = {
      ...previous.record,
      revision: previous.record.revision + 1,
      lifecycle: "completed",
      captureStatus: captureStatus(input.status),
      updatedAt: at,
      finishedAt: at,
      phase: "finished",
      attempts: appendAttempts(previous.record.attempts, input.appendAttempts),
      warnings: appendWarnings(previous.record.warnings, input.appendWarnings),
      bundle: input.bundle === undefined || input.bundle === null ? null : normalizeBundle(input.bundle, false)
    };
    await installUpdatedRecord(store, previous, record, lease);
    return record;
  });
}
async function failCaptureJob(store, id, input) {
  captureJobId(id);
  return withMutation(store, id, async (lease) => {
    const previous = await readSnapshot(store, id);
    ensureRunning(previous.record);
    ensureExpectedRevision(previous.record, input.expectedRevision);
    const at = nextTimestamp(previous.record, input.at);
    const record = {
      ...previous.record,
      revision: previous.record.revision + 1,
      lifecycle: "failed",
      updatedAt: at,
      finishedAt: at,
      phase: "finished",
      attempts: appendAttempts(previous.record.attempts, input.appendAttempts),
      warnings: appendWarnings(previous.record.warnings, input.appendWarnings),
      error: normalizedText(input.error, "error", MAX_ERROR_BYTES, false)
    };
    await installUpdatedRecord(store, previous, record, lease);
    return record;
  });
}
export {
  updateCaptureJob,
  readCaptureJob,
  openCaptureJobStore,
  listCaptureJobs,
  failCaptureJob,
  createCaptureJob,
  completeCaptureJob,
  captureJobPhases,
  MAX_CAPTURE_JOB_WARNINGS,
  MAX_CAPTURE_JOB_BYTES,
  MAX_CAPTURE_JOB_ATTEMPTS,
  CaptureJobSafetyError,
  CaptureJobNotFoundError,
  CaptureJobConflictError,
  CAPTURE_JOB_SCHEMA_VERSION
};
