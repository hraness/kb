import { describe, expect, test } from "bun:test";

import {
  analyzeRetrievalEvaluationV2,
  countPackedContextProvenanceV2,
  evaluationAnalysisBootstrapSeedV2,
  type EvaluationCandidateGateCheckV2,
  type EvaluationMetricEstimateV2,
} from "./evaluation-analysis-v2.js";
import {
  evaluationCandidateLockDigestV2,
  evaluationCorpusDigestV2,
  evaluationRetrieverDescriptorDigestV2,
  requiredPairedObservationsV2,
  type EvaluationMinimumUsefulEffectMetricV2,
  type EvaluationNonInferiorityMetricV2,
  type EvaluationRepeatedSampleV2,
  type RetrievalEvaluationCorpusV2,
  type RetrievalEvaluationReportV2,
} from "./evaluation-v2.js";

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

type MutableCorpus = DeepMutable<RetrievalEvaluationCorpusV2>;
type MutableReport = DeepMutable<RetrievalEvaluationReportV2>;
type MutableSample = DeepMutable<EvaluationRepeatedSampleV2>;

const ZERO_SHA = "0".repeat(64);

function opaqueId(prefix: "ng" | "q" | "sf" | "ss", index: number): string {
  return `${prefix}-${index.toString(16).padStart(16, "0")}`;
}

const SUPPORTED_QUERY_IDS = [
  opaqueId("q", 1),
  opaqueId("q", 2),
  opaqueId("q", 3),
  opaqueId("q", 4),
  opaqueId("q", 9),
] as const;
const INSUFFICIENT_QUERY_IDS = [
  opaqueId("q", 5),
  opaqueId("q", 6),
  opaqueId("q", 7),
  opaqueId("q", 8),
] as const;
const SUPPORTED_QUERY_ID_SET = new Set<string>(SUPPORTED_QUERY_IDS);
const ALL_QUERY_IDS = [...SUPPORTED_QUERY_IDS, ...INSUFFICIENT_QUERY_IDS].toSorted();

function isSupportedQuery(queryId: string): boolean {
  return SUPPORTED_QUERY_ID_SET.has(queryId);
}
function familyId(index: number): string {
  return opaqueId("sf", index + 1);
}

function evidenceId(index: number): string {
  return `eeu:analysis-fixture-v1:${index.toString(16).padStart(64, "0")}`;
}

function documentId(index: number): string {
  return `document-${index}.md`;
}

function buildCorpus(options: {
  readonly repetitions?: number;
  readonly includeLatencyProfiles?: boolean;
  readonly minimumUsefulEffects?: readonly Readonly<{
    readonly metric: EvaluationMinimumUsefulEffectMetricV2;
    readonly cohort: "caller-seeded" | "text-only";
  }>[];
  readonly nonInferiorityMargins?: readonly EvaluationNonInferiorityMetricV2[];
} = {}): MutableCorpus {
  const pairedPowerDesign = {
    alpha: 0.05,
    targetPower: 0.8,
    assumedDiscordantRate: 1,
    assumedEffect: 1,
    minimumUsefulEffect: 0.01,
  } as const;
  const minimumUsefulEffects = options.minimumUsefulEffects ?? [{
    metric: "document-recall-at-k",
    cohort: "caller-seeded",
  }];
  const nonInferiorityMargins = options.nonInferiorityMargins ?? ["conceptual-recall-accuracy"];
  const queries: MutableCorpus["queries"] = ALL_QUERY_IDS.map((id, index) => {
    const supported = isSupportedQuery(id);
    const relevance = supported ? 3 as const : 1 as const;
    const callerSeeded = index % 2 === 0;
    const gold: MutableCorpus["queries"][number]["gold"] = {
      documents: [{ documentId: documentId(index), relevance }],
      evidenceUnits: [{ evidenceUnitId: evidenceId(index), relevance }],
      nuggets: [{
        id: opaqueId("ng", index + 1),
        text: `Answer ${index}`,
        required: true,
        acceptableSupportSets: supported ? [{
          id: opaqueId("ss", index + 1),
          evidenceUnitIds: [evidenceId(index)],
        }] : [],
      }],
    };
    const query: MutableCorpus["queries"][number] = {
      id,
      text: `Question ${index}`,
      split: "test" as const,
      cohort: callerSeeded ? "caller-seeded" : "text-only",
      strata: ["conceptual-recall" as const],
      primaryStratum: "conceptual-recall" as const,
      expectedSupport: supported ? "supported" as const : "insufficient" as const,
      primaryLane: "hybrid" as const,
      ...(supported ? {} : { negativeSubtype: "missing-required-support" as const }),
      inputs: callerSeeded
        ? { text: `Question ${index}`, context: { repositoryPath: "kb" } }
        : { text: `Question ${index}` },
      inputOrigins: callerSeeded
        ? [{ lane: "context", origin: "caller" }, { lane: "text", origin: "query-text" }]
        : [{ lane: "text", origin: "query-text" }],
      gold,
      rawAssessments: [],
      adjudication: { status: "single-assessor" as const },
    };
    query.rawAssessments = [{
      assessorId: "assessor",
      expectedSupport: query.expectedSupport,
      documents: structuredClone(gold.documents),
      evidenceUnits: structuredClone(gold.evidenceUnits),
      nuggets: gold.nuggets.map((nugget) => ({
        nuggetId: nugget.id,
        required: nugget.required,
        acceptableSupportSetIds: nugget.acceptableSupportSets.map(({ id: supportSetId }) => supportSetId),
      })),
    }];
    return query;
  });
  const warmProfile: MutableCorpus["measurementProfiles"][number] = {
    id: "warm-query",
    operation: "warm-query",
    scope: "query",
    cacheState: "warm",
    concurrency: 1,
    repetitions: options.repetitions ?? 2,
  };
  const packingProfile: MutableCorpus["measurementProfiles"][number] = {
    id: "packing",
    operation: "packing",
    scope: "query",
    cacheState: "warm",
    concurrency: 1,
    repetitions: options.repetitions ?? 2,
  };
  const measurementProfiles: MutableCorpus["measurementProfiles"] = options.includeLatencyProfiles
    ? [{
      id: "cold-index",
      operation: "cold-index",
      scope: "retriever",
      cacheState: "cold",
      concurrency: 1,
      repetitions: 2,
    }, packingProfile, warmProfile]
    : [packingProfile, warmProfile];
  const corpus: MutableCorpus = {
    schemaVersion: 2,
    id: "analysis-fixture",
    description: "A focused analysis fixture.",
    manifest: {
      protocol: "kb-retrieval-evaluation-v2",
      sealedAt: "2026-08-06T12:00:00.000Z",
      corpusSha256: ZERO_SHA,
      candidateLockSha256: ZERO_SHA,
      buildContractSha256: "b".repeat(64),
    },
    frozen: {
      repositoryCommit: "c".repeat(40),
      vaultTree: "d".repeat(40),
      vaultRoot: "kb",
    },
    assessment: { rubricVersion: "rubric-v2", assessors: [{ id: "assessor" }] },
    experiment: {
      protocol: {
        minimumUsefulEffects: minimumUsefulEffects.map(({ metric, cohort }) => ({
          metric,
          cohort,
          minimumAbsoluteDifference: 0.01,
        })),
        nonInferiorityMargins: nonInferiorityMargins.map((metric) => ({
          metric,
          maximumAbsoluteRegression: metric.endsWith("-p95-ms") ? 50 : 0.1,
          maximumRelativeRegression: 0.25,
        })),
        pairedPower: {
          ...pairedPowerDesign,
          requiredPairs: requiredPairedObservationsV2(pairedPowerDesign),
        },
        contextCeilings: { utf8Bytes: 16_384, readerTokens: 4_096 },
      },
      environment: {
        tokenizer: { id: "tokenizer", sha256: "e".repeat(64) },
        runtime: { id: "runtime", sha256: "f".repeat(64) },
        hardware: { id: "hardware" },
        localModel: { kind: "none" },
        cache: { preparation: "prepare", fingerprintSha256: "1".repeat(64) },
        fourReaderBatch: { id: "batch", sha256: "2".repeat(64) },
        incrementalMutation: {
          sourcePath: "notes/incremental-fixture.md",
          appendUtf8Sha256: "3".repeat(64),
          expectedPostMutationSha256: "4".repeat(64),
        },
      },
    },
    sourceFamilies: ALL_QUERY_IDS.map((_, index) => ({
      id: familyId(index),
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    })),
    documents: ALL_QUERY_IDS.map((_, index) => ({
      id: documentId(index),
      sourcePath: documentId(index),
      sourceFamilyId: familyId(index),
      trustClass: "authoritative-current",
    })),
    evidenceUnits: ALL_QUERY_IDS.map((_, index) => ({
      id: evidenceId(index),
      documentId: documentId(index),
      sourceFamilyId: familyId(index),
      trustClass: "authoritative-current",
      sourcePath: documentId(index),
      lineRange: { start: 1, end: 2 },
      headingPath: ["Heading"],
    })),
    measurementProfiles,
    retrievers: [{
      id: "baseline",
      role: "baseline",
      version: "1",
      implementationSha256: "3".repeat(64),
      lanes: ["hybrid"],
      configuration: { limit: 10 },
    }, {
      id: "candidate",
      role: "candidate",
      version: "1",
      implementationSha256: "4".repeat(64),
      lanes: ["hybrid"],
      configuration: { limit: 10 },
    }],
    candidateLock: {
      baselineRetrieverId: "baseline",
      candidateRetrieverIds: ["candidate"],
      descriptorDigests: [],
    },
    queries,
  };
  corpus.candidateLock.descriptorDigests = corpus.retrievers.map((descriptor) => ({
    retrieverId: descriptor.id,
    sha256: evaluationRetrieverDescriptorDigestV2(descriptor),
  }));
  corpus.manifest.candidateLockSha256 = evaluationCandidateLockDigestV2(corpus.candidateLock);
  corpus.manifest.corpusSha256 = evaluationCorpusDigestV2(corpus);
  return corpus;
}

function resealCorpus(corpus: MutableCorpus): void {
  corpus.candidateLock.descriptorDigests = corpus.retrievers.map((descriptor) => ({
    retrieverId: descriptor.id,
    sha256: evaluationRetrieverDescriptorDigestV2(descriptor),
  }));
  corpus.manifest.candidateLockSha256 = evaluationCandidateLockDigestV2(corpus.candidateLock);
  corpus.manifest.corpusSha256 = ZERO_SHA;
  corpus.manifest.corpusSha256 = evaluationCorpusDigestV2(corpus);
}

function locator(index: number): MutableSample["trace"]["candidateDecisions"][number]["provenance"][number] {
  return {
    evidenceUnitId: evidenceId(index),
    sourceFamilyId: familyId(index),
    sourceClass: "authored-note",
    trustClass: "authoritative-current",
    sourcePath: documentId(index),
    lineRange: { start: 1, end: 2 },
    headingPath: ["Heading"],
  };
}

function sample(options: {
  readonly retrieverId: string;
  readonly profileId: string;
  readonly repetition: number;
  readonly queryId?: string;
  readonly answer?: boolean;
  readonly answerIndex?: number;
  readonly status?: EvaluationRepeatedSampleV2["status"];
  readonly durationMs?: number;
}): MutableSample {
  const answerIndex = options.answerIndex ?? 0;
  const durationMs = options.durationMs ?? 10;
  const failed = options.status === "failed";
  const answered = options.answer !== false && !failed;
  const packing = options.profileId === "packing" && !failed;
  const provenance = [locator(answerIndex)];
  const rawRanking = answered ? [{
    documentId: documentId(answerIndex),
    evidenceUnitIds: [evidenceId(answerIndex)],
    rank: 1,
    provenance,
  }] : [];
  return {
    retrieverId: options.retrieverId,
    profileId: options.profileId,
    ...(options.queryId === undefined ? {} : { queryId: options.queryId }),
    repetition: options.repetition,
    status: options.status ?? "ready",
    timings: {
      elapsedMs: durationMs,
      indexMs: durationMs,
      updateMs: durationMs,
      queryMs: durationMs,
      packingMs: durationMs,
    },
    resources: {
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 0, inputTokens: 0, durationMs: 0 },
      packedContext: {
        utf8Bytes: packing && answered ? 1 : 0,
        readerTokens: packing && answered ? 1 : 0,
      },
      peakRssBytes: 0,
      cacheBytes: 0,
    },
    trace: {
      laneOutcomes: [{
        laneId: "hybrid",
        applicability: "applied",
        status: "ready",
        reasonCodes: [],
        rawRanking,
      }],
      candidateDecisions: answered ? [{
        documentId: documentId(answerIndex),
        evidenceUnitIds: [evidenceId(answerIndex)],
        laneId: "hybrid",
        sourceRank: 1,
        disposition: "accepted",
        reasonCodes: ["primary"],
        outputRank: 1,
        provenance,
      }] : [],
    },
    rawEvidence: answered ? [{
      laneId: "hybrid",
      documentId: documentId(answerIndex),
      rank: 1,
      evidence: { fixture: true },
    }] : [],
    ...(options.status === "failed"
      ? { failure: { kind: "exception" as const, message: "fixture failure" } }
      : {}),
    ...(packing
      ? {
          packedContextTrace: {
            evidenceUnitIds: answered ? [evidenceId(answerIndex)] : [],
            truncated: false,
            packedBytesSha256: answered ? "5".repeat(64) : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          },
        }
      : {}),
  };
}

function buildReport(
  corpus: RetrievalEvaluationCorpusV2,
  behavior: (retrieverId: string, queryId: string) => { readonly answer: boolean; readonly answerIndex: number } =
    (_retrieverId, queryId) => {
      const index = ALL_QUERY_IDS.indexOf(queryId);
      return { answer: isSupportedQuery(queryId), answerIndex: Math.max(0, index) };
    },
  latency: (retrieverId: string, profileId: string) => number = () => 10,
): MutableReport {
  const samples: MutableSample[] = [];
  for (const retriever of corpus.retrievers) {
    for (const profile of corpus.measurementProfiles) {
      if (profile.scope === "retriever") {
        for (let repetition = 1; repetition <= profile.repetitions; repetition += 1) {
          samples.push(sample({
            retrieverId: retriever.id,
            profileId: profile.id,
            repetition,
            answer: false,
            durationMs: latency(retriever.id, profile.id),
          }));
        }
        continue;
      }
      for (const query of corpus.queries) {
        const result = behavior(retriever.id, query.id);
        for (let repetition = 1; repetition <= profile.repetitions; repetition += 1) {
          samples.push(sample({
            retrieverId: retriever.id,
            profileId: profile.id,
            queryId: query.id,
            repetition,
            answer: result.answer,
            answerIndex: result.answerIndex,
            durationMs: latency(retriever.id, profile.id),
          }));
        }
      }
    }
  }
  return {
    schemaVersion: 2,
    suiteSha256: corpus.manifest.corpusSha256,
    candidateLockSha256: corpus.manifest.candidateLockSha256,
    split: "test",
    samples,
  };
}

function overallMetric(
  analysis: ReturnType<typeof analyzeRetrievalEvaluationV2>,
  retrieverId: string,
  metric: EvaluationMetricEstimateV2["metric"],
): EvaluationMetricEstimateV2 {
  const result = analysis.retrievers
    .find((retriever) => retriever.retrieverId === retrieverId)
    ?.slices.find(({ slice }) => slice.id === "overall")
    ?.metrics.find((entry) => entry.metric === metric);
  if (result === undefined) throw new Error(`Missing ${retrieverId} ${metric}.`);
  return result;
}

function latencyCheck(
  analysis: ReturnType<typeof analyzeRetrievalEvaluationV2>,
  metric: EvaluationNonInferiorityMetricV2,
): EvaluationCandidateGateCheckV2 {
  const result = analysis.candidateGates[0]?.checks.find((check) => check.metric === metric);
  if (result === undefined) throw new Error(`Missing ${metric} check.`);
  return result;
}

describe("retrieval evaluation v2 analysis", () => {
  test("clusters warm repetitions before query-level summaries and paired inference", () => {
    const corpus = buildCorpus({ repetitions: 3 });
    const analysis = analyzeRetrievalEvaluationV2(corpus, buildReport(corpus), {
      bootstrapResamples: 100,
    });

    expect(overallMetric(analysis, "candidate", "document-recall-at-k")).toEqual({
      metric: "document-recall-at-k",
      eligibleQueries: 5,
      observedQueries: 5,
      value: 1,
    });
    const comparison = analysis.pairedEffects.find(({ metric, slice }) =>
      metric === "document-recall-at-k" && slice.id === "overall");
    expect(comparison?.observedPairs).toBe(5);
    expect(comparison?.eligibleQueries).toBe(5);
  });

  test("keeps no-answer accuracy and false-abstention rate on disjoint eligible sets", () => {
    const corpus = buildCorpus();
    const report = buildReport(corpus, (retrieverId, queryId) => {
      const index = ALL_QUERY_IDS.indexOf(queryId);
      if (retrieverId === "baseline") {
        return { answer: isSupportedQuery(queryId), answerIndex: Math.max(0, index) };
      }
      return {
        answer: queryId === SUPPORTED_QUERY_IDS[1] || queryId === INSUFFICIENT_QUERY_IDS[1],
        answerIndex: queryId === SUPPORTED_QUERY_IDS[1] ? 1 : 3,
      };
    });
    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });

    expect(overallMetric(analysis, "candidate", "no-answer-accuracy")).toMatchObject({
      eligibleQueries: 4,
      observedQueries: 4,
      value: 0.75,
    });
    expect(overallMetric(analysis, "candidate", "false-abstention-rate")).toMatchObject({
      eligibleQueries: 5,
      observedQueries: 5,
      value: 0.8,
    });
  });

  test("applies a caller-seeded MUE only to caller-seeded observations", () => {
    const corpus = buildCorpus();
    const report = buildReport(corpus, (retrieverId, queryId) => {
      const index = ALL_QUERY_IDS.indexOf(queryId);
      if (
        queryId === SUPPORTED_QUERY_IDS[0]
        || queryId === SUPPORTED_QUERY_IDS[2]
        || queryId === SUPPORTED_QUERY_IDS[4]
      ) {
        return { answer: retrieverId === "candidate", answerIndex: index };
      }
      return { answer: isSupportedQuery(queryId), answerIndex: Math.max(0, index) };
    });
    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    const checks = analysis.candidateGates[0]?.checks.filter(
      ({ kind }) => kind === "minimum-useful-effect",
    );
    expect(checks).toEqual([expect.objectContaining({
      metric: "document-recall-at-k",
      sliceId: "cohort:caller-seeded",
      status: "passed",
      observedEffect: 1,
      eligibleQueries: 3,
      observedPairs: 3,
      sourceFamilyClusters: 3,
    })]);
    expect(analysis.slices.filter(({ kind }) => kind === "cohort").map(({ id }) => id))
      .toEqual(["cohort:caller-seeded", "cohort:text-only"]);
    expect(analysis.variantSelection.selectedRetrieverId).toBe("candidate");
  });

  test("does not let a text-only gain satisfy a caller-seeded MUE", () => {
    const corpus = buildCorpus();
    const report = buildReport(corpus, (retrieverId, queryId) => {
      const index = ALL_QUERY_IDS.indexOf(queryId);
      if (queryId === SUPPORTED_QUERY_IDS[1]) {
        return { answer: retrieverId === "candidate", answerIndex: index };
      }
      return { answer: isSupportedQuery(queryId), answerIndex: Math.max(0, index) };
    });
    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    expect(analysis.candidateGates[0]?.checks.find(
      ({ kind }) => kind === "minimum-useful-effect",
    )).toMatchObject({
      sliceId: "cohort:caller-seeded",
      status: "failed",
      observedEffect: 0,
    });
  });

  test("fails an observed cell guard when the caller MUE passes but text-only queries regress", () => {
    const corpus = buildCorpus();
    const report = buildReport(corpus, (retrieverId, queryId) => {
      const index = ALL_QUERY_IDS.indexOf(queryId);
      if (
        queryId === SUPPORTED_QUERY_IDS[0]
        || queryId === SUPPORTED_QUERY_IDS[2]
        || queryId === SUPPORTED_QUERY_IDS[4]
      ) {
        return { answer: retrieverId === "candidate", answerIndex: index };
      }
      if (queryId === SUPPORTED_QUERY_IDS[1] || queryId === SUPPORTED_QUERY_IDS[3]) {
        return { answer: retrieverId === "baseline", answerIndex: index };
      }
      return { answer: false, answerIndex: Math.max(0, index) };
    });
    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    expect(analysis.candidateGates[0]?.checks.find(
      ({ kind }) => kind === "minimum-useful-effect",
    )).toMatchObject({ status: "passed", sliceId: "cohort:caller-seeded" });
    expect(analysis.candidateGates[0]?.checks.find(
      ({ metric, sliceId }) => metric === "conceptual-recall-accuracy"
        && sliceId === "cohort:text-only:primary-stratum:conceptual-recall",
    )).toMatchObject({
      kind: "observed-no-regression",
      status: "failed",
      eligibleQueries: 4,
      observedPairs: 4,
      regressedPairs: 2,
    });
    expect(analysis.candidateGates[0]?.reasons.some(({ code, metric, count }) =>
      code === "observed-query-regression"
      && metric === "conceptual-recall-accuracy"
      && count === 2)).toBe(true);
  });

  test("scores authoritative quality from packed context rather than pre-pack retrieval", () => {
    const corpus = buildCorpus();
    const queryId = SUPPORTED_QUERY_IDS[0];
    const wrongIndex = 1;
    const query = corpus.queries.find(({ id }) => id === queryId);
    if (query === undefined) throw new Error("Missing packed-context fixture query.");
    query.gold.documents.push({ documentId: documentId(wrongIndex), relevance: 0 });
    query.gold.evidenceUnits.push({ evidenceUnitId: evidenceId(wrongIndex), relevance: 0 });
    query.rawAssessments[0]?.documents.push({ documentId: documentId(wrongIndex), relevance: 0 });
    query.rawAssessments[0]?.evidenceUnits.push({ evidenceUnitId: evidenceId(wrongIndex), relevance: 0 });
    resealCorpus(corpus);
    const report = buildReport(corpus);
    for (const packed of report.samples.filter((entry) =>
      entry.retrieverId === "candidate"
      && entry.profileId === "packing"
      && entry.queryId === queryId)) {
      const wrongProvenance = [locator(wrongIndex)];
      packed.trace.laneOutcomes[0]!.rawRanking.push({
        documentId: documentId(wrongIndex),
        evidenceUnitIds: [evidenceId(wrongIndex)],
        rank: 2,
        provenance: wrongProvenance,
      });
      packed.rawEvidence.push({
        laneId: "hybrid",
        documentId: documentId(wrongIndex),
        rank: 2,
        evidence: { fixture: true },
      });
      packed.trace.candidateDecisions.push({
        documentId: documentId(wrongIndex),
        evidenceUnitIds: [evidenceId(wrongIndex)],
        laneId: "hybrid",
        sourceRank: 2,
        disposition: "accepted",
        reasonCodes: ["appended"],
        outputRank: 2,
        provenance: wrongProvenance,
      });
      packed.packedContextTrace = {
        evidenceUnitIds: [evidenceId(wrongIndex)],
        truncated: true,
        packedBytesSha256: "6".repeat(64),
      };
    }

    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    expect(overallMetric(analysis, "candidate", "document-recall-at-k").value).toBe(0.8);
    expect(overallMetric(analysis, "candidate", "context-precision").value).toBeCloseTo(8 / 9);
    expect(analysis.qualityProfileId).toBe("packing");
  });

  test("applies recall cutoffs to accepted document rank, not packed unit position", () => {
    const corpus = buildCorpus();
    const queryId = SUPPORTED_QUERY_IDS[0];
    const relevantIndex = 0;
    const decoyIndex = 1;
    const additionalDecoyId = `eeu:analysis-fixture-v1:${"f".repeat(64)}`;
    corpus.evidenceUnits.push({
      ...corpus.evidenceUnits[decoyIndex]!,
      id: additionalDecoyId,
      lineRange: { start: 3, end: 4 },
    });
    corpus.evidenceUnits = corpus.evidenceUnits.toSorted((left, right) =>
      left.id.localeCompare(right.id));
    resealCorpus(corpus);
    const report = buildReport(corpus);
    const decoyLocator = locator(decoyIndex);
    const additionalDecoyLocator = {
      ...decoyLocator,
      evidenceUnitId: additionalDecoyId,
      lineRange: { start: 3, end: 4 },
    };
    const relevantLocator = locator(relevantIndex);
    for (const packed of report.samples.filter((entry) =>
      entry.retrieverId === "candidate"
      && entry.profileId === "packing"
      && entry.queryId === queryId)) {
      packed.trace.laneOutcomes[0]!.rawRanking = [{
        documentId: documentId(decoyIndex),
        evidenceUnitIds: [evidenceId(decoyIndex), additionalDecoyId],
        rank: 1,
        provenance: [decoyLocator, additionalDecoyLocator],
      }, {
        documentId: documentId(relevantIndex),
        evidenceUnitIds: [evidenceId(relevantIndex)],
        rank: 2,
        provenance: [relevantLocator],
      }];
      packed.trace.candidateDecisions = [{
        documentId: documentId(decoyIndex),
        evidenceUnitIds: [evidenceId(decoyIndex), additionalDecoyId],
        laneId: "hybrid",
        sourceRank: 1,
        disposition: "accepted",
        reasonCodes: ["primary"],
        outputRank: 1,
        provenance: [decoyLocator, additionalDecoyLocator],
      }, {
        documentId: documentId(relevantIndex),
        evidenceUnitIds: [evidenceId(relevantIndex)],
        laneId: "hybrid",
        sourceRank: 2,
        disposition: "accepted",
        reasonCodes: ["primary"],
        outputRank: 2,
        provenance: [relevantLocator],
      }];
      packed.rawEvidence = [{
        laneId: "hybrid",
        documentId: documentId(decoyIndex),
        rank: 1,
      }, {
        laneId: "hybrid",
        documentId: documentId(relevantIndex),
        rank: 2,
      }];
      packed.packedContextTrace = {
        evidenceUnitIds: [evidenceId(decoyIndex), additionalDecoyId, evidenceId(relevantIndex)],
        truncated: false,
        packedBytesSha256: "7".repeat(64),
      };
      packed.resources.packedContext = { utf8Bytes: 3, readerTokens: 3 };
    }

    const analysis = analyzeRetrievalEvaluationV2(corpus, report, {
      bootstrapResamples: 100,
      cutoff: 2,
    });
    expect(overallMetric(analysis, "candidate", "document-recall-at-k").value).toBe(1);
    expect(overallMetric(analysis, "candidate", "evidence-recall-at-k").value).toBe(1);
  });

  test("counts packed provenance from deduplicated lanes and leaves missing locators uncovered", () => {
    const packed = sample({
      retrieverId: "candidate",
      profileId: "packing",
      queryId: SUPPORTED_QUERY_IDS[0],
      repetition: 1,
      answer: true,
      answerIndex: 0,
    });
    const deduplicatedEvidenceUnitId = `eeu:analysis-fixture-v1:${"a".repeat(64)}`;
    const missingEvidenceUnitId = `eeu:analysis-fixture-v1:${"b".repeat(64)}`;
    const deduplicatedLocator = {
      ...locator(0),
      evidenceUnitId: deduplicatedEvidenceUnitId,
      lineRange: { start: 3, end: 4 },
    };
    packed.trace.candidateDecisions.push({
      documentId: documentId(0),
      evidenceUnitIds: [deduplicatedEvidenceUnitId],
      laneId: "metadata",
      sourceRank: 1,
      disposition: "excluded",
      reasonCodes: ["deduplicated"],
      provenance: [deduplicatedLocator],
    });
    packed.packedContextTrace = {
      evidenceUnitIds: [evidenceId(0), deduplicatedEvidenceUnitId, missingEvidenceUnitId],
      truncated: false,
      packedBytesSha256: "7".repeat(64),
    };

    expect(countPackedContextProvenanceV2(packed)).toEqual({
      packed: 3,
      covered: 2,
    });
  });

  test("keeps unjudged context precision diagnostic and outside promotion gates", () => {
    const corpus = buildCorpus({ nonInferiorityMargins: ["context-precision"] });
    const report = buildReport(corpus);
    const queryId = SUPPORTED_QUERY_IDS[0];
    const packed = report.samples.find((entry) =>
      entry.retrieverId === "candidate"
      && entry.profileId === "packing"
      && entry.queryId === queryId);
    if (packed === undefined) throw new Error("Missing candidate packing sample.");
      const unjudgedIndex = 1;
      const unjudgedProvenance = [locator(unjudgedIndex)];
      packed.trace.laneOutcomes[0]!.rawRanking.push({
        documentId: documentId(unjudgedIndex),
        evidenceUnitIds: [evidenceId(unjudgedIndex)],
        rank: 2,
        provenance: unjudgedProvenance,
      });
      packed.rawEvidence.push({
        laneId: "hybrid",
        documentId: documentId(unjudgedIndex),
        rank: 2,
        evidence: { fixture: true },
      });
      packed.trace.candidateDecisions.push({
        documentId: documentId(unjudgedIndex),
        evidenceUnitIds: [evidenceId(unjudgedIndex)],
        laneId: "hybrid",
        sourceRank: 2,
        disposition: "accepted",
        reasonCodes: ["appended"],
        outputRank: 2,
        provenance: unjudgedProvenance,
      });
      packed.packedContextTrace?.evidenceUnitIds.push(evidenceId(1));
      packed.resources.packedContext.utf8Bytes = 2;
      packed.resources.packedContext.readerTokens = 2;

    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    expect(overallMetric(analysis, "candidate", "context-precision")).toMatchObject({
      eligibleQueries: 9,
      observedQueries: 8,
      value: 1,
    });
    expect(analysis.candidateGates[0]?.checks.some(({ metric }) =>
      metric === "context-precision")).toBe(false);
    expect(analysis.candidateGates[0]?.reasons.some(({ metric }) =>
      metric === "context-precision")).toBe(false);
  });

  test("uses observed zero-regression guards for small complete quality and accuracy cells", () => {
    const corpus = buildCorpus({
      nonInferiorityMargins: [
        "conceptual-recall-accuracy",
        "document-recall-at-k",
        "evidence-recall-at-k",
      ],
    });
    const analysis = analyzeRetrievalEvaluationV2(corpus, buildReport(corpus), {
      bootstrapResamples: 100,
    });
    const checks = analysis.candidateGates[0]?.checks.filter(({ kind }) =>
      kind === "observed-no-regression") ?? [];

    expect(checks).toHaveLength(6);
    expect(new Set(checks.map(({ sliceId }) => sliceId))).toEqual(new Set([
      "cohort:caller-seeded:primary-stratum:conceptual-recall",
      "cohort:text-only:primary-stratum:conceptual-recall",
    ]));
    expect(checks.every(({ status }) => status === "passed")).toBe(true);
    expect(checks.find(({ metric, sliceId }) =>
      metric === "document-recall-at-k"
      && sliceId === "cohort:text-only:primary-stratum:conceptual-recall")).toMatchObject({
      observedEffect: 0,
      eligibleQueries: 2,
      observedPairs: 2,
      regressedPairs: 0,
    });
    expect(checks.find(({ metric, sliceId }) =>
      metric === "conceptual-recall-accuracy"
      && sliceId === "cohort:text-only:primary-stratum:conceptual-recall")).toMatchObject({
      observedEffect: 0,
      eligibleQueries: 4,
      observedPairs: 4,
      regressedPairs: 0,
    });
    expect(checks.every((check) =>
      !("confidenceLower" in check)
      && !("confidenceUpper" in check)
      && !("allowedRegression" in check))).toBe(true);
  });

  test("fails an observed quality guard for one discordant paired query", () => {
    const corpus = buildCorpus({ nonInferiorityMargins: ["document-recall-at-k"] });
    const report = buildReport(corpus, (retrieverId, queryId) => {
      const index = ALL_QUERY_IDS.indexOf(queryId);
      if (queryId === SUPPORTED_QUERY_IDS[1] && retrieverId === "candidate") {
        return { answer: false, answerIndex: index };
      }
      return { answer: isSupportedQuery(queryId), answerIndex: Math.max(0, index) };
    });

    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    expect(analysis.candidateGates[0]?.checks.find(({ metric, sliceId }) =>
      metric === "document-recall-at-k"
      && sliceId === "cohort:text-only:primary-stratum:conceptual-recall")).toMatchObject({
      kind: "observed-no-regression",
      status: "failed",
      eligibleQueries: 2,
      observedPairs: 2,
      regressedPairs: 1,
      observedEffect: -0.5,
    });
    expect(analysis.candidateGates[0]?.reasons.some(({ code, metric, count }) =>
      code === "observed-query-regression"
      && metric === "document-recall-at-k"
      && count === 1)).toBe(true);
  });

  test("keeps incomplete observed guards fail-closed in development and test", () => {
    for (const split of ["development", "test"] as const) {
      const corpus = buildCorpus({ nonInferiorityMargins: ["document-recall-at-k"] });
      for (const query of corpus.queries) query.split = split;
      resealCorpus(corpus);
      const report = buildReport(corpus, (retrieverId, queryId) => {
        const index = ALL_QUERY_IDS.indexOf(queryId);
        if (
          queryId === SUPPORTED_QUERY_IDS[0]
          || queryId === SUPPORTED_QUERY_IDS[2]
          || queryId === SUPPORTED_QUERY_IDS[4]
        ) return { answer: retrieverId === "candidate", answerIndex: index };
        return { answer: isSupportedQuery(queryId), answerIndex: Math.max(0, index) };
      });
      report.split = split;
      const unavailable = report.samples.find(({ retrieverId, profileId, queryId, repetition }) =>
        retrieverId === "candidate"
        && profileId === "packing"
        && queryId === SUPPORTED_QUERY_IDS[1]
        && repetition === 1);
      if (unavailable === undefined) throw new Error("Missing unavailable cell-guard fixture sample.");
      unavailable.status = "unavailable";
      unavailable.trace.laneOutcomes[0]!.status = "unavailable";
      unavailable.trace.laneOutcomes[0]!.reasonCodes = ["fixture-unavailable"];
      unavailable.trace.laneOutcomes[0]!.rawRanking = [];
      unavailable.trace.candidateDecisions = [];
      unavailable.rawEvidence = [];
      unavailable.resources.packedContext = { readerTokens: 0, utf8Bytes: 0 };
      unavailable.packedContextTrace = {
        evidenceUnitIds: [],
        truncated: false,
        packedBytesSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      };

      const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
      expect(analysis.candidateGates[0]?.checks.find(({ metric, sliceId }) =>
        metric === "document-recall-at-k"
        && sliceId === "cohort:text-only:primary-stratum:conceptual-recall")).toMatchObject({
        kind: "observed-no-regression",
        status: "not-evaluable",
        eligibleQueries: 2,
        observedPairs: 1,
      });
      expect(analysis.candidateGates[0]?.passed).toBe(false);
      expect(analysis.variantSelection.selectedRetrieverId).toBeNull();
    }
  });

  test("fails closed when a promotion effect has only one sealed source-family cluster", () => {
    const corpus = buildCorpus();
    const report = buildReport(corpus);
    const retainedFamily = corpus.sourceFamilies[0]!;
    corpus.sourceFamilies = [retainedFamily];
    for (const document of corpus.documents) document.sourceFamilyId = retainedFamily.id;
    for (const evidence of corpus.evidenceUnits) evidence.sourceFamilyId = retainedFamily.id;
    for (const sample_ of report.samples) {
      for (const outcome of sample_.trace.laneOutcomes) {
        for (const ranking of outcome.rawRanking) {
          for (const provenance of ranking.provenance) provenance.sourceFamilyId = retainedFamily.id;
        }
      }
      for (const decision of sample_.trace.candidateDecisions) {
        for (const provenance of decision.provenance) provenance.sourceFamilyId = retainedFamily.id;
      }
    }
    resealCorpus(corpus);
    report.suiteSha256 = corpus.manifest.corpusSha256;
    report.candidateLockSha256 = corpus.manifest.candidateLockSha256;

    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    expect(analysis.candidateGates[0]?.checks.find(
      ({ kind }) => kind === "minimum-useful-effect",
    )).toMatchObject({ status: "not-evaluable" });
    expect(analysis.pairedEffects.find(({ metric, slice }) =>
      metric === "document-recall-at-k" && slice.id === "cohort:caller-seeded"))
      .toMatchObject({ sourceFamilyClusters: 1, inferenceStatus: "insufficient-clusters" });
  });

  test("does not call a primary effect powered when query pairs collapse into too few source families", () => {
    const corpus = buildCorpus();
    const report = buildReport(corpus, (retrieverId, queryId) => {
      const index = ALL_QUERY_IDS.indexOf(queryId);
      if (
        queryId === SUPPORTED_QUERY_IDS[0]
        || queryId === SUPPORTED_QUERY_IDS[2]
        || queryId === SUPPORTED_QUERY_IDS[4]
      ) return { answer: retrieverId === "candidate", answerIndex: index };
      return { answer: isSupportedQuery(queryId), answerIndex: Math.max(0, index) };
    });
    const retainedFamilies = corpus.sourceFamilies.slice(0, 2);
    corpus.sourceFamilies = retainedFamilies;
    for (const [index, document] of corpus.documents.entries()) {
      document.sourceFamilyId = retainedFamilies[index % 2]!.id;
    }
    for (const [index, evidence] of corpus.evidenceUnits.entries()) {
      evidence.sourceFamilyId = retainedFamilies[index % 2]!.id;
    }
    const secondPrimaryQuery = corpus.queries.find(({ id }) => id === SUPPORTED_QUERY_IDS[2]);
    const secondPrimaryDocument = corpus.documents.find(({ id }) =>
      id === secondPrimaryQuery?.gold.documents[0]?.documentId);
    const secondPrimaryEvidence = corpus.evidenceUnits.find(({ id }) =>
      id === secondPrimaryQuery?.gold.evidenceUnits[0]?.evidenceUnitId);
    if (secondPrimaryDocument === undefined || secondPrimaryEvidence === undefined) {
      throw new Error("Cluster fixture lost its second primary query.");
    }
    secondPrimaryDocument.sourceFamilyId = retainedFamilies[1]!.id;
    secondPrimaryEvidence.sourceFamilyId = retainedFamilies[1]!.id;
    for (const sample_ of report.samples) {
      for (const outcome of sample_.trace.laneOutcomes) {
        for (const ranking of outcome.rawRanking) {
          for (const provenance of ranking.provenance) {
            const index = corpus.evidenceUnits.findIndex(({ id }) => id === provenance.evidenceUnitId);
            provenance.sourceFamilyId = corpus.evidenceUnits[index]!.sourceFamilyId;
          }
        }
      }
      for (const decision of sample_.trace.candidateDecisions) {
        for (const provenance of decision.provenance) {
          const index = corpus.evidenceUnits.findIndex(({ id }) => id === provenance.evidenceUnitId);
          provenance.sourceFamilyId = corpus.evidenceUnits[index]!.sourceFamilyId;
        }
      }
    }
    resealCorpus(corpus);
    report.suiteSha256 = corpus.manifest.corpusSha256;
    report.candidateLockSha256 = corpus.manifest.candidateLockSha256;

    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    expect(analysis.candidateGates[0]?.checks.find(({ kind }) =>
      kind === "minimum-useful-effect")).toMatchObject({
        status: "not-evaluable",
        eligibleQueries: 3,
        observedPairs: 3,
        sourceFamilyClusters: 2,
      });
    expect(analysis.candidateGates[0]?.reasons.some((reason) =>
      reason.code === "insufficient-independent-pairs" && reason.count === 2)).toBe(true);
  });

  test("does not select an ablation when the official candidate fails", () => {
    const corpus = buildCorpus();
    corpus.retrievers.push({
      id: "ablation",
      role: "ablation",
      version: "1",
      implementationSha256: "5".repeat(64),
      lanes: ["hybrid"],
      configuration: { limit: 10 },
    });
    corpus.retrievers.sort((left, right) => left.id.localeCompare(right.id));
    resealCorpus(corpus);
    const report = buildReport(corpus, (retrieverId, queryId) => {
      const index = ALL_QUERY_IDS.indexOf(queryId);
      if (
        queryId === SUPPORTED_QUERY_IDS[0]
        || queryId === SUPPORTED_QUERY_IDS[2]
        || queryId === SUPPORTED_QUERY_IDS[4]
      ) {
        return { answer: retrieverId === "ablation", answerIndex: index };
      }
      return { answer: isSupportedQuery(queryId), answerIndex: Math.max(0, index) };
    });
    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });

    expect(analysis.retrieverGates.find(({ candidateRetrieverId }) =>
      candidateRetrieverId === "ablation")?.passed).toBe(true);
    expect(analysis.variantSelection.passingRetrieverIds).toEqual(["ablation"]);
    expect(analysis.variantSelection.selectedRetrieverId).toBeNull();
    expect(analysis.variantSelection.incrementalChecks).toEqual([]);
    expect(analysis.candidateGates.map(({ candidateRetrieverId }) => candidateRetrieverId))
      .toEqual(["candidate"]);
  });

  test("selects no variant when the official candidate fails an incremental check", () => {
    const corpus = buildCorpus();
    const candidate = corpus.retrievers.find(({ id }) => id === "candidate");
    if (candidate === undefined) throw new Error("Missing candidate fixture.");
    candidate.configuration = { closure: true, limit: 10 };
    corpus.retrievers.push({
      id: "ablation",
      role: "ablation",
      version: "1",
      implementationSha256: "5".repeat(64),
      lanes: ["hybrid"],
      configuration: { limit: 10 },
    });
    corpus.retrievers.sort((left, right) => left.id.localeCompare(right.id));
    resealCorpus(corpus);
    const report = buildReport(corpus, (retrieverId, queryId) => {
      const index = ALL_QUERY_IDS.indexOf(queryId);
      if (
        queryId === SUPPORTED_QUERY_IDS[0]
        || queryId === SUPPORTED_QUERY_IDS[2]
        || queryId === SUPPORTED_QUERY_IDS[4]
      ) return { answer: retrieverId !== "baseline", answerIndex: index };
      return { answer: isSupportedQuery(queryId), answerIndex: Math.max(0, index) };
    });

    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    expect(analysis.candidateGates[0]?.passed).toBe(true);
    expect(analysis.variantSelection.passingRetrieverIds).toEqual(["ablation", "candidate"]);
    expect(analysis.variantSelection.incrementalChecks).toEqual([expect.objectContaining({
      baselineRetrieverId: "ablation",
      candidateRetrieverId: "candidate",
      status: "failed",
      observedEffect: 0,
    })]);
    expect(analysis.variantSelection.selectedRetrieverId).toBeNull();
  });

  test("keeps equal-complexity ablations out of incremental checks regardless of ID order", () => {
    const analyzeWithAblationId = (id: string) => {
      const corpus = buildCorpus();
      corpus.retrievers.push({
        id,
        role: "ablation",
        version: "1",
        implementationSha256: "5".repeat(64),
        lanes: ["hybrid"],
        configuration: { limit: 10 },
      });
      corpus.retrievers.sort((left, right) => left.id.localeCompare(right.id));
      resealCorpus(corpus);
      const report = buildReport(corpus, (retrieverId, queryId) => {
        const index = ALL_QUERY_IDS.indexOf(queryId);
        if (
          queryId === SUPPORTED_QUERY_IDS[0]
          || queryId === SUPPORTED_QUERY_IDS[2]
          || queryId === SUPPORTED_QUERY_IDS[4]
        ) return { answer: retrieverId !== "baseline", answerIndex: index };
        return { answer: isSupportedQuery(queryId), answerIndex: Math.max(0, index) };
      });
      return analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    };

    const before = analyzeWithAblationId("aaa-equal-complexity");
    const after = analyzeWithAblationId("zzz-equal-complexity");
    expect(before.variantSelection.incrementalChecks).toEqual([]);
    expect(after.variantSelection.incrementalChecks).toEqual([]);
    expect(before.variantSelection.selectedRetrieverId).toBe("candidate");
    expect(after.variantSelection.selectedRetrieverId).toBe("candidate");
  });

  test("produces deterministic bootstrap intervals from suite, candidate, and metric", () => {
    const corpus = buildCorpus();
    const report = buildReport(corpus);
    const first = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    const second = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });

    expect(second.pairedEffects).toEqual(first.pairedEffects);
    expect(evaluationAnalysisBootstrapSeedV2(corpus.manifest.corpusSha256, "candidate", "nugget-coverage"))
      .toBe(evaluationAnalysisBootstrapSeedV2(corpus.manifest.corpusSha256, "candidate", "nugget-coverage"));
    expect(evaluationAnalysisBootstrapSeedV2(corpus.manifest.corpusSha256, "candidate", "nugget-coverage"))
      .not.toBe(evaluationAnalysisBootstrapSeedV2(
        corpus.manifest.corpusSha256,
        "other-candidate",
        "nugget-coverage",
      ));
  });

  test("reports each operation profile without mixing cache states or duration fields", () => {
    const corpus = buildCorpus({
      includeLatencyProfiles: true,
      nonInferiorityMargins: ["packing-p95-ms", "warm-query-p95-ms"],
    });
    const report = buildReport(corpus, undefined, (retrieverId, profileId) => {
      const base = profileId === "cold-index" ? 100 : profileId === "packing" ? 20 : 5;
      return retrieverId === "candidate" ? base + 1 : base;
    });
    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    const candidate = analysis.latencyProfiles.filter(({ retrieverId }) => retrieverId === "candidate");

    expect(candidate.map(({ profileId, cacheState, p95Ms }) => ({ profileId, cacheState, p95Ms })))
      .toEqual([
        { profileId: "cold-index", cacheState: "cold", p95Ms: 101 },
        { profileId: "packing", cacheState: "warm", p95Ms: 21 },
        { profileId: "warm-query", cacheState: "warm", p95Ms: 6 },
      ]);
  });

  test("uses the larger absolute or relative query-latency allowance and keeps cold p95 diagnostic", () => {
    const corpus = buildCorpus({
      includeLatencyProfiles: true,
      nonInferiorityMargins: ["warm-query-p95-ms"],
    });
    const report = buildReport(corpus, undefined, (retrieverId, profileId) => {
      if (profileId === "warm-query") return retrieverId === "candidate" ? 1_200 : 1_000;
      if (profileId === "cold-index") return retrieverId === "candidate" ? 140 : 100;
      return 10;
    });
    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });

    expect(latencyCheck(analysis, "warm-query-p95-ms")).toMatchObject({
      status: "passed",
      baselineObserved: 1_000,
      candidateObserved: 1_200,
      observedEffect: 200,
      allowedRegression: 250,
      durationScope: "query-operation",
    });
    expect(analysis.latencyProfiles.find(({ retrieverId, profileId }) =>
      retrieverId === "candidate" && profileId === "cold-index")?.p95Ms).toBe(140);
    expect(analysis.candidateGates[0]?.checks.some(({ profileId }) => profileId === "cold-index"))
      .toBe(false);
  });

  test("gates packing on end-to-end elapsed time while reporting its raw packing component", () => {
    const corpus = buildCorpus({
      nonInferiorityMargins: ["packing-p95-ms", "warm-query-p95-ms"],
    });
    const report = buildReport(corpus);
    for (const current of report.samples) {
      const candidate = current.retrieverId === "candidate";
      if (current.profileId === "packing") {
        current.timings.queryMs = candidate ? 145 : 100;
        current.timings.packingMs = candidate ? 145 : 100;
        current.timings.elapsedMs = candidate ? 290 : 200;
      } else if (current.profileId === "warm-query") {
        current.timings.queryMs = candidate ? 145 : 100;
        current.timings.packingMs = 0;
        current.timings.elapsedMs = candidate ? 145 : 100;
      }
    }

    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });

    expect(latencyCheck(analysis, "warm-query-p95-ms")).toMatchObject({
      status: "passed",
      observedEffect: 45,
      allowedRegression: 50,
    });
    expect(analysis.latencyProfiles
      .filter(({ profileId }) => profileId === "packing")
      .map(({ retrieverId, p95Ms }) => ({ retrieverId, p95Ms })))
      .toEqual([
        { retrieverId: "baseline", p95Ms: 100 },
        { retrieverId: "candidate", p95Ms: 145 },
      ]);
    expect(latencyCheck(analysis, "packing-p95-ms")).toMatchObject({
      status: "failed",
      baselineObserved: 200,
      candidateObserved: 290,
      observedEffect: 90,
      allowedRegression: 50,
      durationScope: "context-ready-elapsed",
    });
  });

  test("fails the candidate gate for a valid failed warm-query cluster", () => {
    const corpus = buildCorpus();
    const report = buildReport(corpus);
    const candidateSamples = report.samples.filter(({ retrieverId, profileId }) =>
      retrieverId === "candidate" && profileId === "warm-query");
    const failed = candidateSamples.find(({ queryId, repetition }) =>
      queryId === SUPPORTED_QUERY_IDS[0] && repetition === 1);
    if (failed === undefined) throw new Error("Missing failed fixture sample.");
    failed.status = "failed";
    failed.failure = { kind: "exception", message: "fixture failure" };
    failed.trace.laneOutcomes[0]!.rawRanking = [];
    failed.trace.candidateDecisions = [];
    failed.rawEvidence = [];

    const analysis = analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 });
    const gate = analysis.candidateGates[0];
    expect(gate?.passed).toBe(false);
    expect(new Set(gate?.reasons.map(({ code }) => code))).toEqual(new Set([
      "failed-sample",
      "minimum-useful-effect-not-met",
    ]));
  });

  test("reparses and rejects a forged typed report before scoring", () => {
    const corpus = buildCorpus();
    const report = buildReport(corpus);
    Object.defineProperty(report.samples[0]!.resources.llm, "calls", { value: 1 });

    expect(() => analyzeRetrievalEvaluationV2(corpus, report, { bootstrapResamples: 100 }))
      .toThrow("literal zero LLM calls");
  });
});
