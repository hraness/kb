import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Backlink, MetadataObject, Note, NoteConnections } from "./graph.js";
import {
  describeSemanticProjection,
  prepareSemanticProjection,
  resolveSemanticDatabase,
  withSemanticGenerationWriterLease,
  type SemanticIndexIdentity,
  type SemanticProjection,
  type SemanticProjectionDescription,
  type SemanticWriterLeaseOptions,
} from "./semantic-runtime.js";
import { fuseRankedCandidates, validateSearchQuery } from "./search.js";
import { scanVault, type VaultSnapshot } from "./vault.js";

/** QMD's small local default at an immutable Hugging Face repository revision. */
export const recommendedEmbeddingModel =
  "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf#0f741b5a6585bd53aeb15cd1372c56f2a0f65e12";
/** SHA-256 of the immutable recommended EmbeddingGemma GGUF artifact. */
export const recommendedEmbeddingModelSha256 =
  "b5ce9d77a3fc4b3b39ccb5643c36777911cc4eb46a66962eadfa3f5f60490d63";
export const MAX_EMBEDDING_MODEL_BYTES = 2 * 1_024 * 1_024 * 1_024;
export const MAX_SEMANTIC_DATABASE_IDENTITY_BYTES = 16 * 1_024;
const MAX_SEMANTIC_READ_SNAPSHOT_BYTES = 16 * 1_024 * 1_024 * 1_024;
const SHA256 = /^[0-9a-f]{64}$/u;

const semanticIndexSchema = 1;
export const qmdIndexerVersion =
  "2.5.3+hraness.aa993dceb3ef8cfb71d470554ca437570f5a2b3c";
const collectionName = "kb";
const markdownPattern = "**/*.md";
const ignoredPatterns = ["index.md", "**/AGENTS.md"] as const;
const embeddingChunkStrategy = "regex";
const globalContext =
  "A Markdown knowledge base. Source records preserve evidence; maintained notes contain current synthesis; explicit wikilinks define structural relationships.";
const collectionContext = {
  "/": "Knowledge-base notes, clipped sources, plans, reports, and explicit contextual links.",
  "/articles": "Captured source records and their acquisition provenance.",
  "/notes": "Maintained concepts, comparisons, and current synthesis.",
  "/plans": "Decisions, constraints, execution state, and verification evidence.",
  "/riffs": "Voice-preserving first-person source thought.",
} as const;
const recommendedEmbeddingModelIdentity =
  `${recommendedEmbeddingModel}@sha256:${recommendedEmbeddingModelSha256}`;
const semanticIndexIdentity: SemanticIndexIdentity = {
  producer: { package: "@hraness/kb", schema: semanticIndexSchema },
  indexer: { package: "@tobilu/qmd", version: qmdIndexerVersion },
  collection: {
    name: collectionName,
    pattern: markdownPattern,
    ignore: ignoredPatterns,
    globalContext,
    pathContexts: Object.entries(collectionContext).map(([path, context]) => ({ path, context })),
  },
  embedding: {
    model: recommendedEmbeddingModelIdentity,
    chunkStrategy: embeddingChunkStrategy,
  },
};
// Keep this widened: a literal dynamic import makes TypeScript load QMD's public declarations.
const qmdModuleSpecifier: string = "@tobilu/qmd";

export type SemanticSearchMode = "hybrid" | "keyword" | "semantic";

export type SemanticIndexOptions = {
  readonly root: string;
  readonly database?: string;
  /** Verified local bytes for the pinned model. Public results retain the stable model URI. */
  readonly embeddingModelFile?: string;
  readonly force?: boolean;
};

/**
 * Opaque ownership handle for one privately copied, verified local embedding
 * model. The machine-local source path is deliberately not part of this API.
 */
export type VerifiedEmbeddingModelLease = {
  readonly model: typeof recommendedEmbeddingModel;
  /** Stop accepting new readers; the final retained reader removes the private copy. */
  readonly close: () => Promise<void>;
};

export type SemanticSearchOptions = {
  readonly root: string;
  readonly query: string;
  readonly database?: string;
  readonly mode?: SemanticSearchMode;
  readonly limit?: number;
  readonly candidateLimit?: number;
  readonly minScore?: number;
};

export type SemanticCollectionConfig = {
  readonly global_context?: string;
  readonly collections: Readonly<Record<string, {
    readonly path: string;
    readonly pattern: string;
    readonly ignore?: readonly string[];
    readonly context?: Readonly<Record<string, string>>;
  }>>;
  readonly models?: {
    readonly embed?: string;
  };
};

export type SemanticStoreOptions = {
  readonly dbPath: string;
  readonly config: SemanticCollectionConfig;
};

export type SemanticUpdateResult = {
  readonly collections: number;
  readonly indexed: number;
  readonly updated: number;
  readonly unchanged: number;
  readonly removed: number;
  readonly needsEmbedding: number;
};

export type SemanticEmbeddingFailure = {
  readonly path: string;
  readonly hash: string;
  readonly seq: number;
  readonly attempts: number;
  readonly reason: string;
};

export type SemanticEmbeddingResult = {
  readonly docsProcessed: number;
  readonly chunksEmbedded: number;
  readonly errors: number;
  readonly failures?: readonly SemanticEmbeddingFailure[];
  readonly durationMs: number;
};

export type SemanticIndexResult = {
  readonly root: string;
  readonly database: string;
  readonly model: string;
  readonly update: SemanticUpdateResult;
  readonly embedding: SemanticEmbeddingResult | null;
};

export type SemanticSearchHit = {
  readonly path: string;
  readonly title: string;
  readonly score: number;
  readonly source: "fts" | "hybrid" | "vec";
  readonly docid: string;
  readonly modifiedAt?: string;
  readonly line?: number;
  readonly snippet: string;
  readonly signals?: {
    readonly keyword: boolean;
    readonly semantic: boolean;
  };
  readonly tags: readonly string[];
  readonly metadata: MetadataObject;
  readonly inboundContextualCount: number;
  readonly outboundContextualCount: number;
  readonly backlinks: readonly Backlink[];
};

export type SemanticSearchResult = {
  readonly root: string;
  readonly database: string;
  readonly model: string;
  readonly mode: SemanticSearchMode;
  readonly query: string;
  readonly update: SemanticUpdateResult;
  readonly embedding: SemanticEmbeddingResult | null;
  /** Exact query-vector work, or null when the optional public QMD fallback hid it. */
  readonly queryEmbedding?: SemanticQueryEmbeddingAccounting | null;
  /** Raw backend-window evidence for post-filter completeness diagnostics. */
  readonly rawWindow?: {
    readonly requested: number;
    readonly returned: number;
    /** Rows rejected because they could not reconcile to this live snapshot. */
    readonly discarded: number;
    /** Rows intentionally excluded by the caller's minimum score. */
    readonly thresholdRejected: number;
    /** True when QMD returned fewer raw rows than the requested backend window. */
    readonly exhausted: boolean;
  };
  readonly results: readonly SemanticSearchHit[];
};

export type SemanticSessionOptions = {
  readonly root: string;
  readonly database?: string;
  /** Verified local bytes for the pinned model. Public results retain the stable model URI. */
  readonly embeddingModelFile?: string;
  /** Shared opaque lease for verified local bytes. Mutually exclusive with embeddingModelFile. */
  readonly embeddingModelLease?: VerifiedEmbeddingModelLease;
  /** Reject QMD versions that cannot expose store-local query-vector inference. */
  readonly requireStoreLocalVectorBoundary?: boolean;
};

export type SemanticWarmCacheAttestationOptions = {
  readonly root: string;
  readonly database?: string;
  /** A branded lease proves the pinned local model bytes remain available. */
  readonly embeddingModelLease: VerifiedEmbeddingModelLease;
  /** Exact SQLite main-file bytes and checkpointed sidecar absence sealed before readers open. */
  readonly databaseSnapshotSeal: SemanticDatabaseSnapshotSeal;
};

export type SemanticDatabaseFileSeal = Readonly<{
  readonly bytes: number;
  readonly sha256: string;
}>;

/**
 * The complete SQLite state a strict warm reader may consume. The canonical
 * database is sealed by bytes while WAL/SHM/rollback-journal sidecars are
 * sealed as absent, so SQLite can create any runtime sidecars only beside the
 * disposable private copy.
 */
export type SemanticDatabaseSnapshotSeal = Readonly<{
  readonly database: SemanticDatabaseFileSeal;
  /** A strict warm snapshot is checkpointed; canonical sidecars are forbidden. */
  readonly wal: null;
  readonly shm: null;
  readonly journal: null;
}>;

/**
 * The already-indexed, immutable projection required by a measured warm
 * reader. Unlike a normal semantic session, opening this session cannot
 * prepare, repair, update, or embed the document corpus.
 */
export type SemanticWarmSearchSessionOptions = SemanticWarmCacheAttestationOptions;

export type SemanticWarmCacheReadiness = {
  readonly model: typeof recommendedEmbeddingModel;
  /** Canonical database path identity. No model or projection path is exposed. */
  readonly database: string;
  readonly pendingEmbeddings: 0;
};

export type SemanticWarmCacheCheckpointResult = Readonly<{
  readonly database: string;
  readonly wal: null;
  readonly shm: null;
  readonly journal: null;
}>;

export type SemanticAttestationStoreOptions = {
  readonly dbPath: string;
};

export type SemanticWarmStoreOptions = SemanticAttestationStoreOptions & Readonly<{
  /** Private verified bytes used only to construct this store's local LLM session. */
  readonly embeddingModelSource: string;
}>;

export type SemanticQueryEmbeddingAccounting = {
  readonly calls: number;
  readonly inputTokens: number;
  /** Wall duration of the actual embed call only; token counting is excluded. */
  readonly durationMs: number;
};

export type SemanticSessionSearchOptions = Omit<
  SemanticSearchOptions,
  "root" | "database"
>;

export type SemanticSearchSession = {
  readonly root: string;
  readonly database: string;
  readonly model: string;
  readonly update: SemanticUpdateResult;
  /** Searches share one live vault snapshot and one serialized QMD store. */
  readonly search: (
    options: SemanticSessionSearchOptions,
  ) => Promise<SemanticSearchResult>;
  /** Idempotently close the owned QMD store after queued searches settle. */
  readonly close: () => Promise<void>;
};

type SemanticSearchDocument = {
  readonly filepath: string;
  readonly title: string;
  readonly hash: string;
  readonly docid: string;
  readonly modifiedAt: string;
  readonly score: number;
  readonly source: "fts" | "vec";
  readonly chunkPos?: number;
};

type SearchStore = {
  readonly close: () => Promise<void>;
  readonly update: (options: { readonly collections: readonly string[] }) => Promise<SemanticUpdateResult>;
  readonly embed: (options: {
    readonly collection: string;
    readonly force: boolean;
    readonly model: string;
    readonly chunkStrategy: "regex";
  }) => Promise<SemanticEmbeddingResult>;
  readonly searchLex: (
    query: string,
    options: { readonly collection: string; readonly limit: number },
  ) => Promise<readonly SemanticSearchDocument[]>;
  readonly searchVector: (
    query: string,
    options: { readonly collection: string; readonly limit: number },
  ) => Promise<{
    readonly results: readonly SemanticSearchDocument[];
    readonly accounting: SemanticQueryEmbeddingAccounting | null;
  }>;
};

type SemanticQueryStore = Pick<SearchStore, "close" | "searchLex" | "searchVector">;

type WarmSearchStore = SemanticQueryStore & Readonly<{
  readonly pendingEmbeddingCount: () => Promise<number>;
}>;

export type SemanticDependencies = {
  readonly createStore?: (options: SemanticStoreOptions) => Promise<unknown>;
  /** QMD opener over a disposable stable snapshot used only by strict warm readers. */
  readonly createWarmSearchStore?: (options: SemanticWarmStoreOptions) => Promise<unknown>;
  /** Config-free QMD opener over a disposable stable snapshot used only by attestation. */
  readonly createAttestationStore?: (
    options: SemanticAttestationStoreOptions,
  ) => Promise<unknown>;
  /** SQLite writer used only to checkpoint a finished private index before sealing. */
  readonly openCheckpointDatabase?: (database: string) => Promise<unknown>;
  readonly digestEmbeddingModelFile?: (path: string) => Promise<string>;
  readonly cacheHome?: string;
  readonly scanVault?: (root: string) => Promise<VaultSnapshot>;
  readonly writerLease?: SemanticWriterLeaseOptions;
  /** Monotonic clock injection used only to measure the actual query embed call. */
  readonly now?: () => number;
};

/** Hash one bounded, regular, non-symlink model file through a stable descriptor. */
export async function sha256EmbeddingModelFile(path: string): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new TypeError("The embedding model must be a regular file.");
    if (metadata.size > MAX_EMBEDDING_MODEL_BYTES) {
      throw new RangeError(
        `The embedding model exceeds ${MAX_EMBEDDING_MODEL_BYTES.toLocaleString("en-US")} bytes.`,
      );
    }
    const hash = createHash("sha256");
    const buffer = new Uint8Array(1_024 * 1_024);
    let observed = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      observed += bytesRead;
      if (observed > MAX_EMBEDDING_MODEL_BYTES) {
        throw new RangeError(
          `The embedding model exceeds ${MAX_EMBEDDING_MODEL_BYTES.toLocaleString("en-US")} bytes.`,
        );
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

type EmbeddingModelSourceLease = Readonly<{
  readonly source: string;
  readonly release: () => Promise<void>;
}>;

type VerifiedEmbeddingModelLeaseState = {
  readonly source: string;
  readonly cleanup: () => Promise<void>;
  references: number;
  acceptingReaders: boolean;
  cleanupPromise?: Promise<void>;
};

const verifiedEmbeddingModelLeaseStates = new WeakMap<
  VerifiedEmbeddingModelLease,
  VerifiedEmbeddingModelLeaseState
>();

async function writeEmbeddingModelBytes(
  destination: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await destination.write(bytes, offset, bytes.byteLength - offset, null);
    if (written.bytesWritten < 1) throw new Error("The embedding model snapshot write stalled.");
    offset += written.bytesWritten;
  }
}

/** Copy verified bytes behind an unguessable private path before QMD can open them. */
async function verifiedIndexEmbeddingModelSource(
  path: string | undefined,
  dependencies: SemanticDependencies,
): Promise<EmbeddingModelSourceLease> {
  if (path === undefined) {
    return Object.freeze({ source: recommendedEmbeddingModel, release: () => Promise.resolve() });
  }
  const sourcePath = resolve(path);
  const directory = await mkdtemp(join(tmpdir(), "hraness-kb-embedding-model-"));
  const destinationPath = join(directory, "pinned-model.gguf");
  let source: Awaited<ReturnType<typeof open>> | undefined;
  let destination: Awaited<ReturnType<typeof open>> | undefined;
  try {
    source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    destination = await open(
      destinationPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o400,
    );
    const before = await source.stat();
    if (!before.isFile()) throw new TypeError("The embedding model must be a regular file.");
    if (before.size > MAX_EMBEDDING_MODEL_BYTES) {
      throw new RangeError(
        `The embedding model exceeds ${MAX_EMBEDDING_MODEL_BYTES.toLocaleString("en-US")} bytes.`,
      );
    }
    const hash = createHash("sha256");
    const buffer = new Uint8Array(1_024 * 1_024);
    let observed = 0;
    for (;;) {
      const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      observed += bytesRead;
      if (observed > MAX_EMBEDDING_MODEL_BYTES) {
        throw new RangeError(
          `The embedding model exceeds ${MAX_EMBEDDING_MODEL_BYTES.toLocaleString("en-US")} bytes.`,
        );
      }
      const bytes = buffer.subarray(0, bytesRead);
      hash.update(bytes);
      await writeEmbeddingModelBytes(destination, bytes);
    }
    const after = await source.stat();
    const copied = await destination.stat();
    if (
      after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || observed !== before.size
      || copied.size !== observed
    ) {
      throw new Error("The embedding model changed while its private snapshot was created; retry.");
    }
    await destination.sync();
    await destination.close();
    destination = undefined;
    await source.close();
    source = undefined;
    const digest = dependencies.digestEmbeddingModelFile === undefined
      ? hash.digest("hex")
      : await dependencies.digestEmbeddingModelFile(destinationPath);
    if (digest !== recommendedEmbeddingModelSha256) {
      throw new Error(
        "The local embedding model does not match the pinned recommended model SHA-256.",
      );
    }
    await chmod(destinationPath, 0o400);
    let released = false;
    return Object.freeze({
      source: destinationPath,
      release: async () => {
        if (released) return;
        released = true;
        await rm(directory, { recursive: true, force: true });
      },
    });
  } catch (error: unknown) {
    await destination?.close().catch(() => undefined);
    await source?.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function releaseEmbeddingModelReference(
  state: VerifiedEmbeddingModelLeaseState,
): Promise<void> {
  if (state.references < 1) {
    throw new Error("Verified embedding-model lease reference accounting underflowed.");
  }
  state.references -= 1;
  if (state.references !== 0) return Promise.resolve();
  state.cleanupPromise ??= state.cleanup();
  return state.cleanupPromise;
}

function retainVerifiedEmbeddingModelLease(
  lease: VerifiedEmbeddingModelLease,
): EmbeddingModelSourceLease {
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
      if (released) return Promise.resolve();
      released = true;
      return releaseEmbeddingModelReference(state);
    },
  });
}

/**
 * Copy and verify one local model exactly once. Sessions retain the private
 * copy without learning its path; closing the owner stops new retention while
 * the last retained session removes the copy through reference counting.
 */
export async function createVerifiedEmbeddingModelLease(
  embeddingModelFile: string,
  dependencies: SemanticDependencies = {},
): Promise<VerifiedEmbeddingModelLease> {
  if (typeof embeddingModelFile !== "string" || embeddingModelFile.trim() === "") {
    throw new TypeError("embeddingModelFile must be a non-empty path string.");
  }
  const copied = await verifiedIndexEmbeddingModelSource(embeddingModelFile, dependencies);
  const state: VerifiedEmbeddingModelLeaseState = {
    source: copied.source,
    cleanup: copied.release,
    references: 1,
    acceptingReaders: true,
  };
  let ownerClosePromise: Promise<void> | undefined;
  const lease: VerifiedEmbeddingModelLease = Object.freeze({
    model: recommendedEmbeddingModel,
    close: () => {
      if (ownerClosePromise !== undefined) return ownerClosePromise;
      state.acceptingReaders = false;
      ownerClosePromise = releaseEmbeddingModelReference(state);
      return ownerClosePromise;
    },
  });
  verifiedEmbeddingModelLeaseStates.set(lease, state);
  return lease;
}

function requiredStoreLocalVectorBoundary(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new TypeError("requireStoreLocalVectorBoundary must be a boolean.");
  }
  return value;
}

async function sessionEmbeddingModelSource(
  options: Pick<SemanticSessionOptions, "embeddingModelFile" | "embeddingModelLease">,
  dependencies: SemanticDependencies,
): Promise<EmbeddingModelSourceLease> {
  if (options.embeddingModelFile !== undefined && options.embeddingModelLease !== undefined) {
    throw new TypeError(
      "embeddingModelFile and embeddingModelLease are mutually exclusive.",
    );
  }
  if (options.embeddingModelLease !== undefined) {
    return retainVerifiedEmbeddingModelLease(options.embeddingModelLease);
  }
  if (options.embeddingModelFile === undefined) {
    return Object.freeze({
      source: recommendedEmbeddingModel,
      release: () => Promise.resolve(),
    });
  }
  const owner = await createVerifiedEmbeddingModelLease(
    options.embeddingModelFile,
    dependencies,
  );
  try {
    const retained = retainVerifiedEmbeddingModelLease(owner);
    await owner.close();
    return retained;
  } catch (error: unknown) {
    await owner.close().catch(() => undefined);
    throw error;
  }
}

function cacheHome(dependencies: SemanticDependencies): string {
  const configured = dependencies.cacheHome ?? process.env.XDG_CACHE_HOME;
  if (configured !== undefined && configured.trim() !== "") {
    return isAbsolute(configured) ? configured : resolve(configured);
  }
  return join(homedir(), ".cache");
}

export function semanticDatabasePath(root: string, dependencies: SemanticDependencies = {}): string {
  const identity = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 20);
  return join(cacheHome(dependencies), "hraness-kb", "indexes", `${identity}.sqlite`);
}

async function resolvedDirectory(path: string): Promise<string> {
  const root = await realpath(resolve(path));
  if (!(await stat(root)).isDirectory()) throw new Error("Knowledge-base root must be a directory.");
  return root;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundaryRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function boundaryString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function boundaryNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function boundaryCount(value: unknown, label: string): number {
  const number = boundaryNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return number;
}

function boundaryArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function parseUpdateResult(value: unknown): SemanticUpdateResult {
  const result = boundaryRecord(value, "QMD update result");
  return {
    collections: boundaryCount(result.collections, "QMD update result.collections"),
    indexed: boundaryCount(result.indexed, "QMD update result.indexed"),
    updated: boundaryCount(result.updated, "QMD update result.updated"),
    unchanged: boundaryCount(result.unchanged, "QMD update result.unchanged"),
    removed: boundaryCount(result.removed, "QMD update result.removed"),
    needsEmbedding: boundaryCount(
      result.needsEmbedding,
      "QMD update result.needsEmbedding",
    ),
  };
}

function parseEmbeddingFailure(value: unknown, index: number): SemanticEmbeddingFailure {
  const label = `QMD embedding result.failures[${index}]`;
  const failure = boundaryRecord(value, label);
  return {
    path: boundaryString(failure.path, `${label}.path`),
    hash: boundaryString(failure.hash, `${label}.hash`),
    seq: boundaryCount(failure.seq, `${label}.seq`),
    attempts: boundaryCount(failure.attempts, `${label}.attempts`),
    reason: boundaryString(failure.reason, `${label}.reason`),
  };
}

function parseEmbeddingResult(value: unknown): SemanticEmbeddingResult {
  const result = boundaryRecord(value, "QMD embedding result");
  const failures = result.failures === undefined
    ? undefined
    : boundaryArray(result.failures, "QMD embedding result.failures")
        .map((failure, index) => parseEmbeddingFailure(failure, index));
  return {
    docsProcessed: boundaryCount(result.docsProcessed, "QMD embedding result.docsProcessed"),
    chunksEmbedded: boundaryCount(result.chunksEmbedded, "QMD embedding result.chunksEmbedded"),
    errors: boundaryCount(result.errors, "QMD embedding result.errors"),
    ...(failures === undefined ? {} : { failures }),
    durationMs: boundaryNumber(result.durationMs, "QMD embedding result.durationMs"),
  };
}

function parseSearchDocument(value: unknown, index: number): SemanticSearchDocument {
  const label = `QMD search result[${index}]`;
  const result = boundaryRecord(value, label);
  const source = result.source;
  if (source !== "fts" && source !== "vec") {
    throw new Error(`${label}.source must be "fts" or "vec".`);
  }
  const chunkPos = result.chunkPos === undefined
    ? undefined
    : boundaryCount(result.chunkPos, `${label}.chunkPos`);
  return {
    filepath: boundaryString(result.filepath, `${label}.filepath`),
    title: boundaryString(result.title, `${label}.title`),
    hash: boundaryString(result.hash, `${label}.hash`),
    docid: boundaryString(result.docid, `${label}.docid`),
    modifiedAt: boundaryString(result.modifiedAt, `${label}.modifiedAt`),
    score: boundaryNumber(result.score, `${label}.score`),
    source,
    ...(chunkPos === undefined ? {} : { chunkPos }),
  };
}

function boundedResultArray(
  value: unknown,
  label: string,
  maximum: number,
): readonly unknown[] {
  const results = boundaryArray(value, label);
  if (results.length > maximum) {
    throw new Error(`${label} returned more than the requested ${maximum} results.`);
  }
  return results;
}

function parseSearchResults(
  value: unknown,
  maximum: number,
): readonly SemanticSearchDocument[] {
  return boundedResultArray(value, "QMD search results", maximum)
    .map((result, index) => parseSearchDocument(result, index));
}

type UnknownMethod = (...arguments_: unknown[]) => Promise<unknown>;

function boundUnknownMethod(
  owner: Readonly<Record<string, unknown>>,
  name: string,
  label: string,
): UnknownMethod {
  const method = owner[name];
  if (typeof method !== "function") throw new Error(`${label}.${name} must be a function.`);
  return async (...arguments_) => {
    const returned: unknown = Reflect.apply(method, owner, arguments_);
    return await returned;
  };
}

type QmdInternalVectorBoundary = {
  readonly pendingEmbeddingCount: () => Promise<number>;
  readonly searchVector: (
    query: string,
    options: { readonly collection: string; readonly limit: number },
  ) => Promise<{
    readonly results: readonly SemanticSearchDocument[];
    readonly accounting: SemanticQueryEmbeddingAccounting;
  }>;
};

function measuredDuration(startedAt: number, finishedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
    throw new Error("The query-embedding monotonic clock returned an invalid interval.");
  }
  const duration = finishedAt - startedAt;
  return duration;
}

function internalVectorBoundary(
  store: Readonly<Record<string, unknown>>,
  modelIdentity: string,
  now: () => number,
): QmdInternalVectorBoundary | null {
  // QMD 2.5.3's public searchVector omits its per-store LLM session and falls
  // back to a process-global model. Its documented advanced internal boundary
  // lets KB keep query inference on the same store-local, verified bytes while
  // retaining a path-independent identity for derived vector rows.
  if (store.internal === undefined) return null;
  const internal = boundaryRecord(store.internal, "QMD store.internal");
  const llm = boundaryRecord(internal.llm, "QMD store.internal.llm");
  const getHashesNeedingEmbedding = boundUnknownMethod(
    internal,
    "getHashesNeedingEmbedding",
    "QMD store.internal",
  );
  const searchVec = boundUnknownMethod(internal, "searchVec", "QMD store.internal");
  const embed = boundUnknownMethod(llm, "embed", "QMD store.internal.llm");
  const countTokens = boundUnknownMethod(
    llm,
    "countTokens",
    "QMD store.internal.llm",
  );
  return {
    pendingEmbeddingCount: async () => boundaryCount(
      await getHashesNeedingEmbedding(modelIdentity),
      "QMD store.internal.getHashesNeedingEmbedding result",
    ),
    searchVector: async (query, options) => {
      let calls = 0;
      let inputTokens = 0;
      let durationMs = 0;
      const session = Object.freeze({
        countTokens: async (text: unknown) => boundaryCount(
          await countTokens(
            boundaryString(text, "QMD query embedding text"),
          ),
          "QMD store.internal.llm.countTokens result",
        ),
        embed: async (text: unknown, embedOptions?: unknown) => {
          const exactText = boundaryString(text, "QMD query embedding text");
          if (calls !== 0) {
            throw new Error("QMD query-vector search must perform exactly one query embedding.");
          }
          inputTokens = boundaryCount(
            await countTokens(exactText),
            "QMD store.internal.llm.countTokens result",
          );
          calls = 1;
          const startedAt = now();
          try {
            return await embed(exactText, embedOptions);
          } finally {
            durationMs = measuredDuration(startedAt, now());
          }
        },
      });
      const results = parseSearchResults(await searchVec(
        query,
        modelIdentity,
        options.limit,
        options.collection,
        session,
      ), options.limit);
      if (calls !== 1) {
        throw new Error(
          `QMD query-vector search must perform exactly one query embedding; observed ${calls}.`,
        );
      }
      return {
        results,
        accounting: Object.freeze({ calls, inputTokens, durationMs }),
      };
    },
  };
}

function parseSearchStore(
  value: unknown,
  modelIdentity: string,
  options: {
    readonly requireStoreLocalVectorBoundary: boolean;
    readonly now: () => number;
  },
): SearchStore {
  const store = boundaryRecord(value, "QMD store");
  const close = boundUnknownMethod(store, "close", "QMD store");
  const embed = boundUnknownMethod(store, "embed", "QMD store");
  const searchLex = boundUnknownMethod(store, "searchLex", "QMD store");
  const searchVector = boundUnknownMethod(store, "searchVector", "QMD store");
  const update = boundUnknownMethod(store, "update", "QMD store");
  let internalVector: QmdInternalVectorBoundary | null = null;
  try {
    internalVector = internalVectorBoundary(store, modelIdentity, options.now);
  } catch (error: unknown) {
    if (options.requireStoreLocalVectorBoundary) throw error;
  }
  if (options.requireStoreLocalVectorBoundary && internalVector === null) {
    throw new Error(
      "QMD store-local vector search is required, but store.internal.searchVec with its LLM boundary is unavailable.",
    );
  }
  return {
    close: async () => {
      await close();
    },
    embed: async (options) => parseEmbeddingResult(await embed(options)),
    searchLex: async (query, options) =>
      parseSearchResults(await searchLex(query, options), options.limit),
    searchVector: internalVector?.searchVector
      ?? (async (query, vectorOptions) => ({
        results: parseSearchResults(
          await searchVector(query, vectorOptions),
          vectorOptions.limit,
        ),
        accounting: null,
      })),
    update: async (options) => {
      const result = parseUpdateResult(await update(options));
      if (internalVector === null) return result;
      return {
        ...result,
        needsEmbedding: await internalVector.pendingEmbeddingCount(),
      };
    },
  };
}

function parseWarmSearchStore(
  value: unknown,
  now: () => number,
): WarmSearchStore {
  const store = boundaryRecord(value, "QMD warm search store");
  const close = boundUnknownMethod(store, "close", "QMD warm search store");
  const searchLex = boundUnknownMethod(store, "searchLex", "QMD warm search store");
  const internalVector = internalVectorBoundary(store, recommendedEmbeddingModel, now);
  if (internalVector === null) {
    throw new Error(
      "QMD warm search requires store.internal.searchVec with its store-local LLM boundary.",
    );
  }
  return Object.freeze({
    close: async () => {
      await close();
    },
    pendingEmbeddingCount: internalVector.pendingEmbeddingCount,
    searchLex: async (query, options) =>
      parseSearchResults(await searchLex(query, options), options.limit),
    searchVector: internalVector.searchVector,
  });
}

async function closeMalformedStore(value: unknown): Promise<void> {
  if (!isRecord(value)) return;
  const close = value.close;
  if (typeof close !== "function") return;
  try {
    const returned: unknown = Reflect.apply(close, value, []);
    await returned;
  } catch {
    // Preserve the boundary error that explains why the store was rejected.
  }
}

async function openedSearchStore(
  value: unknown,
  modelIdentity: string,
  options: {
    readonly requireStoreLocalVectorBoundary: boolean;
    readonly now: () => number;
  },
): Promise<SearchStore> {
  try {
    return parseSearchStore(value, modelIdentity, options);
  } catch (error: unknown) {
    await closeMalformedStore(value);
    throw error;
  }
}

async function openedWarmSearchStore(
  value: unknown,
  now: () => number,
): Promise<WarmSearchStore> {
  try {
    return parseWarmSearchStore(value, now);
  } catch (error: unknown) {
    await closeMalformedStore(value);
    throw error;
  }
}

type IsolatedQmdDatabaseSnapshot = Readonly<{
  readonly database: string;
  readonly cleanup: () => Promise<void>;
}>;

function sameStableFileMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function missingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
  length: number,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < length) {
    const result = await handle.write(
      bytes,
      written,
      length - written,
      position + written,
    );
    if (result.bytesWritten === 0) {
      throw new Error("The isolated QMD snapshot stopped accepting bytes.");
    }
    written += result.bytesWritten;
  }
}

async function copyStableSnapshotFile(
  source: string,
  destination: string,
  label: string,
  maximumBytes: number,
  expected: SemanticDatabaseFileSeal,
): Promise<SemanticDatabaseFileSeal> {
  if (
    !Number.isSafeInteger(expected.bytes)
    || expected.bytes < 0
    || expected.bytes > maximumBytes
    || !SHA256.test(expected.sha256)
  ) throw new TypeError(`${label} seal is invalid.`);
  const pathBefore = await lstat(source, { bigint: true });
  if (
    pathBefore.isSymbolicLink()
    || !pathBefore.isFile()
    || pathBefore.nlink !== 1n
    || pathBefore.size > BigInt(maximumBytes)
    || pathBefore.size !== BigInt(expected.bytes)
  ) {
    throw new Error(`${label} must be one bounded, singly linked regular file.`);
  }
  const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await sourceHandle.stat({ bigint: true });
    if (!sameStableFileMetadata(pathBefore, before)) {
      throw new Error(`${label} changed before its isolated read snapshot was opened.`);
    }
    destinationHandle = await open(
      destination,
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | constants.O_NOFOLLOW,
      0o600,
    );
    const buffer = new Uint8Array(1_024 * 1_024);
    const hash = createHash("sha256");
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
      lstat(source, { bigint: true }),
    ]);
    if (
      copied !== Number(before.size)
      || !sameStableFileMetadata(before, after)
      || !sameStableFileMetadata(after, pathAfter)
    ) {
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
      destinationHandle?.close() ?? Promise.resolve(),
    ]);
  }
}

async function assertAbsentSnapshotSidecar(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error: unknown) {
    if (missingFile(error)) return;
    throw error;
  }
  throw new Error(`${label} appeared while the isolated read snapshot was copied.`);
}

async function createIsolatedQmdDatabaseSnapshot(
  database: string,
  seal: SemanticDatabaseSnapshotSeal,
): Promise<IsolatedQmdDatabaseSnapshot> {
  const directory = await mkdtemp(join(tmpdir(), "hraness-kb-qmd-reader."));
  await chmod(directory, 0o700);
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const isolatedDatabase = join(directory, "snapshot.sqlite");
    if (seal.wal !== null || seal.shm !== null || seal.journal !== null) {
      throw new TypeError("Strict warm semantic snapshots require checkpointed SQLite state.");
    }
    const sourceWal = `${database}-wal`;
    const sourceShm = `${database}-shm`;
    const sourceJournal = `${database}-journal`;
    await Promise.all([
      assertAbsentSnapshotSidecar(sourceWal, "Semantic database WAL"),
      assertAbsentSnapshotSidecar(sourceShm, "Semantic database SHM"),
      assertAbsentSnapshotSidecar(sourceJournal, "Semantic database rollback journal"),
    ]);
    const databaseSeal = await copyStableSnapshotFile(
      database,
      isolatedDatabase,
      "Semantic database",
      MAX_SEMANTIC_READ_SNAPSHOT_BYTES,
      seal.database,
    );
    await Promise.all([
      assertAbsentSnapshotSidecar(sourceWal, "Semantic database WAL"),
      assertAbsentSnapshotSidecar(sourceShm, "Semantic database SHM"),
      assertAbsentSnapshotSidecar(sourceJournal, "Semantic database rollback journal"),
    ]);
    if (databaseSeal.bytes > MAX_SEMANTIC_READ_SNAPSHOT_BYTES) {
      throw new RangeError("Semantic database exceeds the read-snapshot byte bound.");
    }
    return Object.freeze({ database: isolatedDatabase, cleanup });
  } catch (error: unknown) {
    await cleanup();
    throw error;
  }
}

function aggregateCloseFailures(
  settlements: readonly PromiseSettledResult<unknown>[],
  label: string,
): void {
  const failures = settlements.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map(({ reason }): unknown => reason),
      `${label} did not close cleanly.`,
    );
  }
}

async function closeIsolatedStore(
  close: () => Promise<void>,
  snapshot: IsolatedQmdDatabaseSnapshot,
  label: string,
): Promise<void> {
  const settlements: PromiseSettledResult<unknown>[] = [];
  try {
    await close();
    settlements.push({ status: "fulfilled", value: undefined });
  } catch (reason: unknown) {
    settlements.push({ status: "rejected", reason });
  }
  try {
    await snapshot.cleanup();
    settlements.push({ status: "fulfilled", value: undefined });
  } catch (reason: unknown) {
    settlements.push({ status: "rejected", reason });
  }
  aggregateCloseFailures(settlements, label);
}

function isolatedWarmSearchStore(
  store: WarmSearchStore,
  snapshot: IsolatedQmdDatabaseSnapshot,
): WarmSearchStore {
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    ...store,
    close: () => {
      closePromise ??= closeIsolatedStore(
        store.close,
        snapshot,
        "Isolated QMD warm store",
      );
      return closePromise;
    },
  });
}

function isolatedAttestationStore(
  store: SemanticAttestationStore,
  snapshot: IsolatedQmdDatabaseSnapshot,
): SemanticAttestationStore {
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    ...store,
    close: () => {
      closePromise ??= closeIsolatedStore(
        store.close,
        snapshot,
        "Isolated QMD attestation store",
      );
      return closePromise;
    },
  });
}

function storeConfig(root: string, embeddingModelSource: string): SemanticCollectionConfig {
  return {
    global_context: globalContext,
    collections: {
      [collectionName]: {
        path: root,
        pattern: markdownPattern,
        ignore: ignoredPatterns,
        context: collectionContext,
      },
    },
    models: { embed: embeddingModelSource },
  };
}

async function defaultCreateStore(options: SemanticStoreOptions): Promise<unknown> {
  const loaded: unknown = await import(qmdModuleSpecifier);
  const module = boundaryRecord(loaded, "QMD module");
  const createStore = boundUnknownMethod(module, "createStore", "QMD module");
  return await createStore(options);
}

async function defaultCreateWarmSearchStore(
  options: SemanticWarmStoreOptions,
): Promise<unknown> {
  const loaded: unknown = await import(qmdModuleSpecifier);
  const module = boundaryRecord(loaded, "QMD module");
  const createStore = boundUnknownMethod(module, "createStore", "QMD module");
  // The caller passes an isolated stable snapshot, never the attested cache.
  // QMD has no read-only store mode and initializes schema/WAL state on every
  // open. Config-free mode keeps those unavoidable writes confined to the
  // disposable snapshot. The pinned fork's exact internal LLM boundary is
  // installed before any query because DB-only mode cannot select a model.
  const created = await createStore({ dbPath: options.dbPath });
  let localLlm: Readonly<Record<string, unknown>> | undefined;
  try {
    const store = boundaryRecord(created, "QMD warm search store");
    const internal = boundaryRecord(store.internal, "QMD warm search store.internal");
    const previousLlm = boundaryRecord(internal.llm, "QMD warm search store.internal.llm");
    const previousDispose = boundUnknownMethod(
      previousLlm,
      "dispose",
      "QMD warm search store.internal.llm",
    );
    const llmSpecifier = new URL("./llm.js", import.meta.resolve(qmdModuleSpecifier)).href;
    const loadedLlm: unknown = await import(llmSpecifier);
    const llmModule = boundaryRecord(loadedLlm, "QMD LLM module");
    if (typeof llmModule.LlamaCpp !== "function") {
      throw new Error("QMD LLM module.LlamaCpp must be a constructor.");
    }
    const constructed: unknown = Reflect.construct(llmModule.LlamaCpp, [{
      embedModel: options.embeddingModelSource,
      inactivityTimeoutMs: 5 * 60_000,
      disposeModelsOnInactivity: true,
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
        if (closed) return;
        closed = true;
        const settlements = await Promise.allSettled([localDispose(), close()]);
        const failures = settlements.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected",
        );
        if (failures.length > 0) {
          throw new AggregateError(
            failures.map(({ reason }): unknown => reason),
            "QMD warm store did not close cleanly.",
          );
        }
      },
    });
  } catch (error: unknown) {
    if (localLlm !== undefined) {
      const dispose = localLlm.dispose;
      if (typeof dispose === "function") {
        await Promise.resolve(Reflect.apply(dispose, localLlm, [])).catch(() => undefined);
      }
    }
    await closeMalformedStore(created);
    throw error;
  }
}

async function defaultCreateAttestationStore(
  options: SemanticAttestationStoreOptions,
): Promise<unknown> {
  const loaded: unknown = await import(qmdModuleSpecifier);
  const module = boundaryRecord(loaded, "QMD module");
  const createStore = boundUnknownMethod(module, "createStore", "QMD module");
  // This path is an isolated stable snapshot. QMD's config-free opener still
  // initializes SQLite, but it cannot mutate or lock the attested cache.
  return await createStore(options);
}

type SemanticCheckpointDatabase = Readonly<{
  readonly checkpoint: () => Promise<unknown>;
  readonly close: () => Promise<void>;
}>;

async function defaultOpenCheckpointDatabase(database: string): Promise<unknown> {
  const moduleSpecifier: string = "bun:sqlite";
  const loaded: unknown = await import(moduleSpecifier);
  const module = boundaryRecord(loaded, "Bun SQLite module");
  if (typeof module.Database !== "function") {
    throw new TypeError("Bun SQLite module.Database must be a constructor.");
  }
  const opened = boundaryRecord(
    Reflect.construct(module.Database, [database, { create: false, strict: true }]),
    "Bun SQLite checkpoint database",
  );
  const query = boundUnknownMethod(opened, "query", "Bun SQLite checkpoint database");
  const close = boundUnknownMethod(opened, "close", "Bun SQLite checkpoint database");
  return Object.freeze({
    checkpoint: async () => {
      const walStatement = boundaryRecord(
        await query("PRAGMA wal_checkpoint(TRUNCATE)"),
        "Bun SQLite WAL checkpoint statement",
      );
      const walGet = boundUnknownMethod(walStatement, "get", "Bun SQLite WAL checkpoint statement");
      const modeStatement = boundaryRecord(
        await query("PRAGMA journal_mode = DELETE"),
        "Bun SQLite journal-mode statement",
      );
      const modeGet = boundUnknownMethod(
        modeStatement,
        "get",
        "Bun SQLite journal-mode statement",
      );
      return Object.freeze({ wal: await walGet(), mode: await modeGet() });
    },
    close: async () => {
      await close();
    },
  });
}

async function openedCheckpointDatabase(value: unknown): Promise<SemanticCheckpointDatabase> {
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
      },
    });
  } catch (error: unknown) {
    await closeMalformedStore(value);
    throw error;
  }
}

type SemanticAttestationStore = {
  readonly close: () => Promise<void>;
  readonly pendingEmbeddingCount: () => Promise<number>;
};

function parseSemanticAttestationStore(value: unknown): SemanticAttestationStore {
  const store = boundaryRecord(value, "QMD attestation store");
  const close = boundUnknownMethod(store, "close", "QMD attestation store");
  const internal = boundaryRecord(store.internal, "QMD attestation store.internal");
  const llm = boundaryRecord(internal.llm, "QMD attestation store.internal.llm");
  const getHashesNeedingEmbedding = boundUnknownMethod(
    internal,
    "getHashesNeedingEmbedding",
    "QMD attestation store.internal",
  );
  // Attestation never invokes these methods. Requiring all three proves that
  // a later strict query can stay on the same store-local vector/LLM boundary.
  boundUnknownMethod(internal, "searchVec", "QMD attestation store.internal");
  boundUnknownMethod(llm, "countTokens", "QMD attestation store.internal.llm");
  boundUnknownMethod(llm, "embed", "QMD attestation store.internal.llm");
  return Object.freeze({
    close: async () => {
      await close();
    },
    pendingEmbeddingCount: async () => boundaryCount(
      await getHashesNeedingEmbedding(recommendedEmbeddingModel),
      "QMD attestation store.internal.getHashesNeedingEmbedding result",
    ),
  });
}

async function openedSemanticAttestationStore(
  value: unknown,
): Promise<SemanticAttestationStore> {
  try {
    return parseSemanticAttestationStore(value);
  } catch (error: unknown) {
    await closeMalformedStore(value);
    throw error;
  }
}

async function openStore(
  root: string,
  database: string,
  embeddingModelSource: string,
  dependencies: SemanticDependencies,
  requireStoreLocalVectorBoundary = false,
): Promise<SearchStore> {
  await mkdir(dirname(database), { recursive: true });
  const created = await (dependencies.createStore ?? defaultCreateStore)({
    dbPath: database,
    config: storeConfig(root, embeddingModelSource),
  });
  return await openedSearchStore(created, recommendedEmbeddingModel, {
    requireStoreLocalVectorBoundary,
    now: dependencies.now ?? performance.now.bind(performance),
  });
}

async function assertExactWarmProjectionFile(
  path: string,
  expected: Uint8Array,
  label: string,
): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== expected.byteLength) {
      throw new Error(`${label} does not match the immutable warm projection.`);
    }
    const observed = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || !observed.equals(expected)
    ) {
      throw new Error(`${label} does not match the immutable warm projection.`);
    }
  } finally {
    await handle.close();
  }
}

async function assertExistingWarmProjection(
  description: SemanticProjectionDescription,
  notes: readonly Note[],
): Promise<void> {
  let canonicalGeneration: string;
  try {
    canonicalGeneration = await realpath(description.generationPath);
  } catch (error: unknown) {
    throw new Error("The immutable warm semantic projection is absent.", { cause: error });
  }
  if (canonicalGeneration !== description.generationPath) {
    throw new Error("The immutable warm semantic projection changed identity.");
  }
  await assertExactWarmProjectionFile(
    join(canonicalGeneration, "manifest.json"),
    Buffer.from(description.manifestText, "utf8"),
    "Semantic projection manifest",
  );
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
    if (
      expected.byteLength !== entry.bytes
      || createHash("sha256").update(expected).digest("hex") !== entry.sha256
    ) {
      throw new Error(`Semantic projection note ${JSON.stringify(entry.path)} drifted.`);
    }
    await assertExactWarmProjectionFile(
      resolve(canonicalGeneration, ...entry.path.split("/")),
      expected,
      `Semantic projection note ${JSON.stringify(entry.path)}`,
    );
  }
}

async function openWarmSearchStore(
  database: string,
  databaseSnapshotSeal: SemanticDatabaseSnapshotSeal,
  embeddingModelSource: string,
  dependencies: SemanticDependencies,
): Promise<WarmSearchStore> {
  const snapshot = await createIsolatedQmdDatabaseSnapshot(database, databaseSnapshotSeal);
  try {
    const created = await (
      dependencies.createWarmSearchStore ?? defaultCreateWarmSearchStore
    )({
      dbPath: snapshot.database,
      embeddingModelSource,
    });
    const store = await openedWarmSearchStore(
      created,
      dependencies.now ?? performance.now.bind(performance),
    );
    return isolatedWarmSearchStore(store, snapshot);
  } catch (error: unknown) {
    await snapshot.cleanup();
    throw error;
  }
}

async function openAttestationStore(
  database: string,
  databaseSnapshotSeal: SemanticDatabaseSnapshotSeal,
  dependencies: SemanticDependencies,
): Promise<SemanticAttestationStore> {
  const snapshot = await createIsolatedQmdDatabaseSnapshot(database, databaseSnapshotSeal);
  try {
    const created = await (
      dependencies.createAttestationStore ?? defaultCreateAttestationStore
    )({ dbPath: snapshot.database });
    const store = await openedSemanticAttestationStore(created);
    return isolatedAttestationStore(store, snapshot);
  } catch (error: unknown) {
    await snapshot.cleanup();
    throw error;
  }
}

/**
 * Finish a private QMD writer generation before its bytes are sealed. This is
 * the only canonical SQLite mutation in the warm-reader composition: it
 * checkpoints WAL content into the main file and leaves journal mode DELETE so
 * every later reader can require canonical WAL/SHM/rollback-journal absence.
 */
export async function checkpointSemanticWarmCache(
  options: Pick<SemanticWarmCacheAttestationOptions, "root" | "database">,
  dependencies: SemanticDependencies = {},
): Promise<SemanticWarmCacheCheckpointResult> {
  const root = await resolvedDirectory(options.root);
  const database = await resolveSemanticDatabase(
    databaseFor(root, options.database, dependencies),
    root,
  );
  const before = await lstat(database);
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) {
    throw new TypeError("The semantic database to checkpoint must be a singly linked regular file.");
  }
  const opened = await (dependencies.openCheckpointDatabase ?? defaultOpenCheckpointDatabase)(
    database,
  );
  const checkpoint = await openedCheckpointDatabase(opened);
  try {
    const outcome = boundaryRecord(
      await checkpoint.checkpoint(),
      "Semantic checkpoint result",
    );
    const wal = boundaryRecord(outcome.wal, "Semantic checkpoint result.wal");
    const busy = boundaryCount(wal.busy, "Semantic checkpoint result.wal.busy");
    const log = boundaryCount(wal.log, "Semantic checkpoint result.wal.log");
    const checkpointed = boundaryCount(
      wal.checkpointed,
      "Semantic checkpoint result.wal.checkpointed",
    );
    const mode = boundaryRecord(outcome.mode, "Semantic checkpoint result.mode");
    if (busy !== 0 || log !== checkpointed) {
      throw new Error("Semantic WAL checkpoint did not copy every committed frame.");
    }
    if (boundaryString(mode.journal_mode, "Semantic checkpoint result.mode.journal_mode") !== "delete") {
      throw new Error("Semantic database did not leave WAL journal mode.");
    }
  } catch (error: unknown) {
    try {
      await checkpoint.close();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [error, cleanupError],
        "Semantic database checkpoint and cleanup both failed.",
        { cause: error },
      );
    }
    throw error;
  }
  await checkpoint.close();
  for (const sidecar of [`${database}-wal`, `${database}-shm`]) {
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(sidecar);
    } catch (error: unknown) {
      if (missingFile(error)) continue;
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
      throw new TypeError("Semantic checkpoint sidecars must be singly linked regular files.");
    }
    await rm(sidecar);
  }
  await Promise.all([
    assertAbsentSnapshotSidecar(`${database}-wal`, "Semantic database WAL"),
    assertAbsentSnapshotSidecar(`${database}-shm`, "Semantic database SHM"),
    assertAbsentSnapshotSidecar(
      `${database}-journal`,
      "Semantic database rollback journal",
    ),
  ]);
  return Object.freeze({ database, wal: null, shm: null, journal: null });
}

/**
 * Prove that an existing QMD cache can serve strict local vector queries.
 * QMD opens a stable disposable snapshot because its public store constructor
 * always initializes SQLite. The attested cache itself is never opened,
 * locked, updated, embedded, searched, indexed, or repaired.
 */
export async function attestSemanticWarmCache(
  options: SemanticWarmCacheAttestationOptions,
  dependencies: SemanticDependencies = {},
): Promise<SemanticWarmCacheReadiness> {
  const embeddingModel = retainVerifiedEmbeddingModelLease(options.embeddingModelLease);
  try {
    const root = await resolvedDirectory(options.root);
    const database = await resolveSemanticDatabase(
      databaseFor(root, options.database, dependencies),
      root,
    );
    if (Buffer.byteLength(database, "utf8") > MAX_SEMANTIC_DATABASE_IDENTITY_BYTES) {
      throw new RangeError(
        `Semantic database identity exceeds ${MAX_SEMANTIC_DATABASE_IDENTITY_BYTES.toLocaleString("en-US")} UTF-8 bytes.`,
      );
    }
    let databaseState: Awaited<ReturnType<typeof stat>>;
    try {
      databaseState = await stat(database);
    } catch (error: unknown) {
      throw new Error("The warm semantic database must already exist.", { cause: error });
    }
    if (!databaseState.isFile()) {
      throw new Error("The warm semantic database must already be a regular file.");
    }
    const store = await openAttestationStore(
      database,
      options.databaseSnapshotSeal,
      dependencies,
    );
    try {
      const pendingEmbeddings = await store.pendingEmbeddingCount();
      if (pendingEmbeddings !== 0) {
        throw new Error(
          `Warm semantic cache is not ready: ${pendingEmbeddings} embedding input(s) remain pending.`,
        );
      }
      return Object.freeze({
        model: recommendedEmbeddingModel,
        database,
        pendingEmbeddings: 0,
      });
    } finally {
      await store.close();
    }
  } finally {
    await embeddingModel.release();
  }
}

/**
 * Open one query-only session over an already verified warm projection.
 * Establishment is eager: the projection, model lease, strict store-local
 * vector boundary, and zero pending-embedding state are all proven before the
 * session is returned. No writer lease, projection preparation, update, or
 * corpus embedding operation is reachable from this path.
 */
export async function openSemanticWarmSearchSession(
  options: SemanticWarmSearchSessionOptions,
  dependencies: SemanticDependencies = {},
): Promise<SemanticSearchSession> {
  const embeddingModel = retainVerifiedEmbeddingModelLease(options.embeddingModelLease);
  let store: WarmSearchStore | undefined;
  try {
    const root = await resolvedDirectory(options.root);
    const database = await resolveSemanticDatabase(
      databaseFor(root, options.database, dependencies),
      root,
    );
    const databaseState = await stat(database).catch((error: unknown) => {
      throw new Error("The warm semantic database must already exist.", { cause: error });
    });
    if (!databaseState.isFile()) {
      throw new Error("The warm semantic database must already be a regular file.");
    }
    const snapshot = await semanticSnapshot(root, dependencies);
    const description = await describeSemanticProjection(
      database,
      root,
      snapshot.notes,
      semanticIndexIdentity,
    );
    await assertExistingWarmProjection(description, snapshot.notes);
    store = await openWarmSearchStore(
      database,
      options.databaseSnapshotSeal,
      embeddingModel.source,
      dependencies,
    );
    const pendingEmbeddings = await store.pendingEmbeddingCount();
    if (pendingEmbeddings !== 0) {
      throw new Error(
        `Warm semantic cache is not ready: ${pendingEmbeddings} embedding input(s) remain pending.`,
      );
    }

    const notesByPath = new Map(snapshot.notes.map((note) => [note.path, note]));
    const contentHashesByPath = new Map(
      description.manifest.notes.map(({ path, sha256 }) => [path, sha256]),
    );
    const notesByQmdPath = qmdNoteLookup(snapshot.notes, contentHashesByPath);
    const connectionsById = new Map(
      snapshot.analysis.noteConnections.map((connection) => [connection.id, connection]),
    );
    const update: SemanticUpdateResult = Object.freeze({
      collections: 1,
      indexed: 0,
      updated: 0,
      unchanged: snapshot.notes.length,
      removed: 0,
      needsEmbedding: 0,
    });
    const context: SemanticSearchContext = {
      root,
      projectionRoot: description.generationPath,
      database,
      store,
      update,
      ensureEmbedding: () => Promise.resolve(null),
      notesByPath,
      notesByQmdPath,
      contentHashesByPath,
      connectionsById,
    };
    let tail: Promise<void> = Promise.resolve();
    let closeRequested = false;
    let closePromise: Promise<void> | undefined;
    const serialize = <Value>(operation: () => Promise<Value>): Promise<Value> => {
      const result = tail.then(operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    };
    const ownedStore = store;
    store = undefined;
    return Object.freeze({
      root,
      database,
      model: recommendedEmbeddingModel,
      update,
      search: (searchOptions: SemanticSessionSearchOptions) => {
        if (closeRequested) {
          return Promise.reject(new Error("Semantic warm search session is closed."));
        }
        return serialize(() => executeSemanticSearch(context, searchOptions));
      },
      close: () => {
        if (closePromise !== undefined) return closePromise;
        closeRequested = true;
        closePromise = serialize(async () => {
          try {
            await ownedStore.close();
          } finally {
            await embeddingModel.release();
          }
        });
        return closePromise;
      },
    });
  } catch (error: unknown) {
    try {
      await store?.close();
    } finally {
      await embeddingModel.release();
    }
    throw error;
  }
}

function databaseFor(
  root: string,
  requested: string | undefined,
  dependencies: SemanticDependencies,
): string {
  if (requested === undefined) return semanticDatabasePath(root, dependencies);
  return resolve(requested);
}

async function embedChanged(
  store: SearchStore,
  update: SemanticUpdateResult,
  force: boolean,
): Promise<SemanticEmbeddingResult | null> {
  if (!force && update.needsEmbedding === 0) return null;
  return await store.embed({
    collection: collectionName,
    force,
    model: recommendedEmbeddingModel,
    chunkStrategy: embeddingChunkStrategy,
  });
}

async function semanticSnapshot(
  root: string,
  dependencies: SemanticDependencies,
): Promise<VaultSnapshot> {
  return await (dependencies.scanVault
    ?? ((vaultRoot: string) => scanVault(vaultRoot, { mentionScope: false })))(root);
}

/** Build or incrementally refresh the local QMD vector index for one vault. */
export async function indexSemanticVault(
  options: SemanticIndexOptions,
  dependencies: SemanticDependencies = {},
): Promise<SemanticIndexResult> {
  const embeddingModel = await verifiedIndexEmbeddingModelSource(
    options.embeddingModelFile,
    dependencies,
  );
  try {
    const root = await resolvedDirectory(options.root);
    const databaseCandidate = await resolveSemanticDatabase(
      databaseFor(root, options.database, dependencies),
      root,
    );
    const snapshot = await semanticSnapshot(root, dependencies);
    const description = await describeSemanticProjection(
      databaseCandidate,
      root,
      snapshot.notes,
      semanticIndexIdentity,
    );
    const database = description.database;
    return await withSemanticGenerationWriterLease(
      database,
      description.manifest.generation,
      async () => {
        const projection = await prepareSemanticProjection(description, snapshot.notes);
        let store: SearchStore | undefined;
        try {
          store = await openStore(
            projection.root,
            database,
            embeddingModel.source,
            dependencies,
          );
          const update = await store.update({ collections: [collectionName] });
          const embedding = await embedChanged(
            store,
            update,
            options.force ?? false,
          );
          return { root, database, model: recommendedEmbeddingModel, update, embedding };
        } finally {
          try {
            await store?.close();
          } finally {
            await projection.release();
          }
        }
      },
      {
        ...dependencies.writerLease,
        excludeReaders: options.force === true,
      },
    );
  } finally {
    await embeddingModel.release();
  }
}

function qmdEmojiToHex(value: string): string {
  return value.replace(/(?:\p{So}\p{Mn}?|\p{Sk})+/gu, (run) =>
    [...run]
      .filter((character) => /\p{So}|\p{Sk}/u.test(character))
      .map((character) => character.codePointAt(0)?.toString(16) ?? "")
      .join("-"));
}

/** Owned equivalent of QMD 2.5.3's pinned handelize path transform. */
function qmdHandelize(path: string): string | null {
  if (path.trim() === "") return null;
  const segments = path.split("/").filter((segment) => segment !== "");
  const lastSegment = segments.at(-1) ?? "";
  const filenameWithoutExtension = lastSegment.replace(/\.[^.]+$/u, "");
  if (!/[\p{L}\p{N}\p{So}\p{Sk}$]/u.test(filenameWithoutExtension)) return null;
  const result = path
    .replaceAll("___", "/")
    .split("/")
    .map((rawSegment, index, allSegments) => {
      const segment = qmdEmojiToHex(rawSegment);
      if (index === allSegments.length - 1) {
        const extension = segment.match(/(\.[a-z0-9]+)$/iu)?.[1] ?? "";
        const name = extension === "" ? segment : segment.slice(0, -extension.length);
        return name
          .replace(/[^\p{L}\p{N}$]+/gu, "-")
          .replace(/^-+|-+$/gu, "") + extension;
      }
      return segment
        .replace(/[^\p{L}\p{N}$]+/gu, "-")
        .replace(/^-+|-+$/gu, "");
    })
    .filter((segment) => segment !== "")
    .join("/");
  return result === "" ? null : result;
}

type QmdNoteLookup = ReadonlyMap<string, ReadonlyMap<string, readonly Note[]>>;

function qmdNoteLookup(
  notes: readonly Note[],
  contentHashesByPath: ReadonlyMap<string, string>,
): QmdNoteLookup {
  const lookup = new Map<string, Map<string, Note[]>>();
  for (const note of notes) {
    const qmdPath = qmdHandelize(note.path);
    if (qmdPath === null) continue;
    const contentHash = contentHashesByPath.get(note.path);
    if (contentHash === undefined) {
      throw new Error(`Semantic projection lost the hash for ${JSON.stringify(note.path)}.`);
    }
    const byHash = lookup.get(qmdPath) ?? new Map<string, Note[]>();
    const candidates = byHash.get(contentHash) ?? [];
    candidates.push(note);
    byHash.set(contentHash, candidates);
    lookup.set(qmdPath, byHash);
  }
  return lookup;
}

/** Undefined means a filesystem result; null means a rejected virtual result. */
function qmdVirtualNotePath(filepath: string): string | null | undefined {
  if (!filepath.startsWith("qmd://")) return undefined;
  const prefix = `qmd://${collectionName}/`;
  if (!filepath.startsWith(prefix)) return null;
  const path = filepath.slice(prefix.length);
  const segments = path.split("/");
  const hasControlCharacter = [...path].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (path === ""
    || path.includes("\\")
    || path.includes("?")
    || path.includes("#")
    || path.includes("%")
    || hasControlCharacter
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  return path;
}

async function resolvedSearchNote(
  projectionRoot: string,
  result: SemanticSearchDocument,
  notesByPath: ReadonlyMap<string, Note>,
  notesByQmdPath: QmdNoteLookup,
  contentHashesByPath: ReadonlyMap<string, string>,
): Promise<Note | null> {
  const virtualPath = qmdVirtualNotePath(result.filepath);
  if (virtualPath !== undefined) {
    if (virtualPath === null) return null;
    const candidates = notesByQmdPath.get(virtualPath)?.get(result.hash) ?? [];
    const candidate = candidates[0];
    return candidates.length === 1
      && candidate !== undefined
      && contentHashesByPath.get(candidate.path) === result.hash
      ? candidate
      : null;
  }
  if (!isAbsolute(result.filepath)) return null;
  let filepath: string;
  try {
    filepath = await realpath(resolve(result.filepath));
  } catch {
    return null;
  }
  const candidate = relative(projectionRoot, filepath);
  if (candidate === "" || candidate === ".." || candidate.startsWith(`..${sep}`) || isAbsolute(candidate)) {
    return null;
  }
  const note = notesByPath.get(candidate.split(sep).join("/"));
  return note !== undefined && contentHashesByPath.get(note.path) === result.hash ? note : null;
}

function queryOffset(body: string, query: string, suggested: number | undefined): number {
  if (suggested !== undefined && Number.isSafeInteger(suggested) && suggested >= 0 && suggested <= body.length) {
    return suggested;
  }
  const terms = query.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const lowerBody = body.toLocaleLowerCase("en-US");
  for (const term of terms.toSorted((left, right) => right.length - left.length)) {
    const offset = lowerBody.indexOf(term);
    if (offset !== -1) return offset;
  }
  return 0;
}

function boundedSnippet(body: string, offset: number): string {
  const normalized = body.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const maximum = 600;
  const start = Math.max(0, Math.min(normalized.length, offset) - 180);
  const end = Math.min(normalized.length, start + maximum);
  const value = normalized.slice(start, end).replace(/\s+/gu, " ").trim();
  return `${start > 0 ? "…" : ""}${value}${end < normalized.length ? "…" : ""}`;
}

async function searchHit(
  projectionRoot: string,
  query: string,
  result: SemanticSearchDocument,
  notesByPath: ReadonlyMap<string, Note>,
  notesByQmdPath: QmdNoteLookup,
  contentHashesByPath: ReadonlyMap<string, string>,
  connectionsById: ReadonlyMap<string, NoteConnections>,
): Promise<SemanticSearchHit | null> {
  const note = await resolvedSearchNote(
    projectionRoot,
    result,
    notesByPath,
    notesByQmdPath,
    contentHashesByPath,
  );
  if (note === null) return null;
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
    ...(body === "" ? {} : { line: body.slice(0, offset).split("\n").length }),
    snippet: boundedSnippet(body, offset),
    tags: note.tags,
    metadata: note.metadata,
    inboundContextualCount: connection?.inboundContextualCount ?? 0,
    outboundContextualCount: connection?.outboundContextualCount ?? 0,
    backlinks: connection?.backlinks ?? [],
  };
}

type FusedSemanticDocument = {
  readonly document: SemanticSearchDocument;
  readonly score: number;
  readonly signals: {
    readonly keyword: boolean;
    readonly semantic: boolean;
  };
};

function semanticDocumentKey(document: SemanticSearchDocument): string {
  return JSON.stringify([document.filepath, document.hash]);
}

function firstDocumentsByKey(
  documents: readonly SemanticSearchDocument[],
): ReadonlyMap<string, SemanticSearchDocument> {
  const byKey = new Map<string, SemanticSearchDocument>();
  for (const document of documents) {
    const key = semanticDocumentKey(document);
    if (!byKey.has(key)) byKey.set(key, document);
  }
  return byKey;
}

function fusedHybridDocuments(
  lexical: readonly SemanticSearchDocument[],
  vector: readonly SemanticSearchDocument[],
  candidateLimit: number,
): readonly FusedSemanticDocument[] {
  const lexicalByKey = firstDocumentsByKey(lexical);
  const vectorByKey = firstDocumentsByKey(vector);
  return fuseRankedCandidates([
    { name: "keyword", weight: 1, ids: lexical.map(semanticDocumentKey) },
    { name: "semantic", weight: 1, ids: vector.map(semanticDocumentKey) },
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
        semantic: candidate.contributions.some(({ lane }) => lane === "semantic"),
      },
    };
  });
}

async function hybridSearchHit(
  projectionRoot: string,
  query: string,
  result: FusedSemanticDocument,
  notesByPath: ReadonlyMap<string, Note>,
  notesByQmdPath: QmdNoteLookup,
  contentHashesByPath: ReadonlyMap<string, string>,
  connectionsById: ReadonlyMap<string, NoteConnections>,
): Promise<SemanticSearchHit | null> {
  const hit = await searchHit(
    projectionRoot,
    query,
    result.document,
    notesByPath,
    notesByQmdPath,
    contentHashesByPath,
    connectionsById,
  );
  if (hit === null) return null;
  return {
    ...hit,
    score: result.score,
    source: "hybrid",
    signals: result.signals,
  };
}

function boundedLimit(value: number | undefined, maximum: 100 | 500): number {
  if (value === undefined) return 10;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Search limit must be an integer from 1 through ${maximum}.`);
  }
  return value;
}

function boundedCandidateLimit(
  value: number | undefined,
  resultLimit: number,
): number {
  if (value === undefined) return Math.max(40, resultLimit * 4);
  if (!Number.isSafeInteger(value) || value < resultLimit || value > 500) {
    throw new Error(
      `Search candidate limit must be an integer from ${resultLimit} through 500.`,
    );
  }
  return value;
}

function boundedScore(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Minimum score must be a number from 0 through 1.");
  }
  return value;
}

function boundedMode(value: unknown): SemanticSearchMode {
  const mode = value ?? "semantic";
  if (mode !== "hybrid" && mode !== "keyword" && mode !== "semantic") {
    throw new Error('Search mode must be "hybrid", "keyword", or "semantic".');
  }
  return mode;
}

type SemanticSearchContext = {
  readonly root: string;
  readonly projectionRoot: string;
  readonly database: string;
  readonly store: SemanticQueryStore;
  readonly update: SemanticUpdateResult;
  readonly ensureEmbedding: () => Promise<SemanticEmbeddingResult | null>;
  readonly notesByPath: ReadonlyMap<string, Note>;
  readonly notesByQmdPath: QmdNoteLookup;
  readonly contentHashesByPath: ReadonlyMap<string, string>;
  readonly connectionsById: ReadonlyMap<string, NoteConnections>;
};

async function executeSemanticSearch(
  context: SemanticSearchContext,
  options: SemanticSessionSearchOptions,
): Promise<SemanticSearchResult> {
  const query = validateSearchQuery(options.query).query;
  const mode = boundedMode(options.mode);
  const limit = boundedLimit(options.limit, 500);
  const candidateLimit = boundedCandidateLimit(options.candidateLimit, limit);
  const minScore = boundedScore(options.minScore);
  const embedding = mode === "keyword"
    ? null
    : await context.ensureEmbedding();
  let queryEmbedding: SemanticQueryEmbeddingAccounting | null = mode === "keyword"
    ? Object.freeze({ calls: 0, inputTokens: 0, durationMs: 0 })
    : null;
  let hits: readonly (SemanticSearchHit | null)[];
  let rawRequested: number;
  let rawReturned: number;
  let rawDiscarded: number;
  let rawThresholdRejected: number;
  let rawExhausted: boolean;
  if (mode === "hybrid") {
    const lexical = await context.store.searchLex(query, {
      collection: collectionName,
      limit: candidateLimit,
    });
    const vectorSearch = await context.store.searchVector(query, {
      collection: collectionName,
      limit: candidateLimit,
    });
    queryEmbedding = vectorSearch.accounting;
    const fused = fusedHybridDocuments(lexical, vectorSearch.results, candidateLimit);
    const considered = fused.filter(({ score }) => score >= minScore);
    rawRequested = candidateLimit;
    rawReturned = fused.length;
    rawThresholdRejected = fused.length - considered.length;
    rawExhausted = fused.length < candidateLimit
      && lexical.length < candidateLimit
      && vectorSearch.results.length < candidateLimit;
    hits = await Promise.all(considered.map((result) =>
      hybridSearchHit(
        context.projectionRoot,
        query,
        result,
        context.notesByPath,
        context.notesByQmdPath,
        context.contentHashesByPath,
        context.connectionsById,
      )));
    rawDiscarded = considered.length - hits.filter((hit) => hit !== null).length;
  } else {
    const vectorSearch = mode === "semantic"
      ? await context.store.searchVector(query, {
          collection: collectionName,
          limit: candidateLimit,
        })
      : null;
    const matches = vectorSearch === null
      ? await context.store.searchLex(query, {
          collection: collectionName,
          limit: candidateLimit,
        })
      : vectorSearch.results;
    if (vectorSearch !== null) queryEmbedding = vectorSearch.accounting;
    rawRequested = candidateLimit;
    rawReturned = matches.length;
    const considered = matches.filter(({ score }) => score >= minScore);
    rawThresholdRejected = matches.length - considered.length;
    rawExhausted = matches.length < candidateLimit;
    hits = await Promise.all(considered
      .map((result) =>
        searchHit(
          context.projectionRoot,
          query,
          result,
          context.notesByPath,
          context.notesByQmdPath,
          context.contentHashesByPath,
          context.connectionsById,
        )));
    rawDiscarded = considered.length - hits.filter((hit) => hit !== null).length;
  }
  const verified = hits.filter((hit): hit is SemanticSearchHit => hit !== null);
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
      exhausted: rawExhausted,
    },
    results: verified.slice(0, limit),
  };
}

/** Open one serialized QMD search session over one immutable live vault snapshot. */
export async function openSemanticSearchSession(
  options: SemanticSessionOptions,
  dependencies: SemanticDependencies = {},
): Promise<SemanticSearchSession> {
  const root = await resolvedDirectory(options.root);
  const databaseCandidate = await resolveSemanticDatabase(
    databaseFor(root, options.database, dependencies),
    root,
  );
  const snapshot = await semanticSnapshot(root, dependencies);
  const description = await describeSemanticProjection(
    databaseCandidate,
    root,
    snapshot.notes,
    semanticIndexIdentity,
  );
  const notesByPath = new Map(snapshot.notes.map((note) => [note.path, note]));
  const contentHashesByPath = new Map(
    description.manifest.notes.map(({ path, sha256 }) => [path, sha256]),
  );
  const notesByQmdPath = qmdNoteLookup(snapshot.notes, contentHashesByPath);
  const connectionsById = new Map(
    snapshot.analysis.noteConnections.map((connection) => [connection.id, connection]),
  );
  const requireStoreLocalVectorBoundary = requiredStoreLocalVectorBoundary(
    options.requireStoreLocalVectorBoundary,
  );
  const embeddingModel = await sessionEmbeddingModelSource(options, dependencies);
  const database = description.database;
  let retained: {
    readonly store: SearchStore;
    readonly projection: SemanticProjection;
  } | undefined;
  let initialized: {
    readonly store: SearchStore;
    readonly projection: SemanticProjection;
    readonly update: SemanticUpdateResult;
  };
  try {
    initialized = await withSemanticGenerationWriterLease(
      database,
      description.manifest.generation,
      async () => {
        const projection = await prepareSemanticProjection(description, snapshot.notes);
        let store: SearchStore | undefined;
        try {
          store = await openStore(
            projection.root,
            database,
            embeddingModel.source,
            dependencies,
            requireStoreLocalVectorBoundary,
          );
          retained = { store, projection };
          const update = await store.update({ collections: [collectionName] });
          return { store, projection, update };
        } catch (error: unknown) {
          try {
            await store?.close();
          } finally {
            await projection.release();
            retained = undefined;
          }
          throw error;
        }
      },
      dependencies.writerLease,
    );
  } catch (error: unknown) {
    await retained?.store.close().catch(() => undefined);
    await retained?.projection.release().catch(() => undefined);
    await embeddingModel.release().catch(() => undefined);
    throw error;
  }
  const { store, projection, update } = initialized;
  let embeddingPromise: Promise<SemanticEmbeddingResult | null> | undefined;
  const ensureEmbedding = (): Promise<SemanticEmbeddingResult | null> => {
    embeddingPromise ??= update.needsEmbedding === 0
      ? Promise.resolve(null)
      : withSemanticGenerationWriterLease(
          database,
          projection.manifest.generation,
          async () => {
            // Another process may have completed this generation's vectors while
            // the session waited. Refresh under the lease before writing.
            const refreshed = await store.update({ collections: [collectionName] });
            return await embedChanged(store, refreshed, false);
          },
          dependencies.writerLease,
        );
    return embeddingPromise;
  };
  let tail: Promise<void> = Promise.resolve();
  let closeRequested = false;
  let closePromise: Promise<void> | undefined;
  const serialize = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const context: SemanticSearchContext = {
    root,
    projectionRoot: projection.root,
    database,
    store,
    update,
    ensureEmbedding,
    notesByPath,
    notesByQmdPath,
    contentHashesByPath,
    connectionsById,
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
      if (closePromise !== undefined) return closePromise;
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
    },
  };
}

/** Incrementally synchronize the vault, then run local hybrid, BM25, or embedding search. */
export async function searchSemanticVault(
  options: SemanticSearchOptions,
  dependencies: SemanticDependencies = {},
): Promise<SemanticSearchResult> {
  const query = validateSearchQuery(options.query).query;
  const mode = boundedMode(options.mode);
  const limit = boundedLimit(options.limit, 100);
  const candidateLimit = boundedCandidateLimit(options.candidateLimit, limit);
  const minScore = boundedScore(options.minScore);
  const session = await openSemanticSearchSession(
    {
      root: options.root,
      ...(options.database === undefined ? {} : { database: options.database }),
    },
    dependencies,
  );
  try {
    return await session.search({
      query,
      mode,
      limit,
      candidateLimit,
      minScore,
    });
  } finally {
    await session.close();
  }
}
