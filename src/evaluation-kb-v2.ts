import {
  MAX_EVALUATION_DIAGNOSTICS,
  MAX_EVALUATION_EVIDENCE_BYTES,
  MAX_EVALUATION_RESULTS_PER_QUERY,
  type EvaluationDiagnostic,
  type EvaluationRetriever,
  type EvaluationRetrieverResult,
  type RetrievalEvaluationCorpus,
} from "./evaluation.js";
import {
  validateEvaluationEvidenceRegistry,
  type EvaluationEvidenceRegistry,
  type EvaluationEvidenceUnit,
} from "./evaluation-evidence.js";
import {
  assertEvaluationImplementationArtifactV2,
  type VerifiedEvaluationImplementationArtifactV2,
} from "./evaluation-implementation.js";
import {
  EXISTING_LANE_CLOSURE_FUSION,
  freezeExistingLaneClosureVariant,
  runExistingLaneClosure,
  type ExistingLaneClosureAccounting,
  type ExistingLaneClosureBackend,
  type ExistingLaneClosureBackends,
  type ExistingLaneClosureDiagnostic,
  type ExistingLaneClosureEvidenceLocator,
  type ExistingLaneClosureEvidenceRegistry,
  type ExistingLaneClosureExecutableInputs,
  type ExistingLaneClosureGitInput,
  type ExistingLaneClosureGraphInput,
  type ExistingLaneClosureHit,
  type ExistingLaneClosureHybridInput,
  type ExistingLaneClosureLaneId,
  type ExistingLaneClosureLaneResult,
  type ExistingLaneClosureMetadataInput,
  type ExistingLaneClosurePathContextInput,
  type ExistingLaneClosureResult,
  type ExistingLaneClosureVariant,
} from "./evaluation-kb-closure.js";
import {
  knowledgeBaseEvaluationRetrieverIds,
  openKnowledgeBaseEvaluation,
  type KnowledgeBaseEvaluation,
  type KnowledgeBaseEvaluationRetrieverId,
  type OpenKnowledgeBaseEvaluationOptions,
} from "./evaluation-kb.js";
import {
  MAX_EVALUATION_V2_RESULTS_PER_LANE,
  evaluationRetrieverDescriptorDigestV2,
  type EvaluationCandidateLockV2,
  type EvaluationCandidateDecisionV2,
  type EvaluationCandidateReasonV2,
  type EvaluationEvidenceLocatorV2,
  type EvaluationExecutionRequestV2,
  type EvaluationLaneIdV2,
  type EvaluationLaneOutcomeV2,
  type EvaluationRankedCandidateV2,
  type EvaluationRepeatedSampleV2,
  type EvaluationResourceAccountingV2,
  type EvaluationSourceClassV2,
  type EvaluationTrustClassV2,
  type EvaluationRetrieverDescriptorV2,
  type EvaluationRetrieverTraceV2,
  type EvaluationRetrieverV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

const SHA256 = /^[0-9a-f]{64}$/u;
const CANONICAL_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/iu;
const MAX_DESCRIPTOR_TEXT_BYTES = 16 * 1_024;
const MAX_DIAGNOSTIC_MESSAGE_BYTES = 16 * 1_024;

export const KNOWLEDGE_BASE_EVALUATION_ADAPTER_V2 = "evaluation-kb-v2";
export const KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 = 10;
export const KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2 = 5;
export const KNOWLEDGE_BASE_EVALUATION_EMBEDDING_NOT_INVOKED_V2 = Object.freeze({
  calls: 0,
  inputTokens: 0,
  durationMs: 0,
} as const);

export type KnowledgeBaseEvaluationDescriptorDefinitionV2 = Readonly<{
  readonly id: string;
  readonly role: EvaluationRetrieverDescriptorV2["role"];
  /** Authored, immutable implementation version. Never inferred from the ID or CLI state. */
  readonly version: string;
  /** Digest supplied by the corpus author for the exact implementation under evaluation. */
  readonly implementationSha256: string;
  readonly retrieveLimit: number;
}>;

export type KnowledgeBaseEvaluationDescriptorDefinitionsV2 = Readonly<{
  readonly [Lane in KnowledgeBaseEvaluationRetrieverId]: KnowledgeBaseEvaluationDescriptorDefinitionV2;
}>;

export type KnowledgeBaseEvaluationLaneDescriptorsV2 = Readonly<{
  readonly [Lane in KnowledgeBaseEvaluationRetrieverId]: EvaluationRetrieverDescriptorV2;
}>;

export type KnowledgeBaseExistingLaneClosureDescriptorV2 = Readonly<{
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly variant: ExistingLaneClosureVariant;
}>;

export type KnowledgeBaseEvaluationDiagnosticV2 = Readonly<{
  readonly code: string;
  readonly lane: string;
  readonly status: "degraded" | "ready" | "unavailable";
  readonly message?: string;
}>;

export type KnowledgeBaseEvaluationRawEvidenceV2 = Readonly<{
  readonly laneId: EvaluationLaneIdV2;
  readonly documentId: string;
  readonly rank: number;
  readonly evidence?: unknown;
  readonly provenance?: readonly KnowledgeBaseEvaluationEvidenceUnitV2[];
}>;

export type KnowledgeBaseEvaluationEvidenceUnitV2 = Readonly<{
  readonly evidenceUnitId: string;
  readonly registryUnitId: string;
  readonly documentId: string;
  readonly sourceFamilyId: string;
  readonly sourceClass: EvaluationSourceClassV2;
  readonly trustClass: EvaluationTrustClassV2;
  readonly locator: EvaluationEvidenceLocatorV2;
}>;

export type KnowledgeBaseEvaluationRetrieverResultV2 = Readonly<{
  readonly retrieverId: string;
  readonly status: "degraded" | "ready" | "unavailable";
  readonly candidates: readonly EvaluationRankedCandidateV2[];
  readonly trace: EvaluationRetrieverTraceV2;
  readonly diagnostics: readonly KnowledgeBaseEvaluationDiagnosticV2[];
  readonly rawEvidence: readonly KnowledgeBaseEvaluationRawEvidenceV2[];
  readonly evidenceUnits: readonly KnowledgeBaseEvaluationEvidenceUnitV2[];
  readonly timings: Readonly<Record<string, number>>;
  readonly rawResources: Readonly<Record<string, number>>;
  readonly resources: EvaluationResourceAccountingV2;
  readonly elapsedMs: number;
}>;

export type KnowledgeBaseEvaluationRetrieverV2 = Omit<EvaluationRetrieverV2, "retrieve"> & Readonly<{
  readonly retrieve: (
    request: EvaluationExecutionRequestV2,
  ) => Promise<KnowledgeBaseEvaluationRetrieverResultV2>;
}>;

export type KnowledgeBaseEvaluationAccountingProviderV2 = (
  input: Readonly<{
    readonly lane: KnowledgeBaseEvaluationRetrieverId;
    readonly status: EvaluationRetrieverResult["status"];
    readonly timings: Readonly<Record<string, number>>;
    readonly resources: Readonly<Record<string, number>>;
  }>,
) => EvaluationResourceAccountingV2 | Promise<EvaluationResourceAccountingV2>;

export type KnowledgeBaseEvaluationV2 = Readonly<{
  readonly retrievers: readonly KnowledgeBaseEvaluationRetrieverV2[];
  readonly close: () => Promise<void>;
}>;

type VerifiedKnowledgeBaseEvaluationBindingV2 = Readonly<{
  readonly suiteSha256: string | undefined;
  readonly candidateLockSha256: string | undefined;
  readonly buildContractSha256: string | undefined;
  readonly repositoryCommit: string;
  readonly vaultTree: string;
}>;

const verifiedKnowledgeBaseEvaluationsV2 = new WeakMap<
  KnowledgeBaseEvaluationV2,
  VerifiedKnowledgeBaseEvaluationBindingV2
>();

/**
 * Reject structurally compatible or copied evaluators that did not pass the
 * frozen snapshot, descriptor, evidence, and implementation-artifact adapter.
 */
export function assertVerifiedKnowledgeBaseEvaluationV2(
  evaluation: KnowledgeBaseEvaluationV2,
  corpus: RetrievalEvaluationCorpusV2,
): void {
  const binding = verifiedKnowledgeBaseEvaluationsV2.get(evaluation);
  if (
    binding === undefined
    || binding.suiteSha256 !== corpus.manifest.corpusSha256
    || binding.candidateLockSha256 !== corpus.manifest.candidateLockSha256
    || binding.buildContractSha256 !== corpus.manifest.buildContractSha256
    || binding.repositoryCommit !== corpus.frozen.repositoryCommit
    || binding.vaultTree !== corpus.frozen.vaultTree
  ) {
    throw new TypeError(
      "Evaluation runtime is not the implementation-bound adapter for this sealed corpus.",
    );
  }
}

export type AdaptVerifiedKnowledgeBaseEvaluationV2Options = Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly evidenceRegistry: EvaluationEvidenceRegistry;
  /** Required measurement boundary. Omission is never interpreted as zero work. */
  readonly accounting: KnowledgeBaseEvaluationAccountingProviderV2;
  /** The already-open legacy session must have passed its immutable snapshot verification. */
  readonly evaluation: KnowledgeBaseEvaluation;
  readonly laneDescriptors: KnowledgeBaseEvaluationLaneDescriptorsV2;
  readonly closureDescriptors?: readonly KnowledgeBaseExistingLaneClosureDescriptorV2[];
  readonly implementationArtifacts: readonly VerifiedEvaluationImplementationArtifactV2[];
  readonly now?: () => number;
}>;

export type OpenKnowledgeBaseEvaluationV2Options = Omit<
  OpenKnowledgeBaseEvaluationOptions,
  "corpus" | "now"
> & Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly evidenceRegistry: EvaluationEvidenceRegistry;
  /** Required measurement boundary. Omission is never interpreted as zero work. */
  readonly accounting: KnowledgeBaseEvaluationAccountingProviderV2;
  readonly laneDescriptors: KnowledgeBaseEvaluationLaneDescriptorsV2;
  readonly closureDescriptors?: readonly KnowledgeBaseExistingLaneClosureDescriptorV2[];
  readonly implementationArtifacts: readonly VerifiedEvaluationImplementationArtifactV2[];
  readonly now?: () => number;
  readonly openEvaluation?: (
    options: OpenKnowledgeBaseEvaluationOptions,
  ) => Promise<KnowledgeBaseEvaluation>;
}>;

export const knowledgeBaseExistingLaneClosureVariantsV2 = Object.freeze({
  "primary-only": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
    },
    structuralLanes: [],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
  }),
  "metadata-closure": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2,
    },
    structuralLanes: [{
      lane: "metadata",
      limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
    }],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
  }),
  "graph-closure": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2,
    },
    structuralLanes: [{
      lane: "graph",
      limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
    }],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
  }),
  "path-context-closure": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2,
    },
    structuralLanes: [{
      lane: "path-context",
      limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
    }],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
  }),
  "structural-closure": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2,
    },
    structuralLanes: [
      { lane: "metadata", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "graph", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "path-context", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
    ],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
  }),
  "structural-git-closure": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2,
    },
    structuralLanes: [
      { lane: "metadata", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "graph", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "path-context", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
    ],
    git: {
      mode: "explicit-input",
      limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
    },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
  }),
  "structural-only": freezeExistingLaneClosureVariant({
    primary: null,
    structuralLanes: [
      { lane: "metadata", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "graph", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "path-context", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
    ],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
  }),
} as const);

const laneInput = Object.freeze({
  exact: "text",
  keyword: "text",
  semantic: "text",
  hybrid: "text",
  metadata: "metadata",
  graph: "graph",
  "path-context": "context",
  git: "history",
} satisfies Readonly<Record<KnowledgeBaseEvaluationRetrieverId, string>>);

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function ownData(value: Readonly<Record<string, unknown>>, key: string, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new TypeError(`${label}.${key} must be a data property.`);
  return descriptor.value;
}

function boundedText(value: unknown, label: string, maximumBytes = MAX_DESCRIPTOR_TEXT_BYTES): string {
  if (
    typeof value !== "string"
    || value.trim() === ""
    || /[\0\r\n]/u.test(value)
    || value.normalize("NFC") !== value
    || Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new TypeError(`${label} must be a non-empty NFC single-line bounded string.`);
  }
  return value;
}

function canonicalId(value: unknown, label: string): string {
  const id = boundedText(value, label, 256);
  if (!CANONICAL_ID.test(id)) throw new TypeError(`${label} must be a canonical lowercase ID.`);
  return id;
}

function positiveLimit(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 1
    || (value as number) > MAX_EVALUATION_V2_RESULTS_PER_LANE
  ) throw new TypeError(`${label} must be an integer from 1 through ${MAX_EVALUATION_V2_RESULTS_PER_LANE}.`);
  return value as number;
}

function definition(
  value: KnowledgeBaseEvaluationDescriptorDefinitionV2,
  lane: KnowledgeBaseEvaluationRetrieverId,
): KnowledgeBaseEvaluationDescriptorDefinitionV2 {
  const input = record(value, `descriptor definition ${lane}`);
  const keys = Object.keys(input).toSorted();
  const expected = ["id", "implementationSha256", "retrieveLimit", "role", "version"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`descriptor definition ${lane} must declare exactly ${expected.join(", ")}.`);
  }
  if (input.role !== "ablation" && input.role !== "baseline" && input.role !== "candidate") {
    throw new TypeError(`descriptor definition ${lane}.role is invalid.`);
  }
  const implementationSha256 = boundedText(
    input.implementationSha256,
    `descriptor definition ${lane}.implementationSha256`,
    64,
  );
  if (!SHA256.test(implementationSha256)) {
    throw new TypeError(`descriptor definition ${lane}.implementationSha256 must be lowercase SHA-256.`);
  }
  return Object.freeze({
    id: canonicalId(input.id, `descriptor definition ${lane}.id`),
    role: input.role,
    version: boundedText(input.version, `descriptor definition ${lane}.version`, 512),
    implementationSha256,
    retrieveLimit: positiveLimit(input.retrieveLimit, `descriptor definition ${lane}.retrieveLimit`),
  });
}

function laneConfiguration(
  lane: KnowledgeBaseEvaluationRetrieverId,
  retrieveLimit: number,
): EvaluationRetrieverDescriptorV2["configuration"] {
  return Object.freeze({
    "adapter-schema": KNOWLEDGE_BASE_EVALUATION_ADAPTER_V2,
    "execution-input": laneInput[lane],
    "generative-llm-call-limit": 0,
    "generative-llm-input-token-limit": 0,
    "generative-llm-output-token-limit": 0,
    "lane-order": knowledgeBaseEvaluationRetrieverIds.indexOf(lane) + 1,
    "provenance-source": "live-lane-evidence",
    "result-order": "raw-rank-ascending",
    "retrieve-limit": retrieveLimit,
  });
}

/** Build the eight immutable built-in lane descriptors from authored version metadata. */
export function createKnowledgeBaseEvaluationLaneDescriptorsV2(
  definitions: KnowledgeBaseEvaluationDescriptorDefinitionsV2,
): KnowledgeBaseEvaluationLaneDescriptorsV2 {
  const output = new Map<KnowledgeBaseEvaluationRetrieverId, EvaluationRetrieverDescriptorV2>();
  const ids = new Set<string>();
  for (const lane of knowledgeBaseEvaluationRetrieverIds) {
    const parsed = definition(definitions[lane], lane);
    if (ids.has(parsed.id)) throw new TypeError(`Retriever descriptor ID ${parsed.id} is repeated.`);
    ids.add(parsed.id);
    output.set(lane, Object.freeze({
      id: parsed.id,
      role: parsed.role,
      version: parsed.version,
      implementationSha256: parsed.implementationSha256,
      lanes: Object.freeze([lane] as const),
      configuration: laneConfiguration(lane, parsed.retrieveLimit),
    }));
  }
  const required = (lane: KnowledgeBaseEvaluationRetrieverId): EvaluationRetrieverDescriptorV2 => {
    const descriptor = output.get(lane);
    if (descriptor === undefined) throw new Error(`Missing authored descriptor for ${lane}.`);
    return descriptor;
  };
  return Object.freeze({
    exact: required("exact"),
    keyword: required("keyword"),
    semantic: required("semantic"),
    hybrid: required("hybrid"),
    metadata: required("metadata"),
    graph: required("graph"),
    "path-context": required("path-context"),
    git: required("git"),
  });
}

function closureConfiguration(
  variant: ExistingLaneClosureVariant,
): EvaluationRetrieverDescriptorV2["configuration"] {
  const structural = new Map(variant.structuralLanes.map(({ lane, limit }, index) =>
    [lane, { limit, order: index + 1 }] as const));
  const executionOrder = [
    ...(variant.primary === null ? [] : ["hybrid"]),
    ...variant.structuralLanes.map(({ lane }) => lane),
    ...(variant.git.mode === "explicit-input" ? ["git"] : []),
  ].join(",") || "none";
  return Object.freeze({
    "adapter-schema": KNOWLEDGE_BASE_EVALUATION_ADAPTER_V2,
    "execution-order": executionOrder,
    "fusion-rule": EXISTING_LANE_CLOSURE_FUSION,
    "generative-llm-call-limit": 0,
    "generative-llm-input-token-limit": 0,
    "generative-llm-output-token-limit": 0,
    "git-limit": variant.git.mode === "explicit-input" ? variant.git.limit : null,
    "git-mode": variant.git.mode,
    "graph-limit": structural.get("graph")?.limit ?? null,
    "graph-order": structural.get("graph")?.order ?? null,
    "metadata-limit": structural.get("metadata")?.limit ?? null,
    "metadata-order": structural.get("metadata")?.order ?? null,
    "output-limit": variant.outputLimit,
    "path-context-limit": structural.get("path-context")?.limit ?? null,
    "path-context-order": structural.get("path-context")?.order ?? null,
    "primary-lane": variant.primary?.lane ?? null,
    "primary-retain-limit": variant.primary?.retainLimit ?? null,
    "primary-retrieve-limit": variant.primary?.retrieveLimit ?? null,
    "provenance-source": "live-lane-evidence",
    "result-order": "primary-prefix-then-declared-lane-round-robin-by-source-rank",
  });
}

function closureDescriptorLanes(
  variant: ExistingLaneClosureVariant,
): readonly EvaluationLaneIdV2[] {
  return Object.freeze([
    ...(variant.primary === null ? [] : ["hybrid" as const]),
    ...variant.structuralLanes.map(({ lane }) => lane),
    ...(variant.git.mode === "explicit-input" ? ["git" as const] : []),
  ].toSorted());
}

/** Bind one deeply frozen closure variant to explicit authored implementation metadata. */
export function createKnowledgeBaseExistingLaneClosureDescriptorV2(options: Readonly<{
  readonly id: string;
  readonly role: EvaluationRetrieverDescriptorV2["role"];
  readonly version: string;
  readonly implementationSha256: string;
  readonly variant: ExistingLaneClosureVariant;
}>): KnowledgeBaseExistingLaneClosureDescriptorV2 {
  const variant = freezeExistingLaneClosureVariant(options.variant);
  const parsed = definition({
    id: options.id,
    role: options.role,
    version: options.version,
    implementationSha256: options.implementationSha256,
    retrieveLimit: variant.outputLimit,
  }, "hybrid");
  return Object.freeze({
    descriptor: Object.freeze({
      id: parsed.id,
      role: parsed.role,
      version: parsed.version,
      implementationSha256: parsed.implementationSha256,
      lanes: closureDescriptorLanes(variant),
      configuration: closureConfiguration(variant),
    }),
    variant,
  });
}

function assertFrozenSnapshot(
  expected: RetrievalEvaluationCorpusV2["frozen"],
  actual: RetrievalEvaluationCorpusV2["frozen"],
): void {
  if (
    actual.repositoryCommit !== expected.repositoryCommit
    || actual.vaultTree !== expected.vaultTree
    || actual.vaultRoot !== expected.vaultRoot
  ) throw new TypeError("Evaluation request does not name the adapter's locked frozen snapshot.");
}

function assertRequestLimit(descriptor: EvaluationRetrieverDescriptorV2, requestLimit: number): void {
  const configured = descriptor.configuration["retrieve-limit"]
    ?? descriptor.configuration["output-limit"];
  if (requestLimit !== configured) {
    throw new TypeError(
      `Retriever ${descriptor.id} requires locked limit ${String(configured)}, received ${requestLimit}.`,
    );
  }
}

const forbiddenLegacyQueryFields = Object.freeze([
  "adjudication",
  "answer",
  "assessments",
  "assessorIds",
  "class",
  "cohort",
  "expectedSupport",
  "gold",
  "id",
  "inputOrigins",
  "labels",
  "negativeSubtype",
  "nuggets",
  "primaryLane",
  "qrels",
  "rawAssessments",
  "split",
  "strata",
  "supportState",
  "text",
  "trust",
] as const);

/** Private bridge. A legacy lane can observe only `inputs`; every other field is poison. */
function legacyQueryBridge(
  inputs: RetrievalEvaluationCorpusV2["queries"][number]["inputs"] | Readonly<Record<string, unknown>>,
): RetrievalEvaluationCorpus["queries"][number] {
  const target: Record<string, unknown> = {};
  Object.defineProperty(target, "inputs", {
    configurable: false,
    enumerable: true,
    value: Object.freeze(inputs),
    writable: false,
  });
  for (const field of forbiddenLegacyQueryFields) {
    Object.defineProperty(target, field, {
      configurable: false,
      enumerable: false,
      get(): never {
        throw new Error(`Legacy evaluation lane attempted to read forbidden query field ${field}.`);
      },
    });
  }
  Object.preventExtensions(target);
  return new Proxy(target, {
    get(object, property, receiver): unknown {
      if (typeof property === "symbol" || property === "inputs" || forbiddenLegacyQueryFields.includes(
        property as typeof forbiddenLegacyQueryFields[number],
      )) return Reflect.get(object, property, receiver);
      throw new Error(`Legacy evaluation lane attempted to read forbidden query field ${property}.`);
    },
  }) as unknown as RetrievalEvaluationCorpus["queries"][number];
}

/** Private bridge. Snapshot verification can observe only the frozen commit/tree/root. */
function legacyCorpusBridge(
  frozen: RetrievalEvaluationCorpusV2["frozen"],
): RetrievalEvaluationCorpus {
  const target: Record<string, unknown> = {};
  Object.defineProperty(target, "frozen", {
    configurable: false,
    enumerable: true,
    value: frozen,
    writable: false,
  });
  for (const field of ["assessment", "description", "id", "queries", "schemaVersion"] as const) {
    Object.defineProperty(target, field, {
      configurable: false,
      enumerable: false,
      get(): never {
        throw new Error(`Legacy evaluation opener attempted to read forbidden corpus field ${field}.`);
      },
    });
  }
  Object.preventExtensions(target);
  return new Proxy(target, {
    get(object, property, receiver): unknown {
      if (typeof property === "symbol" || property === "frozen") {
        return Reflect.get(object, property, receiver);
      }
      if (typeof property === "string" && Object.hasOwn(object, property)) {
        return Reflect.get(object, property, receiver);
      }
      throw new Error(`Legacy evaluation opener attempted to read forbidden corpus field ${String(property)}.`);
    },
  }) as unknown as RetrievalEvaluationCorpus;
}

function executionInputs(request: EvaluationExecutionRequestV2): RetrievalEvaluationCorpusV2["queries"][number]["inputs"] {
  const query = record(request.query, "evaluation v2 execution query");
  const keys = Object.keys(query);
  if (keys.length !== 1 || keys[0] !== "inputs") {
    throw new TypeError("Evaluation v2 execution query may expose only inputs.");
  }
  return record(
    ownData(query, "inputs", "evaluation v2 execution query"),
    "evaluation v2 execution query.inputs",
  ) as RetrievalEvaluationCorpusV2["queries"][number]["inputs"];
}

function inputForLegacyLane(
  lane: KnowledgeBaseEvaluationRetrieverId,
  inputs: RetrievalEvaluationCorpusV2["queries"][number]["inputs"],
): Readonly<Record<string, unknown>> {
  if (lane === "exact" || lane === "keyword" || lane === "semantic" || lane === "hybrid") {
    return Object.freeze({ text: inputs.text });
  }
  if (lane === "metadata") {
    return Object.freeze(inputs.metadata === undefined ? {} : { metadata: inputs.metadata });
  }
  if (lane === "graph") {
    return Object.freeze(inputs.graph === undefined ? {} : { graph: inputs.graph });
  }
  if (lane === "path-context") {
    return Object.freeze(inputs.context === undefined ? {} : { context: inputs.context });
  }
  return Object.freeze(inputs.history === undefined ? {} : { history: inputs.history });
}

function laneIsApplicable(
  lane: KnowledgeBaseEvaluationRetrieverId,
  inputs: RetrievalEvaluationCorpusV2["queries"][number]["inputs"],
): boolean {
  if (lane === "exact" || lane === "keyword" || lane === "semantic" || lane === "hybrid") return true;
  if (lane === "metadata") return inputs.metadata !== undefined;
  if (lane === "graph") return inputs.graph !== undefined;
  if (lane === "path-context") return inputs.context !== undefined;
  return inputs.history !== undefined;
}

function finiteMetricMap(value: unknown, label: string): Readonly<Record<string, number>> {
  if (value === undefined) return Object.freeze({});
  const input = record(value, label);
  if (Object.keys(input).length > 32) throw new TypeError(`${label} may have at most 32 entries.`);
  const output: Record<string, number> = {};
  for (const key of Object.keys(input).toSorted()) {
    const candidate = ownData(input, key, label);
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
      throw new TypeError(`${label}.${key} must be a non-negative finite number.`);
    }
    output[boundedText(key, `${label} key`, 128)] = candidate;
  }
  return Object.freeze(output);
}

function diagnosticCode(lane: string, status: EvaluationDiagnostic["status"]): string {
  const normalized = `${lane}-${status}`.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 120);
  return CANONICAL_ID.test(normalized) ? normalized : `diagnostic-${status}`;
}

function copyDiagnostics(value: unknown, label: string): readonly KnowledgeBaseEvaluationDiagnosticV2[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_EVALUATION_DIAGNOSTICS) {
    throw new TypeError(`${label} must contain at most ${MAX_EVALUATION_DIAGNOSTICS} entries.`);
  }
  return Object.freeze(value.map((candidate, index) => {
    const input = record(candidate, `${label}[${index}]`);
    const lane = boundedText(ownData(input, "lane", `${label}[${index}]`), `${label}[${index}].lane`, 256);
    const status = ownData(input, "status", `${label}[${index}]`);
    if (status !== "ready" && status !== "degraded" && status !== "unavailable") {
      throw new TypeError(`${label}[${index}].status is invalid.`);
    }
    const rawMessage = ownData(input, "message", `${label}[${index}]`);
    const message = rawMessage === undefined
      ? undefined
      : boundedText(rawMessage, `${label}[${index}].message`, MAX_DIAGNOSTIC_MESSAGE_BYTES);
    return Object.freeze({
      code: diagnosticCode(lane, status),
      lane,
      status,
      ...(message === undefined ? {} : { message }),
    });
  }));
}

type ValidatedLegacyHit = Readonly<{
  readonly documentId: string;
  readonly rank: number;
  readonly score?: number;
  readonly evidence?: unknown;
}>;

type ValidatedLegacyResult = Readonly<{
  readonly status: EvaluationRetrieverResult["status"];
  readonly hits: readonly ValidatedLegacyHit[];
  readonly diagnostics: readonly KnowledgeBaseEvaluationDiagnosticV2[];
  readonly timings: Readonly<Record<string, number>>;
  readonly resources: Readonly<Record<string, number>>;
}>;

function immutableEvidenceCopy(value: unknown): unknown {
  let nodes = 0;
  const seen = new Set<object>();
  const copy = (candidate: unknown, depth: number): unknown => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") {
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new TypeError("legacy lane evidence numbers must be finite.");
      return candidate;
    }
    if (candidate === undefined) return undefined;
    if (typeof candidate !== "object") {
      throw new TypeError("legacy lane evidence must contain only JSON-compatible values.");
    }
    if (depth > 32 || (nodes += 1) > 10_000) {
      throw new TypeError("legacy lane evidence exceeds its structural bound.");
    }
    if (seen.has(candidate)) throw new TypeError("legacy lane evidence must not contain cycles.");
    seen.add(candidate);
    let output: unknown;
    if (Array.isArray(candidate)) {
      if (candidate.length > 10_000) throw new TypeError("legacy lane evidence array is too large.");
      output = Object.freeze(candidate.map((entry) => {
        const copied = copy(entry, depth + 1);
        return copied === undefined ? null : copied;
      }));
    } else {
      const input = candidate as Readonly<Record<string, unknown>>;
      if (Object.keys(input).length > 10_000) throw new TypeError("legacy lane evidence object is too large.");
      const object: Record<string, unknown> = {};
      for (const key of Object.keys(input).toSorted()) {
        const copied = copy(ownData(input, key, "legacy lane evidence"), depth + 1);
        if (copied !== undefined) object[key] = copied;
      }
      output = Object.freeze(object);
    }
    seen.delete(candidate);
    return output;
  };
  const copied = copy(value, 0);
  const serialized = JSON.stringify(copied);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_EVALUATION_EVIDENCE_BYTES) {
    throw new TypeError("legacy lane evidence exceeds its serialized byte bound.");
  }
  return copied;
}

function confinedPath(value: unknown, label: string): string {
  const path = boundedText(value, label, 4_096);
  if (
    path.startsWith("/")
    || path.startsWith("./")
    || path.includes("\\")
    || WINDOWS_ABSOLUTE_PATH.test(path)
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new TypeError(`${label} must be a canonical confined path.`);
  return path;
}

function validateLegacyResult(
  value: unknown,
  lane: KnowledgeBaseEvaluationRetrieverId,
  limit: number,
): ValidatedLegacyResult {
  const input = record(value, `legacy ${lane} result`);
  const status = ownData(input, "status", `legacy ${lane} result`);
  if (status !== "ready" && status !== "degraded" && status !== "unavailable") {
    throw new TypeError(`legacy ${lane} result.status is invalid.`);
  }
  const rawHits = ownData(input, "hits", `legacy ${lane} result`);
  if (!Array.isArray(rawHits) || rawHits.length > limit || rawHits.length > MAX_EVALUATION_RESULTS_PER_QUERY) {
    throw new TypeError(`legacy ${lane} result.hits exceeds its locked result bound.`);
  }
  const hits = rawHits.map((candidate, index): ValidatedLegacyHit => {
    const hit = record(candidate, `legacy ${lane} result.hits[${index}]`);
    const rank = ownData(hit, "rank", `legacy ${lane} result.hits[${index}]`);
    if (!Number.isSafeInteger(rank) || rank !== index + 1) {
      throw new TypeError(`legacy ${lane} hit ranks must be contiguous source ranks.`);
    }
    const score = ownData(hit, "score", `legacy ${lane} result.hits[${index}]`);
    if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score))) {
      throw new TypeError(`legacy ${lane} result.hits[${index}].score must be finite.`);
    }
    const rawEvidence = ownData(hit, "evidence", `legacy ${lane} result.hits[${index}]`);
    const evidence = rawEvidence === undefined ? undefined : immutableEvidenceCopy(rawEvidence);
    return Object.freeze({
      documentId: confinedPath(
        ownData(hit, "documentId", `legacy ${lane} result.hits[${index}]`),
        `legacy ${lane} result.hits[${index}].documentId`,
      ),
      rank,
      ...(score === undefined ? {} : { score }),
      ...(evidence === undefined ? {} : { evidence }),
    });
  });
  if (new Set(hits.map(({ documentId }) => documentId)).size !== hits.length) {
    throw new TypeError(`legacy ${lane} result.hits must not repeat a document.`);
  }
  if (status === "unavailable" && hits.length > 0) {
    throw new TypeError(`legacy ${lane} unavailable result may not contain hits.`);
  }
  return Object.freeze({
    status,
    hits: Object.freeze(hits),
    diagnostics: copyDiagnostics(
      ownData(input, "diagnostics", `legacy ${lane} result`),
      `legacy ${lane} result.diagnostics`,
    ),
    timings: finiteMetricMap(
      ownData(input, "timings", `legacy ${lane} result`),
      `legacy ${lane} result.timings`,
    ),
    resources: finiteMetricMap(
      ownData(input, "resources", `legacy ${lane} result`),
      `legacy ${lane} result.resources`,
    ),
  });
}

type BoundEvidenceUnit = KnowledgeBaseEvaluationEvidenceUnitV2 & Readonly<{
  readonly kind: EvaluationEvidenceUnit["kind"];
  readonly frontmatterField?: string;
  readonly text: string;
}>;

type EvidenceBindings = Readonly<{
  readonly byCorpusUnitId: Readonly<Record<string, BoundEvidenceUnit>>;
  readonly byRegistryUnitId: Readonly<Record<string, BoundEvidenceUnit>>;
  readonly byDocumentId: Readonly<Record<string, readonly BoundEvidenceUnit[]>>;
  readonly units: readonly BoundEvidenceUnit[];
}>;

type LegacyRetrieverBindings = Readonly<Record<
  KnowledgeBaseEvaluationRetrieverId,
  EvaluationRetriever
>>;

type KnowledgeBaseEvaluationExecutionContractV2 = Readonly<{
  readonly frozen: RetrievalEvaluationCorpusV2["frozen"];
  readonly manifest: Readonly<{
    readonly corpusSha256: string;
    readonly candidateLockSha256: string;
    readonly buildContractSha256: string;
  }>;
  readonly candidateLock: EvaluationCandidateLockV2;
  readonly descriptors: readonly EvaluationRetrieverDescriptorV2[];
  readonly descriptorsById: Readonly<Record<string, EvaluationRetrieverDescriptorV2>>;
  readonly evidenceBindings: EvidenceBindings;
  readonly closureEvidenceRegistry: ExistingLaneClosureEvidenceRegistry;
  readonly legacyRetrievers: LegacyRetrieverBindings;
}>;

function copyRetrieverDescriptor(
  descriptor: EvaluationRetrieverDescriptorV2,
): EvaluationRetrieverDescriptorV2 {
  const configuration = Object.freeze(Object.fromEntries(
    Object.entries(descriptor.configuration).toSorted(([left], [right]) => left.localeCompare(right)),
  ));
  return Object.freeze({
    id: descriptor.id,
    role: descriptor.role,
    version: descriptor.version,
    implementationSha256: descriptor.implementationSha256,
    lanes: Object.freeze([...descriptor.lanes]),
    configuration,
  });
}

function copyCandidateLock(
  candidateLock: EvaluationCandidateLockV2,
): EvaluationCandidateLockV2 {
  return Object.freeze({
    baselineRetrieverId: candidateLock.baselineRetrieverId,
    candidateRetrieverIds: Object.freeze([...candidateLock.candidateRetrieverIds]),
    descriptorDigests: Object.freeze(candidateLock.descriptorDigests.map((binding) => Object.freeze({
      retrieverId: binding.retrieverId,
      sha256: binding.sha256,
    }))),
  });
}

function bindLegacyRetrievers(evaluation: KnowledgeBaseEvaluation): LegacyRetrieverBindings {
  const byId: Partial<Record<KnowledgeBaseEvaluationRetrieverId, EvaluationRetriever>> =
    Object.create(null) as Partial<Record<KnowledgeBaseEvaluationRetrieverId, EvaluationRetriever>>;
  for (const retriever of evaluation.retrievers) {
    if (!knowledgeBaseEvaluationRetrieverIds.includes(retriever.id as KnowledgeBaseEvaluationRetrieverId)) {
      throw new TypeError(`Verified evaluation exposed unknown lane ${retriever.id}.`);
    }
    const lane = retriever.id as KnowledgeBaseEvaluationRetrieverId;
    if (byId[lane] !== undefined) throw new TypeError(`Verified evaluation repeats ${lane} lane.`);
    byId[lane] = Object.freeze({ id: retriever.id, retrieve: retriever.retrieve });
  }
  if (knowledgeBaseEvaluationRetrieverIds.some((lane) => byId[lane] === undefined)) {
    throw new TypeError("Verified evaluation must expose all eight immutable built-in lanes.");
  }
  return Object.freeze(byId) as LegacyRetrieverBindings;
}

function createExecutionContract(options: Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly descriptors: readonly EvaluationRetrieverDescriptorV2[];
  readonly evidenceBindings: EvidenceBindings;
  readonly legacyRetrievers: LegacyRetrieverBindings;
}>): KnowledgeBaseEvaluationExecutionContractV2 {
  const frozen = Object.freeze({
    repositoryCommit: options.corpus.frozen.repositoryCommit,
    vaultTree: options.corpus.frozen.vaultTree,
    vaultRoot: options.corpus.frozen.vaultRoot,
  });
  const descriptors = Object.freeze(options.descriptors.map(copyRetrieverDescriptor));
  const descriptorsById = Object.freeze(Object.assign(
    Object.create(null) as Record<string, EvaluationRetrieverDescriptorV2>,
    Object.fromEntries(descriptors.map((descriptor) => [descriptor.id, descriptor])),
  ));
  const candidateLock = copyCandidateLock(options.corpus.candidateLock);
  for (const descriptor of descriptors) {
    const lock = candidateLock.descriptorDigests.find(({ retrieverId }) =>
      retrieverId === descriptor.id);
    if (lock?.sha256 !== evaluationRetrieverDescriptorDigestV2(descriptor)) {
      throw new TypeError(`Retriever descriptor ${descriptor.id} drifted while deriving its execution contract.`);
    }
  }
  const closureRegistry = closureEvidenceRegistry(options.evidenceBindings);
  return Object.freeze({
    frozen,
    manifest: Object.freeze({
      corpusSha256: options.corpus.manifest.corpusSha256,
      candidateLockSha256: options.corpus.manifest.candidateLockSha256,
      buildContractSha256: options.corpus.manifest.buildContractSha256,
    }),
    candidateLock,
    descriptors,
    descriptorsById,
    evidenceBindings: options.evidenceBindings,
    closureEvidenceRegistry: closureRegistry,
    legacyRetrievers: options.legacyRetrievers,
  });
}

function evidenceBindingKey(value: Readonly<{
  readonly documentId: string;
  readonly sourcePath: string;
  readonly lineRange: { readonly start: number; readonly end: number };
  readonly headingPath: readonly string[];
  readonly sourcePage?: number;
  readonly trustClass: string;
}>): string {
  return JSON.stringify([
    value.documentId,
    value.sourcePath,
    value.lineRange.start,
    value.lineRange.end,
    value.headingPath,
    value.sourcePage ?? null,
    value.trustClass,
  ]);
}

function buildEvidenceBindings(
  registry: EvaluationEvidenceRegistry,
  corpus: RetrievalEvaluationCorpusV2,
): EvidenceBindings {
  validateEvaluationEvidenceRegistry(registry);
  const familyById = new Map(corpus.sourceFamilies.map((family) => [family.id, family]));
  const documentById = new Map(corpus.documents.map((document) => [document.id, document]));
  const registryById = new Map<string, EvaluationEvidenceUnit>();
  for (const unit of registry.units) {
    if (registryById.has(unit.id)) {
      throw new TypeError(`Live registry unit ${unit.id} is duplicated.`);
    }
    registryById.set(unit.id, unit);
  }

  const byCorpusUnitId = new Map<string, BoundEvidenceUnit>();
  const byRegistryUnitId = new Map<string, BoundEvidenceUnit>();
  const mutableByDocumentId = new Map<string, BoundEvidenceUnit[]>();
  for (const corpusUnit of corpus.evidenceUnits) {
    const document = documentById.get(corpusUnit.documentId);
    const family = familyById.get(corpusUnit.sourceFamilyId);
    if (document === undefined || family === undefined) {
      throw new TypeError(`Corpus evidence unit ${corpusUnit.id} has an unresolved document or source family.`);
    }
    const key = evidenceBindingKey({
      documentId: corpusUnit.documentId,
      sourcePath: corpusUnit.sourcePath,
      lineRange: corpusUnit.lineRange,
      headingPath: corpusUnit.headingPath,
      ...(corpusUnit.sourcePage === undefined ? {} : { sourcePage: corpusUnit.sourcePage }),
      trustClass: corpusUnit.trustClass,
    });
    const registryUnit = registryById.get(corpusUnit.id);
    if (registryUnit === undefined) {
      throw new TypeError(
        `Corpus evidence unit ${corpusUnit.id} does not preserve an exact live registry unit identity.`,
      );
    }
    const registryKey = evidenceBindingKey({
      documentId: registryUnit.documentId,
      sourcePath: registryUnit.sourcePath,
      lineRange: registryUnit.lineRange,
      headingPath: registryUnit.headingAncestry,
      ...(registryUnit.pdfPage === undefined ? {} : { sourcePage: registryUnit.pdfPage }),
      trustClass: registryUnit.trustClass,
    });
    if (key !== registryKey) {
      throw new TypeError(
        `Corpus evidence unit ${corpusUnit.id} metadata does not match its exact live registry unit.`,
      );
    }
    if (byRegistryUnitId.has(registryUnit.id)) {
      throw new TypeError(`Live registry unit ${registryUnit.id} is bound to more than one corpus unit.`);
    }
    const bound: BoundEvidenceUnit = Object.freeze({
      evidenceUnitId: corpusUnit.id,
      registryUnitId: registryUnit.id,
      documentId: corpusUnit.documentId,
      sourceFamilyId: corpusUnit.sourceFamilyId,
      sourceClass: family.sourceClass,
      trustClass: corpusUnit.trustClass,
      locator: Object.freeze({
        evidenceUnitId: corpusUnit.id,
        sourceFamilyId: corpusUnit.sourceFamilyId,
        sourceClass: family.sourceClass,
        trustClass: corpusUnit.trustClass,
        sourcePath: corpusUnit.sourcePath,
        lineRange: Object.freeze({
          start: corpusUnit.lineRange.start,
          end: corpusUnit.lineRange.end,
        }),
        headingPath: Object.freeze([...corpusUnit.headingPath]),
        ...(corpusUnit.sourcePage === undefined ? {} : { sourcePage: corpusUnit.sourcePage }),
      }),
      kind: registryUnit.kind,
      ...(registryUnit.frontmatterField === undefined
        ? {}
        : { frontmatterField: registryUnit.frontmatterField }),
      text: registryUnit.text,
    });
    byCorpusUnitId.set(bound.evidenceUnitId, bound);
    byRegistryUnitId.set(bound.registryUnitId, bound);
    const documentUnits = mutableByDocumentId.get(bound.documentId) ?? [];
    documentUnits.push(bound);
    mutableByDocumentId.set(bound.documentId, documentUnits);
  }
  const kindOrder: Readonly<Record<EvaluationEvidenceUnit["kind"], number>> = Object.freeze({
    heading: 0,
    paragraph: 1,
    list: 2,
    table: 3,
    "code-block": 4,
    "pdf-page-span": 5,
    "frontmatter-field": 6,
  });
  const byDocumentId = new Map<string, readonly BoundEvidenceUnit[]>();
  for (const [documentId, units] of mutableByDocumentId) {
    byDocumentId.set(documentId, Object.freeze(units.toSorted((left, right) =>
      left.locator.lineRange.start - right.locator.lineRange.start
      || kindOrder[left.kind] - kindOrder[right.kind]
      || left.locator.lineRange.end - right.locator.lineRange.end
      || left.evidenceUnitId.localeCompare(right.evidenceUnitId))));
  }
  const allUnits = Object.freeze([...byCorpusUnitId.values()]
    .toSorted((left, right) => left.evidenceUnitId.localeCompare(right.evidenceUnitId)));
  return Object.freeze({
    byCorpusUnitId: Object.freeze(Object.assign(
      Object.create(null) as Record<string, BoundEvidenceUnit>,
      Object.fromEntries(byCorpusUnitId),
    )),
    byRegistryUnitId: Object.freeze(Object.assign(
      Object.create(null) as Record<string, BoundEvidenceUnit>,
      Object.fromEntries(byRegistryUnitId),
    )),
    byDocumentId: Object.freeze(Object.assign(
      Object.create(null) as Record<string, readonly BoundEvidenceUnit[]>,
      Object.fromEntries(byDocumentId),
    )),
    units: allUnits,
  });
}

type HitEvidenceLocator =
  | Readonly<{ readonly kind: "evidence-unit"; readonly evidenceUnitId: string }>
  | Readonly<{ readonly kind: "frontmatter-field"; readonly field: string }>
  | Readonly<{ readonly kind: "frontmatter-field-any"; readonly fields: readonly string[] }>
  | Readonly<{ readonly kind: "frontmatter-value"; readonly value: string }>
  | Readonly<{ readonly kind: "line"; readonly line: number }>
  | Readonly<{
      readonly kind: "line-range";
      readonly start: number;
      readonly end: number;
    }>
  | Readonly<{ readonly kind: "source-page"; readonly sourcePage: number }>
  | Readonly<{ readonly kind: "source-path"; readonly sourcePath: string }>
  | Readonly<{ readonly kind: "title"; readonly title: string }>;

type HitEvidenceProvenance = Readonly<{
  readonly targetDocumentId: string;
  readonly evidenceDocumentId: string;
  readonly sourcePath: string;
  readonly locator: HitEvidenceLocator;
}>;

function positiveSourcePosition(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 10_000_000;
}

function hitEvidenceProvenance(
  hit: ValidatedLegacyHit,
): readonly HitEvidenceProvenance[] | undefined {
  if (hit.evidence === null || typeof hit.evidence !== "object" || Array.isArray(hit.evidence)) {
    return undefined;
  }
  const evidence = hit.evidence as Readonly<Record<string, unknown>>;
  if (!Object.prototype.hasOwnProperty.call(evidence, "provenance")) return undefined;
  try {
    const rawProvenance = ownData(evidence, "provenance", "lane evidence");
    if (!Array.isArray(rawProvenance) || rawProvenance.length === 0 || rawProvenance.length > 64) {
      return undefined;
    }
    const parseText = (value: unknown): string | undefined => {
      if (typeof value !== "string" || value === "" || /[\0\r\n]/u.test(value)) return undefined;
      if (value.normalize("NFC") !== value || Buffer.byteLength(value, "utf8") > 4_096) return undefined;
      return value;
    };
    const parsed = rawProvenance.map((candidate, index): HitEvidenceProvenance | undefined => {
    const provenance = record(candidate, `lane evidence.provenance[${index}]`);
    if (
      Object.keys(provenance).toSorted().join("\0")
      !== "evidenceDocumentId\0locator\0sourcePath\0targetDocumentId"
    ) {
      return undefined;
    }
    const targetDocumentId = confinedPath(
      ownData(provenance, "targetDocumentId", "lane evidence.provenance"),
      "lane evidence.provenance.targetDocumentId",
    );
    if (targetDocumentId !== hit.documentId) return undefined;
    const evidenceDocumentId = confinedPath(
      ownData(provenance, "evidenceDocumentId", "lane evidence.provenance"),
      "lane evidence.provenance.evidenceDocumentId",
    );
    const sourcePath = confinedPath(
      ownData(provenance, "sourcePath", "lane evidence.provenance"),
      "lane evidence.provenance.sourcePath",
    );
    const locator = record(
      ownData(provenance, "locator", "lane evidence.provenance"),
      "lane evidence.provenance.locator",
    );
    const kind = ownData(locator, "kind", "lane evidence.provenance.locator");
    if (kind === "evidence-unit") {
      if (Object.keys(locator).toSorted().join("\0") !== "evidenceUnitId\0kind") return undefined;
      const evidenceUnitId = ownData(locator, "evidenceUnitId", "lane evidence.provenance.locator");
      if (typeof evidenceUnitId !== "string") return undefined;
      return Object.freeze({
        targetDocumentId,
        evidenceDocumentId,
        sourcePath,
        locator: Object.freeze({ kind, evidenceUnitId }),
      });
    }
    if (kind === "frontmatter-field") {
      if (Object.keys(locator).toSorted().join("\0") !== "field\0kind") return undefined;
      const field = ownData(locator, "field", "lane evidence.provenance.locator");
      const parsedField = parseText(field);
      if (parsedField === undefined) return undefined;
      return Object.freeze({
        targetDocumentId,
        evidenceDocumentId,
        sourcePath,
        locator: Object.freeze({ kind, field: parsedField }),
      });
    }
    if (kind === "frontmatter-field-any") {
      if (Object.keys(locator).toSorted().join("\0") !== "fields\0kind") return undefined;
      const fields = ownData(locator, "fields", "lane evidence.provenance.locator");
      if (!Array.isArray(fields) || fields.length === 0 || fields.length > 32) return undefined;
      const parsedFields = fields.map(parseText);
      if (parsedFields.some((field) => field === undefined)) return undefined;
      const canonicalFields = [...new Set(parsedFields as string[])].toSorted();
      if (canonicalFields.length !== fields.length) return undefined;
      return Object.freeze({
        targetDocumentId,
        evidenceDocumentId,
        sourcePath,
        locator: Object.freeze({ kind, fields: Object.freeze(canonicalFields) }),
      });
    }
    if (kind === "frontmatter-value") {
      if (Object.keys(locator).toSorted().join("\0") !== "kind\0value") return undefined;
      const value = parseText(ownData(locator, "value", "lane evidence.provenance.locator"));
      if (value === undefined) return undefined;
      return Object.freeze({
        targetDocumentId,
        evidenceDocumentId,
        sourcePath,
        locator: Object.freeze({ kind, value }),
      });
    }
    if (kind === "line") {
      if (Object.keys(locator).toSorted().join("\0") !== "kind\0line") return undefined;
      const line = ownData(locator, "line", "lane evidence.provenance.locator");
      if (!positiveSourcePosition(line)) return undefined;
      return Object.freeze({
        targetDocumentId,
        evidenceDocumentId,
        sourcePath,
        locator: Object.freeze({ kind, line }),
      });
    }
    if (kind === "line-range") {
      if (Object.keys(locator).toSorted().join("\0") !== "end\0kind\0start") return undefined;
      const start = ownData(locator, "start", "lane evidence.provenance.locator");
      const end = ownData(locator, "end", "lane evidence.provenance.locator");
      if (!positiveSourcePosition(start) || !positiveSourcePosition(end) || end < start) return undefined;
      return Object.freeze({
        targetDocumentId,
        evidenceDocumentId,
        sourcePath,
        locator: Object.freeze({ kind, start, end }),
      });
    }
    if (kind === "source-page") {
      if (Object.keys(locator).toSorted().join("\0") !== "kind\0sourcePage") return undefined;
      const sourcePage = ownData(locator, "sourcePage", "lane evidence.provenance.locator");
      if (!Number.isSafeInteger(sourcePage) || (sourcePage as number) < 1 || (sourcePage as number) > 1_000_000) {
        return undefined;
      }
      return Object.freeze({
        targetDocumentId,
        evidenceDocumentId,
        sourcePath,
        locator: Object.freeze({ kind, sourcePage: sourcePage as number }),
      });
    }
    if (kind === "source-path") {
      if (Object.keys(locator).toSorted().join("\0") !== "kind\0sourcePath") return undefined;
      const locatorSourcePath = confinedPath(
        ownData(locator, "sourcePath", "lane evidence.provenance.locator"),
        "lane evidence.provenance.locator.sourcePath",
      );
      if (locatorSourcePath !== sourcePath) return undefined;
      return Object.freeze({
        targetDocumentId,
        evidenceDocumentId,
        sourcePath,
        locator: Object.freeze({ kind, sourcePath: locatorSourcePath }),
      });
    }
    if (kind === "title") {
      if (Object.keys(locator).toSorted().join("\0") !== "kind\0title") return undefined;
      const title = parseText(ownData(locator, "title", "lane evidence.provenance.locator"));
      if (title === undefined) return undefined;
      return Object.freeze({
        targetDocumentId,
        evidenceDocumentId,
        sourcePath,
        locator: Object.freeze({ kind, title }),
      });
    }
    return undefined;
    });
    if (parsed.some((candidate) => candidate === undefined)) return undefined;
    const provenance = parsed as HitEvidenceProvenance[];
    if (new Set(provenance.map((candidate) => JSON.stringify(candidate))).size !== provenance.length) {
      return undefined;
    }
    return Object.freeze(provenance);
  } catch {
    return undefined;
  }
}

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function resolveEvidenceContribution(
  provenance: HitEvidenceProvenance,
  bindings: EvidenceBindings,
): readonly BoundEvidenceUnit[] {
  if (provenance.locator.kind === "evidence-unit") {
    const binding = bindings.byCorpusUnitId[provenance.locator.evidenceUnitId]
      ?? bindings.byRegistryUnitId[provenance.locator.evidenceUnitId];
    return binding?.documentId === provenance.evidenceDocumentId
      && binding.locator.sourcePath === provenance.sourcePath
      ? Object.freeze([binding])
      : Object.freeze([]);
  }
  let candidates = [...(bindings.byDocumentId[provenance.evidenceDocumentId] ?? [])]
    .filter((candidate) => candidate.locator.sourcePath === provenance.sourcePath);
  if (candidates.length === 0) return Object.freeze([]);

  if (provenance.locator.kind === "frontmatter-field") {
    const field = provenance.locator.field;
    candidates = candidates.filter(({ kind, frontmatterField }) =>
      kind === "frontmatter-field" && frontmatterField === field);
  } else if (provenance.locator.kind === "frontmatter-field-any") {
    const fields = provenance.locator.fields;
    candidates = candidates.filter(({ kind, frontmatterField }) =>
      kind === "frontmatter-field"
      && frontmatterField !== undefined
      && fields.includes(frontmatterField));
  } else if (provenance.locator.kind === "frontmatter-value") {
    const value = normalizeEvidenceText(provenance.locator.value);
    candidates = candidates.filter(({ kind, text }) =>
      kind === "frontmatter-field" && normalizeEvidenceText(text).includes(value));
  } else if (provenance.locator.kind === "title") {
    const title = provenance.locator.title;
    const frontmatter = candidates.filter(({ kind, frontmatterField }) =>
      kind === "frontmatter-field" && frontmatterField === "title");
    candidates = frontmatter.length > 0
      ? frontmatter
      : candidates.filter(({ kind, locator }) =>
          kind === "heading"
          && normalizeEvidenceText(locator.headingPath.at(-1) ?? "")
            === normalizeEvidenceText(title));
  } else if (provenance.locator.kind === "line" || provenance.locator.kind === "line-range") {
    const lineRange = provenance.locator.kind === "line"
      ? Object.freeze({ start: provenance.locator.line, end: provenance.locator.line })
      : Object.freeze({ start: provenance.locator.start, end: provenance.locator.end });
    const containing = candidates.filter(({ locator }) =>
      locator.lineRange.start <= lineRange.start && locator.lineRange.end >= lineRange.end);
    if (containing.length === 0) return Object.freeze([]);
    const nonPage = containing.filter(({ kind }) => kind !== "pdf-page-span");
    candidates = nonPage.length > 0 ? nonPage : containing;
    const narrowestSpan = Math.min(...candidates.map(({ locator }) =>
      locator.lineRange.end - locator.lineRange.start));
    candidates = candidates.filter(({ locator }) =>
      locator.lineRange.end - locator.lineRange.start === narrowestSpan);
  } else if (provenance.locator.kind === "source-path") {
    // A path is retrieval identity, not a Markdown slice that may earn nugget credit.
    return Object.freeze([]);
  } else {
    const sourcePage = provenance.locator.sourcePage;
    candidates = candidates.filter(({ kind, locator }) =>
      kind === "pdf-page-span" && locator.sourcePage === sourcePage);
  }
  return Object.freeze(candidates);
}

function resolveHitEvidence(
  hit: ValidatedLegacyHit,
  bindings: EvidenceBindings,
  lane: KnowledgeBaseEvaluationRetrieverId,
): readonly BoundEvidenceUnit[] | undefined {
  const provenance = hitEvidenceProvenance(hit);
  if (provenance === undefined) return undefined;
  const resolved = provenance.map((candidate) => resolveEvidenceContribution(candidate, bindings));
  const requiresEveryContribution = lane === "metadata" || lane === "graph" || lane === "path-context";
  if (requiresEveryContribution && resolved.some((candidates) => candidates.length === 0)) {
    return undefined;
  }
  const unique = [...new Map(resolved.flat()
    .map((candidate) => [candidate.evidenceUnitId, candidate] as const)).values()]
    .toSorted((left, right) => left.evidenceUnitId.localeCompare(right.evidenceUnitId));
  return unique.length === 0 ? undefined : Object.freeze(unique);
}

function publicEvidenceUnit(unit: BoundEvidenceUnit): KnowledgeBaseEvaluationEvidenceUnitV2 {
  return Object.freeze({
    evidenceUnitId: unit.evidenceUnitId,
    registryUnitId: unit.registryUnitId,
    documentId: unit.documentId,
    sourceFamilyId: unit.sourceFamilyId,
    sourceClass: unit.sourceClass,
    trustClass: unit.trustClass,
    locator: unit.locator,
  });
}

function closureEvidenceLocator(unit: BoundEvidenceUnit): ExistingLaneClosureEvidenceLocator {
  return Object.freeze({
    evidenceUnitId: unit.evidenceUnitId,
    documentId: unit.documentId,
    sourceFamilyId: unit.sourceFamilyId,
    sourceClass: unit.sourceClass,
    trustClass: unit.trustClass,
    sourcePath: unit.locator.sourcePath,
    lineRange: Object.freeze({
      start: unit.locator.lineRange.start,
      end: unit.locator.lineRange.end,
    }),
    headingPath: Object.freeze([...unit.locator.headingPath]),
    ...(unit.locator.sourcePage === undefined ? {} : { sourcePage: unit.locator.sourcePage }),
  });
}

function closureEvidenceRegistry(bindings: EvidenceBindings): ExistingLaneClosureEvidenceRegistry {
  return Object.freeze({
    units: Object.freeze(bindings.units
      .map(closureEvidenceLocator)),
  });
}

function closureLocatorKey(locator: ExistingLaneClosureEvidenceLocator): string {
  return JSON.stringify([
    locator.evidenceUnitId,
    locator.documentId,
    locator.sourceFamilyId,
    locator.sourceClass,
    locator.trustClass,
    locator.sourcePath,
    locator.lineRange.start,
    locator.lineRange.end,
    locator.headingPath,
    locator.sourcePage ?? null,
  ]);
}

function bindingFromClosureLocator(
  locator: ExistingLaneClosureEvidenceLocator,
  bindings: EvidenceBindings,
): BoundEvidenceUnit {
  const binding = bindings.byCorpusUnitId[locator.evidenceUnitId];
  if (
    binding === undefined
    || closureLocatorKey(closureEvidenceLocator(binding)) !== closureLocatorKey(locator)
  ) {
    throw new TypeError(
      `Closure provenance ${locator.evidenceUnitId} does not match the adapter evidence binding.`,
    );
  }
  return binding;
}

function bindingsFromClosureProvenance(
  provenance: readonly ExistingLaneClosureEvidenceLocator[],
  bindings: EvidenceBindings,
): readonly BoundEvidenceUnit[] {
  return Object.freeze(provenance.map((locator) => bindingFromClosureLocator(locator, bindings)));
}

function uniqueBindingsFromClosureProvenance(
  provenance: readonly ExistingLaneClosureEvidenceLocator[],
  bindings: EvidenceBindings,
): readonly BoundEvidenceUnit[] {
  return Object.freeze([...new Map(bindingsFromClosureProvenance(provenance, bindings)
    .map((binding) => [binding.evidenceUnitId, binding] as const)).values()]);
}

function reasonCodes(
  diagnostics: readonly KnowledgeBaseEvaluationDiagnosticV2[],
  applicable: boolean,
  status: ValidatedLegacyResult["status"],
): readonly string[] {
  return Object.freeze([
    ...new Set([
      ...diagnostics.map(({ code }) => code),
      ...(!applicable ? ["missing-input"] : []),
      ...(applicable && status === "degraded" && diagnostics.length === 0 ? ["degraded"] : []),
      ...(applicable && status === "unavailable" && diagnostics.length === 0 ? ["unavailable"] : []),
    ]),
  ].toSorted());
}

function exactKeys(
  input: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(input).toSorted();
  const canonical = [...expected].toSorted();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new TypeError(`${label} must declare exactly ${canonical.join(", ")}.`);
  }
}

function accountingInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function accountingDuration(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function copyEmbeddingAccounting(
  value: unknown,
  label: string,
): EvaluationResourceAccountingV2["embedding"] {
  const input = record(value, label);
  const optionalKeys = ["inputTokensMeasured", "durationScope"]
    .filter((key) => Object.hasOwn(input, key));
  exactKeys(input, ["calls", "durationMs", "inputTokens", ...optionalKeys], label);
  const calls = accountingInteger(ownData(input, "calls", label), `${label}.calls`);
  const inputTokens = accountingInteger(
    ownData(input, "inputTokens", label),
    `${label}.inputTokens`,
  );
  const durationMs = accountingDuration(
    ownData(input, "durationMs", label),
    `${label}.durationMs`,
  );
  const inputTokensMeasured = ownData(input, "inputTokensMeasured", label);
  if (Object.hasOwn(input, "inputTokensMeasured") && inputTokensMeasured !== false) {
    throw new TypeError(`${label}.inputTokensMeasured must be literal false when present.`);
  }
  const durationScopeValue = ownData(input, "durationScope", label);
  if (
    Object.hasOwn(input, "durationScope")
    && durationScopeValue !== "embedding-backed-search-upper-bound"
  ) {
    throw new TypeError(
      `${label}.durationScope must be embedding-backed-search-upper-bound when present.`,
    );
  }
  const durationScope: EvaluationResourceAccountingV2["embedding"]["durationScope"] =
    durationScopeValue === "embedding-backed-search-upper-bound"
      ? durationScopeValue
      : undefined;
  if (calls === 0) {
    if (
      inputTokens !== 0
      || durationMs !== 0
      || inputTokensMeasured !== undefined
      || durationScope !== undefined
    ) throw new TypeError(`${label} zero-call accounting must be the exact unannotated zero record.`);
  } else if (inputTokensMeasured === false && inputTokens !== 0) {
    throw new TypeError(`${label} unmeasured input tokens must use zero only as an explicit placeholder.`);
  }
  return Object.freeze({
    calls,
    inputTokens,
    ...(inputTokensMeasured === false ? { inputTokensMeasured: false as const } : {}),
    durationMs,
    ...(durationScope === undefined ? {} : { durationScope }),
  });
}

function parseChildAccounting(
  value: unknown,
  lane: KnowledgeBaseEvaluationRetrieverId,
): EvaluationResourceAccountingV2 {
  const input = record(value, `${lane} child accounting`);
  exactKeys(input, ["cacheBytes", "embedding", "llm", "packedContext", "peakRssBytes"], `${lane} child accounting`);
  const llm = record(ownData(input, "llm", `${lane} child accounting`), `${lane} child accounting.llm`);
  exactKeys(llm, ["calls", "inputTokens", "outputTokens"], `${lane} child accounting.llm`);
  if (
    ownData(llm, "calls", `${lane} child accounting.llm`) !== 0
    || ownData(llm, "inputTokens", `${lane} child accounting.llm`) !== 0
    || ownData(llm, "outputTokens", `${lane} child accounting.llm`) !== 0
  ) throw new TypeError(`${lane} child accounting requires literal-zero generative LLM counters.`);

  const embeddingCopy = copyEmbeddingAccounting(
    ownData(input, "embedding", `${lane} child accounting`),
    `${lane} child accounting.embedding`,
  );
  if (
    lane !== "semantic" && lane !== "hybrid"
    && (
      embeddingCopy.calls !== KNOWLEDGE_BASE_EVALUATION_EMBEDDING_NOT_INVOKED_V2.calls
      || embeddingCopy.inputTokens !== KNOWLEDGE_BASE_EVALUATION_EMBEDDING_NOT_INVOKED_V2.inputTokens
      || embeddingCopy.durationMs !== KNOWLEDGE_BASE_EVALUATION_EMBEDDING_NOT_INVOKED_V2.durationMs
    )
  ) throw new TypeError(`${lane} must use the fixed not-invoked embedding accounting record.`);

  const packedContext = record(
    ownData(input, "packedContext", `${lane} child accounting`),
    `${lane} child accounting.packedContext`,
  );
  exactKeys(packedContext, ["readerTokens", "utf8Bytes"], `${lane} child accounting.packedContext`);
  const packedContextCopy = Object.freeze({
    utf8Bytes: accountingInteger(
      ownData(packedContext, "utf8Bytes", `${lane} child accounting.packedContext`),
      `${lane} child accounting.packedContext.utf8Bytes`,
    ),
    readerTokens: accountingInteger(
      ownData(packedContext, "readerTokens", `${lane} child accounting.packedContext`),
      `${lane} child accounting.packedContext.readerTokens`,
    ),
  });
  if (packedContextCopy.utf8Bytes !== 0 || packedContextCopy.readerTokens !== 0) {
    throw new TypeError(`${lane} child retrieval may not include packed-context accounting.`);
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: embeddingCopy,
    packedContext: packedContextCopy,
    peakRssBytes: accountingInteger(
      ownData(input, "peakRssBytes", `${lane} child accounting`),
      `${lane} child accounting.peakRssBytes`,
    ),
    cacheBytes: accountingInteger(
      ownData(input, "cacheBytes", `${lane} child accounting`),
      `${lane} child accounting.cacheBytes`,
    ),
  });
}

async function childAccounting(
  provider: KnowledgeBaseEvaluationAccountingProviderV2,
  lane: KnowledgeBaseEvaluationRetrieverId,
  result: ValidatedLegacyResult,
): Promise<EvaluationResourceAccountingV2> {
  if (typeof provider !== "function") {
    throw new TypeError("Knowledge-base evaluation v2 requires a per-lane accounting provider.");
  }
  return parseChildAccounting(await provider(Object.freeze({
    lane,
    status: result.status,
    timings: result.timings,
    resources: result.resources,
  })), lane);
}

function aggregateChildAccounting(
  values: readonly EvaluationResourceAccountingV2[],
): EvaluationResourceAccountingV2 {
  const safeSum = (numbers: readonly number[], label: string): number => {
    const value = numbers.reduce((total, candidate) => total + candidate, 0);
    if (!Number.isSafeInteger(value)) throw new TypeError(`${label} exceeds the safe integer bound.`);
    return value;
  };
  const inputTokensMeasured = values.some(({ embedding }) => embedding.inputTokensMeasured === false)
    ? false as const
    : undefined;
  const durationScope = values.some(
    ({ embedding }) => embedding.durationScope === "embedding-backed-search-upper-bound",
  ) ? "embedding-backed-search-upper-bound" as const : undefined;
  const durationMs = values.reduce((total, { embedding }) => total + embedding.durationMs, 0);
  if (!Number.isFinite(durationMs)) throw new TypeError("embedding duration exceeds the finite bound.");
  const cacheValues = new Set(values.map(({ cacheBytes }) => cacheBytes));
  if (cacheValues.size > 1) {
    throw new TypeError("Closure lanes must report one identical shared-cache byte count.");
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: safeSum(values.map(({ embedding }) => embedding.calls), "embedding calls"),
      inputTokens: inputTokensMeasured === false
        ? 0
        : safeSum(values.map(({ embedding }) => embedding.inputTokens), "embedding input tokens"),
      ...(inputTokensMeasured === false ? { inputTokensMeasured } : {}),
      durationMs,
      ...(durationScope === undefined ? {} : { durationScope }),
    }),
    packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
    peakRssBytes: Math.max(0, ...values.map(({ peakRssBytes }) => peakRssBytes)),
    cacheBytes: values[0]?.cacheBytes ?? 0,
  });
}

function evaluationAccountingFromClosure(
  value: ExistingLaneClosureAccounting,
): EvaluationResourceAccountingV2 {
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: value.embedding.calls,
      inputTokens: value.embedding.inputTokens,
      ...(value.embedding.inputTokensMeasured === false
        ? { inputTokensMeasured: false as const }
        : {}),
      durationMs: value.embedding.durationMs,
      ...(value.embedding.durationScope === undefined
        ? {}
        : { durationScope: value.embedding.durationScope }),
    }),
    packedContext: Object.freeze({
      utf8Bytes: value.packedContext.utf8Bytes,
      readerTokens: value.packedContext.readerTokens,
    }),
    peakRssBytes: value.peakRssBytes,
    cacheBytes: value.cacheBytes,
  });
}

function accountingKey(value: EvaluationResourceAccountingV2): string {
  return JSON.stringify([
    value.llm.calls,
    value.llm.inputTokens,
    value.llm.outputTokens,
    value.embedding.calls,
    value.embedding.inputTokens,
    value.embedding.inputTokensMeasured,
    value.embedding.durationMs,
    value.embedding.durationScope,
    value.packedContext.utf8Bytes,
    value.packedContext.readerTokens,
    value.peakRssBytes,
    value.cacheBytes,
  ]);
}

function assertClosureAccountingMatchesInvocations(
  closure: EvaluationResourceAccountingV2,
  invoked: EvaluationResourceAccountingV2,
): void {
  if (accountingKey(closure) !== accountingKey(invoked)) {
    throw new TypeError("Closure aggregate accounting does not match its invoked lane accounting.");
  }
}

function singleLaneResult(options: Readonly<{
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly lane: KnowledgeBaseEvaluationRetrieverId;
  readonly applicable: boolean;
  readonly legacy: ValidatedLegacyResult;
  readonly bindings: EvidenceBindings;
  readonly accounting: EvaluationResourceAccountingV2;
  readonly elapsedMs: number;
}>): KnowledgeBaseEvaluationRetrieverResultV2 {
  const rows = options.legacy.hits.map((hit) => Object.freeze({
    hit,
    evidence: resolveHitEvidence(hit, options.bindings, options.lane),
  }));
  const resolved = rows.filter((row): row is typeof row & Readonly<{
    readonly evidence: readonly BoundEvidenceUnit[];
  }> => row.evidence !== undefined);
  const missingProvenanceCount = rows.length - resolved.length;
  const status = missingProvenanceCount > 0 && options.legacy.status === "ready"
    ? "degraded" as const
    : options.legacy.status;
  const diagnostics = Object.freeze([
    ...options.legacy.diagnostics,
    ...(missingProvenanceCount === 0
      ? []
      : [Object.freeze({
          code: "missing-provenance",
          lane: options.lane,
          status: "degraded" as const,
          message: `${missingProvenanceCount} ${options.lane} hit(s) lacked a lane-associated frozen source slice.`,
        })]),
  ]);
  const candidates = Object.freeze(resolved.map(({ hit, evidence }, index): EvaluationRankedCandidateV2 =>
    Object.freeze({
      documentId: hit.documentId,
      evidenceUnitIds: Object.freeze(evidence.map(({ evidenceUnitId }) => evidenceUnitId)),
      rank: index + 1,
      ...(hit.score === undefined ? {} : { score: hit.score }),
      provenance: Object.freeze(evidence.map(({ locator }) => locator)),
    })));
  const laneOutcome: EvaluationLaneOutcomeV2 = Object.freeze({
    laneId: options.lane,
    applicability: options.applicable ? "applied" : "skipped",
    status,
    reasonCodes: reasonCodes(diagnostics, options.applicable, status),
    rawRanking: options.applicable
      ? Object.freeze(rows.map(({ hit, evidence }): EvaluationRankedCandidateV2 => Object.freeze({
          documentId: hit.documentId,
          evidenceUnitIds: Object.freeze(evidence?.map(({ evidenceUnitId }) => evidenceUnitId) ?? []),
          rank: hit.rank,
          ...(hit.score === undefined ? {} : { score: hit.score }),
          provenance: Object.freeze(evidence?.map(({ locator }) => locator) ?? []),
        })))
      : Object.freeze([]),
  });
  if (!options.applicable && options.legacy.hits.length > 0) {
    throw new TypeError(`Legacy ${options.lane} lane returned hits without executable input.`);
  }
  const trace: EvaluationRetrieverTraceV2 = Object.freeze({
    laneOutcomes: Object.freeze([laneOutcome]),
    candidateDecisions: Object.freeze(rows.map(({ hit, evidence }): EvaluationCandidateDecisionV2 =>
      Object.freeze({
        documentId: hit.documentId,
        evidenceUnitIds: Object.freeze(evidence?.map(({ evidenceUnitId }) => evidenceUnitId) ?? []),
        laneId: options.lane,
        sourceRank: hit.rank,
        disposition: evidence === undefined ? "excluded" : "accepted",
        reasonCodes: Object.freeze([
          evidence === undefined ? "missing-provenance" as const : "primary" as const,
        ]),
        provenance: Object.freeze(evidence?.map(({ locator }) => locator) ?? []),
        ...(evidence === undefined
          ? {}
          : { outputRank: resolved.findIndex((candidate) => candidate.hit === hit) + 1 }),
      }))),
  });
  const evidenceUnits = Object.freeze([...new Map(resolved.flatMap(({ evidence }) =>
    evidence.map((candidate) => [candidate.evidenceUnitId, candidate] as const))).values()]
    .map(publicEvidenceUnit));
  return Object.freeze({
    retrieverId: options.descriptor.id,
    status,
    candidates,
    trace,
    diagnostics,
    rawEvidence: Object.freeze(rows.map(({ hit, evidence }) => Object.freeze({
      laneId: options.lane,
      documentId: hit.documentId,
      rank: hit.rank,
      ...(hit.evidence === undefined ? {} : { evidence: hit.evidence }),
      ...(evidence === undefined
        ? {}
        : { provenance: Object.freeze(evidence.map(publicEvidenceUnit)) }),
    }))),
    evidenceUnits,
    timings: options.legacy.timings,
    rawResources: options.legacy.resources,
    resources: options.accounting,
    elapsedMs: options.elapsedMs,
  });
}

function closureHit(
  hit: ValidatedLegacyHit,
  bindings: EvidenceBindings,
  lane: KnowledgeBaseEvaluationRetrieverId,
): ExistingLaneClosureHit {
  const evidence = resolveHitEvidence(hit, bindings, lane);
  return Object.freeze({
    documentId: hit.documentId,
    canonicalDocumentId: hit.documentId.normalize("NFC"),
    rank: hit.rank,
    ...(hit.score === undefined ? {} : { score: hit.score }),
    evidenceUnits: Object.freeze(evidence === undefined
      ? []
      : evidence.map((candidate) => Object.freeze({
          id: candidate.evidenceUnitId,
          locator: closureEvidenceLocator(candidate),
        }))),
    ...(hit.evidence === undefined ? {} : { evidence: hit.evidence }),
  });
}

function closureDiagnostic(
  diagnostic: KnowledgeBaseEvaluationDiagnosticV2,
): ExistingLaneClosureDiagnostic {
  return Object.freeze({
    code: diagnostic.code,
    status: diagnostic.status,
    ...(diagnostic.message === undefined ? {} : { message: diagnostic.message }),
    details: Object.freeze({ lane: diagnostic.lane }),
  });
}

function closureBackend<Input>(options: Readonly<{
  readonly lane: KnowledgeBaseEvaluationRetrieverId;
  readonly retriever: EvaluationRetriever;
  readonly corpus: RetrievalEvaluationCorpusV2["frozen"];
  readonly bindings: EvidenceBindings;
  readonly accounting: KnowledgeBaseEvaluationAccountingProviderV2;
  readonly recordAccounting: (
    lane: KnowledgeBaseEvaluationRetrieverId,
    accounting: EvaluationResourceAccountingV2,
  ) => void;
  readonly toInputs: (input: Input) => Readonly<Record<string, unknown>>;
}>): ExistingLaneClosureBackend<Input> {
  return Object.freeze({
    retrieve: async ({ input, limit, signal }): Promise<ExistingLaneClosureLaneResult> => {
      throwIfAborted(signal);
      const raw = await options.retriever.retrieve({
        corpus: options.corpus,
        query: legacyQueryBridge(options.toInputs(input)),
        limit,
        signal,
      });
      throwIfAborted(signal);
      const result = validateLegacyResult(raw, options.lane, limit);
      const accounting = await childAccounting(options.accounting, options.lane, result);
      options.recordAccounting(options.lane, accounting);
      return Object.freeze({
        status: result.status,
        hits: Object.freeze(result.hits.map((hit) =>
          closureHit(hit, options.bindings, options.lane))),
        diagnostics: Object.freeze(result.diagnostics.map(closureDiagnostic)),
        timings: result.timings,
        resources: result.resources,
        accounting,
      });
    },
  });
}

function closureBackends(
  retrievers: LegacyRetrieverBindings,
  corpus: RetrievalEvaluationCorpusV2["frozen"],
  bindings: EvidenceBindings,
  accounting: KnowledgeBaseEvaluationAccountingProviderV2,
  recordAccounting: (
    lane: KnowledgeBaseEvaluationRetrieverId,
    accounting: EvaluationResourceAccountingV2,
  ) => void,
): ExistingLaneClosureBackends {
  return Object.freeze({
    hybrid: closureBackend<ExistingLaneClosureHybridInput>({
      lane: "hybrid",
      retriever: retrievers.hybrid,
      corpus,
      bindings,
      accounting,
      recordAccounting,
      toInputs: (input) => Object.freeze({ text: input.text }),
    }),
    metadata: closureBackend<ExistingLaneClosureMetadataInput>({
      lane: "metadata",
      retriever: retrievers.metadata,
      corpus,
      bindings,
      accounting,
      recordAccounting,
      toInputs: (input) => Object.freeze({ metadata: input }),
    }),
    graph: closureBackend<ExistingLaneClosureGraphInput>({
      lane: "graph",
      retriever: retrievers.graph,
      corpus,
      bindings,
      accounting,
      recordAccounting,
      toInputs: (input) => Object.freeze({ graph: input }),
    }),
    pathContext: closureBackend<ExistingLaneClosurePathContextInput>({
      lane: "path-context",
      retriever: retrievers["path-context"],
      corpus,
      bindings,
      accounting,
      recordAccounting,
      toInputs: (input) => Object.freeze({ context: input }),
    }),
    git: closureBackend<ExistingLaneClosureGitInput>({
      lane: "git",
      retriever: retrievers.git,
      corpus,
      bindings,
      accounting,
      recordAccounting,
      toInputs: (input) => Object.freeze({ history: input }),
    }),
  });
}

function closureInputs(
  inputs: RetrievalEvaluationCorpusV2["queries"][number]["inputs"],
): ExistingLaneClosureExecutableInputs {
  return Object.freeze({
    hybrid: Object.freeze({ text: inputs.text }),
    ...(inputs.metadata === undefined ? {} : { metadata: inputs.metadata }),
    ...(inputs.graph === undefined ? {} : { graph: inputs.graph }),
    ...(inputs.context === undefined ? {} : { pathContext: inputs.context }),
    ...(inputs.history === undefined ? {} : { history: inputs.history }),
  });
}

function mapClosureLaneOutcome(
  lane: ExistingLaneClosureResult["trace"]["lanes"][number],
  bindings: EvidenceBindings,
): EvaluationLaneOutcomeV2 {
  const rawRanking = Object.freeze(lane.candidates.map((candidate): EvaluationRankedCandidateV2 => {
    const provenance = bindingsFromClosureProvenance(candidate.provenance, bindings);
    return Object.freeze({
      documentId: candidate.canonicalDocumentId,
      evidenceUnitIds: Object.freeze(provenance.map(({ evidenceUnitId }) => evidenceUnitId)),
      rank: candidate.sourceRank,
      provenance: Object.freeze(provenance.map(({ locator }) => locator)),
    });
  }));
  if (lane.invocation === "invoked") {
    if (rawRanking.some(({ rank }, index) => rank !== index + 1)) {
      throw new TypeError(`Closure ${lane.lane} did not preserve contiguous source ranks.`);
    }
    if (new Set(rawRanking.map(({ documentId }) => documentId)).size !== rawRanking.length) {
      throw new TypeError(`Closure ${lane.lane} raw ranking repeats a canonical document.`);
    }
  }
  const status = lane.invocation === "disabled"
    ? "ready"
    : lane.invocation === "skipped-missing-input"
      ? "unavailable"
      : lane.status as "degraded" | "ready" | "unavailable";
  const codes = [
    ...lane.diagnostics.map(({ code }) => canonicalId(code, `closure ${lane.lane} diagnostic code`)),
    ...(lane.invocation === "disabled" ? ["disabled"] : []),
    ...(lane.invocation === "skipped-missing-input" ? ["missing-input"] : []),
  ];
  return Object.freeze({
    laneId: lane.lane,
    applicability: lane.invocation === "invoked" ? "applied" : "skipped",
    status,
    reasonCodes: Object.freeze([...new Set(codes)].toSorted()),
    rawRanking: lane.invocation === "invoked" && status !== "unavailable"
      ? rawRanking
      : Object.freeze([]),
  });
}

function mapClosureResult(options: Readonly<{
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly result: ExistingLaneClosureResult;
  readonly bindings: EvidenceBindings;
  readonly accounting: EvaluationResourceAccountingV2;
  readonly elapsedMs: number;
}>): KnowledgeBaseEvaluationRetrieverResultV2 {
  const laneOrder = new Map(options.descriptor.lanes.map((lane, index) => [lane, index]));
  const outcomesByLane = new Map(options.result.trace.lanes.map((lane) => [lane.lane, lane]));
  const laneOutcomes = Object.freeze(options.descriptor.lanes.map((lane) => {
    const outcome = outcomesByLane.get(lane as ExistingLaneClosureLaneId);
    if (outcome === undefined) throw new TypeError(`Closure trace is missing locked lane ${lane}.`);
    return mapClosureLaneOutcome(outcome, options.bindings);
  }));
  const candidateDecisions = Object.freeze(options.result.trace.lanes
    .flatMap((lane) => lane.candidates.map((candidate): EvaluationCandidateDecisionV2 => {
      const provenance = bindingsFromClosureProvenance(candidate.provenance, options.bindings);
      return Object.freeze({
        documentId: candidate.canonicalDocumentId,
        evidenceUnitIds: Object.freeze(provenance.map(({ evidenceUnitId }) => evidenceUnitId)),
        laneId: candidate.lane,
        sourceRank: candidate.sourceRank,
        disposition: candidate.decision,
        reasonCodes: Object.freeze([candidate.reasonCode as EvaluationCandidateReasonV2]),
        ...(candidate.decision === "accepted" && candidate.outputRank !== undefined
          ? { outputRank: candidate.outputRank }
          : {}),
        provenance: Object.freeze(provenance.map(({ locator }) => locator)),
      });
    }))
    .toSorted((left, right) =>
      (laneOrder.get(left.laneId) ?? Number.MAX_SAFE_INTEGER)
      - (laneOrder.get(right.laneId) ?? Number.MAX_SAFE_INTEGER)
      || left.sourceRank - right.sourceRank
      || left.documentId.localeCompare(right.documentId)));
  const candidates = Object.freeze(options.result.hits.map((hit, index): EvaluationRankedCandidateV2 => {
    const document = options.result.trace.documents[index];
    const provenance = document === undefined
      ? Object.freeze([])
      : uniqueBindingsFromClosureProvenance(
          document.sources.flatMap(({ provenance }) => provenance),
          options.bindings,
        );
    if (provenance.length === 0) {
      throw new TypeError(`Accepted closure candidate ${hit.canonicalDocumentId} lacks exact unit provenance.`);
    }
    return Object.freeze({
      documentId: hit.canonicalDocumentId,
      evidenceUnitIds: Object.freeze(provenance.map(({ evidenceUnitId }) => evidenceUnitId)),
      rank: index + 1,
      ...(hit.score === undefined ? {} : { score: hit.score }),
      provenance: Object.freeze(provenance.map(({ locator }) => locator)),
    });
  }));
  const diagnostics = Object.freeze(options.result.trace.lanes.flatMap((lane) =>
    lane.diagnostics.map((diagnostic) => Object.freeze({
      code: diagnostic.code,
      lane: lane.lane,
      status: diagnostic.status,
      ...(diagnostic.message === undefined ? {} : { message: diagnostic.message }),
    }))));
  const evidenceUnits = Object.freeze([...new Map(options.result.trace.lanes.flatMap((lane) =>
    lane.candidates.flatMap((candidate) => bindingsFromClosureProvenance(
      candidate.provenance,
      options.bindings,
    ).map((evidence) => [evidence.evidenceUnitId, evidence] as const)))).values()]
    .map(publicEvidenceUnit));
  const rawEvidence = Object.freeze(laneOutcomes.flatMap((outcome) => {
    const lane = outcomesByLane.get(outcome.laneId as ExistingLaneClosureLaneId);
    if (lane === undefined) {
      throw new TypeError(`Closure trace is missing locked lane ${outcome.laneId}.`);
    }
    return outcome.rawRanking.map((ranking) => {
      const matching = lane.candidates.filter((candidate) =>
        candidate.canonicalDocumentId === ranking.documentId
        && candidate.sourceRank === ranking.rank);
      if (matching.length !== 1) {
        throw new TypeError(
          `Closure raw evidence cannot join ${outcome.laneId} rank ${ranking.rank} exactly once.`,
        );
      }
      const candidate = matching[0]!;
      const evidence = bindingsFromClosureProvenance(candidate.provenance, options.bindings);
      return Object.freeze({
        laneId: outcome.laneId,
        documentId: ranking.documentId,
        rank: ranking.rank,
        ...(candidate.evidence === undefined ? {} : { evidence: candidate.evidence }),
        ...(evidence.length === 0
          ? {}
          : { provenance: Object.freeze(evidence.map(publicEvidenceUnit)) }),
      });
    });
  }));
  return Object.freeze({
    retrieverId: options.descriptor.id,
    status: options.result.status,
    candidates,
    trace: Object.freeze({ laneOutcomes, candidateDecisions }),
    diagnostics,
    rawEvidence,
    evidenceUnits,
    timings: options.result.timings,
    rawResources: options.result.resources,
    resources: options.accounting,
    elapsedMs: options.elapsedMs,
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("Knowledge-base evaluation v2 retrieval was aborted.");
}

function elapsed(startedAt: number, now: () => number): number {
  const duration = now() - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

function validateLaneDescriptor(
  lane: KnowledgeBaseEvaluationRetrieverId,
  descriptor: EvaluationRetrieverDescriptorV2,
): number {
  if (descriptor.lanes.length !== 1 || descriptor.lanes[0] !== lane) {
    throw new TypeError(`Descriptor ${descriptor.id} must expose only ${lane} lane.`);
  }
  const retrieveLimit = positiveLimit(
    descriptor.configuration["retrieve-limit"],
    `descriptor ${descriptor.id} retrieve-limit`,
  );
  const expected = laneConfiguration(lane, retrieveLimit);
  if (JSON.stringify(descriptor.configuration) !== JSON.stringify(expected)) {
    throw new TypeError(`Descriptor ${descriptor.id} configuration does not match the executable lane contract.`);
  }
  return retrieveLimit;
}

function validateClosureDescriptor(pair: KnowledgeBaseExistingLaneClosureDescriptorV2): void {
  const frozen = freezeExistingLaneClosureVariant(pair.variant);
  if (JSON.stringify(pair.descriptor.configuration) !== JSON.stringify(closureConfiguration(frozen))) {
    throw new TypeError(`Closure descriptor ${pair.descriptor.id} does not bind its complete variant.`);
  }
  if (JSON.stringify(pair.descriptor.lanes) !== JSON.stringify(closureDescriptorLanes(frozen))) {
    throw new TypeError(`Closure descriptor ${pair.descriptor.id} lanes do not match its variant.`);
  }
}

function implementationArtifactsByRetrieverId(
  artifacts: readonly VerifiedEvaluationImplementationArtifactV2[],
  descriptors: readonly EvaluationRetrieverDescriptorV2[],
): ReadonlyMap<string, VerifiedEvaluationImplementationArtifactV2> {
  const artifactArrayIsValid: boolean = Array.isArray(artifacts);
  if (!artifactArrayIsValid) {
    throw new TypeError("implementationArtifacts must be an exact one-per-descriptor array.");
  }
  const expectedIds = new Set(descriptors.map(({ id }) => id));
  const byRetrieverId = new Map<string, VerifiedEvaluationImplementationArtifactV2>();
  for (const artifact of artifacts) {
    const retrieverId = artifact?.retrieverId;
    if (typeof retrieverId !== "string") {
      throw new TypeError("implementationArtifacts contains an invalid artifact entry.");
    }
    if (byRetrieverId.has(retrieverId)) {
      throw new TypeError(`Implementation artifact for retriever ${retrieverId} is duplicated.`);
    }
    if (!expectedIds.has(retrieverId)) {
      throw new TypeError(`Implementation artifact for retriever ${retrieverId} is extra.`);
    }
    byRetrieverId.set(retrieverId, artifact);
  }
  for (const descriptor of descriptors) {
    if (!byRetrieverId.has(descriptor.id)) {
      throw new TypeError(`Implementation artifact for retriever ${descriptor.id} is missing.`);
    }
  }
  return byRetrieverId;
}

function createSingleLaneExecutionRetriever(options: Readonly<{
  readonly contract: KnowledgeBaseEvaluationExecutionContractV2;
  readonly descriptorId: string;
  readonly lane: KnowledgeBaseEvaluationRetrieverId;
  readonly accounting: KnowledgeBaseEvaluationAccountingProviderV2;
  readonly now: () => number;
}>): KnowledgeBaseEvaluationRetrieverV2 {
  const descriptor = options.contract.descriptorsById[options.descriptorId];
  if (descriptor === undefined) {
    throw new TypeError(`Execution contract is missing descriptor ${options.descriptorId}.`);
  }
  const legacy = options.contract.legacyRetrievers[options.lane];
  return Object.freeze({
    descriptor,
    retrieve: async (request): Promise<KnowledgeBaseEvaluationRetrieverResultV2> => {
      assertFrozenSnapshot(options.contract.frozen, request.corpus);
      assertRequestLimit(descriptor, request.limit);
      throwIfAborted(request.signal);
      const inputs = executionInputs(request);
      const applicable = laneIsApplicable(options.lane, inputs);
      if (!applicable) {
        return singleLaneResult({
          descriptor,
          lane: options.lane,
          applicable: false,
          legacy: Object.freeze({
            status: "unavailable",
            hits: Object.freeze([]),
            diagnostics: Object.freeze([]),
            timings: Object.freeze({}),
            resources: Object.freeze({}),
          }),
          bindings: options.contract.evidenceBindings,
          accounting: aggregateChildAccounting([]),
          elapsedMs: 0,
        });
      }
      const startedAt = options.now();
      const raw = await legacy.retrieve({
        corpus: options.contract.frozen,
        query: legacyQueryBridge(inputForLegacyLane(options.lane, inputs)),
        limit: request.limit,
        signal: request.signal,
      });
      throwIfAborted(request.signal);
      const legacyResult = validateLegacyResult(raw, options.lane, request.limit);
      const accounting = await childAccounting(options.accounting, options.lane, legacyResult);
      throwIfAborted(request.signal);
      return singleLaneResult({
        descriptor,
        lane: options.lane,
        applicable,
        legacy: legacyResult,
        bindings: options.contract.evidenceBindings,
        accounting,
        elapsedMs: elapsed(startedAt, options.now),
      });
    },
  });
}

function createClosureExecutionRetriever(options: Readonly<{
  readonly contract: KnowledgeBaseEvaluationExecutionContractV2;
  readonly descriptorId: string;
  readonly variant: ExistingLaneClosureVariant;
  readonly accounting: KnowledgeBaseEvaluationAccountingProviderV2;
  readonly now: () => number;
}>): KnowledgeBaseEvaluationRetrieverV2 {
  const descriptor = options.contract.descriptorsById[options.descriptorId];
  if (descriptor === undefined) {
    throw new TypeError(`Execution contract is missing descriptor ${options.descriptorId}.`);
  }
  const variant = freezeExistingLaneClosureVariant(options.variant);
  return Object.freeze({
    descriptor,
    retrieve: async (request): Promise<KnowledgeBaseEvaluationRetrieverResultV2> => {
      assertFrozenSnapshot(options.contract.frozen, request.corpus);
      assertRequestLimit(descriptor, request.limit);
      throwIfAborted(request.signal);
      const inputs = executionInputs(request);
      const startedAt = options.now();
      const childAccountingByLane = new Map<
        KnowledgeBaseEvaluationRetrieverId,
        EvaluationResourceAccountingV2
      >();
      const backends = closureBackends(
        options.contract.legacyRetrievers,
        options.contract.frozen,
        options.contract.evidenceBindings,
        options.accounting,
        (lane, accounting) => {
          if (childAccountingByLane.has(lane)) {
            throw new TypeError(`Closure invoked ${lane} accounting more than once.`);
          }
          childAccountingByLane.set(lane, accounting);
        },
      );
      const result = await runExistingLaneClosure({
        variant,
        query: Object.freeze({ inputs: closureInputs(inputs) }),
        backends,
        evidenceRegistry: options.contract.closureEvidenceRegistry,
        signal: request.signal,
      });
      throwIfAborted(request.signal);
      const invokedAccounting = aggregateChildAccounting([...childAccountingByLane.values()]);
      const closureAccounting = evaluationAccountingFromClosure(result.accounting);
      assertClosureAccountingMatchesInvocations(closureAccounting, invokedAccounting);
      return mapClosureResult({
        descriptor,
        result,
        bindings: options.contract.evidenceBindings,
        accounting: closureAccounting,
        elapsedMs: elapsed(startedAt, options.now),
      });
    },
  });
}

/** Adapt one verified immutable legacy session without changing production search. */
export function adaptVerifiedKnowledgeBaseEvaluationV2(
  options: AdaptVerifiedKnowledgeBaseEvaluationV2Options,
): KnowledgeBaseEvaluationV2 {
  const clock = options.now ?? performance.now.bind(performance);
  const accounting = options.accounting;
  const close = options.evaluation.close;
  if (typeof accounting !== "function") {
    throw new TypeError("Knowledge-base evaluation v2 requires a per-lane accounting provider.");
  }
  const closureDescriptors = options.closureDescriptors ?? Object.freeze([]);
  const descriptors: EvaluationRetrieverDescriptorV2[] = [];
  const laneDescriptorIds = new Map<KnowledgeBaseEvaluationRetrieverId, string>();
  for (const lane of knowledgeBaseEvaluationRetrieverIds) {
    const descriptor = options.laneDescriptors[lane];
    validateLaneDescriptor(lane, descriptor);
    descriptors.push(descriptor);
    laneDescriptorIds.set(lane, descriptor.id);
  }
  const closureIds = new Set<string>();
  const lockedClosures: Readonly<{
    readonly descriptorId: string;
    readonly variant: ExistingLaneClosureVariant;
  }>[] = [];
  for (const pair of closureDescriptors) {
    validateClosureDescriptor(pair);
    if (closureIds.has(pair.descriptor.id)) {
      throw new TypeError(`Closure descriptor ID ${pair.descriptor.id} is repeated.`);
    }
    closureIds.add(pair.descriptor.id);
    descriptors.push(pair.descriptor);
    lockedClosures.push(Object.freeze({
      descriptorId: pair.descriptor.id,
      variant: freezeExistingLaneClosureVariant(pair.variant),
    }));
  }
  if (new Set(descriptors.map(({ id }) => id)).size !== descriptors.length) {
    throw new TypeError("Knowledge-base evaluation v2 descriptor IDs must be unique.");
  }
  const implementationArtifacts = implementationArtifactsByRetrieverId(
    options.implementationArtifacts,
    descriptors,
  );
  for (const descriptor of descriptors) {
    const artifact = implementationArtifacts.get(descriptor.id);
    if (artifact === undefined) {
      throw new TypeError(`Implementation artifact for retriever ${descriptor.id} is missing.`);
    }
    assertEvaluationImplementationArtifactV2(artifact, options.corpus, descriptor);
  }
  const evidenceBindings = buildEvidenceBindings(options.evidenceRegistry, options.corpus);
  const legacyRetrievers = bindLegacyRetrievers(options.evaluation);
  const contract = createExecutionContract({
    corpus: options.corpus,
    descriptors,
    evidenceBindings,
    legacyRetrievers,
  });

  const retrievers: KnowledgeBaseEvaluationRetrieverV2[] = [];
  for (const lane of knowledgeBaseEvaluationRetrieverIds) {
    const descriptorId = laneDescriptorIds.get(lane);
    if (descriptorId === undefined) throw new TypeError(`Execution contract is missing ${lane} lane.`);
    retrievers.push(createSingleLaneExecutionRetriever({
      contract,
      descriptorId,
      lane,
      accounting,
      now: clock,
    }));
  }

  for (const closure of lockedClosures) {
    retrievers.push(createClosureExecutionRetriever({
      contract,
      descriptorId: closure.descriptorId,
      variant: closure.variant,
      accounting,
      now: clock,
    }));
  }
  if (new Set(retrievers.map(({ descriptor }) => descriptor.id)).size !== retrievers.length) {
    throw new TypeError("Knowledge-base evaluation v2 descriptor IDs must be unique.");
  }
  const evaluationV2: KnowledgeBaseEvaluationV2 = Object.freeze({
    retrievers: Object.freeze(retrievers),
    close,
  });
  verifiedKnowledgeBaseEvaluationsV2.set(evaluationV2, Object.freeze({
    suiteSha256: contract.manifest.corpusSha256,
    candidateLockSha256: contract.manifest.candidateLockSha256,
    buildContractSha256: contract.manifest.buildContractSha256,
    repositoryCommit: contract.frozen.repositoryCommit,
    vaultTree: contract.frozen.vaultTree,
  }));
  return evaluationV2;
}

/** Open the existing verified immutable scan/session, then adapt its lanes to v2. */
export async function openKnowledgeBaseEvaluationV2(
  options: OpenKnowledgeBaseEvaluationV2Options,
): Promise<KnowledgeBaseEvaluationV2> {
  const {
    corpus,
    evidenceRegistry,
    accounting,
    laneDescriptors,
    closureDescriptors,
    implementationArtifacts,
    now,
    openEvaluation = openKnowledgeBaseEvaluation,
    ...legacyOptions
  } = options;
  const evaluation = await openEvaluation({
    ...legacyOptions,
    corpus: legacyCorpusBridge(corpus.frozen),
    ...(now === undefined ? {} : { now }),
  });
  try {
    return adaptVerifiedKnowledgeBaseEvaluationV2({
      corpus,
      evidenceRegistry,
      accounting,
      evaluation,
      laneDescriptors,
      implementationArtifacts,
      ...(closureDescriptors === undefined ? {} : { closureDescriptors }),
      ...(now === undefined ? {} : { now }),
    });
  } catch (error) {
    await evaluation.close();
    throw error;
  }
}

/** Convert a successful adapter result into the strict repeated-sample schema. */
export function createKnowledgeBaseEvaluationRepeatedSampleV2(options: Readonly<{
  readonly result: KnowledgeBaseEvaluationRetrieverResultV2;
  readonly profileId: string;
  readonly queryId?: string;
  readonly repetition: number;
  readonly concurrencyBatchIdentity?: string;
  readonly timings?: Partial<EvaluationRepeatedSampleV2["timings"]>;
  readonly embedding?: EvaluationResourceAccountingV2["embedding"];
  readonly packedContext?: EvaluationResourceAccountingV2["packedContext"];
  readonly packedContextTrace?: NonNullable<EvaluationRepeatedSampleV2["packedContextTrace"]>;
  readonly peakRssBytes?: number;
  readonly cacheBytes?: number;
}>): EvaluationRepeatedSampleV2 {
  const finite = (value: number, label: string): number => {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be non-negative and finite.`);
    return value;
  };
  const integer = (value: number, label: string): number => {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer.`);
    return value;
  };
  if (!Number.isSafeInteger(options.repetition) || options.repetition < 1) {
    throw new TypeError("sample repetition must be a positive integer.");
  }
  const concurrencyBatchIdentity = options.concurrencyBatchIdentity === undefined
    ? undefined
    : boundedText(
        options.concurrencyBatchIdentity,
        "sample concurrencyBatchIdentity",
        512,
      );
  const timings = Object.freeze({
    elapsedMs: finite(options.timings?.elapsedMs ?? options.result.elapsedMs, "sample elapsedMs"),
    indexMs: finite(options.timings?.indexMs ?? 0, "sample indexMs"),
    updateMs: finite(options.timings?.updateMs ?? 0, "sample updateMs"),
    queryMs: finite(options.timings?.queryMs ?? options.result.elapsedMs, "sample queryMs"),
    packingMs: finite(options.timings?.packingMs ?? 0, "sample packingMs"),
  });
  const embedding = copyEmbeddingAccounting(
    options.embedding ?? options.result.resources.embedding,
    "sample embedding",
  );
  const packedContext = options.packedContext ?? options.result.resources.packedContext;
  const packedContextTrace = options.packedContextTrace === undefined
    ? undefined
    : Object.freeze({
        evidenceUnitIds: Object.freeze(options.packedContextTrace.evidenceUnitIds.map((id, index) =>
          boundedText(id, `sample packedContextTrace.evidenceUnitIds[${index}]`, 512))),
        truncated: options.packedContextTrace.truncated,
        packedBytesSha256: boundedText(
          options.packedContextTrace.packedBytesSha256,
          "sample packedContextTrace.packedBytesSha256",
          64,
        ),
      });
  return Object.freeze({
    retrieverId: options.result.retrieverId,
    profileId: canonicalId(options.profileId, "sample profileId"),
    ...(options.queryId === undefined
      ? {}
      : { queryId: boundedText(options.queryId, "sample queryId", 256) }),
    repetition: options.repetition,
    ...(concurrencyBatchIdentity === undefined ? {} : { concurrencyBatchIdentity }),
    status: options.result.status,
    timings,
    resources: Object.freeze({
      llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
      embedding: Object.freeze({
        calls: embedding.calls,
        inputTokens: embedding.inputTokens,
        ...(embedding.inputTokensMeasured === false
          ? { inputTokensMeasured: false as const }
          : {}),
        durationMs: embedding.durationMs,
        ...(embedding.durationScope === undefined
          ? {}
          : { durationScope: embedding.durationScope }),
      }),
      packedContext: Object.freeze({
        utf8Bytes: integer(packedContext.utf8Bytes, "sample packedContext.utf8Bytes"),
        readerTokens: integer(packedContext.readerTokens, "sample packedContext.readerTokens"),
      }),
      peakRssBytes: integer(
        options.peakRssBytes ?? options.result.resources.peakRssBytes,
        "sample peakRssBytes",
      ),
      cacheBytes: integer(
        options.cacheBytes ?? options.result.resources.cacheBytes,
        "sample cacheBytes",
      ),
    }),
    trace: options.result.trace,
    rawEvidence: Object.freeze(options.result.rawEvidence.map((row) => Object.freeze({
      laneId: row.laneId,
      documentId: row.documentId,
      rank: row.rank,
      ...(row.evidence === undefined
        ? {}
        : { evidence: immutableEvidenceCopy(row.evidence) }),
    }))),
    ...(packedContextTrace === undefined ? {} : { packedContextTrace }),
  });
}
