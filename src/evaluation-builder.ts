#!/usr/bin/env bun

import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  link,
  lstat,
  open,
  realpath,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { z } from "zod";

import {
  compilePromotionCorpusAuthoringV2,
  compileRetrievalEvaluationCorpusAuthoringV2,
  type HumanAuthoredEvaluationQuestionV2,
  type PromotionCorpusAuthoringInputV2,
  type PromotionCorpusCompilationResultV2,
  type PromotionCorpusMarkdownDocumentV2,
} from "./evaluation-corpus-authoring.js";
import {
  EVALUATION_EVIDENCE_PARSER_VERSION,
  MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES,
  MAX_EVALUATION_EVIDENCE_DOCUMENTS,
  MAX_EVALUATION_EVIDENCE_TOTAL_BYTES,
} from "./evaluation-evidence.js";
import { evaluationImplementationArtifactSha256V2 } from "./evaluation-implementation.js";
import {
  runGitCommand,
  type GitCommandProvider,
  type GitCommandResult,
} from "./git.js";
import {
  MAX_EVALUATION_V2_QUERIES,
  parseRetrievalEvaluationCorpusV2,
  validatePromotionCorpusDesignV2,
  type EvaluationExternalCorpusSealV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

const AUTHORING_DIRECTORY = "kb/evaluations/kb-evidence-routing-v2";
const MAX_CONFIG_BYTES = 1 * 1_024 * 1_024;
const MAX_SHARDS = 64;
const MAX_SHARD_BYTES = 16 * 1_024 * 1_024;
const MAX_TOTAL_SHARD_BYTES = 64 * 1_024 * 1_024;
const MAX_OUTPUT_BYTES = 256 * 1_024 * 1_024;
const MAX_IMPLEMENTATION_SOURCE_BYTES = 4 * 1_024 * 1_024;
const MAX_IMPLEMENTATION_SOURCES_PER_RETRIEVER = 32;
const MAX_IMPLEMENTATION_SOURCE_BINDINGS = 64;
const FROZEN_GIT_TIMEOUT_MS = 30_000;
const FROZEN_GIT_METADATA_BYTES = 64 * 1_024;
const MAX_VAULT_LIST_BYTES = 4 * 1_024 * 1_024;
const MAX_JSON_STRING_BYTES = 1 * 1_024 * 1_024;
const MAX_SOURCE_FAMILY_RATIONALE_BYTES = 2_048;
const MAX_SOURCE_FAMILY_REVIEWERS = 32;
const MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES = 256;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

const sourceClassSchema = z.enum([
  "authored-note",
  "captured-source",
  "git-history",
  "repository-file",
]);
const trustClassSchema = z.enum([
  "authoritative-current",
  "authoritative-historical",
  "captured-primary",
  "captured-secondary",
  "maintained-synthesis",
  "untrusted-capture",
]);
const evidenceKindSchema = z.enum([
  "frontmatter-field",
  "heading",
  "paragraph",
  "list",
  "table",
  "code-block",
  "pdf-page-span",
]);
const splitSchema = z.enum(["development", "test"]);
const cohortSchema = z.enum(["caller-seeded", "text-only"]);
const supportSchema = z.enum(["insufficient", "supported"]);
const negativeSubtypeSchema = z.enum([
  "boundary-near-miss",
  "conflicting-evidence",
  "missing-required-support",
  "stale-only",
  "topical-near-miss",
  "unknown-entity",
]);
const stratumSchema = z.enum([
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
const laneSchema = z.enum([
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
const inputLaneSchema = z.enum(["context", "graph", "history", "metadata", "noteId", "text"]);
const boundedStringSchema = z.string().refine(
  (value) => Buffer.byteLength(value, "utf8") <= MAX_JSON_STRING_BYTES,
  "string exceeds the authoring byte bound",
);
const nonEmptyStringSchema = boundedStringSchema.min(1);
const sourceFamilyReviewerIdSchema = nonEmptyStringSchema.refine(
  (value) => Buffer.byteLength(value, "utf8") <= MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES,
  `reviewer ID exceeds ${MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES} UTF-8 bytes`,
);
const sourceFamilyReviewerIdsSchema = z.array(sourceFamilyReviewerIdSchema)
  .min(2)
  .max(MAX_SOURCE_FAMILY_REVIEWERS)
  .refine((values) => new Set(values).size === values.length, "reviewer IDs must be distinct")
  .refine(
    (values) => values.every((value, index) => value === values.toSorted()[index]),
    "reviewer IDs must be in canonical order",
  );
const sourceFamilyRationaleSchema = z.string().refine(
  (value) => value.normalize("NFC") === value
    && value.trim() === value
    && !value.includes("\0")
    && Buffer.byteLength(value, "utf8") >= 24
    && Buffer.byteLength(value, "utf8") <= MAX_SOURCE_FAMILY_RATIONALE_BYTES,
  `rationale must be trimmed NFC text from 24 through ${MAX_SOURCE_FAMILY_RATIONALE_BYTES} UTF-8 bytes`,
);
const sha256Schema = z.string().regex(SHA256_PATTERN);
const gitObjectSchema = z.string().regex(GIT_OBJECT_PATTERN);
const relevanceSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const positiveIntegerSchema = z.number().int().positive().safe();
const nonNegativeIntegerSchema = z.number().int().nonnegative().safe();

const lineRangeSchema = z.strictObject({
  start: positiveIntegerSchema,
  end: positiveIntegerSchema,
});
const byteRangeSchema = z.strictObject({
  start: nonNegativeIntegerSchema,
  end: nonNegativeIntegerSchema,
});
const evidenceSelectorSchema = z.strictObject({
  sourcePath: nonEmptyStringSchema,
  kind: evidenceKindSchema.optional(),
  headingPath: z.array(boundedStringSchema).max(64).optional(),
  heading: boundedStringSchema.optional(),
  exactText: boundedStringSchema.optional(),
  lineRange: lineRangeSchema.optional(),
  expectedUnitId: nonEmptyStringSchema.optional(),
  expectedUnitSha256: sha256Schema.optional(),
  expectedSourceSha256: sha256Schema.optional(),
  expectedByteRange: byteRangeSchema.optional(),
});
const documentJudgmentSchema = z.strictObject({
  sourcePath: nonEmptyStringSchema,
  relevance: relevanceSchema,
});
const evidenceJudgmentSchema = z.strictObject({
  selector: evidenceSelectorSchema,
  relevance: relevanceSchema,
});
const supportSetSchema = z.strictObject({
  key: nonEmptyStringSchema,
  evidence: z.array(evidenceSelectorSchema).max(2_000),
});
const nuggetSchema = z.strictObject({
  key: nonEmptyStringSchema,
  text: boundedStringSchema,
  required: z.boolean(),
  acceptableSupportSets: z.array(supportSetSchema).max(100),
});
const goldSchema = z.strictObject({
  documents: z.array(documentJudgmentSchema).max(2_000),
  evidenceUnits: z.array(evidenceJudgmentSchema).max(2_000),
  nuggets: z.array(nuggetSchema).max(100),
});
const assessorNuggetSchema = z.strictObject({
  nuggetKey: nonEmptyStringSchema,
  required: z.boolean().optional(),
  acceptableSupportSetKeys: z.array(nonEmptyStringSchema).max(100),
});
const rawAssessmentSchema = z.strictObject({
  assessorId: nonEmptyStringSchema,
  expectedSupport: supportSchema,
  documents: z.array(documentJudgmentSchema).max(2_000),
  evidenceUnits: z.array(evidenceJudgmentSchema).max(2_000),
  nuggets: z.array(assessorNuggetSchema).max(100),
});
const adjudicationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("single-assessor") }),
  z.strictObject({ status: z.literal("agreed") }),
  z.strictObject({
    status: z.literal("resolved"),
    adjudicatorId: nonEmptyStringSchema,
    rationale: nonEmptyStringSchema,
  }),
]);
const metadataFilterSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("exists"), path: nonEmptyStringSchema }),
  z.strictObject({
    kind: z.literal("equals"),
    path: nonEmptyStringSchema,
    value: z.union([boundedStringSchema, z.number().finite(), z.boolean(), z.null()]),
  }),
]);
const retrievalInputsSchema = z.strictObject({
  text: boundedStringSchema,
  noteId: nonEmptyStringSchema.optional(),
  metadata: z.strictObject({
    filters: z.array(metadataFilterSchema).max(2_000),
    tags: z.array(nonEmptyStringSchema).max(2_000),
  }).optional(),
  graph: z.strictObject({
    seeds: z.array(nonEmptyStringSchema).max(2_000),
    depth: z.union([z.literal(1), z.literal(2)]),
  }).optional(),
  context: z.strictObject({ repositoryPath: nonEmptyStringSchema }).optional(),
  history: z.strictObject({
    query: boundedStringSchema,
    noteIds: z.array(nonEmptyStringSchema).max(2_000),
  }).optional(),
});
const inputOriginSchema = z.strictObject({
  lane: inputLaneSchema,
  origin: z.enum(["caller", "query-text"]),
});

export const humanAuthoredEvaluationQuestionV2Schema = z.strictObject({
  key: nonEmptyStringSchema,
  text: boundedStringSchema,
  split: splitSchema,
  cohort: cohortSchema,
  strata: z.array(stratumSchema).min(1).max(10),
  primaryStratum: stratumSchema,
  expectedSupport: supportSchema,
  primaryLane: laneSchema,
  negativeSubtype: negativeSubtypeSchema.optional(),
  inputs: retrievalInputsSchema,
  inputOrigins: z.array(inputOriginSchema).min(1).max(6),
  gold: goldSchema,
  rawAssessments: z.array(rawAssessmentSchema).min(1).max(32),
  adjudication: adjudicationSchema,
});

const authoringDocumentSchema = z.strictObject({
  documentId: nonEmptyStringSchema.optional(),
  sourcePath: nonEmptyStringSchema,
  sourceFamilyKey: nonEmptyStringSchema,
  sourceClass: sourceClassSchema,
  trustClass: trustClassSchema,
  sourceFamilyRationale: sourceFamilyRationaleSchema.optional(),
  sourceFamilyReviewerIds: sourceFamilyReviewerIdsSchema.optional(),
});

const reviewedAuthoringDocumentSchema = authoringDocumentSchema.extend({
  sourceFamilyRationale: sourceFamilyRationaleSchema,
  sourceFamilyReviewerIds: sourceFamilyReviewerIdsSchema,
});

export const kbEvidenceRoutingAuthoringShardSchema = z.strictObject({
  documents: z.array(authoringDocumentSchema).max(MAX_EVALUATION_EVIDENCE_DOCUMENTS),
  questions: z.array(humanAuthoredEvaluationQuestionV2Schema).min(1).max(MAX_EVALUATION_V2_QUERIES),
});

/**
 * Private question specifications deliberately exclude every final or per-assessor label.
 * assignedAssessorIds is the prospective completeness contract for the independent join.
 */
export const kbEvidenceRoutingPrivateQuestionSpecSchema = z.strictObject({
  key: nonEmptyStringSchema,
  text: boundedStringSchema,
  split: z.literal("test"),
  cohort: cohortSchema,
  strata: z.array(stratumSchema).min(1).max(10),
  primaryStratum: stratumSchema,
  primaryLane: laneSchema,
  negativeSubtype: negativeSubtypeSchema.optional(),
  inputs: retrievalInputsSchema,
  inputOrigins: z.array(inputOriginSchema).min(1).max(6),
  assignedAssessorIds: z.array(nonEmptyStringSchema).min(1).max(32),
});

const privateAssessorJudgmentSchema = z.strictObject({
  questionKey: nonEmptyStringSchema,
  questionSpecSha256: sha256Schema,
  questionSpecShardSha256: sha256Schema,
  expectedSupport: supportSchema,
  documents: z.array(documentJudgmentSchema).max(2_000),
  evidenceUnits: z.array(evidenceJudgmentSchema).max(2_000),
  nuggets: z.array(assessorNuggetSchema).max(100),
});

const privateAdjudicationSchema = z.strictObject({
  questionKey: nonEmptyStringSchema,
  questionSpecSha256: sha256Schema,
  questionSpecShardSha256: sha256Schema,
  expectedSupport: supportSchema,
  gold: goldSchema,
  adjudication: adjudicationSchema,
});

export const kbEvidenceRoutingPrivateQuestionSpecShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("question-specs"),
  buildContractSha256: sha256Schema,
  documents: z.array(reviewedAuthoringDocumentSchema).max(MAX_EVALUATION_EVIDENCE_DOCUMENTS),
  questions: z.array(kbEvidenceRoutingPrivateQuestionSpecSchema)
    .min(1)
    .max(MAX_EVALUATION_V2_QUERIES),
});

export const kbEvidenceRoutingPrivateAssessorJudgmentShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("assessor-judgments"),
  buildContractSha256: sha256Schema,
  assessorId: nonEmptyStringSchema,
  judgments: z.array(privateAssessorJudgmentSchema).min(1).max(MAX_EVALUATION_V2_QUERIES),
});

export const kbEvidenceRoutingPrivateAdjudicationShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("adjudications"),
  buildContractSha256: sha256Schema,
  adjudications: z.array(privateAdjudicationSchema).min(1).max(MAX_EVALUATION_V2_QUERIES),
});

export const kbEvidenceRoutingPrivateAuthoringShardSchema = z.discriminatedUnion("kind", [
  kbEvidenceRoutingPrivateQuestionSpecShardSchema,
  kbEvidenceRoutingPrivateAssessorJudgmentShardSchema,
  kbEvidenceRoutingPrivateAdjudicationShardSchema,
]);

const assessorSchema = z.strictObject({
  id: nonEmptyStringSchema,
  displayName: nonEmptyStringSchema.optional(),
  affiliation: nonEmptyStringSchema.optional(),
});
const minimumUsefulEffectSchema = z.strictObject({
  metric: z.enum([
    "document-recall-at-k",
    "evidence-recall-at-k",
    "false-abstention-rate",
    "no-answer-accuracy",
    "nugget-coverage",
  ]),
  cohort: z.enum(["caller-seeded", "text-only"]),
  minimumAbsoluteDifference: z.number().finite().nonnegative(),
});
const nonInferiorityMarginSchema = z.strictObject({
  metric: z.enum([
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
  ]),
  maximumAbsoluteRegression: z.number().finite().nonnegative(),
  maximumRelativeRegression: z.number().finite().nonnegative(),
});
const localModelSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("model"), id: nonEmptyStringSchema, sha256: sha256Schema }),
]);
const experimentSchema = z.strictObject({
  protocol: z.strictObject({
    minimumUsefulEffects: z.array(minimumUsefulEffectSchema).min(1).max(10),
    nonInferiorityMargins: z.array(nonInferiorityMarginSchema).min(1).max(32),
    contextCeilings: z.strictObject({
      utf8Bytes: positiveIntegerSchema,
      readerTokens: positiveIntegerSchema,
    }),
    pairedPower: z.strictObject({
      alpha: z.number().finite().positive().max(1),
      targetPower: z.number().finite().positive().max(1),
      assumedDiscordantRate: z.number().finite().positive().max(1),
      assumedEffect: z.number().finite().positive().max(1),
      minimumUsefulEffect: z.number().finite().positive().max(1),
      requiredPairs: positiveIntegerSchema,
    }),
  }),
  environment: z.strictObject({
    tokenizer: z.strictObject({ id: nonEmptyStringSchema, sha256: sha256Schema }),
    runtime: z.strictObject({ id: nonEmptyStringSchema, sha256: sha256Schema }),
    hardware: z.strictObject({ id: nonEmptyStringSchema }),
    localModel: localModelSchema,
    cache: z.strictObject({
      preparation: nonEmptyStringSchema,
      fingerprintSha256: sha256Schema,
    }),
    fourReaderBatch: z.strictObject({ id: nonEmptyStringSchema, sha256: sha256Schema }),
    incrementalMutation: z.strictObject({
      sourcePath: nonEmptyStringSchema,
      appendUtf8Sha256: sha256Schema,
      expectedPostMutationSha256: sha256Schema,
    }),
  }),
});
const measurementProfileSchema = z.strictObject({
  id: nonEmptyStringSchema,
  operation: z.enum(["cold-index", "four-reader-query", "incremental-update", "packing", "warm-query"]),
  scope: z.enum(["query", "retriever"]),
  cacheState: z.enum(["changed-generation", "cold", "not-applicable", "warm"]),
  concurrency: positiveIntegerSchema,
  repetitions: positiveIntegerSchema,
});
const retrieverConfigurationValueSchema = z.union([
  boundedStringSchema,
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const retrieverSchema = z.strictObject({
  id: nonEmptyStringSchema,
  role: z.enum(["ablation", "baseline", "candidate"]),
  version: nonEmptyStringSchema,
  implementationSha256: sha256Schema,
  lanes: z.array(laneSchema).min(1).max(9),
  configuration: z.record(z.string(), retrieverConfigurationValueSchema),
});
const implementationSourceBindingSchema = z.strictObject({
  retrieverId: nonEmptyStringSchema,
  sourcePaths: z.array(nonEmptyStringSchema)
    .min(1)
    .max(MAX_IMPLEMENTATION_SOURCES_PER_RETRIEVER),
});

export const kbEvidenceRoutingEvaluationBuildConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  repositoryRoot: nonEmptyStringSchema,
  id: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  sealedAt: nonEmptyStringSchema,
  frozen: z.strictObject({
    repositoryCommit: gitObjectSchema,
    vaultTree: gitObjectSchema,
    vaultRoot: nonEmptyStringSchema,
  }),
  assessment: z.strictObject({
    rubricVersion: nonEmptyStringSchema,
    assessors: z.array(assessorSchema).min(1).max(64),
  }),
  experiment: experimentSchema,
  measurementProfiles: z.array(measurementProfileSchema).min(1).max(32),
  retrievers: z.array(retrieverSchema).min(1).max(64),
  implementationSources: z.array(implementationSourceBindingSchema)
    .min(1)
    .max(MAX_IMPLEMENTATION_SOURCE_BINDINGS),
  baselineRetrieverId: nonEmptyStringSchema,
  evidenceParserVersion: nonEmptyStringSchema,
  reviewPolicy: z.strictObject({
    ngramSize: z.literal(3).optional(),
    crossSplitNgramThreshold: z.number().finite().positive().max(0.8).optional(),
    labelPredictabilityCeiling: z.number().finite().positive().max(0.65).optional(),
    sourceFamilyAssignment: z.strictObject({
      protocolId: nonEmptyStringSchema,
      protocolSha256: sha256Schema,
      reviewerIds: sourceFamilyReviewerIdsSchema,
    }),
  }),
  shards: z.strictObject({
    /** Development labels are visible in runtime A and may guide candidate selection. */
    development: z.array(nonEmptyStringSchema).min(1).max(MAX_SHARDS),
    /** Visible test-shaped material is QA only and can never support a promotion claim. */
    qa: z.array(nonEmptyStringSchema).max(MAX_SHARDS),
    /** Held-out labels live only under the separately supplied artifact-B root. */
    heldOut: z.array(nonEmptyStringSchema).max(MAX_SHARDS),
  }),
  outputs: z.strictObject({
    corpus: nonEmptyStringSchema,
    externalSeal: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
  }),
});

export type KbEvidenceRoutingAuthoringShard = z.infer<typeof kbEvidenceRoutingAuthoringShardSchema>;
export type KbEvidenceRoutingPrivateQuestionSpec = z.infer<
  typeof kbEvidenceRoutingPrivateQuestionSpecSchema
>;
export type KbEvidenceRoutingPrivateAuthoringShard = z.infer<
  typeof kbEvidenceRoutingPrivateAuthoringShardSchema
>;
export type KbEvidenceRoutingEvaluationBuildConfig = z.infer<
  typeof kbEvidenceRoutingEvaluationBuildConfigSchema
>;

export type KbEvidenceRoutingEvaluationShaSummary = {
  readonly schemaVersion: 1;
  readonly corpus: {
    readonly path: string;
    readonly byteLength: number;
    readonly outputSha256: string;
    readonly committedCorpusSha256: string;
  };
  readonly externalSeal: {
    readonly path: string;
    readonly byteLength: number;
    readonly outputSha256: string;
  };
  readonly authoring: {
    readonly configSha256: string;
    readonly shards: readonly {
      readonly path: string;
      readonly byteLength: number;
      readonly sha256: string;
    }[];
    readonly qaShards: readonly {
      readonly path: string;
      readonly byteLength: number;
      readonly sha256: string;
    }[];
    readonly sources: readonly {
      readonly sourcePath: string;
      readonly byteLength: number;
      readonly sha256: string;
    }[];
  };
  readonly counts: {
    readonly documents: number;
    readonly evidenceUnits: number;
    readonly questions: number;
  };
  readonly visibleReview: {
    readonly questions: number;
    readonly exactQuotaAndBalanceMet: boolean;
    readonly labelPredictabilityMet: boolean;
    readonly pairedPowerMet: boolean;
    readonly diagnosticsSha256: string;
  };
};

export const kbEvidenceRoutingEvaluationShaSummarySchema = z.strictObject({
  schemaVersion: z.literal(1),
  corpus: z.strictObject({
    path: nonEmptyStringSchema,
    byteLength: positiveIntegerSchema,
    outputSha256: sha256Schema,
    committedCorpusSha256: sha256Schema,
  }),
  externalSeal: z.strictObject({
    path: nonEmptyStringSchema,
    byteLength: positiveIntegerSchema,
    outputSha256: sha256Schema,
  }),
  authoring: z.strictObject({
    configSha256: sha256Schema,
    shards: z.array(z.strictObject({
      path: nonEmptyStringSchema,
      byteLength: positiveIntegerSchema,
      sha256: sha256Schema,
    })).max(MAX_SHARDS * 2),
    qaShards: z.array(z.strictObject({
      path: nonEmptyStringSchema,
      byteLength: positiveIntegerSchema,
      sha256: sha256Schema,
    })).max(MAX_SHARDS),
    sources: z.array(z.strictObject({
      sourcePath: nonEmptyStringSchema,
      byteLength: positiveIntegerSchema,
      sha256: sha256Schema,
    })).max(MAX_EVALUATION_EVIDENCE_DOCUMENTS),
  }),
  counts: z.strictObject({
    documents: positiveIntegerSchema,
    evidenceUnits: positiveIntegerSchema,
    questions: positiveIntegerSchema,
  }),
  visibleReview: z.strictObject({
    questions: positiveIntegerSchema,
    exactQuotaAndBalanceMet: z.boolean(),
    labelPredictabilityMet: z.boolean(),
    pairedPowerMet: z.boolean(),
    diagnosticsSha256: sha256Schema,
  }),
});

export type LoadedKbEvidenceRoutingAuthoring = {
  readonly configPath: string;
  readonly configBytes: Buffer;
  readonly config: KbEvidenceRoutingEvaluationBuildConfig;
  readonly repositoryRoot: string;
  readonly input: PromotionCorpusAuthoringInputV2;
  readonly visibleReview: Extract<PromotionCorpusCompilationResultV2, { readonly ok: true }>;
  readonly shardFiles: readonly SecureFile[];
  readonly qaShardFiles: readonly SecureFile[];
  readonly sourceFiles: readonly SourceFile[];
  readonly artifactRoot?: string;
  readonly outputPaths: {
    readonly corpus: string;
    readonly externalSeal: string;
    readonly summary: string;
  };
};

export type BuildKbEvidenceRoutingEvaluationResult = {
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly externalSeal: Extract<EvaluationExternalCorpusSealV2, { readonly expectedCorpusSha256: string }>;
  readonly summary: KbEvidenceRoutingEvaluationShaSummary;
  readonly summaryOutputSha256: string;
  readonly installs: {
    readonly corpus: "installed" | "unchanged";
    readonly externalSeal: "preexisting";
    readonly summary: "installed" | "unchanged";
  };
};

export type ValidatedKbEvidenceRoutingEvaluationBuild = Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly externalSeal: Extract<
    EvaluationExternalCorpusSealV2,
    { readonly expectedCorpusSha256: string }
  >;
  readonly summary: KbEvidenceRoutingEvaluationShaSummary;
  readonly summaryOutputSha256: string;
}>;

export type KbEvidenceRoutingEvaluationBuildDependencies = {
  readonly runGit?: GitCommandProvider;
  /** Canonical, disjoint artifact-B root containing held-out shards and all outputs. */
  readonly artifactRoot?: string;
};

export type AnchorKbEvidenceRoutingEvaluationSealResult = {
  readonly externalSeal: Extract<EvaluationExternalCorpusSealV2, { readonly expectedCorpusSha256: string }>;
  readonly outputPath: string;
  readonly outputSha256: string;
  readonly install: "installed" | "unchanged";
};

type SecureFile = {
  readonly absolutePath: string;
  readonly relativePath?: string;
  readonly bytes: Buffer;
  readonly sha256: string;
};

type SourceFile = SecureFile & {
  readonly sourcePath: string;
  readonly markdown: string;
};

type FileIdentity = {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly nlink: number;
};

function formatZodError(error: z.ZodError, label: string): Error {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length === 0 ? label : `${label}.${issue.path.join(".")}`;
    return `${path}: ${issue.message}`;
  });
  return new Error(issues.join("\n"));
}

function parseSchema<S extends z.ZodType>(schema: S, value: unknown, label: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw formatZodError(result.error, label);
  return result.data;
}

function parseJson(bytes: Buffer, label: string): unknown {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8 JSON.`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const input = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(input).toSorted().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`;
  }
  throw new TypeError("Canonical JSON accepts only JSON values.");
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 of the exact canonical immutable build.json bytes. */
export function kbEvidenceRoutingBuildContractSha256(configBytes: Uint8Array): string {
  return sha256(configBytes);
}

/** Exact shared-spec commitment copied into each assessment and adjudication row. */
export function kbEvidenceRoutingPrivateQuestionSpecSha256(
  spec: KbEvidenceRoutingPrivateQuestionSpec,
): string {
  const checked = parseSchema(
    kbEvidenceRoutingPrivateQuestionSpecSchema,
    spec,
    "private question specification",
  );
  return sha256(canonicalJsonBytes(checked));
}

/**
 * Commits the exact shared pre-assessment artifact, including reviewed document
 * family assignments and the immutable build contract.
 */
export function kbEvidenceRoutingPrivateQuestionSpecShardSha256(
  shard: Extract<KbEvidenceRoutingPrivateAuthoringShard, { readonly kind: "question-specs" }>,
): string {
  const checked = parseSchema(
    kbEvidenceRoutingPrivateQuestionSpecShardSchema,
    shard,
    "private question-spec shard",
  );
  return sha256(canonicalJsonBytes(checked));
}

/** Digest an exact, canonically ordered implementation source manifest. */
export function kbEvidenceRoutingImplementationSha256(
  sources: readonly Readonly<{ readonly sourcePath: string; readonly bytes: Uint8Array }>[],
): string {
  return evaluationImplementationArtifactSha256V2(sources);
}

function gitResultBytes(result: Extract<GitCommandResult, { readonly status: "ok" }>): Buffer {
  return typeof result.stdout === "string" ? Buffer.from(result.stdout, "utf8") : Buffer.from(result.stdout);
}

async function requiredGitOutput(
  runGit: GitCommandProvider,
  repositoryRoot: string,
  arguments_: readonly string[],
  maximumBytes: number,
  label: string,
): Promise<Buffer> {
  const result = await runGit({
    arguments: arguments_,
    cwd: repositoryRoot,
    timeoutMs: FROZEN_GIT_TIMEOUT_MS,
    maxOutputBytes: maximumBytes,
  });
  if (result.status !== "ok") {
    throw new Error(`${label} could not be verified: ${result.message}`);
  }
  return gitResultBytes(result);
}

/**
 * Proves that every authoring source byte came from the digest-covered Git snapshot.
 * Authoring shards and generated outputs may live in later commits; evidence may not.
 */
export async function verifyKbEvidenceRoutingFrozenSources(
  loaded: LoadedKbEvidenceRoutingAuthoring,
  dependencies: KbEvidenceRoutingEvaluationBuildDependencies = {},
): Promise<void> {
  const runGit = dependencies.runGit ?? runGitCommand;
  const { frozen } = loaded.config;
  const resolvedCommit = (await requiredGitOutput(
    runGit,
    loaded.repositoryRoot,
    ["rev-parse", "--verify", `${frozen.repositoryCommit}^{commit}`],
    FROZEN_GIT_METADATA_BYTES,
    "Frozen repository commit",
  )).toString("utf8").trim();
  if (resolvedCommit !== frozen.repositoryCommit) {
    throw new Error(
      `Frozen repository commit resolved to ${resolvedCommit || "an empty value"}, expected ${frozen.repositoryCommit}.`,
    );
  }

  const vaultRevision = frozen.vaultRoot === "."
    ? `${frozen.repositoryCommit}^{tree}`
    : `${frozen.repositoryCommit}:${frozen.vaultRoot}`;
  const resolvedTree = (await requiredGitOutput(
    runGit,
    loaded.repositoryRoot,
    ["rev-parse", "--verify", vaultRevision],
    FROZEN_GIT_METADATA_BYTES,
    "Frozen vault tree",
  )).toString("utf8").trim();
  if (resolvedTree !== frozen.vaultTree) {
    throw new Error(
      `Frozen vault tree resolved to ${resolvedTree || "an empty value"}, expected ${frozen.vaultTree}.`,
    );
  }
  const objectType = (await requiredGitOutput(
    runGit,
    loaded.repositoryRoot,
    ["cat-file", "-t", vaultRevision],
    FROZEN_GIT_METADATA_BYTES,
    "Frozen vault object type",
  )).toString("utf8").trim();
  if (objectType !== "tree") throw new Error(`Frozen vault object must be a tree, received ${JSON.stringify(objectType)}.`);

  for (const source of loaded.sourceFiles) {
    const repositoryPath = frozen.vaultRoot === "."
      ? source.sourcePath
      : `${frozen.vaultRoot}/${source.sourcePath}`;
    const frozenBytes = await requiredGitOutput(
      runGit,
      loaded.repositoryRoot,
      ["show", `${frozen.repositoryCommit}:${repositoryPath}`],
      Math.min(
        MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES + 1,
        Math.max(source.bytes.byteLength + 1, 1),
      ),
      `Frozen Markdown ${source.sourcePath}`,
    );
    if (!frozenBytes.equals(source.bytes)) {
      throw new Error(`Frozen Markdown ${source.sourcePath} differs from the declared Git snapshot.`);
    }
  }

  const descriptorById = new Map(loaded.config.retrievers.map((descriptor) => [descriptor.id, descriptor]));
  const bindingsByRetriever = new Map<string, typeof loaded.config.implementationSources[number]>();
  for (const [bindingIndex, binding] of loaded.config.implementationSources.entries()) {
    if (!descriptorById.has(binding.retrieverId)) {
      throw new Error(`implementationSources[${bindingIndex}] names unknown retriever ${binding.retrieverId}.`);
    }
    if (bindingsByRetriever.has(binding.retrieverId)) {
      throw new Error(`implementationSources repeats retriever ${binding.retrieverId}.`);
    }
    const sourcePaths = binding.sourcePaths.map((sourcePath, sourceIndex) =>
      confinedRelativePath(sourcePath, `implementationSources[${bindingIndex}].sourcePaths[${sourceIndex}]`));
    const sortedPaths = sourcePaths.toSorted();
    if (sourcePaths.some((sourcePath, sourceIndex) => sourcePath !== sortedPaths[sourceIndex])) {
      throw new Error(`implementationSources[${bindingIndex}].sourcePaths must be in canonical order.`);
    }
    assertNoDuplicates(sourcePaths, `implementationSources[${bindingIndex}].sourcePaths`);
    bindingsByRetriever.set(binding.retrieverId, binding);
  }
  const missingBindings = [...descriptorById.keys()]
    .filter((retrieverId) => !bindingsByRetriever.has(retrieverId))
    .toSorted();
  if (missingBindings.length > 0) {
    throw new Error(`Implementation sources are missing for retrievers: ${missingBindings.join(", ")}.`);
  }

  for (const retrieverId of [...descriptorById.keys()].toSorted()) {
    const descriptor = descriptorById.get(retrieverId);
    const binding = bindingsByRetriever.get(retrieverId);
    if (descriptor === undefined || binding === undefined) throw new Error(`Lost retriever binding ${retrieverId}.`);
    const sources = [];
    for (const sourcePath of binding.sourcePaths) {
      const bytes = await requiredGitOutput(
        runGit,
        loaded.repositoryRoot,
        ["show", `${frozen.repositoryCommit}:${sourcePath}`],
        MAX_IMPLEMENTATION_SOURCE_BYTES,
        `Frozen implementation source ${sourcePath}`,
      );
      sources.push({ sourcePath, bytes });
    }
    const actual = kbEvidenceRoutingImplementationSha256(sources);
    if (actual !== descriptor.implementationSha256) {
      throw new Error(
        `Retriever ${retrieverId} implementation digest ${descriptor.implementationSha256} does not match frozen source digest ${actual}.`,
      );
    }
  }
}

function confinedRelativePath(value: string, label: string): string {
  if (
    value === ""
    || value.normalize("NFC") !== value
    || /[\0\r\n\\]/u.test(value)
    || value.startsWith("/")
    || value.startsWith("./")
    || /^[a-z]:[\\/]/iu.test(value)
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a canonical confined repository-relative path.`);
  }
  return value;
}

function identity(stat: {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly nlink: number;
}): FileIdentity {
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    nlink: stat.nlink,
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.nlink === right.nlink;
}

async function readBounded(handle: FileHandle, maximumBytes: number, label: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const remaining = maximumBytes + 1 - total;
    if (remaining <= 0) throw new Error(`${label} exceeds ${maximumBytes} bytes.`);
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1_024, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }
  return Buffer.concat(chunks, total);
}

async function assertRepositoryComponents(
  root: string,
  relativePath: string,
  finalKind: "file" | "directory" | "optional-file",
): Promise<void> {
  const parts = relativePath.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = resolve(current, parts[index] ?? "");
    const final = index === parts.length - 1;
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (
        final
        && finalKind === "optional-file"
        && typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT"
      ) return;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Path ${relativePath} traverses symbolic link ${current}.`);
    if (!final && !stat.isDirectory()) {
      throw new Error(`Path ${relativePath} traverses non-directory ${current}.`);
    }
    if (final && finalKind === "directory" && !stat.isDirectory()) {
      throw new Error(`Path ${relativePath} must resolve to a directory.`);
    }
    if (final && finalKind !== "directory" && !stat.isFile()) {
      throw new Error(`Path ${relativePath} must resolve to a regular file.`);
    }
    if (final && finalKind !== "directory" && stat.nlink !== 1) {
      throw new Error(`Path ${relativePath} must not be hard-linked (nlink=${stat.nlink}).`);
    }
  }
}

async function canonicalRepositoryRoot(input: string, configPath: string): Promise<string> {
  if (input.trim() === "" || /[\0\r\n]/u.test(input)) {
    throw new Error("repositoryRoot must be a non-empty local path.");
  }
  const lexical = isAbsolute(input) ? resolve(input) : resolve(dirname(configPath), input);
  const stat = await lstat(lexical);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("repositoryRoot must name a real directory, not a symbolic link.");
  }
  return realpath(lexical);
}

function pathContains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function canonicalArtifactRoot(input: string | undefined, repositoryRoot: string): Promise<string> {
  if (input === undefined || input.trim() === "" || /[\0\r\n]/u.test(input)) {
    throw new Error("A separate artifact-B root is required.");
  }
  const lexical = resolve(input);
  const stat = await lstat(lexical);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("artifact-B root must name a real directory, not a symbolic link.");
  }
  const canonical = await realpath(lexical);
  if (pathContains(repositoryRoot, canonical) || pathContains(canonical, repositoryRoot)) {
    throw new Error("artifact-B root must be disjoint from runtime repository A.");
  }
  return canonical;
}

async function secureReadAbsoluteFile(
  absolutePath: string,
  maximumBytes: number,
  label: string,
  options: Readonly<{ readonly requireReadOnly?: boolean }> = {},
): Promise<SecureFile> {
  const before = await lstat(absolutePath);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error(`${label} must be a regular non-symlink file.`);
  if (before.nlink !== 1) throw new Error(`${label} must not be hard-linked (nlink=${before.nlink}).`);
  if (options.requireReadOnly === true && (before.mode & 0o222) !== 0) {
    throw new Error(`${label} must be read-only before it is accepted.`);
  }
  if (before.size > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes.`);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(absolutePath, flags);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1) throw new Error(`${label} changed before it was opened safely.`);
    if (options.requireReadOnly === true && (opened.mode & 0o222) !== 0) {
      throw new Error(`${label} became writable while it was opened.`);
    }
    const beforeIdentity = identity(opened);
    if (!sameIdentity(identity(before), beforeIdentity)) throw new Error(`${label} changed while it was opened.`);
    const bytes = await readBounded(handle, maximumBytes, label);
    const after = await handle.stat();
    if (!sameIdentity(beforeIdentity, identity(after)) || after.size !== bytes.byteLength) {
      throw new Error(`${label} changed while it was read.`);
    }
    if (options.requireReadOnly === true && (after.mode & 0o222) !== 0) {
      throw new Error(`${label} became writable while it was read.`);
    }
    return { absolutePath, bytes, sha256: sha256(bytes) };
  } finally {
    await handle.close();
  }
}

async function secureReadRepositoryFile(
  root: string,
  relativePathInput: string,
  maximumBytes: number,
  label: string,
): Promise<SecureFile> {
  const relativePath = confinedRelativePath(relativePathInput, label);
  await assertRepositoryComponents(root, relativePath, "file");
  const absolutePath = resolve(root, ...relativePath.split("/"));
  const canonical = await realpath(absolutePath);
  if (canonical !== absolutePath) throw new Error(`${label} resolves through a symbolic link.`);
  return {
    ...await secureReadAbsoluteFile(absolutePath, maximumBytes, label),
    relativePath,
  };
}

async function validateOutputPath(root: string, input: string, label: string): Promise<string> {
  const relativePath = confinedRelativePath(input, label);
  const parentRelative = dirname(relativePath).split(sep).join("/");
  if (parentRelative === ".") {
    // The repository root itself has already been checked.
  } else {
    await assertRepositoryComponents(root, parentRelative, "directory");
  }
  await assertRepositoryComponents(root, relativePath, "optional-file");
  return resolve(root, ...relativePath.split("/"));
}

function requireAuthoringPath(path: string, label: string): string {
  const canonical = confinedRelativePath(path, label);
  if (!canonical.startsWith(`${AUTHORING_DIRECTORY}/`) || !canonical.endsWith(".json")) {
    throw new Error(`${label} must be a JSON file under ${AUTHORING_DIRECTORY}/.`);
  }
  return canonical;
}

function requireHeldOutPath(path: string, label: string): string {
  const canonical = confinedRelativePath(path, label);
  if (!canonical.startsWith("held-out/") || !canonical.endsWith(".json")) {
    throw new Error(`${label} must be a JSON file under artifact-B held-out/.`);
  }
  return canonical;
}

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].toSorted();
}

function assertNoDuplicates(values: readonly string[], label: string): void {
  const repeated = duplicates(values);
  if (repeated.length > 0) throw new Error(`${label} contains duplicates: ${repeated.join(", ")}.`);
}

function normalizedPrompt(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function promptNgrams(text: string, size: number): ReadonlySet<string> {
  const tokens = normalizedPrompt(text).split(" ").filter((token) => token !== "");
  if (tokens.length === 0) return new Set();
  if (tokens.length < size) return new Set([tokens.join(" ")]);
  const grams = new Set<string>();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    grams.add(tokens.slice(index, index + size).join(" "));
  }
  return grams;
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function questionSourcePaths(
  question: KbEvidenceRoutingAuthoringShard["questions"][number],
): readonly string[] {
  return [...new Set([
    ...question.gold.documents.map(({ sourcePath }) => sourcePath),
    ...question.gold.evidenceUnits.map(({ selector }) => selector.sourcePath),
    ...question.gold.nuggets.flatMap(({ acceptableSupportSets }) =>
      acceptableSupportSets.flatMap(({ evidence }) => evidence.map(({ sourcePath }) => sourcePath))),
    ...question.rawAssessments.flatMap(({ documents }) =>
      documents.map(({ sourcePath }) => sourcePath)),
    ...question.rawAssessments.flatMap(({ evidenceUnits }) =>
      evidenceUnits.map(({ selector }) => selector.sourcePath)),
  ])].toSorted();
}

function promotionQuestion(
  question: KbEvidenceRoutingAuthoringShard["questions"][number],
): HumanAuthoredEvaluationQuestionV2 {
  const { negativeSubtype, ...required } = question;
  const inputs = {
    ...(question.inputs.text === undefined ? {} : { text: question.inputs.text }),
    ...(question.inputs.noteId === undefined ? {} : { noteId: question.inputs.noteId }),
    ...(question.inputs.metadata === undefined ? {} : { metadata: question.inputs.metadata }),
    ...(question.inputs.graph === undefined ? {} : { graph: question.inputs.graph }),
    ...(question.inputs.context === undefined ? {} : { context: question.inputs.context }),
    ...(question.inputs.history === undefined ? {} : { history: question.inputs.history }),
  };
  const normalized = { ...required, inputs };
  const result = negativeSubtype === undefined
    ? normalized
    : { ...normalized, negativeSubtype };
  return result as unknown as HumanAuthoredEvaluationQuestionV2;
}

function privateJoinKey(questionKey: string, assessorId: string): string {
  return canonicalJson([questionKey, assessorId]);
}

function joinPrivateAuthoringShards(
  shards: readonly KbEvidenceRoutingPrivateAuthoringShard[],
  expectedBuildContractSha256: string,
  declaredAssessorIds: readonly string[],
  declaredSourceFamilyReviewerIds: readonly string[],
): readonly KbEvidenceRoutingAuthoringShard[] {
  if (shards.length === 0) return Object.freeze([]);

  const errors: string[] = [];
  const declaredAssessors = new Set(declaredAssessorIds);
  const declaredSourceFamilyReviewers = new Set(declaredSourceFamilyReviewerIds);
  const documents: KbEvidenceRoutingAuthoringShard["documents"][number][] = [];
  const specifications = new Map<string, KbEvidenceRoutingPrivateQuestionSpec>();
  const specificationShardSha256ByQuestionKey = new Map<string, string>();
  const questionSpecShardSha256ByFamilyKey = new Map<string, string>();
  const questionSpecShardSha256BySourcePath = new Map<string, string>();
  const judgments = new Map<
    string,
    Readonly<{
      assessorId: string;
      judgment: Extract<
        KbEvidenceRoutingPrivateAuthoringShard,
        { readonly kind: "assessor-judgments" }
      >["judgments"][number];
    }>
  >();
  const adjudications = new Map<
    string,
    Extract<KbEvidenceRoutingPrivateAuthoringShard, { readonly kind: "adjudications" }>[
      "adjudications"
    ][number]
  >();

  for (const [shardIndex, shard] of shards.entries()) {
    if (shard.buildContractSha256 !== expectedBuildContractSha256) {
      errors.push(
        `Private shard ${shardIndex} (${shard.kind}) buildContractSha256 ${shard.buildContractSha256} does not match exact build config ${expectedBuildContractSha256}.`,
      );
    }
    if (shard.kind === "question-specs") {
      const questionSpecShardSha256 = kbEvidenceRoutingPrivateQuestionSpecShardSha256(shard);
      documents.push(...shard.documents);
      for (const document of shard.documents) {
        const familyOwner = questionSpecShardSha256ByFamilyKey.get(document.sourceFamilyKey);
        if (familyOwner !== undefined && familyOwner !== questionSpecShardSha256) {
          errors.push(
            `Private source family ${document.sourceFamilyKey} spans more than one question-spec shard.`,
          );
        } else {
          questionSpecShardSha256ByFamilyKey.set(
            document.sourceFamilyKey,
            questionSpecShardSha256,
          );
        }
        const sourceOwner = questionSpecShardSha256BySourcePath.get(document.sourcePath);
        if (sourceOwner !== undefined && sourceOwner !== questionSpecShardSha256) {
          errors.push(
            `Private source path ${document.sourcePath} spans more than one question-spec shard.`,
          );
        } else {
          questionSpecShardSha256BySourcePath.set(document.sourcePath, questionSpecShardSha256);
        }
        const undeclaredReviewers = document.sourceFamilyReviewerIds
          .filter((reviewerId) => !declaredSourceFamilyReviewers.has(reviewerId));
        if (undeclaredReviewers.length > 0) {
          errors.push(
            `Private source family ${document.sourceFamilyKey} names undeclared assignment reviewers: ${undeclaredReviewers.toSorted().join(", ")}.`,
          );
        }
      }
      for (const specification of shard.questions) {
        if (specifications.has(specification.key)) {
          errors.push(`Private question specification ${specification.key} is ambiguous because it appears more than once.`);
          continue;
        }
        specifications.set(specification.key, specification);
        specificationShardSha256ByQuestionKey.set(specification.key, questionSpecShardSha256);
        const duplicateAssessorIds = duplicates(specification.assignedAssessorIds);
        if (duplicateAssessorIds.length > 0) {
          errors.push(
            `Private question ${specification.key} repeats assigned assessors: ${duplicateAssessorIds.join(", ")}.`,
          );
        }
        const canonicalAssessorIds = specification.assignedAssessorIds.toSorted();
        if (specification.assignedAssessorIds.some((assessorId, index) =>
          assessorId !== canonicalAssessorIds[index])) {
          errors.push(`Private question ${specification.key} assignedAssessorIds must be in canonical order.`);
        }
        const undeclared = specification.assignedAssessorIds
          .filter((assessorId) => !declaredAssessors.has(assessorId))
          .toSorted();
        if (undeclared.length > 0) {
          errors.push(`Private question ${specification.key} assigns undeclared assessors: ${undeclared.join(", ")}.`);
        }
      }
      continue;
    }
    if (shard.kind === "assessor-judgments") {
      if (!declaredAssessors.has(shard.assessorId)) {
        errors.push(`Private assessor-judgment shard names undeclared assessor ${shard.assessorId}.`);
      }
      for (const judgment of shard.judgments) {
        const key = privateJoinKey(judgment.questionKey, shard.assessorId);
        if (judgments.has(key)) {
          errors.push(
            `Private judgment (${judgment.questionKey}, ${shard.assessorId}) appears more than once.`,
          );
          continue;
        }
        judgments.set(key, Object.freeze({ assessorId: shard.assessorId, judgment }));
      }
      continue;
    }
    for (const adjudication of shard.adjudications) {
      if (adjudications.has(adjudication.questionKey)) {
        errors.push(`Private question ${adjudication.questionKey} has more than one adjudication.`);
        continue;
      }
      adjudications.set(adjudication.questionKey, adjudication);
    }
  }

  for (const { assessorId, judgment } of judgments.values()) {
    const { questionKey } = judgment;
    const specification = specifications.get(questionKey);
    if (specification === undefined) {
      errors.push(`Private judgment (${questionKey}, ${assessorId}) has no shared question specification.`);
      continue;
    }
    if (!specification.assignedAssessorIds.includes(assessorId)) {
      errors.push(`Private judgment (${questionKey}, ${assessorId}) is extra; that assessor is not assigned.`);
    }
    const expectedSpecSha256 = kbEvidenceRoutingPrivateQuestionSpecSha256(specification);
    if (judgment.questionSpecSha256 !== expectedSpecSha256) {
      errors.push(
        `Private judgment (${questionKey}, ${assessorId}) questionSpecSha256 does not match the shared specification.`,
      );
    }
    const expectedShardSha256 = specificationShardSha256ByQuestionKey.get(questionKey);
    if (judgment.questionSpecShardSha256 !== expectedShardSha256) {
      errors.push(
        `Private judgment (${questionKey}, ${assessorId}) questionSpecShardSha256 does not match the shared question-spec shard.`,
      );
    }
  }

  for (const [questionKey, adjudication] of adjudications) {
    const specification = specifications.get(questionKey);
    if (specification === undefined) {
      errors.push(`Private adjudication ${questionKey} has no shared question specification.`);
      continue;
    }
    const expectedSpecSha256 = kbEvidenceRoutingPrivateQuestionSpecSha256(specification);
    if (adjudication.questionSpecSha256 !== expectedSpecSha256) {
      errors.push(`Private adjudication ${questionKey} questionSpecSha256 does not match the shared specification.`);
    }
    const expectedShardSha256 = specificationShardSha256ByQuestionKey.get(questionKey);
    if (adjudication.questionSpecShardSha256 !== expectedShardSha256) {
      errors.push(
        `Private adjudication ${questionKey} questionSpecShardSha256 does not match the shared question-spec shard.`,
      );
    }
  }

  for (const [questionKey, specification] of specifications) {
    for (const assessorId of specification.assignedAssessorIds) {
      if (!judgments.has(privateJoinKey(questionKey, assessorId))) {
        errors.push(`Private question ${questionKey} is missing judgment from assigned assessor ${assessorId}.`);
      }
    }
    if (!adjudications.has(questionKey)) {
      errors.push(`Private question ${questionKey} is missing its adjudication.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Private held-out join failed:\n${[...new Set(errors)].toSorted().join("\n")}`);
  }

  const questions = [...specifications.values()]
    .toSorted((left, right) => left.key.localeCompare(right.key))
    .map((specification): KbEvidenceRoutingAuthoringShard["questions"][number] => {
      const { assignedAssessorIds, ...shared } = specification;
      const finalJudgment = adjudications.get(specification.key);
      if (finalJudgment === undefined) throw new Error(`Lost private adjudication ${specification.key}.`);
      const rawAssessments = assignedAssessorIds.map((assessorId) => {
        const binding = judgments.get(privateJoinKey(specification.key, assessorId));
        if (binding === undefined) {
          throw new Error(`Lost private judgment (${specification.key}, ${assessorId}).`);
        }
        const { judgment } = binding;
        return {
          assessorId,
          expectedSupport: judgment.expectedSupport,
          documents: judgment.documents,
          evidenceUnits: judgment.evidenceUnits,
          nuggets: judgment.nuggets,
        };
      });
      return {
        ...shared,
        expectedSupport: finalJudgment.expectedSupport,
        gold: finalJudgment.gold,
        rawAssessments,
        adjudication: finalJudgment.adjudication,
      };
    });
  for (const question of questions) {
    const questionShardSha256 = specificationShardSha256ByQuestionKey.get(question.key);
    if (questionShardSha256 === undefined) continue;
    for (const sourcePath of questionSourcePaths(question)) {
      const sourceShardSha256 = questionSpecShardSha256BySourcePath.get(sourcePath);
      if (sourceShardSha256 !== undefined && sourceShardSha256 !== questionShardSha256) {
        errors.push(
          `Private question ${question.key} references source ${sourcePath} owned by a different question-spec shard.`,
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Private held-out join failed:\n${[...new Set(errors)].toSorted().join("\n")}`);
  }
  return Object.freeze([{
    documents: documents.toSorted((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    questions,
  }]);
}

function assertExplicitPromotionQuestionDocuments(
  questions: readonly KbEvidenceRoutingAuthoringShard["questions"][number][],
  metadataByPath: ReadonlyMap<string, KbEvidenceRoutingAuthoringShard["documents"][number]>,
): void {
  const questionKeysByPath = new Map<string, Set<string>>();
  for (const question of questions) {
    for (const sourcePathInput of questionSourcePaths(question)) {
      const sourcePath = confinedRelativePath(
        sourcePathInput,
        `promotion question ${question.key} source path`,
      );
      const questionKeys = questionKeysByPath.get(sourcePath) ?? new Set<string>();
      questionKeys.add(question.key);
      questionKeysByPath.set(sourcePath, questionKeys);
    }
  }
  const missing = [...questionKeysByPath]
    .filter(([sourcePath]) => !metadataByPath.has(sourcePath))
    .map(([sourcePath, questionKeys]) => `${sourcePath} (${[...questionKeys].toSorted().join(", ")})`)
    .toSorted();
  const reserved = [...questionKeysByPath.keys()]
    .filter((sourcePath) => metadataByPath.get(sourcePath)?.sourceFamilyKey.startsWith("catalog:"))
    .toSorted();
  if (missing.length === 0 && reserved.length === 0) return;
  throw new Error([
    "Promotion question sources require explicit reviewed document metadata and sourceFamilyKey; inferred catalog metadata is catalog-only.",
    ...(missing.length === 0 ? [] : [`Missing reviewed documents: ${missing.join("; ")}.`]),
    ...(reserved.length === 0
      ? []
      : [`Reviewed promotion sources must not use the reserved catalog: family prefix: ${reserved.join(", ")}.`]),
  ].join("\n"));
}

type IsolationPartition = Readonly<{
  readonly questions: readonly KbEvidenceRoutingAuthoringShard["questions"][number][];
  readonly sourcePaths: ReadonlySet<string>;
  readonly sourceFamilies: ReadonlySet<string>;
}>;

function isolationPartition(
  shards: readonly KbEvidenceRoutingAuthoringShard[],
  label: string,
): IsolationPartition {
  const questions = shards.flatMap(({ questions: shardQuestions }) => shardQuestions);
  const familyByPath = new Map<string, string>();
  for (const [documentIndex, document] of shards.flatMap(({ documents }) => documents).entries()) {
    const sourcePath = confinedRelativePath(
      document.sourcePath,
      `${label}.documents[${documentIndex}].sourcePath`,
    );
    const previous = familyByPath.get(sourcePath);
    if (previous !== undefined && previous !== document.sourceFamilyKey) {
      throw new Error(
        `${label} assigns source path ${sourcePath} to conflicting source families ${previous} and ${document.sourceFamilyKey}.`,
      );
    }
    familyByPath.set(sourcePath, document.sourceFamilyKey);
  }
  const sourcePaths = new Set(familyByPath.keys());
  for (const question of questions) {
    for (const sourcePathInput of questionSourcePaths(question)) {
      sourcePaths.add(confinedRelativePath(
        sourcePathInput,
        `${label} question ${question.key} source path`,
      ));
    }
  }
  const sourceFamilies = new Set([...sourcePaths].map((sourcePath) =>
    familyByPath.get(sourcePath) ?? `catalog:${sourcePath}`));
  return Object.freeze({
    questions: Object.freeze(questions),
    sourcePaths,
    sourceFamilies,
  });
}

function intersections(left: ReadonlySet<string>, right: ReadonlySet<string>): readonly string[] {
  return [...left].filter((value) => right.has(value)).toSorted();
}

/**
 * Keep every visible engineering input disjoint from the private promotion set.
 * QA participates in this review boundary but is intentionally absent from the
 * compiled/scored corpus assembled below.
 */
function assertVisibleHeldOutIsolation(options: Readonly<{
  readonly development: readonly KbEvidenceRoutingAuthoringShard[];
  readonly qa: readonly KbEvidenceRoutingAuthoringShard[];
  readonly heldOut: readonly KbEvidenceRoutingAuthoringShard[];
  readonly sourceSha256ByPath: ReadonlyMap<string, string>;
  readonly ngramSize: number;
  readonly crossSplitNgramThreshold: number;
}>): void {
  const visible = isolationPartition([...options.development, ...options.qa], "visible authoring");
  const heldOut = isolationPartition(options.heldOut, "private held-out authoring");
  const errors: string[] = [];

  const heldOutKeys = new Set(heldOut.questions.map(({ key }) => key));
  const repeatedKeys = [...new Set(visible.questions
    .map(({ key }) => key)
    .filter((key) => heldOutKeys.has(key)))].toSorted();
  if (repeatedKeys.length > 0) {
    errors.push(`Visible and private held-out question keys overlap: ${repeatedKeys.join(", ")}.`);
  }

  const visibleNormalized = new Map<string, string[]>();
  for (const question of visible.questions) {
    const normalized = normalizedPrompt(question.text);
    const keys = visibleNormalized.get(normalized) ?? [];
    keys.push(question.key);
    visibleNormalized.set(normalized, keys);
  }
  const heldOutNormalized = new Map<string, string[]>();
  for (const question of heldOut.questions) {
    const normalized = normalizedPrompt(question.text);
    const keys = heldOutNormalized.get(normalized) ?? [];
    keys.push(question.key);
    heldOutNormalized.set(normalized, keys);
  }
  for (const normalized of [...visibleNormalized.keys()].filter((value) =>
    value !== "" && heldOutNormalized.has(value)).toSorted()) {
    errors.push(
      `Visible questions ${(visibleNormalized.get(normalized) ?? []).toSorted().join(", ")} and private held-out questions ${(heldOutNormalized.get(normalized) ?? []).toSorted().join(", ")} share one normalized prompt.`,
    );
  }

  const visibleGrams = new Map(visible.questions.map((question) => [
    question,
    promptNgrams(question.text, options.ngramSize),
  ]));
  const heldOutGrams = new Map(heldOut.questions.map((question) => [
    question,
    promptNgrams(question.text, options.ngramSize),
  ]));
  for (const visibleQuestion of visible.questions) {
    for (const heldOutQuestion of heldOut.questions) {
      if (normalizedPrompt(visibleQuestion.text) === normalizedPrompt(heldOutQuestion.text)) continue;
      const overlap = jaccard(
        visibleGrams.get(visibleQuestion) ?? new Set(),
        heldOutGrams.get(heldOutQuestion) ?? new Set(),
      );
      if (overlap < options.crossSplitNgramThreshold) continue;
      errors.push(
        `Visible question ${visibleQuestion.key} and private held-out question ${heldOutQuestion.key} have ${overlap.toFixed(6)} ${options.ngramSize}-gram Jaccard overlap.`,
      );
    }
  }

  const repeatedPaths = intersections(visible.sourcePaths, heldOut.sourcePaths);
  if (repeatedPaths.length > 0) {
    errors.push(`Visible and private held-out source paths overlap: ${repeatedPaths.join(", ")}.`);
  }
  const repeatedFamilies = intersections(visible.sourceFamilies, heldOut.sourceFamilies);
  if (repeatedFamilies.length > 0) {
    errors.push(`Visible and private held-out source families overlap: ${repeatedFamilies.join(", ")}.`);
  }

  const visiblePathsBySha = new Map<string, string[]>();
  for (const sourcePath of visible.sourcePaths) {
    const digest = options.sourceSha256ByPath.get(sourcePath);
    if (digest === undefined) {
      errors.push(`Visible source path ${sourcePath} is absent from the frozen Markdown catalog.`);
      continue;
    }
    const paths = visiblePathsBySha.get(digest) ?? [];
    paths.push(sourcePath);
    visiblePathsBySha.set(digest, paths);
  }
  const heldOutPathsBySha = new Map<string, string[]>();
  for (const sourcePath of heldOut.sourcePaths) {
    const digest = options.sourceSha256ByPath.get(sourcePath);
    if (digest === undefined) {
      errors.push(`Private held-out source path ${sourcePath} is absent from the frozen Markdown catalog.`);
      continue;
    }
    const paths = heldOutPathsBySha.get(digest) ?? [];
    paths.push(sourcePath);
    heldOutPathsBySha.set(digest, paths);
  }
  for (const digest of [...visiblePathsBySha.keys()].filter((value) =>
    heldOutPathsBySha.has(value)).toSorted()) {
    errors.push(
      `Visible sources ${(visiblePathsBySha.get(digest) ?? []).toSorted().join(", ")} and private held-out sources ${(heldOutPathsBySha.get(digest) ?? []).toSorted().join(", ")} contain byte-identical frozen content (${digest}).`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Visible/private held-out isolation failed:\n${errors.toSorted().join("\n")}`);
  }
}

function compileOrThrow(
  input: PromotionCorpusAuthoringInputV2,
): Extract<PromotionCorpusCompilationResultV2, { readonly ok: true }> {
  const compilation = compileRetrievalEvaluationCorpusAuthoringV2(input);
  if (!compilation.ok) {
    throw new Error(compilation.errors.map(({ code, message }) => `${code}: ${message}`).join("\n"));
  }
  return compilation;
}

export function assertKbEvidenceRoutingVisibleReviewReady(
  diagnostics: Extract<
    PromotionCorpusCompilationResultV2,
    { readonly ok: true }
  >["diagnostics"],
): void {
  const failedQuotas = diagnostics.quotaLedger
    .filter(({ met }) => !met)
    .map(({ id }) => id)
    .toSorted();
  if (failedQuotas.length > 0 || !diagnostics.labelPredictability.met) {
    throw new Error([
      "Visible development and QA review is not ready.",
      ...(failedQuotas.length === 0
        ? []
        : [`Failed exact quota or balance rows: ${failedQuotas.join(", ")}.`]),
      ...(diagnostics.labelPredictability.met
        ? []
        : ["Prompt labels exceed the sealed text-only predictability ceiling."]),
      "Visible QA paired-power diagnostics remain review-only and are not promotion evidence.",
    ].join("\n"));
  }
}

function parseExternalSeal(input: unknown): Extract<
  EvaluationExternalCorpusSealV2,
  { readonly expectedCorpusSha256: string }
> {
  return parseSchema(
    z.strictObject({ expectedCorpusSha256: sha256Schema }),
    input,
    "external seal",
  );
}

async function loadConfig(configPathInput: string): Promise<{
  readonly configPath: string;
  readonly file: SecureFile;
  readonly config: KbEvidenceRoutingEvaluationBuildConfig;
}> {
  if (configPathInput.trim() === "") throw new Error("An explicit config path is required.");
  const configPath = resolve(configPathInput);
  if (await realpath(configPath) !== configPath) {
    throw new Error("build config path must be canonical and must not traverse a symbolic link.");
  }
  const file = await secureReadAbsoluteFile(
    configPath,
    MAX_CONFIG_BYTES,
    "build config",
    { requireReadOnly: true },
  );
  if (await realpath(configPath) !== configPath) {
    throw new Error("build config path changed or began traversing a symbolic link while it was read.");
  }
  const config = parseSchema(
    kbEvidenceRoutingEvaluationBuildConfigSchema,
    parseJson(file.bytes, "build config"),
    "build config",
  );
  if (!file.bytes.equals(canonicalJsonBytes(config))) {
    throw new Error("build config must contain the exact canonical JSON bytes for its parsed value.");
  }
  return { configPath, file, config };
}

async function frozenMarkdownPaths(
  config: KbEvidenceRoutingEvaluationBuildConfig,
  repositoryRoot: string,
  runGit: GitCommandProvider,
): Promise<readonly string[]> {
  const revision = config.frozen.vaultRoot === "."
    ? `${config.frozen.repositoryCommit}^{tree}`
    : `${config.frozen.repositoryCommit}:${config.frozen.vaultRoot}`;
  const bytes = await requiredGitOutput(
    runGit,
    repositoryRoot,
    ["ls-tree", "-r", "-z", "--name-only", revision],
    MAX_VAULT_LIST_BYTES,
    "Frozen vault Markdown catalog",
  );
  if (bytes.byteLength === 0 || bytes.at(-1) !== 0) {
    throw new Error("Frozen vault file catalog must be non-empty NUL-delimited Git output.");
  }
  const paths = bytes.subarray(0, -1).toString("utf8").split("\0")
    .map((path, index) => confinedRelativePath(path, `frozen vault entry ${index}`))
    .filter((path) => path.endsWith(".md"));
  assertNoDuplicates(paths, "Frozen vault Markdown paths");
  if (paths.length === 0 || paths.length > MAX_EVALUATION_EVIDENCE_DOCUMENTS) {
    throw new Error(
      `Frozen vault must contain from 1 through ${MAX_EVALUATION_EVIDENCE_DOCUMENTS} Markdown documents.`,
    );
  }
  return Object.freeze(paths.toSorted());
}

function derivedDocumentMetadata(sourcePath: string): KbEvidenceRoutingAuthoringShard["documents"][number] {
  const capture = sourcePath.startsWith("sources/");
  return Object.freeze({
    sourcePath,
    sourceFamilyKey: `catalog:${sourcePath}`,
    sourceClass: capture ? "captured-source" as const : "authored-note" as const,
    trustClass: capture ? "untrusted-capture" as const : "maintained-synthesis" as const,
  });
}

function partitionDocumentMetadata(
  shards: readonly KbEvidenceRoutingAuthoringShard[],
  label: string,
): ReadonlyMap<string, KbEvidenceRoutingAuthoringShard["documents"][number]> {
  const byPath = new Map<string, KbEvidenceRoutingAuthoringShard["documents"][number]>();
  for (const [index, metadata] of shards.flatMap(({ documents }) => documents).entries()) {
    const sourcePath = confinedRelativePath(metadata.sourcePath, `${label}.documents[${index}].sourcePath`);
    const previous = byPath.get(sourcePath);
    if (
      previous !== undefined
      && !canonicalJsonBytes(previous).equals(canonicalJsonBytes(metadata))
    ) throw new Error(`${label} gives source path ${sourcePath} conflicting document metadata.`);
    byPath.set(sourcePath, metadata);
  }
  return byPath;
}

async function readAuthoringShards(
  root: string,
  paths: readonly string[],
  label: string,
): Promise<{ readonly files: readonly SecureFile[]; readonly shards: readonly KbEvidenceRoutingAuthoringShard[] }> {
  let aggregateBytes = 0;
  const files: SecureFile[] = [];
  const shards: KbEvidenceRoutingAuthoringShard[] = [];
  for (const path of paths) {
    const file = await secureReadRepositoryFile(
      root,
      path,
      Math.min(MAX_SHARD_BYTES, MAX_TOTAL_SHARD_BYTES - aggregateBytes),
      `${label} ${path}`,
    );
    aggregateBytes += file.bytes.byteLength;
    if (aggregateBytes > MAX_TOTAL_SHARD_BYTES) {
      throw new Error(`${label} shards exceed ${MAX_TOTAL_SHARD_BYTES} aggregate bytes.`);
    }
    files.push(file);
    shards.push(parseSchema(
      kbEvidenceRoutingAuthoringShardSchema,
      parseJson(file.bytes, `${label} ${path}`),
      `${label} ${path}`,
    ));
  }
  return Object.freeze({ files: Object.freeze(files), shards: Object.freeze(shards) });
}

async function readPrivateAuthoringShards(
  root: string,
  paths: readonly string[],
  label: string,
): Promise<{
  readonly files: readonly SecureFile[];
  readonly shards: readonly KbEvidenceRoutingPrivateAuthoringShard[];
}> {
  let aggregateBytes = 0;
  const files: SecureFile[] = [];
  const shards: KbEvidenceRoutingPrivateAuthoringShard[] = [];
  for (const path of paths) {
    const file = await secureReadRepositoryFile(
      root,
      path,
      Math.min(MAX_SHARD_BYTES, MAX_TOTAL_SHARD_BYTES - aggregateBytes),
      `${label} ${path}`,
    );
    aggregateBytes += file.bytes.byteLength;
    if (aggregateBytes > MAX_TOTAL_SHARD_BYTES) {
      throw new Error(`${label} shards exceed ${MAX_TOTAL_SHARD_BYTES} aggregate bytes.`);
    }
    files.push(file);
    shards.push(parseSchema(
      kbEvidenceRoutingPrivateAuthoringShardSchema,
      parseJson(file.bytes, `${label} ${path}`),
      `${label} ${path}`,
    ));
  }
  return Object.freeze({ files: Object.freeze(files), shards: Object.freeze(shards) });
}

export async function loadKbEvidenceRoutingEvaluationAuthoring(
  configPathInput: string,
  dependencies: KbEvidenceRoutingEvaluationBuildDependencies = {},
): Promise<LoadedKbEvidenceRoutingAuthoring> {
  const loadedConfig = await loadConfig(configPathInput);
  const { config } = loadedConfig;
  const repositoryRoot = await canonicalRepositoryRoot(
    config.repositoryRoot,
    loadedConfig.configPath,
  );
  const artifactRoot = await canonicalArtifactRoot(dependencies.artifactRoot, repositoryRoot);
  const runGit = dependencies.runGit ?? runGitCommand;
  const vaultRoot = confinedRelativePath(config.frozen.vaultRoot, "frozen.vaultRoot");
  await assertRepositoryComponents(repositoryRoot, vaultRoot, "directory");

  const developmentPaths = config.shards.development.map((path, index) =>
    requireAuthoringPath(path, `shards.development[${index}]`));
  const qaPaths = config.shards.qa.map((path, index) =>
    requireAuthoringPath(path, `shards.qa[${index}]`));
  const heldOutPaths = config.shards.heldOut.map((path, index) =>
    requireHeldOutPath(path, `shards.heldOut[${index}]`));
  assertNoDuplicates(developmentPaths, "shards.development");
  assertNoDuplicates(qaPaths, "shards.qa");
  assertNoDuplicates(heldOutPaths, "shards.heldOut");
  assertNoDuplicates([...developmentPaths, ...qaPaths], "Visible development and QA shard paths");

  const [development, qa, heldOut] = await Promise.all([
    readAuthoringShards(repositoryRoot, developmentPaths, "development authoring shard"),
    readAuthoringShards(repositoryRoot, qaPaths, "QA authoring shard"),
    readPrivateAuthoringShards(artifactRoot, heldOutPaths, "held-out artifact-B shard"),
  ]);
  const totalShardBytes = [...development.files, ...qa.files, ...heldOut.files]
    .reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (totalShardBytes > MAX_TOTAL_SHARD_BYTES) {
    throw new Error(`All development, QA, and held-out shards exceed ${MAX_TOTAL_SHARD_BYTES} aggregate bytes.`);
  }
  const joinedHeldOutShards = joinPrivateAuthoringShards(
    heldOut.shards,
    kbEvidenceRoutingBuildContractSha256(loadedConfig.file.bytes),
    config.assessment.assessors.map(({ id }) => id),
    config.reviewPolicy.sourceFamilyAssignment.reviewerIds,
  );
  const shardFiles = Object.freeze([...development.files, ...heldOut.files]);
  const shards = Object.freeze([...development.shards, ...joinedHeldOutShards]);
  const shardPayloadFingerprints = [
    ...development.shards,
    ...qa.shards,
    ...heldOut.shards,
  ].map((shard) => sha256(canonicalJsonBytes(shard)));
  assertNoDuplicates(shardPayloadFingerprints, "Authoring shard payloads");

  const documentMetadata = shards.flatMap(({ documents }) => documents);
  const questions = shards.flatMap(({ questions }) => questions);
  if (questions.length === 0 || questions.length > MAX_EVALUATION_V2_QUERIES) {
    throw new Error(`Authoring shards must declare from 1 through ${MAX_EVALUATION_V2_QUERIES} questions.`);
  }
  assertNoDuplicates(documentMetadata.map(({ sourcePath }) => sourcePath), "Document source paths");
  for (const [index, metadata] of documentMetadata.entries()) {
    const sourcePath = confinedRelativePath(metadata.sourcePath, `documents[${index}].sourcePath`);
    if (!sourcePath.endsWith(".md")) {
      throw new Error(`documents[${index}].sourcePath must name a Markdown file.`);
    }
  }
  assertNoDuplicates(
    documentMetadata.flatMap(({ documentId }) => documentId === undefined ? [] : [documentId]),
    "Explicit document IDs",
  );
  assertNoDuplicates(questions.map(({ key }) => key), "Question keys");

  const metadataByPath = new Map(documentMetadata.map((metadata) => [metadata.sourcePath, metadata]));
  assertExplicitPromotionQuestionDocuments(questions, metadataByPath);
  const catalogPaths = await frozenMarkdownPaths(config, repositoryRoot, runGit);
  const missingDeclared = [...metadataByPath.keys()].filter((path) => !catalogPaths.includes(path)).toSorted();
  if (missingDeclared.length > 0) {
    throw new Error(`Authoring metadata names Markdown absent from the frozen vault: ${missingDeclared.join(", ")}.`);
  }
  let aggregateSourceBytes = 0;
  const sourceFiles: SourceFile[] = [];
  const documents: PromotionCorpusMarkdownDocumentV2[] = [];
  for (const sourcePath of catalogPaths) {
    const metadata = metadataByPath.get(sourcePath) ?? derivedDocumentMetadata(sourcePath);
    const repositoryPath = vaultRoot === "." ? sourcePath : `${vaultRoot}/${sourcePath}`;
    const bytes = await requiredGitOutput(
      runGit,
      repositoryRoot,
      ["show", `${config.frozen.repositoryCommit}:${repositoryPath}`],
      Math.min(MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES, MAX_EVALUATION_EVIDENCE_TOTAL_BYTES - aggregateSourceBytes),
      `frozen Markdown ${sourcePath}`,
    );
    const sourceFile: SecureFile = {
      absolutePath: `${config.frozen.repositoryCommit}:${repositoryPath}`,
      relativePath: repositoryPath,
      bytes,
      sha256: sha256(bytes),
    };
    aggregateSourceBytes += sourceFile.bytes.byteLength;
    if (aggregateSourceBytes > MAX_EVALUATION_EVIDENCE_TOTAL_BYTES) {
      throw new Error(`Frozen Markdown exceeds ${MAX_EVALUATION_EVIDENCE_TOTAL_BYTES} aggregate bytes.`);
    }
    let markdown: string;
    try {
      markdown = new TextDecoder("utf-8", { fatal: true }).decode(sourceFile.bytes);
    } catch {
      throw new Error(`Frozen Markdown ${sourcePath} is not valid UTF-8.`);
    }
    sourceFiles.push({ ...sourceFile, sourcePath, markdown });
    documents.push({
      ...(metadata.documentId === undefined ? {} : { documentId: metadata.documentId }),
      sourcePath,
      markdown,
      sourceFamilyKey: metadata.sourceFamilyKey,
      sourceClass: metadata.sourceClass,
      trustClass: metadata.trustClass,
      ...(metadata.sourceFamilyRationale === undefined
        ? {}
        : { sourceFamilyRationale: metadata.sourceFamilyRationale }),
      ...(metadata.sourceFamilyReviewerIds === undefined
        ? {}
        : { sourceFamilyReviewerIds: metadata.sourceFamilyReviewerIds }),
    });
  }

  assertVisibleHeldOutIsolation({
    development: development.shards,
    qa: qa.shards,
    heldOut: joinedHeldOutShards,
    sourceSha256ByPath: new Map(sourceFiles.map(({ sourcePath, sha256: digest }) => [
      sourcePath,
      digest,
    ])),
    ngramSize: config.reviewPolicy.ngramSize ?? 3,
    crossSplitNgramThreshold: config.reviewPolicy.crossSplitNgramThreshold ?? 0.8,
  });

  const outputRelativePaths = [
    config.outputs.corpus,
    config.outputs.externalSeal,
    config.outputs.summary,
  ].map((path, index) => confinedRelativePath(path, `outputs[${index}]`));
  assertNoDuplicates(outputRelativePaths, "Output paths");
  const occupiedInputs = new Set(heldOutPaths);
  for (const outputPath of outputRelativePaths) {
    if (occupiedInputs.has(outputPath)) {
      throw new Error(`Output path ${outputPath} collides with an authoring input.`);
    }
  }
  const [corpusOutput, sealOutput, summaryOutput] = await Promise.all(outputRelativePaths.map(
    (path, index) => validateOutputPath(artifactRoot, path, `outputs[${index}]`),
  ));
  if (corpusOutput === undefined || sealOutput === undefined || summaryOutput === undefined) {
    throw new Error("All three output paths are required.");
  }
  const configCanonicalPath = await realpath(loadedConfig.configPath);
  if ([corpusOutput, sealOutput, summaryOutput].includes(configCanonicalPath)) {
    throw new Error("An output path must not replace the checked build config.");
  }

  const reviewPolicy = {
    ...(config.reviewPolicy.ngramSize === undefined
      ? {}
      : { ngramSize: config.reviewPolicy.ngramSize }),
    ...(config.reviewPolicy.crossSplitNgramThreshold === undefined
      ? {}
      : { crossSplitNgramThreshold: config.reviewPolicy.crossSplitNgramThreshold }),
    ...(config.reviewPolicy.labelPredictabilityCeiling === undefined
      ? {}
      : { labelPredictabilityCeiling: config.reviewPolicy.labelPredictabilityCeiling }),
    sourceFamilyAssignment: config.reviewPolicy.sourceFamilyAssignment,
  };
  const input: PromotionCorpusAuthoringInputV2 = {
    id: config.id,
    description: config.description,
    sealedAt: config.sealedAt,
    buildContractSha256: kbEvidenceRoutingBuildContractSha256(loadedConfig.file.bytes),
    frozen: config.frozen,
    assessment: {
      rubricVersion: config.assessment.rubricVersion,
      assessors: config.assessment.assessors.map((assessor) => ({
        id: assessor.id,
        ...(assessor.displayName === undefined ? {} : { displayName: assessor.displayName }),
        ...(assessor.affiliation === undefined ? {} : { affiliation: assessor.affiliation }),
      })),
    },
    experiment: config.experiment,
    documents,
    questions: questions.map(promotionQuestion),
    measurementProfiles: config.measurementProfiles,
    retrievers: config.retrievers,
    baselineRetrieverId: config.baselineRetrieverId,
    evidenceParserVersion: config.evidenceParserVersion,
    reviewPolicy,
  };
  const visibleMetadataByPath = partitionDocumentMetadata(
    [...development.shards, ...qa.shards],
    "visible development and QA authoring",
  );
  const visibleDocuments = sourceFiles.map((source) => {
    const metadata = visibleMetadataByPath.get(source.sourcePath)
      ?? derivedDocumentMetadata(source.sourcePath);
    return {
      ...(metadata.documentId === undefined ? {} : { documentId: metadata.documentId }),
      sourcePath: source.sourcePath,
      markdown: source.markdown,
      sourceFamilyKey: metadata.sourceFamilyKey,
      sourceClass: metadata.sourceClass,
      trustClass: metadata.trustClass,
      ...(metadata.sourceFamilyRationale === undefined
        ? {}
        : { sourceFamilyRationale: metadata.sourceFamilyRationale }),
      ...(metadata.sourceFamilyReviewerIds === undefined
        ? {}
        : { sourceFamilyReviewerIds: metadata.sourceFamilyReviewerIds }),
    } satisfies PromotionCorpusMarkdownDocumentV2;
  });
  const visibleReview = compileOrThrow({
    ...input,
    documents: visibleDocuments,
    questions: [...development.shards, ...qa.shards]
      .flatMap(({ questions: visibleQuestions }) => visibleQuestions)
      .map(promotionQuestion),
  });

  return {
    configPath: loadedConfig.configPath,
    configBytes: loadedConfig.file.bytes,
    config,
    repositoryRoot,
    input,
    visibleReview,
    shardFiles,
    qaShardFiles: qa.files,
    sourceFiles,
    artifactRoot,
    outputPaths: {
      corpus: corpusOutput,
      externalSeal: sealOutput,
      summary: summaryOutput,
    },
  };
}

export async function compileKbEvidenceRoutingEvaluationAuthoring(
  configPath: string,
  dependencies: KbEvidenceRoutingEvaluationBuildDependencies = {},
): Promise<{
  readonly loaded: LoadedKbEvidenceRoutingAuthoring;
  readonly compilation: Extract<PromotionCorpusCompilationResultV2, { readonly ok: true }>;
}> {
  const loaded = await loadKbEvidenceRoutingEvaluationAuthoring(configPath, dependencies);
  return { loaded, compilation: compileOrThrow(loaded.input) };
}

async function existingOutputBytes(path: string, maximumBytes: number): Promise<Buffer | undefined> {
  try {
    return (await secureReadAbsoluteFile(path, maximumBytes, `existing output ${path}`)).bytes;
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) return undefined;
    throw error;
  }
}

async function assertInstallable(path: string, bytes: Buffer): Promise<"unchanged" | "missing"> {
  const existing = await existingOutputBytes(path, Math.max(MAX_OUTPUT_BYTES, bytes.byteLength));
  if (existing === undefined) return "missing";
  if (!existing.equals(bytes)) {
    throw new Error(`Refusing to overwrite non-identical output ${path}. Version the corpus or choose a new path.`);
  }
  return "unchanged";
}

async function writeTemporary(path: string, bytes: Buffer): Promise<string> {
  if (bytes.byteLength > MAX_OUTPUT_BYTES) throw new Error(`Output ${path} exceeds ${MAX_OUTPUT_BYTES} bytes.`);
  const temporaryPath = resolve(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  const handle = await open(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.chmod(0o644);
  } catch (error) {
    await handle.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return temporaryPath;
}

async function installNoReplace(path: string, bytes: Buffer): Promise<"installed" | "unchanged"> {
  const disposition = await assertInstallable(path, bytes);
  if (disposition === "unchanged") return disposition;
  const temporaryPath = await writeTemporary(path, bytes);
  try {
    try {
      await link(temporaryPath, path);
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "EEXIST"
      ) {
        const existing = await secureReadAbsoluteFile(path, MAX_OUTPUT_BYTES, `racing output ${path}`);
        if (!existing.bytes.equals(bytes)) {
          throw new Error(`Refusing to replace concurrently written non-identical output ${path}.`);
        }
        return "unchanged";
      }
      throw error;
    }
    return "installed";
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function readCanonicalCorpus(path: string): Promise<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly bytes: Buffer;
}> {
  const file = await secureReadAbsoluteFile(path, MAX_OUTPUT_BYTES, "persisted corpus");
  const corpus = parseRetrievalEvaluationCorpusV2(parseJson(file.bytes, "persisted corpus"), {
    claimPromotion: false,
  });
  const expected = canonicalJsonBytes(corpus);
  if (!file.bytes.equals(expected)) {
    throw new Error("Persisted corpus is not canonical JSON with one final newline.");
  }
  return { corpus, bytes: file.bytes };
}

async function readCanonicalSeal(path: string): Promise<{
  readonly seal: Extract<EvaluationExternalCorpusSealV2, { readonly expectedCorpusSha256: string }>;
  readonly bytes: Buffer;
}> {
  const file = await secureReadAbsoluteFile(path, MAX_OUTPUT_BYTES, "persisted external seal");
  const seal = parseExternalSeal(parseJson(file.bytes, "persisted external seal"));
  const expected = canonicalJsonBytes(seal);
  if (!file.bytes.equals(expected)) {
    throw new Error("Persisted external seal is not canonical JSON with one final newline.");
  }
  return { seal, bytes: file.bytes };
}

async function readCanonicalSummary(path: string): Promise<{
  readonly summary: KbEvidenceRoutingEvaluationShaSummary;
  readonly bytes: Buffer;
}> {
  const file = await secureReadAbsoluteFile(path, MAX_OUTPUT_BYTES, "persisted SHA summary");
  const summary = parseSchema(
    kbEvidenceRoutingEvaluationShaSummarySchema,
    parseJson(file.bytes, "persisted SHA summary"),
    "persisted SHA summary",
  );
  const expected = canonicalJsonBytes(summary);
  if (!file.bytes.equals(expected)) {
    throw new Error("Persisted SHA summary is not canonical JSON with one final newline.");
  }
  return { summary, bytes: file.bytes };
}

function shaSummary(
  loaded: LoadedKbEvidenceRoutingAuthoring,
  corpus: RetrievalEvaluationCorpusV2,
  corpusBytes: Buffer,
  sealBytes: Buffer,
): KbEvidenceRoutingEvaluationShaSummary {
  return {
    schemaVersion: 1,
    corpus: {
      path: loaded.config.outputs.corpus,
      byteLength: corpusBytes.byteLength,
      outputSha256: sha256(corpusBytes),
      committedCorpusSha256: corpus.manifest.corpusSha256,
    },
    externalSeal: {
      path: loaded.config.outputs.externalSeal,
      byteLength: sealBytes.byteLength,
      outputSha256: sha256(sealBytes),
    },
    authoring: {
      configSha256: kbEvidenceRoutingBuildContractSha256(loaded.configBytes),
      shards: loaded.shardFiles.map((file) => ({
        path: file.relativePath ?? file.absolutePath,
        byteLength: file.bytes.byteLength,
        sha256: file.sha256,
      })),
      qaShards: loaded.qaShardFiles.map((file) => ({
        path: file.relativePath ?? file.absolutePath,
        byteLength: file.bytes.byteLength,
        sha256: file.sha256,
      })),
      sources: loaded.sourceFiles.map((file) => ({
        sourcePath: file.sourcePath,
        byteLength: file.bytes.byteLength,
        sha256: file.sha256,
      })).toSorted((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    },
    counts: {
      documents: corpus.documents.length,
      evidenceUnits: corpus.evidenceUnits.length,
      questions: corpus.queries.length,
    },
    visibleReview: {
      questions: loaded.visibleReview.corpus.queries.length,
      exactQuotaAndBalanceMet: loaded.visibleReview.diagnostics.quotaLedger.every(({ met }) => met),
      labelPredictabilityMet: loaded.visibleReview.diagnostics.labelPredictability.met,
      pairedPowerMet: loaded.visibleReview.diagnostics.pairedPower.met,
      diagnosticsSha256: sha256(canonicalJsonBytes(loaded.visibleReview.diagnostics)),
    },
  };
}

type PersistedPromotionValidation = {
  readonly loaded: LoadedKbEvidenceRoutingAuthoring;
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly externalSeal: Extract<EvaluationExternalCorpusSealV2, { readonly expectedCorpusSha256: string }>;
  readonly corpusBytes: Buffer;
  readonly sealBytes: Buffer;
};

async function validatePersistedPromotion(
  configPath: string,
  expected?: Pick<LoadedKbEvidenceRoutingAuthoring, "configBytes" | "outputPaths">,
  dependencies: KbEvidenceRoutingEvaluationBuildDependencies = {},
): Promise<PersistedPromotionValidation> {
  // Re-read the checked config, every shard, and every Markdown source after the seal is
  // independently persisted. This makes an intervening gold or source edit fail promotion.
  const loaded = await loadKbEvidenceRoutingEvaluationAuthoring(configPath, dependencies);
  if (loaded.config.shards.qa.length > 0) {
    assertKbEvidenceRoutingVisibleReviewReady(loaded.visibleReview.diagnostics);
  }
  if (loaded.config.shards.heldOut.length === 0) {
    throw new Error("Promotion build requires held-out shards supplied only by artifact B.");
  }
  await verifyKbEvidenceRoutingFrozenSources(loaded, dependencies);
  if (expected !== undefined && !loaded.configBytes.equals(expected.configBytes)) {
    throw new Error("Build config changed after the corpus seal was persisted.");
  }
  if (
    expected !== undefined
    && (
      loaded.outputPaths.corpus !== expected.outputPaths.corpus
      || loaded.outputPaths.externalSeal !== expected.outputPaths.externalSeal
      || loaded.outputPaths.summary !== expected.outputPaths.summary
    )
  ) throw new Error("Output paths changed after the corpus seal was persisted.");

  const [persistedCorpus, persistedSeal] = await Promise.all([
    readCanonicalCorpus(loaded.outputPaths.corpus),
    readCanonicalSeal(loaded.outputPaths.externalSeal),
  ]);
  if (persistedSeal.seal.expectedCorpusSha256 !== persistedCorpus.corpus.manifest.corpusSha256) {
    throw new Error("Persisted external seal does not commit the persisted corpus.");
  }
  const promotion = compilePromotionCorpusAuthoringV2(loaded.input, persistedSeal.seal);
  if (!promotion.ok) {
    throw new Error(promotion.errors.map(({ code, message }) => `${code}: ${message}`).join("\n"));
  }
  const promotedBytes = canonicalJsonBytes(promotion.corpus);
  if (!promotedBytes.equals(persistedCorpus.bytes)) {
    throw new Error("Persisted corpus bytes differ from the independently validated promotion corpus.");
  }
  return {
    loaded,
    corpus: promotion.corpus,
    externalSeal: persistedSeal.seal,
    corpusBytes: persistedCorpus.bytes,
    sealBytes: persistedSeal.bytes,
  };
}

/** Revalidates persisted canonical bytes against freshly read authoring inputs and the external seal. */
export async function validatePersistedKbEvidenceRoutingPromotion(
  configPath: string,
  dependencies: KbEvidenceRoutingEvaluationBuildDependencies = {},
): Promise<Pick<PersistedPromotionValidation, "corpus" | "externalSeal">> {
  const validation = await validatePersistedPromotion(configPath, undefined, dependencies);
  return { corpus: validation.corpus, externalSeal: validation.externalSeal };
}

/**
 * Revalidate the complete immutable build, including the summary's commitments
 * to the freshly read config, visible QA, private labels, frozen sources, corpus,
 * and independently anchored seal.
 */
export async function validatePersistedKbEvidenceRoutingBuild(
  configPath: string,
  dependencies: KbEvidenceRoutingEvaluationBuildDependencies = {},
): Promise<ValidatedKbEvidenceRoutingEvaluationBuild> {
  const validation = await validatePersistedPromotion(configPath, undefined, dependencies);
  const persistedSummary = await readCanonicalSummary(validation.loaded.outputPaths.summary);
  const expectedSummary = shaSummary(
    validation.loaded,
    validation.corpus,
    validation.corpusBytes,
    validation.sealBytes,
  );
  const expectedBytes = canonicalJsonBytes(expectedSummary);
  if (!persistedSummary.bytes.equals(expectedBytes)) {
    throw new Error(
      "Persisted SHA summary differs from the freshly validated immutable build inputs.",
    );
  }
  return Object.freeze({
    corpus: validation.corpus,
    externalSeal: validation.externalSeal,
    summary: persistedSummary.summary,
    summaryOutputSha256: sha256(persistedSummary.bytes),
  });
}

/**
 * Atomically anchors the independently reviewed corpus digest in artifact B.
 * This step writes only the seal. It never installs corpus or summary outputs.
 */
export async function anchorKbEvidenceRoutingEvaluationSeal(
  configPath: string,
  dependencies: KbEvidenceRoutingEvaluationBuildDependencies = {},
): Promise<AnchorKbEvidenceRoutingEvaluationSealResult> {
  const loaded = await loadKbEvidenceRoutingEvaluationAuthoring(configPath, dependencies);
  if (loaded.config.shards.qa.length > 0) {
    assertKbEvidenceRoutingVisibleReviewReady(loaded.visibleReview.diagnostics);
  }
  if (loaded.config.shards.heldOut.length === 0) {
    throw new Error("Seal anchoring requires held-out shards supplied only by artifact B.");
  }
  await verifyKbEvidenceRoutingFrozenSources(loaded, dependencies);
  const compilation = compileOrThrow(loaded.input);
  if (!compilation.diagnostics.promotionLayoutReady) {
    throw new Error(
      "Seal anchoring requires a promotion-ready quota, label-predictability, and paired-power design.",
    );
  }
  validatePromotionCorpusDesignV2(compilation.corpus);
  const promotion = compilePromotionCorpusAuthoringV2(loaded.input, compilation.externalSeal);
  if (!promotion.ok) {
    throw new Error(promotion.errors.map(({ code, message }) => `${code}: ${message}`).join("\n"));
  }
  if (!canonicalJsonBytes(promotion.corpus).equals(canonicalJsonBytes(compilation.corpus))) {
    throw new Error("Promotion validation changed the corpus before seal anchoring.");
  }
  const sealBytes = canonicalJsonBytes(compilation.externalSeal);
  if (await existingOutputBytes(loaded.outputPaths.corpus, MAX_OUTPUT_BYTES) !== undefined) {
    throw new Error("Refusing to anchor a corpus seal after corpus output already exists.");
  }
  if (await existingOutputBytes(loaded.outputPaths.summary, MAX_OUTPUT_BYTES) !== undefined) {
    throw new Error("Refusing to anchor a corpus seal after summary output already exists.");
  }
  const install = await installNoReplace(loaded.outputPaths.externalSeal, sealBytes);
  const persisted = await readCanonicalSeal(loaded.outputPaths.externalSeal);
  if (!persisted.bytes.equals(sealBytes)) {
    throw new Error("Persisted external seal differs from the independently anchored canonical bytes.");
  }
  return Object.freeze({
    externalSeal: persisted.seal,
    outputPath: loaded.config.outputs.externalSeal,
    outputSha256: sha256(persisted.bytes),
    install,
  });
}

export async function buildKbEvidenceRoutingEvaluation(
  configPath: string,
  dependencies: KbEvidenceRoutingEvaluationBuildDependencies = {},
): Promise<BuildKbEvidenceRoutingEvaluationResult> {
  const loaded = await loadKbEvidenceRoutingEvaluationAuthoring(configPath, dependencies);
  if (loaded.config.shards.qa.length > 0) {
    assertKbEvidenceRoutingVisibleReviewReady(loaded.visibleReview.diagnostics);
  }
  if (loaded.config.shards.heldOut.length === 0) {
    throw new Error("Promotion build requires held-out shards supplied only by artifact B.");
  }
  await verifyKbEvidenceRoutingFrozenSources(loaded, dependencies);
  const first = { loaded, compilation: compileOrThrow(loaded.input) } as const;
  const corpusBytes = canonicalJsonBytes(first.compilation.corpus);
  let persistedSeal: Awaited<ReturnType<typeof readCanonicalSeal>>;
  try {
    persistedSeal = await readCanonicalSeal(first.loaded.outputPaths.externalSeal);
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      throw new Error("External corpus seal is absent. Run the independent --anchor-seal step first.");
    }
    throw error;
  }
  const promotion = compilePromotionCorpusAuthoringV2(first.loaded.input, persistedSeal.seal);
  if (!promotion.ok) {
    throw new Error(promotion.errors.map(({ code, message }) => `${code}: ${message}`).join("\n"));
  }
  const promotedBytes = canonicalJsonBytes(promotion.corpus);
  if (!promotedBytes.equals(corpusBytes)) {
    throw new Error("Promotion validation changed the compiled corpus bytes.");
  }

  // The normal build consumes an already anchored seal and never creates or replaces it.
  await assertInstallable(first.loaded.outputPaths.corpus, corpusBytes);
  const corpusInstall = await installNoReplace(first.loaded.outputPaths.corpus, corpusBytes);

  const validation = await validatePersistedPromotion(configPath, first.loaded, dependencies);

  const summary = shaSummary(
    validation.loaded,
    validation.corpus,
    validation.corpusBytes,
    validation.sealBytes,
  );
  const summaryBytes = canonicalJsonBytes(summary);
  const summaryInstall = await installNoReplace(validation.loaded.outputPaths.summary, summaryBytes);
  const rereadSummary = await secureReadAbsoluteFile(
    validation.loaded.outputPaths.summary,
    MAX_OUTPUT_BYTES,
    "persisted SHA summary",
  );
  if (!rereadSummary.bytes.equals(summaryBytes)) {
    throw new Error("Persisted SHA summary changed after atomic installation.");
  }

  return {
    corpus: validation.corpus,
    externalSeal: validation.externalSeal,
    summary,
    summaryOutputSha256: sha256(summaryBytes),
    installs: {
      corpus: corpusInstall,
      externalSeal: "preexisting",
      summary: summaryInstall,
    },
  };
}

export const kbEvidenceRoutingBuildUsage =
  "Usage: kb-evaluation-builder <--anchor-seal|--build> --config <checked-config.json> --artifact-root <artifact-B>";

export function parseKbEvidenceRoutingBuildCliArguments(arguments_: readonly string[]): {
  readonly mode: "anchor-seal" | "build";
  readonly configPath: string;
  readonly artifactRoot: string;
} {
  const mode = arguments_[0];
  const configPath = arguments_[2];
  const artifactRoot = arguments_[4];
  if (
    arguments_.length !== 5
    || (mode !== "--anchor-seal" && mode !== "--build")
    || arguments_[1] !== "--config"
    || arguments_[3] !== "--artifact-root"
    || configPath === undefined
    || configPath.trim() === ""
    || artifactRoot === undefined
    || artifactRoot.trim() === ""
  ) {
    throw new Error(kbEvidenceRoutingBuildUsage);
  }
  return Object.freeze({ mode: mode.slice(2) as "anchor-seal" | "build", configPath, artifactRoot });
}

export async function runKbEvidenceRoutingBuildCli(
  arguments_: readonly string[],
  dependencies: Pick<KbEvidenceRoutingEvaluationBuildDependencies, "runGit"> = {},
): Promise<AnchorKbEvidenceRoutingEvaluationSealResult | BuildKbEvidenceRoutingEvaluationResult> {
  const options = parseKbEvidenceRoutingBuildCliArguments(arguments_);
  if (options.mode === "anchor-seal") {
    const anchored = await anchorKbEvidenceRoutingEvaluationSeal(options.configPath, {
      artifactRoot: options.artifactRoot,
      ...dependencies,
    });
    console.log([
      `External seal ${anchored.install}: ${anchored.outputPath}`,
      `external-seal-output-sha256=${anchored.outputSha256}`,
      `committed-corpus-sha256=${anchored.externalSeal.expectedCorpusSha256}`,
    ].join("\n"));
    return anchored;
  }
  const result = await buildKbEvidenceRoutingEvaluation(options.configPath, {
    artifactRoot: options.artifactRoot,
    ...dependencies,
  });
  console.log([
    `Corpus ${result.installs.corpus}: ${result.summary.corpus.path}`,
    `corpus-output-sha256=${result.summary.corpus.outputSha256}`,
    `committed-corpus-sha256=${result.summary.corpus.committedCorpusSha256}`,
    `external-seal-output-sha256=${result.summary.externalSeal.outputSha256}`,
    `summary-output-sha256=${result.summaryOutputSha256}`,
  ].join("\n"));
  return result;
}

if (import.meta.main) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 1 && (arguments_[0] === "--help" || arguments_[0] === "-h")) {
    console.log(kbEvidenceRoutingBuildUsage);
  } else {
    await runKbEvidenceRoutingBuildCli(arguments_);
  }
}

export { EVALUATION_EVIDENCE_PARSER_VERSION };
export * from "./evaluation-analysis-v2.js";
export * from "./evaluation-corpus-authoring.js";
export * from "./evaluation-evidence.js";
export * from "./evaluation-execution-v2.js";
export * from "./evaluation-implementation.js";
export * from "./evaluation-kb-closure.js";
export * from "./evaluation-kb-runner-v2.js";
export * from "./evaluation-kb-v2.js";
export * from "./evaluation-measurement-v2.js";
export * from "./evaluation-packing-v2.js";
export * from "./evaluation-v2.js";
