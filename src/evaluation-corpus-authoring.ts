import { createHash } from "node:crypto";

import {
  EVALUATION_EVIDENCE_PARSER_VERSION,
  buildEvaluationEvidenceRegistry,
  type EvaluationEvidenceByteRange,
  type EvaluationEvidenceUnit,
  type EvaluationEvidenceLineRange,
  type EvaluationEvidenceRegistry,
  type EvaluationEvidenceUnitKind,
} from "./evaluation-evidence.js";
import {
  EVALUATION_SOURCE_TRUST_COMPATIBILITY_V2,
  PROMOTION_ACCEPTANCE_STRATUM_COHORT_MINIMA_V2,
  PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2,
  PROMOTION_COHORT_COUNT_V2,
  PROMOTION_CRITICAL_INPUT_MINIMA_V2,
  PROMOTION_CRITICAL_STRATUM_MINIMA_V2,
  PROMOTION_DEVELOPMENT_QUERY_COUNT_V2,
  PROMOTION_DUAL_ASSESSMENT_MINIMUM_V2,
  PROMOTION_EVALUATION_QUERY_COUNT_V2,
  PROMOTION_TEST_COHORT_COUNT_V2,
  PROMOTION_TEST_INSUFFICIENT_COUNT_V2,
  PROMOTION_TEST_QUERY_COUNT_V2,
  PROMOTION_TEST_SUPPORTED_COUNT_V2,
  PROMOTION_STRATUM_COHORT_DUAL_FRACTION_V2,
  PROMOTION_STRATUM_COHORT_DUAL_MINIMUM_V2,
  RETRIEVAL_EVALUATION_V2_PROTOCOL,
  RETRIEVAL_EVALUATION_V2_SCHEMA_VERSION,
  evaluationCandidateLockDigestV2,
  evaluationCorpusDigestV2,
  evaluationRetrieverDescriptorDigestV2,
  evaluationSourceFamilyClusterIdsV2,
  parseRetrievalEvaluationCorpusV2,
  validatePromotionCorpusV2,
  type EvaluationAdjudicationV2,
  type EvaluationAssessorV2,
  type EvaluationCohortV2,
  type EvaluationDocumentJudgmentV2,
  type EvaluationDocumentV2,
  type EvaluationEvidenceUnitJudgmentV2,
  type EvaluationEvidenceUnitV2,
  type EvaluationExpectedSupportV2,
  type EvaluationExperimentV2,
  type EvaluationExternalCorpusSealV2,
  type EvaluationInputOriginDeclarationV2,
  type EvaluationLaneIdV2,
  type EvaluationMeasurementProfileV2,
  type EvaluationNegativeSubtypeV2,
  type EvaluationQueryV2,
  type EvaluationRawAssessorJudgmentV2,
  type EvaluationRetrievalInputsV2,
  type EvaluationRetrieverDescriptorV2,
  type EvaluationSourceClassV2,
  type EvaluationSourceFamilyV2,
  type EvaluationSplitV2,
  type EvaluationStratumV2,
  type EvaluationTrustClassV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

const ZERO_SHA256 = "0".repeat(64);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const DEFAULT_NGRAM_SIZE = 3;
const DEFAULT_CROSS_SPLIT_NGRAM_THRESHOLD = 0.8;
const DEFAULT_LABEL_PREDICTABILITY_CEILING = 0.65;
const LABEL_PREDICTABILITY_CLASSIFIER = "leave-one-out-token-jaccard-1nn-v1";
const MIN_SOURCE_FAMILY_RATIONALE_BYTES = 24;
const MAX_SOURCE_FAMILY_RATIONALE_BYTES = 2_048;
const MAX_SOURCE_FAMILY_REVIEWERS = 32;
const MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES = 256;

export type PromotionCorpusMarkdownDocumentV2 = {
  readonly documentId?: string;
  readonly sourcePath: string;
  readonly markdown: string;
  /** Human-readable authoring key. The compiler replaces it with an opaque family ID. */
  readonly sourceFamilyKey: string;
  readonly sourceClass: EvaluationSourceClassV2;
  readonly trustClass: EvaluationTrustClassV2;
  /** Private review rationale. Only its digest is retained in the sealed corpus. */
  readonly sourceFamilyRationale?: string;
  /** Private reviewer identities. Only their digest commitment is retained. */
  readonly sourceFamilyReviewerIds?: readonly string[];
};

export type AuthoredEvidenceSelectorV2 = {
  readonly sourcePath: string;
  /** Required with exactText; optional when an exact line range is supplied. */
  readonly kind?: EvaluationEvidenceUnitKind;
  /** Exact full ancestry. An empty array intentionally selects root-level evidence. */
  readonly headingPath?: readonly string[];
  /** Convenience guard for the final heading in headingPath. */
  readonly heading?: string;
  /** Exact registry unit text, including authored newline bytes. */
  readonly exactText?: string;
  /** Exact inclusive source line range. */
  readonly lineRange?: EvaluationEvidenceLineRange;
  /** Optional review-time drift guards copied from a prior registry. */
  readonly expectedUnitId?: string;
  readonly expectedUnitSha256?: string;
  readonly expectedSourceSha256?: string;
  readonly expectedByteRange?: EvaluationEvidenceByteRange;
};

export type AuthoredDocumentJudgmentV2 = {
  readonly sourcePath: string;
  readonly relevance: 0 | 1 | 2 | 3;
};

export type AuthoredEvidenceUnitJudgmentV2 = {
  readonly selector: AuthoredEvidenceSelectorV2;
  readonly relevance: 0 | 1 | 2 | 3;
};

export type AuthoredAcceptableSupportSetV2 = {
  readonly key: string;
  readonly evidence: readonly AuthoredEvidenceSelectorV2[];
};

export type AuthoredAtomicNuggetV2 = {
  readonly key: string;
  readonly text: string;
  readonly required: boolean;
  readonly acceptableSupportSets: readonly AuthoredAcceptableSupportSetV2[];
};

export type AuthoredGoldJudgmentV2 = {
  readonly documents: readonly AuthoredDocumentJudgmentV2[];
  readonly evidenceUnits: readonly AuthoredEvidenceUnitJudgmentV2[];
  readonly nuggets: readonly AuthoredAtomicNuggetV2[];
};

export type AuthoredRawAssessorJudgmentV2 = {
  readonly assessorId: string;
  readonly expectedSupport: EvaluationExpectedSupportV2;
  readonly documents: readonly AuthoredDocumentJudgmentV2[];
  readonly evidenceUnits: readonly AuthoredEvidenceUnitJudgmentV2[];
  readonly nuggets: readonly {
    readonly nuggetKey: string;
    readonly required?: boolean;
    readonly acceptableSupportSetKeys: readonly string[];
  }[];
};

export type HumanAuthoredEvaluationQuestionV2 = {
  /** Human-readable authoring key. The compiler replaces it with an opaque query ID. */
  readonly key: string;
  /** Preserved verbatim. The compiler never generates or rewrites question prose. */
  readonly text: string;
  readonly split: EvaluationSplitV2;
  readonly cohort: EvaluationCohortV2;
  readonly strata: readonly EvaluationStratumV2[];
  /** One predeclared acceptance cell; it must also appear in strata. */
  readonly primaryStratum: EvaluationStratumV2;
  readonly expectedSupport: EvaluationExpectedSupportV2;
  readonly primaryLane: EvaluationLaneIdV2;
  readonly negativeSubtype?: EvaluationNegativeSubtypeV2;
  /** Preserved executable inputs. No structured input or routing seed is inferred. */
  readonly inputs: EvaluationRetrievalInputsV2;
  readonly inputOrigins: readonly EvaluationInputOriginDeclarationV2[];
  readonly gold: AuthoredGoldJudgmentV2;
  readonly rawAssessments: readonly AuthoredRawAssessorJudgmentV2[];
  readonly adjudication: EvaluationAdjudicationV2;
};

export type PromotionCorpusReviewPolicyV2 = {
  readonly ngramSize?: number;
  readonly crossSplitNgramThreshold?: number;
  /** Maximum leave-one-out balanced accuracy for labels predicted from prompt text alone. */
  readonly labelPredictabilityCeiling?: number;
  readonly sourceFamilyAssignment?: {
    readonly protocolId: string;
    readonly protocolSha256: string;
    readonly reviewerIds: readonly string[];
  };
};

export type PromotionCorpusAuthoringInputV2 = {
  readonly id: string;
  readonly description: string;
  readonly sealedAt: string;
  /** SHA-256 of the canonical immutable build.json bytes used for this compilation. */
  readonly buildContractSha256: string;
  readonly frozen: RetrievalEvaluationCorpusV2["frozen"];
  readonly assessment: RetrievalEvaluationCorpusV2["assessment"];
  readonly experiment: EvaluationExperimentV2;
  readonly documents: readonly PromotionCorpusMarkdownDocumentV2[];
  readonly questions: readonly HumanAuthoredEvaluationQuestionV2[];
  readonly measurementProfiles: readonly EvaluationMeasurementProfileV2[];
  readonly retrievers: readonly EvaluationRetrieverDescriptorV2[];
  readonly baselineRetrieverId: string;
  readonly evidenceParserVersion?: string;
  readonly reviewPolicy?: PromotionCorpusReviewPolicyV2;
};

export type RetrievalEvaluationCorpusSealInputV2 = Omit<
  RetrievalEvaluationCorpusV2,
  "candidateLock" | "manifest"
> & {
  readonly sealedAt: string;
  readonly baselineRetrieverId: string;
  readonly buildContractSha256: string;
};

export type RetrievalEvaluationCorpusSealResultV2 = {
  readonly corpus: RetrievalEvaluationCorpusV2;
  /** Persist or review this independently before using the corpus for a promotion claim. */
  readonly externalSeal: Extract<EvaluationExternalCorpusSealV2, { readonly expectedCorpusSha256: string }>;
};

export type PromotionCorpusCompilationIssueV2 = {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly queryKeys?: readonly string[];
  readonly sourceFamilyKeys?: readonly string[];
  readonly sourcePaths?: readonly string[];
  readonly overlap?: number;
};

export type PromotionQuotaLedgerEntryV2 = {
  readonly id: string;
  readonly label: string;
  readonly rule: "at-least" | "exact";
  readonly target: number;
  readonly actual: number;
  readonly delta: number;
  readonly met: boolean;
};

export type PromotionPowerGranularityRowV2 = {
  readonly id: string;
  readonly queryCount: number;
  readonly oneOutcomeStep: {
    readonly numerator: 1;
    readonly denominator: number;
    readonly percentagePoints: number;
  };
  readonly fivePercentagePointEventCount: number;
  readonly nearestObservableFivePointDelta: number;
  readonly representsFivePointsExactly: boolean;
};

export type PromotionLabelPredictabilityRowV2 = {
  readonly label: "cohort" | "expected-support" | "split";
  readonly classes: readonly string[];
  readonly balancedAccuracy: number;
  readonly evaluatedQuestions: number;
  readonly ceiling: number;
  readonly met: boolean;
};

export type PromotionPairedPowerDiagnosticsV2 = {
  readonly eligibleCallerSeededSupportedTestPairs: number;
  readonly independentSourceFamilyClusters: number | null;
  readonly requiredPairs: number;
  readonly met: boolean;
};

export type PromotionCorpusDiagnosticsV2 = {
  readonly quotaLedger: readonly PromotionQuotaLedgerEntryV2[];
  readonly promotionLayoutReady: boolean;
  readonly labelPredictability: {
    readonly classifier: typeof LABEL_PREDICTABILITY_CLASSIFIER;
    readonly rows: readonly PromotionLabelPredictabilityRowV2[];
    readonly met: boolean;
  };
  readonly pairedPower: PromotionPairedPowerDiagnosticsV2;
  readonly powerGranularity: {
    readonly status: "descriptive-only";
    readonly note: string;
    readonly rows: readonly PromotionPowerGranularityRowV2[];
  };
};

export type ResolvedAuthoredEvidenceV2 = {
  readonly corpusEvidenceUnitId: string;
  readonly registryUnitId: string;
  readonly parserVersion: string;
  readonly kind: EvaluationEvidenceUnitKind;
  readonly documentId: string;
  readonly sourcePath: string;
  readonly byteRange: EvaluationEvidenceByteRange;
  readonly lineRange: EvaluationEvidenceLineRange;
  readonly headingPath: readonly string[];
  readonly sourcePage?: number;
  readonly unitSha256: string;
  readonly sourceSha256: string;
  readonly trustClass: string;
  readonly exactText: string;
};

type PromotionCorpusCompilationBaseV2 = {
  readonly evidenceRegistry?: EvaluationEvidenceRegistry;
  readonly resolvedEvidence: readonly ResolvedAuthoredEvidenceV2[];
  readonly diagnostics: PromotionCorpusDiagnosticsV2;
  readonly errors: readonly PromotionCorpusCompilationIssueV2[];
  readonly warnings: readonly PromotionCorpusCompilationIssueV2[];
  readonly reviewIssues: readonly PromotionCorpusCompilationIssueV2[];
};

export type PromotionCorpusCompilationResultV2 =
  | PromotionCorpusCompilationBaseV2 & {
      readonly ok: true;
      readonly corpus: RetrievalEvaluationCorpusV2;
      readonly externalSeal: Extract<EvaluationExternalCorpusSealV2, { readonly expectedCorpusSha256: string }>;
    }
  | PromotionCorpusCompilationBaseV2 & {
      readonly ok: false;
      readonly corpus?: never;
    };

type CanonicalSourceDocument = {
  readonly documentId: string;
  readonly sourcePath: string;
  readonly markdown: string;
  readonly sourceFamilyKey: string;
  readonly sourceFamilyId: string;
  readonly sourceClass: EvaluationSourceClassV2;
  readonly trustClass: EvaluationTrustClassV2;
  readonly familyAssignmentSha256?: string;
};

type ResolutionContext = {
  readonly registry: EvaluationEvidenceRegistry;
  readonly registryDocumentsByPath: ReadonlyMap<string, EvaluationEvidenceRegistry["documents"][number]>;
  readonly corpusDocumentsByPath: ReadonlyMap<string, CanonicalSourceDocument>;
  readonly resolvedByRegistryId: Map<string, ResolvedAuthoredEvidenceV2>;
};

class AuthoringFailure extends Error {
  readonly code: string;
  readonly queryKeys: readonly string[] | undefined;
  readonly sourcePaths: readonly string[] | undefined;

  constructor(
    code: string,
    message: string,
    details: {
      readonly queryKeys?: readonly string[];
      readonly sourcePaths?: readonly string[];
    } = {},
  ) {
    super(message);
    this.name = "AuthoringFailure";
    this.code = code;
    this.queryKeys = details.queryKeys;
    this.sourcePaths = details.sourcePaths;
  }
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].toSorted(compareText));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical input contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const input = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(input).toSorted(compareText).map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`;
  }
  throw new TypeError("Canonical input must be JSON-compatible.");
}

function framedDigest(domain: string, fields: readonly string[]): string {
  const digest = createHash("sha256");
  digest.update(`${domain}\0`, "utf8");
  for (const field of fields) {
    const bytes = Buffer.from(field, "utf8");
    digest.update(`${bytes.byteLength}:`, "utf8");
    digest.update(bytes);
    digest.update("\0", "utf8");
  }
  return digest.digest("hex");
}

function opaqueId(prefix: "ng" | "q" | "sf" | "ss", fields: readonly string[]): string {
  return `${prefix}-${framedDigest(`promotion-corpus-${prefix}-v1`, fields).slice(0, 16)}`;
}

function authoredKey(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || value.trim() === ""
    || /[\0\r\n]/u.test(value)
    || value.normalize("NFC") !== value
    || Buffer.byteLength(value, "utf8") > 4_096
  ) throw new AuthoringFailure("invalid-authoring-key", `${label} must be a non-empty NFC single-line string.`);
  return value;
}

type CanonicalSourceFamilyAssignmentReview = Readonly<{
  rationale: string;
  reviewerIds: readonly string[];
}>;

function canonicalReviewerIds(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_SOURCE_FAMILY_REVIEWERS) {
    throw new AuthoringFailure(
      "invalid-source-family-reviewers",
      `${label} must contain from 2 through ${MAX_SOURCE_FAMILY_REVIEWERS} independent reviewer IDs.`,
    );
  }
  const reviewerIds = value.map((reviewerId, index) => {
    const id = authoredKey(reviewerId, `${label}[${index}]`);
    if (Buffer.byteLength(id, "utf8") > MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES) {
      throw new AuthoringFailure(
        "invalid-source-family-reviewers",
        `${label}[${index}] exceeds ${MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES} UTF-8 bytes.`,
      );
    }
    return id;
  });
  const canonical = reviewerIds.toSorted(compareText);
  if (!sameStrings(reviewerIds, canonical)) {
    throw new AuthoringFailure(
      "noncanonical-source-family-reviewers",
      `${label} must be in canonical order.`,
    );
  }
  if (new Set(reviewerIds).size !== reviewerIds.length) {
    throw new AuthoringFailure(
      "duplicate-source-family-reviewers",
      `${label} must contain distinct reviewer IDs.`,
    );
  }
  return Object.freeze(reviewerIds);
}

function canonicalSourceFamilyReview(
  document: PromotionCorpusMarkdownDocumentV2,
  index: number,
  declaredReviewerIds: readonly string[] | undefined,
): CanonicalSourceFamilyAssignmentReview | undefined {
  const hasRationale = document.sourceFamilyRationale !== undefined;
  const hasReviewers = document.sourceFamilyReviewerIds !== undefined;
  if (!hasRationale && !hasReviewers) return undefined;
  if (!hasRationale || !hasReviewers) {
    throw new AuthoringFailure(
      "incomplete-source-family-review",
      `documents[${index}] must declare both sourceFamilyRationale and sourceFamilyReviewerIds.`,
      { sourcePaths: [document.sourcePath] },
    );
  }
  if (declaredReviewerIds === undefined) {
    throw new AuthoringFailure(
      "missing-source-family-review-protocol",
      `documents[${index}] has reviewed family metadata but reviewPolicy.sourceFamilyAssignment is absent.`,
      { sourcePaths: [document.sourcePath] },
    );
  }
  const rationale = document.sourceFamilyRationale;
  if (
    typeof rationale !== "string"
    || rationale.normalize("NFC") !== rationale
    || rationale.trim() !== rationale
    || rationale.includes("\0")
    || Buffer.byteLength(rationale, "utf8") < MIN_SOURCE_FAMILY_RATIONALE_BYTES
    || Buffer.byteLength(rationale, "utf8") > MAX_SOURCE_FAMILY_RATIONALE_BYTES
  ) {
    throw new AuthoringFailure(
      "invalid-source-family-rationale",
      `documents[${index}].sourceFamilyRationale must be trimmed NFC text from ${MIN_SOURCE_FAMILY_RATIONALE_BYTES} through ${MAX_SOURCE_FAMILY_RATIONALE_BYTES} UTF-8 bytes.`,
      { sourcePaths: [document.sourcePath] },
    );
  }
  const reviewerIds = canonicalReviewerIds(
    document.sourceFamilyReviewerIds,
    `documents[${index}].sourceFamilyReviewerIds`,
  );
  const declared = new Set(declaredReviewerIds);
  const undeclared = reviewerIds.filter((reviewerId) => !declared.has(reviewerId));
  if (undeclared.length > 0) {
    throw new AuthoringFailure(
      "undeclared-source-family-reviewers",
      `documents[${index}] names undeclared family reviewers: ${undeclared.join(", ")}.`,
      { sourcePaths: [document.sourcePath] },
    );
  }
  return Object.freeze({ rationale, reviewerIds });
}

function canonicalSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be 64 lowercase hexadecimal characters.`);
  }
  return value;
}

function confinedPath(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || value === ""
    || value.normalize("NFC") !== value
    || /[\0\r\n\\]/u.test(value)
    || value.startsWith("/")
    || value.startsWith("./")
    || /^[a-z]:[\\/]/iu.test(value)
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new AuthoringFailure("invalid-source-path", `${label} must be a canonical confined repository-relative path.`);
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sameRange(
  left: EvaluationEvidenceLineRange | EvaluationEvidenceByteRange,
  right: EvaluationEvidenceLineRange | EvaluationEvidenceByteRange,
): boolean {
  return left.start === right.start && left.end === right.end;
}

function selectorLabel(selector: AuthoredEvidenceSelectorV2): string {
  const position = selector.lineRange === undefined
    ? `${selector.kind ?? "unit"} exact text`
    : `lines ${selector.lineRange.start}-${selector.lineRange.end}`;
  return `${selector.sourcePath} (${position})`;
}

function resolveSelector(
  selector: AuthoredEvidenceSelectorV2,
  context: ResolutionContext,
): ResolvedAuthoredEvidenceV2 {
  const sourcePath = confinedPath(selector.sourcePath, "evidence selector sourcePath");
  const hasLineRange = selector.lineRange !== undefined;
  const hasExactText = selector.exactText !== undefined;
  if (!hasLineRange && !hasExactText) {
    throw new AuthoringFailure(
      "selector-incomplete",
      `Evidence selector ${sourcePath} must supply exactText or an explicit lineRange.`,
      { sourcePaths: [sourcePath] },
    );
  }
  if (!hasLineRange && selector.kind === undefined) {
    throw new AuthoringFailure(
      "selector-incomplete",
      `Exact-text selector ${sourcePath} must name its evidence-unit kind.`,
      { sourcePaths: [sourcePath] },
    );
  }
  if (
    selector.headingPath !== undefined
    && selector.heading !== undefined
    && selector.headingPath.at(-1) !== selector.heading
  ) {
    throw new AuthoringFailure(
      "selector-inconsistent-heading",
      `Evidence selector ${sourcePath} has inconsistent heading and headingPath guards.`,
      { sourcePaths: [sourcePath] },
    );
  }
  const document = context.registryDocumentsByPath.get(sourcePath);
  if (document === undefined) {
    throw new AuthoringFailure(
      "selector-source-missing",
      `Evidence selector names unknown frozen source ${sourcePath}.`,
      { sourcePaths: [sourcePath] },
    );
  }
  if (
    selector.expectedSourceSha256 !== undefined
    && selector.expectedSourceSha256 !== document.sourceSha256
  ) {
    throw new AuthoringFailure(
      "selector-source-drift",
      `Frozen source ${sourcePath} drifted from selector source commitment ${selector.expectedSourceSha256}.`,
      { sourcePaths: [sourcePath] },
    );
  }
  const matches = context.registry.units.filter((unit) => (
    unit.sourcePath === sourcePath
    && (selector.kind === undefined || unit.kind === selector.kind)
    && (selector.headingPath === undefined || sameStrings(unit.headingAncestry, selector.headingPath))
    && (selector.heading === undefined || unit.headingAncestry.at(-1) === selector.heading)
    && (selector.exactText === undefined || unit.text === selector.exactText)
    && (selector.lineRange === undefined || sameRange(unit.lineRange, selector.lineRange))
  ));
  if (matches.length === 0) {
    throw new AuthoringFailure(
      selector.expectedUnitId === undefined ? "selector-zero-or-drifted-match" : "selector-unit-drift",
      `Evidence selector ${selectorLabel(selector)} resolved to zero registry units; the selector is stale or does not match the frozen Markdown exactly.`,
      { sourcePaths: [sourcePath] },
    );
  }
  if (matches.length > 1) {
    throw new AuthoringFailure(
      "selector-ambiguous",
      `Evidence selector ${selectorLabel(selector)} resolved to ${matches.length} registry units. Add an exact heading, kind, text, or range guard.`,
      { sourcePaths: [sourcePath] },
    );
  }
  const unit = matches[0];
  if (unit === undefined) throw new Error("Unique evidence selector resolution was lost.");
  if (
    (selector.expectedUnitId !== undefined && selector.expectedUnitId !== unit.id)
    || (selector.expectedUnitSha256 !== undefined && selector.expectedUnitSha256 !== unit.sha256)
    || (selector.expectedByteRange !== undefined && !sameRange(selector.expectedByteRange, unit.byteRange))
  ) {
    throw new AuthoringFailure(
      "selector-unit-drift",
      `Evidence selector ${selectorLabel(selector)} matched a unit whose ID, bytes, or hash drifted from its review commitment.`,
      { sourcePaths: [sourcePath] },
    );
  }
  const existing = context.resolvedByRegistryId.get(unit.id);
  if (existing !== undefined) return existing;
  const corpusDocument = context.corpusDocumentsByPath.get(sourcePath);
  if (corpusDocument === undefined) throw new Error(`Resolved source ${sourcePath} lost its corpus declaration.`);
  if (Buffer.byteLength(unit.text, "utf8") !== unit.byteRange.end - unit.byteRange.start) {
    throw new Error(`Evidence unit ${unit.id} lost UTF-8 byte fidelity.`);
  }
  const resolved = Object.freeze({
    corpusEvidenceUnitId: unit.id,
    registryUnitId: unit.id,
    parserVersion: unit.parserVersion,
    kind: unit.kind,
    documentId: corpusDocument.documentId,
    sourcePath: unit.sourcePath,
    byteRange: Object.freeze({ ...unit.byteRange }),
    lineRange: Object.freeze({ ...unit.lineRange }),
    headingPath: Object.freeze([...unit.headingAncestry]),
    ...(unit.pdfPage === undefined ? {} : { sourcePage: unit.pdfPage }),
    unitSha256: unit.sha256,
    sourceSha256: document.sourceSha256,
    trustClass: unit.trustClass,
    exactText: unit.text,
  } satisfies ResolvedAuthoredEvidenceV2);
  context.resolvedByRegistryId.set(unit.id, resolved);
  return resolved;
}

function canonicalInputs(inputs: EvaluationRetrievalInputsV2): EvaluationRetrievalInputsV2 {
  const filters = inputs.metadata?.filters.map((filter) => filter.kind === "exists"
    ? Object.freeze({ kind: "exists" as const, path: filter.path })
    : Object.freeze({ kind: "equals" as const, path: filter.path, value: filter.value }));
  const canonicalFilters = filters === undefined
    ? undefined
    : Object.freeze([...new Map(filters.map((filter) => [canonicalJson(filter), filter])).values()]
      .toSorted((left, right) => compareText(canonicalJson(left), canonicalJson(right))));
  return Object.freeze({
    text: inputs.text,
    ...(inputs.context === undefined
      ? {}
      : { context: Object.freeze({ repositoryPath: inputs.context.repositoryPath }) }),
    ...(inputs.graph === undefined
      ? {}
      : { graph: Object.freeze({ seeds: uniqueSorted(inputs.graph.seeds), depth: inputs.graph.depth }) }),
    ...(inputs.history === undefined
      ? {}
      : {
          history: Object.freeze({
            query: inputs.history.query,
            noteIds: uniqueSorted(inputs.history.noteIds),
          }),
        }),
    ...(inputs.metadata === undefined || canonicalFilters === undefined
      ? {}
      : {
          metadata: Object.freeze({
            filters: canonicalFilters,
            tags: uniqueSorted(inputs.metadata.tags),
          }),
        }),
    ...(inputs.noteId === undefined ? {} : { noteId: inputs.noteId }),
  });
}

function canonicalOrigins(
  origins: readonly EvaluationInputOriginDeclarationV2[],
  queryKey: string,
): readonly EvaluationInputOriginDeclarationV2[] {
  const byLane = new Map<string, EvaluationInputOriginDeclarationV2>();
  for (const origin of origins) {
    const previous = byLane.get(origin.lane);
    if (previous !== undefined && previous.origin !== origin.origin) {
      throw new AuthoringFailure(
        "conflicting-input-origin",
        `Question ${queryKey} supplies conflicting origins for ${origin.lane}.`,
        { queryKeys: [queryKey] },
      );
    }
    byLane.set(origin.lane, Object.freeze({ lane: origin.lane, origin: origin.origin }));
  }
  return Object.freeze([...byLane.values()].toSorted((left, right) => compareText(left.lane, right.lane)));
}

function canonicalJudgments<T extends { readonly relevance: 0 | 1 | 2 | 3 }>(
  judgments: readonly T[],
  id: (judgment: T) => string,
  label: string,
): readonly T[] {
  const byId = new Map<string, T>();
  for (const judgment of judgments) {
    const key = id(judgment);
    const previous = byId.get(key);
    if (previous !== undefined && previous.relevance !== judgment.relevance) {
      throw new AuthoringFailure(
        "conflicting-relevance-judgment",
        `${label} gives ${key} conflicting relevance grades.`,
      );
    }
    byId.set(key, judgment);
  }
  return Object.freeze([...byId.values()].toSorted((left, right) => compareText(id(left), id(right))));
}

function compileDocumentJudgments(
  judgments: readonly AuthoredDocumentJudgmentV2[],
  documentsByPath: ReadonlyMap<string, CanonicalSourceDocument>,
  label: string,
): readonly EvaluationDocumentJudgmentV2[] {
  const compiled = judgments.map((judgment): EvaluationDocumentJudgmentV2 => {
    const sourcePath = confinedPath(judgment.sourcePath, `${label} sourcePath`);
    const document = documentsByPath.get(sourcePath);
    if (document === undefined) {
      throw new AuthoringFailure(
        "judgment-document-missing",
        `${label} names unknown frozen source ${sourcePath}.`,
        { sourcePaths: [sourcePath] },
      );
    }
    return Object.freeze({ documentId: document.documentId, relevance: judgment.relevance });
  });
  return canonicalJudgments(compiled, ({ documentId }) => documentId, label);
}

function compileEvidenceJudgments(
  judgments: readonly AuthoredEvidenceUnitJudgmentV2[],
  context: ResolutionContext,
  label: string,
): readonly EvaluationEvidenceUnitJudgmentV2[] {
  const compiled = judgments.map((judgment): EvaluationEvidenceUnitJudgmentV2 => Object.freeze({
    evidenceUnitId: resolveSelector(judgment.selector, context).corpusEvidenceUnitId,
    relevance: judgment.relevance,
  }));
  return canonicalJudgments(compiled, ({ evidenceUnitId }) => evidenceUnitId, label);
}

function compileQuestion(
  question: HumanAuthoredEvaluationQuestionV2,
  context: ResolutionContext,
): EvaluationQueryV2 {
  const queryKey = authoredKey(question.key, "question.key");
  const queryId = opaqueId("q", [queryKey]);
  const nuggetKeys = new Set<string>();
  const supportKeys = new Set<string>();
  const supportIdsByNugget = new Map<string, ReadonlyMap<string, string>>();
  const nuggets = question.gold.nuggets.map((nugget) => {
    const nuggetKey = authoredKey(nugget.key, `question ${queryKey} nugget key`);
    if (nuggetKeys.has(nuggetKey)) {
      throw new AuthoringFailure("duplicate-nugget-key", `Question ${queryKey} repeats nugget key ${nuggetKey}.`, {
        queryKeys: [queryKey],
      });
    }
    nuggetKeys.add(nuggetKey);
    const supportIds = new Map<string, string>();
    const acceptableSupportSets = nugget.acceptableSupportSets.map((supportSet) => {
      const supportKey = authoredKey(supportSet.key, `question ${queryKey} support-set key`);
      const scopedKey = `${nuggetKey}\0${supportKey}`;
      if (supportKeys.has(scopedKey)) {
        throw new AuthoringFailure(
          "duplicate-support-set-key",
          `Question ${queryKey} nugget ${nuggetKey} repeats support-set key ${supportKey}.`,
          { queryKeys: [queryKey] },
        );
      }
      supportKeys.add(scopedKey);
      const supportId = opaqueId("ss", [queryKey, nuggetKey, supportKey]);
      supportIds.set(supportKey, supportId);
      const evidenceUnitIds = uniqueSorted(
        supportSet.evidence.map((selector) => resolveSelector(selector, context).corpusEvidenceUnitId),
      );
      return Object.freeze({ id: supportId, evidenceUnitIds });
    }).toSorted((left, right) => compareText(left.id, right.id));
    supportIdsByNugget.set(nuggetKey, supportIds);
    return Object.freeze({
      id: opaqueId("ng", [queryKey, nuggetKey]),
      text: nugget.text,
      required: nugget.required,
      acceptableSupportSets: Object.freeze(acceptableSupportSets),
    });
  }).toSorted((left, right) => compareText(left.id, right.id));

  const gold = Object.freeze({
    documents: compileDocumentJudgments(
      question.gold.documents,
      context.corpusDocumentsByPath,
      `question ${queryKey} gold documents`,
    ),
    evidenceUnits: compileEvidenceJudgments(
      question.gold.evidenceUnits,
      context,
      `question ${queryKey} gold evidence`,
    ),
    nuggets: Object.freeze(nuggets),
  });
  const nuggetIdByKey = new Map(question.gold.nuggets.map((nugget) => [
    nugget.key,
    opaqueId("ng", [queryKey, nugget.key]),
  ]));
  const nuggetRequiredByKey = new Map(question.gold.nuggets.map((nugget) => [nugget.key, nugget.required]));
  const assessorIds = new Set<string>();
  const rawAssessments = question.rawAssessments.map((assessment): EvaluationRawAssessorJudgmentV2 => {
    if (assessorIds.has(assessment.assessorId)) {
      throw new AuthoringFailure(
        "duplicate-assessor-decision",
        `Question ${queryKey} repeats assessor ${assessment.assessorId}.`,
        { queryKeys: [queryKey] },
      );
    }
    assessorIds.add(assessment.assessorId);
    const rawNuggetKeys = new Set<string>();
    const rawNuggets = assessment.nuggets.map((decision) => {
      if (rawNuggetKeys.has(decision.nuggetKey)) {
        throw new AuthoringFailure(
          "duplicate-assessor-nugget-decision",
          `Question ${queryKey} assessor ${assessment.assessorId} repeats nugget ${decision.nuggetKey}.`,
          { queryKeys: [queryKey] },
        );
      }
      rawNuggetKeys.add(decision.nuggetKey);
      const nuggetId = nuggetIdByKey.get(decision.nuggetKey);
      const supportIds = supportIdsByNugget.get(decision.nuggetKey);
      if (nuggetId === undefined || supportIds === undefined) {
        throw new AuthoringFailure(
          "assessor-nugget-missing",
          `Question ${queryKey} assessor ${assessment.assessorId} names unknown nugget ${decision.nuggetKey}.`,
          { queryKeys: [queryKey] },
        );
      }
      const acceptableSupportSetIds = uniqueSorted(decision.acceptableSupportSetKeys.map((key) => {
        const id = supportIds.get(key);
        if (id === undefined) {
          throw new AuthoringFailure(
            "assessor-support-set-missing",
            `Question ${queryKey} assessor ${assessment.assessorId} names unknown support set ${key}.`,
            { queryKeys: [queryKey] },
          );
        }
        return id;
      }));
      return Object.freeze({
        nuggetId,
        required: decision.required ?? nuggetRequiredByKey.get(decision.nuggetKey) ?? true,
        acceptableSupportSetIds,
      });
    }).toSorted((left, right) => compareText(left.nuggetId, right.nuggetId));
    return Object.freeze({
      assessorId: assessment.assessorId,
      expectedSupport: assessment.expectedSupport,
      documents: compileDocumentJudgments(
        assessment.documents,
        context.corpusDocumentsByPath,
        `question ${queryKey} assessor ${assessment.assessorId} documents`,
      ),
      evidenceUnits: compileEvidenceJudgments(
        assessment.evidenceUnits,
        context,
        `question ${queryKey} assessor ${assessment.assessorId} evidence`,
      ),
      nuggets: Object.freeze(rawNuggets),
    });
  }).toSorted((left, right) => compareText(left.assessorId, right.assessorId));

  const adjudication = question.adjudication.status === "resolved"
    ? Object.freeze({
        status: "resolved" as const,
        adjudicatorId: question.adjudication.adjudicatorId,
        rationale: question.adjudication.rationale,
      })
    : Object.freeze({ status: question.adjudication.status });
  return Object.freeze({
    id: queryId,
    text: question.text,
    split: question.split,
    cohort: question.cohort,
    strata: uniqueSorted(question.strata) as readonly EvaluationStratumV2[],
    primaryStratum: question.primaryStratum,
    expectedSupport: question.expectedSupport,
    primaryLane: question.primaryLane,
    ...(question.negativeSubtype === undefined ? {} : { negativeSubtype: question.negativeSubtype }),
    inputs: canonicalInputs(question.inputs),
    inputOrigins: canonicalOrigins(question.inputOrigins, queryKey),
    gold,
    rawAssessments: Object.freeze(rawAssessments),
    adjudication,
  });
}

function cloneExperiment(experiment: EvaluationExperimentV2): EvaluationExperimentV2 {
  const effects = new Map<string, EvaluationExperimentV2["protocol"]["minimumUsefulEffects"][number]>();
  for (const effect of experiment.protocol.minimumUsefulEffects) {
    const cloned = Object.freeze({
      metric: effect.metric,
      cohort: effect.cohort,
      minimumAbsoluteDifference: effect.minimumAbsoluteDifference,
    });
    const key = `${effect.metric}:${effect.cohort}`;
    const previous = effects.get(key);
    if (previous !== undefined) {
      throw new AuthoringFailure(
        canonicalJson(previous) === canonicalJson(cloned)
          ? "duplicate-minimum-useful-effect"
          : "conflicting-minimum-useful-effect",
        `Experiment metric ${effect.metric} repeats a minimum useful effect for ${effect.cohort}.`,
      );
    }
    effects.set(key, cloned);
  }
  const margins = new Map<string, EvaluationExperimentV2["protocol"]["nonInferiorityMargins"][number]>();
  for (const margin of experiment.protocol.nonInferiorityMargins) {
    const cloned = Object.freeze({
      metric: margin.metric,
      maximumAbsoluteRegression: margin.maximumAbsoluteRegression,
      maximumRelativeRegression: margin.maximumRelativeRegression,
    });
    const previous = margins.get(margin.metric);
    if (previous !== undefined && canonicalJson(previous) !== canonicalJson(cloned)) {
      throw new AuthoringFailure(
        "conflicting-non-inferiority-margin",
        `Experiment metric ${margin.metric} has conflicting non-inferiority margins.`,
      );
    }
    margins.set(margin.metric, cloned);
  }
  const localModel = experiment.environment.localModel.kind === "none"
    ? Object.freeze({ kind: "none" as const })
    : Object.freeze({
        kind: "model" as const,
        id: experiment.environment.localModel.id,
        sha256: experiment.environment.localModel.sha256,
      });
  return Object.freeze({
    protocol: Object.freeze({
      minimumUsefulEffects: Object.freeze([...effects.values()]
        .toSorted((left, right) => compareText(
          `${left.metric}:${left.cohort}`,
          `${right.metric}:${right.cohort}`,
        ))),
      nonInferiorityMargins: Object.freeze([...margins.values()]
        .toSorted((left, right) => compareText(left.metric, right.metric))),
      contextCeilings: Object.freeze({
        utf8Bytes: experiment.protocol.contextCeilings.utf8Bytes,
        readerTokens: experiment.protocol.contextCeilings.readerTokens,
      }),
      pairedPower: Object.freeze({
        alpha: experiment.protocol.pairedPower.alpha,
        targetPower: experiment.protocol.pairedPower.targetPower,
        assumedDiscordantRate: experiment.protocol.pairedPower.assumedDiscordantRate,
        assumedEffect: experiment.protocol.pairedPower.assumedEffect,
        minimumUsefulEffect: experiment.protocol.pairedPower.minimumUsefulEffect,
        requiredPairs: experiment.protocol.pairedPower.requiredPairs,
      }),
    }),
    environment: Object.freeze({
      tokenizer: Object.freeze({
        id: experiment.environment.tokenizer.id,
        sha256: experiment.environment.tokenizer.sha256,
      }),
      runtime: Object.freeze({
        id: experiment.environment.runtime.id,
        sha256: experiment.environment.runtime.sha256,
      }),
      hardware: Object.freeze({ id: experiment.environment.hardware.id }),
      localModel,
      cache: Object.freeze({
        preparation: experiment.environment.cache.preparation,
        fingerprintSha256: experiment.environment.cache.fingerprintSha256,
      }),
      fourReaderBatch: Object.freeze({
        id: experiment.environment.fourReaderBatch.id,
        sha256: experiment.environment.fourReaderBatch.sha256,
      }),
      incrementalMutation: Object.freeze({
        sourcePath: experiment.environment.incrementalMutation.sourcePath,
        appendUtf8Sha256: experiment.environment.incrementalMutation.appendUtf8Sha256,
        expectedPostMutationSha256:
          experiment.environment.incrementalMutation.expectedPostMutationSha256,
      }),
    }),
  });
}

function cloneAssessors(assessors: readonly EvaluationAssessorV2[]): readonly EvaluationAssessorV2[] {
  const byId = new Map<string, EvaluationAssessorV2>();
  for (const assessor of assessors) {
    const cloned = Object.freeze({
      id: assessor.id,
      ...(assessor.displayName === undefined ? {} : { displayName: assessor.displayName }),
      ...(assessor.affiliation === undefined ? {} : { affiliation: assessor.affiliation }),
    });
    const previous = byId.get(assessor.id);
    if (previous !== undefined && canonicalJson(previous) !== canonicalJson(cloned)) {
      throw new AuthoringFailure("conflicting-assessor", `Assessor ${assessor.id} has conflicting declarations.`);
    }
    byId.set(assessor.id, cloned);
  }
  return Object.freeze([...byId.values()].toSorted((left, right) => compareText(left.id, right.id)));
}

function cloneMeasurementProfiles(
  profiles: readonly EvaluationMeasurementProfileV2[],
): readonly EvaluationMeasurementProfileV2[] {
  const byId = new Map<string, EvaluationMeasurementProfileV2>();
  for (const profile of profiles) {
    const cloned = Object.freeze({
      id: profile.id,
      operation: profile.operation,
      scope: profile.scope,
      cacheState: profile.cacheState,
      concurrency: profile.concurrency,
      repetitions: profile.repetitions,
    });
    const previous = byId.get(profile.id);
    if (previous !== undefined && canonicalJson(previous) !== canonicalJson(cloned)) {
      throw new AuthoringFailure("conflicting-measurement-profile", `Measurement profile ${profile.id} conflicts.`);
    }
    byId.set(profile.id, cloned);
  }
  return Object.freeze([...byId.values()].toSorted((left, right) => compareText(left.id, right.id)));
}

function cloneRetrievers(
  retrievers: readonly EvaluationRetrieverDescriptorV2[],
): readonly EvaluationRetrieverDescriptorV2[] {
  const byId = new Map<string, EvaluationRetrieverDescriptorV2>();
  for (const retriever of retrievers) {
    const configuration: Record<string, string | number | boolean | null> = {};
    for (const key of Object.keys(retriever.configuration).toSorted(compareText)) {
      const value = retriever.configuration[key];
      if (value !== undefined) configuration[key] = value;
    }
    const cloned = Object.freeze({
      id: retriever.id,
      role: retriever.role,
      version: retriever.version,
      implementationSha256: retriever.implementationSha256,
      lanes: uniqueSorted(retriever.lanes) as readonly EvaluationLaneIdV2[],
      configuration: Object.freeze(configuration),
    });
    const previous = byId.get(retriever.id);
    if (previous !== undefined && canonicalJson(previous) !== canonicalJson(cloned)) {
      throw new AuthoringFailure("conflicting-retriever", `Retriever ${retriever.id} has conflicting descriptors.`);
    }
    byId.set(retriever.id, cloned);
  }
  return Object.freeze([...byId.values()].toSorted((left, right) => compareText(left.id, right.id)));
}

function issueFromFailure(error: unknown): PromotionCorpusCompilationIssueV2 {
  if (error instanceof AuthoringFailure) {
    return Object.freeze({
      severity: "error",
      code: error.code,
      message: error.message,
      ...(error.queryKeys === undefined ? {} : { queryKeys: Object.freeze([...error.queryKeys]) }),
      ...(error.sourcePaths === undefined ? {} : { sourcePaths: Object.freeze([...error.sourcePaths]) }),
    });
  }
  return Object.freeze({
    severity: "error",
    code: "invalid-corpus-authoring-input",
    message: error instanceof Error ? error.message : String(error),
  });
}

function canonicalIssues(
  issues: readonly PromotionCorpusCompilationIssueV2[],
): readonly PromotionCorpusCompilationIssueV2[] {
  const byKey = new Map<string, PromotionCorpusCompilationIssueV2>();
  for (const issue of issues) {
    byKey.set(canonicalJson(issue), issue);
  }
  return Object.freeze([...byKey.values()].toSorted((left, right) => (
    compareText(left.code, right.code) || compareText(left.message, right.message)
  )));
}

type QuotaQuestion = Pick<
  HumanAuthoredEvaluationQuestionV2,
  "cohort" | "expectedSupport" | "inputs" | "primaryStratum" | "rawAssessments" | "split" | "strata"
>;

function quotaEntry(
  id: string,
  label: string,
  rule: "at-least" | "exact",
  target: number,
  actual: number,
): PromotionQuotaLedgerEntryV2 {
  return Object.freeze({
    id,
    label,
    rule,
    target,
    actual,
    delta: actual - target,
    met: rule === "exact" ? actual === target : actual >= target,
  });
}

/** Deterministic ledger for the reviewed 48/120, 80/40, 84/84 promotion layout. */
export function promotionCorpusQuotaLedgerV2(
  questions: readonly QuotaQuestion[],
): readonly PromotionQuotaLedgerEntryV2[] {
  const development = questions.filter(({ split }) => split === "development");
  const test = questions.filter(({ split }) => split === "test");
  const rows: PromotionQuotaLedgerEntryV2[] = [
    quotaEntry("all-caller-seeded", "All caller-seeded questions", "exact", PROMOTION_COHORT_COUNT_V2,
      questions.filter(({ cohort }) => cohort === "caller-seeded").length),
    quotaEntry("all-questions", "All questions", "exact", PROMOTION_EVALUATION_QUERY_COUNT_V2, questions.length),
    quotaEntry("all-text-only", "All text-only questions", "exact", PROMOTION_COHORT_COUNT_V2,
      questions.filter(({ cohort }) => cohort === "text-only").length),
    quotaEntry("development-caller-seeded", "Development caller-seeded questions", "exact", 24,
      development.filter(({ cohort }) => cohort === "caller-seeded").length),
    quotaEntry("development-questions", "Development questions", "exact", PROMOTION_DEVELOPMENT_QUERY_COUNT_V2,
      development.length),
    quotaEntry("development-text-only", "Development text-only questions", "exact", 24,
      development.filter(({ cohort }) => cohort === "text-only").length),
    quotaEntry("dual-assessment", "Independently dual-assessed questions", "at-least",
      PROMOTION_DUAL_ASSESSMENT_MINIMUM_V2, questions.filter(({ rawAssessments }) => rawAssessments.length >= 2).length),
    quotaEntry("test-caller-seeded", "Test caller-seeded questions", "exact", PROMOTION_TEST_COHORT_COUNT_V2,
      test.filter(({ cohort }) => cohort === "caller-seeded").length),
    quotaEntry("test-insufficient", "Test insufficient questions", "exact", PROMOTION_TEST_INSUFFICIENT_COUNT_V2,
      test.filter(({ expectedSupport }) => expectedSupport === "insufficient").length),
    quotaEntry("test-questions", "Test questions", "exact", PROMOTION_TEST_QUERY_COUNT_V2, test.length),
    quotaEntry("test-supported", "Test supported questions", "exact", PROMOTION_TEST_SUPPORTED_COUNT_V2,
      test.filter(({ expectedSupport }) => expectedSupport === "supported").length),
    quotaEntry("test-text-only", "Test text-only questions", "exact", PROMOTION_TEST_COHORT_COUNT_V2,
      test.filter(({ cohort }) => cohort === "text-only").length),
    quotaEntry("test-support-stratum-consistency", "Test support and no-answer stratum consistency", "exact",
      PROMOTION_TEST_QUERY_COUNT_V2, test.filter((question) =>
        (question.expectedSupport === "insufficient") === question.strata.includes("no-answer-near-miss")).length),
  ];
  for (const cohort of ["caller-seeded", "text-only"] as const) {
    for (const expectedSupport of ["supported", "insufficient"] as const) {
      rows.push(quotaEntry(
        `development-${cohort}-${expectedSupport}`,
        `Development ${cohort} ${expectedSupport} questions`,
        "exact",
        12,
        development.filter((question) =>
          question.cohort === cohort && question.expectedSupport === expectedSupport).length,
      ));
    }
  }
  for (const cohort of ["caller-seeded", "text-only"] as const) {
    rows.push(quotaEntry(
      `test-${cohort}-supported`,
      `Test ${cohort} supported questions`,
      "exact",
      40,
      test.filter((question) => question.cohort === cohort && question.expectedSupport === "supported").length,
    ));
    rows.push(quotaEntry(
      `test-${cohort}-insufficient`,
      `Test ${cohort} insufficient questions`,
      "exact",
      20,
      test.filter((question) => question.cohort === cohort && question.expectedSupport === "insufficient").length,
    ));
  }
  for (const [stratum, minimum] of Object.entries(PROMOTION_CRITICAL_STRATUM_MINIMA_V2)) {
    rows.push(quotaEntry(
      `test-stratum-${stratum}`,
      `Test ${stratum} stratum`,
      "at-least",
      minimum,
      test.filter((question) => question.strata.includes(stratum as EvaluationStratumV2)).length,
    ));
    rows.push(quotaEntry(
      `dual-stratum-${stratum}`,
      `Dual assessment covering ${stratum}`,
      "at-least",
      1,
      questions.filter((question) =>
        question.rawAssessments.length >= 2 && question.strata.includes(stratum as EvaluationStratumV2)).length,
    ));
  }
  for (const [lane, minimum] of Object.entries(PROMOTION_CRITICAL_INPUT_MINIMA_V2)) {
    rows.push(quotaEntry(
      `test-input-${lane}`,
      `Test executable ${lane} inputs`,
      "at-least",
      minimum,
      test.filter((question) => question.inputs[lane as keyof EvaluationRetrievalInputsV2] !== undefined).length,
    ));
  }
  for (const [stratum, minimum] of Object.entries(PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2)) {
    rows.push(quotaEntry(
      `test-primary-${stratum}`,
      `Test primary ${stratum} questions`,
      "at-least",
      minimum,
      test.filter((question) => question.primaryStratum === stratum).length,
    ));
    for (const cohort of ["caller-seeded", "text-only"] as const) {
      const cohortMinimum = PROMOTION_ACCEPTANCE_STRATUM_COHORT_MINIMA_V2[
        stratum as keyof typeof PROMOTION_ACCEPTANCE_STRATUM_COHORT_MINIMA_V2
      ];
      const cell = test.filter((question) =>
        question.cohort === cohort && question.primaryStratum === stratum);
      rows.push(quotaEntry(
        `test-${cohort}-primary-${stratum}`,
        `Test ${cohort} primary ${stratum} questions`,
        "at-least",
        cohortMinimum,
        cell.length,
      ));
      const requiredDual = Math.max(
        PROMOTION_STRATUM_COHORT_DUAL_MINIMUM_V2,
        Math.ceil(cell.length * PROMOTION_STRATUM_COHORT_DUAL_FRACTION_V2),
      );
      rows.push(quotaEntry(
        `dual-test-${cohort}-${stratum}`,
        `Dual assessment in test ${cohort} ${stratum} cell`,
        "at-least",
        requiredDual,
        cell.filter(({ rawAssessments }) => rawAssessments.length >= 2).length,
      ));
    }
  }
  for (const cohort of ["caller-seeded", "text-only"] as const) {
    const cell = test.filter((question) =>
      question.cohort === cohort && question.strata.includes("no-answer-near-miss"));
    const requiredDual = Math.max(
      PROMOTION_STRATUM_COHORT_DUAL_MINIMUM_V2,
      Math.ceil(cell.length * PROMOTION_STRATUM_COHORT_DUAL_FRACTION_V2),
    );
    rows.push(quotaEntry(
      `dual-test-${cohort}-no-answer-near-miss`,
      `Dual assessment in test ${cohort} no-answer near-miss cell`,
      "at-least",
      requiredDual,
      cell.filter(({ rawAssessments }) => rawAssessments.length >= 2).length,
    ));
  }
  return Object.freeze(rows.toSorted((left, right) => compareText(left.id, right.id)));
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function granularityRow(id: string, queryCount: number): PromotionPowerGranularityRowV2 {
  const fivePercentagePointEventCount = Math.max(1, Math.round(queryCount * 0.05));
  return Object.freeze({
    id,
    queryCount,
    oneOutcomeStep: Object.freeze({
      numerator: 1 as const,
      denominator: queryCount,
      percentagePoints: rounded(100 / queryCount),
    }),
    fivePercentagePointEventCount,
    nearestObservableFivePointDelta: rounded(100 * fivePercentagePointEventCount / queryCount),
    representsFivePointsExactly: queryCount % 20 === 0,
  });
}

/**
 * Reports discrete outcome resolution without pretending that sample size alone establishes power.
 * Paired power still requires an effect, alpha, desired power, and discordant-pair assumptions.
 */
export function promotionCorpusPowerGranularityV2(
  questions: readonly QuotaQuestion[],
): PromotionCorpusDiagnosticsV2["powerGranularity"] {
  const test = questions.filter(({ split }) => split === "test");
  const groups = new Map<string, number>([
    ["development", questions.filter(({ split }) => split === "development").length],
    ["test", test.length],
    ["test-caller-seeded", test.filter(({ cohort }) => cohort === "caller-seeded").length],
    ["test-insufficient", test.filter(({ expectedSupport }) => expectedSupport === "insufficient").length],
    ["test-supported", test.filter(({ expectedSupport }) => expectedSupport === "supported").length],
    ["test-text-only", test.filter(({ cohort }) => cohort === "text-only").length],
  ]);
  for (const stratum of Object.keys(PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2) as EvaluationStratumV2[]) {
    groups.set(`test-stratum-${stratum}`, test.filter((question) => question.primaryStratum === stratum).length);
  }
  groups.set("test-stratum-no-answer-near-miss",
    test.filter((question) => question.strata.includes("no-answer-near-miss")).length);
  const rows = [...groups.entries()]
    .filter((entry): entry is [string, number] => entry[1] > 0)
    .map(([id, count]) => granularityRow(id, count))
    .toSorted((left, right) => compareText(left.id, right.id));
  return Object.freeze({
    status: "descriptive-only",
    note: "Outcome granularity is descriptive only. Promotion readiness comes from the sealed prospective paired-power design.",
    rows: Object.freeze(rows),
  });
}

function normalizedPrompt(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function ngrams(text: string, size: number): ReadonlySet<string> {
  const tokens = normalizedPrompt(text).split(" ").filter((token) => token !== "");
  if (tokens.length === 0) return new Set();
  if (tokens.length < size) return new Set([tokens.join(" ")]);
  const result = new Set<string>();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    result.add(tokens.slice(index, index + size).join(" "));
  }
  return result;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const gram of left) if (right.has(gram)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function promptTokens(text: string): ReadonlySet<string> {
  return new Set(normalizedPrompt(text).split(" ").filter((token) => token !== ""));
}

function balancedAccuracy(
  questions: readonly HumanAuthoredEvaluationQuestionV2[],
  label: (question: HumanAuthoredEvaluationQuestionV2) => string,
): { readonly classes: readonly string[]; readonly value: number } | undefined {
  const classes = uniqueSorted(questions.map(label));
  if (classes.length < 2 || questions.length < 3) return undefined;
  const tokenSets = questions.map(({ text }) => promptTokens(text));
  const correctByClass = new Map(classes.map((class_) => [class_, 0]));
  const countByClass = new Map(classes.map((class_) => [class_, 0]));
  for (const [index, question] of questions.entries()) {
    const actual = label(question);
    countByClass.set(actual, (countByClass.get(actual) ?? 0) + 1);
    let nearestIndex: number | undefined;
    let nearestSimilarity = -1;
    for (const [candidateIndex, candidate] of questions.entries()) {
      if (candidateIndex === index) continue;
      const similarity = jaccard(tokenSets[index] ?? new Set(), tokenSets[candidateIndex] ?? new Set());
      const nearest = nearestIndex === undefined ? undefined : questions[nearestIndex];
      if (
        similarity > nearestSimilarity
        || (
          similarity === nearestSimilarity
          && nearest !== undefined
          && compareText(candidate.key, nearest.key) < 0
        )
      ) {
        nearestIndex = candidateIndex;
        nearestSimilarity = similarity;
      }
    }
    if (nearestIndex !== undefined && label(questions[nearestIndex]!) === actual) {
      correctByClass.set(actual, (correctByClass.get(actual) ?? 0) + 1);
    }
  }
  const recalls = classes.map((class_) => {
    const count = countByClass.get(class_) ?? 0;
    return count === 0 ? 0 : (correctByClass.get(class_) ?? 0) / count;
  });
  return Object.freeze({ classes, value: rounded(recalls.reduce((sum, value) => sum + value, 0) / recalls.length) });
}

export function promotionCorpusLabelPredictabilityV2(
  questions: readonly HumanAuthoredEvaluationQuestionV2[],
  policy: PromotionCorpusReviewPolicyV2 | undefined,
): PromotionCorpusDiagnosticsV2["labelPredictability"] {
  const ceiling = policy?.labelPredictabilityCeiling ?? DEFAULT_LABEL_PREDICTABILITY_CEILING;
  if (
    typeof ceiling !== "number"
    || !Number.isFinite(ceiling)
    || ceiling <= 0
    || ceiling > DEFAULT_LABEL_PREDICTABILITY_CEILING
  ) {
    throw new AuthoringFailure(
      "invalid-review-policy",
      `reviewPolicy.labelPredictabilityCeiling cannot weaken the fixed ${DEFAULT_LABEL_PREDICTABILITY_CEILING} balanced-accuracy ceiling and must be positive.`,
    );
  }
  const definitions = [
    ["cohort", (question: HumanAuthoredEvaluationQuestionV2) => question.cohort],
    ["expected-support", (question: HumanAuthoredEvaluationQuestionV2) => question.expectedSupport],
    ["split", (question: HumanAuthoredEvaluationQuestionV2) => question.split],
  ] as const;
  const rows = definitions.flatMap(([labelName, value]) => {
    const result = balancedAccuracy(questions, value);
    if (result === undefined) return [];
    return [Object.freeze({
      label: labelName,
      classes: result.classes,
      balancedAccuracy: result.value,
      evaluatedQuestions: questions.length,
      ceiling,
      met: result.value <= ceiling,
    })];
  });
  return Object.freeze({
    classifier: LABEL_PREDICTABILITY_CLASSIFIER,
    rows: Object.freeze(rows),
    met: rows.every(({ met }) => met),
  });
}

export function promotionCorpusDiagnosticsV2(
  questions: readonly HumanAuthoredEvaluationQuestionV2[],
  experiment: EvaluationExperimentV2,
  policy?: PromotionCorpusReviewPolicyV2,
  independentSourceFamilyClusters?: number,
): PromotionCorpusDiagnosticsV2 {
  const quotaLedger = promotionCorpusQuotaLedgerV2(questions);
  const labelPredictability = promotionCorpusLabelPredictabilityV2(questions, policy);
  const eligibleCallerSeededSupportedTestPairs = questions.filter((question) =>
    question.split === "test"
    && question.cohort === "caller-seeded"
    && question.expectedSupport === "supported").length;
  const pairedPower = Object.freeze({
    eligibleCallerSeededSupportedTestPairs,
    independentSourceFamilyClusters: independentSourceFamilyClusters ?? null,
    requiredPairs: experiment.protocol.pairedPower.requiredPairs,
    met: eligibleCallerSeededSupportedTestPairs >= experiment.protocol.pairedPower.requiredPairs
      && independentSourceFamilyClusters !== undefined
      && independentSourceFamilyClusters >= experiment.protocol.pairedPower.requiredPairs,
  });
  return Object.freeze({
    quotaLedger,
    promotionLayoutReady: quotaLedger.every(({ met }) => met)
      && labelPredictability.met
      && pairedPower.met,
    labelPredictability,
    pairedPower,
    powerGranularity: promotionCorpusPowerGranularityV2(questions),
  });
}

function promptReviewIssues(
  questions: readonly HumanAuthoredEvaluationQuestionV2[],
  policy: PromotionCorpusReviewPolicyV2 | undefined,
  enforceLabelPredictability: boolean,
): readonly PromotionCorpusCompilationIssueV2[] {
  const size = policy?.ngramSize ?? DEFAULT_NGRAM_SIZE;
  const threshold = policy?.crossSplitNgramThreshold ?? DEFAULT_CROSS_SPLIT_NGRAM_THRESHOLD;
  if (size !== DEFAULT_NGRAM_SIZE) {
    throw new AuthoringFailure(
      "invalid-review-policy",
      `reviewPolicy.ngramSize cannot weaken the fixed ${DEFAULT_NGRAM_SIZE}-gram leakage review.`,
    );
  }
  if (
    typeof threshold !== "number"
    || !Number.isFinite(threshold)
    || threshold <= 0
    || threshold > DEFAULT_CROSS_SPLIT_NGRAM_THRESHOLD
  ) {
    throw new AuthoringFailure(
      "invalid-review-policy",
      `reviewPolicy.crossSplitNgramThreshold must be in (0, ${DEFAULT_CROSS_SPLIT_NGRAM_THRESHOLD}].`,
    );
  }
  const issues: PromotionCorpusCompilationIssueV2[] = [];
  const normalizedGroups = new Map<string, HumanAuthoredEvaluationQuestionV2[]>();
  for (const question of questions) {
    const normalized = normalizedPrompt(question.text);
    const group = normalizedGroups.get(normalized) ?? [];
    group.push(question);
    normalizedGroups.set(normalized, group);
  }
  for (const [normalized, group] of normalizedGroups) {
    if (normalized === "" || group.length < 2) continue;
    const spansEvaluationSplits = new Set(group.map(({ split }) => split)).size > 1;
    issues.push(Object.freeze({
      severity: spansEvaluationSplits ? "error" : "warning",
      code: spansEvaluationSplits ? "exact-cross-split-prompt-duplicate" : "duplicate-normalized-prompt",
      message: `Questions ${group.map(({ key }) => key).toSorted(compareText).join(", ")} share the same normalized prompt${spansEvaluationSplits ? " across evaluation splits" : ""}.`,
      queryKeys: uniqueSorted(group.map(({ key }) => key)),
    }));
  }
  const development = questions.filter(({ split }) => split === "development");
  const test = questions.filter(({ split }) => split === "test");
  const gramCache = new Map<HumanAuthoredEvaluationQuestionV2, ReadonlySet<string>>();
  for (const question of questions) gramCache.set(question, ngrams(question.text, size));
  for (const left of development) {
    for (const right of test) {
      if (normalizedPrompt(left.text) === normalizedPrompt(right.text)) continue;
      const overlap = jaccard(gramCache.get(left) ?? new Set(), gramCache.get(right) ?? new Set());
      if (overlap < threshold) continue;
      issues.push(Object.freeze({
        severity: "error",
        code: "high-cross-split-ngram-overlap",
        message: `Development question ${left.key} and test question ${right.key} have ${rounded(overlap)} ${size}-gram Jaccard overlap.`,
        queryKeys: uniqueSorted([left.key, right.key]),
        overlap: rounded(overlap),
      }));
    }
  }
  if (enforceLabelPredictability) {
    for (const row of promotionCorpusLabelPredictabilityV2(questions, policy).rows) {
      if (row.met) continue;
      issues.push(Object.freeze({
        severity: "error",
        code: "prompt-label-predictability-ceiling",
        message: `${row.label} is predictable from prompt text at balanced accuracy ${row.balancedAccuracy}, above the sealed ceiling ${row.ceiling} under ${LABEL_PREDICTABILITY_CLASSIFIER}.`,
      }));
    }
  }
  return canonicalIssues(issues);
}

function familyReview(
  sourceDocuments: readonly CanonicalSourceDocument[],
  registry: EvaluationEvidenceRegistry,
  queries: readonly EvaluationQueryV2[],
  resolvedEvidence: readonly ResolvedAuthoredEvidenceV2[],
): {
  readonly errors: readonly PromotionCorpusCompilationIssueV2[];
  readonly warnings: readonly PromotionCorpusCompilationIssueV2[];
} {
  const errors: PromotionCorpusCompilationIssueV2[] = [];
  const warnings: PromotionCorpusCompilationIssueV2[] = [];
  const sourceByDocumentId = new Map(sourceDocuments.map((document) => [document.documentId, document]));
  const documentByEvidenceId = new Map(resolvedEvidence.map((unit) => [
    unit.corpusEvidenceUnitId,
    unit.documentId,
  ]));
  const familySplits = new Map<string, Set<EvaluationSplitV2>>();
  const pathSplits = new Map<string, Set<EvaluationSplitV2>>();
  for (const query of queries) {
    const documentIds = new Set([
      ...query.gold.documents.map(({ documentId }) => documentId),
      ...query.gold.evidenceUnits.map(({ evidenceUnitId }) => documentByEvidenceId.get(evidenceUnitId) ?? ""),
    ]);
    for (const documentId of documentIds) {
      const source = sourceByDocumentId.get(documentId);
      if (source === undefined) continue;
      const familyClusterId = source.familyAssignmentSha256 === undefined
        ? source.sourceFamilyId
        : `family-assignment:${source.familyAssignmentSha256}`;
      const splits = familySplits.get(familyClusterId) ?? new Set<EvaluationSplitV2>();
      splits.add(query.split);
      familySplits.set(familyClusterId, splits);
      const sourceSplits = pathSplits.get(source.sourcePath) ?? new Set<EvaluationSplitV2>();
      sourceSplits.add(query.split);
      pathSplits.set(source.sourcePath, sourceSplits);
    }
  }
  const familyKeyById = new Map(sourceDocuments.map((source) => [
    source.familyAssignmentSha256 === undefined
      ? source.sourceFamilyId
      : `family-assignment:${source.familyAssignmentSha256}`,
    source.sourceFamilyKey,
  ]));
  for (const [familyId, splits] of familySplits) {
    if (splits.size < 2) continue;
    const familyKey = familyKeyById.get(familyId) ?? familyId;
    errors.push(Object.freeze({
      severity: "error",
      code: "source-family-split-leakage",
      message: `Source family ${familyKey} is judged in both development and test splits.`,
      sourceFamilyKeys: Object.freeze([familyKey]),
    }));
  }
  for (const [sourcePath, splits] of pathSplits) {
    if (splits.size < 2) continue;
    errors.push(Object.freeze({
      severity: "error",
      code: "source-path-split-leakage",
      message: `Source path ${sourcePath} is judged in both development and test splits.`,
      sourcePaths: Object.freeze([sourcePath]),
    }));
  }

  const snapshotByPath = new Map(registry.documents.map((document) => [document.sourcePath, document]));
  const documentsByFamily = new Map<string, CanonicalSourceDocument[]>();
  for (const document of sourceDocuments) {
    const familyClusterId = document.familyAssignmentSha256 === undefined
      ? document.sourceFamilyId
      : `family-assignment:${document.familyAssignmentSha256}`;
    const group = documentsByFamily.get(familyClusterId) ?? [];
    group.push(document);
    documentsByFamily.set(familyClusterId, group);
  }
  const familiesByFingerprint = new Map<string, string[]>();
  for (const [familyId, documents] of documentsByFamily) {
    const hashes = documents.map((document) => snapshotByPath.get(document.sourcePath)?.sourceSha256 ?? "")
      .toSorted(compareText);
    const fingerprint = framedDigest("promotion-corpus-source-family-copy-v1", hashes);
    const familyIds = familiesByFingerprint.get(fingerprint) ?? [];
    familyIds.push(familyId);
    familiesByFingerprint.set(fingerprint, familyIds);
  }
  for (const familyIds of familiesByFingerprint.values()) {
    if (familyIds.length < 2) continue;
    const familyKeys = uniqueSorted(familyIds.map((id) => familyKeyById.get(id) ?? id));
    const splits = new Set(familyIds.flatMap((id) => [...(familySplits.get(id) ?? [])]));
    const issue = Object.freeze({
      severity: splits.size > 1 ? "error" as const : "warning" as const,
      code: splits.size > 1 ? "copied-source-family-cross-split" : "copied-source-family",
      message: `Distinct source-family keys ${familyKeys.join(", ")} contain byte-identical frozen document sets${splits.size > 1 ? " across evaluation splits" : ""}.`,
      sourceFamilyKeys: familyKeys,
    });
    if (issue.severity === "error") errors.push(issue);
    else warnings.push(issue);
  }
  return Object.freeze({ errors: canonicalIssues(errors), warnings: canonicalIssues(warnings) });
}

function evidenceUnitForCorpus(
  unit: EvaluationEvidenceUnit,
  source: CanonicalSourceDocument,
): EvaluationEvidenceUnitV2 {
  return Object.freeze({
    id: unit.id,
    documentId: unit.documentId,
    sourceFamilyId: source.sourceFamilyId,
    trustClass: source.trustClass,
    sourcePath: unit.sourcePath,
    lineRange: Object.freeze({ ...unit.lineRange }),
    headingPath: Object.freeze([...unit.headingAncestry]),
    ...(unit.pdfPage === undefined ? {} : { sourcePage: unit.pdfPage }),
  });
}

/**
 * Seals an already-authored corpus without consulting results or rankings. Descriptor digests,
 * the candidate lock, and the corpus commitment are calculated in dependency order. The corpus
 * digest excludes its own digest fields through evaluationCorpusDigestV2's commitment payload.
 */
export function sealRetrievalEvaluationCorpusV2(
  input: RetrievalEvaluationCorpusSealInputV2,
): RetrievalEvaluationCorpusSealResultV2 {
  const buildContractSha256 = canonicalSha256(input.buildContractSha256, "buildContractSha256");
  const retrievers = [...input.retrievers].toSorted((left, right) => compareText(left.id, right.id));
  const candidateLock = Object.freeze({
    baselineRetrieverId: input.baselineRetrieverId,
    candidateRetrieverIds: Object.freeze(retrievers
      .filter(({ role }) => role === "candidate")
      .map(({ id }) => id)
      .toSorted(compareText)),
    descriptorDigests: Object.freeze(retrievers.map((descriptor) => Object.freeze({
      retrieverId: descriptor.id,
      sha256: evaluationRetrieverDescriptorDigestV2(descriptor),
    }))),
  });
  const candidateLockSha256 = evaluationCandidateLockDigestV2(candidateLock);
  const draft: RetrievalEvaluationCorpusV2 = {
    schemaVersion: input.schemaVersion,
    id: input.id,
    description: input.description,
    manifest: {
      protocol: RETRIEVAL_EVALUATION_V2_PROTOCOL,
      sealedAt: input.sealedAt,
      corpusSha256: ZERO_SHA256,
      candidateLockSha256,
      buildContractSha256,
    },
    frozen: input.frozen,
    assessment: input.assessment,
    experiment: input.experiment,
    sourceFamilies: input.sourceFamilies,
    documents: input.documents,
    evidenceUnits: input.evidenceUnits,
    measurementProfiles: input.measurementProfiles,
    retrievers,
    candidateLock,
    queries: input.queries,
  };
  const sealed: RetrievalEvaluationCorpusV2 = {
    ...draft,
    manifest: {
      ...draft.manifest,
      corpusSha256: evaluationCorpusDigestV2(draft),
    },
  };
  const corpus = parseRetrievalEvaluationCorpusV2(sealed, { claimPromotion: false });
  return Object.freeze({
    corpus,
    externalSeal: Object.freeze({ expectedCorpusSha256: corpus.manifest.corpusSha256 }),
  });
}

function canonicalSourceDocuments(
  documents: readonly PromotionCorpusMarkdownDocumentV2[],
  reviewPolicy: PromotionCorpusReviewPolicyV2 | undefined,
): readonly CanonicalSourceDocument[] {
  const protocolInput = reviewPolicy?.sourceFamilyAssignment;
  const protocol = protocolInput === undefined
    ? undefined
    : Object.freeze({
        protocolId: authoredKey(
          protocolInput.protocolId,
          "reviewPolicy.sourceFamilyAssignment.protocolId",
        ),
        protocolSha256: canonicalSha256(
          protocolInput.protocolSha256,
          "reviewPolicy.sourceFamilyAssignment.protocolSha256",
        ),
        reviewerIds: canonicalReviewerIds(
          protocolInput.reviewerIds,
          "reviewPolicy.sourceFamilyAssignment.reviewerIds",
        ),
      });
  const families = new Map<string, {
    readonly review: CanonicalSourceFamilyAssignmentReview | undefined;
    readonly members: {
      readonly sourcePath: string;
      readonly sourceClass: EvaluationSourceClassV2;
      readonly trustClass: EvaluationTrustClassV2;
    }[];
  }>();
  const sourceBindings = new Map<string, { readonly documentId: string; readonly sourceFamilyKey: string }>();
  const documentBindings = new Map<string, string>();
  const result = documents.map((document, index): CanonicalSourceDocument => {
    const sourcePath = confinedPath(document.sourcePath, `documents[${index}].sourcePath`);
    const documentId = document.documentId === undefined
      ? sourcePath
      : confinedPath(document.documentId, `documents[${index}].documentId`);
    const sourceFamilyKey = authoredKey(document.sourceFamilyKey, `documents[${index}].sourceFamilyKey`);
    const review = canonicalSourceFamilyReview(document, index, protocol?.reviewerIds);
    if (!EVALUATION_SOURCE_TRUST_COMPATIBILITY_V2[document.sourceClass]?.some(
      (trustClass) => trustClass === document.trustClass,
    )) {
      throw new AuthoringFailure(
        "incompatible-source-trust",
        `Source ${sourcePath} cannot combine source class ${document.sourceClass} with trust class ${document.trustClass}.`,
        { sourcePaths: [sourcePath] },
      );
    }
    const sourceBinding = sourceBindings.get(sourcePath);
    if (sourceBinding !== undefined) {
      throw new AuthoringFailure(
        "duplicate-source-path-binding",
        `Source path ${sourcePath} is bound more than once; every path must name exactly one document and family.`,
        { sourcePaths: [sourcePath] },
      );
    }
    const boundPath = documentBindings.get(documentId);
    if (boundPath !== undefined) {
      throw new AuthoringFailure(
        "duplicate-document-binding",
        `Document ${documentId} is bound to both ${boundPath} and ${sourcePath}.`,
        { sourcePaths: uniqueSorted([boundPath, sourcePath]) },
      );
    }
    sourceBindings.set(sourcePath, { documentId, sourceFamilyKey });
    documentBindings.set(documentId, sourcePath);
    const previous = families.get(sourceFamilyKey);
    if (previous !== undefined && (
      previous.review?.rationale !== review?.rationale
      || !sameStrings(previous.review?.reviewerIds ?? [], review?.reviewerIds ?? [])
    )) {
      throw new AuthoringFailure(
        "conflicting-source-family-review",
        `Source family ${sourceFamilyKey} has inconsistent rationales or reviewer assignments.`,
      );
    }
    const family = previous ?? { review, members: [] };
    family.members.push({
      sourcePath,
      sourceClass: document.sourceClass,
      trustClass: document.trustClass,
    });
    families.set(sourceFamilyKey, family);
    return Object.freeze({
      documentId,
      sourcePath,
      markdown: document.markdown,
      sourceFamilyKey,
      // The private causal-family key may legitimately span heterogeneous
      // provenance. Keep provenance families homogeneous while binding them to
      // one reviewed causal assignment below.
      sourceFamilyId: opaqueId("sf", [sourceFamilyKey, document.sourceClass, document.trustClass]),
      sourceClass: document.sourceClass,
      trustClass: document.trustClass,
    });
  });

  const reviewOwnerByFingerprint = new Map<string, string>();
  const assignmentByFamilyKey = new Map<string, string>();
  for (const [sourceFamilyKey, family] of families) {
    if (family.review === undefined) continue;
    if (protocol === undefined) throw new Error("Reviewed source family lost its assignment protocol.");
    const reviewFingerprint = canonicalJson(family.review);
    const previousFamilyKey = reviewOwnerByFingerprint.get(reviewFingerprint);
    if (previousFamilyKey !== undefined && previousFamilyKey !== sourceFamilyKey) {
      throw new AuthoringFailure(
        "opaque-source-family-splitting",
        `Distinct source-family keys ${previousFamilyKey} and ${sourceFamilyKey} reuse the same review rationale and reviewers; independently justify each causal family instead of splitting by note.`,
      );
    }
    reviewOwnerByFingerprint.set(reviewFingerprint, sourceFamilyKey);
    assignmentByFamilyKey.set(sourceFamilyKey, framedDigest(
      "promotion-corpus-source-family-assignment-v1",
      [canonicalJson({
        protocol,
        sourceFamilyKey,
        rationale: family.review.rationale,
        reviewerIds: family.review.reviewerIds,
        members: family.members.toSorted((left, right) => {
          const pathOrder = compareText(left.sourcePath, right.sourcePath);
          if (pathOrder !== 0) return pathOrder;
          const sourceClassOrder = compareText(left.sourceClass, right.sourceClass);
          return sourceClassOrder !== 0
            ? sourceClassOrder
            : compareText(left.trustClass, right.trustClass);
        }),
      })],
    ));
  }

  return Object.freeze(result
    .map((document) => {
      const familyAssignmentSha256 = assignmentByFamilyKey.get(document.sourceFamilyKey);
      return Object.freeze({
        ...document,
        ...(familyAssignmentSha256 === undefined ? {} : { familyAssignmentSha256 }),
      });
    })
    .toSorted((left, right) => compareText(left.documentId, right.documentId)));
}

function failedResult(
  diagnostics: PromotionCorpusDiagnosticsV2,
  errors: readonly PromotionCorpusCompilationIssueV2[],
  warnings: readonly PromotionCorpusCompilationIssueV2[],
  registry?: EvaluationEvidenceRegistry,
  resolvedEvidence: readonly ResolvedAuthoredEvidenceV2[] = [],
): PromotionCorpusCompilationResultV2 {
  const canonicalErrors = canonicalIssues(errors);
  const canonicalWarnings = canonicalIssues(warnings);
  const reviewIssues = canonicalIssues([...canonicalErrors, ...canonicalWarnings].filter(({ code }) =>
    code.includes("prompt")
    || code.includes("ngram")
    || code.includes("source-family")
    || code.includes("split-leakage")));
  return Object.freeze({
    ok: false,
    ...(registry === undefined ? {} : { evidenceRegistry: registry }),
    resolvedEvidence: Object.freeze([...resolvedEvidence]),
    diagnostics,
    errors: canonicalErrors,
    warnings: canonicalWarnings,
    reviewIssues,
  });
}

/** Compile a reviewable authored corpus of any size. Promotion quotas remain explicit diagnostics. */
export function compileRetrievalEvaluationCorpusAuthoringV2(
  input: PromotionCorpusAuthoringInputV2,
  options: { readonly expectedPromotionSeal?: EvaluationExternalCorpusSealV2 } = {},
): PromotionCorpusCompilationResultV2 {
  const questions = input.questions;
  let diagnostics = promotionCorpusDiagnosticsV2(questions, input.experiment, input.reviewPolicy);
  const errors: PromotionCorpusCompilationIssueV2[] = [];
  const warnings: PromotionCorpusCompilationIssueV2[] = [];
  try {
    for (const issue of promptReviewIssues(
      questions,
      input.reviewPolicy,
      options.expectedPromotionSeal !== undefined,
    )) {
      if (issue.severity === "error") errors.push(issue);
      else warnings.push(issue);
    }
  } catch (error) {
    errors.push(issueFromFailure(error));
  }

  let sourceDocuments: readonly CanonicalSourceDocument[];
  let registry: EvaluationEvidenceRegistry;
  try {
    sourceDocuments = canonicalSourceDocuments(input.documents, input.reviewPolicy);
    registry = buildEvaluationEvidenceRegistry({
      documents: sourceDocuments.map((document) => ({
        documentId: document.documentId,
        sourcePath: document.sourcePath,
        markdown: document.markdown,
        trustClass: document.trustClass,
      })),
      parserVersion: input.evidenceParserVersion ?? EVALUATION_EVIDENCE_PARSER_VERSION,
    });
  } catch (error) {
    errors.push(issueFromFailure(error));
    return failedResult(diagnostics, errors, warnings);
  }

  const corpusDocumentsByPath = new Map(sourceDocuments.map((document) => [document.sourcePath, document]));
  const context: ResolutionContext = {
    registry,
    registryDocumentsByPath: new Map(registry.documents.map((document) => [document.sourcePath, document])),
    corpusDocumentsByPath,
    resolvedByRegistryId: new Map(),
  };
  const queryKeys = new Set<string>();
  const queryIds = new Set<string>();
  const queries: EvaluationQueryV2[] = [];
  for (const question of questions) {
    let key: string;
    try {
      key = authoredKey(question.key, "question.key");
      if (queryKeys.has(key)) {
        throw new AuthoringFailure("duplicate-question-key", `Question key ${key} is duplicated.`, {
          queryKeys: [key],
        });
      }
      queryKeys.add(key);
      const compiled = compileQuestion(question, context);
      if (queryIds.has(compiled.id)) {
        throw new AuthoringFailure("opaque-id-collision", `Question ${key} collides with another opaque query ID.`, {
          queryKeys: [key],
        });
      }
      queryIds.add(compiled.id);
      queries.push(compiled);
    } catch (error) {
      const issue = issueFromFailure(error);
      errors.push(issue.queryKeys === undefined && typeof question.key === "string"
        ? Object.freeze({ ...issue, queryKeys: Object.freeze([question.key]) })
        : issue);
    }
  }
  queries.sort((left, right) => compareText(left.id, right.id));
  const resolvedEvidence = [...context.resolvedByRegistryId.values()]
    .toSorted((left, right) => compareText(left.corpusEvidenceUnitId, right.corpusEvidenceUnitId));
  const familyCheck = familyReview(sourceDocuments, registry, queries, resolvedEvidence);
  errors.push(...familyCheck.errors);
  warnings.push(...familyCheck.warnings);
  if (errors.length > 0) {
    return failedResult(diagnostics, errors, warnings, registry, resolvedEvidence);
  }

  try {
    const sourceFamiliesById = new Map<string, EvaluationSourceFamilyV2>();
    for (const document of sourceDocuments) {
      sourceFamiliesById.set(document.sourceFamilyId, Object.freeze({
        id: document.sourceFamilyId,
        sourceClass: document.sourceClass,
        trustClass: document.trustClass,
        ...(document.familyAssignmentSha256 === undefined
          ? {}
          : { familyAssignmentSha256: document.familyAssignmentSha256 }),
      }));
    }
    const documents: readonly EvaluationDocumentV2[] = Object.freeze(sourceDocuments.map((document) => Object.freeze({
      id: document.documentId,
      sourceFamilyId: document.sourceFamilyId,
      trustClass: document.trustClass,
      sourcePath: document.sourcePath,
    })).toSorted((left, right) => compareText(left.id, right.id)));
    const evidenceUnits: readonly EvaluationEvidenceUnitV2[] = Object.freeze(registry.units.map((unit) => {
      const source = corpusDocumentsByPath.get(unit.sourcePath);
      if (source === undefined) throw new Error(`Registry evidence lost source ${unit.sourcePath}.`);
      return evidenceUnitForCorpus(unit, source);
    }).toSorted((left, right) => compareText(left.id, right.id)));
    const testQueries = queries.filter(({ split }) => split === "test");
    const sourceFamilies = Object.freeze([...sourceFamiliesById.values()]
      .toSorted((left, right) => compareText(left.id, right.id)));
    const clusterIdByQuery = evaluationSourceFamilyClusterIdsV2(
      testQueries,
      documents,
      evidenceUnits,
      sourceFamilies,
    );
    const independentSourceFamilyClusters = new Set(testQueries
      .filter((query) => query.cohort === "caller-seeded" && query.expectedSupport === "supported")
      .map((query) => clusterIdByQuery.get(query.id))).size;
    diagnostics = promotionCorpusDiagnosticsV2(
      questions,
      input.experiment,
      input.reviewPolicy,
      independentSourceFamilyClusters,
    );
    if (
      !diagnostics.promotionLayoutReady
      && !warnings.some(({ code }) => code === "promotion-layout-not-ready")
    ) {
      warnings.push(Object.freeze({
        severity: "warning",
        code: "promotion-layout-not-ready",
        message: "The authored questions do not yet satisfy every exact promotion quota and independent-pair minimum.",
      }));
    }
    const sealed = sealRetrievalEvaluationCorpusV2({
      schemaVersion: RETRIEVAL_EVALUATION_V2_SCHEMA_VERSION,
      id: input.id,
      description: input.description,
      sealedAt: input.sealedAt,
      baselineRetrieverId: input.baselineRetrieverId,
      buildContractSha256: input.buildContractSha256,
      frozen: Object.freeze({
        repositoryCommit: input.frozen.repositoryCommit,
        vaultTree: input.frozen.vaultTree,
        vaultRoot: input.frozen.vaultRoot,
      }),
      assessment: Object.freeze({
        rubricVersion: input.assessment.rubricVersion,
        assessors: cloneAssessors(input.assessment.assessors),
      }),
      experiment: cloneExperiment(input.experiment),
      sourceFamilies,
      documents,
      evidenceUnits,
      measurementProfiles: cloneMeasurementProfiles(input.measurementProfiles),
      retrievers: cloneRetrievers(input.retrievers),
      queries: Object.freeze(queries),
    });
    const finalCorpus = options.expectedPromotionSeal === undefined
      ? sealed.corpus
      : validatePromotionCorpusV2(sealed.corpus, options.expectedPromotionSeal);
    const canonicalWarnings = canonicalIssues(warnings);
    return Object.freeze({
      ok: true,
      corpus: finalCorpus,
      externalSeal: sealed.externalSeal,
      evidenceRegistry: registry,
      resolvedEvidence: Object.freeze(resolvedEvidence),
      diagnostics,
      errors: Object.freeze([]),
      warnings: canonicalWarnings,
      reviewIssues: Object.freeze(canonicalWarnings.filter(({ code }) =>
        code.includes("prompt") || code.includes("ngram") || code.includes("source-family"))),
    });
  } catch (error) {
    errors.push(Object.freeze({
      ...issueFromFailure(error),
      code: options.expectedPromotionSeal === undefined ? "invalid-compiled-corpus" : "invalid-promotion-corpus",
    }));
    return failedResult(diagnostics, errors, warnings, registry, resolvedEvidence);
  }
}

/** Compile and enforce the exact reviewed 168-question promotion design. */
export function compilePromotionCorpusAuthoringV2(
  input: PromotionCorpusAuthoringInputV2,
  expectedSeal: EvaluationExternalCorpusSealV2,
): PromotionCorpusCompilationResultV2 {
  return compileRetrievalEvaluationCorpusAuthoringV2(input, { expectedPromotionSeal: expectedSeal });
}
