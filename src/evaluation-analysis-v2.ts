import { createHash } from "node:crypto";

import type { PairedBootstrapInterval } from "./evaluation.js";
import {
  MAX_EVALUATION_V2_QUERIES,
  MAX_EVALUATION_V2_RESULTS_PER_LANE,
  MAX_EVALUATION_V2_SAMPLES,
  evaluationSourceFamilyClusterIdsV2,
  parseRetrievalEvaluationCorpusV2,
  parseRetrievalEvaluationReportV2,
  type EvaluationCohortV2,
  type EvaluationMeasurementOperationV2,
  type EvaluationMinimumUsefulEffectMetricV2,
  type EvaluationNonInferiorityMetricV2,
  type EvaluationQueryV2,
  type EvaluationRepeatedSampleV2,
  type EvaluationStratumV2,
  type RetrievalEvaluationCorpusV2,
  type RetrievalEvaluationReportV2,
} from "./evaluation-v2.js";

export const DEFAULT_EVALUATION_ANALYSIS_CUTOFF_V2 = 10;
export const DEFAULT_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2 = 2_000;
export const MAX_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2 = 10_000;
export const MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2 = 50_000_000;

export type EvaluationQualityMetricV2 =
  | EvaluationMinimumUsefulEffectMetricV2
  | "context-precision"
  | "decision-accuracy"
  | "provenance-coverage";

export type EvaluationAnalysisSliceV2 =
  | {
      readonly id: "overall";
      readonly kind: "overall";
    }
  | {
      readonly id: `cohort:${EvaluationCohortV2}`;
      readonly kind: "cohort";
      readonly cohort: EvaluationCohortV2;
    }
  | {
      readonly id: `primary-stratum:${EvaluationStratumV2}`;
      readonly kind: "primary-stratum";
      readonly primaryStratum: EvaluationStratumV2;
    }
  | {
      readonly id: `cohort:${EvaluationCohortV2}:primary-stratum:${EvaluationStratumV2}`;
      readonly kind: "cohort-primary-stratum";
      readonly cohort: EvaluationCohortV2;
      readonly primaryStratum: EvaluationStratumV2;
    };

export type EvaluationMetricEstimateV2 = {
  readonly metric: EvaluationQualityMetricV2;
  readonly eligibleQueries: number;
  readonly observedQueries: number;
  readonly value: number | null;
};

export type EvaluationSliceSummaryV2 = {
  readonly slice: EvaluationAnalysisSliceV2;
  readonly queryCount: number;
  readonly metrics: readonly EvaluationMetricEstimateV2[];
};

export type EvaluationRetrieverQualitySummaryV2 = {
  readonly retrieverId: string;
  readonly queryCount: number;
  readonly slices: readonly EvaluationSliceSummaryV2[];
  readonly acceptedEvidenceUnits: number;
  readonly provenanceCoveredEvidenceUnits: number;
  readonly provenanceCoverage: number;
  readonly failedSamples: number;
  readonly unavailableWarmQuerySamples: number;
  readonly unavailableQualitySamples: number;
  readonly missingQualityObservations: number;
  readonly nonzeroLlmAccountingSamples: number;
};

export type EvaluationPairedEffectV2 = {
  readonly baselineRetrieverId: string;
  readonly candidateRetrieverId: string;
  readonly metric: EvaluationQualityMetricV2;
  readonly slice: EvaluationAnalysisSliceV2;
  readonly direction: "higher-is-better" | "lower-is-better";
  readonly eligibleQueries: number;
  readonly observedPairs: number;
  readonly sourceFamilyClusters: number;
  readonly inferenceStatus: "estimable" | "insufficient-clusters";
  readonly baselineMean: number;
  readonly candidateMean: number;
  /** Positive values always favor the candidate, including lower-is-better metrics. */
  readonly favorableInterval: PairedBootstrapInterval;
  /** One-sided 95% lower bound used only for the predeclared positive primary effect. */
  readonly favorableOneSidedLower: number;
};

export type EvaluationLatencyProfileSummaryV2 = {
  readonly retrieverId: string;
  readonly profileId: string;
  readonly operation: EvaluationMeasurementOperationV2;
  readonly cacheState: RetrievalEvaluationCorpusV2["measurementProfiles"][number]["cacheState"];
  readonly expectedObservations: number;
  readonly observedObservations: number;
  readonly p95Ms: number | null;
};

export type EvaluationCandidateGateCheckV2 = {
  readonly kind:
    | "minimum-useful-effect"
    | "noninferiority-latency"
    | "observed-no-regression";
  readonly metric: EvaluationMinimumUsefulEffectMetricV2 | EvaluationNonInferiorityMetricV2;
  readonly status: "failed" | "not-evaluable" | "passed";
  readonly sliceId?: EvaluationAnalysisSliceV2["id"];
  readonly profileId?: string;
  readonly observedEffect?: number;
  readonly eligibleQueries?: number;
  readonly observedPairs?: number;
  readonly sourceFamilyClusters?: number;
  readonly regressedPairs?: number;
  readonly confidenceLower?: number;
  readonly confidenceUpper?: number;
  readonly requiredImprovement?: number;
  readonly allowedRegression?: number;
  readonly baselineObserved?: number;
  readonly candidateObserved?: number;
  readonly durationScope?: "context-ready-elapsed" | "query-operation";
};

export type EvaluationCandidateGateReasonCodeV2 =
  | "ambiguous-warm-query-profile"
  | "failed-sample"
  | "insufficient-independent-pairs"
  | "minimum-useful-effect-not-met"
  | "missing-quality-profile"
  | "missing-eligible-observations"
  | "missing-warm-query-profile"
  | "noninferiority-margin-exceeded"
  | "nonzero-llm-accounting"
  | "observed-query-regression"
  | "provenance-below-100-percent"
  | "unavailable-quality-sample"
  | "unavailable-warm-query-sample";

export type EvaluationVariantComplexityV2 = {
  readonly laneCount: number;
  readonly activeConfigurationEntries: number;
};

export type EvaluationVariantSelectionV2 = {
  readonly baselineRetrieverId: string;
  readonly orderedRetrieverIds: readonly string[];
  readonly passingRetrieverIds: readonly string[];
  readonly selectedRetrieverId: string | null;
  readonly incrementalChecks: readonly EvaluationVariantIncrementalCheckV2[];
  readonly complexity: readonly {
    readonly retrieverId: string;
    readonly role: "ablation" | "candidate";
    readonly score: EvaluationVariantComplexityV2;
  }[];
};

export type EvaluationVariantIncrementalCheckV2 = {
  readonly baselineRetrieverId: string;
  readonly candidateRetrieverId: string;
  readonly metric: EvaluationMinimumUsefulEffectMetricV2;
  readonly sliceId: EvaluationAnalysisSliceV2["id"];
  readonly status: "failed" | "not-evaluable" | "passed";
  readonly eligibleQueries: number;
  readonly observedPairs: number;
  readonly sourceFamilyClusters: number;
  readonly requiredImprovement: number;
  readonly observedEffect?: number;
  readonly confidenceLower?: number;
  readonly confidenceUpper?: number;
};

export type EvaluationCandidateGateReasonV2 = {
  readonly code: EvaluationCandidateGateReasonCodeV2;
  readonly message: string;
  readonly retrieverId?: string;
  readonly metric?: EvaluationMinimumUsefulEffectMetricV2 | EvaluationNonInferiorityMetricV2;
  readonly sliceId?: EvaluationAnalysisSliceV2["id"];
  readonly profileId?: string;
  readonly count?: number;
};

export type EvaluationCandidateGateV2 = {
  readonly baselineRetrieverId: string;
  readonly candidateRetrieverId: string;
  readonly passed: boolean;
  readonly checks: readonly EvaluationCandidateGateCheckV2[];
  readonly reasons: readonly EvaluationCandidateGateReasonV2[];
};

export type RetrievalEvaluationAnalysisV2 = {
  readonly schemaVersion: 2;
  readonly suiteSha256: string;
  readonly candidateLockSha256: string;
  readonly split: RetrievalEvaluationReportV2["split"];
  readonly cutoff: number;
  readonly bootstrap: {
    readonly confidence: 0.95;
    readonly resamples: number;
    readonly draws: number;
  };
  readonly warmQueryProfileId: string | null;
  readonly qualityProfileId: string | null;
  readonly slices: readonly EvaluationAnalysisSliceV2[];
  readonly retrievers: readonly EvaluationRetrieverQualitySummaryV2[];
  readonly pairedEffects: readonly EvaluationPairedEffectV2[];
  readonly latencyProfiles: readonly EvaluationLatencyProfileSummaryV2[];
  readonly candidateGates: readonly EvaluationCandidateGateV2[];
  /** Same sealed gate applied to every non-baseline ablation and candidate. */
  readonly retrieverGates: readonly EvaluationCandidateGateV2[];
  /** Select only an official locked candidate that clears its gate and every incremental check. */
  readonly variantSelection: EvaluationVariantSelectionV2;
};

export type AnalyzeRetrievalEvaluationV2Options = {
  readonly cutoff?: number;
  readonly bootstrapResamples?: number;
};

type QueryMetricValues = Readonly<Record<EvaluationQualityMetricV2, number | null>>;

type QueryScore = {
  readonly queryId: string;
  readonly sourceFamilyClusterId: string;
  readonly metrics: QueryMetricValues;
};

type RetrieverFaults = {
  failedSamples: number;
  unavailableWarmQuerySamples: number;
  unavailableQualitySamples: number;
  missingQualityObservations: number;
  nonzeroLlmAccountingSamples: number;
  acceptedEvidenceUnits: number;
  provenanceCoveredEvidenceUnits: number;
};

const QUALITY_METRICS = Object.freeze([
  "document-recall-at-k",
  "evidence-recall-at-k",
  "nugget-coverage",
  "context-precision",
  "no-answer-accuracy",
  "false-abstention-rate",
  "provenance-coverage",
  "decision-accuracy",
] as const satisfies readonly EvaluationQualityMetricV2[]);

const COHORTS = Object.freeze(["caller-seeded", "text-only"] as const);

const ACCURACY_STRATUM_BY_METRIC = Object.freeze({
  "active-current-state-accuracy": "active-current-state",
  "code-path-context-accuracy": "code-path-context",
  "conceptual-recall-accuracy": "conceptual-recall",
  "exact-identity-accuracy": "exact-identity",
  "local-context-accuracy": "local-context",
  "metadata-constraint-accuracy": "metadata-constraint",
  "multi-note-relational-accuracy": "multi-note-relational",
  "source-provenance-accuracy": "source-provenance",
  "temporal-stale-current-accuracy": "temporal-stale-current",
} as const satisfies Partial<Record<EvaluationNonInferiorityMetricV2, EvaluationStratumV2>>);

const LATENCY_OPERATION_BY_METRIC = Object.freeze({
  "four-reader-query-p95-ms": "four-reader-query",
  "packing-p95-ms": "packing",
  "warm-query-p95-ms": "warm-query",
} as const satisfies Partial<Record<EvaluationNonInferiorityMetricV2, EvaluationMeasurementOperationV2>>);

const QUALITY_NONINFERIORITY_METRICS = new Set<EvaluationNonInferiorityMetricV2>([
  "document-recall-at-k",
  "evidence-recall-at-k",
]);

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.max(0, Math.ceil(proportion * sorted.length) - 1);
  return sorted[index] ?? null;
}

function meanRequired(values: readonly number[], label: string): number {
  const result = average(values);
  if (result === null) throw new TypeError(`${label} requires at least one finite value.`);
  return result;
}

function sampleGroupKey(retrieverId: string, profileId: string, queryId: string | undefined): string {
  return `${retrieverId}\0${profileId}\0${queryId ?? ""}`;
}

function metricEligible(query: EvaluationQueryV2, metric: EvaluationQualityMetricV2): boolean {
  if (
    metric === "document-recall-at-k"
    || metric === "evidence-recall-at-k"
    || metric === "nugget-coverage"
    || metric === "false-abstention-rate"
  ) return query.expectedSupport === "supported";
  if (metric === "no-answer-accuracy") return query.expectedSupport === "insufficient";
  return true;
}

function queryInSlice(query: EvaluationQueryV2, slice: EvaluationAnalysisSliceV2): boolean {
  if (slice.kind === "overall") return true;
  if (slice.kind === "cohort") return query.cohort === slice.cohort;
  if (slice.kind === "primary-stratum") return query.primaryStratum === slice.primaryStratum;
  return query.cohort === slice.cohort && query.primaryStratum === slice.primaryStratum;
}

function analysisSlices(queries: readonly EvaluationQueryV2[]): readonly EvaluationAnalysisSliceV2[] {
  const primaryStrata = [...new Set(queries.map(({ primaryStratum }) => primaryStratum))].toSorted();
  return Object.freeze([
    Object.freeze({ id: "overall", kind: "overall" }),
    ...COHORTS.map((cohort) => Object.freeze({
      id: `cohort:${cohort}` as const,
      kind: "cohort" as const,
      cohort,
    })),
    ...primaryStrata.map((primaryStratum) => Object.freeze({
      id: `primary-stratum:${primaryStratum}` as const,
      kind: "primary-stratum" as const,
      primaryStratum,
    })),
    ...COHORTS.flatMap((cohort) => primaryStrata.map((primaryStratum) => Object.freeze({
      id: `cohort:${cohort}:primary-stratum:${primaryStratum}` as const,
      kind: "cohort-primary-stratum" as const,
      cohort,
      primaryStratum,
    }))),
  ]);
}

function acceptedDecisions(sample: EvaluationRepeatedSampleV2): readonly EvaluationRepeatedSampleV2["trace"]["candidateDecisions"][number][] {
  return sample.trace.candidateDecisions
    .filter(({ disposition }) => disposition === "accepted")
    .toSorted((left, right) => (left.outputRank ?? Number.MAX_SAFE_INTEGER) - (right.outputRank ?? Number.MAX_SAFE_INTEGER));
}

export function countPackedContextProvenanceV2(
  sample: EvaluationRepeatedSampleV2,
): {
  readonly packed: number;
  readonly covered: number;
} {
  const packedEvidenceUnitIds = new Set(sample.packedContextTrace?.evidenceUnitIds ?? []);
  const provenancedEvidenceUnitIds = new Set<string>();
  for (const decision of sample.trace.candidateDecisions) {
    for (const locator of decision.provenance) {
      provenancedEvidenceUnitIds.add(locator.evidenceUnitId);
    }
  }
  return Object.freeze({
    packed: packedEvidenceUnitIds.size,
    covered: [...packedEvidenceUnitIds]
      .filter((evidenceUnitId) => provenancedEvidenceUnitIds.has(evidenceUnitId)).length,
  });
}

function scoreSample(
  query: EvaluationQueryV2,
  sample: EvaluationRepeatedSampleV2,
  cutoff: number,
  evidenceById: ReadonlyMap<string, RetrievalEvaluationCorpusV2["evidenceUnits"][number]>,
): QueryMetricValues {
  const packedEvidenceIds = sample.packedContextTrace?.evidenceUnitIds;
  if (packedEvidenceIds === undefined) {
    throw new TypeError(`Quality sample ${sample.retrieverId}/${sample.queryId ?? ""} lacks packed context.`);
  }
  const packedEvidence = new Set(packedEvidenceIds);
  for (const evidenceUnitId of packedEvidence) {
    if (!evidenceById.has(evidenceUnitId)) {
      throw new TypeError(`Packed evidence unit ${evidenceUnitId} is missing from the catalog.`);
    }
  }
  const topKAccepted = acceptedDecisions(sample)
    .filter(({ outputRank }) => outputRank !== undefined && outputRank <= cutoff);
  const relevantDocuments = new Set(query.gold.documents
    .filter(({ relevance }) => relevance > 0)
    .map(({ documentId }) => documentId));
  const relevantEvidence = new Set(query.gold.evidenceUnits
    .filter(({ relevance }) => relevance > 0)
    .map(({ evidenceUnitId }) => evidenceUnitId));
  const topKDocuments = new Set(topKAccepted
    .filter(({ evidenceUnitIds }) => evidenceUnitIds.some((evidenceUnitId) =>
      packedEvidence.has(evidenceUnitId)))
    .map(({ documentId }) => documentId));
  const topKEvidence = new Set(sample.trace.candidateDecisions
    .filter(({ documentId }) => topKDocuments.has(documentId))
    .flatMap(({ evidenceUnitIds }) => evidenceUnitIds)
    .filter((evidenceUnitId) => packedEvidence.has(evidenceUnitId)));
  const evidenceRelevance = new Map(query.gold.evidenceUnits.map(({ evidenceUnitId, relevance }) => [
    evidenceUnitId,
    relevance,
  ]));
  const requiredNuggets = query.gold.nuggets.filter(({ required }) => required);
  if (query.expectedSupport === "supported" && requiredNuggets.length === 0) {
    throw new TypeError(`Supported query ${query.id} has no required nugget.`);
  }
  const coveredRequiredNuggets = requiredNuggets.filter((nugget) =>
    nugget.acceptableSupportSets.some((supportSet) =>
      supportSet.evidenceUnitIds.every((evidenceUnitId) => packedEvidence.has(evidenceUnitId))));
  const provenance = countPackedContextProvenanceV2(sample);
  const hasUnjudgedPackedEvidence = [...packedEvidence].some(
    (evidenceUnitId) => !evidenceRelevance.has(evidenceUnitId),
  );
  const contextPrecision = packedEvidence.size === 0
    ? 1
    : hasUnjudgedPackedEvidence
      ? null
      : [...packedEvidence].filter((evidenceUnitId) => (evidenceRelevance.get(evidenceUnitId) ?? 0) > 0).length
        / packedEvidence.size;
  const nuggetCoverage = query.expectedSupport === "supported"
    ? coveredRequiredNuggets.length / requiredNuggets.length
    : null;
  const noAnswerAccuracy = query.expectedSupport === "insufficient"
    ? (packedEvidence.size === 0 ? 1 : 0)
    : null;
  const falseAbstentionRate = query.expectedSupport === "supported"
    ? (packedEvidence.size === 0 ? 1 : 0)
    : null;
  return Object.freeze({
    "document-recall-at-k": query.expectedSupport === "supported" && relevantDocuments.size > 0
      ? [...relevantDocuments].filter((documentId) => topKDocuments.has(documentId)).length / relevantDocuments.size
      : null,
    "evidence-recall-at-k": query.expectedSupport === "supported" && relevantEvidence.size > 0
      ? [...relevantEvidence].filter((evidenceUnitId) => topKEvidence.has(evidenceUnitId)).length / relevantEvidence.size
      : null,
    "nugget-coverage": nuggetCoverage,
    "context-precision": contextPrecision,
    "no-answer-accuracy": noAnswerAccuracy,
    "false-abstention-rate": falseAbstentionRate,
    "provenance-coverage": provenance.packed === 0 ? 1 : provenance.covered / provenance.packed,
    "decision-accuracy": query.expectedSupport === "supported"
      ? (nuggetCoverage === 1 ? 1 : 0)
      : (noAnswerAccuracy ?? 0),
  });
}

function aggregateRepetitions(
  query: EvaluationQueryV2,
  samples: readonly EvaluationRepeatedSampleV2[],
  cutoff: number,
  evidenceById: ReadonlyMap<string, RetrievalEvaluationCorpusV2["evidenceUnits"][number]>,
  sourceFamilyClusterId: string,
): QueryScore {
  const perSample = samples.map((sample) => scoreSample(query, sample, cutoff, evidenceById));
  const metrics = Object.fromEntries(QUALITY_METRICS.map((metric) => {
    const repetitionValues = perSample.map((row) => row[metric]);
    const values = repetitionValues.flatMap((value) => value === null ? [] : [value]);
    return [
      metric,
      metric === "context-precision" && repetitionValues.some((value) => value === null)
        ? null
        : average(values),
    ];
  })) as Record<EvaluationQualityMetricV2, number | null>;
  return Object.freeze({ queryId: query.id, sourceFamilyClusterId, metrics: Object.freeze(metrics) });
}

function sliceSummary(
  slice: EvaluationAnalysisSliceV2,
  queries: readonly EvaluationQueryV2[],
  scores: ReadonlyMap<string, QueryScore>,
): EvaluationSliceSummaryV2 {
  const slicedQueries = queries.filter((query) => queryInSlice(query, slice));
  const metrics = QUALITY_METRICS.map((metric): EvaluationMetricEstimateV2 => {
    const eligible = slicedQueries.filter((query) => metricEligible(query, metric));
    const values = eligible.flatMap((query) => {
      const value = scores.get(query.id)?.metrics[metric];
      return value === null || value === undefined ? [] : [value];
    });
    return Object.freeze({
      metric,
      eligibleQueries: eligible.length,
      observedQueries: values.length,
      value: average(values),
    });
  });
  return Object.freeze({
    slice,
    queryCount: slicedQueries.length,
    metrics: Object.freeze(metrics),
  });
}

function operationDuration(
  sample: EvaluationRepeatedSampleV2,
  operation: EvaluationMeasurementOperationV2,
): number {
  if (operation === "cold-index") return sample.timings.indexMs;
  if (operation === "incremental-update") return sample.timings.updateMs;
  if (operation === "packing") return sample.timings.packingMs;
  return sample.timings.queryMs;
}

function promotionOperationDuration(
  sample: EvaluationRepeatedSampleV2,
  operation: EvaluationMeasurementOperationV2,
): number {
  if (operation === "packing") return sample.timings.elapsedMs;
  return operationDuration(sample, operation);
}

function expectedProfileObservations(
  profile: RetrievalEvaluationCorpusV2["measurementProfiles"][number],
  queryCount: number,
): number {
  return profile.repetitions * (profile.scope === "query" ? queryCount : 1);
}

export function evaluationAnalysisBootstrapSeedV2(
  suiteSha256: string,
  candidateRetrieverId: string,
  metric: EvaluationQualityMetricV2,
  sliceId: EvaluationAnalysisSliceV2["id"] = "overall",
): number {
  const digest = createHash("sha256")
    .update(suiteSha256, "utf8")
    .update("\0", "utf8")
    .update(candidateRetrieverId, "utf8")
    .update("\0", "utf8")
    .update(metric, "utf8")
    .update("\0", "utf8")
    .update(sliceId, "utf8")
    .digest();
  return digest.readUInt32BE(0);
}

type ClusteredPair = {
  readonly baseline: number;
  readonly candidate: number;
  readonly clusterId: string;
};

type ObservedNoRegressionGuard = {
  readonly eligibleQueries: number;
  readonly observedPairs: number;
  readonly regressedPairs: number;
  /** Mean paired difference in the favorable direction; this is descriptive, not inferential. */
  readonly observedEffect: number | null;
};

function favorablePairs(
  metric: EvaluationQualityMetricV2,
  pairs: readonly ClusteredPair[],
): readonly ClusteredPair[] {
  if (metric !== "false-abstention-rate") return pairs;
  return pairs.map(({ baseline, candidate, clusterId }) => ({
    baseline: -baseline,
    candidate: -candidate,
    clusterId,
  }));
}

function observedNoRegressionGuard(
  options: Readonly<{
    readonly metric: EvaluationQualityMetricV2;
    readonly slice: EvaluationAnalysisSliceV2;
    readonly queries: readonly EvaluationQueryV2[];
    readonly baselineScores: ReadonlyMap<string, QueryScore>;
    readonly candidateScores: ReadonlyMap<string, QueryScore>;
  }>,
): ObservedNoRegressionGuard {
  const eligibleQueries = options.queries.filter((query) =>
    queryInSlice(query, options.slice) && metricEligible(query, options.metric));
  const favorableDifferences = eligibleQueries.flatMap((query) => {
    const baseline = options.baselineScores.get(query.id)?.metrics[options.metric];
    const candidate = options.candidateScores.get(query.id)?.metrics[options.metric];
    if (baseline === null || baseline === undefined || candidate === null || candidate === undefined) return [];
    return [options.metric === "false-abstention-rate"
      ? baseline - candidate
      : candidate - baseline];
  });
  return Object.freeze({
    eligibleQueries: eligibleQueries.length,
    observedPairs: favorableDifferences.length,
    regressedPairs: favorableDifferences.filter((difference) => difference < 0).length,
    observedEffect: average(favorableDifferences),
  });
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clusteredPairedBootstrapConfidenceInterval(
  pairs: readonly ClusteredPair[],
  options: Readonly<{ readonly seed: number; readonly resamples: number }>,
): PairedBootstrapInterval & { readonly oneSidedLower: number } {
  if (pairs.length < 1) throw new RangeError("Clustered bootstrap requires at least one pair.");
  const groups = new Map<string, ClusteredPair[]>();
  for (const pair of pairs) {
    const group = groups.get(pair.clusterId) ?? [];
    group.push(pair);
    groups.set(pair.clusterId, group);
  }
  const clusters = [...groups.keys()].toSorted();
  const observedDifference = pairs.reduce(
    (sum, pair) => sum + pair.candidate - pair.baseline,
    0,
  ) / pairs.length;
  if (clusters.length < 2) {
    return Object.freeze({
      pairs: pairs.length,
      seed: options.seed,
      resamples: options.resamples,
      confidence: 0.95,
      observedDifference,
      lower: -1,
      upper: 1,
      oneSidedLower: -1,
    });
  }
  const random = seededRandom(options.seed);
  const draws: number[] = [];
  for (let drawIndex = 0; drawIndex < options.resamples; drawIndex += 1) {
    let difference = 0;
    let observations = 0;
    for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
      const clusterId = clusters[Math.floor(random() * clusters.length)];
      const group = clusterId === undefined ? undefined : groups.get(clusterId);
      if (group === undefined) throw new Error("Cluster bootstrap selected a missing source family.");
      for (const pair of group) difference += pair.candidate - pair.baseline;
      observations += group.length;
    }
    draws.push(difference / observations);
  }
  draws.sort((left, right) => left - right);
  return Object.freeze({
    pairs: pairs.length,
    seed: options.seed,
    resamples: options.resamples,
    confidence: 0.95,
    observedDifference,
    lower: draws[Math.floor(0.025 * options.resamples)] ?? -1,
    upper: draws[Math.min(options.resamples - 1, Math.ceil(0.975 * options.resamples) - 1)] ?? 1,
    oneSidedLower: draws[Math.floor(0.05 * options.resamples)] ?? -1,
  });
}

function comparisonKey(
  candidateRetrieverId: string,
  metric: EvaluationQualityMetricV2,
  sliceId: EvaluationAnalysisSliceV2["id"],
): string {
  return `${candidateRetrieverId}\0${metric}\0${sliceId}`;
}

function pairedEffect(
  options: Readonly<{
    readonly baselineRetrieverId: string;
    readonly candidateRetrieverId: string;
    readonly metric: EvaluationQualityMetricV2;
    readonly slice: EvaluationAnalysisSliceV2;
    readonly queries: readonly EvaluationQueryV2[];
    readonly baselineScores: ReadonlyMap<string, QueryScore>;
    readonly candidateScores: ReadonlyMap<string, QueryScore>;
    readonly suiteSha256: string;
    readonly bootstrapResamples: number;
  }>,
): EvaluationPairedEffectV2 | undefined {
  const eligibleQueries = options.queries
    .filter((query) => queryInSlice(query, options.slice) && metricEligible(query, options.metric));
  const pairs = eligibleQueries.flatMap((query) => {
    const baselineScore = options.baselineScores.get(query.id);
    const candidateScore = options.candidateScores.get(query.id);
    const baseline = baselineScore?.metrics[options.metric];
    const candidate = candidateScore?.metrics[options.metric];
    return baselineScore === undefined
      || baseline === null
      || baseline === undefined
      || candidate === null
      || candidate === undefined
      ? []
      : [{ baseline, candidate, clusterId: baselineScore.sourceFamilyClusterId }];
  });
  if (pairs.length === 0) return undefined;
  const favorable = favorablePairs(options.metric, pairs);
  const sourceFamilyClusters = new Set(pairs.map(({ clusterId }) => clusterId)).size;
  const interval = clusteredPairedBootstrapConfidenceInterval(favorable, {
    seed: evaluationAnalysisBootstrapSeedV2(
      options.suiteSha256,
      `${options.baselineRetrieverId}->${options.candidateRetrieverId}`,
      options.metric,
      options.slice.id,
    ),
    resamples: options.bootstrapResamples,
  });
  return Object.freeze({
    baselineRetrieverId: options.baselineRetrieverId,
    candidateRetrieverId: options.candidateRetrieverId,
    metric: options.metric,
    slice: options.slice,
    direction: options.metric === "false-abstention-rate" ? "lower-is-better" as const : "higher-is-better" as const,
    eligibleQueries: eligibleQueries.length,
    observedPairs: pairs.length,
    sourceFamilyClusters,
    inferenceStatus: sourceFamilyClusters >= 2 ? "estimable" as const : "insufficient-clusters" as const,
    baselineMean: meanRequired(pairs.map(({ baseline }) => baseline), "Baseline paired mean"),
    candidateMean: meanRequired(pairs.map(({ candidate }) => candidate), "Candidate paired mean"),
    favorableInterval: Object.freeze({
      pairs: interval.pairs,
      seed: interval.seed,
      resamples: interval.resamples,
      confidence: interval.confidence,
      observedDifference: interval.observedDifference,
      lower: interval.lower,
      upper: interval.upper,
    }),
    favorableOneSidedLower: interval.oneSidedLower,
  });
}

function reasonKey(reason: EvaluationCandidateGateReasonV2): string {
  return [
    reason.code,
    reason.retrieverId ?? "",
    reason.metric ?? "",
    reason.sliceId ?? "",
    reason.profileId ?? "",
  ].join("\0");
}

function canonicalReasons(
  reasons: readonly EvaluationCandidateGateReasonV2[],
): readonly EvaluationCandidateGateReasonV2[] {
  const byKey = new Map<string, EvaluationCandidateGateReasonV2>();
  for (const reason of reasons) byKey.set(reasonKey(reason), reason);
  return Object.freeze([...byKey.values()].toSorted((left, right) => reasonKey(left).localeCompare(reasonKey(right))));
}

function variantComplexity(
  descriptor: RetrievalEvaluationCorpusV2["retrievers"][number],
): EvaluationVariantComplexityV2 {
  const activeConfigurationEntries = Object.values(descriptor.configuration).filter((value) =>
    value !== null && value !== false && value !== 0 && value !== "none").length;
  return Object.freeze({ laneCount: descriptor.lanes.length, activeConfigurationEntries });
}

function compareVariantComplexity(
  left: { readonly retrieverId: string; readonly score: EvaluationVariantComplexityV2 },
  right: { readonly retrieverId: string; readonly score: EvaluationVariantComplexityV2 },
): number {
  return compareVariantComplexityScore(left.score, right.score)
    || left.retrieverId.localeCompare(right.retrieverId);
}

function compareVariantComplexityScore(
  left: EvaluationVariantComplexityV2,
  right: EvaluationVariantComplexityV2,
): number {
  return left.laneCount - right.laneCount
    || left.activeConfigurationEntries - right.activeConfigurationEntries;
}

function isStrictlySimplerVariant(
  baseline: { readonly score: EvaluationVariantComplexityV2 },
  candidate: { readonly score: EvaluationVariantComplexityV2 },
): boolean {
  return compareVariantComplexityScore(baseline.score, candidate.score) < 0;
}

function validateOptions(options: AnalyzeRetrievalEvaluationV2Options): {
  readonly cutoff: number;
  readonly bootstrapResamples: number;
} {
  const cutoff = options.cutoff ?? DEFAULT_EVALUATION_ANALYSIS_CUTOFF_V2;
  if (!Number.isSafeInteger(cutoff) || cutoff < 1 || cutoff > MAX_EVALUATION_V2_RESULTS_PER_LANE) {
    throw new RangeError(`Analysis cutoff must be from 1 through ${MAX_EVALUATION_V2_RESULTS_PER_LANE}.`);
  }
  const bootstrapResamples = options.bootstrapResamples
    ?? DEFAULT_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2;
  if (
    !Number.isSafeInteger(bootstrapResamples)
    || bootstrapResamples < 100
    || bootstrapResamples > MAX_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2
  ) {
    throw new RangeError(
      `Analysis bootstrap resamples must be from 100 through ${MAX_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2}.`,
    );
  }
  return Object.freeze({ cutoff, bootstrapResamples });
}

/**
 * Analyze a strict v2 report without re-running retrieval or inspecting hidden authoring keys.
 * Repetitions are averaged within each retriever/query cluster before any paired inference.
 */
export function analyzeRetrievalEvaluationV2(
  corpus: RetrievalEvaluationCorpusV2,
  report: RetrievalEvaluationReportV2,
  options: AnalyzeRetrievalEvaluationV2Options = {},
): RetrievalEvaluationAnalysisV2 {
  const parsedCorpus = parseRetrievalEvaluationCorpusV2(corpus, { claimPromotion: false });
  const parsedReport = parseRetrievalEvaluationReportV2(report, parsedCorpus);
  return analyzeParsedRetrievalEvaluationV2(parsedCorpus, parsedReport, options);
}

function analyzeParsedRetrievalEvaluationV2(
  corpus: RetrievalEvaluationCorpusV2,
  report: RetrievalEvaluationReportV2,
  options: AnalyzeRetrievalEvaluationV2Options,
): RetrievalEvaluationAnalysisV2 {
  const { cutoff, bootstrapResamples } = validateOptions(options);
  if (report.schemaVersion !== 2 || corpus.schemaVersion !== 2) {
    throw new TypeError("Analysis requires strict v2 corpus and report inputs.");
  }
  if (
    report.suiteSha256 !== corpus.manifest.corpusSha256
    || report.candidateLockSha256 !== corpus.manifest.candidateLockSha256
  ) throw new TypeError("Analysis report commitments do not match the sealed corpus.");
  if (corpus.queries.length > MAX_EVALUATION_V2_QUERIES || report.samples.length > MAX_EVALUATION_V2_SAMPLES) {
    throw new RangeError("Analysis input exceeds the v2 corpus or report work bound.");
  }
  const queries = corpus.queries.filter((query) => report.split === "all" || query.split === report.split);
  if (queries.length === 0) throw new TypeError("Analysis report split contains no queries.");
  const descriptorIds = new Set(corpus.retrievers.map(({ id }) => id));
  const profileById = new Map(corpus.measurementProfiles.map((profile) => [profile.id, profile]));
  for (const sample of report.samples) {
    if (!descriptorIds.has(sample.retrieverId)) {
      throw new TypeError(`Analysis sample names unknown retriever ${sample.retrieverId}.`);
    }
    if (!profileById.has(sample.profileId)) {
      throw new TypeError(`Analysis sample names unknown profile ${sample.profileId}.`);
    }
  }
  const baselineRetrieverId = corpus.candidateLock.baselineRetrieverId;
  if (!descriptorIds.has(baselineRetrieverId)) throw new TypeError("Sealed baseline retriever is missing.");
  const alternativeRetrieverIds = corpus.retrievers
    .filter(({ id }) => id !== baselineRetrieverId)
    .map(({ id }) => id);
  for (const candidateRetrieverId of alternativeRetrieverIds) {
    if (!descriptorIds.has(candidateRetrieverId)) {
      throw new TypeError(`Sealed candidate retriever ${candidateRetrieverId} is missing.`);
    }
  }

  const warmProfiles = corpus.measurementProfiles.filter(({ operation }) => operation === "warm-query");
  const warmProfile = warmProfiles.length === 1 ? warmProfiles[0] : undefined;
  const qualityProfiles = corpus.measurementProfiles.filter(({ operation }) => operation === "packing");
  const qualityProfile = qualityProfiles.length === 1 ? qualityProfiles[0] : undefined;
  const evidenceById = new Map(corpus.evidenceUnits.map((evidence) => [evidence.id, evidence]));
  const clusterIdByQuery = evaluationSourceFamilyClusterIdsV2(
    queries,
    corpus.documents,
    corpus.evidenceUnits,
    corpus.sourceFamilies,
  );
  const groupedSamples = new Map<string, EvaluationRepeatedSampleV2[]>();
  const profileSamples = new Map<string, EvaluationRepeatedSampleV2[]>();
  const faultsByRetriever = new Map<string, RetrieverFaults>();
  for (const { id } of corpus.retrievers) {
    faultsByRetriever.set(id, {
      failedSamples: 0,
      unavailableWarmQuerySamples: 0,
      unavailableQualitySamples: 0,
      missingQualityObservations: 0,
      nonzeroLlmAccountingSamples: 0,
      acceptedEvidenceUnits: 0,
      provenanceCoveredEvidenceUnits: 0,
    });
  }
  for (const sample of report.samples) {
    const key = sampleGroupKey(sample.retrieverId, sample.profileId, sample.queryId);
    const group = groupedSamples.get(key) ?? [];
    group.push(sample);
    groupedSamples.set(key, group);
    const profileKey = `${sample.retrieverId}\0${sample.profileId}`;
    const profileGroup = profileSamples.get(profileKey) ?? [];
    profileGroup.push(sample);
    profileSamples.set(profileKey, profileGroup);
    const faults = faultsByRetriever.get(sample.retrieverId);
    if (faults === undefined) continue;
    if (sample.status === "failed") faults.failedSamples += 1;
    if (warmProfile !== undefined && sample.profileId === warmProfile.id && sample.status === "unavailable") {
      faults.unavailableWarmQuerySamples += 1;
    }
    if (qualityProfile !== undefined && sample.profileId === qualityProfile.id && sample.status === "unavailable") {
      faults.unavailableQualitySamples += 1;
    }
    const llm = sample.resources.llm as { readonly calls: number; readonly inputTokens: number; readonly outputTokens: number };
    if (llm.calls !== 0 || llm.inputTokens !== 0 || llm.outputTokens !== 0) {
      faults.nonzeroLlmAccountingSamples += 1;
    }
    if (qualityProfile !== undefined && sample.profileId === qualityProfile.id) {
      const provenance = countPackedContextProvenanceV2(sample);
      faults.acceptedEvidenceUnits += provenance.packed;
      faults.provenanceCoveredEvidenceUnits += provenance.covered;
    }
  }
  for (const group of groupedSamples.values()) group.sort((left, right) => left.repetition - right.repetition);

  const scoresByRetriever = new Map<string, ReadonlyMap<string, QueryScore>>();
  for (const { id: retrieverId } of corpus.retrievers) {
    const scores = new Map<string, QueryScore>();
    if (qualityProfile !== undefined) {
      for (const query of queries) {
        const samples = groupedSamples.get(sampleGroupKey(retrieverId, qualityProfile.id, query.id)) ?? [];
        const completeRepetitions = samples.length === qualityProfile.repetitions
          && samples.every((sample, index) => sample.repetition === index + 1);
        const faults = faultsByRetriever.get(retrieverId);
        if (!completeRepetitions) {
          if (faults !== undefined) faults.missingQualityObservations += 1;
          continue;
        }
        if (samples.some(({ status }) => status === "failed" || status === "unavailable")) continue;
        const sourceFamilyClusterId = clusterIdByQuery.get(query.id);
        if (sourceFamilyClusterId === undefined) {
          throw new TypeError(`Analysis lost source-family cluster for query ${query.id}.`);
        }
        scores.set(query.id, aggregateRepetitions(
          query,
          samples,
          cutoff,
          evidenceById,
          sourceFamilyClusterId,
        ));
      }
    }
    scoresByRetriever.set(retrieverId, scores);
  }

  const slices = analysisSlices(queries);
  const retrievers = corpus.retrievers.map(({ id: retrieverId }): EvaluationRetrieverQualitySummaryV2 => {
    const faults = faultsByRetriever.get(retrieverId);
    if (faults === undefined) throw new TypeError(`Analysis lost retriever ${retrieverId}.`);
    return Object.freeze({
      retrieverId,
      queryCount: queries.length,
      slices: Object.freeze(slices.map((slice) =>
        sliceSummary(slice, queries, scoresByRetriever.get(retrieverId) ?? new Map()))),
      acceptedEvidenceUnits: faults.acceptedEvidenceUnits,
      provenanceCoveredEvidenceUnits: faults.provenanceCoveredEvidenceUnits,
      provenanceCoverage: faults.acceptedEvidenceUnits === 0
        ? 1
        : faults.provenanceCoveredEvidenceUnits / faults.acceptedEvidenceUnits,
      failedSamples: faults.failedSamples,
      unavailableWarmQuerySamples: faults.unavailableWarmQuerySamples,
      unavailableQualitySamples: faults.unavailableQualitySamples,
      missingQualityObservations: faults.missingQualityObservations,
      nonzeroLlmAccountingSamples: faults.nonzeroLlmAccountingSamples,
    });
  });

  let bootstrapDraws = 0;
  const pairedEffects: EvaluationPairedEffectV2[] = [];
  const comparisonByKey = new Map<string, EvaluationPairedEffectV2>();
  const baselineScores = scoresByRetriever.get(baselineRetrieverId) ?? new Map<string, QueryScore>();
  const officialCandidateIds = new Set(corpus.candidateLock.candidateRetrieverIds);
  for (const candidateRetrieverId of alternativeRetrieverIds) {
    const candidateScores = scoresByRetriever.get(candidateRetrieverId) ?? new Map<string, QueryScore>();
    for (const slice of slices) {
      const slicedQueries = queries.filter((query) => queryInSlice(query, slice));
      for (const metric of QUALITY_METRICS) {
        const officialCandidate = officialCandidateIds.has(candidateRetrieverId);
        const neededForAblationGate = (
          slice.kind === "cohort"
          && corpus.experiment.protocol.minimumUsefulEffects.some((effect) =>
            effect.metric === metric && effect.cohort === slice.cohort)
        ) || (
          slice.kind === "cohort-primary-stratum"
          && (
            metric === "decision-accuracy"
            || metric === "context-precision"
            || metric === "document-recall-at-k"
            || metric === "evidence-recall-at-k"
          )
        );
        if (!officialCandidate && !neededForAblationGate) continue;
        const comparison = pairedEffect({
          baselineRetrieverId,
          candidateRetrieverId,
          metric,
          slice,
          queries: slicedQueries,
          baselineScores,
          candidateScores,
          suiteSha256: report.suiteSha256,
          bootstrapResamples,
        });
        if (comparison === undefined) continue;
        bootstrapDraws += comparison.observedPairs * bootstrapResamples;
        if (bootstrapDraws > MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2) {
          throw new RangeError(
            `Analysis bootstrap would exceed ${MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2} paired draws.`,
          );
        }
        pairedEffects.push(comparison);
        comparisonByKey.set(comparisonKey(candidateRetrieverId, metric, slice.id), comparison);
      }
    }
  }

  const latencyProfiles: EvaluationLatencyProfileSummaryV2[] = [];
  const promotionLatencyByKey = new Map<string, EvaluationLatencyProfileSummaryV2>();
  for (const { id: retrieverId } of corpus.retrievers) {
    for (const profile of corpus.measurementProfiles) {
      const samples = profileSamples.get(`${retrieverId}\0${profile.id}`) ?? [];
      const observedSamples = samples
        .filter(({ status }) => status === "ready" || status === "degraded");
      const values = observedSamples.map((sample) => operationDuration(sample, profile.operation));
      const summary = Object.freeze({
        retrieverId,
        profileId: profile.id,
        operation: profile.operation,
        cacheState: profile.cacheState,
        expectedObservations: expectedProfileObservations(profile, queries.length),
        observedObservations: values.length,
        p95Ms: percentile(values, 0.95),
      });
      latencyProfiles.push(summary);
      promotionLatencyByKey.set(`${retrieverId}\0${profile.id}`, Object.freeze({
        ...summary,
        p95Ms: percentile(observedSamples.map((sample) =>
          promotionOperationDuration(sample, profile.operation)), 0.95),
      }));
    }
  }

  const retrieverSummaryById = new Map(retrievers.map((summary) => [summary.retrieverId, summary]));
  const retrieverGates = alternativeRetrieverIds.map((candidateRetrieverId): EvaluationCandidateGateV2 => {
    const reasons: EvaluationCandidateGateReasonV2[] = [];
    const checks: EvaluationCandidateGateCheckV2[] = [];
    const candidateScores = scoresByRetriever.get(candidateRetrieverId) ?? new Map<string, QueryScore>();
    if (qualityProfiles.length === 0) {
      reasons.push(Object.freeze({
        code: "missing-quality-profile",
        message: "The sealed corpus has no packing profile for packed-context quality inference.",
      }));
    } else if (qualityProfiles.length > 1) {
      reasons.push(Object.freeze({
        code: "missing-quality-profile",
        message: "The sealed corpus has more than one packing profile and analysis will not mix them.",
        count: qualityProfiles.length,
      }));
    }
    for (const retrieverId of [baselineRetrieverId, candidateRetrieverId]) {
      const summary = retrieverSummaryById.get(retrieverId);
      if (summary === undefined) continue;
      if (summary.failedSamples > 0) {
        reasons.push(Object.freeze({
          code: "failed-sample",
          message: `Retriever ${retrieverId} has failed samples.`,
          retrieverId,
          count: summary.failedSamples,
        }));
      }
      if (summary.unavailableWarmQuerySamples > 0) {
        reasons.push(Object.freeze({
          code: "unavailable-warm-query-sample",
          message: `Retriever ${retrieverId} has unavailable warm-query samples.`,
          retrieverId,
          count: summary.unavailableWarmQuerySamples,
        }));
      }
      if (summary.unavailableQualitySamples > 0) {
        reasons.push(Object.freeze({
          code: "unavailable-quality-sample",
          message: `Retriever ${retrieverId} has unavailable packed-context quality samples.`,
          retrieverId,
          count: summary.unavailableQualitySamples,
        }));
      }
      if (summary.missingQualityObservations > 0) {
        reasons.push(Object.freeze({
          code: "missing-eligible-observations",
          message: `Retriever ${retrieverId} is missing complete packing repetition clusters.`,
          retrieverId,
          count: summary.missingQualityObservations,
        }));
      }
      if (summary.nonzeroLlmAccountingSamples > 0) {
        reasons.push(Object.freeze({
          code: "nonzero-llm-accounting",
          message: `Retriever ${retrieverId} reports nonzero LLM accounting.`,
          retrieverId,
          count: summary.nonzeroLlmAccountingSamples,
        }));
      }
      if (summary.provenanceCoverage !== 1) {
        reasons.push(Object.freeze({
          code: "provenance-below-100-percent",
          message: `Retriever ${retrieverId} has provenance coverage below 100 percent.`,
          retrieverId,
        }));
      }
    }

    for (const effect of corpus.experiment.protocol.minimumUsefulEffects) {
      const sliceId = `cohort:${effect.cohort}` as const;
      const comparison = comparisonByKey.get(comparisonKey(candidateRetrieverId, effect.metric, sliceId));
      const insufficientIndependentPairs = comparison !== undefined
        && comparison.observedPairs === comparison.eligibleQueries
        && comparison.sourceFamilyClusters < corpus.experiment.protocol.pairedPower.requiredPairs;
      if (
        comparison === undefined
        || comparison.eligibleQueries === 0
        || comparison.observedPairs !== comparison.eligibleQueries
        || insufficientIndependentPairs
        || comparison.inferenceStatus !== "estimable"
      ) {
        checks.push(Object.freeze({
          kind: "minimum-useful-effect",
          metric: effect.metric,
          status: "not-evaluable",
          sliceId,
          ...(comparison === undefined
            ? {}
            : {
                eligibleQueries: comparison.eligibleQueries,
                observedPairs: comparison.observedPairs,
                sourceFamilyClusters: comparison.sourceFamilyClusters,
              }),
          requiredImprovement: effect.minimumAbsoluteDifference,
        }));
        reasons.push(insufficientIndependentPairs
          ? Object.freeze({
              code: "insufficient-independent-pairs" as const,
              message: `Metric ${effect.metric} has ${comparison.sourceFamilyClusters} independent source-family pairs but requires ${corpus.experiment.protocol.pairedPower.requiredPairs} for ${sliceId}.`,
              metric: effect.metric,
              sliceId,
              count: comparison.sourceFamilyClusters,
            })
          : Object.freeze({
              code: "missing-eligible-observations" as const,
              message: `Metric ${effect.metric} lacks complete clustered pairs for ${sliceId}.`,
              metric: effect.metric,
              sliceId,
            }));
        continue;
      }
      const passed = comparison.favorableOneSidedLower >= effect.minimumAbsoluteDifference;
      checks.push(Object.freeze({
        kind: "minimum-useful-effect",
        metric: effect.metric,
        status: passed ? "passed" : "failed",
        sliceId,
        eligibleQueries: comparison.eligibleQueries,
        observedPairs: comparison.observedPairs,
        sourceFamilyClusters: comparison.sourceFamilyClusters,
        observedEffect: comparison.favorableInterval.observedDifference,
        confidenceLower: comparison.favorableOneSidedLower,
        confidenceUpper: comparison.favorableInterval.upper,
        requiredImprovement: effect.minimumAbsoluteDifference,
      }));
      if (!passed) {
        reasons.push(Object.freeze({
          code: "minimum-useful-effect-not-met",
          message: `Metric ${effect.metric} does not clear its minimum useful effect for ${sliceId}.`,
          metric: effect.metric,
          sliceId,
        }));
      }
    }

    for (const margin of corpus.experiment.protocol.nonInferiorityMargins) {
      const stratum = ACCURACY_STRATUM_BY_METRIC[margin.metric as keyof typeof ACCURACY_STRATUM_BY_METRIC];
      const qualityMetric = stratum === undefined && QUALITY_NONINFERIORITY_METRICS.has(margin.metric)
        ? margin.metric as EvaluationQualityMetricV2
        : stratum === undefined
          ? undefined
          : "decision-accuracy" as const;
      if (qualityMetric !== undefined) {
        const targetSlices: readonly Extract<
          EvaluationAnalysisSliceV2,
          { readonly kind: "cohort-primary-stratum" }
        >[] = stratum === undefined
          ? slices.filter((slice): slice is Extract<
              EvaluationAnalysisSliceV2,
              { readonly kind: "cohort-primary-stratum" }
            > => slice.kind === "cohort-primary-stratum")
          : COHORTS.map((cohort) => Object.freeze({
              id: `cohort:${cohort}:primary-stratum:${stratum}` as const,
              kind: "cohort-primary-stratum" as const,
              cohort,
              primaryStratum: stratum,
            }));
        for (const targetSlice of targetSlices) {
          const sliceId = targetSlice.id;
          const guard = observedNoRegressionGuard({
            metric: qualityMetric,
            slice: targetSlice,
            queries,
            baselineScores,
            candidateScores,
          });
          if (guard.eligibleQueries === 0) continue;
          if (guard.observedPairs !== guard.eligibleQueries) {
            checks.push(Object.freeze({
              kind: "observed-no-regression",
              metric: margin.metric,
              status: "not-evaluable",
              sliceId,
              eligibleQueries: guard.eligibleQueries,
              observedPairs: guard.observedPairs,
              regressedPairs: guard.regressedPairs,
            }));
            reasons.push(Object.freeze({
              code: "missing-eligible-observations",
              message: `Metric ${margin.metric} lacks complete paired observations for the observed zero-regression guard in ${sliceId}.`,
              metric: margin.metric,
              sliceId,
            }));
            continue;
          }
          const passed = guard.regressedPairs === 0;
          checks.push(Object.freeze({
            kind: "observed-no-regression",
            metric: margin.metric,
            status: passed ? "passed" : "failed",
            sliceId,
            ...(guard.observedEffect === null ? {} : { observedEffect: guard.observedEffect }),
            eligibleQueries: guard.eligibleQueries,
            observedPairs: guard.observedPairs,
            regressedPairs: guard.regressedPairs,
          }));
          if (!passed) {
            reasons.push(Object.freeze({
              code: "observed-query-regression",
              message: `Metric ${margin.metric} has ${guard.regressedPairs} observed paired-query regressions for ${sliceId}.`,
              metric: margin.metric,
              sliceId,
              count: guard.regressedPairs,
            }));
          }
        }
        continue;
      }
      const operation = LATENCY_OPERATION_BY_METRIC[margin.metric as keyof typeof LATENCY_OPERATION_BY_METRIC];
      if (operation === undefined) continue;
      const profiles = corpus.measurementProfiles.filter((profile) => profile.operation === operation);
      if (profiles.length === 0) {
        checks.push(Object.freeze({
          kind: "noninferiority-latency",
          metric: margin.metric,
          status: "not-evaluable",
        }));
        reasons.push(Object.freeze({
          code: "missing-eligible-observations",
          message: `Metric ${margin.metric} has no matching sealed operation profile.`,
          metric: margin.metric,
        }));
        continue;
      }
      for (const profile of profiles) {
        const baseline = promotionLatencyByKey.get(`${baselineRetrieverId}\0${profile.id}`);
        const candidate = promotionLatencyByKey.get(`${candidateRetrieverId}\0${profile.id}`);
        if (
          baseline?.p95Ms === null
          || baseline?.p95Ms === undefined
          || candidate?.p95Ms === null
          || candidate?.p95Ms === undefined
          || baseline.observedObservations !== baseline.expectedObservations
          || candidate.observedObservations !== candidate.expectedObservations
        ) {
          checks.push(Object.freeze({
            kind: "noninferiority-latency",
            metric: margin.metric,
            status: "not-evaluable",
            profileId: profile.id,
          }));
          reasons.push(Object.freeze({
            code: "missing-eligible-observations",
            message: `Metric ${margin.metric} lacks complete observations for profile ${profile.id}.`,
            metric: margin.metric,
            profileId: profile.id,
          }));
          continue;
        }
        const allowedRegression = Math.max(
          margin.maximumAbsoluteRegression,
          baseline.p95Ms * margin.maximumRelativeRegression,
        );
        const observedEffect = candidate.p95Ms - baseline.p95Ms;
        const passed = observedEffect <= allowedRegression;
        checks.push(Object.freeze({
          kind: "noninferiority-latency",
          metric: margin.metric,
          status: passed ? "passed" : "failed",
          profileId: profile.id,
          baselineObserved: baseline.p95Ms,
          candidateObserved: candidate.p95Ms,
          observedEffect,
          allowedRegression,
          durationScope: operation === "packing"
            ? "context-ready-elapsed"
            : "query-operation",
        }));
        if (!passed) {
          reasons.push(Object.freeze({
            code: "noninferiority-margin-exceeded",
            message: `Metric ${margin.metric} exceeds its noninferiority allowance for profile ${profile.id}.`,
            metric: margin.metric,
            profileId: profile.id,
          }));
        }
      }
    }
    const canonical = canonicalReasons(reasons);
    return Object.freeze({
      baselineRetrieverId,
      candidateRetrieverId,
      passed: canonical.length === 0 && checks.every(({ status }) => status === "passed"),
      checks: Object.freeze(checks),
      reasons: canonical,
    });
  });
  const candidateGates = retrieverGates.filter(({ candidateRetrieverId }) =>
    officialCandidateIds.has(candidateRetrieverId));
  const gateByRetrieverId = new Map(retrieverGates.map((gate) => [gate.candidateRetrieverId, gate]));
  const complexity = corpus.retrievers
    .filter((descriptor): descriptor is typeof descriptor & { readonly role: "ablation" | "candidate" } =>
      descriptor.role === "ablation" || descriptor.role === "candidate")
    .map((descriptor) => Object.freeze({
      retrieverId: descriptor.id,
      role: descriptor.role,
      score: variantComplexity(descriptor),
    }))
    .toSorted(compareVariantComplexity);
  const passingRetrieverIds = complexity
    .filter(({ retrieverId }) => gateByRetrieverId.get(retrieverId)?.passed === true)
    .map(({ retrieverId }) => retrieverId);
  const passingComplexity = complexity.filter(({ retrieverId }) =>
    gateByRetrieverId.get(retrieverId)?.passed === true);
  const incrementalChecks: EvaluationVariantIncrementalCheckV2[] = [];
  let selectedRetrieverId: string | null = null;
  for (const candidate of passingComplexity) {
    if (candidate.role !== "candidate" || !officialCandidateIds.has(candidate.retrieverId)) continue;
    const simpler = passingComplexity.filter((baseline) =>
      isStrictlySimplerVariant(baseline, candidate));
    if (simpler.length === 0) {
      selectedRetrieverId = candidate.retrieverId;
      continue;
    }
    let clearsEverySimplerVariant = true;
    for (const baseline of simpler) {
      for (const effect of corpus.experiment.protocol.minimumUsefulEffects) {
        const sliceId = `cohort:${effect.cohort}` as const;
        const slice = slices.find((entry) => entry.id === sliceId);
        if (slice === undefined) throw new Error(`Analysis lost incremental slice ${sliceId}.`);
        const comparison = pairedEffect({
          baselineRetrieverId: baseline.retrieverId,
          candidateRetrieverId: candidate.retrieverId,
          metric: effect.metric,
          slice,
          queries,
          baselineScores: scoresByRetriever.get(baseline.retrieverId) ?? new Map(),
          candidateScores: scoresByRetriever.get(candidate.retrieverId) ?? new Map(),
          suiteSha256: report.suiteSha256,
          bootstrapResamples,
        });
        if (comparison !== undefined) {
          bootstrapDraws += comparison.observedPairs * bootstrapResamples;
          if (bootstrapDraws > MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2) {
            throw new RangeError(
              `Analysis bootstrap would exceed ${MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2} paired draws.`,
            );
          }
          pairedEffects.push(comparison);
        }
        const completeAndPowered = comparison !== undefined
          && comparison.eligibleQueries > 0
          && comparison.observedPairs === comparison.eligibleQueries
          && comparison.sourceFamilyClusters >= corpus.experiment.protocol.pairedPower.requiredPairs
          && comparison.inferenceStatus === "estimable";
        const passed = completeAndPowered
          && comparison.favorableOneSidedLower >= effect.minimumAbsoluteDifference;
        const status = !completeAndPowered ? "not-evaluable" as const : passed ? "passed" as const : "failed" as const;
        incrementalChecks.push(Object.freeze({
          baselineRetrieverId: baseline.retrieverId,
          candidateRetrieverId: candidate.retrieverId,
          metric: effect.metric,
          sliceId,
          status,
          eligibleQueries: comparison?.eligibleQueries ?? queries.filter((query) =>
            queryInSlice(query, slice) && metricEligible(query, effect.metric)).length,
          observedPairs: comparison?.observedPairs ?? 0,
          sourceFamilyClusters: comparison?.sourceFamilyClusters ?? 0,
          requiredImprovement: effect.minimumAbsoluteDifference,
          ...(comparison === undefined ? {} : {
            observedEffect: comparison.favorableInterval.observedDifference,
            confidenceLower: comparison.favorableOneSidedLower,
            confidenceUpper: comparison.favorableInterval.upper,
          }),
        }));
        if (!passed) clearsEverySimplerVariant = false;
      }
    }
    if (clearsEverySimplerVariant) selectedRetrieverId = candidate.retrieverId;
  }
  const variantSelection = Object.freeze({
    baselineRetrieverId,
    orderedRetrieverIds: Object.freeze(complexity.map(({ retrieverId }) => retrieverId)),
    passingRetrieverIds: Object.freeze(passingRetrieverIds),
    selectedRetrieverId,
    incrementalChecks: Object.freeze(incrementalChecks),
    complexity: Object.freeze(complexity),
  });

  return Object.freeze({
    schemaVersion: 2,
    suiteSha256: report.suiteSha256,
    candidateLockSha256: report.candidateLockSha256,
    split: report.split,
    cutoff,
    bootstrap: Object.freeze({
      confidence: 0.95 as const,
      resamples: bootstrapResamples,
      draws: bootstrapDraws,
    }),
    warmQueryProfileId: warmProfile?.id ?? null,
    qualityProfileId: qualityProfile?.id ?? null,
    slices,
    retrievers: Object.freeze(retrievers),
    pairedEffects: Object.freeze(pairedEffects),
    latencyProfiles: Object.freeze(latencyProfiles),
    candidateGates: Object.freeze(candidateGates),
    retrieverGates: Object.freeze(retrieverGates),
    variantSelection,
  });
}
