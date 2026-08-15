import { createHash } from "node:crypto";

export const RETRIEVAL_EVALUATION_V2_SCHEMA_VERSION = 2;
export const RETRIEVAL_EVALUATION_V2_PROTOCOL = "kb-retrieval-evaluation-v2";
export const PROMOTION_EVALUATION_QUERY_COUNT_V2 = 168;
export const PROMOTION_DEVELOPMENT_QUERY_COUNT_V2 = 48;
export const PROMOTION_TEST_QUERY_COUNT_V2 = 120;
export const PROMOTION_TEST_SUPPORTED_COUNT_V2 = 80;
export const PROMOTION_TEST_INSUFFICIENT_COUNT_V2 = 40;
export const PROMOTION_COHORT_COUNT_V2 = 84;
export const PROMOTION_TEST_COHORT_COUNT_V2 = 60;
export const PROMOTION_DUAL_ASSESSMENT_MINIMUM_V2 = 42;
export const PROMOTION_STRATUM_COHORT_DUAL_FRACTION_V2 = 0.25;
export const PROMOTION_STRATUM_COHORT_DUAL_MINIMUM_V2 = 2;

export const MAX_EVALUATION_V2_QUERIES = 2_000;
export const MAX_EVALUATION_V2_DOCUMENTS = 20_000;
export const MAX_EVALUATION_V2_EVIDENCE_UNITS = 100_000;
export const MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY = 2_000;
export const MAX_EVALUATION_V2_NUGGETS_PER_QUERY = 100;
export const MAX_EVALUATION_V2_SUPPORT_SETS_PER_NUGGET = 100;
export const MAX_EVALUATION_V2_RESULTS_PER_LANE = 1_000;
export const MAX_EVALUATION_V2_TRACE_DECISIONS = 10_000;
export const MAX_EVALUATION_V2_SAMPLES = 2_000_000;
export const MAX_EVALUATION_V2_TEXT_BYTES = 16 * 1_024;
export const MAX_EVALUATION_V2_REPORT_TRACE_ITEMS = 5_000_000;
export const MAX_EVALUATION_V2_REPORT_PROVENANCE_ITEMS = 5_000_000;
export const MAX_EVALUATION_V2_REPORT_TRACE_BYTES = 256 * 1_024 * 1_024;
export const MAX_EVALUATION_V2_REPORT_PROVENANCE_BYTES = 128 * 1_024 * 1_024;
export const MAX_EVALUATION_V2_REPORT_RAW_EVIDENCE_ITEMS = 5_000_000;
export const MAX_EVALUATION_V2_REPORT_RAW_EVIDENCE_BYTES = 256 * 1_024 * 1_024;

const MAX_EVALUATION_V2_PACKED_CONTEXT_EVIDENCE_UNITS = 10_000;
const MAX_EVALUATION_V2_RAW_EVIDENCE_PER_SAMPLE = 10_000;
const MAX_EVALUATION_V2_RAW_EVIDENCE_DEPTH = 12;
const MAX_EVALUATION_V2_RAW_EVIDENCE_ARRAY_ITEMS = 10_000;
const MAX_EVALUATION_V2_RAW_EVIDENCE_OBJECT_FIELDS = 1_000;
const MAX_EVALUATION_V2_RAW_EVIDENCE_STRING_BYTES = 64 * 1_024;
const MAX_EVALUATION_V2_RAW_EVIDENCE_BYTES_PER_SAMPLE = 8 * 1_024 * 1_024;
const MAX_EVALUATION_V2_REPORT_PACKED_CONTEXT_ITEMS = 5_000_000;
const MAX_EVALUATION_V2_REPORT_PACKED_CONTEXT_BYTES = 128 * 1_024 * 1_024;
const EMPTY_PACKED_CONTEXT_SHA256 = createHash("sha256").update(Buffer.alloc(0)).digest("hex");

export type EvaluationSplitV2 = "development" | "test";
export type EvaluationCohortV2 = "caller-seeded" | "text-only";
export type EvaluationExpectedSupportV2 = "insufficient" | "supported";
export type EvaluationNegativeSubtypeV2 =
  | "boundary-near-miss"
  | "conflicting-evidence"
  | "missing-required-support"
  | "stale-only"
  | "topical-near-miss"
  | "unknown-entity";

export type EvaluationStratumV2 =
  | "active-current-state"
  | "code-path-context"
  | "conceptual-recall"
  | "exact-identity"
  | "local-context"
  | "metadata-constraint"
  | "multi-note-relational"
  | "no-answer-near-miss"
  | "source-provenance"
  | "temporal-stale-current";

export const PROMOTION_CRITICAL_STRATUM_MINIMA_V2 = Object.freeze({
  "local-context": 20,
  "multi-note-relational": 20,
  "source-provenance": 20,
  "temporal-stale-current": 20,
} satisfies Readonly<Partial<Record<EvaluationStratumV2, number>>>);

export const PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2 = Object.freeze({
  "active-current-state": 8,
  "code-path-context": 8,
  "conceptual-recall": 8,
  "exact-identity": 8,
  "local-context": 20,
  "metadata-constraint": 8,
  "multi-note-relational": 20,
  "source-provenance": 20,
  "temporal-stale-current": 20,
} satisfies Readonly<Partial<Record<EvaluationStratumV2, number>>>);

export const PROMOTION_ACCEPTANCE_STRATUM_COHORT_MINIMA_V2 = Object.freeze({
  "active-current-state": 4,
  "code-path-context": 4,
  "conceptual-recall": 4,
  "exact-identity": 4,
  "local-context": 10,
  "metadata-constraint": 4,
  "multi-note-relational": 10,
  "source-provenance": 10,
  "temporal-stale-current": 10,
} satisfies Readonly<Partial<Record<EvaluationStratumV2, number>>>);

export type EvaluationLaneIdV2 =
  | "exact"
  | "git"
  | "graph"
  | "hybrid"
  | "keyword"
  | "metadata"
  | "note"
  | "path-context"
  | "semantic";

export const PROMOTION_CRITICAL_INPUT_MINIMA_V2 = Object.freeze({
  context: 20,
  graph: 20,
  history: 20,
  metadata: 20,
} as const);

export type EvaluationInputLaneV2 =
  | "context"
  | "graph"
  | "history"
  | "metadata"
  | "noteId"
  | "text";

export type EvaluationInputOriginV2 = "caller" | "query-text";

export type EvaluationTrustClassV2 =
  | "authoritative-current"
  | "authoritative-historical"
  | "captured-primary"
  | "captured-secondary"
  | "maintained-synthesis"
  | "untrusted-capture";

export type EvaluationSourceClassV2 =
  | "authored-note"
  | "captured-source"
  | "git-history"
  | "repository-file";

export const EVALUATION_SOURCE_TRUST_COMPATIBILITY_V2 = Object.freeze({
  "authored-note": Object.freeze([
    "authoritative-current",
    "authoritative-historical",
    "maintained-synthesis",
  ]),
  "captured-source": Object.freeze([
    "captured-primary",
    "captured-secondary",
    "untrusted-capture",
  ]),
  "git-history": Object.freeze(["authoritative-historical"]),
  "repository-file": Object.freeze(["authoritative-current"]),
} satisfies Readonly<Record<EvaluationSourceClassV2, readonly EvaluationTrustClassV2[]>>);

export type EvaluationMetadataFilterV2 =
  | { readonly kind: "exists"; readonly path: string }
  | {
      readonly kind: "equals";
      readonly path: string;
      readonly value: string | number | boolean | null;
    };

export type EvaluationRetrievalInputsV2 = {
  readonly text: string;
  readonly noteId?: string;
  readonly metadata?: {
    readonly filters: readonly EvaluationMetadataFilterV2[];
    readonly tags: readonly string[];
  };
  readonly graph?: {
    readonly seeds: readonly string[];
    readonly depth: 1 | 2;
  };
  readonly context?: {
    readonly repositoryPath: string;
  };
  readonly history?: {
    readonly query: string;
    readonly noteIds: readonly string[];
  };
};

export type EvaluationInputOriginDeclarationV2 = {
  readonly lane: EvaluationInputLaneV2;
  readonly origin: EvaluationInputOriginV2;
};

export type EvaluationSourceFamilyV2 = {
  readonly id: string;
  readonly sourceClass: EvaluationSourceClassV2;
  readonly trustClass: EvaluationTrustClassV2;
  /**
   * Opaque commitment to the private, independently reviewed family assignment.
   * Catalog-only families may omit it, but every family referenced by a promotion
   * query must carry one.
   */
  readonly familyAssignmentSha256?: string;
};

export type EvaluationDocumentV2 = {
  readonly id: string;
  /** Canonical vault-relative path bound independently of graded qrels. */
  readonly sourcePath: string;
  readonly sourceFamilyId: string;
  readonly trustClass: EvaluationTrustClassV2;
};

export type EvaluationLineRangeV2 = {
  readonly start: number;
  readonly end: number;
};

export type EvaluationEvidenceUnitV2 = {
  readonly id: string;
  readonly documentId: string;
  readonly sourceFamilyId: string;
  readonly trustClass: EvaluationTrustClassV2;
  readonly sourcePath: string;
  readonly lineRange: EvaluationLineRangeV2;
  readonly headingPath: readonly string[];
  readonly sourcePage?: number;
};

export type EvaluationDocumentJudgmentV2 = {
  readonly documentId: string;
  readonly relevance: 0 | 1 | 2 | 3;
};

export type EvaluationEvidenceUnitJudgmentV2 = {
  readonly evidenceUnitId: string;
  readonly relevance: 0 | 1 | 2 | 3;
};

export type EvaluationAcceptableSupportSetV2 = {
  readonly id: string;
  readonly evidenceUnitIds: readonly string[];
};

export type EvaluationAtomicNuggetV2 = {
  readonly id: string;
  readonly text: string;
  readonly required: boolean;
  readonly acceptableSupportSets: readonly EvaluationAcceptableSupportSetV2[];
};

export type EvaluationGoldJudgmentV2 = {
  readonly documents: readonly EvaluationDocumentJudgmentV2[];
  readonly evidenceUnits: readonly EvaluationEvidenceUnitJudgmentV2[];
  readonly nuggets: readonly EvaluationAtomicNuggetV2[];
};

export type EvaluationRawAssessorJudgmentV2 = {
  readonly assessorId: string;
  readonly expectedSupport: EvaluationExpectedSupportV2;
  readonly documents: readonly EvaluationDocumentJudgmentV2[];
  readonly evidenceUnits: readonly EvaluationEvidenceUnitJudgmentV2[];
  readonly nuggets: readonly {
    readonly nuggetId: string;
    readonly required: boolean;
    readonly acceptableSupportSetIds: readonly string[];
  }[];
};

export type EvaluationAdjudicationV2 =
  | { readonly status: "single-assessor" }
  | { readonly status: "agreed" }
  | {
      readonly status: "resolved";
      readonly adjudicatorId: string;
      readonly rationale: string;
    };

export type EvaluationQueryV2 = {
  readonly id: string;
  readonly text: string;
  readonly split: EvaluationSplitV2;
  readonly cohort: EvaluationCohortV2;
  readonly strata: readonly EvaluationStratumV2[];
  readonly primaryStratum: EvaluationStratumV2;
  readonly expectedSupport: EvaluationExpectedSupportV2;
  readonly primaryLane: EvaluationLaneIdV2;
  readonly negativeSubtype?: EvaluationNegativeSubtypeV2;
  readonly inputs: EvaluationRetrievalInputsV2;
  readonly inputOrigins: readonly EvaluationInputOriginDeclarationV2[];
  readonly gold: EvaluationGoldJudgmentV2;
  readonly rawAssessments: readonly EvaluationRawAssessorJudgmentV2[];
  readonly adjudication: EvaluationAdjudicationV2;
};

export type EvaluationAssessorV2 = {
  readonly id: string;
  readonly displayName?: string;
  readonly affiliation?: string;
};

export type EvaluationMeasurementOperationV2 =
  | "cold-index"
  | "four-reader-query"
  | "incremental-update"
  | "packing"
  | "warm-query";

export type EvaluationMeasurementProfileV2 = {
  readonly id: string;
  readonly operation: EvaluationMeasurementOperationV2;
  readonly scope: "query" | "retriever";
  readonly cacheState: "changed-generation" | "cold" | "not-applicable" | "warm";
  readonly concurrency: number;
  readonly repetitions: number;
};

export type EvaluationMinimumUsefulEffectMetricV2 =
  | "document-recall-at-k"
  | "evidence-recall-at-k"
  | "false-abstention-rate"
  | "no-answer-accuracy"
  | "nugget-coverage";

export type EvaluationNonInferiorityMetricV2 =
  | "active-current-state-accuracy"
  | "code-path-context-accuracy"
  | "context-precision"
  | "conceptual-recall-accuracy"
  | "document-recall-at-k"
  | "evidence-recall-at-k"
  | "exact-identity-accuracy"
  | "local-context-accuracy"
  | "metadata-constraint-accuracy"
  | "multi-note-relational-accuracy"
  | "source-provenance-accuracy"
  | "temporal-stale-current-accuracy"
  | "four-reader-query-p95-ms"
  | "packing-p95-ms"
  | "warm-query-p95-ms";

export type EvaluationPairedPowerV2 = {
  /** One-sided type-I error used for the positive primary effect gate. */
  readonly alpha: number;
  readonly targetPower: number;
  /** Assumed probability that a paired observation differs in either direction. */
  readonly assumedDiscordantRate: number;
  /** Assumed true favorable paired difference used by the prospective calculation. */
  readonly assumedEffect: number;
  /** Lower confidence-bound threshold required by the corresponding MUE gate. */
  readonly minimumUsefulEffect: number;
  /** Exact result of requiredPairedObservationsV2 for the preceding assumptions. */
  readonly requiredPairs: number;
};

export type EvaluationExperimentV2 = {
  readonly protocol: {
    readonly minimumUsefulEffects: readonly {
      readonly metric: EvaluationMinimumUsefulEffectMetricV2;
      readonly cohort: EvaluationCohortV2;
      readonly minimumAbsoluteDifference: number;
    }[];
    readonly nonInferiorityMargins: readonly {
      readonly metric: EvaluationNonInferiorityMetricV2;
      readonly maximumAbsoluteRegression: number;
      readonly maximumRelativeRegression: number;
    }[];
    readonly pairedPower: EvaluationPairedPowerV2;
    readonly contextCeilings: {
      readonly utf8Bytes: number;
      readonly readerTokens: number;
    };
  };
  readonly environment: {
    readonly tokenizer: {
      readonly id: string;
      readonly sha256: string;
    };
    readonly runtime: {
      readonly id: string;
      readonly sha256: string;
    };
    readonly hardware: {
      readonly id: string;
    };
    readonly localModel:
      | { readonly kind: "none" }
      | {
          readonly kind: "model";
          readonly id: string;
          readonly sha256: string;
        };
    readonly cache: {
      readonly preparation: string;
      readonly fingerprintSha256: string;
    };
    readonly fourReaderBatch: {
      readonly id: string;
      readonly sha256: string;
    };
    readonly incrementalMutation: {
      readonly sourcePath: string;
      readonly appendUtf8Sha256: string;
      readonly expectedPostMutationSha256: string;
    };
  };
};

export type EvaluationRetrieverDescriptorV2 = {
  readonly id: string;
  readonly role: "ablation" | "baseline" | "candidate";
  readonly version: string;
  readonly implementationSha256: string;
  readonly lanes: readonly EvaluationLaneIdV2[];
  readonly configuration: Readonly<Record<string, string | number | boolean | null>>;
};

export type EvaluationCandidateLockV2 = {
  readonly baselineRetrieverId: string;
  readonly candidateRetrieverIds: readonly string[];
  readonly descriptorDigests: readonly {
    readonly retrieverId: string;
    readonly sha256: string;
  }[];
};

export type RetrievalEvaluationCorpusV2 = {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly description: string;
  readonly manifest: {
    readonly protocol: "kb-retrieval-evaluation-v2";
    readonly sealedAt: string;
    readonly corpusSha256: string;
    readonly candidateLockSha256: string;
    /** SHA-256 of the canonical immutable build.json bytes used to compile this corpus. */
    readonly buildContractSha256: string;
  };
  readonly frozen: {
    readonly repositoryCommit: string;
    readonly vaultTree: string;
    readonly vaultRoot: string;
  };
  readonly assessment: {
    readonly rubricVersion: string;
    readonly assessors: readonly EvaluationAssessorV2[];
  };
  readonly experiment: EvaluationExperimentV2;
  readonly sourceFamilies: readonly EvaluationSourceFamilyV2[];
  readonly documents: readonly EvaluationDocumentV2[];
  readonly evidenceUnits: readonly EvaluationEvidenceUnitV2[];
  readonly measurementProfiles: readonly EvaluationMeasurementProfileV2[];
  readonly retrievers: readonly EvaluationRetrieverDescriptorV2[];
  readonly candidateLock: EvaluationCandidateLockV2;
  readonly queries: readonly EvaluationQueryV2[];
};

export type EvaluationExecutionQueryV2 = {
  readonly inputs: EvaluationRetrievalInputsV2;
};

export type EvaluationExecutionRequestV2 = {
  readonly corpus: RetrievalEvaluationCorpusV2["frozen"];
  readonly query: EvaluationExecutionQueryV2;
  readonly limit: number;
  readonly signal: AbortSignal;
};

export type EvaluationRetrieverV2 = {
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly retrieve: (request: EvaluationExecutionRequestV2) => Promise<unknown>;
};

export type EvaluationEvidenceLocatorV2 = {
  readonly evidenceUnitId: string;
  readonly sourceFamilyId: string;
  readonly sourceClass: EvaluationSourceClassV2;
  readonly trustClass: EvaluationTrustClassV2;
  readonly sourcePath: string;
  readonly lineRange: EvaluationLineRangeV2;
  readonly headingPath: readonly string[];
  readonly sourcePage?: number;
};

export type EvaluationRankedCandidateV2 = {
  readonly documentId: string;
  readonly evidenceUnitIds: readonly string[];
  readonly rank: number;
  readonly score?: number;
  readonly provenance: readonly EvaluationEvidenceLocatorV2[];
};

export type EvaluationLaneOutcomeV2 = {
  readonly laneId: EvaluationLaneIdV2;
  readonly applicability: "applied" | "skipped";
  readonly status: "degraded" | "ready" | "unavailable";
  readonly reasonCodes: readonly string[];
  readonly rawRanking: readonly EvaluationRankedCandidateV2[];
};

export type EvaluationCandidateReasonV2 =
  | "appended"
  | "boundary"
  | "deduplicated"
  | "missing-provenance"
  | "output-limit"
  | "primary"
  | "primary-retain-limit"
  | "trust"
  | "unsupported";

export type EvaluationCandidateDecisionV2 = {
  readonly documentId: string;
  readonly evidenceUnitIds: readonly string[];
  readonly laneId: EvaluationLaneIdV2;
  readonly sourceRank: number;
  readonly disposition: "accepted" | "excluded";
  readonly reasonCodes: readonly EvaluationCandidateReasonV2[];
  readonly outputRank?: number;
  readonly provenance: readonly EvaluationEvidenceLocatorV2[];
};

export type EvaluationRetrieverTraceV2 = {
  readonly laneOutcomes: readonly EvaluationLaneOutcomeV2[];
  readonly candidateDecisions: readonly EvaluationCandidateDecisionV2[];
};

export type EvaluationResourceAccountingV2 = {
  readonly llm: {
    readonly calls: 0;
    readonly inputTokens: 0;
    readonly outputTokens: 0;
  };
  readonly embedding: {
    readonly calls: number;
    /** Exact count when omitted; zero is only a placeholder when explicitly false. */
    readonly inputTokens: number;
    readonly inputTokensMeasured?: false;
    readonly durationMs: number;
    /** Omitted means the duration measures embedding work exactly. */
    readonly durationScope?: "embedding-backed-search-upper-bound";
  };
  readonly packedContext: {
    readonly utf8Bytes: number;
    readonly readerTokens: number;
  };
  readonly peakRssBytes: number;
  readonly cacheBytes: number;
};

export type EvaluationRepeatedSampleV2 = {
  readonly retrieverId: string;
  readonly profileId: string;
  readonly queryId?: string;
  readonly repetition: number;
  readonly concurrencyBatchIdentity?: string;
  readonly status: "degraded" | "failed" | "ready" | "unavailable";
  readonly timings: {
    readonly elapsedMs: number;
    readonly indexMs: number;
    readonly updateMs: number;
    readonly queryMs: number;
    readonly packingMs: number;
  };
  readonly resources: EvaluationResourceAccountingV2;
  readonly trace: EvaluationRetrieverTraceV2;
  /** Lane-native source records, joined one-for-one to the raw ranking. */
  readonly rawEvidence: readonly EvaluationLaneNativeEvidenceV2[];
  readonly packedContextTrace?: {
    readonly evidenceUnitIds: readonly string[];
    readonly truncated: boolean;
    readonly packedBytesSha256: string;
  };
  readonly failure?: {
    readonly kind: "exception" | "invalid-result" | "timeout";
    readonly message: string;
  };
};

export type EvaluationLaneNativeEvidenceV2 = Readonly<{
  readonly laneId: EvaluationLaneIdV2;
  readonly documentId: string;
  readonly rank: number;
  readonly evidence?: unknown;
}>;

export type RetrievalEvaluationReportV2 = {
  readonly schemaVersion: 2;
  readonly suiteSha256: string;
  readonly candidateLockSha256: string;
  readonly split: EvaluationSplitV2 | "all";
  readonly samples: readonly EvaluationRepeatedSampleV2[];
};

export type EvaluationExternalCorpusSealV2 =
  | {
      readonly expectedCorpusSha256: string;
      readonly expectedGitBlob?: never;
    }
  | {
      readonly expectedCorpusSha256?: never;
      readonly expectedGitBlob: string;
    };

export type EvaluationCorpusParseOptionsV2 =
  | { readonly claimPromotion: false }
  | {
      readonly claimPromotion: true;
      readonly expectedSeal: EvaluationExternalCorpusSealV2;
    };

const sha256Pattern = /^[0-9a-f]{64}$/u;
const gitObjectPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const evidenceUnitIdPattern = /^eeu:[a-z0-9][a-z0-9._-]{0,63}:[0-9a-f]{64}$/u;
const canonicalIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const opaquePatterns = Object.freeze({
  evidenceUnit: evidenceUnitIdPattern,
  nugget: /^ng-[0-9a-f]{16}$/u,
  query: /^q-[0-9a-f]{16}$/u,
  sourceFamily: /^sf-[0-9a-f]{16}$/u,
  supportSet: /^ss-[0-9a-f]{16}$/u,
});
const windowsAbsolutePattern = /^[a-z]:[\\/]/iu;

const strata = new Set<EvaluationStratumV2>([
  "active-current-state",
  "code-path-context",
  "conceptual-recall",
  "exact-identity",
  "local-context",
  "metadata-constraint",
  "multi-note-relational",
  "no-answer-near-miss",
  "source-provenance",
  "temporal-stale-current",
]);
const lanes = new Set<EvaluationLaneIdV2>([
  "exact",
  "git",
  "graph",
  "hybrid",
  "keyword",
  "metadata",
  "note",
  "path-context",
  "semantic",
]);
const trustClasses = new Set<EvaluationTrustClassV2>([
  "authoritative-current",
  "authoritative-historical",
  "captured-primary",
  "captured-secondary",
  "maintained-synthesis",
  "untrusted-capture",
]);
const minimumUsefulEffectMetrics = new Set<EvaluationMinimumUsefulEffectMetricV2>([
  "document-recall-at-k",
  "evidence-recall-at-k",
  "false-abstention-rate",
  "no-answer-accuracy",
  "nugget-coverage",
]);
const nonInferiorityMetrics = new Set<EvaluationNonInferiorityMetricV2>([
  "active-current-state-accuracy",
  "code-path-context-accuracy",
  "context-precision",
  "conceptual-recall-accuracy",
  "document-recall-at-k",
  "evidence-recall-at-k",
  "exact-identity-accuracy",
  "local-context-accuracy",
  "metadata-constraint-accuracy",
  "multi-note-relational-accuracy",
  "source-provenance-accuracy",
  "temporal-stale-current-accuracy",
  "four-reader-query-p95-ms",
  "packing-p95-ms",
  "warm-query-p95-ms",
]);

const promotionNonInferiorityMetrics = new Set<EvaluationNonInferiorityMetricV2>([
  "active-current-state-accuracy",
  "code-path-context-accuracy",
  "conceptual-recall-accuracy",
  "document-recall-at-k",
  "evidence-recall-at-k",
  "exact-identity-accuracy",
  "local-context-accuracy",
  "metadata-constraint-accuracy",
  "multi-note-relational-accuracy",
  "source-provenance-accuracy",
  "temporal-stale-current-accuracy",
  "four-reader-query-p95-ms",
  "packing-p95-ms",
  "warm-query-p95-ms",
]);

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function strictKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extra.length > 0) {
    throw new TypeError(`${label} has unknown fields: ${extra.toSorted().join(", ")}.`);
  }
}

function boundedString(
  value: unknown,
  label: string,
  maximumBytes = MAX_EVALUATION_V2_TEXT_BYTES,
): string {
  if (
    typeof value !== "string"
    || value.trim() === ""
    || /[\0\r\n]/u.test(value)
    || Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new TypeError(
      `${label} must be a non-empty, single-line string of at most ${maximumBytes} UTF-8 bytes.`,
    );
  }
  const normalized = value.normalize("NFC");
  if (normalized !== value) throw new TypeError(`${label} must be NFC-normalized.`);
  return normalized;
}

function bridgeString(value: unknown, label: string, maximumBytes = 512): string {
  const parsed = boundedString(value, label, maximumBytes);
  if (parsed.trim() !== parsed) {
    throw new TypeError(`${label} must not have leading or trailing whitespace.`);
  }
  return parsed;
}

function optionalBoundedString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : boundedString(value, label);
}

function canonicalId(value: unknown, label: string): string {
  const id = boundedString(value, label, 256);
  if (!canonicalIdPattern.test(id)) {
    throw new TypeError(`${label} must be a canonical lowercase hyphenated ID.`);
  }
  return id;
}

function confinedPath(value: unknown, label: string, allowRoot = false): string {
  const path = boundedString(value, label, 4_096);
  if (allowRoot && path === ".") return path;
  if (
    path.startsWith("/")
    || path.startsWith("./")
    || path.includes("\\")
    || windowsAbsolutePattern.test(path)
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError(`${label} must be a canonical confined repository-relative path.`);
  }
  return path;
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function nonnegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  const parsed = nonnegativeNumber(value, label);
  if (parsed === 0) throw new TypeError(`${label} must be greater than zero.`);
  return parsed;
}

/** Peter J. Acklam's bounded rational approximation for the standard-normal quantile. */
function inverseNormalCdf(probability: number): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new RangeError("Normal quantile probability must be between zero and one.");
  }
  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239,
  ] as const;
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ] as const;
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ] as const;
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416,
  ] as const;
  const lower = 0.02425;
  const upper = 1 - lower;
  if (probability < lower) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > upper) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Prospective paired-observation count for a one-sided lower-bound test.
 * The null sits at the minimum useful effect; the alternative is the assumed
 * favorable effect. Discordance supplies the paired Bernoulli variance.
 */
export function requiredPairedObservationsV2(
  design: Omit<EvaluationPairedPowerV2, "requiredPairs">,
): number {
  const { alpha, targetPower, assumedDiscordantRate, assumedEffect, minimumUsefulEffect } = design;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 0.5) {
    throw new RangeError("Paired-power alpha must be between zero and 0.5.");
  }
  if (!Number.isFinite(targetPower) || targetPower <= 0.5 || targetPower >= 1) {
    throw new RangeError("Paired-power targetPower must be between 0.5 and one.");
  }
  if (
    !Number.isFinite(assumedDiscordantRate)
    || assumedDiscordantRate <= 0
    || assumedDiscordantRate > 1
  ) throw new RangeError("Paired-power assumedDiscordantRate must be in (0, 1].");
  if (
    !Number.isFinite(minimumUsefulEffect)
    || minimumUsefulEffect < 0
    || minimumUsefulEffect >= assumedDiscordantRate
  ) throw new RangeError("Paired-power minimumUsefulEffect must be in [0, discordance).");
  if (
    !Number.isFinite(assumedEffect)
    || assumedEffect <= minimumUsefulEffect
    || assumedEffect > assumedDiscordantRate
  ) {
    throw new RangeError(
      "Paired-power assumedEffect must exceed the minimum useful effect and not exceed discordance.",
    );
  }
  const nullVariance = assumedDiscordantRate - minimumUsefulEffect ** 2;
  const alternativeVariance = assumedDiscordantRate - assumedEffect ** 2;
  if (nullVariance <= 0 || alternativeVariance < 0) {
    throw new RangeError("Paired-power assumptions imply an invalid paired variance.");
  }
  const numerator = inverseNormalCdf(1 - alpha) * Math.sqrt(nullVariance)
    + inverseNormalCdf(targetPower) * Math.sqrt(alternativeVariance);
  const required = Math.ceil((numerator / (assumedEffect - minimumUsefulEffect)) ** 2);
  if (!Number.isSafeInteger(required) || required < 1 || required > MAX_EVALUATION_V2_QUERIES) {
    throw new RangeError(
      `Paired-power design requires ${String(required)} observations, outside the evaluator bound.`,
    );
  }
  return required;
}

function evidenceUnitId(value: unknown, label: string): string {
  const id = bridgeString(value, label, 160);
  if (!evidenceUnitIdPattern.test(id)) {
    throw new TypeError(`${label} must use the registry-compatible eeu:<parser-version>:<sha256> form.`);
  }
  return id;
}

function assertCanonicalOrder<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
): void {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) throw new TypeError(`${label} must not repeat an ID.`);
  const sorted = keys.toSorted((left, right) => left.localeCompare(right));
  if (keys.some((candidate, index) => candidate !== sorted[index])) {
    throw new TypeError(`${label} must be in canonical ID order.`);
  }
}

function stringList(
  value: unknown,
  label: string,
  options: { readonly maximum: number; readonly allowEmpty?: boolean; readonly canonical?: boolean },
): readonly string[] {
  if (
    !Array.isArray(value)
    || (!options.allowEmpty && value.length === 0)
    || value.length > options.maximum
  ) {
    const lower = options.allowEmpty ? 0 : 1;
    throw new TypeError(`${label} must contain from ${lower} through ${options.maximum} entries.`);
  }
  const parsed = value.map((entry, index) => boundedString(entry, `${label}[${index}]`, 4_096));
  if (new Set(parsed).size !== parsed.length) throw new TypeError(`${label} must not contain duplicates.`);
  if (options.canonical) {
    const sorted = parsed.toSorted((left, right) => left.localeCompare(right));
    if (parsed.some((entry, index) => entry !== sorted[index])) {
      throw new TypeError(`${label} must be in canonical order.`);
    }
  }
  return Object.freeze(parsed);
}

function parseHeadingPath(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError(`${label} must contain at most 32 heading components.`);
  }
  return Object.freeze(value.map((entry, index) =>
    bridgeString(entry, `${label}[${index}]`, 4_096)));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Commitment input contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const input = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(input).toSorted().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`;
  }
  throw new TypeError("Commitment input must be JSON-compatible.");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new TypeError(`${label} must be 64 lowercase hexadecimal characters.`);
  }
  return value;
}

function parseMetadataFilter(
  value: unknown,
  label: string,
): EvaluationMetadataFilterV2 {
  const input = record(value, label);
  strictKeys(input, ["kind", "path", "value"], label);
  const path = boundedString(input.path, `${label}.path`, 2_048);
  if (input.kind === "exists") {
    if (input.value !== undefined) throw new TypeError(`${label}.value is forbidden for exists.`);
    return Object.freeze({ kind: "exists", path });
  }
  if (input.kind !== "equals") throw new TypeError(`${label}.kind must be equals or exists.`);
  const filterValue = input.value;
  if (
    filterValue !== null
    && typeof filterValue !== "boolean"
    && typeof filterValue !== "number"
    && typeof filterValue !== "string"
  ) throw new TypeError(`${label}.value must be a JSON scalar.`);
  if (typeof filterValue === "number" && !Number.isFinite(filterValue)) {
    throw new TypeError(`${label}.value must be finite.`);
  }
  return Object.freeze({
    kind: "equals",
    path,
    value: typeof filterValue === "string"
      ? boundedString(filterValue, `${label}.value`)
      : filterValue,
  });
}

function parseRetrievalInputsV2(value: unknown, label: string): EvaluationRetrievalInputsV2 {
  const input = record(value, label);
  strictKeys(input, ["context", "graph", "history", "metadata", "noteId", "text"], label);
  const text = boundedString(input.text, `${label}.text`);
  const noteId = input.noteId === undefined
    ? undefined
    : confinedPath(input.noteId, `${label}.noteId`);

  let metadata: EvaluationRetrievalInputsV2["metadata"];
  if (input.metadata !== undefined) {
    const metadataInput = record(input.metadata, `${label}.metadata`);
    strictKeys(metadataInput, ["filters", "tags"], `${label}.metadata`);
    if (!Array.isArray(metadataInput.filters) || metadataInput.filters.length > 32) {
      throw new TypeError(`${label}.metadata.filters must have at most 32 entries.`);
    }
    const filters = metadataInput.filters.map((entry, index) =>
      parseMetadataFilter(entry, `${label}.metadata.filters[${index}]`));
    const filterKeys = filters.map(canonicalJson);
    if (new Set(filterKeys).size !== filterKeys.length) {
      throw new TypeError(`${label}.metadata.filters must not contain duplicates.`);
    }
    if (filterKeys.some((entry, index) => entry !== filterKeys.toSorted()[index])) {
      throw new TypeError(`${label}.metadata.filters must be in canonical order.`);
    }
    const tags = stringList(metadataInput.tags, `${label}.metadata.tags`, {
      allowEmpty: true,
      canonical: true,
      maximum: 32,
    });
    if (filters.length === 0 && tags.length === 0) {
      throw new TypeError(`${label}.metadata must contain at least one filter or tag.`);
    }
    metadata = Object.freeze({ filters: Object.freeze(filters), tags });
  }

  let graph: EvaluationRetrievalInputsV2["graph"];
  if (input.graph !== undefined) {
    const graphInput = record(input.graph, `${label}.graph`);
    strictKeys(graphInput, ["depth", "seeds"], `${label}.graph`);
    const rawSeeds = stringList(graphInput.seeds, `${label}.graph.seeds`, {
      canonical: true,
      maximum: 20,
    });
    const seeds = rawSeeds.map((seed, index) =>
      confinedPath(seed, `${label}.graph.seeds[${index}]`));
    if (graphInput.depth !== 1 && graphInput.depth !== 2) {
      throw new TypeError(`${label}.graph.depth must be 1 or 2.`);
    }
    graph = Object.freeze({ depth: graphInput.depth, seeds: Object.freeze(seeds) });
  }

  let context: EvaluationRetrievalInputsV2["context"];
  if (input.context !== undefined) {
    const contextInput = record(input.context, `${label}.context`);
    strictKeys(contextInput, ["repositoryPath"], `${label}.context`);
    context = Object.freeze({
      repositoryPath: confinedPath(
        contextInput.repositoryPath,
        `${label}.context.repositoryPath`,
        true,
      ),
    });
  }

  let history: EvaluationRetrievalInputsV2["history"];
  if (input.history !== undefined) {
    const historyInput = record(input.history, `${label}.history`);
    strictKeys(historyInput, ["noteIds", "query"], `${label}.history`);
    const rawNoteIds = stringList(historyInput.noteIds, `${label}.history.noteIds`, {
      allowEmpty: true,
      canonical: true,
      maximum: 100,
    });
    const noteIds = rawNoteIds.map((id, index) =>
      confinedPath(id, `${label}.history.noteIds[${index}]`));
    history = Object.freeze({
      query: boundedString(historyInput.query, `${label}.history.query`, 2_048),
      noteIds: Object.freeze(noteIds),
    });
  }

  return Object.freeze({
    text,
    ...(context === undefined ? {} : { context }),
    ...(graph === undefined ? {} : { graph }),
    ...(history === undefined ? {} : { history }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(noteId === undefined ? {} : { noteId }),
  });
}

function inputLanes(inputs: EvaluationRetrievalInputsV2): readonly EvaluationInputLaneV2[] {
  return Object.freeze([
    ...(inputs.context === undefined ? [] : ["context" as const]),
    ...(inputs.graph === undefined ? [] : ["graph" as const]),
    ...(inputs.history === undefined ? [] : ["history" as const]),
    ...(inputs.metadata === undefined ? [] : ["metadata" as const]),
    ...(inputs.noteId === undefined ? [] : ["noteId" as const]),
    "text" as const,
  ].toSorted());
}

function parseInputOrigins(
  value: unknown,
  inputs: EvaluationRetrievalInputsV2,
  label: string,
): readonly EvaluationInputOriginDeclarationV2[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    throw new TypeError(`${label} must contain from 1 through 6 entries.`);
  }
  const origins = value.map((entry, index): EvaluationInputOriginDeclarationV2 => {
    const itemLabel = `${label}[${index}]`;
    const input = record(entry, itemLabel);
    strictKeys(input, ["lane", "origin"], itemLabel);
    if (
      input.lane !== "context"
      && input.lane !== "graph"
      && input.lane !== "history"
      && input.lane !== "metadata"
      && input.lane !== "noteId"
      && input.lane !== "text"
    ) throw new TypeError(`${itemLabel}.lane is invalid.`);
    if (input.origin !== "caller" && input.origin !== "query-text") {
      throw new TypeError(`${itemLabel}.origin must be caller or query-text.`);
    }
    if (input.lane === "text" && input.origin !== "query-text") {
      throw new TypeError(`${itemLabel} must declare query-text for the text lane.`);
    }
    if (input.lane !== "text" && input.origin !== "caller") {
      throw new TypeError(`${itemLabel} must declare caller for a structured lane.`);
    }
    return Object.freeze({ lane: input.lane, origin: input.origin });
  });
  assertCanonicalOrder(origins, ({ lane }) => lane, label);
  const expected = inputLanes(inputs);
  const actual = origins.map(({ lane }) => lane);
  if (
    expected.length !== actual.length
    || expected.some((lane, index) => lane !== actual[index])
  ) throw new TypeError(`${label} must declare exactly the executable input lanes.`);
  return Object.freeze(origins);
}

function validateCohortInputs(
  cohort: EvaluationCohortV2,
  inputs: EvaluationRetrievalInputsV2,
  label: string,
): void {
  const structured = inputLanes(inputs).filter((lane) => lane !== "text");
  if (cohort === "text-only" && structured.length > 0) {
    throw new TypeError(`${label} text-only queries may expose only inputs.text.`);
  }
  if (cohort === "caller-seeded" && structured.length === 0) {
    throw new TypeError(`${label} caller-seeded queries require a structured executable lane.`);
  }
}

function validatePrimaryLaneInput(
  lane: EvaluationLaneIdV2,
  inputs: EvaluationRetrievalInputsV2,
  label: string,
): void {
  const present = lane === "metadata"
    ? inputs.metadata !== undefined
    : lane === "graph"
      ? inputs.graph !== undefined
      : lane === "path-context"
        ? inputs.context !== undefined
        : lane === "git"
          ? inputs.history !== undefined
          : lane === "note"
            ? inputs.noteId !== undefined
            : true;
  if (!present) throw new TypeError(`${label} primary lane ${lane} has no executable input.`);
}

function parseSourceFamily(value: unknown, index: number): EvaluationSourceFamilyV2 {
  const label = `sourceFamilies[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["familyAssignmentSha256", "id", "sourceClass", "trustClass"], label);
  if (
    input.sourceClass !== "authored-note"
    && input.sourceClass !== "captured-source"
    && input.sourceClass !== "git-history"
    && input.sourceClass !== "repository-file"
  ) throw new TypeError(`${label}.sourceClass is invalid.`);
  if (typeof input.trustClass !== "string" || !trustClasses.has(input.trustClass as EvaluationTrustClassV2)) {
    throw new TypeError(`${label}.trustClass is invalid.`);
  }
  const compatibleTrust = EVALUATION_SOURCE_TRUST_COMPATIBILITY_V2[input.sourceClass];
  if (!(compatibleTrust as readonly EvaluationTrustClassV2[]).includes(
    input.trustClass as EvaluationTrustClassV2,
  )) {
    throw new TypeError(`${label} sourceClass and trustClass are incompatible.`);
  }
  return Object.freeze({
    id: boundedString(input.id, `${label}.id`, 256),
    sourceClass: input.sourceClass,
    trustClass: input.trustClass as EvaluationTrustClassV2,
    ...(input.familyAssignmentSha256 === undefined
      ? {}
      : {
          familyAssignmentSha256: requireSha256(
            input.familyAssignmentSha256,
            `${label}.familyAssignmentSha256`,
          ),
        }),
  });
}

function parseDocument(value: unknown, index: number): EvaluationDocumentV2 {
  const label = `documents[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["id", "sourceFamilyId", "sourcePath", "trustClass"], label);
  if (typeof input.trustClass !== "string" || !trustClasses.has(input.trustClass as EvaluationTrustClassV2)) {
    throw new TypeError(`${label}.trustClass is invalid.`);
  }
  return Object.freeze({
    id: confinedPath(input.id, `${label}.id`),
    sourcePath: confinedPath(input.sourcePath, `${label}.sourcePath`),
    sourceFamilyId: boundedString(input.sourceFamilyId, `${label}.sourceFamilyId`, 256),
    trustClass: input.trustClass as EvaluationTrustClassV2,
  });
}

function parseLineRange(value: unknown, label: string): EvaluationLineRangeV2 {
  const input = record(value, label);
  strictKeys(input, ["end", "start"], label);
  const start = safeInteger(input.start, `${label}.start`, 1, 10_000_000);
  const end = safeInteger(input.end, `${label}.end`, 1, 10_000_000);
  if (end < start) throw new TypeError(`${label}.end must not precede start.`);
  return Object.freeze({ start, end });
}

function parseEvidenceUnit(value: unknown, index: number): EvaluationEvidenceUnitV2 {
  const label = `evidenceUnits[${index}]`;
  const input = record(value, label);
  strictKeys(
    input,
    [
      "documentId",
      "headingPath",
      "id",
      "lineRange",
      "sourceFamilyId",
      "sourcePage",
      "sourcePath",
      "trustClass",
    ],
    label,
  );
  if (typeof input.trustClass !== "string" || !trustClasses.has(input.trustClass as EvaluationTrustClassV2)) {
    throw new TypeError(`${label}.trustClass is invalid.`);
  }
  const sourcePage = input.sourcePage === undefined
    ? undefined
    : safeInteger(input.sourcePage, `${label}.sourcePage`, 1, 1_000_000);
  return Object.freeze({
    id: evidenceUnitId(input.id, `${label}.id`),
    documentId: confinedPath(input.documentId, `${label}.documentId`),
    sourceFamilyId: boundedString(input.sourceFamilyId, `${label}.sourceFamilyId`, 256),
    trustClass: input.trustClass as EvaluationTrustClassV2,
    sourcePath: confinedPath(input.sourcePath, `${label}.sourcePath`),
    lineRange: parseLineRange(input.lineRange, `${label}.lineRange`),
    headingPath: parseHeadingPath(input.headingPath, `${label}.headingPath`),
    ...(sourcePage === undefined ? {} : { sourcePage }),
  });
}

function parseRelevance(value: unknown, label: string): 0 | 1 | 2 | 3 {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
    throw new TypeError(`${label} must be an integer from 0 through 3.`);
  }
  return value;
}

function parseDocumentJudgments(
  value: unknown,
  label: string,
): readonly EvaluationDocumentJudgmentV2[] {
  if (!Array.isArray(value) || value.length > MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY) {
    throw new TypeError(`${label} must have at most ${MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY} entries.`);
  }
  const judgments = value.map((entry, index): EvaluationDocumentJudgmentV2 => {
    const itemLabel = `${label}[${index}]`;
    const input = record(entry, itemLabel);
    strictKeys(input, ["documentId", "relevance"], itemLabel);
    return Object.freeze({
      documentId: confinedPath(input.documentId, `${itemLabel}.documentId`),
      relevance: parseRelevance(input.relevance, `${itemLabel}.relevance`),
    });
  });
  assertCanonicalOrder(judgments, ({ documentId }) => documentId, label);
  return Object.freeze(judgments);
}

function parseEvidenceUnitJudgments(
  value: unknown,
  label: string,
): readonly EvaluationEvidenceUnitJudgmentV2[] {
  if (!Array.isArray(value) || value.length > MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY) {
    throw new TypeError(`${label} must have at most ${MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY} entries.`);
  }
  const judgments = value.map((entry, index): EvaluationEvidenceUnitJudgmentV2 => {
    const itemLabel = `${label}[${index}]`;
    const input = record(entry, itemLabel);
    strictKeys(input, ["evidenceUnitId", "relevance"], itemLabel);
    return Object.freeze({
      evidenceUnitId: evidenceUnitId(input.evidenceUnitId, `${itemLabel}.evidenceUnitId`),
      relevance: parseRelevance(input.relevance, `${itemLabel}.relevance`),
    });
  });
  assertCanonicalOrder(judgments, ({ evidenceUnitId }) => evidenceUnitId, label);
  return Object.freeze(judgments);
}

function parseNuggets(value: unknown, label: string): readonly EvaluationAtomicNuggetV2[] {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > MAX_EVALUATION_V2_NUGGETS_PER_QUERY
  ) {
    throw new TypeError(
      `${label} must contain from 1 through ${MAX_EVALUATION_V2_NUGGETS_PER_QUERY} entries.`,
    );
  }
  const nuggets = value.map((entry, index): EvaluationAtomicNuggetV2 => {
    const itemLabel = `${label}[${index}]`;
    const input = record(entry, itemLabel);
    strictKeys(input, ["acceptableSupportSets", "id", "required", "text"], itemLabel);
    if (typeof input.required !== "boolean") {
      throw new TypeError(`${itemLabel}.required must be boolean.`);
    }
    if (
      !Array.isArray(input.acceptableSupportSets)
      || input.acceptableSupportSets.length > MAX_EVALUATION_V2_SUPPORT_SETS_PER_NUGGET
    ) {
      throw new TypeError(
        `${itemLabel}.acceptableSupportSets must have at most ${MAX_EVALUATION_V2_SUPPORT_SETS_PER_NUGGET} entries.`,
      );
    }
    const acceptableSupportSets = input.acceptableSupportSets.map(
      (supportEntry, supportIndex): EvaluationAcceptableSupportSetV2 => {
        const supportLabel = `${itemLabel}.acceptableSupportSets[${supportIndex}]`;
        const supportInput = record(supportEntry, supportLabel);
        strictKeys(supportInput, ["evidenceUnitIds", "id"], supportLabel);
        return Object.freeze({
          id: boundedString(supportInput.id, `${supportLabel}.id`, 256),
          evidenceUnitIds: Object.freeze(stringList(
            supportInput.evidenceUnitIds,
            `${supportLabel}.evidenceUnitIds`,
            { canonical: true, maximum: 100 },
          ).map((id, evidenceIndex) => evidenceUnitId(
            id,
            `${supportLabel}.evidenceUnitIds[${evidenceIndex}]`,
          ))),
        });
      },
    );
    assertCanonicalOrder(acceptableSupportSets, ({ id }) => id, `${itemLabel}.acceptableSupportSets`);
    return Object.freeze({
      id: boundedString(input.id, `${itemLabel}.id`, 256),
      text: boundedString(input.text, `${itemLabel}.text`, 4_096),
      required: input.required,
      acceptableSupportSets: Object.freeze(acceptableSupportSets),
    });
  });
  assertCanonicalOrder(nuggets, ({ id }) => id, label);
  if (!nuggets.some(({ required }) => required)) {
    throw new TypeError(`${label} must contain at least one required nugget.`);
  }
  return Object.freeze(nuggets);
}

function parseGold(value: unknown, label: string): EvaluationGoldJudgmentV2 {
  const input = record(value, label);
  strictKeys(input, ["documents", "evidenceUnits", "nuggets"], label);
  return Object.freeze({
    documents: parseDocumentJudgments(input.documents, `${label}.documents`),
    evidenceUnits: parseEvidenceUnitJudgments(input.evidenceUnits, `${label}.evidenceUnits`),
    nuggets: parseNuggets(input.nuggets, `${label}.nuggets`),
  });
}

function parseRawAssessments(
  value: unknown,
  queryIndex: number,
  finalNuggets: readonly EvaluationAtomicNuggetV2[],
): readonly EvaluationRawAssessorJudgmentV2[] {
  const label = `queries[${queryIndex}].rawAssessments`;
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new TypeError(`${label} must contain from 1 through 10 entries.`);
  }
  const assessments = value.map((entry, index): EvaluationRawAssessorJudgmentV2 => {
    const itemLabel = `${label}[${index}]`;
    const input = record(entry, itemLabel);
    strictKeys(
      input,
      ["assessorId", "documents", "evidenceUnits", "expectedSupport", "nuggets"],
      itemLabel,
    );
    if (input.expectedSupport !== "supported" && input.expectedSupport !== "insufficient") {
      throw new TypeError(`${itemLabel}.expectedSupport must be insufficient or supported.`);
    }
    if (!Array.isArray(input.nuggets) || input.nuggets.length > MAX_EVALUATION_V2_NUGGETS_PER_QUERY) {
      throw new TypeError(`${itemLabel}.nuggets has too many entries.`);
    }
    const nuggets = input.nuggets.map((nuggetEntry, nuggetIndex) => {
      const nuggetLabel = `${itemLabel}.nuggets[${nuggetIndex}]`;
      const nuggetInput = record(nuggetEntry, nuggetLabel);
      strictKeys(nuggetInput, ["acceptableSupportSetIds", "nuggetId", "required"], nuggetLabel);
      const nuggetId = boundedString(nuggetInput.nuggetId, `${nuggetLabel}.nuggetId`, 256);
      const finalRequired = finalNuggets.find(({ id }) => id === nuggetId)?.required;
      if (nuggetInput.required !== undefined && typeof nuggetInput.required !== "boolean") {
        throw new TypeError(`${nuggetLabel}.required must be boolean.`);
      }
      return Object.freeze({
        nuggetId,
        required: nuggetInput.required ?? finalRequired ?? true,
        acceptableSupportSetIds: stringList(
          nuggetInput.acceptableSupportSetIds,
          `${nuggetLabel}.acceptableSupportSetIds`,
          { allowEmpty: true, canonical: true, maximum: MAX_EVALUATION_V2_SUPPORT_SETS_PER_NUGGET },
        ),
      });
    });
    assertCanonicalOrder(nuggets, ({ nuggetId }) => nuggetId, `${itemLabel}.nuggets`);
    return Object.freeze({
      assessorId: boundedString(input.assessorId, `${itemLabel}.assessorId`, 256),
      expectedSupport: input.expectedSupport,
      documents: parseDocumentJudgments(input.documents, `${itemLabel}.documents`),
      evidenceUnits: parseEvidenceUnitJudgments(input.evidenceUnits, `${itemLabel}.evidenceUnits`),
      nuggets: Object.freeze(nuggets),
    });
  });
  assertCanonicalOrder(assessments, ({ assessorId }) => assessorId, label);
  return Object.freeze(assessments);
}

function parseAdjudication(value: unknown, queryIndex: number): EvaluationAdjudicationV2 {
  const label = `queries[${queryIndex}].adjudication`;
  const input = record(value, label);
  strictKeys(input, ["adjudicatorId", "rationale", "status"], label);
  if (input.status === "single-assessor" || input.status === "agreed") {
    if (input.adjudicatorId !== undefined || input.rationale !== undefined) {
      throw new TypeError(`${label} may name an adjudicator only when status is resolved.`);
    }
    return Object.freeze({ status: input.status });
  }
  if (input.status !== "resolved") {
    throw new TypeError(`${label}.status must be agreed, resolved, or single-assessor.`);
  }
  return Object.freeze({
    status: "resolved",
    adjudicatorId: boundedString(input.adjudicatorId, `${label}.adjudicatorId`, 256),
    rationale: boundedString(input.rationale, `${label}.rationale`, 4_096),
  });
}

function finalNuggetRows(gold: EvaluationGoldJudgmentV2): EvaluationRawAssessorJudgmentV2["nuggets"] {
  return Object.freeze(gold.nuggets.map((nugget) => Object.freeze({
    nuggetId: nugget.id,
    required: nugget.required,
    acceptableSupportSetIds: Object.freeze(
      nugget.acceptableSupportSets.map(({ id }) => id),
    ),
  })));
}

function judgmentSignature(
  judgment: Omit<EvaluationRawAssessorJudgmentV2, "assessorId">,
): string {
  return canonicalJson(judgment);
}

function finalJudgmentSignature(query: EvaluationQueryV2): string {
  return judgmentSignature({
    expectedSupport: query.expectedSupport,
    documents: query.gold.documents,
    evidenceUnits: query.gold.evidenceUnits,
    nuggets: finalNuggetRows(query.gold),
  });
}

function rawJudgmentSignature(judgment: EvaluationRawAssessorJudgmentV2): string {
  return judgmentSignature({
    expectedSupport: judgment.expectedSupport,
    documents: judgment.documents,
    evidenceUnits: judgment.evidenceUnits,
    nuggets: judgment.nuggets,
  });
}

function hasCompleteSupport(
  expectedSupportSets: readonly { readonly id: string; readonly evidenceUnitIds: readonly string[] }[],
  selectedSupportSetIds: ReadonlySet<string>,
  evidenceGrades: ReadonlyMap<string, number>,
): boolean {
  return expectedSupportSets.some((supportSet) =>
    selectedSupportSetIds.has(supportSet.id)
    && supportSet.evidenceUnitIds.every((id) => (evidenceGrades.get(id) ?? 0) > 0));
}

function hasCompleteRequiredNuggetCoverage(
  nuggets: readonly EvaluationAtomicNuggetV2[],
  selected: ReadonlyMap<string, ReadonlySet<string>>,
  evidenceGrades: ReadonlyMap<string, number>,
): boolean {
  return nuggets.filter(({ required }) => required).every((nugget) =>
    hasCompleteSupport(
      nugget.acceptableSupportSets,
      selected.get(nugget.id) ?? new Set<string>(),
      evidenceGrades,
    ));
}

function validateGoldReferences(
  query: EvaluationQueryV2,
  documents: ReadonlyMap<string, EvaluationDocumentV2>,
  evidenceUnits: ReadonlyMap<string, EvaluationEvidenceUnitV2>,
  assessorIds: ReadonlySet<string>,
  label: string,
): void {
  const documentGrades = new Map(query.gold.documents.map((row) => [row.documentId, row.relevance]));
  const evidenceGrades = new Map(query.gold.evidenceUnits.map((row) => [row.evidenceUnitId, row.relevance]));
  for (const row of query.gold.documents) {
    if (!documents.has(row.documentId)) {
      throw new TypeError(`${label}.gold.documents references unknown document ${row.documentId}.`);
    }
  }
  for (const row of query.gold.evidenceUnits) {
    const unit = evidenceUnits.get(row.evidenceUnitId);
    if (unit === undefined) {
      throw new TypeError(`${label}.gold.evidenceUnits references unknown unit ${row.evidenceUnitId}.`);
    }
    if (!documentGrades.has(unit.documentId)) {
      throw new TypeError(`${label}.gold must judge the document containing ${row.evidenceUnitId}.`);
    }
    if (row.relevance > 0 && (documentGrades.get(unit.documentId) ?? 0) === 0) {
      throw new TypeError(`${label}.gold cannot place relevant evidence in an irrelevant document.`);
    }
  }
  const supportSetIds = new Set<string>();
  for (const nugget of query.gold.nuggets) {
    for (const supportSet of nugget.acceptableSupportSets) {
      if (supportSetIds.has(supportSet.id)) {
        throw new TypeError(`${label}.gold support-set IDs must be unique across nuggets.`);
      }
      supportSetIds.add(supportSet.id);
      for (const unitId of supportSet.evidenceUnitIds) {
        if (!evidenceUnits.has(unitId)) {
          throw new TypeError(`${label}.gold support set references unknown unit ${unitId}.`);
        }
        if ((evidenceGrades.get(unitId) ?? 0) === 0) {
          throw new TypeError(`${label}.gold support set ${supportSet.id} must use positively judged units.`);
        }
      }
    }
  }
  const finalSelection = new Map(finalNuggetRows(query.gold).map((row) => [
    row.nuggetId,
    new Set(row.acceptableSupportSetIds),
  ]));
  const complete = hasCompleteRequiredNuggetCoverage(query.gold.nuggets, finalSelection, evidenceGrades);
  if (query.expectedSupport === "supported" && !complete) {
    throw new TypeError(`${label} is supported but has no complete acceptable support for every required nugget.`);
  }
  if (query.expectedSupport === "insufficient" && complete) {
    throw new TypeError(`${label} is insufficient but contains complete acceptable support for all required nuggets.`);
  }
  if (query.expectedSupport === "supported" && query.negativeSubtype !== undefined) {
    throw new TypeError(`${label}.negativeSubtype is forbidden for supported queries.`);
  }
  if (query.expectedSupport === "insufficient" && query.negativeSubtype === undefined) {
    throw new TypeError(`${label}.negativeSubtype is required for insufficient queries.`);
  }

  const finalSignature = finalJudgmentSignature(query);
  const rawSignatures = query.rawAssessments.map(rawJudgmentSignature);
  for (const raw of query.rawAssessments) {
    if (!assessorIds.has(raw.assessorId)) {
      throw new TypeError(`${label}.rawAssessments names undeclared assessor ${raw.assessorId}.`);
    }
    if (canonicalJson(raw.documents.map(({ documentId }) => documentId))
      !== canonicalJson(query.gold.documents.map(({ documentId }) => documentId))) {
      throw new TypeError(`${label} raw assessors must judge the complete final document pool.`);
    }
    if (canonicalJson(raw.evidenceUnits.map(({ evidenceUnitId }) => evidenceUnitId))
      !== canonicalJson(query.gold.evidenceUnits.map(({ evidenceUnitId }) => evidenceUnitId))) {
      throw new TypeError(`${label} raw assessors must judge the complete final evidence-unit pool.`);
    }
    if (canonicalJson(raw.nuggets.map(({ nuggetId }) => nuggetId))
      !== canonicalJson(query.gold.nuggets.map(({ id }) => id))) {
      throw new TypeError(`${label} raw assessors must judge every final nugget.`);
    }
    const rawEvidenceGrades = new Map(raw.evidenceUnits.map((row) => [row.evidenceUnitId, row.relevance]));
    if (!raw.nuggets.some(({ required }) => required)) {
      throw new TypeError(`${label} raw assessments must require at least one final nugget.`);
    }
    const rawSelection = new Map(raw.nuggets.map((row) => [
      row.nuggetId,
      new Set(row.acceptableSupportSetIds),
    ]));
    for (const row of raw.nuggets) {
      const nugget = query.gold.nuggets.find(({ id }) => id === row.nuggetId);
      const allowed = new Set(nugget?.acceptableSupportSets.map(({ id }) => id) ?? []);
      for (const id of row.acceptableSupportSetIds) {
        if (!allowed.has(id)) {
          throw new TypeError(`${label} raw assessment references unknown support set ${id}.`);
        }
      }
    }
    const rawRequiredNuggets = query.gold.nuggets.map((nugget) => Object.freeze({
      ...nugget,
      required: raw.nuggets.find(({ nuggetId }) => nuggetId === nugget.id)?.required ?? nugget.required,
    }));
    const rawComplete = hasCompleteRequiredNuggetCoverage(rawRequiredNuggets, rawSelection, rawEvidenceGrades);
    if ((raw.expectedSupport === "supported") !== rawComplete) {
      throw new TypeError(`${label} raw assessment support state contradicts its support-set coverage.`);
    }
  }

  const distinct = new Set(rawSignatures);
  if (query.rawAssessments.length === 1) {
    if (query.adjudication.status !== "single-assessor" || rawSignatures[0] !== finalSignature) {
      throw new TypeError(`${label} single assessment requires explicit single-assessor adjudication and matching final gold.`);
    }
    return;
  }
  if (distinct.size === 1) {
    if (query.adjudication.status !== "agreed" || rawSignatures[0] !== finalSignature) {
      throw new TypeError(`${label} matching independent assessments require explicit agreed adjudication and matching final gold.`);
    }
    return;
  }
  if (query.adjudication.status !== "resolved") {
    throw new TypeError(`${label} assessment disagreement requires explicit resolved adjudication.`);
  }
  if (!assessorIds.has(query.adjudication.adjudicatorId)) {
    throw new TypeError(`${label}.adjudication.adjudicatorId must name a declared assessor.`);
  }
}

function parseQuery(value: unknown, index: number): EvaluationQueryV2 {
  const label = `queries[${index}]`;
  const input = record(value, label);
  strictKeys(
    input,
    [
      "adjudication",
      "cohort",
      "expectedSupport",
      "gold",
      "id",
      "inputOrigins",
      "inputs",
      "negativeSubtype",
      "primaryLane",
      "primaryStratum",
      "rawAssessments",
      "split",
      "strata",
      "text",
    ],
    label,
  );
  if (input.split !== "development" && input.split !== "test") {
    throw new TypeError(`${label}.split must be development or test.`);
  }
  if (input.cohort !== "caller-seeded" && input.cohort !== "text-only") {
    throw new TypeError(`${label}.cohort must be caller-seeded or text-only.`);
  }
  if (input.expectedSupport !== "supported" && input.expectedSupport !== "insufficient") {
    throw new TypeError(`${label}.expectedSupport must be insufficient or supported.`);
  }
  if (typeof input.primaryLane !== "string" || !lanes.has(input.primaryLane as EvaluationLaneIdV2)) {
    throw new TypeError(`${label}.primaryLane is invalid.`);
  }
  const negativeSubtype = input.negativeSubtype;
  if (
    negativeSubtype !== undefined
    && negativeSubtype !== "boundary-near-miss"
    && negativeSubtype !== "conflicting-evidence"
    && negativeSubtype !== "missing-required-support"
    && negativeSubtype !== "stale-only"
    && negativeSubtype !== "topical-near-miss"
    && negativeSubtype !== "unknown-entity"
  ) throw new TypeError(`${label}.negativeSubtype is invalid.`);
  if (!Array.isArray(input.strata) || input.strata.length < 1 || input.strata.length > strata.size) {
    throw new TypeError(`${label}.strata must be a non-empty bounded array.`);
  }
  const parsedStrata = input.strata.map((entry, stratumIndex) => {
    if (typeof entry !== "string" || !strata.has(entry as EvaluationStratumV2)) {
      throw new TypeError(`${label}.strata[${stratumIndex}] is invalid.`);
    }
    return entry as EvaluationStratumV2;
  });
  if (new Set(parsedStrata).size !== parsedStrata.length) {
    throw new TypeError(`${label}.strata must not contain duplicates.`);
  }
  const sortedStrata = parsedStrata.toSorted();
  if (parsedStrata.some((entry, stratumIndex) => entry !== sortedStrata[stratumIndex])) {
    throw new TypeError(`${label}.strata must be in canonical order.`);
  }
  if (
    typeof input.primaryStratum !== "string"
    || !strata.has(input.primaryStratum as EvaluationStratumV2)
    || !parsedStrata.includes(input.primaryStratum as EvaluationStratumV2)
  ) {
    throw new TypeError(`${label}.primaryStratum must name one of the query strata.`);
  }
  const inputs = parseRetrievalInputsV2(input.inputs, `${label}.inputs`);
  validateCohortInputs(input.cohort, inputs, label);
  validatePrimaryLaneInput(input.primaryLane as EvaluationLaneIdV2, inputs, label);
  const gold = parseGold(input.gold, `${label}.gold`);
  return Object.freeze({
    id: boundedString(input.id, `${label}.id`, 256),
    text: boundedString(input.text, `${label}.text`),
    split: input.split,
    cohort: input.cohort,
    strata: Object.freeze(parsedStrata),
    primaryStratum: input.primaryStratum as EvaluationStratumV2,
    expectedSupport: input.expectedSupport,
    primaryLane: input.primaryLane as EvaluationLaneIdV2,
    ...(negativeSubtype === undefined ? {} : { negativeSubtype }),
    inputs,
    inputOrigins: parseInputOrigins(input.inputOrigins, inputs, `${label}.inputOrigins`),
    gold,
    rawAssessments: parseRawAssessments(input.rawAssessments, index, gold.nuggets),
    adjudication: parseAdjudication(input.adjudication, index),
  });
}

function parseAssessor(value: unknown, index: number): EvaluationAssessorV2 {
  const label = `assessment.assessors[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["affiliation", "displayName", "id"], label);
  const displayName = optionalBoundedString(input.displayName, `${label}.displayName`);
  const affiliation = optionalBoundedString(input.affiliation, `${label}.affiliation`);
  return Object.freeze({
    id: canonicalId(input.id, `${label}.id`),
    ...(displayName === undefined ? {} : { displayName }),
    ...(affiliation === undefined ? {} : { affiliation }),
  });
}

function parseMeasurementProfile(value: unknown, index: number): EvaluationMeasurementProfileV2 {
  const label = `measurementProfiles[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["cacheState", "concurrency", "id", "operation", "repetitions", "scope"], label);
  if (
    input.operation !== "cold-index"
    && input.operation !== "four-reader-query"
    && input.operation !== "incremental-update"
    && input.operation !== "packing"
    && input.operation !== "warm-query"
  ) throw new TypeError(`${label}.operation is invalid.`);
  if (input.scope !== "query" && input.scope !== "retriever") {
    throw new TypeError(`${label}.scope must be query or retriever.`);
  }
  if (
    input.cacheState !== "changed-generation"
    && input.cacheState !== "cold"
    && input.cacheState !== "not-applicable"
    && input.cacheState !== "warm"
  ) throw new TypeError(`${label}.cacheState is invalid.`);
  const concurrency = safeInteger(input.concurrency, `${label}.concurrency`, 1, 64);
  const repetitions = safeInteger(input.repetitions, `${label}.repetitions`, 1, 100);
  const expected = {
    "cold-index": { scope: "retriever", cacheState: "cold", concurrency: 1 },
    "four-reader-query": { scope: "query", cacheState: "warm", concurrency: 4 },
    "incremental-update": { scope: "retriever", cacheState: "changed-generation", concurrency: 1 },
    packing: { scope: "query", cacheState: "warm", concurrency: 1 },
    "warm-query": { scope: "query", cacheState: "warm", concurrency: 1 },
  } as const;
  const required = expected[input.operation];
  if (input.scope !== required.scope || input.cacheState !== required.cacheState || concurrency !== required.concurrency) {
    throw new TypeError(`${label} does not match the fixed ${input.operation} operation profile.`);
  }
  return Object.freeze({
    id: canonicalId(input.id, `${label}.id`),
    operation: input.operation,
    scope: input.scope,
    cacheState: input.cacheState,
    concurrency,
    repetitions,
  });
}

function parseExperiment(value: unknown): EvaluationExperimentV2 {
  const input = record(value, "experiment");
  strictKeys(input, ["environment", "protocol"], "experiment");
  const protocolInput = record(input.protocol, "experiment.protocol");
  strictKeys(
    protocolInput,
    ["contextCeilings", "minimumUsefulEffects", "nonInferiorityMargins", "pairedPower"],
    "experiment.protocol",
  );
  if (
    !Array.isArray(protocolInput.minimumUsefulEffects)
    || protocolInput.minimumUsefulEffects.length < 1
    || protocolInput.minimumUsefulEffects.length > minimumUsefulEffectMetrics.size * 2
  ) {
    throw new TypeError("experiment.protocol.minimumUsefulEffects must be a non-empty bounded array.");
  }
  const minimumUsefulEffects = protocolInput.minimumUsefulEffects.map((entry, index) => {
    const label = `experiment.protocol.minimumUsefulEffects[${index}]`;
    const effectInput = record(entry, label);
    strictKeys(effectInput, ["cohort", "metric", "minimumAbsoluteDifference"], label);
    if (
      typeof effectInput.metric !== "string"
      || !minimumUsefulEffectMetrics.has(effectInput.metric as EvaluationMinimumUsefulEffectMetricV2)
    ) throw new TypeError(`${label}.metric is invalid.`);
    if (effectInput.cohort !== "caller-seeded" && effectInput.cohort !== "text-only") {
      throw new TypeError(`${label}.cohort must be caller-seeded or text-only.`);
    }
    const minimumAbsoluteDifference = positiveNumber(
      effectInput.minimumAbsoluteDifference,
      `${label}.minimumAbsoluteDifference`,
    );
    if (minimumAbsoluteDifference > 1) {
      throw new TypeError(`${label}.minimumAbsoluteDifference must not exceed one.`);
    }
    return Object.freeze({
      metric: effectInput.metric as EvaluationMinimumUsefulEffectMetricV2,
      cohort: effectInput.cohort,
      minimumAbsoluteDifference,
    });
  });
  assertCanonicalOrder(
    minimumUsefulEffects,
    ({ metric, cohort }) => `${metric}:${cohort}`,
    "experiment.protocol.minimumUsefulEffects",
  );

  if (
    !Array.isArray(protocolInput.nonInferiorityMargins)
    || protocolInput.nonInferiorityMargins.length < 1
    || protocolInput.nonInferiorityMargins.length > nonInferiorityMetrics.size
  ) {
    throw new TypeError("experiment.protocol.nonInferiorityMargins must be a non-empty bounded array.");
  }
  const nonInferiorityMargins = protocolInput.nonInferiorityMargins.map((entry, index) => {
    const label = `experiment.protocol.nonInferiorityMargins[${index}]`;
    const marginInput = record(entry, label);
    strictKeys(
      marginInput,
      ["maximumAbsoluteRegression", "maximumRelativeRegression", "metric"],
      label,
    );
    if (
      typeof marginInput.metric !== "string"
      || !nonInferiorityMetrics.has(marginInput.metric as EvaluationNonInferiorityMetricV2)
    ) throw new TypeError(`${label}.metric is invalid.`);
    const maximumAbsoluteRegression = nonnegativeNumber(
      marginInput.maximumAbsoluteRegression,
      `${label}.maximumAbsoluteRegression`,
    );
    const maximumRelativeRegression = nonnegativeNumber(
      marginInput.maximumRelativeRegression,
      `${label}.maximumRelativeRegression`,
    );
    const boundedQuality = !marginInput.metric.endsWith("-p95-ms");
    if (boundedQuality && maximumAbsoluteRegression > 1) {
      throw new TypeError(`${label}.maximumAbsoluteRegression must not exceed one for quality metrics.`);
    }
    if (maximumRelativeRegression > 10) {
      throw new TypeError(`${label}.maximumRelativeRegression must not exceed ten.`);
    }
    if (
      !boundedQuality
      && maximumAbsoluteRegression === 0
      && maximumRelativeRegression === 0
    ) {
      throw new TypeError(`${label} must declare a non-zero latency margin.`);
    }
    return Object.freeze({
      metric: marginInput.metric as EvaluationNonInferiorityMetricV2,
      maximumAbsoluteRegression,
      maximumRelativeRegression,
    });
  });
  assertCanonicalOrder(
    nonInferiorityMargins,
    ({ metric }) => metric,
    "experiment.protocol.nonInferiorityMargins",
  );

  const pairedPowerInput = record(
    protocolInput.pairedPower,
    "experiment.protocol.pairedPower",
  );
  strictKeys(
    pairedPowerInput,
    [
      "alpha",
      "assumedDiscordantRate",
      "assumedEffect",
      "minimumUsefulEffect",
      "requiredPairs",
      "targetPower",
    ],
    "experiment.protocol.pairedPower",
  );
  const pairedPowerWithoutCount = Object.freeze({
    alpha: positiveNumber(pairedPowerInput.alpha, "experiment.protocol.pairedPower.alpha"),
    targetPower: positiveNumber(
      pairedPowerInput.targetPower,
      "experiment.protocol.pairedPower.targetPower",
    ),
    assumedDiscordantRate: positiveNumber(
      pairedPowerInput.assumedDiscordantRate,
      "experiment.protocol.pairedPower.assumedDiscordantRate",
    ),
    assumedEffect: positiveNumber(
      pairedPowerInput.assumedEffect,
      "experiment.protocol.pairedPower.assumedEffect",
    ),
    minimumUsefulEffect: nonnegativeNumber(
      pairedPowerInput.minimumUsefulEffect,
      "experiment.protocol.pairedPower.minimumUsefulEffect",
    ),
  });
  const expectedRequiredPairs = requiredPairedObservationsV2(pairedPowerWithoutCount);
  const requiredPairs = safeInteger(
    pairedPowerInput.requiredPairs,
    "experiment.protocol.pairedPower.requiredPairs",
    1,
    MAX_EVALUATION_V2_QUERIES,
  );
  if (requiredPairs !== expectedRequiredPairs) {
    throw new TypeError(
      `experiment.protocol.pairedPower.requiredPairs must equal the derived count ${expectedRequiredPairs}.`,
    );
  }
  const pairedPower = Object.freeze({ ...pairedPowerWithoutCount, requiredPairs });

  const ceilingsInput = record(protocolInput.contextCeilings, "experiment.protocol.contextCeilings");
  strictKeys(ceilingsInput, ["readerTokens", "utf8Bytes"], "experiment.protocol.contextCeilings");
  const contextCeilings = Object.freeze({
    utf8Bytes: safeInteger(
      ceilingsInput.utf8Bytes,
      "experiment.protocol.contextCeilings.utf8Bytes",
      1,
      1_000_000_000,
    ),
    readerTokens: safeInteger(
      ceilingsInput.readerTokens,
      "experiment.protocol.contextCeilings.readerTokens",
      1,
      1_000_000_000,
    ),
  });

  const environmentInput = record(input.environment, "experiment.environment");
  strictKeys(
    environmentInput,
    [
      "cache",
      "fourReaderBatch",
      "hardware",
      "incrementalMutation",
      "localModel",
      "runtime",
      "tokenizer",
    ],
    "experiment.environment",
  );
  const tokenizerInput = record(environmentInput.tokenizer, "experiment.environment.tokenizer");
  strictKeys(tokenizerInput, ["id", "sha256"], "experiment.environment.tokenizer");
  const runtimeInput = record(environmentInput.runtime, "experiment.environment.runtime");
  strictKeys(runtimeInput, ["id", "sha256"], "experiment.environment.runtime");
  const hardwareInput = record(environmentInput.hardware, "experiment.environment.hardware");
  strictKeys(hardwareInput, ["id"], "experiment.environment.hardware");
  const cacheInput = record(environmentInput.cache, "experiment.environment.cache");
  strictKeys(cacheInput, ["fingerprintSha256", "preparation"], "experiment.environment.cache");
  const fourReaderBatchInput = record(
    environmentInput.fourReaderBatch,
    "experiment.environment.fourReaderBatch",
  );
  strictKeys(fourReaderBatchInput, ["id", "sha256"], "experiment.environment.fourReaderBatch");
  const incrementalMutationInput = record(
    environmentInput.incrementalMutation,
    "experiment.environment.incrementalMutation",
  );
  strictKeys(
    incrementalMutationInput,
    ["appendUtf8Sha256", "expectedPostMutationSha256", "sourcePath"],
    "experiment.environment.incrementalMutation",
  );
  const localModelInput = record(environmentInput.localModel, "experiment.environment.localModel");
  if (localModelInput.kind !== "none" && localModelInput.kind !== "model") {
    throw new TypeError("experiment.environment.localModel.kind must be model or none.");
  }
  strictKeys(
    localModelInput,
    localModelInput.kind === "none" ? ["kind"] : ["id", "kind", "sha256"],
    "experiment.environment.localModel",
  );
  const localModel: EvaluationExperimentV2["environment"]["localModel"] = localModelInput.kind === "none"
    ? Object.freeze({ kind: "none" })
    : Object.freeze({
        kind: "model",
        id: bridgeString(localModelInput.id, "experiment.environment.localModel.id", 512),
        sha256: requireSha256(localModelInput.sha256, "experiment.environment.localModel.sha256"),
      });

  return Object.freeze({
    protocol: Object.freeze({
      minimumUsefulEffects: Object.freeze(minimumUsefulEffects),
      nonInferiorityMargins: Object.freeze(nonInferiorityMargins),
      pairedPower,
      contextCeilings,
    }),
    environment: Object.freeze({
      tokenizer: Object.freeze({
        id: bridgeString(tokenizerInput.id, "experiment.environment.tokenizer.id", 512),
        sha256: requireSha256(tokenizerInput.sha256, "experiment.environment.tokenizer.sha256"),
      }),
      runtime: Object.freeze({
        id: bridgeString(runtimeInput.id, "experiment.environment.runtime.id", 512),
        sha256: requireSha256(runtimeInput.sha256, "experiment.environment.runtime.sha256"),
      }),
      hardware: Object.freeze({
        id: bridgeString(hardwareInput.id, "experiment.environment.hardware.id", 1_024),
      }),
      localModel,
      cache: Object.freeze({
        preparation: bridgeString(cacheInput.preparation, "experiment.environment.cache.preparation", 2_048),
        fingerprintSha256: requireSha256(
          cacheInput.fingerprintSha256,
          "experiment.environment.cache.fingerprintSha256",
        ),
      }),
      fourReaderBatch: Object.freeze({
        id: bridgeString(fourReaderBatchInput.id, "experiment.environment.fourReaderBatch.id", 512),
        sha256: requireSha256(
          fourReaderBatchInput.sha256,
          "experiment.environment.fourReaderBatch.sha256",
        ),
      }),
      incrementalMutation: Object.freeze({
        sourcePath: confinedPath(
          incrementalMutationInput.sourcePath,
          "experiment.environment.incrementalMutation.sourcePath",
        ),
        appendUtf8Sha256: requireSha256(
          incrementalMutationInput.appendUtf8Sha256,
          "experiment.environment.incrementalMutation.appendUtf8Sha256",
        ),
        expectedPostMutationSha256: requireSha256(
          incrementalMutationInput.expectedPostMutationSha256,
          "experiment.environment.incrementalMutation.expectedPostMutationSha256",
        ),
      }),
    }),
  });
}

function parseConfiguration(value: unknown, label: string): Readonly<Record<string, string | number | boolean | null>> {
  const input = record(value, label);
  if (Object.keys(input).length > 64) throw new TypeError(`${label} may have at most 64 fields.`);
  const output: Record<string, string | number | boolean | null> = {};
  for (const rawKey of Object.keys(input).toSorted()) {
    const key = canonicalId(rawKey, `${label} key`);
    const candidate = input[rawKey];
    if (
      candidate !== null
      && typeof candidate !== "boolean"
      && typeof candidate !== "number"
      && typeof candidate !== "string"
    ) throw new TypeError(`${label}.${key} must be a JSON scalar.`);
    if (typeof candidate === "number" && !Number.isFinite(candidate)) {
      throw new TypeError(`${label}.${key} must be finite.`);
    }
    output[key] = typeof candidate === "string" ? boundedString(candidate, `${label}.${key}`) : candidate;
  }
  return Object.freeze(output);
}

function parseRetrieverDescriptor(value: unknown, index: number): EvaluationRetrieverDescriptorV2 {
  const label = `retrievers[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["configuration", "id", "implementationSha256", "lanes", "role", "version"], label);
  if (input.role !== "ablation" && input.role !== "baseline" && input.role !== "candidate") {
    throw new TypeError(`${label}.role is invalid.`);
  }
  if (!Array.isArray(input.lanes) || input.lanes.length < 1 || input.lanes.length > lanes.size) {
    throw new TypeError(`${label}.lanes must be a non-empty bounded array.`);
  }
  const parsedLanes = input.lanes.map((lane, laneIndex) => {
    if (typeof lane !== "string" || !lanes.has(lane as EvaluationLaneIdV2)) {
      throw new TypeError(`${label}.lanes[${laneIndex}] is invalid.`);
    }
    return lane as EvaluationLaneIdV2;
  });
  const sortedLanes = parsedLanes.toSorted();
  if (new Set(parsedLanes).size !== parsedLanes.length || parsedLanes.some((lane, index) => lane !== sortedLanes[index])) {
    throw new TypeError(`${label}.lanes must be unique and in canonical order.`);
  }
  return Object.freeze({
    id: canonicalId(input.id, `${label}.id`),
    role: input.role,
    version: boundedString(input.version, `${label}.version`, 512),
    implementationSha256: requireSha256(input.implementationSha256, `${label}.implementationSha256`),
    lanes: Object.freeze(parsedLanes),
    configuration: parseConfiguration(input.configuration, `${label}.configuration`),
  });
}

function parseCandidateLock(value: unknown): EvaluationCandidateLockV2 {
  const label = "candidateLock";
  const input = record(value, label);
  strictKeys(input, ["baselineRetrieverId", "candidateRetrieverIds", "descriptorDigests"], label);
  const candidateRetrieverIds = stringList(input.candidateRetrieverIds, `${label}.candidateRetrieverIds`, {
    canonical: true,
    maximum: 32,
  }).map((id, index) => canonicalId(id, `${label}.candidateRetrieverIds[${index}]`));
  if (!Array.isArray(input.descriptorDigests) || input.descriptorDigests.length < 1 || input.descriptorDigests.length > 64) {
    throw new TypeError(`${label}.descriptorDigests must contain from 1 through 64 entries.`);
  }
  const descriptorDigests = input.descriptorDigests.map((entry, index) => {
    const itemLabel = `${label}.descriptorDigests[${index}]`;
    const digestInput = record(entry, itemLabel);
    strictKeys(digestInput, ["retrieverId", "sha256"], itemLabel);
    return Object.freeze({
      retrieverId: canonicalId(digestInput.retrieverId, `${itemLabel}.retrieverId`),
      sha256: requireSha256(digestInput.sha256, `${itemLabel}.sha256`),
    });
  });
  assertCanonicalOrder(descriptorDigests, ({ retrieverId }) => retrieverId, `${label}.descriptorDigests`);
  return Object.freeze({
    baselineRetrieverId: canonicalId(input.baselineRetrieverId, `${label}.baselineRetrieverId`),
    candidateRetrieverIds: Object.freeze(candidateRetrieverIds),
    descriptorDigests: Object.freeze(descriptorDigests),
  });
}

export function evaluationRetrieverDescriptorDigestV2(descriptor: EvaluationRetrieverDescriptorV2): string {
  return sha256(descriptor);
}

export function evaluationCandidateLockDigestV2(lock: EvaluationCandidateLockV2): string {
  return sha256(lock);
}

function corpusCommitmentPayload(value: RetrievalEvaluationCorpusV2): unknown {
  return {
    schemaVersion: value.schemaVersion,
    id: value.id,
    description: value.description,
    manifest: {
      protocol: value.manifest.protocol,
      sealedAt: value.manifest.sealedAt,
      buildContractSha256: value.manifest.buildContractSha256,
    },
    frozen: value.frozen,
    assessment: value.assessment,
    experiment: value.experiment,
    sourceFamilies: value.sourceFamilies,
    documents: value.documents,
    evidenceUnits: value.evidenceUnits,
    measurementProfiles: value.measurementProfiles,
    retrievers: value.retrievers,
    candidateLock: value.candidateLock,
    queries: value.queries,
  };
}

export function evaluationCorpusDigestV2(corpus: RetrievalEvaluationCorpusV2): string {
  return sha256(corpusCommitmentPayload(corpus));
}

/** Git-object commitment of the corpus's canonical JSON representation. */
export function evaluationCorpusGitBlobCommitmentV2(
  corpus: RetrievalEvaluationCorpusV2,
  objectFormat: "sha1" | "sha256" = "sha1",
): string {
  const bytes = Buffer.from(canonicalJson(corpus), "utf8");
  return createHash(objectFormat)
    .update(`blob ${bytes.byteLength}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}

function parseManifest(value: unknown): RetrievalEvaluationCorpusV2["manifest"] {
  const input = record(value, "manifest");
  strictKeys(
    input,
    ["buildContractSha256", "candidateLockSha256", "corpusSha256", "protocol", "sealedAt"],
    "manifest",
  );
  if (input.protocol !== RETRIEVAL_EVALUATION_V2_PROTOCOL) {
    throw new TypeError(`manifest.protocol must be ${RETRIEVAL_EVALUATION_V2_PROTOCOL}.`);
  }
  const timestamp = new Date(input.sealedAt as string);
  if (typeof input.sealedAt !== "string" || Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== input.sealedAt) {
    throw new TypeError("manifest.sealedAt must be a canonical ISO timestamp.");
  }
  return Object.freeze({
    protocol: RETRIEVAL_EVALUATION_V2_PROTOCOL,
    sealedAt: input.sealedAt,
    corpusSha256: requireSha256(input.corpusSha256, "manifest.corpusSha256"),
    candidateLockSha256: requireSha256(input.candidateLockSha256, "manifest.candidateLockSha256"),
    buildContractSha256: requireSha256(input.buildContractSha256, "manifest.buildContractSha256"),
  });
}

function validateDescriptorLock(corpus: RetrievalEvaluationCorpusV2): void {
  const descriptorIds = corpus.retrievers.map(({ id }) => id);
  const lockIds = corpus.candidateLock.descriptorDigests.map(({ retrieverId }) => retrieverId);
  if (descriptorIds.length !== lockIds.length || descriptorIds.some((id, index) => id !== lockIds[index])) {
    throw new TypeError("candidateLock must commit to every retriever descriptor exactly once.");
  }
  const descriptors = new Map(corpus.retrievers.map((descriptor) => [descriptor.id, descriptor]));
  for (const locked of corpus.candidateLock.descriptorDigests) {
    const descriptor = descriptors.get(locked.retrieverId);
    if (descriptor === undefined || evaluationRetrieverDescriptorDigestV2(descriptor) !== locked.sha256) {
      throw new TypeError(`candidateLock descriptor digest does not match ${locked.retrieverId}.`);
    }
  }
  if (descriptors.get(corpus.candidateLock.baselineRetrieverId)?.role !== "baseline") {
    throw new TypeError("candidateLock.baselineRetrieverId must name a baseline descriptor.");
  }
  const candidates = corpus.retrievers.filter(({ role }) => role === "candidate").map(({ id }) => id);
  if (candidates.length !== corpus.candidateLock.candidateRetrieverIds.length || candidates.some((id, index) => id !== corpus.candidateLock.candidateRetrieverIds[index])) {
    throw new TypeError("candidateLock.candidateRetrieverIds must exactly name candidate descriptors.");
  }
  if (evaluationCandidateLockDigestV2(corpus.candidateLock) !== corpus.manifest.candidateLockSha256) {
    throw new TypeError("manifest.candidateLockSha256 does not match candidateLock.");
  }
}

export function parseRetrievalEvaluationCorpusV2(
  inputValue: unknown,
  options: EvaluationCorpusParseOptionsV2,
): RetrievalEvaluationCorpusV2 {
  if (options === undefined || typeof options !== "object" || options === null) {
    throw new TypeError("evaluation v2 corpus parsing requires an explicit promotion claim.");
  }
  const parsedOptions = record(options, "evaluation v2 corpus parse options");
  if (parsedOptions.claimPromotion !== true && parsedOptions.claimPromotion !== false) {
    throw new TypeError("evaluation v2 corpus parsing requires claimPromotion true or false.");
  }
  strictKeys(
    parsedOptions,
    parsedOptions.claimPromotion ? ["claimPromotion", "expectedSeal"] : ["claimPromotion"],
    "evaluation v2 corpus parse options",
  );
  const input = record(inputValue, "evaluation v2 corpus");
  strictKeys(input, [
    "assessment", "candidateLock", "description", "documents", "evidenceUnits", "experiment", "frozen", "id",
    "manifest", "measurementProfiles", "queries", "retrievers", "schemaVersion", "sourceFamilies",
  ], "evaluation v2 corpus");
  if (input.schemaVersion !== RETRIEVAL_EVALUATION_V2_SCHEMA_VERSION) {
    throw new TypeError(`evaluation v2 corpus schemaVersion must be ${RETRIEVAL_EVALUATION_V2_SCHEMA_VERSION}.`);
  }
  const frozenInput = record(input.frozen, "frozen");
  strictKeys(frozenInput, ["repositoryCommit", "vaultRoot", "vaultTree"], "frozen");
  if (typeof frozenInput.repositoryCommit !== "string" || !gitObjectPattern.test(frozenInput.repositoryCommit)) {
    throw new TypeError("frozen.repositoryCommit must be a lowercase Git object ID.");
  }
  if (typeof frozenInput.vaultTree !== "string" || !gitObjectPattern.test(frozenInput.vaultTree)) {
    throw new TypeError("frozen.vaultTree must be a lowercase Git object ID.");
  }
  const assessmentInput = record(input.assessment, "assessment");
  strictKeys(assessmentInput, ["assessors", "rubricVersion"], "assessment");
  if (!Array.isArray(assessmentInput.assessors) || assessmentInput.assessors.length < 1 || assessmentInput.assessors.length > 100) {
    throw new TypeError("assessment.assessors must contain from 1 through 100 entries.");
  }
  const assessors = assessmentInput.assessors.map(parseAssessor);
  assertCanonicalOrder(assessors, ({ id }) => id, "assessment.assessors");

  if (!Array.isArray(input.sourceFamilies) || input.sourceFamilies.length < 1 || input.sourceFamilies.length > MAX_EVALUATION_V2_DOCUMENTS) {
    throw new TypeError("sourceFamilies must be a non-empty bounded array.");
  }
  const sourceFamilies = input.sourceFamilies.map(parseSourceFamily);
  assertCanonicalOrder(sourceFamilies, ({ id }) => id, "sourceFamilies");
  if (!Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > MAX_EVALUATION_V2_DOCUMENTS) {
    throw new TypeError("documents must be a non-empty bounded array.");
  }
  const documents = input.documents.map(parseDocument);
  assertCanonicalOrder(documents, ({ id }) => id, "documents");
  if (!Array.isArray(input.evidenceUnits) || input.evidenceUnits.length < 1 || input.evidenceUnits.length > MAX_EVALUATION_V2_EVIDENCE_UNITS) {
    throw new TypeError("evidenceUnits must be a non-empty bounded array.");
  }
  const evidenceUnits = input.evidenceUnits.map(parseEvidenceUnit);
  assertCanonicalOrder(evidenceUnits, ({ id }) => id, "evidenceUnits");
  if (!Array.isArray(input.measurementProfiles) || input.measurementProfiles.length < 1 || input.measurementProfiles.length > 32) {
    throw new TypeError("measurementProfiles must contain from 1 through 32 entries.");
  }
  const measurementProfiles = input.measurementProfiles.map(parseMeasurementProfile);
  assertCanonicalOrder(measurementProfiles, ({ id }) => id, "measurementProfiles");
  if (new Set(measurementProfiles.map(({ operation }) => operation)).size !== measurementProfiles.length) {
    throw new TypeError("measurementProfiles must not repeat an operation.");
  }
  if (!Array.isArray(input.retrievers) || input.retrievers.length < 1 || input.retrievers.length > 64) {
    throw new TypeError("retrievers must contain from 1 through 64 entries.");
  }
  const retrievers = input.retrievers.map(parseRetrieverDescriptor);
  assertCanonicalOrder(retrievers, ({ id }) => id, "retrievers");
  if (!Array.isArray(input.queries) || input.queries.length < 1 || input.queries.length > MAX_EVALUATION_V2_QUERIES) {
    throw new TypeError(`queries must contain from 1 through ${MAX_EVALUATION_V2_QUERIES} entries.`);
  }
  const queries = input.queries.map(parseQuery);
  assertCanonicalOrder(queries, ({ id }) => id, "queries");
  const nuggetIds = queries.flatMap(({ gold }) => gold.nuggets.map(({ id }) => id));
  if (new Set(nuggetIds).size !== nuggetIds.length) {
    throw new TypeError("query nuggets must use corpus-wide unique IDs.");
  }
  const supportSetIds = queries.flatMap(({ gold }) =>
    gold.nuggets.flatMap(({ acceptableSupportSets }) => acceptableSupportSets.map(({ id }) => id)));
  if (new Set(supportSetIds).size !== supportSetIds.length) {
    throw new TypeError("acceptable support sets must use corpus-wide unique IDs.");
  }

  const corpus: RetrievalEvaluationCorpusV2 = Object.freeze({
    schemaVersion: 2,
    id: canonicalId(input.id, "id"),
    description: boundedString(input.description, "description"),
    manifest: parseManifest(input.manifest),
    frozen: Object.freeze({
      repositoryCommit: frozenInput.repositoryCommit,
      vaultTree: frozenInput.vaultTree,
      vaultRoot: confinedPath(frozenInput.vaultRoot, "frozen.vaultRoot"),
    }),
    assessment: Object.freeze({
      rubricVersion: boundedString(assessmentInput.rubricVersion, "assessment.rubricVersion", 256),
      assessors: Object.freeze(assessors),
    }),
    experiment: parseExperiment(input.experiment),
    sourceFamilies: Object.freeze(sourceFamilies),
    documents: Object.freeze(documents),
    evidenceUnits: Object.freeze(evidenceUnits),
    measurementProfiles: Object.freeze(measurementProfiles),
    retrievers: Object.freeze(retrievers),
    candidateLock: parseCandidateLock(input.candidateLock),
    queries: Object.freeze(queries),
  });

  const familyById = new Map(sourceFamilies.map((family) => [family.id, family]));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const evidenceById = new Map(evidenceUnits.map((unit) => [unit.id, unit]));
  const assessorIds = new Set(assessors.map(({ id }) => id));
  const documentBySourcePath = new Map<string, string>();
  for (const document of documents) {
    const family = familyById.get(document.sourceFamilyId);
    if (family === undefined) throw new TypeError(`document ${document.id} references an unknown source family.`);
    if (family.trustClass !== document.trustClass) {
      throw new TypeError(`document ${document.id} trust declaration disagrees with its source family.`);
    }
    const previousDocumentId = documentBySourcePath.get(document.sourcePath);
    if (previousDocumentId !== undefined) {
      throw new TypeError(
        `document source path ${document.sourcePath} is already bound to ${previousDocumentId}.`,
      );
    }
    documentBySourcePath.set(document.sourcePath, document.id);
  }
  const occupiedRanges = new Set<string>();
  const sourceIdentityByPath = new Map<string, { readonly documentId: string; readonly sourceFamilyId: string }>();
  for (const unit of evidenceUnits) {
    const document = documentById.get(unit.documentId);
    const family = familyById.get(unit.sourceFamilyId);
    if (document === undefined) throw new TypeError(`evidence unit ${unit.id} references an unknown document.`);
    if (family === undefined) throw new TypeError(`evidence unit ${unit.id} references an unknown source family.`);
    if (document.sourceFamilyId !== unit.sourceFamilyId || document.trustClass !== unit.trustClass || family.trustClass !== unit.trustClass) {
      throw new TypeError(`evidence unit ${unit.id} has inconsistent source-family or trust declarations.`);
    }
    if (document.sourcePath !== unit.sourcePath) {
      throw new TypeError(
        `evidence unit ${unit.id} source path disagrees with document ${document.id}.`,
      );
    }
    const previousSourceIdentity = sourceIdentityByPath.get(unit.sourcePath);
    if (
      previousSourceIdentity !== undefined
      && (
        previousSourceIdentity.documentId !== unit.documentId
        || previousSourceIdentity.sourceFamilyId !== unit.sourceFamilyId
      )
    ) {
      throw new TypeError(
        `source path ${unit.sourcePath} must belong to exactly one document and source family.`,
      );
    }
    sourceIdentityByPath.set(unit.sourcePath, {
      documentId: unit.documentId,
      sourceFamilyId: unit.sourceFamilyId,
    });
    const rangeKey = `${unit.sourcePath}\0${unit.lineRange.start}\0${unit.lineRange.end}`;
    if (occupiedRanges.has(rangeKey)) throw new TypeError(`evidence unit ${unit.id} repeats a canonical source range.`);
    occupiedRanges.add(rangeKey);
  }
  for (const query of queries) {
    validateGoldReferences(query, documentById, evidenceById, assessorIds, `query ${query.id}`);
  }
  validateDescriptorLock(corpus);
  if (evaluationCorpusDigestV2(corpus) !== corpus.manifest.corpusSha256) {
    throw new TypeError("manifest.corpusSha256 does not match the sealed evaluation corpus.");
  }
  if (options.claimPromotion) {
    const expectedSeal = record(options.expectedSeal, "promotion expected seal");
    strictKeys(expectedSeal, ["expectedCorpusSha256", "expectedGitBlob"], "promotion expected seal");
    const hasCorpusSha256 = expectedSeal.expectedCorpusSha256 !== undefined;
    const hasGitBlob = expectedSeal.expectedGitBlob !== undefined;
    if (hasCorpusSha256 === hasGitBlob) {
      throw new TypeError("promotion expected seal must supply exactly one corpus digest or Git blob commitment.");
    }
    if (hasCorpusSha256) {
      const expected = requireSha256(
        expectedSeal.expectedCorpusSha256,
        "promotion expected seal.expectedCorpusSha256",
      );
      if (expected !== evaluationCorpusDigestV2(corpus)) {
        throw new TypeError("promotion corpus does not match the independently supplied corpus digest.");
      }
    } else {
      if (typeof expectedSeal.expectedGitBlob !== "string" || !gitObjectPattern.test(expectedSeal.expectedGitBlob)) {
        throw new TypeError("promotion expected seal.expectedGitBlob must be a lowercase Git object ID.");
      }
      const objectFormat = expectedSeal.expectedGitBlob.length === 40 ? "sha1" : "sha256";
      if (evaluationCorpusGitBlobCommitmentV2(corpus, objectFormat) !== expectedSeal.expectedGitBlob) {
        throw new TypeError("promotion corpus does not match the independently supplied Git blob commitment.");
      }
    }
    validatePromotionCorpusLayoutV2(corpus);
  }
  return corpus;
}

export function assertEvaluationRetrieverLockedV2(
  corpus: RetrievalEvaluationCorpusV2,
  descriptor: EvaluationRetrieverDescriptorV2,
): void {
  const locked = corpus.candidateLock.descriptorDigests.find(({ retrieverId }) => retrieverId === descriptor.id);
  const declared = corpus.retrievers.find(({ id }) => id === descriptor.id);
  const digest = evaluationRetrieverDescriptorDigestV2(descriptor);
  if (
    locked === undefined
    || declared === undefined
    || locked.sha256 !== digest
    || evaluationRetrieverDescriptorDigestV2(declared) !== digest
  ) throw new TypeError(`Retriever descriptor ${descriptor.id} is not committed by the sealed suite.`);
}

export function projectEvaluationExecutionQueryV2(
  query: Pick<EvaluationQueryV2, "cohort" | "inputs">,
): EvaluationExecutionQueryV2 {
  const cohort = query.cohort;
  if (cohort !== "caller-seeded" && cohort !== "text-only") {
    throw new TypeError("execution query cohort is invalid.");
  }
  const inputs = parseRetrievalInputsV2(query.inputs, "execution query inputs");
  validateCohortInputs(cohort, inputs, "execution query");
  return cohort === "text-only"
    ? Object.freeze({ inputs: Object.freeze({ text: inputs.text }) })
    : Object.freeze({ inputs });
}

export function createEvaluationExecutionRequestV2(options: {
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly query: Pick<EvaluationQueryV2, "cohort" | "inputs">;
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly limit: number;
  readonly signal: AbortSignal;
}): EvaluationExecutionRequestV2 {
  assertEvaluationRetrieverLockedV2(options.corpus, options.descriptor);
  return Object.freeze({
    corpus: options.corpus.frozen,
    query: projectEvaluationExecutionQueryV2(options.query),
    limit: safeInteger(options.limit, "execution limit", 1, MAX_EVALUATION_V2_RESULTS_PER_LANE),
    signal: options.signal,
  });
}

function referencedFamilyIds(
  query: EvaluationQueryV2,
  evidenceById: ReadonlyMap<string, EvaluationEvidenceUnitV2>,
  documentById: ReadonlyMap<string, EvaluationDocumentV2>,
): ReadonlySet<string> {
  const families = new Set<string>();
  for (const { documentId } of query.gold.documents) {
    const familyId = documentById.get(documentId)?.sourceFamilyId;
    if (familyId !== undefined) families.add(familyId);
  }
  for (const { evidenceUnitId } of query.gold.evidenceUnits) {
    const familyId = evidenceById.get(evidenceUnitId)?.sourceFamilyId;
    if (familyId !== undefined) families.add(familyId);
  }
  return families;
}

/**
 * Assign each query to the connected component of every causal source family it
 * judges. Reviewed families may contain multiple provenance/trust subfamilies;
 * their shared assignment commitment keeps those dependent records in one
 * statistical cluster. Legacy/unreviewed corpora fall back to the provenance
 * family ID.
 */
export function evaluationSourceFamilyClusterIdsV2(
  queries: readonly EvaluationQueryV2[],
  documents: readonly EvaluationDocumentV2[],
  evidenceUnits: readonly EvaluationEvidenceUnitV2[],
  sourceFamilies: readonly EvaluationSourceFamilyV2[] = [],
): ReadonlyMap<string, string> {
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const evidenceById = new Map(evidenceUnits.map((unit) => [unit.id, unit]));
  const clusterKeyByFamilyId = new Map(sourceFamilies.map((family) => [
    family.id,
    family.familyAssignmentSha256 === undefined
      ? family.id
      : `family-assignment:${family.familyAssignmentSha256}`,
  ]));
  const familiesByQuery = new Map(queries.map((query) => {
    const families = [...referencedFamilyIds(query, evidenceById, documentById)]
      .map((familyId) => clusterKeyByFamilyId.get(familyId) ?? familyId)
      .toSorted();
    if (families.length === 0) throw new TypeError(`Query ${query.id} has no sealed source-family cluster.`);
    return [query.id, families] as const;
  }));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const existing = parent.get(id);
    if (existing === undefined) {
      parent.set(id, id);
      return id;
    }
    if (existing === id) return id;
    const root = find(existing);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const root = leftRoot < rightRoot ? leftRoot : rightRoot;
    parent.set(root === leftRoot ? rightRoot : leftRoot, root);
  };
  for (const families of familiesByQuery.values()) {
    const first = families[0];
    if (first === undefined) continue;
    for (const family of families.slice(1)) union(first, family);
  }
  return new Map([...familiesByQuery].map(([queryId, families]) => {
    const first = families[0];
    if (first === undefined) throw new TypeError(`Query ${queryId} has no source family.`);
    return [queryId, find(first)] as const;
  }));
}

function requireOpaqueIds(corpus: RetrievalEvaluationCorpusV2): void {
  for (const query of corpus.queries) {
    if (!opaquePatterns.query.test(query.id)) {
      throw new TypeError(`promotion query ID ${query.id} must be opaque and canonical.`);
    }
    for (const nugget of query.gold.nuggets) {
      if (!opaquePatterns.nugget.test(nugget.id)) {
        throw new TypeError(`promotion nugget ID ${nugget.id} must be opaque and canonical.`);
      }
      for (const supportSet of nugget.acceptableSupportSets) {
        if (!opaquePatterns.supportSet.test(supportSet.id)) {
          throw new TypeError(`promotion support-set ID ${supportSet.id} must be opaque and canonical.`);
        }
      }
    }
  }
  for (const family of corpus.sourceFamilies) {
    if (!opaquePatterns.sourceFamily.test(family.id)) {
      throw new TypeError(`promotion source-family ID ${family.id} must be opaque and canonical.`);
    }
  }
  for (const unit of corpus.evidenceUnits) {
    if (!opaquePatterns.evidenceUnit.test(unit.id)) {
      throw new TypeError(`promotion evidence-unit ID ${unit.id} must be opaque and canonical.`);
    }
  }
}

function validatePromotionCorpusLayoutV2(corpus: RetrievalEvaluationCorpusV2): void {
  if (corpus.queries.length !== PROMOTION_EVALUATION_QUERY_COUNT_V2) {
    throw new TypeError(`promotion corpus must contain exactly ${PROMOTION_EVALUATION_QUERY_COUNT_V2} queries.`);
  }
  const development = corpus.queries.filter(({ split }) => split === "development");
  const test = corpus.queries.filter(({ split }) => split === "test");
  if (development.length !== PROMOTION_DEVELOPMENT_QUERY_COUNT_V2 || test.length !== PROMOTION_TEST_QUERY_COUNT_V2) {
    throw new TypeError("promotion corpus must contain exactly 48 development and 120 test queries.");
  }
  for (const cohort of ["caller-seeded", "text-only"] as const) {
    if (development.filter((query) => query.cohort === cohort).length !== 24) {
      throw new TypeError(`promotion development split must contain exactly 24 ${cohort} queries.`);
    }
    for (const expectedSupport of ["supported", "insufficient"] as const) {
      if (development.filter((query) =>
        query.cohort === cohort && query.expectedSupport === expectedSupport).length !== 12) {
        throw new TypeError(
          `promotion development ${cohort} cohort must contain exactly 12 ${expectedSupport} queries.`,
        );
      }
    }
  }
  if (
    test.filter(({ expectedSupport }) => expectedSupport === "supported").length !== PROMOTION_TEST_SUPPORTED_COUNT_V2
    || test.filter(({ expectedSupport }) => expectedSupport === "insufficient").length !== PROMOTION_TEST_INSUFFICIENT_COUNT_V2
  ) throw new TypeError("promotion test split must contain exactly 80 supported and 40 insufficient queries.");
  for (const cohort of ["caller-seeded", "text-only"] as const) {
    if (corpus.queries.filter((query) => query.cohort === cohort).length !== PROMOTION_COHORT_COUNT_V2) {
      throw new TypeError(`promotion corpus must contain exactly 84 ${cohort} queries.`);
    }
    if (test.filter((query) => query.cohort === cohort).length !== PROMOTION_TEST_COHORT_COUNT_V2) {
      throw new TypeError(`promotion test split must contain exactly 60 ${cohort} queries.`);
    }
    if (
      test.filter((query) => query.cohort === cohort && query.expectedSupport === "supported").length !== 40
      || test.filter((query) => query.cohort === cohort && query.expectedSupport === "insufficient").length !== 20
    ) {
      throw new TypeError(
        `promotion test ${cohort} cohort must contain exactly 40 supported and 20 insufficient queries.`,
      );
    }
  }
  for (const [stratum, minimum] of Object.entries(PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2)) {
    if (test.filter((query) => query.primaryStratum === stratum).length < minimum) {
      throw new TypeError(
        `promotion test split requires at least ${minimum} primary ${stratum} queries.`,
      );
    }
    for (const cohort of ["caller-seeded", "text-only"] as const) {
      const cohortMinimum = PROMOTION_ACCEPTANCE_STRATUM_COHORT_MINIMA_V2[
        stratum as keyof typeof PROMOTION_ACCEPTANCE_STRATUM_COHORT_MINIMA_V2
      ];
      if (
        test.filter((query) => query.cohort === cohort && query.primaryStratum === stratum).length
        < cohortMinimum
      ) {
        throw new TypeError(
          `promotion test ${cohort} cohort requires at least ${cohortMinimum} primary ${stratum} queries.`,
        );
      }
    }
  }
  for (const query of test) {
    if (
      (query.expectedSupport === "insufficient")
      !== query.strata.includes("no-answer-near-miss")
    ) {
      throw new TypeError(
        "promotion test insufficient queries must be explicitly stratified as no-answer near misses, and supported queries must not be.",
      );
    }
  }
  for (const [inputLane, minimum] of Object.entries(PROMOTION_CRITICAL_INPUT_MINIMA_V2)) {
    if (test.filter((query) => query.inputs[inputLane as keyof EvaluationRetrievalInputsV2] !== undefined).length < minimum) {
      throw new TypeError(`promotion test split requires at least ${minimum} executable ${inputLane} lane inputs.`);
    }
  }
  const dual = corpus.queries.filter(({ rawAssessments }) => rawAssessments.length >= 2);
  if (dual.length < PROMOTION_DUAL_ASSESSMENT_MINIMUM_V2) {
    throw new TypeError("promotion corpus requires independent dual assessment for at least 25 percent of queries.");
  }
  const promotionStrata = [
    ...Object.keys(PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2),
    "no-answer-near-miss",
  ] as EvaluationStratumV2[];
  for (const stratum of promotionStrata) {
    for (const cohort of ["caller-seeded", "text-only"] as const) {
      const cell = test.filter((query) =>
        query.cohort === cohort
        && (stratum === "no-answer-near-miss"
          ? query.strata.includes(stratum)
          : query.primaryStratum === stratum));
      const minimumDual = Math.max(
        PROMOTION_STRATUM_COHORT_DUAL_MINIMUM_V2,
        Math.ceil(cell.length * PROMOTION_STRATUM_COHORT_DUAL_FRACTION_V2),
      );
      if (cell.filter(({ rawAssessments }) => rawAssessments.length >= 2).length < minimumDual) {
        throw new TypeError(
          `promotion test ${cohort} ${stratum} stratum requires at least ${minimumDual} independently dual-assessed queries.`,
        );
      }
    }
  }

  const effects = corpus.experiment.protocol.minimumUsefulEffects;
  if (
    effects.length !== 1
    || effects[0]?.metric !== "nugget-coverage"
    || effects[0].cohort !== "caller-seeded"
  ) {
    throw new TypeError(
      "promotion experiment must declare exactly one caller-seeded nugget-coverage minimum useful effect.",
    );
  }
  const marginMetrics = corpus.experiment.protocol.nonInferiorityMargins.map(({ metric }) => metric);
  if (
    marginMetrics.length !== promotionNonInferiorityMetrics.size
    || [...promotionNonInferiorityMetrics].some((metric) => !marginMetrics.includes(metric))
  ) {
    throw new TypeError("promotion experiment must predeclare every required metric-specific non-inferiority margin.");
  }
  const pairedPower = corpus.experiment.protocol.pairedPower;
  if (
    pairedPower.alpha !== 0.05
    || pairedPower.targetPower < 0.8
    || pairedPower.minimumUsefulEffect !== effects[0].minimumAbsoluteDifference
  ) {
    throw new TypeError(
      "promotion paired-power design must use one-sided alpha 0.05, at least 80 percent power, and the primary MUE threshold.",
    );
  }
  const eligiblePrimaryPairs = test.filter((query) =>
    query.cohort === "caller-seeded" && query.expectedSupport === "supported").length;
  if (eligiblePrimaryPairs < pairedPower.requiredPairs) {
    throw new TypeError(
      `promotion primary effect has ${eligiblePrimaryPairs} eligible pairs but its prospective design requires ${pairedPower.requiredPairs}.`,
    );
  }
  const testClusterIds = evaluationSourceFamilyClusterIdsV2(
    test,
    corpus.documents,
    corpus.evidenceUnits,
    corpus.sourceFamilies,
  );
  const eligiblePrimaryClusters = new Set(test
    .filter((query) => query.cohort === "caller-seeded" && query.expectedSupport === "supported")
    .map((query) => testClusterIds.get(query.id))).size;
  if (eligiblePrimaryClusters < pairedPower.requiredPairs) {
    throw new TypeError(
      `promotion primary effect has ${eligiblePrimaryClusters} independent source-family clusters but its prospective design requires ${pairedPower.requiredPairs}.`,
    );
  }
  for (const descriptor of corpus.retrievers) {
    if (Object.keys(descriptor.configuration).length === 0) {
      throw new TypeError(`promotion retriever descriptor ${descriptor.id} must have a non-empty configuration.`);
    }
  }

  const evidenceById = new Map(corpus.evidenceUnits.map((unit) => [unit.id, unit]));
  const documentById = new Map(corpus.documents.map((document) => [document.id, document]));
  const sourceFamilyById = new Map(corpus.sourceFamilies.map((family) => [family.id, family]));
  const familySplits = new Map<string, EvaluationSplitV2>();
  for (const query of corpus.queries) {
    for (const familyId of referencedFamilyIds(query, evidenceById, documentById)) {
      const family = sourceFamilyById.get(familyId);
      if (family?.familyAssignmentSha256 === undefined) {
        throw new TypeError(
          `promotion source family ${familyId} is referenced by a query but lacks an independently reviewed family-assignment commitment.`,
        );
      }
      const familyClusterId = `family-assignment:${family.familyAssignmentSha256}`;
      const previous = familySplits.get(familyClusterId);
      if (previous !== undefined && previous !== query.split) {
        throw new TypeError(`source-family assignment ${family.familyAssignmentSha256} crosses development and test splits.`);
      }
      familySplits.set(familyClusterId, query.split);
    }
  }
  // The frozen catalog intentionally contains retrieval distractors that are not qrels.
  // Every judgment remains registry-bound above; catalog membership does not imply a grade.
  requireOpaqueIds(corpus);
  const requiredOperations = new Set<EvaluationMeasurementOperationV2>([
    "cold-index", "four-reader-query", "incremental-update", "packing", "warm-query",
  ]);
  for (const profile of corpus.measurementProfiles) {
    requiredOperations.delete(profile.operation);
    if (profile.repetitions < 3) {
      throw new TypeError(`promotion measurement profile ${profile.id} requires at least three repetitions.`);
    }
  }
  if (requiredOperations.size > 0) {
    throw new TypeError(`promotion corpus is missing measurement profiles: ${[...requiredOperations].toSorted().join(", ")}.`);
  }
}

/** Validate every promotion-design invariant before an independent seal is anchored. */
export function validatePromotionCorpusDesignV2(
  input: RetrievalEvaluationCorpusV2,
): RetrievalEvaluationCorpusV2 {
  const corpus = parseRetrievalEvaluationCorpusV2(input, { claimPromotion: false });
  validatePromotionCorpusLayoutV2(corpus);
  return corpus;
}

export function validatePromotionCorpusV2(
  input: unknown,
  expectedSeal: EvaluationExternalCorpusSealV2,
): RetrievalEvaluationCorpusV2 {
  return parseRetrievalEvaluationCorpusV2(input, {
    claimPromotion: true,
    expectedSeal,
  });
}

function parseEvidenceLocator(
  value: unknown,
  label: string,
  documentId: string,
  laneId: EvaluationLaneIdV2,
  evidenceById: ReadonlyMap<string, EvaluationEvidenceUnitV2>,
  familyById: ReadonlyMap<string, EvaluationSourceFamilyV2>,
): EvaluationEvidenceLocatorV2 {
  const input = record(value, label);
  strictKeys(input, [
    "evidenceUnitId",
    "headingPath",
    "lineRange",
    "sourceClass",
    "sourceFamilyId",
    "sourcePage",
    "sourcePath",
    "trustClass",
  ], label);
  const parsedEvidenceUnitId = evidenceUnitId(input.evidenceUnitId, `${label}.evidenceUnitId`);
  const unit = evidenceById.get(parsedEvidenceUnitId);
  if (unit === undefined) throw new TypeError(`${label} references unknown evidence unit ${parsedEvidenceUnitId}.`);
  if (unit.documentId !== documentId && laneId !== "graph") {
    throw new TypeError(`${label} evidence unit ${parsedEvidenceUnitId} belongs to a different document.`);
  }
  const family = familyById.get(unit.sourceFamilyId);
  if (family === undefined) throw new TypeError(`${label} evidence unit has an unknown source family.`);
  if (
    input.sourceFamilyId !== unit.sourceFamilyId
    || input.sourceClass !== family.sourceClass
    || input.trustClass !== unit.trustClass
  ) {
    throw new TypeError(`${label} source-family, source-class, or trust declaration is not registry-bound.`);
  }
  const sourcePage = input.sourcePage === undefined
    ? undefined
    : safeInteger(input.sourcePage, `${label}.sourcePage`, 1, 1_000_000);
  const parsed: EvaluationEvidenceLocatorV2 = Object.freeze({
    evidenceUnitId: parsedEvidenceUnitId,
    sourceFamilyId: boundedString(input.sourceFamilyId, `${label}.sourceFamilyId`, 256),
    sourceClass: input.sourceClass as EvaluationSourceClassV2,
    trustClass: input.trustClass as EvaluationTrustClassV2,
    sourcePath: confinedPath(input.sourcePath, `${label}.sourcePath`),
    lineRange: parseLineRange(input.lineRange, `${label}.lineRange`),
    headingPath: parseHeadingPath(input.headingPath, `${label}.headingPath`),
    ...(sourcePage === undefined ? {} : { sourcePage }),
  });
  const expected: EvaluationEvidenceLocatorV2 = {
    evidenceUnitId: unit.id,
    sourceFamilyId: unit.sourceFamilyId,
    sourceClass: family.sourceClass,
    trustClass: unit.trustClass,
    sourcePath: unit.sourcePath,
    lineRange: unit.lineRange,
    headingPath: unit.headingPath,
    ...(unit.sourcePage === undefined ? {} : { sourcePage: unit.sourcePage }),
  };
  if (canonicalJson(parsed) !== canonicalJson(expected)) {
    throw new TypeError(`${label} must exactly match its frozen registry evidence unit.`);
  }
  return parsed;
}

function parseEvidenceLocators(
  value: unknown,
  label: string,
  documentId: string,
  laneId: EvaluationLaneIdV2,
  evidenceUnitIds: readonly string[],
  evidenceById: ReadonlyMap<string, EvaluationEvidenceUnitV2>,
  familyById: ReadonlyMap<string, EvaluationSourceFamilyV2>,
): readonly EvaluationEvidenceLocatorV2[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError(`${label} must contain at most 100 per-unit locators.`);
  }
  const parsed = value.map((entry, index) => parseEvidenceLocator(
    entry,
    `${label}[${index}]`,
    documentId,
    laneId,
    evidenceById,
    familyById,
  ));
  assertCanonicalOrder(parsed, ({ evidenceUnitId: id }) => id, label);
  if (
    parsed.length !== evidenceUnitIds.length
    || parsed.some(({ evidenceUnitId: id }, index) => id !== evidenceUnitIds[index])
  ) {
    throw new TypeError(`${label} must preserve a one-to-one locator association for every evidence unit.`);
  }
  return Object.freeze(parsed);
}

function parseRankedCandidate(
  value: unknown,
  label: string,
  laneId: EvaluationLaneIdV2,
  evidenceById: ReadonlyMap<string, EvaluationEvidenceUnitV2>,
  documentById: ReadonlyMap<string, EvaluationDocumentV2>,
  familyById: ReadonlyMap<string, EvaluationSourceFamilyV2>,
): EvaluationRankedCandidateV2 {
  const input = record(value, label);
  strictKeys(input, ["documentId", "evidenceUnitIds", "provenance", "rank", "score"], label);
  const documentId = confinedPath(input.documentId, `${label}.documentId`);
  if (!documentById.has(documentId)) throw new TypeError(`${label} references unknown document ${documentId}.`);
  const evidenceUnitIds = Object.freeze(stringList(input.evidenceUnitIds, `${label}.evidenceUnitIds`, {
    allowEmpty: true,
    canonical: true,
    maximum: 100,
  }).map((id, evidenceIndex) => evidenceUnitId(id, `${label}.evidenceUnitIds[${evidenceIndex}]`)));
  for (const id of evidenceUnitIds) {
    const unit = evidenceById.get(id);
    if (unit === undefined) throw new TypeError(`${label} references unknown evidence unit ${id}.`);
    if (unit.documentId !== documentId && laneId !== "graph") {
      throw new TypeError(`${label} evidence unit ${id} belongs to a different document.`);
    }
  }
  if (input.score !== undefined && (typeof input.score !== "number" || !Number.isFinite(input.score))) {
    throw new TypeError(`${label}.score must be finite.`);
  }
  return Object.freeze({
    documentId,
    evidenceUnitIds,
    rank: safeInteger(input.rank, `${label}.rank`, 1, MAX_EVALUATION_V2_RESULTS_PER_LANE),
    ...(input.score === undefined ? {} : { score: input.score }),
    provenance: parseEvidenceLocators(
      input.provenance,
      `${label}.provenance`,
      documentId,
      laneId,
      evidenceUnitIds,
      evidenceById,
      familyById,
    ),
  });
}

function parseLaneOutcome(
  value: unknown,
  index: number,
  evidenceById: ReadonlyMap<string, EvaluationEvidenceUnitV2>,
  documentById: ReadonlyMap<string, EvaluationDocumentV2>,
  familyById: ReadonlyMap<string, EvaluationSourceFamilyV2>,
): EvaluationLaneOutcomeV2 {
  const label = `sample.trace.laneOutcomes[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["applicability", "laneId", "rawRanking", "reasonCodes", "status"], label);
  if (typeof input.laneId !== "string" || !lanes.has(input.laneId as EvaluationLaneIdV2)) {
    throw new TypeError(`${label}.laneId is invalid.`);
  }
  if (input.applicability !== "applied" && input.applicability !== "skipped") {
    throw new TypeError(`${label}.applicability is invalid.`);
  }
  if (input.status !== "degraded" && input.status !== "ready" && input.status !== "unavailable") {
    throw new TypeError(`${label}.status is invalid.`);
  }
  const reasonCodes = stringList(input.reasonCodes, `${label}.reasonCodes`, {
    allowEmpty: true,
    canonical: true,
    maximum: 100,
  }).map((code, reasonIndex) => canonicalId(code, `${label}.reasonCodes[${reasonIndex}]`));
  if (!Array.isArray(input.rawRanking) || input.rawRanking.length > MAX_EVALUATION_V2_RESULTS_PER_LANE) {
    throw new TypeError(`${label}.rawRanking has too many entries.`);
  }
  const rawRanking = input.rawRanking.map((entry, rankIndex) =>
    parseRankedCandidate(
      entry,
      `${label}.rawRanking[${rankIndex}]`,
      input.laneId as EvaluationLaneIdV2,
      evidenceById,
      documentById,
      familyById,
    ));
  if (rawRanking.some(({ rank }, rankIndex) => rank !== rankIndex + 1)) {
    throw new TypeError(`${label}.rawRanking ranks must be contiguous and canonical.`);
  }
  if (new Set(rawRanking.map(({ documentId }) => documentId)).size !== rawRanking.length) {
    throw new TypeError(`${label}.rawRanking must not repeat a document.`);
  }
  if ((input.applicability === "skipped" || input.status === "unavailable") && rawRanking.length > 0) {
    throw new TypeError(`${label} skipped or unavailable lanes may not contain a raw ranking.`);
  }
  if (
    (input.applicability === "skipped" || input.status === "degraded" || input.status === "unavailable")
    && reasonCodes.length === 0
  ) {
    throw new TypeError(`${label} skipped, degraded, or unavailable lanes require a reason code.`);
  }
  if (input.applicability === "skipped" && input.status === "degraded") {
    throw new TypeError(`${label} skipped lanes cannot have degraded status.`);
  }
  return Object.freeze({
    laneId: input.laneId as EvaluationLaneIdV2,
    applicability: input.applicability,
    status: input.status,
    reasonCodes: Object.freeze(reasonCodes),
    rawRanking: Object.freeze(rawRanking),
  });
}

const candidateReasons = new Set<EvaluationCandidateReasonV2>([
  "appended", "boundary", "deduplicated", "missing-provenance", "output-limit", "primary",
  "primary-retain-limit", "trust", "unsupported",
]);

function parseCandidateDecision(
  value: unknown,
  index: number,
  evidenceById: ReadonlyMap<string, EvaluationEvidenceUnitV2>,
  documentById: ReadonlyMap<string, EvaluationDocumentV2>,
  familyById: ReadonlyMap<string, EvaluationSourceFamilyV2>,
): EvaluationCandidateDecisionV2 {
  const label = `sample.trace.candidateDecisions[${index}]`;
  const input = record(value, label);
  strictKeys(input, [
    "disposition", "documentId", "evidenceUnitIds", "laneId", "outputRank", "provenance",
    "reasonCodes", "sourceRank",
  ], label);
  if (typeof input.laneId !== "string" || !lanes.has(input.laneId as EvaluationLaneIdV2)) {
    throw new TypeError(`${label}.laneId is invalid.`);
  }
  if (input.disposition !== "accepted" && input.disposition !== "excluded") {
    throw new TypeError(`${label}.disposition is invalid.`);
  }
  const documentId = confinedPath(input.documentId, `${label}.documentId`);
  if (!documentById.has(documentId)) throw new TypeError(`${label} references unknown document ${documentId}.`);
  const evidenceUnitIds = Object.freeze(stringList(input.evidenceUnitIds, `${label}.evidenceUnitIds`, {
    allowEmpty: true,
    canonical: true,
    maximum: 100,
  }).map((id, evidenceIndex) => evidenceUnitId(id, `${label}.evidenceUnitIds[${evidenceIndex}]`)));
  for (const id of evidenceUnitIds) {
    const unit = evidenceById.get(id);
    if (unit === undefined) throw new TypeError(`${label} references unknown evidence unit ${id}.`);
    if (unit.documentId !== documentId && input.laneId !== "graph") {
      throw new TypeError(`${label} evidence unit ${id} belongs to another document.`);
    }
  }
  if (!Array.isArray(input.reasonCodes) || input.reasonCodes.length < 1 || input.reasonCodes.length > 20) {
    throw new TypeError(`${label}.reasonCodes must be a non-empty bounded array.`);
  }
  const reasonCodes = input.reasonCodes.map((reason, reasonIndex) => {
    if (typeof reason !== "string" || !candidateReasons.has(reason as EvaluationCandidateReasonV2)) {
      throw new TypeError(`${label}.reasonCodes[${reasonIndex}] is invalid.`);
    }
    return reason as EvaluationCandidateReasonV2;
  });
  if (new Set(reasonCodes).size !== reasonCodes.length || reasonCodes.some((reason, reasonIndex) => reason !== reasonCodes.toSorted()[reasonIndex])) {
    throw new TypeError(`${label}.reasonCodes must be unique and in canonical order.`);
  }
  const outputRank = input.outputRank === undefined
    ? undefined
    : safeInteger(input.outputRank, `${label}.outputRank`, 1, MAX_EVALUATION_V2_RESULTS_PER_LANE);
  if ((input.disposition === "accepted") !== (outputRank !== undefined)) {
    throw new TypeError(`${label} accepted decisions require outputRank and excluded decisions forbid it.`);
  }
  const provenance = parseEvidenceLocators(
    input.provenance,
    `${label}.provenance`,
    documentId,
    input.laneId as EvaluationLaneIdV2,
    evidenceUnitIds,
    evidenceById,
    familyById,
  );
  if (input.disposition === "accepted" && (evidenceUnitIds.length === 0 || provenance.length === 0)) {
    throw new TypeError(`${label} accepted decisions require registry-bound evidence-unit provenance.`);
  }
  const allowedReasons = input.disposition === "accepted"
    ? new Set<EvaluationCandidateReasonV2>(["appended", "primary"])
    : new Set<EvaluationCandidateReasonV2>([
        "boundary",
        "deduplicated",
        "missing-provenance",
        "output-limit",
        "primary-retain-limit",
        "trust",
        "unsupported",
      ]);
  if (reasonCodes.some((reason) => !allowedReasons.has(reason))) {
    throw new TypeError(`${label}.reasonCodes contradict the candidate disposition.`);
  }
  if (input.disposition === "accepted" && reasonCodes.length !== 1) {
    throw new TypeError(`${label} accepted decisions require exactly one acceptance reason.`);
  }
  if (reasonCodes.includes("missing-provenance") && provenance.length > 0) {
    throw new TypeError(`${label} cannot report missing-provenance with registry-bound provenance.`);
  }
  if (reasonCodes.includes("missing-provenance") && reasonCodes.length !== 1) {
    throw new TypeError(`${label} missing-provenance must be the sole exclusion reason.`);
  }
  return Object.freeze({
    documentId,
    evidenceUnitIds,
    laneId: input.laneId as EvaluationLaneIdV2,
    sourceRank: safeInteger(input.sourceRank, `${label}.sourceRank`, 1, MAX_EVALUATION_V2_RESULTS_PER_LANE),
    disposition: input.disposition,
    reasonCodes: Object.freeze(reasonCodes),
    ...(outputRank === undefined ? {} : { outputRank }),
    provenance,
  });
}

function parseTrace(
  value: unknown,
  descriptor: EvaluationRetrieverDescriptorV2,
  evidenceById: ReadonlyMap<string, EvaluationEvidenceUnitV2>,
  documentById: ReadonlyMap<string, EvaluationDocumentV2>,
  familyById: ReadonlyMap<string, EvaluationSourceFamilyV2>,
): EvaluationRetrieverTraceV2 {
  const input = record(value, "sample.trace");
  strictKeys(input, ["candidateDecisions", "laneOutcomes"], "sample.trace");
  if (!Array.isArray(input.laneOutcomes) || input.laneOutcomes.length > lanes.size) {
    throw new TypeError("sample.trace.laneOutcomes is invalid.");
  }
  const laneOutcomes = input.laneOutcomes.map((entry, index) => parseLaneOutcome(
    entry,
    index,
    evidenceById,
    documentById,
    familyById,
  ));
  const actualLanes = laneOutcomes.map(({ laneId }) => laneId);
  if (actualLanes.length !== descriptor.lanes.length || actualLanes.some((lane, index) => lane !== descriptor.lanes[index])) {
    throw new TypeError("sample.trace must report every locked descriptor lane in canonical order.");
  }
  if (!Array.isArray(input.candidateDecisions) || input.candidateDecisions.length > MAX_EVALUATION_V2_TRACE_DECISIONS) {
    throw new TypeError("sample.trace.candidateDecisions has too many entries.");
  }
  const candidateDecisions = input.candidateDecisions.map((entry, index) =>
    parseCandidateDecision(entry, index, evidenceById, documentById, familyById));
  const laneOrder = new Map(descriptor.lanes.map((lane, index) => [lane, index]));
  for (let index = 1; index < candidateDecisions.length; index += 1) {
    const previous = candidateDecisions[index - 1];
    const current = candidateDecisions[index];
    if (previous === undefined || current === undefined) continue;
    const comparison = (laneOrder.get(previous.laneId) ?? 0) - (laneOrder.get(current.laneId) ?? 0)
      || previous.sourceRank - current.sourceRank
      || previous.documentId.localeCompare(current.documentId);
    if (comparison > 0) throw new TypeError("sample.trace.candidateDecisions must be in canonical lane/rank/document order.");
  }
  const decisionKeys = candidateDecisions.map((decision) =>
    `${decision.laneId}\0${decision.sourceRank}\0${decision.documentId}`);
  if (new Set(decisionKeys).size !== decisionKeys.length) {
    throw new TypeError("sample.trace.candidateDecisions must not repeat a lane/rank/document decision.");
  }
  const rawRankingByKey = new Map<string, EvaluationRankedCandidateV2>(laneOutcomes.flatMap(
    (outcome) => outcome.rawRanking.map((candidate) => [
    `${outcome.laneId}\0${candidate.rank}\0${candidate.documentId}`,
    candidate,
    ] as const),
  ));
  if (candidateDecisions.length !== rawRankingByKey.size) {
    throw new TypeError("sample.trace must make exactly one candidate decision for every raw-ranking row.");
  }
  for (const decision of candidateDecisions) {
    if (!laneOrder.has(decision.laneId)) {
      throw new TypeError(`sample.trace decision lane ${decision.laneId} is not in the locked descriptor.`);
    }
    const key = `${decision.laneId}\0${decision.sourceRank}\0${decision.documentId}`;
    const ranked = rawRankingByKey.get(key);
    if (ranked === undefined) {
      throw new TypeError("sample.trace candidate decision does not join to its raw-ranking lane/rank/document row.");
    }
    if (
      canonicalJson(decision.evidenceUnitIds) !== canonicalJson(ranked.evidenceUnitIds)
      || canonicalJson(decision.provenance) !== canonicalJson(ranked.provenance)
    ) {
      throw new TypeError("sample.trace candidate decision evidence and provenance must match its raw-ranking row.");
    }
  }
  const accepted = candidateDecisions.filter(({ disposition }) => disposition === "accepted");
  const outputRanks = accepted.map(({ outputRank }) => outputRank as number)
    .toSorted((left, right) => left - right);
  if (new Set(outputRanks).size !== outputRanks.length) {
    throw new TypeError("sample.trace accepted output ranks must be unique.");
  }
  if (outputRanks.some((rank, index) => rank !== index + 1)) {
    throw new TypeError("sample.trace accepted output ranks must be contiguous.");
  }
  if (new Set(accepted.map(({ documentId }) => documentId)).size !== accepted.length) {
    throw new TypeError("sample.trace accepted output documents must be unique.");
  }
  return Object.freeze({
    laneOutcomes: Object.freeze(laneOutcomes),
    candidateDecisions: Object.freeze(candidateDecisions),
  });
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function copyLaneNativeJson(
  value: unknown,
  label: string,
  depth = 0,
  ancestors = new WeakSet<object>(),
): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} numbers must be finite.`);
    return value;
  }
  if (typeof value === "string") {
    if (
      value.includes("\0")
      || hasUnpairedSurrogate(value)
      || value.normalize("NFC") !== value
      || Buffer.byteLength(value, "utf8") > MAX_EVALUATION_V2_RAW_EVIDENCE_STRING_BYTES
    ) throw new TypeError(`${label} strings must be bounded NFC JSON text.`);
    return value;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`${label} must contain only JSON values.`);
  }
  if (depth >= MAX_EVALUATION_V2_RAW_EVIDENCE_DEPTH) {
    throw new TypeError(`${label} exceeds the lane-native evidence depth bound.`);
  }
  if (ancestors.has(value)) throw new TypeError(`${label} must not contain cycles.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_EVALUATION_V2_RAW_EVIDENCE_ARRAY_ITEMS) {
        throw new TypeError(`${label} exceeds the lane-native evidence array bound.`);
      }
      return Object.freeze(value.map((entry, index) =>
        copyLaneNativeJson(entry, `${label}[${index}]`, depth + 1, ancestors)));
    }
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must contain only plain JSON objects.`);
    }
    const input = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(input);
    const ownKeys = Reflect.ownKeys(input);
    if (
      ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== "string")
      || keys.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        return descriptor === undefined
          || descriptor.enumerable !== true
          || !("value" in descriptor);
      })
    ) throw new TypeError(`${label} must contain only enumerable JSON data properties.`);
    if (keys.length > MAX_EVALUATION_V2_RAW_EVIDENCE_OBJECT_FIELDS) {
      throw new TypeError(`${label} exceeds the lane-native evidence object-field bound.`);
    }
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys.toSorted()) {
      if (
        key.includes("\0")
        || hasUnpairedSurrogate(key)
        || key.normalize("NFC") !== key
        || Buffer.byteLength(key, "utf8") > 4_096
      ) throw new TypeError(`${label} has an invalid JSON field name.`);
      output[key] = copyLaneNativeJson(input[key], `${label}.${key}`, depth + 1, ancestors);
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}

function parseLaneNativeEvidence(
  value: unknown,
  trace: EvaluationRetrieverTraceV2,
): readonly EvaluationLaneNativeEvidenceV2[] {
  if (!Array.isArray(value) || value.length > MAX_EVALUATION_V2_RAW_EVIDENCE_PER_SAMPLE) {
    throw new TypeError(
      `sample.rawEvidence must contain at most ${MAX_EVALUATION_V2_RAW_EVIDENCE_PER_SAMPLE} rows.`,
    );
  }
  const expected = trace.laneOutcomes.flatMap(({ laneId, rawRanking }) =>
    rawRanking.map(({ documentId, rank }) => ({ laneId, documentId, rank })));
  if (value.length !== expected.length) {
    throw new TypeError("sample.rawEvidence must contain exactly one row for every raw-ranking row.");
  }
  const parsed = value.map((entry, index): EvaluationLaneNativeEvidenceV2 => {
    const label = `sample.rawEvidence[${index}]`;
    const input = record(entry, label);
    strictKeys(input, ["documentId", "evidence", "laneId", "rank"], label);
    const expectedRow = expected[index];
    if (expectedRow === undefined) throw new Error("Lost expected lane-native evidence row.");
    if (
      input.laneId !== expectedRow.laneId
      || input.documentId !== expectedRow.documentId
      || input.rank !== expectedRow.rank
    ) {
      throw new TypeError(
        `${label} must join the same canonical lane, document, and rank as its raw-ranking row.`,
      );
    }
    const hasEvidence = Object.hasOwn(input, "evidence");
    const evidence = hasEvidence
      ? copyLaneNativeJson(input.evidence, `${label}.evidence`)
      : undefined;
    return Object.freeze({
      laneId: expectedRow.laneId,
      documentId: expectedRow.documentId,
      rank: expectedRow.rank,
      ...(hasEvidence ? { evidence } : {}),
    });
  });
  boundedJsonByteSize(
    parsed,
    MAX_EVALUATION_V2_RAW_EVIDENCE_BYTES_PER_SAMPLE,
    "sample.rawEvidence",
  );
  return Object.freeze(parsed);
}

function parseResources(
  value: unknown,
  contextCeilings: EvaluationExperimentV2["protocol"]["contextCeilings"],
): EvaluationResourceAccountingV2 {
  const input = record(value, "sample.resources");
  strictKeys(input, ["cacheBytes", "embedding", "llm", "packedContext", "peakRssBytes"], "sample.resources");
  const llm = record(input.llm, "sample.resources.llm");
  strictKeys(llm, ["calls", "inputTokens", "outputTokens"], "sample.resources.llm");
  if (llm.calls !== 0 || llm.inputTokens !== 0 || llm.outputTokens !== 0) {
    throw new TypeError("evaluation memory operations require literal zero LLM calls and input/output tokens.");
  }
  const embedding = record(input.embedding, "sample.resources.embedding");
  strictKeys(
    embedding,
    ["calls", "durationMs", "durationScope", "inputTokens", "inputTokensMeasured"],
    "sample.resources.embedding",
  );
  const embeddingCalls = safeInteger(
    embedding.calls,
    "sample.resources.embedding.calls",
    0,
    1_000_000_000,
  );
  const embeddingInputTokens = safeInteger(
    embedding.inputTokens,
    "sample.resources.embedding.inputTokens",
    0,
    1_000_000_000,
  );
  const embeddingDurationMs = nonnegativeNumber(
    embedding.durationMs,
    "sample.resources.embedding.durationMs",
  );
  const inputTokensMeasured = embedding.inputTokensMeasured;
  if (Object.hasOwn(embedding, "inputTokensMeasured") && inputTokensMeasured !== false) {
    throw new TypeError("sample.resources.embedding.inputTokensMeasured must be literal false when present.");
  }
  const durationScopeValue = embedding.durationScope;
  if (
    Object.hasOwn(embedding, "durationScope")
    && durationScopeValue !== "embedding-backed-search-upper-bound"
  ) {
    throw new TypeError(
      "sample.resources.embedding.durationScope must be embedding-backed-search-upper-bound when present.",
    );
  }
  const durationScope: EvaluationResourceAccountingV2["embedding"]["durationScope"] =
    durationScopeValue === "embedding-backed-search-upper-bound"
      ? durationScopeValue
      : undefined;
  if (embeddingCalls === 0) {
    if (
      embeddingInputTokens !== 0
      || embeddingDurationMs !== 0
      || inputTokensMeasured !== undefined
      || durationScope !== undefined
    ) {
      throw new TypeError("zero-call embedding accounting must be the exact unannotated zero record.");
    }
  } else if (inputTokensMeasured === false && embeddingInputTokens !== 0) {
    throw new TypeError("unmeasured embedding input tokens must use zero only as an explicit placeholder.");
  }
  const packedContext = record(input.packedContext, "sample.resources.packedContext");
  strictKeys(packedContext, ["readerTokens", "utf8Bytes"], "sample.resources.packedContext");
  const utf8Bytes = safeInteger(
    packedContext.utf8Bytes,
    "sample.resources.packedContext.utf8Bytes",
    0,
    1_000_000_000,
  );
  const readerTokens = safeInteger(
    packedContext.readerTokens,
    "sample.resources.packedContext.readerTokens",
    0,
    1_000_000_000,
  );
  if (utf8Bytes > contextCeilings.utf8Bytes || readerTokens > contextCeilings.readerTokens) {
    throw new TypeError("sample packed context exceeds the digest-covered byte or token ceiling.");
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: embeddingCalls,
      inputTokens: embeddingInputTokens,
      ...(inputTokensMeasured === false ? { inputTokensMeasured } : {}),
      durationMs: embeddingDurationMs,
      ...(durationScope === undefined ? {} : { durationScope }),
    }),
    packedContext: Object.freeze({
      utf8Bytes,
      readerTokens,
    }),
    peakRssBytes: safeInteger(input.peakRssBytes, "sample.resources.peakRssBytes", 0, Number.MAX_SAFE_INTEGER),
    cacheBytes: safeInteger(input.cacheBytes, "sample.resources.cacheBytes", 0, Number.MAX_SAFE_INTEGER),
  });
}

function acceptedEvidenceOrder(trace: EvaluationRetrieverTraceV2): readonly string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const accepted = trace.candidateDecisions
    .filter(({ disposition }) => disposition === "accepted")
    .toSorted((left, right) => (left.outputRank ?? Number.MAX_SAFE_INTEGER)
      - (right.outputRank ?? Number.MAX_SAFE_INTEGER));
  for (const decision of accepted) {
    for (const evidenceUnitId of decision.evidenceUnitIds) {
      if (!seen.has(evidenceUnitId)) ordered.push(evidenceUnitId);
      seen.add(evidenceUnitId);
    }
  }
  return Object.freeze(ordered);
}

function parsePackedContextTrace(
  value: unknown,
  profile: EvaluationMeasurementProfileV2,
  status: EvaluationRepeatedSampleV2["status"],
  trace: EvaluationRetrieverTraceV2,
  accounting: EvaluationResourceAccountingV2["packedContext"],
): EvaluationRepeatedSampleV2["packedContextTrace"] {
  const packingSample = profile.operation === "packing";
  if (!packingSample || status === "failed") {
    if (value !== undefined) {
      const sampleKind = packingSample ? "failed packing" : "non-packing";
      throw new TypeError(
        `sample.packedContextTrace is forbidden for ${sampleKind} samples.`,
      );
    }
    return undefined;
  }
  if (value === undefined) {
    throw new TypeError("sample.packedContextTrace is required for every nonfailed packing sample.");
  }
  const input = record(value, "sample.packedContextTrace");
  strictKeys(input, ["evidenceUnitIds", "packedBytesSha256", "truncated"], "sample.packedContextTrace");
  if (typeof input.truncated !== "boolean") {
    throw new TypeError("sample.packedContextTrace.truncated must be boolean.");
  }
  if (
    !Array.isArray(input.evidenceUnitIds)
    || input.evidenceUnitIds.length > MAX_EVALUATION_V2_PACKED_CONTEXT_EVIDENCE_UNITS
  ) {
    throw new TypeError(
      `sample.packedContextTrace.evidenceUnitIds must contain at most ${MAX_EVALUATION_V2_PACKED_CONTEXT_EVIDENCE_UNITS} entries.`,
    );
  }
  const evidenceUnitIds = input.evidenceUnitIds.map((entry, index) =>
    evidenceUnitId(entry, `sample.packedContextTrace.evidenceUnitIds[${index}]`));
  if (new Set(evidenceUnitIds).size !== evidenceUnitIds.length) {
    throw new TypeError("sample.packedContextTrace.evidenceUnitIds must not contain duplicates.");
  }
  const packedBytesSha256 = requireSha256(
    input.packedBytesSha256,
    "sample.packedContextTrace.packedBytesSha256",
  );
  const acceptedOrder = acceptedEvidenceOrder(trace);
  let acceptedCursor = 0;
  for (const packedId of evidenceUnitIds) {
    const acceptedIndex = acceptedOrder.indexOf(packedId, acceptedCursor);
    if (acceptedIndex < 0) {
      if (acceptedOrder.includes(packedId)) {
        throw new TypeError(
          "sample.packedContextTrace.evidenceUnitIds must preserve accepted output and evidence order.",
        );
      }
      throw new TypeError(
        `sample.packedContextTrace evidence unit ${packedId} is not registry-bound to an accepted trace decision.`,
      );
    }
    acceptedCursor = acceptedIndex + 1;
  }
  if (!input.truncated) {
    if (
      evidenceUnitIds.length !== acceptedOrder.length
      || evidenceUnitIds.some((id, index) => id !== acceptedOrder[index])
    ) {
      throw new TypeError(
        "A nontruncated sample.packedContextTrace must include every accepted evidence unit in order.",
      );
    }
  } else if (evidenceUnitIds.length >= acceptedOrder.length) {
    throw new TypeError(
      "A truncated sample.packedContextTrace must omit at least one accepted evidence unit.",
    );
  }
  if ((accounting.utf8Bytes === 0) !== (evidenceUnitIds.length === 0)) {
    throw new TypeError(
      "sample.packedContextTrace evidence count contradicts packed-context UTF-8 byte accounting.",
    );
  }
  if (accounting.utf8Bytes === 0 && accounting.readerTokens !== 0) {
    throw new TypeError(
      "Empty packed-context byte accounting cannot report nonzero reader tokens.",
    );
  }
  if (evidenceUnitIds.length > accounting.utf8Bytes) {
    throw new TypeError(
      "sample.packedContextTrace evidence count exceeds its packed-context UTF-8 byte count.",
    );
  }
  if (
    (accounting.utf8Bytes === 0 && packedBytesSha256 !== EMPTY_PACKED_CONTEXT_SHA256)
    || (accounting.utf8Bytes > 0 && packedBytesSha256 === EMPTY_PACKED_CONTEXT_SHA256)
  ) {
    throw new TypeError(
      "sample.packedContextTrace packed-bytes SHA-256 contradicts packed-context byte accounting.",
    );
  }
  return Object.freeze({
    evidenceUnitIds: Object.freeze(evidenceUnitIds),
    truncated: input.truncated,
    packedBytesSha256,
  });
}

function parseSample(
  value: unknown,
  index: number,
  split: EvaluationSplitV2 | "all",
  descriptorById: ReadonlyMap<string, EvaluationRetrieverDescriptorV2>,
  profileById: ReadonlyMap<string, EvaluationMeasurementProfileV2>,
  queryById: ReadonlyMap<string, EvaluationQueryV2>,
  evidenceById: ReadonlyMap<string, EvaluationEvidenceUnitV2>,
  documentById: ReadonlyMap<string, EvaluationDocumentV2>,
  familyById: ReadonlyMap<string, EvaluationSourceFamilyV2>,
  experiment: EvaluationExperimentV2,
): EvaluationRepeatedSampleV2 {
  const label = `samples[${index}]`;
  const input = record(value, label);
  strictKeys(input, [
    "concurrencyBatchIdentity", "failure", "packedContextTrace", "profileId", "queryId", "repetition",
    "rawEvidence", "resources", "retrieverId", "status", "timings", "trace",
  ], label);
  const retrieverId = canonicalId(input.retrieverId, `${label}.retrieverId`);
  const profileId = canonicalId(input.profileId, `${label}.profileId`);
  const descriptor = descriptorById.get(retrieverId);
  const profile = profileById.get(profileId);
  if (descriptor === undefined) throw new TypeError(`${label} names unknown retriever ${retrieverId}.`);
  if (profile === undefined) throw new TypeError(`${label} names unknown profile ${profileId}.`);
  const queryId = input.queryId === undefined ? undefined : boundedString(input.queryId, `${label}.queryId`, 256);
  if ((profile.scope === "query") !== (queryId !== undefined)) {
    throw new TypeError(`${label}.queryId presence must match the measurement profile scope.`);
  }
  if (queryId !== undefined) {
    const query = queryById.get(queryId);
    if (query === undefined) throw new TypeError(`${label} names unknown query ${queryId}.`);
    if (split !== "all" && query.split !== split) throw new TypeError(`${label} query is outside the report split.`);
  }
  const repetition = safeInteger(input.repetition, `${label}.repetition`, 1, profile.repetitions);
  const concurrencyBatchIdentity = input.concurrencyBatchIdentity === undefined
    ? undefined
    : bridgeString(input.concurrencyBatchIdentity, `${label}.concurrencyBatchIdentity`, 512);
  if (profile.operation === "four-reader-query") {
    if (concurrencyBatchIdentity !== experiment.environment.fourReaderBatch.id) {
      throw new TypeError(
        `${label}.concurrencyBatchIdentity must match the digest-covered four-reader batch identity.`,
      );
    }
  } else if (concurrencyBatchIdentity !== undefined) {
    throw new TypeError(`${label}.concurrencyBatchIdentity is reserved for four-reader samples.`);
  }
  if (input.status !== "degraded" && input.status !== "failed" && input.status !== "ready" && input.status !== "unavailable") {
    throw new TypeError(`${label}.status is invalid.`);
  }
  const timingsInput = record(input.timings, `${label}.timings`);
  strictKeys(timingsInput, ["elapsedMs", "indexMs", "packingMs", "queryMs", "updateMs"], `${label}.timings`);
  const timings = Object.freeze({
    elapsedMs: nonnegativeNumber(timingsInput.elapsedMs, `${label}.timings.elapsedMs`),
    indexMs: nonnegativeNumber(timingsInput.indexMs, `${label}.timings.indexMs`),
    updateMs: nonnegativeNumber(timingsInput.updateMs, `${label}.timings.updateMs`),
    queryMs: nonnegativeNumber(timingsInput.queryMs, `${label}.timings.queryMs`),
    packingMs: nonnegativeNumber(timingsInput.packingMs, `${label}.timings.packingMs`),
  });
  let failure: EvaluationRepeatedSampleV2["failure"];
  if (input.failure !== undefined) {
    const failureInput = record(input.failure, `${label}.failure`);
    strictKeys(failureInput, ["kind", "message"], `${label}.failure`);
    if (failureInput.kind !== "exception" && failureInput.kind !== "invalid-result" && failureInput.kind !== "timeout") {
      throw new TypeError(`${label}.failure.kind is invalid.`);
    }
    failure = Object.freeze({
      kind: failureInput.kind,
      message: boundedString(failureInput.message, `${label}.failure.message`, 2_000),
    });
  }
  if ((input.status === "failed") !== (failure !== undefined)) {
    throw new TypeError(`${label} failed status and failure details must occur together.`);
  }
  const trace = parseTrace(input.trace, descriptor, evidenceById, documentById, familyById);
  const rawEvidence = parseLaneNativeEvidence(input.rawEvidence, trace);
  if (input.status === "failed") {
    if (
      trace.candidateDecisions.length > 0
      || trace.laneOutcomes.some(({ rawRanking }) => rawRanking.length > 0)
    ) {
      throw new TypeError(`${label} failed samples cannot retain rankings or candidate decisions.`);
    }
  } else {
    const applied = trace.laneOutcomes.filter(({ applicability }) => applicability === "applied");
    const laneStatus: Exclude<EvaluationRepeatedSampleV2["status"], "failed"> = applied.length === 0
      || applied.every(({ status }) => status === "unavailable")
      ? "unavailable"
      : applied.some(({ status }) => status !== "ready")
        ? "degraded"
        : "ready";
    if (input.status !== laneStatus) {
      throw new TypeError(`${label} status must reconcile with its locked lane outcomes.`);
    }
  }
  const resources = parseResources(input.resources, experiment.protocol.contextCeilings);
  const packedContextTrace = parsePackedContextTrace(
    input.packedContextTrace,
    profile,
    input.status,
    trace,
    resources.packedContext,
  );
  return Object.freeze({
    retrieverId,
    profileId,
    ...(queryId === undefined ? {} : { queryId }),
    repetition,
    ...(concurrencyBatchIdentity === undefined ? {} : { concurrencyBatchIdentity }),
    status: input.status,
    timings,
    resources,
    trace,
    rawEvidence,
    ...(packedContextTrace === undefined ? {} : { packedContextTrace }),
    ...(failure === undefined ? {} : { failure }),
  });
}

function sampleKey(sample: Pick<EvaluationRepeatedSampleV2, "profileId" | "queryId" | "repetition" | "retrieverId">): string {
  return `${sample.retrieverId}\0${sample.profileId}\0${sample.queryId ?? ""}\0${sample.repetition}`;
}

function compareSamples(left: EvaluationRepeatedSampleV2, right: EvaluationRepeatedSampleV2): number {
  return left.retrieverId.localeCompare(right.retrieverId)
    || left.profileId.localeCompare(right.profileId)
    || (left.queryId ?? "").localeCompare(right.queryId ?? "")
    || left.repetition - right.repetition;
}

function boundedJsonByteSize(value: unknown, maximum: number, label: string): number {
  const stack: unknown[] = [value];
  let bytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      bytes += Buffer.byteLength(JSON.stringify(current), "utf8");
    } else if (typeof current === "number") {
      bytes += Number.isFinite(current) ? Buffer.byteLength(JSON.stringify(current), "utf8") : 8;
    } else if (typeof current === "boolean" || current === null || current === undefined) {
      bytes += current === true ? 4 : 5;
    } else if (Array.isArray(current)) {
      bytes += Math.max(0, current.length - 1) + 2;
      if (bytes > maximum) throw new TypeError(`${label} exceeds its aggregate UTF-8 byte bound.`);
      for (const entry of current) stack.push(entry);
    } else if (typeof current === "object") {
      const entries = Object.entries(current as Readonly<Record<string, unknown>>);
      bytes += Math.max(0, entries.length - 1) + 2;
      if (bytes > maximum) throw new TypeError(`${label} exceeds its aggregate UTF-8 byte bound.`);
      for (const [key, entry] of entries) {
        bytes += Buffer.byteLength(JSON.stringify(key), "utf8") + 1;
        if (bytes > maximum) throw new TypeError(`${label} exceeds its aggregate UTF-8 byte bound.`);
        stack.push(entry);
      }
    } else {
      bytes += 16;
    }
    if (bytes > maximum) throw new TypeError(`${label} exceeds its aggregate UTF-8 byte bound.`);
  }
  return bytes;
}

function preflightReportTraceBounds(samples: readonly unknown[]): void {
  let traceItems = 0;
  let provenanceItems = 0;
  let rawEvidenceItems = 0;
  let packedContextItems = 0;
  let traceBytes = 0;
  let provenanceBytes = 0;
  let rawEvidenceBytes = 0;
  let packedContextBytes = 0;
  for (const [sampleIndex, sampleValue] of samples.entries()) {
    const sample = record(sampleValue, `samples[${sampleIndex}]`);
    const trace = record(sample.trace, `samples[${sampleIndex}].trace`);
    const laneOutcomes = Array.isArray(trace.laneOutcomes) ? trace.laneOutcomes : [];
    const decisions = Array.isArray(trace.candidateDecisions) ? trace.candidateDecisions : [];
    traceItems += laneOutcomes.length + decisions.length;
    if (traceItems > MAX_EVALUATION_V2_REPORT_TRACE_ITEMS) {
      throw new TypeError("evaluation report exceeds the aggregate trace item bound.");
    }
    const provenanceCollections: unknown[] = [];
    for (const laneValue of laneOutcomes) {
      const lane = record(laneValue, `samples[${sampleIndex}].trace lane`);
      const rawRanking = Array.isArray(lane.rawRanking) ? lane.rawRanking : [];
      traceItems += rawRanking.length;
      if (traceItems > MAX_EVALUATION_V2_REPORT_TRACE_ITEMS) {
        throw new TypeError("evaluation report exceeds the aggregate trace item bound.");
      }
      for (const rankedValue of rawRanking) {
        const ranked = record(rankedValue, `samples[${sampleIndex}].trace raw ranking`);
        if (ranked.provenance !== undefined) provenanceCollections.push(ranked.provenance);
      }
    }
    for (const decisionValue of decisions) {
      const decision = record(decisionValue, `samples[${sampleIndex}].trace decision`);
      if (decision.provenance !== undefined) provenanceCollections.push(decision.provenance);
    }
    traceBytes += boundedJsonByteSize(
      trace,
      MAX_EVALUATION_V2_REPORT_TRACE_BYTES - traceBytes,
      "evaluation report trace",
    );
    for (const provenanceValue of provenanceCollections) {
      if (Array.isArray(provenanceValue)) provenanceItems += provenanceValue.length;
      if (provenanceItems > MAX_EVALUATION_V2_REPORT_PROVENANCE_ITEMS) {
        throw new TypeError("evaluation report exceeds the aggregate provenance item bound.");
      }
      provenanceBytes += boundedJsonByteSize(
        provenanceValue,
        MAX_EVALUATION_V2_REPORT_PROVENANCE_BYTES - provenanceBytes,
        "evaluation report provenance",
      );
    }
    const rawEvidence = Array.isArray(sample.rawEvidence) ? sample.rawEvidence : [];
    rawEvidenceItems += rawEvidence.length;
    if (rawEvidenceItems > MAX_EVALUATION_V2_REPORT_RAW_EVIDENCE_ITEMS) {
      throw new TypeError("evaluation report exceeds the aggregate lane-native evidence item bound.");
    }
    rawEvidenceBytes += boundedJsonByteSize(
      rawEvidence,
      MAX_EVALUATION_V2_REPORT_RAW_EVIDENCE_BYTES - rawEvidenceBytes,
      "evaluation report lane-native evidence",
    );
    if (sample.packedContextTrace !== undefined) {
      const packedContextTrace = record(
        sample.packedContextTrace,
        `samples[${sampleIndex}].packedContextTrace`,
      );
      if (Array.isArray(packedContextTrace.evidenceUnitIds)) {
        packedContextItems += packedContextTrace.evidenceUnitIds.length;
      }
      if (packedContextItems > MAX_EVALUATION_V2_REPORT_PACKED_CONTEXT_ITEMS) {
        throw new TypeError("evaluation report exceeds the aggregate packed-context evidence item bound.");
      }
      packedContextBytes += boundedJsonByteSize(
        packedContextTrace,
        MAX_EVALUATION_V2_REPORT_PACKED_CONTEXT_BYTES - packedContextBytes,
        "evaluation report packed-context trace",
      );
    }
  }
}

function expectedSampleCardinality(
  corpus: RetrievalEvaluationCorpusV2,
  queryCount: number,
): number {
  let perRetriever = 0;
  for (const profile of corpus.measurementProfiles) {
    const targets = profile.scope === "query" ? queryCount : 1;
    const profileCount = targets * profile.repetitions;
    if (!Number.isSafeInteger(profileCount) || profileCount > MAX_EVALUATION_V2_SAMPLES) {
      throw new TypeError("evaluation report expected sample matrix exceeds the supported cardinality.");
    }
    perRetriever += profileCount;
    if (!Number.isSafeInteger(perRetriever) || perRetriever > MAX_EVALUATION_V2_SAMPLES) {
      throw new TypeError("evaluation report expected sample matrix exceeds the supported cardinality.");
    }
  }
  const total = perRetriever * corpus.retrievers.length;
  if (!Number.isSafeInteger(total) || total > MAX_EVALUATION_V2_SAMPLES) {
    throw new TypeError("evaluation report expected sample matrix exceeds the supported cardinality.");
  }
  return total;
}

export function parseRetrievalEvaluationReportV2(
  inputValue: unknown,
  corpus: RetrievalEvaluationCorpusV2,
): RetrievalEvaluationReportV2 {
  const input = record(inputValue, "evaluation v2 report");
  strictKeys(input, ["candidateLockSha256", "samples", "schemaVersion", "split", "suiteSha256"], "evaluation v2 report");
  if (input.schemaVersion !== 2) throw new TypeError("evaluation v2 report schemaVersion must be 2.");
  const suiteSha256 = requireSha256(input.suiteSha256, "report.suiteSha256");
  const candidateLockSha256 = requireSha256(input.candidateLockSha256, "report.candidateLockSha256");
  if (suiteSha256 !== corpus.manifest.corpusSha256 || candidateLockSha256 !== corpus.manifest.candidateLockSha256) {
    throw new TypeError("evaluation report commitments do not match the sealed corpus and candidate lock.");
  }
  if (input.split !== "all" && input.split !== "development" && input.split !== "test") {
    throw new TypeError("evaluation report split is invalid.");
  }
  const split: EvaluationSplitV2 | "all" = input.split;
  if (!Array.isArray(input.samples) || input.samples.length < 1 || input.samples.length > MAX_EVALUATION_V2_SAMPLES) {
    throw new TypeError("evaluation report samples must be a non-empty bounded array.");
  }
  const queries = corpus.queries.filter((query) => split === "all" || query.split === split);
  const expectedCount = expectedSampleCardinality(corpus, queries.length);
  if (input.samples.length !== expectedCount) {
    throw new TypeError("evaluation report sample matrix is incomplete or contains an unexpected sample.");
  }
  preflightReportTraceBounds(input.samples);
  const descriptorById = new Map(corpus.retrievers.map((descriptor) => [descriptor.id, descriptor]));
  const profileById = new Map(corpus.measurementProfiles.map((profile) => [profile.id, profile]));
  const queryById = new Map(corpus.queries.map((query) => [query.id, query]));
  const evidenceById = new Map(corpus.evidenceUnits.map((unit) => [unit.id, unit]));
  const documentById = new Map(corpus.documents.map((document) => [document.id, document]));
  const familyById = new Map(corpus.sourceFamilies.map((family) => [family.id, family]));
  const samples = input.samples.map((sample, index) => parseSample(
    sample,
    index,
    split,
    descriptorById,
    profileById,
    queryById,
    evidenceById,
    documentById,
    familyById,
    corpus.experiment,
  ));
  if (new Set(samples.map(sampleKey)).size !== samples.length) {
    throw new TypeError("evaluation report repeats a retriever/profile/query/repetition sample.");
  }
  const sorted = samples.toSorted(compareSamples);
  if (samples.some((sample, index) => sampleKey(sample) !== sampleKey(sorted[index] as EvaluationRepeatedSampleV2))) {
    throw new TypeError("evaluation report samples must be in canonical order.");
  }
  return Object.freeze({
    schemaVersion: 2,
    suiteSha256,
    candidateLockSha256,
    split,
    samples: Object.freeze(samples),
  });
}
