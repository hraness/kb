import {
  assertVerifiedKnowledgeBaseEvaluationV2,
  createKnowledgeBaseEvaluationRepeatedSampleV2,
  type KnowledgeBaseEvaluationRetrieverResultV2,
  type KnowledgeBaseEvaluationRetrieverV2,
  type KnowledgeBaseEvaluationV2,
} from "./evaluation-kb-v2.js";
import {
  createEvaluationExecutionRequestV2,
  parseRetrievalEvaluationCorpusV2,
  parseRetrievalEvaluationReportV2,
  validatePromotionCorpusV2,
  type EvaluationExternalCorpusSealV2,
  type EvaluationMeasurementProfileV2,
  type EvaluationQueryV2,
  type EvaluationRepeatedSampleV2,
  type EvaluationResourceAccountingV2,
  type EvaluationRetrieverDescriptorV2,
  type EvaluationRetrieverTraceV2,
  type RetrievalEvaluationCorpusV2,
  type RetrievalEvaluationReportV2,
} from "./evaluation-v2.js";

export const KNOWLEDGE_BASE_EVALUATION_MAX_SAMPLE_TIMEOUT_MS = 5 * 60_000;
const MAX_ABORT_SETTLEMENT_MS = 5_000;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export type EvaluationRetrieverOperationMeasurementV2 = Readonly<{
  readonly status: EvaluationRepeatedSampleV2["status"];
  readonly timings: EvaluationRepeatedSampleV2["timings"];
  readonly resources: EvaluationResourceAccountingV2;
  readonly trace: EvaluationRetrieverTraceV2;
  readonly failure?: EvaluationRepeatedSampleV2["failure"];
}>;

export type EvaluationPackingMeasurementV2 = Readonly<{
  readonly durationMs: number;
  readonly packedContext: EvaluationResourceAccountingV2["packedContext"];
  readonly includedEvidenceUnitIds: readonly string[];
  readonly truncated: boolean;
  readonly packedBytesSha256: string;
}>;

export type EvaluationPackingContractV2 = Readonly<{
  readonly suiteSha256: string;
  readonly tokenizer: RetrievalEvaluationCorpusV2["experiment"]["environment"]["tokenizer"];
  readonly contextCeilings: RetrievalEvaluationCorpusV2["experiment"]["protocol"]["contextCeilings"];
}>;

export type KnowledgeBaseEvaluationFourReaderBatchV2 = Readonly<{
  readonly id: string;
  readonly sha256: string;
  readonly evaluations: readonly KnowledgeBaseEvaluationV2[];
  readonly verifyCacheFingerprint: (signal: AbortSignal) => Promise<string>;
}>;

export type KnowledgeBaseEvaluationRunnerV2Dependencies = Readonly<{
  readonly measureRetrieverOperation: (input: Readonly<{
    readonly operation: "cold-index" | "incremental-update";
    readonly corpus: RetrievalEvaluationCorpusV2;
    readonly descriptor: EvaluationRetrieverDescriptorV2;
    readonly profile: EvaluationMeasurementProfileV2;
    readonly repetition: number;
    readonly signal: AbortSignal;
  }>) => Promise<EvaluationRetrieverOperationMeasurementV2>;
  readonly pack: (input: Readonly<{
    readonly contract: EvaluationPackingContractV2;
    readonly descriptor: EvaluationRetrieverDescriptorV2;
    readonly profileId: string;
    readonly queryId: string;
    readonly result: KnowledgeBaseEvaluationRetrieverResultV2;
    readonly repetition: number;
    readonly signal: AbortSignal;
  }>) => Promise<EvaluationPackingMeasurementV2>;
  readonly openFourReaderBatch: (input: Readonly<{
    readonly profileId: string;
    readonly repetition: number;
    readonly signal: AbortSignal;
  }>) => Promise<KnowledgeBaseEvaluationFourReaderBatchV2>;
  readonly verifyWarmCacheFingerprint: (input: Readonly<{
    readonly profileId: string;
    readonly operation: "packing" | "warm-query";
    readonly repetition: number;
    readonly phase: "before" | "after";
    readonly signal: AbortSignal;
  }>) => Promise<string>;
  readonly now?: () => number;
}>;

export type RunKnowledgeBaseEvaluationV2Options = Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly evaluation: KnowledgeBaseEvaluationV2;
  readonly split: "all" | "development" | "test";
  /** Required for every run that exposes held-out test observations. */
  readonly promotionSeal?: EvaluationExternalCorpusSealV2;
  readonly timeoutMs: number;
  readonly dependencies: KnowledgeBaseEvaluationRunnerV2Dependencies;
}>;

function nonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be non-negative and finite.`);
  return value;
}

function timeout(value: number): number {
  if (
    !Number.isSafeInteger(value)
    || value < 1
    || value > KNOWLEDGE_BASE_EVALUATION_MAX_SAMPLE_TIMEOUT_MS
  ) {
    throw new TypeError(
      `timeoutMs must be an integer from 1 through ${KNOWLEDGE_BASE_EVALUATION_MAX_SAMPLE_TIMEOUT_MS}.`,
    );
  }
  return value;
}

function message(error: unknown): string {
  const source = error instanceof Error ? error.message : String(error);
  const normalized = source.replace(/[\0\r\n]+/gu, " ").trim() || "Unknown evaluation failure.";
  return Buffer.from(normalized, "utf8").subarray(0, 2_000).toString("utf8");
}

function limit(descriptor: EvaluationRetrieverDescriptorV2): number {
  const value = descriptor.configuration["retrieve-limit"]
    ?? descriptor.configuration["output-limit"]
    ?? descriptor.configuration.limit;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new TypeError(`Retriever ${descriptor.id} must declare a bounded retrieval limit.`);
  }
  return value as number;
}

function emptyTrace(descriptor: EvaluationRetrieverDescriptorV2): EvaluationRetrieverTraceV2 {
  return Object.freeze({
    laneOutcomes: Object.freeze(descriptor.lanes.toSorted().map((laneId) => Object.freeze({
      laneId,
      applicability: "skipped" as const,
      status: "unavailable" as const,
      reasonCodes: Object.freeze(["measurement-failed"]),
      rawRanking: Object.freeze([]),
    }))),
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

async function bounded<T>(options: Readonly<{
  readonly timeoutMs: number;
  readonly now: () => number;
  readonly operation: (signal: AbortSignal) => Promise<T>;
  readonly disposeTimedOutValue?: (value: T) => Promise<void>;
}>): Promise<Readonly<{ readonly status: "ok"; readonly value: T; readonly elapsedMs: number }>
  | Readonly<{
    readonly status: "failed";
    readonly failure: NonNullable<EvaluationRepeatedSampleV2["failure"]>;
    readonly elapsedMs: number;
  }>> {
  const controller = new AbortController();
  const startedAt = options.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const running = Promise.resolve().then(() => options.operation(controller.signal));
  void running.catch(() => undefined);
  const timeoutFailure = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const timeoutError = new Error(`Evaluation sample exceeded ${options.timeoutMs} ms.`);
      controller.abort(timeoutError);
      reject(timeoutError);
    }, options.timeoutMs);
  });
  try {
    const value = await Promise.race([running, timeoutFailure]);
    return Object.freeze({
      status: "ok",
      value,
      elapsedMs: nonnegative(options.now() - startedAt, "elapsedMs"),
    });
  } catch (error) {
    if (timedOut) {
      let settlementTimer: ReturnType<typeof setTimeout> | undefined;
      const settled = await Promise.race([
        running.then(async (value) => {
          await options.disposeTimedOutValue?.(value);
          return true as const;
        }, () => true as const),
        new Promise<false>((resolve) => {
          settlementTimer = setTimeout(() => resolve(false), MAX_ABORT_SETTLEMENT_MS);
        }),
      ]);
      if (settlementTimer !== undefined) clearTimeout(settlementTimer);
      if (!settled) {
        throw new Error(
          `Evaluation operation did not settle within ${MAX_ABORT_SETTLEMENT_MS} ms after abort.`,
          { cause: error },
        );
      }
    }
    return Object.freeze({
      status: "failed",
      failure: Object.freeze({
        kind: timedOut ? "timeout" as const : "exception" as const,
        message: message(error),
      }),
      elapsedMs: nonnegative(options.now() - startedAt, "elapsedMs"),
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function failedSample(options: Readonly<{
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly profile: EvaluationMeasurementProfileV2;
  readonly repetition: number;
  readonly elapsedMs: number;
  readonly failure: NonNullable<EvaluationRepeatedSampleV2["failure"]>;
  readonly queryId?: string;
  readonly concurrencyBatchIdentity?: string;
}>): EvaluationRepeatedSampleV2 {
  return Object.freeze({
    retrieverId: options.descriptor.id,
    profileId: options.profile.id,
    ...(options.queryId === undefined ? {} : { queryId: options.queryId }),
    repetition: options.repetition,
    ...(options.concurrencyBatchIdentity === undefined
      ? {}
      : { concurrencyBatchIdentity: options.concurrencyBatchIdentity }),
    status: "failed",
    timings: Object.freeze({
      elapsedMs: options.elapsedMs,
      indexMs: 0,
      updateMs: 0,
      queryMs: options.profile.scope === "query" ? options.elapsedMs : 0,
      packingMs: 0,
    }),
    resources: zeroResources(),
    trace: emptyTrace(options.descriptor),
    rawEvidence: Object.freeze([]),
    failure: options.failure,
  });
}

function validateProfiles(corpus: RetrievalEvaluationCorpusV2): void {
  for (const profile of corpus.measurementProfiles) {
    const retrieverScope = profile.operation === "cold-index" || profile.operation === "incremental-update";
    if ((profile.scope === "retriever") !== retrieverScope) {
      throw new TypeError(`Profile ${profile.id} has the wrong scope for ${profile.operation}.`);
    }
    const expectedConcurrency = profile.operation === "four-reader-query" ? 4 : 1;
    if (profile.concurrency !== expectedConcurrency) {
      throw new TypeError(`Profile ${profile.id} must declare concurrency ${expectedConcurrency}.`);
    }
  }
}

function packingContract(corpus: RetrievalEvaluationCorpusV2): EvaluationPackingContractV2 {
  return Object.freeze({
    suiteSha256: corpus.manifest.corpusSha256,
    tokenizer: corpus.experiment.environment.tokenizer,
    contextCeilings: corpus.experiment.protocol.contextCeilings,
  });
}

function compareSamples(left: EvaluationRepeatedSampleV2, right: EvaluationRepeatedSampleV2): number {
  return left.retrieverId.localeCompare(right.retrieverId)
    || left.profileId.localeCompare(right.profileId)
    || (left.queryId ?? "").localeCompare(right.queryId ?? "")
    || left.repetition - right.repetition;
}

function retrieversById(
  evaluation: KnowledgeBaseEvaluationV2,
  corpus: RetrievalEvaluationCorpusV2,
): ReadonlyMap<string, KnowledgeBaseEvaluationRetrieverV2> {
  assertVerifiedKnowledgeBaseEvaluationV2(evaluation, corpus);
  const output = new Map(evaluation.retrievers.map((retriever) => [
    retriever.descriptor.id,
    retriever,
  ]));
  if (
    output.size !== evaluation.retrievers.length
    || output.size !== corpus.retrievers.length
    || corpus.retrievers.some(({ id }) => !output.has(id))
  ) throw new TypeError("Evaluation retrievers must match the sealed descriptor set exactly.");
  return output;
}

async function assertWarmCacheFingerprint(options: Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly dependencies: KnowledgeBaseEvaluationRunnerV2Dependencies;
  readonly profile: EvaluationMeasurementProfileV2;
  readonly repetition: number;
  readonly phase: "before" | "after";
  readonly timeoutMs: number;
}>): Promise<void> {
  if (options.profile.operation !== "packing" && options.profile.operation !== "warm-query") {
    throw new TypeError(`Profile ${options.profile.id} is not a primary warm-cache operation.`);
  }
  const measured = await bounded({
    timeoutMs: options.timeoutMs,
    now: options.dependencies.now ?? performance.now.bind(performance),
    operation: (signal) => options.dependencies.verifyWarmCacheFingerprint({
      profileId: options.profile.id,
      operation: options.profile.operation as "packing" | "warm-query",
      repetition: options.repetition,
      phase: options.phase,
      signal,
    }),
  });
  if (measured.status === "failed") {
    throw new Error(
      `Warm cache fingerprint verification failed ${options.phase} ${options.profile.id}: ${measured.failure.message}`,
    );
  }
  if (measured.value !== options.corpus.experiment.environment.cache.fingerprintSha256) {
    throw new TypeError(
      `Warm cache fingerprint drifted ${options.phase} profile ${options.profile.id}.`,
    );
  }
}

function validateFourReaderBatch(
  batch: KnowledgeBaseEvaluationFourReaderBatchV2,
  corpus: RetrievalEvaluationCorpusV2,
): readonly ReadonlyMap<string, KnowledgeBaseEvaluationRetrieverV2>[] {
  const sealed = corpus.experiment.environment.fourReaderBatch;
  const candidateEvaluations: unknown = batch.evaluations;
  if (batch.id !== sealed.id || batch.sha256 !== sealed.sha256) {
    throw new TypeError("Four-reader batch implementation does not match the sealed identity.");
  }
  if (
    !Array.isArray(candidateEvaluations)
    || batch.evaluations.length !== 4
    || new Set(batch.evaluations).size !== 4
  ) throw new TypeError("Four-reader measurement requires four distinct verified evaluations.");
  if (typeof batch.verifyCacheFingerprint !== "function") {
    throw new TypeError("Four-reader batch must expose cache fingerprint verification.");
  }
  return Object.freeze(batch.evaluations.map((evaluation) => retrieversById(evaluation, corpus)));
}

async function assertFourReaderCacheFingerprint(options: Readonly<{
  readonly batch: KnowledgeBaseEvaluationFourReaderBatchV2;
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly timeoutMs: number;
  readonly now: () => number;
  readonly phase: "before" | "after";
}>): Promise<void> {
  const measured = await bounded({
    timeoutMs: options.timeoutMs,
    now: options.now,
    operation: options.batch.verifyCacheFingerprint,
  });
  if (measured.status === "failed") {
    throw new Error(
      `Four-reader cache verification failed ${options.phase}: ${measured.failure.message}`,
    );
  }
  if (measured.value !== options.corpus.experiment.environment.cache.fingerprintSha256) {
    throw new TypeError(`Four-reader cache fingerprint drifted ${options.phase} measurement.`);
  }
}

async function closeFourReaderBatch(batch: KnowledgeBaseEvaluationFourReaderBatchV2): Promise<void> {
  const evaluations: readonly unknown[] = Array.isArray(batch?.evaluations) ? batch.evaluations : [];
  const closers = evaluations.flatMap((evaluation) => {
    if (evaluation === null || typeof evaluation !== "object") return [];
    const candidate: { readonly close?: unknown } = evaluation;
    if (typeof candidate.close !== "function") return [];
    const closeable = candidate as { readonly close: () => unknown };
    return [async (): Promise<void> => {
      await closeable.close();
    }];
  });
  const settlements = await Promise.allSettled(closers.map((close) => Promise.resolve().then(close)));
  const failures = settlements.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure): unknown => {
        const reason: unknown = failure.reason;
        return reason;
      }),
      "Four-reader evaluation sessions did not close cleanly.",
    );
  }
}

async function simultaneousQuerySamples(options: Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly profile: EvaluationMeasurementProfileV2;
  readonly queries: readonly EvaluationQueryV2[];
  readonly retrievers: readonly KnowledgeBaseEvaluationRetrieverV2[];
  readonly repetition: number;
  readonly timeoutMs: number;
  readonly dependencies: KnowledgeBaseEvaluationRunnerV2Dependencies;
}>): Promise<readonly EvaluationRepeatedSampleV2[]> {
  if (options.queries.length !== 4 || options.retrievers.length !== 4) {
    throw new TypeError("Four-reader query batches must contain exactly four queries and readers.");
  }
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = options.queries.map(async (query, index) => {
    await barrier;
    const retriever = options.retrievers[index];
    if (retriever === undefined) throw new TypeError("Four-reader batch lost a reader.");
    return querySample({
      corpus: options.corpus,
      descriptor: options.descriptor,
      profile: options.profile,
      query,
      repetition: options.repetition,
      retriever,
      timeoutMs: options.timeoutMs,
      dependencies: options.dependencies,
    });
  });
  release?.();
  return Object.freeze(await Promise.all(pending));
}

async function querySample(options: Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly profile: EvaluationMeasurementProfileV2;
  readonly query: EvaluationQueryV2;
  readonly repetition: number;
  readonly retriever: KnowledgeBaseEvaluationRetrieverV2;
  readonly timeoutMs: number;
  readonly dependencies: KnowledgeBaseEvaluationRunnerV2Dependencies;
}>): Promise<EvaluationRepeatedSampleV2> {
  const concurrencyBatchIdentity = options.profile.operation === "four-reader-query"
    ? options.corpus.experiment.environment.fourReaderBatch.id
    : undefined;
  const measured = await bounded({
    timeoutMs: options.timeoutMs,
    now: options.dependencies.now ?? performance.now.bind(performance),
    operation: async (signal) => {
      const now = options.dependencies.now ?? performance.now.bind(performance);
      const queryStartedAt = now();
      const result = await options.retriever.retrieve(createEvaluationExecutionRequestV2({
        corpus: options.corpus,
        query: options.query,
        descriptor: options.descriptor,
        limit: limit(options.descriptor),
        signal,
      }));
      const queryElapsedMs = nonnegative(now() - queryStartedAt, "query elapsedMs");
      if (options.profile.operation !== "packing") {
        return { result, queryElapsedMs, packingElapsedMs: 0 } as const;
      }
      if (result.status === "unavailable") {
        return {
          result,
          queryElapsedMs,
          packingElapsedMs: 0,
          packing: Object.freeze({
            durationMs: 0,
            packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
            includedEvidenceUnitIds: Object.freeze([]),
            truncated: false,
            packedBytesSha256: EMPTY_SHA256,
          }),
        } as const;
      }
      const packingStartedAt = now();
      const packing = await options.dependencies.pack({
        contract: packingContract(options.corpus),
        descriptor: options.descriptor,
        profileId: options.profile.id,
        queryId: options.query.id,
        result,
        repetition: options.repetition,
        signal,
      });
      const packingElapsedMs = nonnegative(now() - packingStartedAt, "packing elapsedMs");
      return { result, packing, queryElapsedMs, packingElapsedMs } as const;
    },
  });
  if (measured.status === "failed") {
    return failedSample({
      descriptor: options.descriptor,
      profile: options.profile,
      queryId: options.query.id,
      repetition: options.repetition,
      elapsedMs: measured.elapsedMs,
      failure: measured.failure,
      ...(concurrencyBatchIdentity === undefined ? {} : { concurrencyBatchIdentity }),
    });
  }
  const { result, packing, queryElapsedMs, packingElapsedMs } = measured.value;
  return createKnowledgeBaseEvaluationRepeatedSampleV2({
    result,
    profileId: options.profile.id,
    queryId: options.query.id,
    repetition: options.repetition,
    timings: {
      elapsedMs: measured.elapsedMs,
      queryMs: queryElapsedMs,
      packingMs: packingElapsedMs,
    },
    ...(concurrencyBatchIdentity === undefined ? {} : { concurrencyBatchIdentity }),
    ...(packing === undefined
      ? {}
      : {
          packedContext: packing.packedContext,
          packedContextTrace: {
            evidenceUnitIds: packing.includedEvidenceUnitIds,
            truncated: packing.truncated,
            packedBytesSha256: packing.packedBytesSha256,
          },
        }),
  });
}

async function retrieverSample(options: Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly profile: EvaluationMeasurementProfileV2;
  readonly repetition: number;
  readonly timeoutMs: number;
  readonly dependencies: KnowledgeBaseEvaluationRunnerV2Dependencies;
}>): Promise<EvaluationRepeatedSampleV2> {
  if (options.profile.operation !== "cold-index" && options.profile.operation !== "incremental-update") {
    throw new TypeError(`Retriever-scope profile ${options.profile.id} has an unsupported operation.`);
  }
  const measured = await bounded({
    timeoutMs: options.timeoutMs,
    now: options.dependencies.now ?? performance.now.bind(performance),
    operation: (signal) => options.dependencies.measureRetrieverOperation({
      operation: options.profile.operation as "cold-index" | "incremental-update",
      corpus: options.corpus,
      descriptor: options.descriptor,
      profile: options.profile,
      repetition: options.repetition,
      signal,
    }),
  });
  if (measured.status === "failed") {
    return failedSample({
      descriptor: options.descriptor,
      profile: options.profile,
      repetition: options.repetition,
      elapsedMs: measured.elapsedMs,
      failure: measured.failure,
    });
  }
  const sample = measured.value;
  return Object.freeze({
    retrieverId: options.descriptor.id,
    profileId: options.profile.id,
    repetition: options.repetition,
    status: sample.status,
    timings: sample.timings,
    resources: sample.resources,
    trace: sample.trace,
    rawEvidence: Object.freeze([]),
    ...(sample.failure === undefined ? {} : { failure: sample.failure }),
  });
}

/** Run the complete sealed sample matrix and validate its canonical report before returning. */
export async function runKnowledgeBaseEvaluationV2(
  options: RunKnowledgeBaseEvaluationV2Options,
): Promise<RetrievalEvaluationReportV2> {
  const timeoutMs = timeout(options.timeoutMs);
  const corpus = options.split === "development"
    ? parseRetrievalEvaluationCorpusV2(options.corpus, { claimPromotion: false })
    : options.promotionSeal === undefined
      ? (() => {
          throw new TypeError("Held-out or all-split evaluation requires the independent promotion seal.");
        })()
      : validatePromotionCorpusV2(options.corpus, options.promotionSeal);
  const now = options.dependencies.now ?? performance.now.bind(performance);
  validateProfiles(corpus);
  const queries = corpus.queries
    .filter(({ split }) => options.split === "all" || split === options.split)
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const retrieverById = retrieversById(options.evaluation, corpus);
  const descriptors = corpus.retrievers.toSorted((left, right) => left.id.localeCompare(right.id));

  const samples: EvaluationRepeatedSampleV2[] = [];
  for (const profile of corpus.measurementProfiles.toSorted((left, right) => left.id.localeCompare(right.id))) {
    if (profile.scope === "retriever") {
      for (let repetition = 1; repetition <= profile.repetitions; repetition += 1) {
        for (const descriptor of descriptors) {
          samples.push(await retrieverSample({
            corpus,
            descriptor,
            profile,
            repetition,
            timeoutMs,
            dependencies: options.dependencies,
          }));
        }
      }
      continue;
    }

    if (profile.operation === "four-reader-query") {
      if (queries.length % profile.concurrency !== 0) {
        throw new TypeError(`Four-reader profile ${profile.id} requires complete batches of ${profile.concurrency}.`);
      }
      for (let repetition = 1; repetition <= profile.repetitions; repetition += 1) {
        const opened = await bounded({
          timeoutMs,
          now,
          disposeTimedOutValue: closeFourReaderBatch,
          operation: (signal) => options.dependencies.openFourReaderBatch({
            profileId: profile.id,
            repetition,
            signal,
          }),
        });
        if (opened.status === "failed") {
          for (const descriptor of descriptors) {
            for (const query of queries) {
              samples.push(failedSample({
                descriptor,
                profile,
                queryId: query.id,
                repetition,
                elapsedMs: opened.elapsedMs,
                failure: opened.failure,
                concurrencyBatchIdentity: corpus.experiment.environment.fourReaderBatch.id,
              }));
            }
          }
          continue;
        }
        const batch = opened.value;
        try {
          const readerMaps = validateFourReaderBatch(batch, corpus);
          await assertFourReaderCacheFingerprint({
            batch,
            corpus,
            timeoutMs,
            now,
            phase: "before",
          });
          for (const descriptor of descriptors) {
            const readers = readerMaps.map((map) => {
              const retriever = map.get(descriptor.id);
              if (retriever === undefined) {
                throw new TypeError(`Four-reader evaluation is missing ${descriptor.id}.`);
              }
              return retriever;
            });
            for (let index = 0; index < queries.length; index += profile.concurrency) {
              samples.push(...await simultaneousQuerySamples({
                corpus,
                descriptor,
                profile,
                queries: queries.slice(index, index + profile.concurrency),
                retrievers: readers,
                repetition,
                timeoutMs,
                dependencies: options.dependencies,
              }));
            }
          }
          await assertFourReaderCacheFingerprint({
            batch,
            corpus,
            timeoutMs,
            now,
            phase: "after",
          });
        } finally {
          await closeFourReaderBatch(batch);
        }
      }
      continue;
    }

    if (profile.operation !== "packing" && profile.operation !== "warm-query") {
      throw new TypeError(`Query profile ${profile.id} has an unsupported operation.`);
    }
    for (let repetition = 1; repetition <= profile.repetitions; repetition += 1) {
      await assertWarmCacheFingerprint({
        corpus,
        dependencies: options.dependencies,
        profile,
        repetition,
        phase: "before",
        timeoutMs,
      });
      for (const descriptor of descriptors) {
        const retriever = retrieverById.get(descriptor.id);
        if (retriever === undefined) throw new TypeError(`Evaluation retriever ${descriptor.id} is missing.`);
          for (const query of queries) {
            samples.push(await querySample({
              corpus,
              descriptor,
              profile,
              query,
              repetition,
              retriever,
              timeoutMs,
              dependencies: options.dependencies,
            }));
          }
      }
      await assertWarmCacheFingerprint({
        corpus,
        dependencies: options.dependencies,
        profile,
        repetition,
        phase: "after",
        timeoutMs,
      });
    }
  }
  const report = Object.freeze({
    schemaVersion: 2 as const,
    suiteSha256: corpus.manifest.corpusSha256,
    candidateLockSha256: corpus.manifest.candidateLockSha256,
    split: options.split,
    samples: Object.freeze(samples.toSorted(compareSamples)),
  });
  return parseRetrievalEvaluationReportV2(report, corpus);
}
