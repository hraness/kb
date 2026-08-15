import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyFrozenEvaluationSnapshot,
  type VerifyFrozenEvaluationSnapshotOptions,
} from "./evaluation-kb.js";
import type {
  EvaluationRetrieverOperationMeasurementV2,
  KnowledgeBaseEvaluationRunnerV2Dependencies,
} from "./evaluation-kb-runner-v2.js";
import {
  evaluationRetrieverDescriptorDigestV2,
  type EvaluationMeasurementProfileV2,
  type EvaluationResourceAccountingV2,
  type EvaluationRetrieverDescriptorV2,
  type EvaluationRetrieverTraceV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";
import {
  indexSemanticVault,
  recommendedEmbeddingModel,
  recommendedEmbeddingModelSha256,
  type SemanticIndexResult,
} from "./semantic.js";
import { scanVault, type VaultSnapshot } from "./vault.js";

const CHILD_ARGUMENT = "--kb-evaluation-measurement-child-v2";
const PROTOCOL = "kb-evaluation-measurement-child-v2";
const PROTOCOL_VERSION = 1;
const WORK_DIRECTORY_PREFIX = "hraness-kb-evaluation-measurement-";
const PREPARATION_MARKER = ".incremental-prepared-v2.json";
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MAX_PROTOCOL_BYTES = 64 * 1_024;
const MAX_STDERR_BYTES = 256 * 1_024;
const MAX_CACHE_ENTRIES = 100_000;
const MAX_MUTATION_BYTES = 64 * 1_024;
const MAX_PATH_BYTES = 4 * 1_024;

const qmdLanes = new Set(["hybrid", "keyword", "semantic"]);
const sha256Pattern = /^[0-9a-f]{64}$/u;
const objectIdPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type EvaluationMeasurementChildPhaseV2 =
  | "cold-index"
  | "incremental-prepare"
  | "incremental-update";

export type EvaluationIncrementalMutationV2 = Readonly<{
  /** Vault-relative Markdown note changed between the prepared and measured generations. */
  readonly sourcePath: string;
  /** Exact text appended to sourcePath. It must start and end with a line feed. */
  readonly appendText: string;
  /** SHA-256 of the complete UTF-8 document after the append is applied. */
  readonly expectedPostMutationSha256: string;
  /** Digest returned by evaluationIncrementalMutationSha256V2. */
  readonly sha256: string;
}>;

export type EvaluationMeasurementChildProcessRequestV2 = Readonly<{
  readonly command: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin: Uint8Array;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly signal: AbortSignal;
}>;

export type EvaluationMeasurementChildProcessResultV2 = Readonly<{
  readonly termination: "aborted" | "exit" | "timeout";
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}>;

export type EvaluationMeasurementChildProcessFactoryV2 = (
  request: EvaluationMeasurementChildProcessRequestV2,
) => Promise<EvaluationMeasurementChildProcessResultV2>;

export type CreateKnowledgeBaseEvaluationRetrieverOperationMeasurerV2Options = Readonly<{
  readonly repository: string;
  readonly root: string;
  readonly embeddingModelFile: string;
  readonly mutation: EvaluationIncrementalMutationV2;
  readonly timeoutMs?: number;
  readonly temporaryDirectory?: string;
  readonly childCommand?: readonly string[];
  readonly childProcessFactory?: EvaluationMeasurementChildProcessFactoryV2;
}>;

type FrozenSnapshotRequest = RetrievalEvaluationCorpusV2["frozen"];

export type EvaluationMeasurementChildRequestV2 = Readonly<{
  readonly protocol: typeof PROTOCOL;
  readonly version: typeof PROTOCOL_VERSION;
  readonly kind: "request";
  readonly requestId: string;
  readonly phase: EvaluationMeasurementChildPhaseV2;
  readonly repository: string;
  readonly root: string;
  readonly frozen: FrozenSnapshotRequest;
  readonly embeddingModelFile: string;
  readonly workRoot: string;
  readonly mutation?: EvaluationIncrementalMutationV2;
}>;

type MeasuredSemanticIndex = Readonly<{
  readonly model: string;
  readonly documentCount: number;
  readonly update: SemanticIndexResult["update"];
  readonly embedding: SemanticIndexResult["embedding"];
}>;

export type EvaluationMeasurementChildResponseV2 = Readonly<{
  readonly protocol: typeof PROTOCOL;
  readonly version: typeof PROTOCOL_VERSION;
  readonly kind: "response";
  readonly requestId: string;
  readonly phase: EvaluationMeasurementChildPhaseV2;
  readonly elapsedMs: number;
  readonly index: MeasuredSemanticIndex;
  readonly resources: EvaluationResourceAccountingV2;
}>;

type ChildVerificationRequest = Readonly<{
  readonly repository: string;
  readonly root: string;
  readonly frozen: FrozenSnapshotRequest;
}>;

export type EvaluationMeasurementChildV2Dependencies = Readonly<{
  readonly verifyFrozenSnapshot?: (request: ChildVerificationRequest) => Promise<void>;
  readonly scanVault?: (root: string) => Promise<Pick<VaultSnapshot, "notes">>;
  readonly indexSemanticVault?: typeof indexSemanticVault;
  readonly measureCacheBytes?: (root: string) => Promise<number>;
  readonly peakRssBytes?: () => number;
  readonly now?: () => number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}>;

type WorkIdentities = Readonly<{
  readonly workRoot: string;
  readonly vault: string;
  readonly cache: string;
  readonly database: string;
  readonly xdgCache: string;
  readonly marker: string;
  readonly forbiddenGenerateModel: string;
  readonly forbiddenRerankModel: string;
}>;

type PreparationMarker = Readonly<{
  readonly protocol: typeof PROTOCOL;
  readonly version: typeof PROTOCOL_VERSION;
  readonly kind: "incremental-prepared";
  readonly requestId: string;
  readonly snapshotSha256: string;
  readonly mutationSha256: string;
  readonly sourcePath: string;
  readonly documentCount: number;
  readonly cacheManifestSha256: string;
  readonly vaultManifestSha256: string;
}>;

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  const missing = required.filter((key) => !(key in value));
  const extra = actual.filter((key) => !allowed.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new TypeError(`${label} has an invalid field set.`);
  }
}

function boundedString(value: unknown, label: string, maximumBytes = MAX_PATH_BYTES): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || /[\0\r\n]/u.test(value)
    || Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new TypeError(`${label} must be a bounded non-empty string.`);
  }
  return value;
}

function absolutePath(value: unknown, label: string): string {
  const path = boundedString(value, label);
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new TypeError(`${label} must be an absolute normalized path.`);
  }
  return path;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonnegativeInteger(value, label);
  if (parsed === 0) throw new TypeError(`${label} must be positive.`);
  return parsed;
}

function nonnegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be non-negative and finite.`);
  }
  return value;
}

function confinedPath(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === ""
    || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function notePath(value: unknown, label: string): string {
  const path = boundedString(value, label);
  if (
    path !== path.normalize("NFC")
    || path.startsWith("/")
    || path.includes("\\")
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
    || !path.endsWith(".md")
  ) {
    throw new TypeError(`${label} must be a confined NFC Markdown path.`);
  }
  return path;
}

/** Digest the exact one-note transition named by an incremental measurement. */
export function evaluationIncrementalMutationSha256V2(
  mutation: Pick<
    EvaluationIncrementalMutationV2,
    "appendText" | "expectedPostMutationSha256" | "sourcePath"
  >,
): string {
  return createHash("sha256")
    .update("kb-evaluation-incremental-mutation-v2\0")
    .update(mutation.sourcePath)
    .update("\0")
    .update(mutation.appendText)
    .update("\0")
    .update(mutation.expectedPostMutationSha256)
    .digest("hex");
}

function parseMutation(value: unknown, label: string): EvaluationIncrementalMutationV2 {
  const input = record(value, label);
  exactKeys(
    input,
    ["appendText", "expectedPostMutationSha256", "sha256", "sourcePath"],
    [],
    label,
  );
  const sourcePath = notePath(input.sourcePath, `${label}.sourcePath`);
  if (sourcePath === "index.md" || basename(sourcePath) === "AGENTS.md") {
    throw new TypeError(`${label}.sourcePath must identify an indexed content note.`);
  }
  if (
    typeof input.appendText !== "string"
    || !input.appendText.startsWith("\n")
    || !input.appendText.endsWith("\n")
    || input.appendText.includes("\0")
    || input.appendText.includes("\r")
    || Buffer.byteLength(input.appendText, "utf8") > MAX_MUTATION_BYTES
  ) {
    throw new TypeError(`${label}.appendText must be bounded LF-delimited UTF-8 text.`);
  }
  if (typeof input.sha256 !== "string" || !sha256Pattern.test(input.sha256)) {
    throw new TypeError(`${label}.sha256 must be a lowercase SHA-256 digest.`);
  }
  if (
    typeof input.expectedPostMutationSha256 !== "string"
    || !sha256Pattern.test(input.expectedPostMutationSha256)
  ) {
    throw new TypeError(`${label}.expectedPostMutationSha256 must be a lowercase SHA-256 digest.`);
  }
  const parsed = Object.freeze({
    sourcePath,
    appendText: input.appendText,
    expectedPostMutationSha256: input.expectedPostMutationSha256,
    sha256: input.sha256,
  });
  if (evaluationIncrementalMutationSha256V2(parsed) !== parsed.sha256) {
    throw new TypeError(`${label}.sha256 does not bind the declared mutation.`);
  }
  return parsed;
}

function parseFrozen(value: unknown, label: string): FrozenSnapshotRequest {
  const input = record(value, label);
  exactKeys(input, ["repositoryCommit", "vaultRoot", "vaultTree"], [], label);
  if (typeof input.repositoryCommit !== "string" || !objectIdPattern.test(input.repositoryCommit)) {
    throw new TypeError(`${label}.repositoryCommit is invalid.`);
  }
  if (typeof input.vaultTree !== "string" || !objectIdPattern.test(input.vaultTree)) {
    throw new TypeError(`${label}.vaultTree is invalid.`);
  }
  if (
    typeof input.vaultRoot !== "string"
    || input.vaultRoot.length === 0
    || /[\0\r\n]/u.test(input.vaultRoot)
    || input.vaultRoot !== input.vaultRoot.normalize("NFC")
    || input.vaultRoot.startsWith("/")
    || input.vaultRoot.includes("\\")
    || (input.vaultRoot !== "."
      && input.vaultRoot.split("/").some((part) => part === "" || part === "." || part === ".."))
    || Buffer.byteLength(input.vaultRoot, "utf8") > MAX_PATH_BYTES
  ) {
    throw new TypeError(`${label}.vaultRoot must be a confined NFC path.`);
  }
  const vaultRoot = input.vaultRoot;
  return Object.freeze({
    repositoryCommit: input.repositoryCommit,
    vaultTree: input.vaultTree,
    vaultRoot,
  });
}

function parsePhase(value: unknown): EvaluationMeasurementChildPhaseV2 {
  if (value !== "cold-index" && value !== "incremental-prepare" && value !== "incremental-update") {
    throw new TypeError("measurement child phase is invalid.");
  }
  return value;
}

function parseChildRequest(value: unknown): EvaluationMeasurementChildRequestV2 {
  const input = record(value, "measurement child request");
  exactKeys(input, [
    "embeddingModelFile",
    "frozen",
    "kind",
    "phase",
    "protocol",
    "repository",
    "requestId",
    "root",
    "version",
    "workRoot",
  ], ["mutation"], "measurement child request");
  if (input.protocol !== PROTOCOL || input.version !== PROTOCOL_VERSION || input.kind !== "request") {
    throw new TypeError("measurement child protocol identity is invalid.");
  }
  if (typeof input.requestId !== "string" || !requestIdPattern.test(input.requestId)) {
    throw new TypeError("measurement child requestId is invalid.");
  }
  const phase = parsePhase(input.phase);
  const mutation = input.mutation === undefined ? undefined : parseMutation(input.mutation, "mutation");
  if ((phase === "cold-index") !== (mutation === undefined)) {
    throw new TypeError("measurement child mutation presence does not match its phase.");
  }
  return Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "request",
    requestId: input.requestId,
    phase,
    repository: absolutePath(input.repository, "repository"),
    root: absolutePath(input.root, "root"),
    frozen: parseFrozen(input.frozen, "frozen"),
    embeddingModelFile: absolutePath(input.embeddingModelFile, "embeddingModelFile"),
    workRoot: absolutePath(input.workRoot, "workRoot"),
    ...(mutation === undefined ? {} : { mutation }),
  });
}

function workIdentities(workRoot: string): WorkIdentities {
  return Object.freeze({
    workRoot,
    vault: join(workRoot, "vault"),
    cache: join(workRoot, "cache"),
    database: join(workRoot, "cache", "qmd.sqlite"),
    xdgCache: join(workRoot, "cache", "xdg"),
    marker: join(workRoot, PREPARATION_MARKER),
    forbiddenGenerateModel: join(workRoot, ".generative-llm-forbidden.gguf"),
    forbiddenRerankModel: join(workRoot, ".reranker-llm-forbidden.gguf"),
  });
}

async function validatedWorkIdentities(workRoot: string): Promise<WorkIdentities> {
  const metadata = await lstat(workRoot);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new TypeError("measurement work root must be a real directory.");
  }
  const canonical = await realpath(workRoot);
  if (canonical !== workRoot || !basename(workRoot).startsWith(WORK_DIRECTORY_PREFIX)) {
    throw new TypeError("measurement work root identity is invalid.");
  }
  return workIdentities(workRoot);
}

async function validateIsolatedDirectory(path: string, label: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || await realpath(path) !== path) {
    throw new TypeError(`${label} must be a canonical non-symlink directory.`);
  }
}

async function validateWorkLayout(
  identities: WorkIdentities,
  phase: EvaluationMeasurementChildPhaseV2,
): Promise<void> {
  const names = (await readdir(identities.workRoot)).toSorted();
  if (phase === "cold-index" || phase === "incremental-prepare") {
    if (names.length !== 0) {
      throw new TypeError("cold measurement work root must be empty.");
    }
    return;
  }
  const expected = [PREPARATION_MARKER, "cache", "vault"].toSorted();
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    throw new TypeError("incremental measurement work root has an invalid layout.");
  }
}

function fileErrorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

async function requireAbsent(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (fileErrorCode(error) === "ENOENT") return;
    throw error;
  }
  throw new TypeError(`${label} must remain absent.`);
}

function snapshotSha256(frozen: FrozenSnapshotRequest): string {
  return createHash("sha256")
    .update(`${frozen.repositoryCommit}\0${frozen.vaultTree}\0${frozen.vaultRoot}`)
    .digest("hex");
}

function vaultManifestSha256(notes: readonly { readonly path: string; readonly content: string }[]): string {
  const hash = createHash("sha256").update("kb-evaluation-materialized-vault-v2\0");
  for (const note of notes.toSorted((left, right) => left.path.localeCompare(right.path))) {
    hash.update(note.path).update("\0");
    hash.update(createHash("sha256").update(note.content).digest("hex")).update("\0");
  }
  return hash.digest("hex");
}

function indexedDocumentCount(notes: readonly { readonly path: string }[]): number {
  return notes.filter(({ path }) => path !== "index.md" && basename(path) !== "AGENTS.md").length;
}

async function materializeVault(
  root: string,
  notes: readonly { readonly path: string; readonly content: string }[],
): Promise<void> {
  await mkdir(root, { mode: 0o700 });
  const seen = new Set<string>();
  for (const note of notes.toSorted((left, right) => left.path.localeCompare(right.path))) {
    const path = notePath(note.path, "snapshot note path");
    if (seen.has(path)) throw new TypeError("snapshot note paths must be unique.");
    seen.add(path);
    const destination = resolve(root, path);
    if (!confinedPath(root, destination) || destination === root) {
      throw new TypeError("snapshot note escaped the materialized vault.");
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, note.content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
}

function validateIndexResult(
  result: SemanticIndexResult,
  phase: EvaluationMeasurementChildPhaseV2,
  documentCount: number,
): void {
  if (result.model !== recommendedEmbeddingModel) {
    throw new TypeError("semantic indexing returned the wrong model identity.");
  }
  const update = result.update;
  for (const [key, value] of Object.entries(update)) nonnegativeInteger(value, `semantic update.${key}`);
  if (update.collections !== 1 || update.removed !== 0 || result.embedding === null) {
    throw new TypeError("semantic indexing did not satisfy the measured generation invariant.");
  }
  const embedding = result.embedding;
  nonnegativeInteger(embedding.docsProcessed, "semantic embedding.docsProcessed");
  nonnegativeInteger(embedding.chunksEmbedded, "semantic embedding.chunksEmbedded");
  nonnegativeInteger(embedding.errors, "semantic embedding.errors");
  nonnegativeNumber(embedding.durationMs, "semantic embedding.durationMs");
  if (
    embedding.errors !== 0
    || (embedding.failures?.length ?? 0) !== 0
    || embedding.chunksEmbedded < embedding.docsProcessed
  ) {
    throw new TypeError("semantic embedding did not complete cleanly.");
  }
  if (phase === "cold-index" || phase === "incremental-prepare") {
    if (
      documentCount < 1
      || update.indexed !== documentCount
      || update.updated !== 0
      || update.unchanged !== 0
      || update.needsEmbedding !== documentCount
      || embedding.docsProcessed !== documentCount
    ) {
      throw new TypeError("cold semantic indexing counts violate the exact corpus invariant.");
    }
    return;
  }
  if (
    update.indexed !== 0
    || update.updated !== 1
    || update.unchanged !== documentCount - 1
    || update.needsEmbedding !== 1
    || embedding.docsProcessed !== 1
  ) {
    throw new TypeError("incremental semantic indexing counts violate the exact one-note invariant.");
  }
}

function defaultPeakRssBytes(): number {
  const current = process.memoryUsage().rss;
  const reported = process.resourceUsage().maxRSS;
  if (!Number.isSafeInteger(current) || current < 1 || !Number.isSafeInteger(reported) || reported < 1) {
    throw new TypeError("runtime peak RSS accounting is unavailable.");
  }
  const normalized = reported >= current ? reported : reported * 1_024;
  if (!Number.isSafeInteger(normalized) || normalized < current) {
    throw new TypeError("runtime peak RSS accounting is invalid.");
  }
  return normalized;
}

export type EvaluationCacheManifestV2 = Readonly<{
  readonly bytes: number;
  readonly sha256: string;
}>;

async function digestEvaluationCacheFile(path: string): Promise<Readonly<{
  readonly bytes: number;
  readonly sha256: string;
}>> {
  const pathBefore = await lstat(path);
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile() || pathBefore.nlink !== 1) {
    throw new TypeError("evaluation cache files must be regular and singly linked.");
  }
  if (!Number.isSafeInteger(pathBefore.size) || pathBefore.size < 0) {
    throw new RangeError("evaluation cache file size is invalid.");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (
      !before.isFile()
      || before.nlink !== 1
      || before.dev !== pathBefore.dev
      || before.ino !== pathBefore.ino
      || before.size !== pathBefore.size
    ) {
      throw new TypeError("evaluation cache file identity changed before it was read.");
    }
    const hash = createHash("sha256");
    const buffer = new Uint8Array(1_024 * 1_024);
    let observed = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      observed += bytesRead;
      if (!Number.isSafeInteger(observed)) {
        throw new RangeError("evaluation cache file byte count overflowed.");
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (
      !after.isFile()
      || after.nlink !== 1
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || observed !== before.size
      || pathAfter.isSymbolicLink()
      || !pathAfter.isFile()
      || pathAfter.nlink !== 1
      || pathAfter.dev !== before.dev
      || pathAfter.ino !== before.ino
      || pathAfter.size !== before.size
    ) {
      throw new Error("evaluation cache file changed while it was measured.");
    }
    return Object.freeze({ bytes: observed, sha256: hash.digest("hex") });
  } finally {
    await handle.close();
  }
}

/** Hash one complete isolated cache tree without following aliases or special files. */
export async function measureEvaluationCacheManifestV2(
  root: string,
): Promise<EvaluationCacheManifestV2> {
  const requestedRoot = resolve(root);
  const rootMetadata = await lstat(requestedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new TypeError("evaluation cache root must be a non-symlink directory.");
  }
  const canonicalRoot = await realpath(requestedRoot);
  const entries: { readonly kind: "directory" | "file"; readonly path: string }[] = [];
  let bytes = 0;
  const pending = [canonicalRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entries.length >= MAX_CACHE_ENTRIES) throw new RangeError("evaluation cache has too many entries.");
      const path = join(directory, child.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new TypeError("evaluation cache must not contain symbolic links.");
      if (metadata.isDirectory()) {
        entries.push({ kind: "directory", path });
        pending.push(path);
        continue;
      }
      if (!metadata.isFile()) throw new TypeError("evaluation cache must contain only regular files.");
      if (metadata.nlink !== 1) throw new TypeError("evaluation cache files must be singly linked.");
      entries.push({ kind: "file", path });
    }
  }
  const hash = createHash("sha256").update("kb-evaluation-cache-manifest-v2\0");
  for (const entry of entries.toSorted((left, right) => left.path.localeCompare(right.path))) {
    const relativePath = relative(canonicalRoot, entry.path).split(sep).join("/");
    hash.update(entry.kind).update("\0").update(relativePath).update("\0");
    if (entry.kind === "directory") continue;
    const file = await digestEvaluationCacheFile(entry.path);
    bytes += file.bytes;
    if (!Number.isSafeInteger(bytes)) throw new RangeError("evaluation cache byte count overflowed.");
    hash.update(String(file.bytes)).update("\0").update(file.sha256).update("\0");
  }
  return Object.freeze({ bytes, sha256: hash.digest("hex") });
}

/** Sum regular files in one isolated cache tree and reject aliases or special files. */
export async function measureEvaluationCacheBytesV2(root: string): Promise<number> {
  return (await measureEvaluationCacheManifestV2(root)).bytes;
}

async function defaultVerifyFrozenSnapshot(request: ChildVerificationRequest): Promise<void> {
  const corpus: VerifyFrozenEvaluationSnapshotOptions["corpus"] = { frozen: request.frozen };
  await verifyFrozenEvaluationSnapshot({
    repository: request.repository,
    root: request.root,
    corpus,
  });
}

async function scan(root: string, dependencies: EvaluationMeasurementChildV2Dependencies) {
  return await (dependencies.scanVault ?? ((path: string) => scanVault(path, { mentionScope: false })))(root);
}

async function readPreparationMarker(path: string): Promise<PreparationMarker> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1 || metadata.size > MAX_PROTOCOL_BYTES) {
    throw new TypeError("incremental preparation marker is invalid.");
  }
  const input = record(JSON.parse(await readFile(path, "utf8")) as unknown, "incremental preparation marker");
  exactKeys(input, [
    "cacheManifestSha256",
    "documentCount",
    "kind",
    "mutationSha256",
    "protocol",
    "requestId",
    "snapshotSha256",
    "sourcePath",
    "vaultManifestSha256",
    "version",
  ], [], "incremental preparation marker");
  if (
    input.protocol !== PROTOCOL
    || input.version !== PROTOCOL_VERSION
    || input.kind !== "incremental-prepared"
    || typeof input.requestId !== "string"
    || !requestIdPattern.test(input.requestId)
    || typeof input.snapshotSha256 !== "string"
    || !sha256Pattern.test(input.snapshotSha256)
    || typeof input.mutationSha256 !== "string"
    || !sha256Pattern.test(input.mutationSha256)
    || typeof input.cacheManifestSha256 !== "string"
    || !sha256Pattern.test(input.cacheManifestSha256)
    || typeof input.vaultManifestSha256 !== "string"
    || !sha256Pattern.test(input.vaultManifestSha256)
  ) {
    throw new TypeError("incremental preparation marker identity is invalid.");
  }
  return Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "incremental-prepared",
    requestId: input.requestId,
    snapshotSha256: input.snapshotSha256,
    mutationSha256: input.mutationSha256,
    sourcePath: notePath(input.sourcePath, "incremental preparation marker.sourcePath"),
    documentCount: positiveInteger(input.documentCount, "incremental preparation marker.documentCount"),
    cacheManifestSha256: input.cacheManifestSha256,
    vaultManifestSha256: input.vaultManifestSha256,
  });
}

async function prepareIncrementalMutation(
  request: EvaluationMeasurementChildRequestV2,
  identities: WorkIdentities,
  notes: readonly { readonly path: string; readonly content: string }[],
  documentCount: number,
  dependencies: EvaluationMeasurementChildV2Dependencies,
): Promise<void> {
  const mutation = request.mutation;
  if (mutation === undefined) throw new TypeError("incremental preparation requires a mutation.");
  const source = notes.find(({ path }) => path === mutation.sourcePath);
  if (source === undefined) throw new TypeError("incremental mutation source is absent from the frozen vault.");
  const sourceFile = resolve(identities.vault, mutation.sourcePath);
  if (!confinedPath(identities.vault, sourceFile)) throw new TypeError("incremental mutation escaped the vault.");
  const metadata = await lstat(sourceFile);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new TypeError("incremental mutation source must be a regular singly linked file.");
  }
  const changedContent = `${source.content}${mutation.appendText}`;
  if (
    createHash("sha256").update(changedContent, "utf8").digest("hex")
      !== mutation.expectedPostMutationSha256
  ) {
    throw new TypeError("incremental mutation does not produce its sealed post-mutation digest.");
  }
  await writeFile(sourceFile, changedContent, { encoding: "utf8", flag: "w" });
  const changed = await scan(identities.vault, dependencies);
  if (indexedDocumentCount(changed.notes) !== documentCount) {
    throw new TypeError("incremental mutation changed the indexed document set.");
  }
  const cacheManifest = await measureEvaluationCacheManifestV2(identities.cache);
  const marker: PreparationMarker = Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "incremental-prepared",
    requestId: request.requestId,
    snapshotSha256: snapshotSha256(request.frozen),
    mutationSha256: mutation.sha256,
    sourcePath: mutation.sourcePath,
    documentCount,
    cacheManifestSha256: cacheManifest.sha256,
    vaultManifestSha256: vaultManifestSha256(changed.notes),
  });
  await writeFile(identities.marker, JSON.stringify(marker), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function resourcesFor(result: SemanticIndexResult, peakRssBytes: number, cacheBytes: number) {
  const embedding = result.embedding;
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: embedding === null ? 0 : 1,
      // QMD exposes exact embedding duration and work counts, but not tokenizer input count.
      inputTokens: 0,
      ...(embedding === null ? {} : { inputTokensMeasured: false as const }),
      durationMs: embedding?.durationMs ?? 0,
    }),
    packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
    peakRssBytes,
    cacheBytes,
  });
}

/** Execute one protocol phase. Dependencies make the child logic testable without QMD or model I/O. */
export async function executeKnowledgeBaseEvaluationMeasurementChildV2(
  value: unknown,
  dependencies: EvaluationMeasurementChildV2Dependencies = {},
): Promise<EvaluationMeasurementChildResponseV2> {
  const request = parseChildRequest(value);
  const identities = await validatedWorkIdentities(request.workRoot);
  const environment = dependencies.environment ?? process.env;
  if (
    environment.XDG_CACHE_HOME !== identities.xdgCache
    || environment.HF_HUB_OFFLINE !== "1"
    || environment.TRANSFORMERS_OFFLINE !== "1"
    || environment.GGML_METAL_NO_RESIDENCY !== "1"
    || environment.QMD_EMBED_PARALLELISM !== "1"
    || environment.QMD_LLAMA_GPU !== "auto"
    || environment.QMD_GENERATE_MODEL !== identities.forbiddenGenerateModel
    || environment.QMD_RERANK_MODEL !== identities.forbiddenRerankModel
    || environment.TMPDIR !== identities.workRoot
    || environment.TMP !== identities.workRoot
    || environment.TEMP !== identities.workRoot
    || environment.NODE_OPTIONS !== undefined
    || environment.BUN_OPTIONS !== undefined
    || environment.CI !== undefined
    || environment.QMD_FORCE_CPU !== undefined
  ) {
    throw new TypeError("measurement child execution environment is not isolated and pinned.");
  }
  await requireAbsent(identities.forbiddenGenerateModel, "generative model guard");
  await requireAbsent(identities.forbiddenRerankModel, "reranker model guard");
  await validateWorkLayout(identities, request.phase);
  if (confinedPath(identities.cache, request.embeddingModelFile)) {
    throw new TypeError("the pinned model file must be independent of the measured cache.");
  }
  const verify = dependencies.verifyFrozenSnapshot ?? defaultVerifyFrozenSnapshot;
  const index = dependencies.indexSemanticVault ?? indexSemanticVault;
  const now = dependencies.now ?? (() => performance.now());
  const cacheBytes = dependencies.measureCacheBytes ?? measureEvaluationCacheBytesV2;
  const peakRss = dependencies.peakRssBytes ?? defaultPeakRssBytes;
  let snapshot: Pick<VaultSnapshot, "notes">;
  let documentCount: number;

  if (request.phase === "cold-index" || request.phase === "incremental-prepare") {
    await verify({ repository: request.repository, root: request.root, frozen: request.frozen });
    snapshot = await scan(request.root, dependencies);
    documentCount = indexedDocumentCount(snapshot.notes);
    if (documentCount < 1) throw new TypeError("measurement vault must contain an indexed content note.");
    await materializeVault(identities.vault, snapshot.notes);
    await mkdir(identities.xdgCache, { recursive: true, mode: 0o700 });
  } else {
    await validateIsolatedDirectory(identities.vault, "incremental prepared vault");
    await validateIsolatedDirectory(identities.cache, "incremental prepared cache");
    await validateIsolatedDirectory(identities.xdgCache, "incremental prepared XDG cache");
    const marker = await readPreparationMarker(identities.marker);
    const mutation = request.mutation;
    if (
      mutation === undefined
      || marker.requestId !== request.requestId
      || marker.snapshotSha256 !== snapshotSha256(request.frozen)
      || marker.mutationSha256 !== mutation.sha256
      || marker.sourcePath !== mutation.sourcePath
    ) {
      throw new TypeError("incremental update does not match its prepared generation.");
    }
    snapshot = await scan(identities.vault, dependencies);
    documentCount = indexedDocumentCount(snapshot.notes);
    if (
      documentCount !== marker.documentCount
      || vaultManifestSha256(snapshot.notes) !== marker.vaultManifestSha256
    ) {
      throw new TypeError("incremental prepared vault changed before measurement.");
    }
    const databaseMetadata = await lstat(identities.database);
    if (
      databaseMetadata.isSymbolicLink()
      || !databaseMetadata.isFile()
      || databaseMetadata.nlink !== 1
    ) {
      throw new TypeError("incremental prepared database is absent or aliased.");
    }
    if (
      (await measureEvaluationCacheManifestV2(identities.cache)).sha256
        !== marker.cacheManifestSha256
    ) {
      throw new TypeError("incremental prepared cache changed before measurement.");
    }
  }

  const startedAt = now();
  const indexed = await index({
    root: identities.vault,
    database: identities.database,
    embeddingModelFile: request.embeddingModelFile,
  });
  const elapsedMs = nonnegativeNumber(now() - startedAt, "measurement elapsedMs");
  if (resolve(indexed.root) !== identities.vault || resolve(indexed.database) !== identities.database) {
    throw new TypeError("semantic indexing escaped the isolated measurement identities.");
  }
  validateIndexResult(indexed, request.phase, documentCount);
  const resources = resourcesFor(
    indexed,
    positiveInteger(peakRss(), "measurement peakRssBytes"),
    positiveInteger(await cacheBytes(identities.cache), "measurement cacheBytes"),
  );

  if (request.phase === "incremental-prepare") {
    await prepareIncrementalMutation(
      request,
      identities,
      snapshot.notes,
      documentCount,
      dependencies,
    );
  }
  return Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "response",
    requestId: request.requestId,
    phase: request.phase,
    elapsedMs,
    index: Object.freeze({
      model: indexed.model,
      documentCount,
      update: Object.freeze({ ...indexed.update }),
      embedding: indexed.embedding === null ? null : Object.freeze({ ...indexed.embedding }),
    }),
    resources,
  });
}

function parseUpdate(value: unknown, label: string): SemanticIndexResult["update"] {
  const input = record(value, label);
  exactKeys(input, ["collections", "indexed", "needsEmbedding", "removed", "unchanged", "updated"], [], label);
  return Object.freeze({
    collections: nonnegativeInteger(input.collections, `${label}.collections`),
    indexed: nonnegativeInteger(input.indexed, `${label}.indexed`),
    updated: nonnegativeInteger(input.updated, `${label}.updated`),
    unchanged: nonnegativeInteger(input.unchanged, `${label}.unchanged`),
    removed: nonnegativeInteger(input.removed, `${label}.removed`),
    needsEmbedding: nonnegativeInteger(input.needsEmbedding, `${label}.needsEmbedding`),
  });
}

function parseEmbedding(value: unknown, label: string): NonNullable<SemanticIndexResult["embedding"]> | null {
  if (value === null) return null;
  const input = record(value, label);
  exactKeys(input, ["chunksEmbedded", "docsProcessed", "durationMs", "errors"], ["failures"], label);
  if (input.failures !== undefined && (!Array.isArray(input.failures) || input.failures.length !== 0)) {
    throw new TypeError(`${label}.failures must be absent or empty.`);
  }
  return Object.freeze({
    docsProcessed: nonnegativeInteger(input.docsProcessed, `${label}.docsProcessed`),
    chunksEmbedded: nonnegativeInteger(input.chunksEmbedded, `${label}.chunksEmbedded`),
    errors: nonnegativeInteger(input.errors, `${label}.errors`),
    ...(input.failures === undefined ? {} : { failures: Object.freeze([]) }),
    durationMs: nonnegativeNumber(input.durationMs, `${label}.durationMs`),
  });
}

function parseResources(value: unknown): EvaluationResourceAccountingV2 {
  const input = record(value, "measurement child response.resources");
  exactKeys(input, ["cacheBytes", "embedding", "llm", "packedContext", "peakRssBytes"], [], "measurement child response.resources");
  const llm = record(input.llm, "measurement child response.resources.llm");
  exactKeys(llm, ["calls", "inputTokens", "outputTokens"], [], "measurement child response.resources.llm");
  if (llm.calls !== 0 || llm.inputTokens !== 0 || llm.outputTokens !== 0) {
    throw new TypeError("measurement child reported nonzero generative LLM work.");
  }
  const embedding = record(input.embedding, "measurement child response.resources.embedding");
  exactKeys(
    embedding,
    ["calls", "durationMs", "inputTokens"],
    ["inputTokensMeasured"],
    "measurement child response.resources.embedding",
  );
  const packed = record(input.packedContext, "measurement child response.resources.packedContext");
  exactKeys(packed, ["readerTokens", "utf8Bytes"], [], "measurement child response.resources.packedContext");
  if (packed.readerTokens !== 0 || packed.utf8Bytes !== 0) {
    throw new TypeError("index measurement child reported packed-context work.");
  }
  const embeddingCalls = nonnegativeInteger(embedding.calls, "measurement embedding.calls");
  const embeddingInputTokens = nonnegativeInteger(
    embedding.inputTokens,
    "measurement embedding.inputTokens",
  );
  if (
    (embeddingCalls === 0 && embedding.inputTokensMeasured !== undefined)
    || (embeddingCalls > 0 && embedding.inputTokensMeasured !== false)
    || (embedding.inputTokensMeasured === false && embeddingInputTokens !== 0)
  ) {
    throw new TypeError(
      "measurement embedding input-token accounting must explicitly mark unavailable counts.",
    );
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: embeddingCalls,
      inputTokens: embeddingInputTokens,
      ...(embedding.inputTokensMeasured === false ? { inputTokensMeasured: false as const } : {}),
      durationMs: nonnegativeNumber(embedding.durationMs, "measurement embedding.durationMs"),
    }),
    packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
    peakRssBytes: positiveInteger(input.peakRssBytes, "measurement peakRssBytes"),
    cacheBytes: positiveInteger(input.cacheBytes, "measurement cacheBytes"),
  });
}

function parseChildResponse(
  bytes: Uint8Array,
  request: EvaluationMeasurementChildRequestV2,
): EvaluationMeasurementChildResponseV2 {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROTOCOL_BYTES) {
    throw new TypeError("measurement child response has an invalid byte length.");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.trim() !== text) throw new TypeError("measurement child response framing is invalid.");
  const input = record(JSON.parse(text) as unknown, "measurement child response");
  exactKeys(input, ["elapsedMs", "index", "kind", "phase", "protocol", "requestId", "resources", "version"], [], "measurement child response");
  if (
    input.protocol !== PROTOCOL
    || input.version !== PROTOCOL_VERSION
    || input.kind !== "response"
    || input.requestId !== request.requestId
    || input.phase !== request.phase
  ) {
    throw new TypeError("measurement child response does not match its request.");
  }
  const indexInput = record(input.index, "measurement child response.index");
  exactKeys(indexInput, ["documentCount", "embedding", "model", "update"], [], "measurement child response.index");
  if (indexInput.model !== recommendedEmbeddingModel) {
    throw new TypeError("measurement child response has the wrong model identity.");
  }
  const index = Object.freeze({
    model: recommendedEmbeddingModel,
    documentCount: positiveInteger(indexInput.documentCount, "measurement documentCount"),
    update: parseUpdate(indexInput.update, "measurement child response.index.update"),
    embedding: parseEmbedding(indexInput.embedding, "measurement child response.index.embedding"),
  });
  const elapsedMs = nonnegativeNumber(input.elapsedMs, "measurement child response.elapsedMs");
  const resources = parseResources(input.resources);
  validateIndexResult({ root: "", database: "", ...index }, request.phase, index.documentCount);
  if (
    resources.embedding.calls !== 1
    || resources.embedding.durationMs !== index.embedding?.durationMs
    || resources.embedding.inputTokens !== 0
  ) {
    throw new TypeError("measurement child response accounting contradicts its semantic result.");
  }
  return Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "response",
    requestId: request.requestId,
    phase: request.phase,
    elapsedMs,
    index,
    resources,
  });
}

function timeoutMs(value: number | undefined): number {
  const parsed = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_MS) {
    throw new TypeError(`measurement timeoutMs must be from 1 through ${MAX_TIMEOUT_MS}.`);
  }
  return parsed;
}

function childCommand(value: readonly string[] | undefined): readonly string[] {
  const command = value ?? Object.freeze([process.execPath, fileURLToPath(import.meta.url), CHILD_ARGUMENT]);
  if (
    command.length < 1
    || command.length > 16
    || command.some((part) => typeof part !== "string" || part.length === 0 || /[\0\r\n]/u.test(part))
  ) {
    throw new TypeError("measurement child command is invalid.");
  }
  return Object.freeze([...command]);
}

function environmentFor(identities: WorkIdentities): Readonly<Record<string, string>> {
  const environment: Record<string, string> = {
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
  };
  environment.XDG_CACHE_HOME = identities.xdgCache;
  environment.HF_HUB_OFFLINE = "1";
  environment.TRANSFORMERS_OFFLINE = "1";
  environment.GGML_METAL_NO_RESIDENCY = "1";
  environment.QMD_EMBED_PARALLELISM = "1";
  environment.QMD_LLAMA_GPU = "auto";
  environment.TMPDIR = identities.workRoot;
  environment.TMP = identities.workRoot;
  environment.TEMP = identities.workRoot;
  // A future accidental generate or rerank call must fail before it can produce work.
  environment.QMD_GENERATE_MODEL = identities.forbiddenGenerateModel;
  environment.QMD_RERANK_MODEL = identities.forbiddenRerankModel;
  return Object.freeze(environment);
}

/** Default bounded process transport. Each call creates exactly one fresh OS process. */
export const spawnEvaluationMeasurementChildV2: EvaluationMeasurementChildProcessFactoryV2 =
  async (request) => await new Promise((resolvePromise, rejectPromise) => {
    const [executable, ...arguments_] = request.command;
    if (executable === undefined) {
      rejectPromise(new TypeError("measurement child executable is missing."));
      return;
    }
    const child = spawn(executable, arguments_, {
      cwd: request.cwd,
      env: {
        ...request.environment,
        NODE_ENV: "production",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let termination: EvaluationMeasurementChildProcessResultV2["termination"] = "exit";
    let settled = false;
    let outputFailure: Error | undefined;
    const abort = () => {
      if (termination === "exit") termination = "aborted";
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      if (termination === "exit") termination = "timeout";
      child.kill("SIGKILL");
    }, request.timeoutMs);
    request.signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > request.maxStdoutBytes) {
        outputFailure = new RangeError("measurement child stdout exceeded its bound.");
        child.kill("SIGKILL");
        return;
      }
      stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > request.maxStderrBytes) {
        outputFailure = new RangeError("measurement child stderr exceeded its bound.");
        child.kill("SIGKILL");
        return;
      }
      stderr.push(Buffer.from(chunk));
    });
    const streamError = () => {
      outputFailure = new Error("measurement child process stream failed.");
      child.kill("SIGKILL");
    };
    child.stdin.once("error", streamError);
    child.stdout.once("error", streamError);
    child.stderr.once("error", streamError);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      rejectPromise(error);
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      if (outputFailure !== undefined) {
        rejectPromise(outputFailure);
        return;
      }
      resolvePromise(Object.freeze({
        termination,
        exitCode,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      }));
    });
    if (request.signal.aborted) abort();
    child.stdin.end(request.stdin);
  });

function traceFor(
  descriptor: EvaluationRetrieverDescriptorV2,
  measured: boolean,
): EvaluationRetrieverTraceV2 {
  return Object.freeze({
    laneOutcomes: Object.freeze(descriptor.lanes.map((laneId) => {
      const applicable = qmdLanes.has(laneId);
      return Object.freeze({
        laneId,
        applicability: measured && applicable ? "applied" as const : "skipped" as const,
        status: measured ? "ready" as const : "unavailable" as const,
        reasonCodes: Object.freeze(measured && applicable ? [] : ["operation-not-applicable"]),
        rawRanking: Object.freeze([]),
      });
    })),
    candidateDecisions: Object.freeze([]),
  });
}

function zeroResources(): EvaluationResourceAccountingV2 {
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({ calls: 0, inputTokens: 0, durationMs: 0 }),
    packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
    peakRssBytes: 0,
    cacheBytes: 0,
  });
}

function validateMeasurementInput(input: Readonly<{
  readonly operation: "cold-index" | "incremental-update";
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly profile: EvaluationMeasurementProfileV2;
  readonly repetition: number;
}>): void {
  if (
    input.profile.operation !== input.operation
    || input.profile.scope !== "retriever"
    || input.profile.concurrency !== 1
    || input.profile.cacheState !== (input.operation === "cold-index" ? "cold" : "changed-generation")
    || !Number.isSafeInteger(input.repetition)
    || input.repetition < 1
    || input.repetition > input.profile.repetitions
  ) {
    throw new TypeError("retriever measurement input does not match its locked profile.");
  }
  const localModel = input.corpus.experiment.environment.localModel;
  if (
    localModel.kind !== "model"
    || localModel.id !== recommendedEmbeddingModel
    || localModel.sha256 !== recommendedEmbeddingModelSha256
  ) {
    throw new TypeError("QMD measurement requires the pinned local embedding model identity.");
  }
  const lockedDescriptor = input.corpus.retrievers.find(({ id }) => id === input.descriptor.id);
  if (
    lockedDescriptor === undefined
    || evaluationRetrieverDescriptorDigestV2(lockedDescriptor)
      !== evaluationRetrieverDescriptorDigestV2(input.descriptor)
  ) {
    throw new TypeError("retriever measurement descriptor is absent from the sealed corpus.");
  }
  const lockedProfile = input.corpus.measurementProfiles.find(({ id }) => id === input.profile.id);
  if (
    lockedProfile === undefined
    || lockedProfile.operation !== input.profile.operation
    || lockedProfile.scope !== input.profile.scope
    || lockedProfile.cacheState !== input.profile.cacheState
    || lockedProfile.concurrency !== input.profile.concurrency
    || lockedProfile.repetitions !== input.profile.repetitions
  ) {
    throw new TypeError("retriever measurement profile is absent from the sealed corpus.");
  }
}

function assertMutationMatchesSealedExperiment(
  corpus: RetrievalEvaluationCorpusV2,
  mutation: EvaluationIncrementalMutationV2,
): void {
  const sealed = corpus.experiment.environment.incrementalMutation;
  const appendUtf8Sha256 = createHash("sha256")
    .update(mutation.appendText, "utf8")
    .digest("hex");
  if (
    mutation.sourcePath !== sealed.sourcePath
    || appendUtf8Sha256 !== sealed.appendUtf8Sha256
    || mutation.expectedPostMutationSha256 !== sealed.expectedPostMutationSha256
  ) {
    throw new TypeError("incremental measurement mutation does not match the sealed experiment identity.");
  }
}

async function runChildPhase(options: Readonly<{
  readonly phase: EvaluationMeasurementChildPhaseV2;
  readonly requestId: string;
  readonly workRoot: string;
  readonly repository: string;
  readonly root: string;
  readonly frozen: FrozenSnapshotRequest;
  readonly embeddingModelFile: string;
  readonly mutation: EvaluationIncrementalMutationV2;
  readonly command: readonly string[];
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly childProcessFactory: EvaluationMeasurementChildProcessFactoryV2;
}>): Promise<EvaluationMeasurementChildResponseV2> {
  if (options.signal.aborted) {
    throw options.signal.reason ?? new Error("measurement child request was aborted.");
  }
  const request: EvaluationMeasurementChildRequestV2 = Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "request",
    requestId: options.requestId,
    phase: options.phase,
    repository: options.repository,
    root: options.root,
    frozen: options.frozen,
    embeddingModelFile: options.embeddingModelFile,
    workRoot: options.workRoot,
    ...(options.phase === "cold-index" ? {} : { mutation: options.mutation }),
  });
  const serialized = Buffer.from(JSON.stringify(request), "utf8");
  if (serialized.byteLength > MAX_PROTOCOL_BYTES) throw new RangeError("measurement child request is too large.");
  const identities = workIdentities(options.workRoot);
  const result = await options.childProcessFactory({
    command: options.command,
    cwd: options.repository,
    environment: environmentFor(identities),
    stdin: serialized,
    timeoutMs: options.timeoutMs,
    maxStdoutBytes: MAX_PROTOCOL_BYTES,
    maxStderrBytes: MAX_STDERR_BYTES,
    signal: options.signal,
  });
  if (result.stdout.byteLength > MAX_PROTOCOL_BYTES || result.stderr.byteLength > MAX_STDERR_BYTES) {
    throw new RangeError("measurement child output exceeded its bound.");
  }
  if (result.termination !== "exit") {
    throw new Error(`measurement child ${result.termination}.`);
  }
  if (result.exitCode !== 0) throw new Error("measurement child exited unsuccessfully.");
  return parseChildResponse(result.stdout, request);
}

/** Create a runner-compatible cold-index and one-note-update measurement adapter. */
export function createKnowledgeBaseEvaluationRetrieverOperationMeasurerV2(
  options: CreateKnowledgeBaseEvaluationRetrieverOperationMeasurerV2Options,
): KnowledgeBaseEvaluationRunnerV2Dependencies["measureRetrieverOperation"] {
  const repository = resolve(options.repository);
  const root = resolve(options.root);
  const embeddingModelFile = resolve(options.embeddingModelFile);
  const mutation = parseMutation(options.mutation, "mutation");
  const timeout = timeoutMs(options.timeoutMs);
  const command = childCommand(options.childCommand);
  const temporaryDirectory = resolve(options.temporaryDirectory ?? tmpdir());
  const childProcessFactory = options.childProcessFactory ?? spawnEvaluationMeasurementChildV2;
  const sharedSubstrateMeasurements = new Map<
    string,
    Promise<EvaluationMeasurementChildResponseV2>
  >();

  const measureSharedSubstrate = async (
    input: Parameters<KnowledgeBaseEvaluationRunnerV2Dependencies["measureRetrieverOperation"]>[0],
  ): Promise<EvaluationMeasurementChildResponseV2> => {
    const canonicalTemporaryDirectory = await realpath(temporaryDirectory);
    const temporaryMetadata = await stat(canonicalTemporaryDirectory);
    if (!temporaryMetadata.isDirectory()) {
      throw new TypeError("measurement temporaryDirectory must be a directory.");
    }
    const workRoot = await mkdtemp(join(canonicalTemporaryDirectory, WORK_DIRECTORY_PREFIX));
    const requestId = randomUUID();
    try {
      const common = {
        requestId,
        workRoot,
        repository,
        root,
        frozen: input.corpus.frozen,
        embeddingModelFile,
        mutation,
        command,
        timeoutMs: timeout,
        signal: input.signal,
        childProcessFactory,
      } as const;
      if (input.operation === "cold-index") {
        return await runChildPhase({ ...common, phase: "cold-index" });
      }
      await runChildPhase({ ...common, phase: "incremental-prepare" });
      return await runChildPhase({ ...common, phase: "incremental-update" });
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  };

  return async (input): Promise<EvaluationRetrieverOperationMeasurementV2> => {
    validateMeasurementInput(input);
    assertMutationMatchesSealedExperiment(input.corpus, mutation);
    if (!input.descriptor.lanes.some((lane) => qmdLanes.has(lane))) {
      return Object.freeze({
        status: "unavailable",
        timings: Object.freeze({ elapsedMs: 0, indexMs: 0, updateMs: 0, queryMs: 0, packingMs: 0 }),
        resources: zeroResources(),
        trace: traceFor(input.descriptor, false),
      });
    }
    if (input.signal.aborted) throw input.signal.reason ?? new Error("retriever measurement was aborted.");
    const measurementIdentity = JSON.stringify([
      input.corpus.frozen.repositoryCommit,
      input.corpus.frozen.vaultTree,
      input.corpus.experiment.environment.localModel,
      input.operation,
      input.profile,
      input.repetition,
      mutation.sha256,
    ]);
    let pending = sharedSubstrateMeasurements.get(measurementIdentity);
    if (pending === undefined) {
      pending = measureSharedSubstrate(input);
      sharedSubstrateMeasurements.set(measurementIdentity, pending);
      void pending.catch(() => {
        if (sharedSubstrateMeasurements.get(measurementIdentity) === pending) {
          sharedSubstrateMeasurements.delete(measurementIdentity);
        }
      });
    }
    const measured = await pending;
    if (input.signal.aborted) throw input.signal.reason ?? new Error("retriever measurement was aborted.");
    return Object.freeze({
      status: "ready",
      timings: Object.freeze({
        elapsedMs: measured.elapsedMs,
        indexMs: input.operation === "cold-index" ? measured.elapsedMs : 0,
        updateMs: input.operation === "incremental-update" ? measured.elapsedMs : 0,
        queryMs: 0,
        packingMs: 0,
      }),
      resources: measured.resources,
      trace: traceFor(input.descriptor, true),
    });
  };
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > MAX_PROTOCOL_BYTES) throw new RangeError("measurement child stdin exceeded its bound.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function childMain(): Promise<void> {
  try {
    const bytes = await readStdin();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.trim() !== text) throw new TypeError("measurement child request framing is invalid.");
    const response = await executeKnowledgeBaseEvaluationMeasurementChildV2(JSON.parse(text) as unknown);
    process.stdout.write(JSON.stringify(response));
  } catch {
    process.stderr.write("Knowledge-base evaluation measurement child failed.\n");
    process.exitCode = 1;
  }
}

if (import.meta.main && process.argv.at(-1) === CHILD_ARGUMENT) await childMain();
