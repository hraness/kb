import { createHash } from "node:crypto";

import {
  validateEvaluationEvidenceRegistry,
  type EvaluationEvidenceRegistry,
} from "./evaluation-evidence.js";
import {
  assertVerifiedKnowledgeBaseEvaluationV2,
  type KnowledgeBaseEvaluationV2,
} from "./evaluation-kb-v2.js";
import type {
  EvaluationPackingContractV2,
  KnowledgeBaseEvaluationFourReaderBatchV2,
  KnowledgeBaseEvaluationRunnerV2Dependencies,
} from "./evaluation-kb-runner-v2.js";
import {
  packKnowledgeBaseEvaluationContextV2,
  type EvaluationReaderTokenizerV2,
} from "./evaluation-packing-v2.js";
import {
  assertEvaluationRetrieverLockedV2,
  parseRetrievalEvaluationCorpusV2,
  type EvaluationMeasurementProfileV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

const MAX_CACHE_PREPARATION_BYTES = 64 * 1_024;
const MAX_CACHE_DEFINITION_BYTES = 1 * 1_024 * 1_024;
const cacheVerifierBrand: unique symbol = Symbol("knowledge-base-evaluation-cache-verifier-v2");
const cacheVerifierRegistration = new WeakMap<object, string>();
const fourReaderOpenerBrand: unique symbol = Symbol("knowledge-base-evaluation-four-reader-opener-v2");
const fourReaderOpenerRegistration = new WeakMap<object, string>();

export type KnowledgeBaseEvaluationCacheVerifierV2 = Readonly<{
  readonly preparation: string;
  readonly definitionSha256: string;
  readonly verify: (signal: AbortSignal) => string | Promise<string>;
  readonly [cacheVerifierBrand]: true;
}>;

export type OpenFreshKnowledgeBaseEvaluationV2 = (
  input: Readonly<{
    readonly suiteSha256: string;
    readonly batchIdentity: RetrievalEvaluationCorpusV2["experiment"]["environment"]["fourReaderBatch"];
    readonly profileId: string;
    readonly repetition: number;
    readonly readerIndex: 0 | 1 | 2 | 3;
    readonly signal: AbortSignal;
  }>,
) => Promise<KnowledgeBaseEvaluationV2>;

export type KnowledgeBaseEvaluationFourReaderOpenerV2 = Readonly<{
  readonly id: string;
  readonly definitionSha256: string;
  readonly open: OpenFreshKnowledgeBaseEvaluationV2;
  readonly [fourReaderOpenerBrand]: true;
}>;

export type CreateKnowledgeBaseEvaluationRunnerV2DependenciesOptions = Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly evidenceRegistry: EvaluationEvidenceRegistry;
  readonly tokenizer: EvaluationReaderTokenizerV2;
  readonly measureRetrieverOperation: KnowledgeBaseEvaluationRunnerV2Dependencies["measureRetrieverOperation"];
  readonly fourReaderOpener: KnowledgeBaseEvaluationFourReaderOpenerV2;
  readonly cacheVerifier: KnowledgeBaseEvaluationCacheVerifierV2;
  readonly now?: () => number;
}>;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function cacheRegistrationKey(preparation: string, definitionSha256: string): string {
  return JSON.stringify([preparation, definitionSha256]);
}

function fourReaderOpenerRegistrationKey(id: string, definitionSha256: string): string {
  return JSON.stringify([id, definitionSha256]);
}

function boundedDefinition(value: string, label: string, maximumBytes: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || Buffer.byteLength(value, "utf8") > maximumBytes
  ) throw new TypeError(`${label} must be non-empty, NUL-free, and bounded.`);
  return value;
}

/** Register an immutable live verifier for one exact cache preparation and definition. */
export function createKnowledgeBaseEvaluationCacheVerifierV2(options: Readonly<{
  readonly preparation: string;
  readonly definition: string;
  readonly verify: KnowledgeBaseEvaluationCacheVerifierV2["verify"];
}>): KnowledgeBaseEvaluationCacheVerifierV2 {
  const preparation = boundedDefinition(
    options.preparation,
    "Cache verifier preparation",
    MAX_CACHE_PREPARATION_BYTES,
  );
  const definition = boundedDefinition(
    options.definition,
    "Cache verifier definition",
    MAX_CACHE_DEFINITION_BYTES,
  );
  if (typeof options.verify !== "function") {
    throw new TypeError("Cache verifier verify must be a function.");
  }
  const verifier: KnowledgeBaseEvaluationCacheVerifierV2 = {
    preparation,
    definitionSha256: sha256(definition),
    verify: options.verify,
    [cacheVerifierBrand]: true,
  };
  Object.defineProperty(verifier, cacheVerifierBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  Object.freeze(verifier);
  cacheVerifierRegistration.set(
    verifier,
    cacheRegistrationKey(verifier.preparation, verifier.definitionSha256),
  );
  return verifier;
}

/** Register one immutable four-reader opener under its exact implementation definition. */
export function createKnowledgeBaseEvaluationFourReaderOpenerV2(options: Readonly<{
  readonly id: string;
  readonly definition: string;
  readonly open: OpenFreshKnowledgeBaseEvaluationV2;
}>): KnowledgeBaseEvaluationFourReaderOpenerV2 {
  const id = boundedDefinition(options.id, "Four-reader opener id", 512);
  if (/\r|\n/u.test(id) || id.normalize("NFC") !== id || id.trim() !== id) {
    throw new TypeError("Four-reader opener id must be a trimmed NFC single line.");
  }
  const definition = boundedDefinition(
    options.definition,
    "Four-reader opener definition",
    MAX_CACHE_DEFINITION_BYTES,
  );
  if (typeof options.open !== "function") {
    throw new TypeError("Four-reader opener open must be a function.");
  }
  const opener: KnowledgeBaseEvaluationFourReaderOpenerV2 = {
    id,
    definitionSha256: sha256(definition),
    open: options.open,
    [fourReaderOpenerBrand]: true,
  };
  Object.defineProperty(opener, fourReaderOpenerBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  Object.freeze(opener);
  fourReaderOpenerRegistration.set(
    opener,
    fourReaderOpenerRegistrationKey(opener.id, opener.definitionSha256),
  );
  return opener;
}

function assertRegisteredCacheVerifier(
  verifier: KnowledgeBaseEvaluationCacheVerifierV2,
  corpus: RetrievalEvaluationCorpusV2,
): void {
  if (
    verifier === null
    || typeof verifier !== "object"
    || verifier[cacheVerifierBrand] !== true
    || cacheVerifierRegistration.get(verifier)
      !== cacheRegistrationKey(verifier.preparation, verifier.definitionSha256)
  ) throw new TypeError("Evaluation cache verifier is not a registered capability.");
  const sealed = corpus.experiment.environment.cache;
  if (
    verifier.preparation !== sealed.preparation
    || verifier.definitionSha256 !== sealed.fingerprintSha256
  ) {
    throw new TypeError(
      "Evaluation cache verifier does not match the sealed preparation and definition digest.",
    );
  }
}

function assertRegisteredFourReaderOpener(
  opener: KnowledgeBaseEvaluationFourReaderOpenerV2,
  corpus: RetrievalEvaluationCorpusV2,
): void {
  if (
    opener === null
    || typeof opener !== "object"
    || opener[fourReaderOpenerBrand] !== true
    || fourReaderOpenerRegistration.get(opener)
      !== fourReaderOpenerRegistrationKey(opener.id, opener.definitionSha256)
  ) throw new TypeError("Evaluation four-reader opener is not a registered capability.");
  const sealed = corpus.experiment.environment.fourReaderBatch;
  if (opener.id !== sealed.id || opener.definitionSha256 !== sealed.sha256) {
    throw new TypeError("Evaluation four-reader opener does not match the sealed batch identity and definition digest.");
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("Evaluation execution was aborted.");
}

function finiteDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("Evaluation packing duration must be non-negative and finite.");
  }
  return value;
}

function profileFor(
  corpus: RetrievalEvaluationCorpusV2,
  profileId: string,
): EvaluationMeasurementProfileV2 {
  const profile = corpus.measurementProfiles.find(({ id }) => id === profileId);
  if (profile === undefined) throw new TypeError(`Evaluation profile ${profileId} is not sealed by the corpus.`);
  return profile;
}

function assertRepetition(profile: EvaluationMeasurementProfileV2, repetition: number): void {
  if (!Number.isSafeInteger(repetition) || repetition < 1 || repetition > profile.repetitions) {
    throw new TypeError(`Evaluation repetition is outside profile ${profile.id}.`);
  }
}

function assertPackingContract(
  contract: EvaluationPackingContractV2,
  corpus: RetrievalEvaluationCorpusV2,
): void {
  const sealed = corpus.experiment;
  if (
    contract.suiteSha256 !== corpus.manifest.corpusSha256
    || contract.tokenizer.id !== sealed.environment.tokenizer.id
    || contract.tokenizer.sha256 !== sealed.environment.tokenizer.sha256
    || contract.contextCeilings.utf8Bytes !== sealed.protocol.contextCeilings.utf8Bytes
    || contract.contextCeilings.readerTokens !== sealed.protocol.contextCeilings.readerTokens
  ) throw new TypeError("Packing request does not match the sealed corpus contract.");
}

async function closePartialEvaluations(
  evaluations: readonly KnowledgeBaseEvaluationV2[],
  openingFailure: unknown,
): Promise<never> {
  const settlements = await Promise.allSettled(evaluations.map((evaluation) =>
    Promise.resolve().then(() => Reflect.apply(evaluation.close, evaluation, []))));
  const closeFailures: unknown[] = [];
  for (const result of settlements) {
    if (result.status === "rejected") closeFailures.push(result.reason as unknown);
  }
  if (closeFailures.length > 0) {
    throw new AggregateError(
      [openingFailure, ...closeFailures],
      "Four-reader evaluation opening failed and partial sessions did not close cleanly.",
      { cause: openingFailure },
    );
  }
  throw openingFailure;
}

/** Bind the complete runner dependency surface to one sealed corpus and live capabilities. */
export function createKnowledgeBaseEvaluationRunnerV2Dependencies(
  options: CreateKnowledgeBaseEvaluationRunnerV2DependenciesOptions,
): KnowledgeBaseEvaluationRunnerV2Dependencies {
  const corpus = parseRetrievalEvaluationCorpusV2(options.corpus, { claimPromotion: false });
  validateEvaluationEvidenceRegistry(options.evidenceRegistry);
  if (typeof options.measureRetrieverOperation !== "function") {
    throw new TypeError("Evaluation retriever operation measurer must be a function.");
  }
  if (
    options.tokenizer === null
    || typeof options.tokenizer !== "object"
    || options.tokenizer.id !== corpus.experiment.environment.tokenizer.id
    || options.tokenizer.sha256 !== corpus.experiment.environment.tokenizer.sha256
  ) throw new TypeError("Evaluation tokenizer does not match the sealed corpus.");
  assertRegisteredCacheVerifier(options.cacheVerifier, corpus);
  assertRegisteredFourReaderOpener(options.fourReaderOpener, corpus);
  const now = options.now ?? performance.now.bind(performance);
  if (typeof now !== "function") throw new TypeError("Evaluation clock must be a function.");
  const openedEvaluationSessions = new WeakSet<object>();
  const verifyCapability = options.cacheVerifier.verify;
  const fourReaderOpenCapability = options.fourReaderOpener.open;
  const sealedCacheDigest = corpus.experiment.environment.cache.fingerprintSha256;

  const verifyCacheFingerprint = async (signal: AbortSignal): Promise<string> => {
    throwIfAborted(signal);
    assertRegisteredCacheVerifier(options.cacheVerifier, corpus);
    const observed = await verifyCapability(signal);
    throwIfAborted(signal);
    if (observed !== sealedCacheDigest) {
      throw new TypeError("Live evaluation cache fingerprint drifted from the sealed definition digest.");
    }
    return observed;
  };

  const measureRetrieverOperation: KnowledgeBaseEvaluationRunnerV2Dependencies["measureRetrieverOperation"] =
    async (input) => {
      throwIfAborted(input.signal);
      if (input.corpus.manifest.corpusSha256 !== corpus.manifest.corpusSha256) {
        throw new TypeError("Retriever operation measurement does not match the bound sealed corpus.");
      }
      assertEvaluationRetrieverLockedV2(corpus, input.descriptor);
      const profile = profileFor(corpus, input.profile.id);
      if (
        profile.operation !== input.operation
        || JSON.stringify(profile) !== JSON.stringify(input.profile)
      ) throw new TypeError("Retriever operation measurement profile does not match the sealed corpus.");
      assertRepetition(profile, input.repetition);
      return options.measureRetrieverOperation(Object.freeze({
        ...input,
        corpus,
        profile,
      }));
    };

  const pack: KnowledgeBaseEvaluationRunnerV2Dependencies["pack"] = async (input) => {
    throwIfAborted(input.signal);
    assertPackingContract(input.contract, corpus);
    assertEvaluationRetrieverLockedV2(corpus, input.descriptor);
    if (input.result.retrieverId !== input.descriptor.id) {
      throw new TypeError("Packing result does not match its sealed retriever descriptor.");
    }
    const profile = profileFor(corpus, input.profileId);
    if (profile.operation !== "packing") {
      throw new TypeError(`Evaluation profile ${profile.id} is not a packing profile.`);
    }
    assertRepetition(profile, input.repetition);
    if (!corpus.queries.some(({ id }) => id === input.queryId)) {
      throw new TypeError(`Evaluation query ${input.queryId} is not sealed by the corpus.`);
    }
    const startedAt = now();
    const packed = await packKnowledgeBaseEvaluationContextV2({
      corpus,
      result: input.result,
      evidenceRegistry: options.evidenceRegistry,
      tokenizer: options.tokenizer,
    });
    throwIfAborted(input.signal);
    const packedBytes = Buffer.from(packed.text, "utf8");
    if (
      packedBytes.byteLength !== packed.utf8Bytes
      || createHash("sha256").update(packedBytes).digest("hex") !== packed.packedBytesSha256
    ) throw new TypeError("Packed-context accounting does not match its exact returned bytes.");
    return Object.freeze({
      durationMs: finiteDuration(now() - startedAt),
      packedContext: Object.freeze({
        utf8Bytes: packed.utf8Bytes,
        readerTokens: packed.readerTokens,
      }),
      includedEvidenceUnitIds: packed.includedEvidenceUnitIds,
      truncated: packed.truncated,
      packedBytesSha256: packed.packedBytesSha256,
    });
  };

  const openFourReaderBatch: KnowledgeBaseEvaluationRunnerV2Dependencies["openFourReaderBatch"] =
    async (input): Promise<KnowledgeBaseEvaluationFourReaderBatchV2> => {
      throwIfAborted(input.signal);
      const profile = profileFor(corpus, input.profileId);
      if (profile.operation !== "four-reader-query" || profile.concurrency !== 4) {
        throw new TypeError(`Evaluation profile ${profile.id} is not a four-reader profile.`);
      }
      assertRepetition(profile, input.repetition);
      const evaluations: KnowledgeBaseEvaluationV2[] = [];
      const currentSessions = new Set<KnowledgeBaseEvaluationV2>();
      try {
        for (let readerIndex = 0; readerIndex < 4; readerIndex += 1) {
          throwIfAborted(input.signal);
          assertRegisteredFourReaderOpener(options.fourReaderOpener, corpus);
          const evaluation = await fourReaderOpenCapability(Object.freeze({
            suiteSha256: corpus.manifest.corpusSha256,
            batchIdentity: corpus.experiment.environment.fourReaderBatch,
            profileId: profile.id,
            repetition: input.repetition,
            readerIndex: readerIndex as 0 | 1 | 2 | 3,
            signal: input.signal,
          }));
          if (currentSessions.has(evaluation) || openedEvaluationSessions.has(evaluation)) {
            throw new TypeError("Four-reader evaluation opener returned a duplicate or reused session.");
          }
          // Ownership transfers when the opener returns. Record it before any
          // brand or shape assertion so a malformed session is still closed.
          evaluations.push(evaluation);
          currentSessions.add(evaluation);
          openedEvaluationSessions.add(evaluation);
          assertVerifiedKnowledgeBaseEvaluationV2(evaluation, corpus);
        }
        throwIfAborted(input.signal);
      } catch (error) {
        return closePartialEvaluations(evaluations, error);
      }
      return Object.freeze({
        id: options.fourReaderOpener.id,
        sha256: options.fourReaderOpener.definitionSha256,
        evaluations: Object.freeze(evaluations),
        verifyCacheFingerprint,
      });
    };

  const verifyWarmCacheFingerprint: KnowledgeBaseEvaluationRunnerV2Dependencies["verifyWarmCacheFingerprint"] =
    async (input) => {
      const profile = profileFor(corpus, input.profileId);
      if (profile.operation !== input.operation) {
        throw new TypeError("Warm cache verification profile does not match the sealed operation.");
      }
      assertRepetition(profile, input.repetition);
      if (input.phase !== "before" && input.phase !== "after") {
        throw new TypeError("Warm cache verification phase is invalid.");
      }
      return verifyCacheFingerprint(input.signal);
    };

  return Object.freeze({
    measureRetrieverOperation,
    pack,
    openFourReaderBatch,
    verifyWarmCacheFingerprint,
    ...(options.now === undefined ? {} : { now }),
  });
}
