export const MAX_EXISTING_LANE_CLOSURE_RESULTS = 1_000;
export const MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES = 4_096;
export const MAX_EXISTING_LANE_CLOSURE_EVIDENCE_UNITS = 100;
export const MAX_EXISTING_LANE_CLOSURE_TOTAL_EVIDENCE_UNITS = 512;
export const MAX_EXISTING_LANE_CLOSURE_PROVENANCE_BYTES = 256 * 1_024;
export const MAX_EXISTING_LANE_CLOSURE_EVIDENCE_BYTES = 8 * 1_024 * 1_024;
export const MAX_EXISTING_LANE_CLOSURE_DIAGNOSTICS = 100;
export const EXISTING_LANE_CLOSURE_FUSION = "primary-prefix-then-round-robin-v1";

export const existingLaneClosureStructuralLaneIds = Object.freeze([
  "metadata",
  "graph",
  "path-context",
] as const);

export type ExistingLaneClosureStructuralLaneId =
  typeof existingLaneClosureStructuralLaneIds[number];
export type ExistingLaneClosureLaneId =
  | "hybrid"
  | ExistingLaneClosureStructuralLaneId
  | "git";

export type ExistingLaneClosureVariant = Readonly<{
  readonly primary: Readonly<{
    readonly lane: "hybrid";
    readonly retrieveLimit: number;
    readonly retainLimit: number;
  }> | null;
  readonly structuralLanes: readonly Readonly<{
    readonly lane: ExistingLaneClosureStructuralLaneId;
    readonly limit: number;
  }>[];
  readonly git:
    | Readonly<{ readonly mode: "off" }>
    | Readonly<{ readonly mode: "explicit-input"; readonly limit: number }>;
  readonly outputLimit: number;
}>;

export type ExistingLaneClosureMetadataFilter =
  | Readonly<{ readonly kind: "exists"; readonly path: string }>
  | Readonly<{
    readonly kind: "equals";
    readonly path: string;
    readonly value: string | number | boolean | null;
  }>;

export type ExistingLaneClosureHybridInput = Readonly<{ readonly text: string }>;
export type ExistingLaneClosureMetadataInput = Readonly<{
  readonly filters: readonly ExistingLaneClosureMetadataFilter[];
  readonly tags: readonly string[];
}>;
export type ExistingLaneClosureGraphInput = Readonly<{
  readonly seeds: readonly string[];
  readonly depth: 1 | 2;
}>;
export type ExistingLaneClosurePathContextInput = Readonly<{
  readonly repositoryPath: string;
}>;
export type ExistingLaneClosureGitInput = Readonly<{
  readonly query: string;
  readonly noteIds: readonly string[];
}>;

export type ExistingLaneClosureExecutableInputs = Readonly<{
  readonly hybrid?: ExistingLaneClosureHybridInput;
  readonly metadata?: ExistingLaneClosureMetadataInput;
  readonly graph?: ExistingLaneClosureGraphInput;
  readonly pathContext?: ExistingLaneClosurePathContextInput;
  readonly history?: ExistingLaneClosureGitInput;
}>;

export type ExistingLaneClosureQuery = Readonly<{
  readonly inputs: ExistingLaneClosureExecutableInputs;
}>;

export type ExistingLaneClosureSourceClass =
  | "authored-note"
  | "captured-source"
  | "git-history"
  | "repository-file";

export type ExistingLaneClosureTrustClass =
  | "authoritative-current"
  | "authoritative-historical"
  | "captured-primary"
  | "captured-secondary"
  | "maintained-synthesis"
  | "untrusted-capture";

export type ExistingLaneClosureEvidenceLocator = Readonly<{
  readonly evidenceUnitId: string;
  readonly documentId: string;
  readonly sourceFamilyId: string;
  readonly sourceClass: ExistingLaneClosureSourceClass;
  readonly trustClass: ExistingLaneClosureTrustClass;
  readonly sourcePath: string;
  readonly lineRange: Readonly<{ readonly start: number; readonly end: number }>;
  readonly headingPath: readonly string[];
  readonly sourcePage?: number;
}>;

/** Compatibility name retained for adapters; provenance is now a typed locator. */
export type ExistingLaneClosureProvenance = ExistingLaneClosureEvidenceLocator;

export type ExistingLaneClosureEvidenceRegistry = Readonly<{
  readonly units: readonly ExistingLaneClosureEvidenceLocator[];
}>;

export type ExistingLaneClosureEvidenceUnit = Readonly<{
  readonly id: string;
  /** The ID and locator stay paired and must exactly match the injected registry. */
  readonly locator: ExistingLaneClosureEvidenceLocator;
}>;

export type ExistingLaneClosureHit = Readonly<{
  readonly documentId: string;
  readonly canonicalDocumentId: string;
  readonly rank: number;
  readonly score?: number;
  readonly evidenceUnits?: readonly ExistingLaneClosureEvidenceUnit[];
  readonly evidence?: unknown;
}>;

export type ExistingLaneClosureDiagnostic = Readonly<{
  readonly code: string;
  readonly status: "degraded" | "ready" | "unavailable";
  readonly message?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type ExistingLaneClosureAccounting = Readonly<{
  readonly llm: Readonly<{
    readonly calls: 0;
    readonly inputTokens: 0;
    readonly outputTokens: 0;
  }>;
  readonly embedding: Readonly<{
    readonly calls: number;
    readonly inputTokens: number;
    readonly inputTokensMeasured?: false;
    readonly durationMs: number;
    readonly durationScope?: "embedding-backed-search-upper-bound";
  }>;
  readonly packedContext: Readonly<{
    readonly utf8Bytes: number;
    readonly readerTokens: number;
  }>;
  readonly peakRssBytes: number;
  readonly cacheBytes: number;
}>;

export type ExistingLaneClosureLaneResult = Readonly<{
  readonly status: "degraded" | "ready" | "unavailable";
  readonly hits: readonly ExistingLaneClosureHit[];
  readonly diagnostics?: readonly ExistingLaneClosureDiagnostic[];
  readonly timings?: Readonly<Record<string, number>>;
  readonly resources?: Readonly<Record<string, number>>;
  /** Required measurement boundary. Omission is never interpreted as zero. */
  readonly accounting: ExistingLaneClosureAccounting;
}>;

export type ExistingLaneClosureLaneRequest<Input> = Readonly<{
  readonly input: Input;
  readonly limit: number;
  readonly signal: AbortSignal;
}>;

export type ExistingLaneClosureBackend<Input> = Readonly<{
  readonly retrieve: (
    request: ExistingLaneClosureLaneRequest<Input>,
  ) => Promise<ExistingLaneClosureLaneResult>;
}>;

export type ExistingLaneClosureBackends = Readonly<{
  readonly hybrid?: ExistingLaneClosureBackend<ExistingLaneClosureHybridInput>;
  readonly metadata?: ExistingLaneClosureBackend<ExistingLaneClosureMetadataInput>;
  readonly graph?: ExistingLaneClosureBackend<ExistingLaneClosureGraphInput>;
  readonly pathContext?: ExistingLaneClosureBackend<ExistingLaneClosurePathContextInput>;
  readonly git?: ExistingLaneClosureBackend<ExistingLaneClosureGitInput>;
}>;

export type ExistingLaneClosureReasonCode =
  | "primary"
  | "appended"
  | "deduplicated"
  | "primary-retain-limit"
  | "output-limit"
  | "missing-provenance";

type ExistingLaneClosureEvidenceTrace = Readonly<{
  readonly evidenceUnits: readonly ExistingLaneClosureEvidenceUnit[];
  /** Compatibility projections preserve the exact paired order above. */
  readonly evidenceUnitIds: readonly string[];
  readonly provenance: readonly ExistingLaneClosureEvidenceLocator[];
  /** Bounded, deep-snapshotted lane-native evidence retained for audit. */
  readonly evidence?: unknown;
}>;

export type ExistingLaneClosureCandidateTrace = ExistingLaneClosureEvidenceTrace & Readonly<{
  readonly lane: ExistingLaneClosureLaneId;
  readonly decision: "accepted" | "excluded";
  readonly reasonCode: ExistingLaneClosureReasonCode;
  readonly documentId: string;
  readonly canonicalDocumentId: string;
  readonly sourceRank: number;
  readonly outputRank?: number;
}>;

export type ExistingLaneClosureLaneOutcome = Readonly<{
  readonly lane: ExistingLaneClosureLaneId;
  readonly invocation: "disabled" | "invoked" | "skipped-missing-input";
  readonly status: "degraded" | "ready" | "skipped" | "unavailable";
  readonly limit?: number;
  readonly diagnostics: readonly ExistingLaneClosureDiagnostic[];
  readonly returned: number;
  readonly accepted: number;
  readonly excluded: number;
  readonly candidates: readonly ExistingLaneClosureCandidateTrace[];
}>;

export type ExistingLaneClosureSourceTrace = ExistingLaneClosureEvidenceTrace & Readonly<{
  readonly lane: ExistingLaneClosureLaneId;
  readonly sourceRank: number;
}>;

export type ExistingLaneClosureDocumentTrace = Readonly<{
  readonly documentId: string;
  readonly canonicalDocumentId: string;
  readonly outputRank: number;
  readonly sources: readonly ExistingLaneClosureSourceTrace[];
}>;

export type ExistingLaneClosureTrace = Readonly<{
  readonly variant: ExistingLaneClosureVariant;
  readonly fusion: Readonly<{
    readonly id: typeof EXISTING_LANE_CLOSURE_FUSION;
    readonly primaryLane: "hybrid" | null;
    readonly appendedLaneOrder: readonly Exclude<ExistingLaneClosureLaneId, "hybrid">[];
  }>;
  readonly lanes: readonly ExistingLaneClosureLaneOutcome[];
  readonly documents: readonly ExistingLaneClosureDocumentTrace[];
}>;

export type ExistingLaneClosureResult = Readonly<{
  readonly status: "degraded" | "ready" | "unavailable";
  readonly hits: readonly ExistingLaneClosureHit[];
  readonly trace: ExistingLaneClosureTrace;
  readonly timings: Readonly<Record<string, number>>;
  readonly resources: Readonly<Record<string, number>>;
  readonly accounting: ExistingLaneClosureAccounting;
}>;

export type RunExistingLaneClosureRequest = Readonly<{
  readonly variant: ExistingLaneClosureVariant;
  readonly query: ExistingLaneClosureQuery;
  readonly backends: ExistingLaneClosureBackends;
  readonly evidenceRegistry: ExistingLaneClosureEvidenceRegistry;
  readonly signal: AbortSignal;
}>;

type UnknownRecord = Readonly<Record<string, unknown>>;

type PreparedLane =
  | Readonly<{ readonly kind: "disabled"; readonly lane: ExistingLaneClosureLaneId }>
  | Readonly<{
    readonly kind: "missing";
    readonly lane: ExistingLaneClosureLaneId;
    readonly limit: number;
  }>
  | Readonly<{
    readonly kind: "invoke";
    readonly lane: ExistingLaneClosureLaneId;
    readonly limit: number;
    readonly retainLimit?: number;
    readonly invoke: () => Promise<ExistingLaneClosureLaneResult>;
  }>;

type ValidatedLaneResult = Readonly<{
  readonly status: ExistingLaneClosureLaneResult["status"];
  readonly hits: readonly ExistingLaneClosureHit[];
  readonly diagnostics: readonly ExistingLaneClosureDiagnostic[];
  readonly timings: Readonly<Record<string, number>>;
  readonly resources: Readonly<Record<string, number>>;
  readonly accounting: ExistingLaneClosureAccounting;
  readonly evidenceUnitCount: number;
  readonly provenanceBytes: number;
  readonly evidenceBytes: number;
}>;

type CompletedLane =
  | Exclude<PreparedLane, { readonly kind: "invoke" }>
  | Readonly<{
    readonly kind: "complete";
    readonly lane: ExistingLaneClosureLaneId;
    readonly limit: number;
    readonly retainLimit?: number;
    readonly result: ValidatedLaneResult;
  }>;

type MutableDocumentTrace = {
  readonly documentId: string;
  readonly canonicalDocumentId: string;
  readonly outputRank: number;
  readonly sources: ExistingLaneClosureSourceTrace[];
};

const structuralLaneIds = new Set<string>(existingLaneClosureStructuralLaneIds);
const sourceClasses = new Set<ExistingLaneClosureSourceClass>([
  "authored-note",
  "captured-source",
  "git-history",
  "repository-file",
]);
const trustClasses = new Set<ExistingLaneClosureTrustClass>([
  "authoritative-current",
  "authoritative-historical",
  "captured-primary",
  "captured-secondary",
  "maintained-synthesis",
  "untrusted-capture",
]);
const sourceTrustCompatibility = Object.freeze({
  "authored-note": new Set<ExistingLaneClosureTrustClass>([
    "authoritative-current",
    "authoritative-historical",
    "maintained-synthesis",
  ]),
  "captured-source": new Set<ExistingLaneClosureTrustClass>([
    "captured-primary",
    "captured-secondary",
    "untrusted-capture",
  ]),
  "git-history": new Set<ExistingLaneClosureTrustClass>(["authoritative-historical"]),
  "repository-file": new Set<ExistingLaneClosureTrustClass>(["authoritative-current"]),
} satisfies Readonly<Record<ExistingLaneClosureSourceClass, ReadonlySet<ExistingLaneClosureTrustClass>>>);
const metricKeyPattern = /^[a-z][a-z0-9_.-]{0,127}$/iu;
const windowsAbsolutePattern = /^[a-z]:[\\/]/iu;
const MAX_DESCRIPTOR_TEXT_BYTES = 16 * 1_024;
const MAX_METRICS_PER_LANE = 32;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_ARRAY_ITEMS = 10_000;
const MAX_JSON_OBJECT_FIELDS = 1_000;
const MAX_JSON_STRING_BYTES = 1 * 1_024 * 1_024;

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

function boundedString(
  value: unknown,
  label: string,
  maximumBytes = MAX_DESCRIPTOR_TEXT_BYTES,
): string {
  if (
    typeof value !== "string"
    || value.trim() === ""
    || /[\0\r\n]/u.test(value)
    || hasUnpairedSurrogate(value)
    || value.normalize("NFC") !== value
    || Buffer.byteLength(value, "utf8") > maximumBytes
  ) throw new TypeError(`${label} must be a non-empty NFC single-line bounded string.`);
  return value;
}

function plainRecord(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must not inherit prototype capabilities.`);
  }
  return value as UnknownRecord;
}

function dataRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): UnknownRecord {
  const input = plainRecord(value, label);
  const allowed = new Set([...required, ...optional]);
  const seen = new Set<string>();
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key === "symbol") throw new TypeError(`${label} must not contain symbol fields.`);
    if (!allowed.has(key)) throw new TypeError(`${label} has unknown field ${key}.`);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable data property.`);
    }
    seen.add(key);
  }
  for (const key of required) {
    if (!seen.has(key)) throw new TypeError(`${label}.${key} is required.`);
  }
  return input;
}

function dynamicDataEntries(value: unknown, label: string): readonly (readonly [string, unknown])[] {
  const input = plainRecord(value, label);
  const output: Array<readonly [string, unknown]> = [];
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key === "symbol") throw new TypeError(`${label} must not contain symbol fields.`);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable data property.`);
    }
    output.push(Object.freeze([key, descriptor.value] as const));
  }
  return Object.freeze(output);
}

function ownData(value: unknown, key: string, label: string): unknown {
  const input = plainRecord(value, label);
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined) return undefined;
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw new TypeError(`${label}.${key} must be an enumerable data property.`);
  }
  return descriptor.value;
}

function dataArray(value: unknown, label: string, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a plain array.`);
  }
  if (value.length > maximum) throw new TypeError(`${label} may have at most ${maximum} entries.`);
  const allowed = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") throw new TypeError(`${label} must not contain symbol fields.`);
    if (!allowed.has(key)) throw new TypeError(`${label} has an unexpected array field ${key}.`);
  }
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}[${index}] must be an enumerable data property.`);
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function positiveLimit(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value)
    || (value as number) < 1
    || (value as number) > MAX_EXISTING_LANE_CLOSURE_RESULTS
  ) throw new TypeError(`${label} must be an integer from 1 through ${MAX_EXISTING_LANE_CLOSURE_RESULTS}.`);
  return value as number;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function nonnegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function boundedPositiveInteger(value: unknown, label: string, maximum = 1_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new TypeError(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return value as number;
}

function confinedPath(value: unknown, label: string, allowRoot = false): string {
  const path = boundedString(value, label, 4_096);
  if (allowRoot && path === ".") return path;
  if (
    path.startsWith("/")
    || windowsAbsolutePattern.test(path)
    || path.includes("\\")
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new TypeError(`${label} must be a confined repository-relative path.`);
  return path;
}

function checkedSum(values: readonly number[], label: string): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new TypeError(`${label} exceeds the safe integer bound.`);
  return total;
}

export function freezeExistingLaneClosureVariant(value: unknown): ExistingLaneClosureVariant {
  const input = dataRecord(
    value,
    ["primary", "structuralLanes", "git", "outputLimit"],
    [],
    "existing-lane closure variant",
  );
  let primary: ExistingLaneClosureVariant["primary"];
  if (input.primary === null) primary = null;
  else {
    const descriptor = dataRecord(
      input.primary,
      ["lane", "retrieveLimit", "retainLimit"],
      [],
      "existing-lane closure variant primary",
    );
    if (descriptor.lane !== "hybrid") throw new TypeError("Closure primary.lane must be hybrid.");
    const retrieveLimit = positiveLimit(descriptor.retrieveLimit, "closure primary.retrieveLimit");
    const retainLimit = positiveLimit(descriptor.retainLimit, "closure primary.retainLimit");
    if (retainLimit > retrieveLimit) throw new TypeError("Closure primary.retainLimit may not exceed retrieveLimit.");
    primary = Object.freeze({ lane: "hybrid", retrieveLimit, retainLimit });
  }

  const rawStructural = dataArray(input.structuralLanes, "closure structuralLanes", 3);
  const seen = new Set<string>();
  const structuralLanes = rawStructural.map((value, index) => {
    const descriptor = dataRecord(value, ["lane", "limit"], [], `closure structuralLanes[${index}]`);
    if (typeof descriptor.lane !== "string" || !structuralLaneIds.has(descriptor.lane)) {
      throw new TypeError(`closure structuralLanes[${index}].lane must be metadata, graph, or path-context.`);
    }
    if (seen.has(descriptor.lane)) throw new TypeError("Closure structuralLanes must be unique.");
    seen.add(descriptor.lane);
    return Object.freeze({
      lane: descriptor.lane as ExistingLaneClosureStructuralLaneId,
      limit: positiveLimit(descriptor.limit, `closure structuralLanes[${index}].limit`),
    });
  });

  const rawGit = plainRecord(input.git, "closure git");
  const mode = ownData(rawGit, "mode", "closure git");
  let git: ExistingLaneClosureVariant["git"];
  if (mode === "off") {
    dataRecord(rawGit, ["mode"], [], "closure git");
    git = Object.freeze({ mode: "off" });
  } else if (mode === "explicit-input") {
    const descriptor = dataRecord(rawGit, ["mode", "limit"], [], "closure git");
    git = Object.freeze({
      mode: "explicit-input",
      limit: positiveLimit(descriptor.limit, "closure git.limit"),
    });
  } else throw new TypeError("Closure git.mode must be off or explicit-input.");

  const outputLimit = positiveLimit(input.outputLimit, "closure outputLimit");
  const candidateCapacity = checkedSum([
    primary?.retrieveLimit ?? 0,
    ...structuralLanes.map(({ limit }) => limit),
    git.mode === "explicit-input" ? git.limit : 0,
  ], "Closure candidate capacity");
  if (candidateCapacity > MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES) {
    throw new TypeError(
      `Closure candidate capacity exceeds ${MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES}.`,
    );
  }
  return Object.freeze({
    primary,
    structuralLanes: Object.freeze(structuralLanes),
    git,
    outputLimit,
  });
}

function parseStringArray(
  value: unknown,
  label: string,
  maximum: number,
  options: Readonly<{ readonly confined?: boolean; readonly allowEmpty?: boolean }> = {},
): readonly string[] {
  const entries = dataArray(value, label, maximum);
  if (options.allowEmpty !== true && entries.length === 0) throw new TypeError(`${label} must not be empty.`);
  const output = entries.map((entry, index) => options.confined === true
    ? confinedPath(entry, `${label}[${index}]`)
    : boundedString(entry, `${label}[${index}]`));
  if (new Set(output).size !== output.length) throw new TypeError(`${label} must not repeat entries.`);
  return Object.freeze(output);
}

function copyHybridInput(value: unknown): ExistingLaneClosureHybridInput {
  const input = dataRecord(value, ["text"], [], "closure hybrid input");
  return Object.freeze({ text: boundedString(input.text, "closure hybrid input.text") });
}

function copyMetadataInput(value: unknown): ExistingLaneClosureMetadataInput {
  const input = dataRecord(value, ["filters", "tags"], [], "closure metadata input");
  const rawFilters = dataArray(input.filters, "closure metadata input.filters", 32);
  const filters = rawFilters.map((value, index): ExistingLaneClosureMetadataFilter => {
    const label = `closure metadata input.filters[${index}]`;
    const candidate = plainRecord(value, label);
    const kind = ownData(candidate, "kind", label);
    if (kind === "exists") {
      const filter = dataRecord(candidate, ["kind", "path"], [], label);
      return Object.freeze({ kind, path: boundedString(filter.path, `${label}.path`) });
    }
    if (kind === "equals") {
      const filter = dataRecord(candidate, ["kind", "path", "value"], [], label);
      const scalar = filter.value;
      if (
        scalar !== null
        && typeof scalar !== "string"
        && typeof scalar !== "boolean"
        && (typeof scalar !== "number" || !Number.isFinite(scalar))
      ) throw new TypeError(`${label}.value must be a finite scalar or null.`);
      return Object.freeze({
        kind,
        path: boundedString(filter.path, `${label}.path`),
        value: scalar,
      });
    }
    throw new TypeError(`${label}.kind must be exists or equals.`);
  });
  const tags = parseStringArray(input.tags, "closure metadata input.tags", 32, { allowEmpty: true });
  if (filters.length === 0 && tags.length === 0) {
    throw new TypeError("Closure metadata input must contain a filter or tag.");
  }
  return Object.freeze({ filters: Object.freeze(filters), tags });
}

function copyGraphInput(value: unknown): ExistingLaneClosureGraphInput {
  const input = dataRecord(value, ["seeds", "depth"], [], "closure graph input");
  if (input.depth !== 1 && input.depth !== 2) throw new TypeError("Closure graph input.depth must be 1 or 2.");
  return Object.freeze({
    seeds: parseStringArray(input.seeds, "closure graph input.seeds", 10, { confined: true }),
    depth: input.depth,
  });
}

function copyPathContextInput(value: unknown): ExistingLaneClosurePathContextInput {
  const input = dataRecord(value, ["repositoryPath"], [], "closure path-context input");
  return Object.freeze({
    repositoryPath: confinedPath(
      input.repositoryPath,
      "closure path-context input.repositoryPath",
      true,
    ),
  });
}

function copyGitInput(value: unknown): ExistingLaneClosureGitInput {
  const input = dataRecord(value, ["query", "noteIds"], [], "closure Git input");
  return Object.freeze({
    query: boundedString(input.query, "closure Git input.query"),
    noteIds: parseStringArray(input.noteIds, "closure Git input.noteIds", 100, {
      confined: true,
      allowEmpty: true,
    }),
  });
}

function parseLocator(value: unknown, label: string): ExistingLaneClosureEvidenceLocator {
  const input = dataRecord(value, [
    "evidenceUnitId",
    "documentId",
    "sourceFamilyId",
    "sourceClass",
    "trustClass",
    "sourcePath",
    "lineRange",
    "headingPath",
  ], ["sourcePage"], label);
  if (typeof input.sourceClass !== "string" || !sourceClasses.has(input.sourceClass as ExistingLaneClosureSourceClass)) {
    throw new TypeError(`${label}.sourceClass is invalid.`);
  }
  if (typeof input.trustClass !== "string" || !trustClasses.has(input.trustClass as ExistingLaneClosureTrustClass)) {
    throw new TypeError(`${label}.trustClass is invalid.`);
  }
  const sourceClass = input.sourceClass as ExistingLaneClosureSourceClass;
  const trustClass = input.trustClass as ExistingLaneClosureTrustClass;
  if (!sourceTrustCompatibility[sourceClass].has(trustClass)) {
    throw new TypeError(`${label} sourceClass and trustClass are incompatible.`);
  }
  const rawRange = dataRecord(input.lineRange, ["start", "end"], [], `${label}.lineRange`);
  const start = boundedPositiveInteger(rawRange.start, `${label}.lineRange.start`);
  const end = boundedPositiveInteger(rawRange.end, `${label}.lineRange.end`);
  if (end < start) throw new TypeError(`${label}.lineRange.end may not precede start.`);
  const sourcePage = input.sourcePage === undefined
    ? undefined
    : boundedPositiveInteger(input.sourcePage, `${label}.sourcePage`);
  return Object.freeze({
    evidenceUnitId: boundedString(input.evidenceUnitId, `${label}.evidenceUnitId`, 512),
    documentId: confinedPath(input.documentId, `${label}.documentId`),
    sourceFamilyId: boundedString(input.sourceFamilyId, `${label}.sourceFamilyId`, 512),
    sourceClass,
    trustClass,
    sourcePath: confinedPath(input.sourcePath, `${label}.sourcePath`),
    lineRange: Object.freeze({ start, end }),
    headingPath: parseStringArray(input.headingPath, `${label}.headingPath`, 32, { allowEmpty: true }),
    ...(sourcePage === undefined ? {} : { sourcePage }),
  });
}

function locatorKey(locator: ExistingLaneClosureEvidenceLocator): string {
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

export function freezeExistingLaneClosureEvidenceRegistry(
  value: unknown,
): ExistingLaneClosureEvidenceRegistry {
  const input = dataRecord(value, ["units"], [], "existing-lane closure evidence registry");
  const rawUnits = dataArray(
    input.units,
    "existing-lane closure evidence registry.units",
    MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES * MAX_EXISTING_LANE_CLOSURE_EVIDENCE_UNITS,
  );
  const ids = new Set<string>();
  const units = rawUnits.map((unit, index) => {
    const parsed = parseLocator(unit, `existing-lane closure evidence registry.units[${index}]`);
    if (ids.has(parsed.evidenceUnitId)) {
      throw new TypeError(`Closure evidence registry repeats unit ${parsed.evidenceUnitId}.`);
    }
    ids.add(parsed.evidenceUnitId);
    return parsed;
  });
  return Object.freeze({ units: Object.freeze(units) });
}

function parseBackend<Input>(value: unknown, lane: ExistingLaneClosureLaneId): ExistingLaneClosureBackend<Input> {
  const input = dataRecord(value, ["retrieve"], [], `closure ${lane} backend`);
  if (typeof input.retrieve !== "function") throw new TypeError(`Closure ${lane} backend.retrieve must be a function.`);
  return Object.freeze({
    retrieve: input.retrieve as ExistingLaneClosureBackend<Input>["retrieve"],
  });
}

function invokedLane<Input>(options: Readonly<{
  readonly lane: ExistingLaneClosureLaneId;
  readonly limit: number;
  readonly retainLimit?: number;
  readonly input: Input;
  readonly backend: ExistingLaneClosureBackend<Input>;
  readonly signal: AbortSignal;
}>): PreparedLane {
  const laneRequest = Object.freeze({ input: options.input, limit: options.limit, signal: options.signal });
  return Object.freeze({
    kind: "invoke",
    lane: options.lane,
    limit: options.limit,
    ...(options.retainLimit === undefined ? {} : { retainLimit: options.retainLimit }),
    invoke: () => options.backend.retrieve(laneRequest),
  });
}

function prepareLanes(
  variant: ExistingLaneClosureVariant,
  query: ExistingLaneClosureQuery,
  backends: ExistingLaneClosureBackends,
  signal: AbortSignal,
): readonly PreparedLane[] {
  const rawInputs = ownData(query, "inputs", "existing-lane closure query");
  const inputs = plainRecord(rawInputs, "existing-lane closure query.inputs");
  const lanes: PreparedLane[] = [];
  const prepare = <Input>(options: Readonly<{
    readonly lane: ExistingLaneClosureLaneId;
    readonly inputKey: string;
    readonly backendKey: string;
    readonly limit: number;
    readonly retainLimit?: number;
    readonly copy: (value: unknown) => Input;
  }>): void => {
    const rawInput = ownData(inputs, options.inputKey, "existing-lane closure query.inputs");
    if (rawInput === undefined) {
      lanes.push(Object.freeze({ kind: "missing", lane: options.lane, limit: options.limit }));
      return;
    }
    const input = options.copy(rawInput);
    const rawBackend = ownData(backends, options.backendKey, "existing-lane closure backends");
    lanes.push(invokedLane({
      lane: options.lane,
      limit: options.limit,
      ...(options.retainLimit === undefined ? {} : { retainLimit: options.retainLimit }),
      input,
      backend: parseBackend<Input>(rawBackend, options.lane),
      signal,
    }));
  };

  if (variant.primary === null) lanes.push(Object.freeze({ kind: "disabled", lane: "hybrid" }));
  else prepare({
    lane: "hybrid",
    inputKey: "hybrid",
    backendKey: "hybrid",
    limit: variant.primary.retrieveLimit,
    retainLimit: variant.primary.retainLimit,
    copy: copyHybridInput,
  });

  for (const descriptor of variant.structuralLanes) {
    if (descriptor.lane === "metadata") prepare({
      lane: "metadata",
      inputKey: "metadata",
      backendKey: "metadata",
      limit: descriptor.limit,
      copy: copyMetadataInput,
    });
    else if (descriptor.lane === "graph") prepare({
      lane: "graph",
      inputKey: "graph",
      backendKey: "graph",
      limit: descriptor.limit,
      copy: copyGraphInput,
    });
    else prepare({
      lane: "path-context",
      inputKey: "pathContext",
      backendKey: "pathContext",
      limit: descriptor.limit,
      copy: copyPathContextInput,
    });
  }

  if (variant.git.mode === "off") lanes.push(Object.freeze({ kind: "disabled", lane: "git" }));
  else prepare({
    lane: "git",
    inputKey: "history",
    backendKey: "git",
    limit: variant.git.limit,
    copy: copyGitInput,
  });
  return Object.freeze(lanes);
}

function copyJsonValue(
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
    if (hasUnpairedSurrogate(value) || Buffer.byteLength(value, "utf8") > MAX_JSON_STRING_BYTES) {
      throw new TypeError(`${label} strings must be bounded valid Unicode.`);
    }
    return value;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`${label} must contain only JSON values.`);
  }
  if (depth >= MAX_JSON_DEPTH) throw new TypeError(`${label} exceeds the JSON depth bound.`);
  if (ancestors.has(value)) throw new TypeError(`${label} must not contain cycles.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const entries = dataArray(value, label, MAX_JSON_ARRAY_ITEMS);
      return Object.freeze(entries.map((entry, index) =>
        copyJsonValue(entry, `${label}[${index}]`, depth + 1, ancestors)));
    }
    const entries = dynamicDataEntries(value, label);
    if (entries.length > MAX_JSON_OBJECT_FIELDS) {
      throw new TypeError(`${label} exceeds the JSON object-field bound.`);
    }
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, entry] of entries.toSorted(([left], [right]) => left.localeCompare(right))) {
      if (hasUnpairedSurrogate(key) || Buffer.byteLength(key, "utf8") > MAX_DESCRIPTOR_TEXT_BYTES) {
        throw new TypeError(`${label} has an invalid JSON field name.`);
      }
      output[key] = copyJsonValue(entry, `${label}.${key}`, depth + 1, ancestors);
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}

function parseMetricMap(value: unknown, label: string): Readonly<Record<string, number>> {
  if (value === undefined) return Object.freeze({});
  const entries = dynamicDataEntries(value, label);
  if (entries.length > MAX_METRICS_PER_LANE) throw new TypeError(`${label} has too many entries.`);
  const output: Record<string, number> = {};
  for (const [key, candidate] of entries.toSorted(([left], [right]) => left.localeCompare(right))) {
    if (!metricKeyPattern.test(key)) throw new TypeError(`${label} has invalid key ${JSON.stringify(key)}.`);
    output[key] = nonnegativeNumber(candidate, `${label}.${key}`);
  }
  return Object.freeze(output);
}

function parseAccounting(value: unknown, label: string): ExistingLaneClosureAccounting {
  const input = dataRecord(
    value,
    ["llm", "embedding", "packedContext", "peakRssBytes", "cacheBytes"],
    [],
    label,
  );
  const llm = dataRecord(input.llm, ["calls", "inputTokens", "outputTokens"], [], `${label}.llm`);
  if (llm.calls !== 0 || llm.inputTokens !== 0 || llm.outputTokens !== 0) {
    throw new TypeError(`${label}.llm requires literal-zero calls, inputTokens, and outputTokens.`);
  }
  const embedding = dataRecord(
    input.embedding,
    ["calls", "inputTokens", "durationMs"],
    ["inputTokensMeasured", "durationScope"],
    `${label}.embedding`,
  );
  const packedContext = dataRecord(
    input.packedContext,
    ["utf8Bytes", "readerTokens"],
    [],
    `${label}.packedContext`,
  );
  const embeddingCalls = nonnegativeInteger(embedding.calls, `${label}.embedding.calls`);
  const embeddingInputTokens = nonnegativeInteger(
    embedding.inputTokens,
    `${label}.embedding.inputTokens`,
  );
  const embeddingDurationMs = nonnegativeNumber(
    embedding.durationMs,
    `${label}.embedding.durationMs`,
  );
  if (Object.hasOwn(embedding, "inputTokensMeasured") && embedding.inputTokensMeasured !== false) {
    throw new TypeError(`${label}.embedding.inputTokensMeasured must be literal false when present.`);
  }
  const durationScopeValue = embedding.durationScope;
  if (
    Object.hasOwn(embedding, "durationScope")
    && durationScopeValue !== "embedding-backed-search-upper-bound"
  ) {
    throw new TypeError(
      `${label}.embedding.durationScope must be embedding-backed-search-upper-bound when present.`,
    );
  }
  const durationScope: ExistingLaneClosureAccounting["embedding"]["durationScope"] =
    durationScopeValue === "embedding-backed-search-upper-bound"
      ? durationScopeValue
      : undefined;
  if (embeddingCalls === 0) {
    if (
      embeddingInputTokens !== 0
      || embeddingDurationMs !== 0
      || embedding.inputTokensMeasured !== undefined
      || durationScope !== undefined
    ) throw new TypeError(`${label}.embedding zero-call accounting must be the exact unannotated zero record.`);
  } else if (embedding.inputTokensMeasured === false && embeddingInputTokens !== 0) {
    throw new TypeError(
      `${label}.embedding unmeasured input tokens must use zero only as an explicit placeholder.`,
    );
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: embeddingCalls,
      inputTokens: embeddingInputTokens,
      ...(embedding.inputTokensMeasured === false ? { inputTokensMeasured: false as const } : {}),
      durationMs: embeddingDurationMs,
      ...(durationScope === undefined ? {} : { durationScope }),
    }),
    packedContext: Object.freeze({
      utf8Bytes: nonnegativeInteger(packedContext.utf8Bytes, `${label}.packedContext.utf8Bytes`),
      readerTokens: nonnegativeInteger(packedContext.readerTokens, `${label}.packedContext.readerTokens`),
    }),
    peakRssBytes: nonnegativeInteger(input.peakRssBytes, `${label}.peakRssBytes`),
    cacheBytes: nonnegativeInteger(input.cacheBytes, `${label}.cacheBytes`),
  });
}

function copyDiagnostic(value: unknown, label: string): ExistingLaneClosureDiagnostic {
  const input = dataRecord(value, ["code", "status"], ["message", "details"], label);
  if (input.status !== "ready" && input.status !== "degraded" && input.status !== "unavailable") {
    throw new TypeError(`${label}.status is invalid.`);
  }
  let details: Readonly<Record<string, string | number | boolean | null>> | undefined;
  if (input.details !== undefined) {
    const entries = dynamicDataEntries(input.details, `${label}.details`);
    if (entries.length > 32) throw new TypeError(`${label}.details has too many entries.`);
    const output: Record<string, string | number | boolean | null> = {};
    for (const [key, candidate] of entries.toSorted(([left], [right]) => left.localeCompare(right))) {
      boundedString(key, `${label}.details key`, 256);
      if (
        candidate !== null
        && typeof candidate !== "string"
        && typeof candidate !== "boolean"
        && (typeof candidate !== "number" || !Number.isFinite(candidate))
      ) throw new TypeError(`${label}.details.${key} must be a finite scalar or null.`);
      output[key] = candidate;
    }
    details = Object.freeze(output);
  }
  return Object.freeze({
    code: boundedString(input.code, `${label}.code`, 256),
    status: input.status,
    ...(input.message === undefined ? {} : {
      message: boundedString(input.message, `${label}.message`),
    }),
    ...(details === undefined ? {} : { details }),
  });
}

function copyHit(
  value: unknown,
  label: string,
  registry: ReadonlyMap<string, ExistingLaneClosureEvidenceLocator>,
  lane: ExistingLaneClosureLaneId,
): Readonly<{
  readonly hit: ExistingLaneClosureHit;
  readonly evidenceUnitCount: number;
  readonly provenanceBytes: number;
  readonly evidenceBytes: number;
}> {
  const input = dataRecord(
    value,
    ["documentId", "canonicalDocumentId", "rank"],
    ["score", "evidenceUnits", "evidence"],
    label,
  );
  const documentId = confinedPath(input.documentId, `${label}.documentId`);
  const canonicalDocumentId = confinedPath(input.canonicalDocumentId, `${label}.canonicalDocumentId`);
  const rank = positiveLimit(input.rank, `${label}.rank`);
  const score = input.score === undefined ? undefined : finiteNumber(input.score, `${label}.score`);
  let evidenceUnits: readonly ExistingLaneClosureEvidenceUnit[] | undefined;
  let provenanceBytes = 0;
  if (input.evidenceUnits !== undefined) {
    const rawUnits = dataArray(
      input.evidenceUnits,
      `${label}.evidenceUnits`,
      MAX_EXISTING_LANE_CLOSURE_EVIDENCE_UNITS,
    );
    const ids = new Set<string>();
    evidenceUnits = Object.freeze(rawUnits.map((value, index) => {
      const unitLabel = `${label}.evidenceUnits[${index}]`;
      const rawUnit = dataRecord(value, ["id", "locator"], [], unitLabel);
      const id = boundedString(rawUnit.id, `${unitLabel}.id`, 512);
      if (ids.has(id)) throw new TypeError(`${label}.evidenceUnits must not repeat IDs.`);
      ids.add(id);
      const parsedLocator = parseLocator(rawUnit.locator, `${unitLabel}.locator`);
      if (parsedLocator.evidenceUnitId !== id) {
        throw new TypeError(`${unitLabel} must pair its ID with the same locator evidenceUnitId.`);
      }
      const bound = registry.get(id);
      if (bound === undefined || locatorKey(bound) !== locatorKey(parsedLocator)) {
        throw new TypeError(`${unitLabel}.locator does not exactly match the frozen registry binding.`);
      }
      if (bound.documentId !== canonicalDocumentId && lane !== "graph") {
        throw new TypeError(`${unitLabel}.locator belongs to a different canonical document.`);
      }
      provenanceBytes += Buffer.byteLength(locatorKey(bound), "utf8");
      return Object.freeze({ id, locator: bound });
    }));
  }
  const evidence = input.evidence === undefined
    ? undefined
    : copyJsonValue(input.evidence, `${label}.evidence`);
  const evidenceBytes = evidence === undefined
    ? 0
    : Buffer.byteLength(JSON.stringify(evidence), "utf8");
  const hit: ExistingLaneClosureHit = Object.freeze({
    documentId,
    canonicalDocumentId,
    rank,
    ...(score === undefined ? {} : { score }),
    ...(evidenceUnits === undefined ? {} : { evidenceUnits }),
    ...(evidence === undefined ? {} : { evidence }),
  });
  return Object.freeze({
    hit,
    evidenceUnitCount: evidenceUnits?.length ?? 0,
    provenanceBytes,
    evidenceBytes,
  });
}

function validateLaneResult(
  value: unknown,
  lane: ExistingLaneClosureLaneId,
  limit: number,
  registry: ReadonlyMap<string, ExistingLaneClosureEvidenceLocator>,
): ValidatedLaneResult {
  const input = dataRecord(
    value,
    ["status", "hits", "accounting"],
    ["diagnostics", "timings", "resources"],
    `closure ${lane} result`,
  );
  if (input.status !== "ready" && input.status !== "degraded" && input.status !== "unavailable") {
    throw new TypeError(`Closure ${lane} result.status is invalid.`);
  }
  const rawHits = dataArray(input.hits, `closure ${lane} result.hits`, limit);
  const copied = rawHits.map((hit, index) =>
    copyHit(hit, `closure ${lane} result.hits[${index}]`, registry, lane));
  const ranks = copied.map(({ hit }) => hit.rank);
  if (new Set(ranks).size !== ranks.length) throw new TypeError(`Closure ${lane} result ranks must be unique.`);
  if (input.status === "unavailable" && copied.length > 0) {
    throw new TypeError(`Closure ${lane} unavailable results may not contain hits.`);
  }
  const rawDiagnostics = input.diagnostics === undefined
    ? Object.freeze([])
    : dataArray(
        input.diagnostics,
        `closure ${lane} result.diagnostics`,
        MAX_EXISTING_LANE_CLOSURE_DIAGNOSTICS,
      );
  return Object.freeze({
    status: input.status,
    hits: Object.freeze(copied.map(({ hit }) => hit).toSorted((left, right) => left.rank - right.rank)),
    diagnostics: Object.freeze(rawDiagnostics.map((diagnostic, index) =>
      copyDiagnostic(diagnostic, `closure ${lane} result.diagnostics[${index}]`))),
    timings: parseMetricMap(input.timings, `closure ${lane} result.timings`),
    resources: parseMetricMap(input.resources, `closure ${lane} result.resources`),
    accounting: parseAccounting(input.accounting, `closure ${lane} result.accounting`),
    evidenceUnitCount: copied.reduce((total, candidate) => total + candidate.evidenceUnitCount, 0),
    provenanceBytes: copied.reduce((total, candidate) => total + candidate.provenanceBytes, 0),
    evidenceBytes: copied.reduce((total, candidate) => total + candidate.evidenceBytes, 0),
  });
}

function aggregateAccounting(
  values: readonly ExistingLaneClosureAccounting[],
): ExistingLaneClosureAccounting {
  const durationMs = values.reduce((total, value) => total + value.embedding.durationMs, 0);
  if (!Number.isFinite(durationMs)) throw new TypeError("Closure embedding duration exceeds its finite bound.");
  const inputTokensMeasured = values.some(({ embedding }) => embedding.inputTokensMeasured === false)
    ? false as const
    : undefined;
  const durationScope = values.some(
    ({ embedding }) => embedding.durationScope === "embedding-backed-search-upper-bound",
  ) ? "embedding-backed-search-upper-bound" as const : undefined;
  const cacheValues = new Set(values.map(({ cacheBytes }) => cacheBytes));
  if (cacheValues.size > 1) {
    throw new TypeError("Closure lanes must report one identical shared-cache byte count.");
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: checkedSum(values.map(({ embedding }) => embedding.calls), "Closure embedding calls"),
      inputTokens: inputTokensMeasured === false
        ? 0
        : checkedSum(
            values.map(({ embedding }) => embedding.inputTokens),
            "Closure embedding input tokens",
          ),
      ...(inputTokensMeasured === false ? { inputTokensMeasured } : {}),
      durationMs,
      ...(durationScope === undefined ? {} : { durationScope }),
    }),
    packedContext: Object.freeze({
      utf8Bytes: checkedSum(
        values.map(({ packedContext }) => packedContext.utf8Bytes),
        "Closure packed-context bytes",
      ),
      readerTokens: checkedSum(
        values.map(({ packedContext }) => packedContext.readerTokens),
        "Closure packed-context reader tokens",
      ),
    }),
    peakRssBytes: Math.max(0, ...values.map(({ peakRssBytes }) => peakRssBytes)),
    cacheBytes: values[0]?.cacheBytes ?? 0,
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error("Existing-lane closure was aborted.");
}

function evidenceTrace(hit: ExistingLaneClosureHit): ExistingLaneClosureEvidenceTrace {
  const evidenceUnits = hit.evidenceUnits ?? Object.freeze([]);
  return Object.freeze({
    evidenceUnits,
    evidenceUnitIds: Object.freeze(evidenceUnits.map(({ id }) => id)),
    provenance: Object.freeze(evidenceUnits.map(({ locator }) => locator)),
    ...(hit.evidence === undefined ? {} : { evidence: hit.evidence }),
  });
}

function sourceTrace(
  lane: ExistingLaneClosureLaneId,
  hit: ExistingLaneClosureHit,
  evidence: ExistingLaneClosureEvidenceTrace,
): ExistingLaneClosureSourceTrace {
  return Object.freeze({ lane, sourceRank: hit.rank, ...evidence });
}

export async function runExistingLaneClosure(
  request: RunExistingLaneClosureRequest,
): Promise<ExistingLaneClosureResult> {
  const variant = freezeExistingLaneClosureVariant(request.variant);
  const evidenceRegistry = freezeExistingLaneClosureEvidenceRegistry(request.evidenceRegistry);
  const registryById = new Map(evidenceRegistry.units.map((unit) => [unit.evidenceUnitId, unit]));
  const lanes = prepareLanes(variant, request.query, request.backends, request.signal);
  throwIfAborted(request.signal);

  const completed: CompletedLane[] = [];
  const timings: Record<string, number> = {};
  const resources: Record<string, number> = {};
  const invokedAccounting: ExistingLaneClosureAccounting[] = [];
  let totalCandidates = 0;
  let totalEvidenceUnits = 0;
  let totalProvenanceBytes = 0;
  let totalEvidenceBytes = 0;

  for (const lane of lanes) {
    throwIfAborted(request.signal);
    if (lane.kind !== "invoke") {
      completed.push(lane);
      continue;
    }
    const result = validateLaneResult(
      await lane.invoke(),
      lane.lane,
      lane.limit,
      registryById,
    );
    throwIfAborted(request.signal);
    totalCandidates += result.hits.length;
    totalEvidenceUnits += result.evidenceUnitCount;
    totalProvenanceBytes += result.provenanceBytes;
    totalEvidenceBytes += result.evidenceBytes;
    if (totalCandidates > MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES) {
      throw new TypeError("Closure results exceed the aggregate candidate bound.");
    }
    if (totalEvidenceUnits > MAX_EXISTING_LANE_CLOSURE_TOTAL_EVIDENCE_UNITS) {
      throw new TypeError("Closure results exceed the aggregate evidence-unit bound.");
    }
    if (totalProvenanceBytes > MAX_EXISTING_LANE_CLOSURE_PROVENANCE_BYTES) {
      throw new TypeError("Closure results exceed the aggregate provenance-byte bound.");
    }
    if (totalEvidenceBytes > MAX_EXISTING_LANE_CLOSURE_EVIDENCE_BYTES) {
      throw new TypeError("Closure results exceed the aggregate opaque-evidence byte bound.");
    }
    for (const [key, value] of Object.entries(result.timings)) timings[`${lane.lane}.${key}`] = value;
    for (const [key, value] of Object.entries(result.resources)) resources[`${lane.lane}.${key}`] = value;
    invokedAccounting.push(result.accounting);
    completed.push(Object.freeze({
      kind: "complete",
      lane: lane.lane,
      limit: lane.limit,
      ...(lane.retainLimit === undefined ? {} : { retainLimit: lane.retainLimit }),
      result,
    }));
  }

  const outputHits: ExistingLaneClosureHit[] = [];
  const laneOutcomes: ExistingLaneClosureLaneOutcome[] = [];
  const documentOrder: MutableDocumentTrace[] = [];
  const documentsById = new Map<string, MutableDocumentTrace>();
  const invokedStatuses: ExistingLaneClosureLaneResult["status"][] = [];
  let missingProvenance = false;

  type MergeState = {
    readonly lane: Extract<CompletedLane, { readonly kind: "complete" }>;
    readonly candidateTraces: ExistingLaneClosureCandidateTrace[];
    accepted: number;
  };
  const mergeStates = new Map<ExistingLaneClosureLaneId, MergeState>();
  for (const lane of completed) {
    if (lane.kind !== "complete") continue;
    invokedStatuses.push(lane.result.status);
    mergeStates.set(lane.lane, { lane, candidateTraces: [], accepted: 0 });
  }

  const mergeCandidate = (state: MergeState, sourceIndex: number): void => {
    const { lane } = state;
    const hit = lane.result.hits[sourceIndex];
    if (hit === undefined) return;
      const evidence = evidenceTrace(hit);
      const existing = documentsById.get(hit.canonicalDocumentId);
      let reasonCode: ExistingLaneClosureReasonCode;
      let outputRank: number | undefined;
      let decision: ExistingLaneClosureCandidateTrace["decision"];
      if (evidence.evidenceUnits.length === 0) {
        reasonCode = "missing-provenance";
        decision = "excluded";
        missingProvenance = true;
      } else if (
        lane.lane === "hybrid"
        && lane.retainLimit !== undefined
        && sourceIndex >= lane.retainLimit
      ) {
        reasonCode = "primary-retain-limit";
        decision = "excluded";
      } else if (existing !== undefined) {
        reasonCode = "deduplicated";
        decision = "excluded";
        outputRank = existing.outputRank;
        existing.sources.push(sourceTrace(lane.lane, hit, evidence));
      } else if (outputHits.length >= variant.outputLimit) {
        reasonCode = "output-limit";
        decision = "excluded";
      } else {
        reasonCode = lane.lane === "hybrid" ? "primary" : "appended";
        decision = "accepted";
        outputHits.push(hit);
        outputRank = outputHits.length;
        state.accepted += 1;
        const document: MutableDocumentTrace = {
          documentId: hit.documentId,
          canonicalDocumentId: hit.canonicalDocumentId,
          outputRank,
          sources: [sourceTrace(lane.lane, hit, evidence)],
        };
        documentOrder.push(document);
        documentsById.set(hit.canonicalDocumentId, document);
      }
      state.candidateTraces.push(Object.freeze({
        lane: lane.lane,
        decision,
        reasonCode,
        documentId: hit.documentId,
        canonicalDocumentId: hit.canonicalDocumentId,
        sourceRank: hit.rank,
        ...evidence,
        ...(outputRank === undefined ? {} : { outputRank }),
      }));
  };

  const primary = mergeStates.get("hybrid");
  if (primary !== undefined) {
    for (const sourceIndex of primary.lane.result.hits.keys()) {
      mergeCandidate(primary, sourceIndex);
    }
  }
  const appended = completed
    .filter((lane): lane is Extract<CompletedLane, { readonly kind: "complete" }> =>
      lane.kind === "complete" && lane.lane !== "hybrid")
    .map((lane) => mergeStates.get(lane.lane))
    .filter((state): state is MergeState => state !== undefined);
  for (let sourceIndex = 0; ; sourceIndex += 1) {
    let visited = false;
    for (const state of appended) {
      if (state.lane.result.hits[sourceIndex] === undefined) continue;
      visited = true;
      mergeCandidate(state, sourceIndex);
    }
    if (!visited) break;
  }

  for (const lane of completed) {
    if (lane.kind === "disabled") {
      laneOutcomes.push(Object.freeze({
        lane: lane.lane,
        invocation: "disabled",
        status: "skipped",
        diagnostics: Object.freeze([]),
        returned: 0,
        accepted: 0,
        excluded: 0,
        candidates: Object.freeze([]),
      }));
      continue;
    }
    if (lane.kind === "missing") {
      laneOutcomes.push(Object.freeze({
        lane: lane.lane,
        invocation: "skipped-missing-input",
        status: "skipped",
        limit: lane.limit,
        diagnostics: Object.freeze([]),
        returned: 0,
        accepted: 0,
        excluded: 0,
        candidates: Object.freeze([]),
      }));
      continue;
    }
    const state = mergeStates.get(lane.lane);
    if (state === undefined) throw new Error(`Closure merge state for ${lane.lane} is missing.`);
    laneOutcomes.push(Object.freeze({
      lane: lane.lane,
      invocation: "invoked",
      status: lane.result.status,
      limit: lane.limit,
      diagnostics: lane.result.diagnostics,
      returned: lane.result.hits.length,
      accepted: state.accepted,
      excluded: lane.result.hits.length - state.accepted,
      candidates: Object.freeze(state.candidateTraces),
    }));
  }

  const status: ExistingLaneClosureResult["status"] = invokedStatuses.length === 0
    ? "unavailable"
    : invokedStatuses.every((candidate) => candidate === "unavailable")
      ? "unavailable"
      : missingProvenance || invokedStatuses.some((candidate) => candidate !== "ready")
        ? "degraded"
        : "ready";
  const documents = Object.freeze(documentOrder.map((document) => Object.freeze({
    documentId: document.documentId,
    canonicalDocumentId: document.canonicalDocumentId,
    outputRank: document.outputRank,
    sources: Object.freeze([...document.sources]),
  })));
  return Object.freeze({
    status,
    hits: Object.freeze(outputHits),
    trace: Object.freeze({
      variant,
      fusion: Object.freeze({
        id: EXISTING_LANE_CLOSURE_FUSION,
        primaryLane: variant.primary === null ? null : "hybrid",
        appendedLaneOrder: Object.freeze(completed
          .filter(({ kind, lane }) => kind !== "disabled" && lane !== "hybrid")
          .map(({ lane }) => lane as Exclude<ExistingLaneClosureLaneId, "hybrid">)),
      }),
      lanes: Object.freeze(laneOutcomes),
      documents,
    }),
    timings: Object.freeze(timings),
    resources: Object.freeze(resources),
    accounting: aggregateAccounting(invokedAccounting),
  });
}
