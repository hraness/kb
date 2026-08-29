import { createHash } from "node:crypto";
import { posix } from "node:path";

type JsonPrimitive = boolean | null | number | string;
export type OhAdoptionJsonValue =
  | JsonPrimitive
  | readonly OhAdoptionJsonValue[]
  | Readonly<{ [key: string]: OhAdoptionJsonValue }>;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CODE_PATTERN = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u;
const RECORD_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u;
const MAX_CAPSULE_BYTES = 16 * 1024 * 1024;
const MAX_RECORDS = 1_024;
const MAX_ROOTS = 256;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_DEPENDENCIES = 4_096;
const MAX_TEXT_BYTES = 4_096;
const MAX_STRUCTURAL_NODES = 262_144;
const MAX_STRUCTURAL_DEPTH = 128;

const OH_RECORD_KINDS = new Set([
  "activity", "assertion", "context", "dependency-manifest", "edition", "entity",
  "evidence", "identity-operation", "inquiry", "inquiry-event", "review-decision",
  "rights-decision", "schema", "shape", "statement", "type-membership", "view",
  "vocabulary",
]);

export interface OhAdoptionStoreProfileV1 {
  readonly applicationProfileSha256: string | null;
  readonly capabilities: Readonly<{
    readonly changesSince: true;
    readonly dependencyClosureExport: true;
    readonly exactSnapshots: true;
    readonly operationReplication: false;
    readonly semanticBundleCommit: true;
    readonly v: 1;
    readonly wholeSpacePurge: true;
  }>;
  readonly profileId: string;
  readonly profileKind: "working";
  readonly profileSha256: string;
  readonly v: 1;
}

export interface OhAdoptionStoreBindingV1 {
  readonly bindingSha256: string;
  readonly contractSha256: string;
  readonly profile: OhAdoptionStoreProfileV1;
  readonly realmId: string;
  readonly spaceId: string;
  readonly v: 1;
}

export interface OhAdoptionHeadV1 {
  readonly generation: number;
  readonly graphRevisionSha256: string | null;
  readonly operationSha256: string | null;
  readonly recordsSha256: string;
  readonly sequence: number;
  readonly v: 1;
}

export interface OhAdoptionRecordV1 {
  readonly dependencies: readonly string[];
  readonly key: string;
  readonly kind: string;
  readonly recordSha256: string;
  readonly v: 1;
  readonly value: OhAdoptionJsonValue;
}

export interface OhDependencyClosureCapsuleV1 {
  readonly binding: OhAdoptionStoreBindingV1;
  readonly closureSha256: string;
  readonly head: OhAdoptionHeadV1;
  readonly records: readonly OhAdoptionRecordV1[];
  readonly roots: readonly string[];
  readonly v: 1;
}

export interface OhAdoptionExpectedSourceV1 {
  readonly authorityId: string;
  readonly binding: OhAdoptionStoreBindingV1;
  readonly head: OhAdoptionHeadV1;
  readonly v: 1;
}

export interface OhAdoptionCandidateV1 {
  readonly artifactSha256: string;
  readonly candidateSha256: string;
  readonly manifest: Readonly<{
    readonly conflicts: ConflictReviewV1;
    readonly destination: DestinationV1;
    readonly format: "hraness.kb.oh-adoption-candidate.v1";
    readonly redactions: readonly ChangeDisclosureV1[];
    readonly review: ReviewRequirementV1;
    readonly rights: RightsClearanceV1;
    readonly source: Readonly<{
      readonly authorityId: string;
      readonly binding: OhAdoptionStoreBindingV1;
      readonly closureSha256: string;
      readonly head: OhAdoptionHeadV1;
      readonly records: readonly Readonly<{
        readonly dependencies: readonly string[];
        readonly key: string;
        readonly kind: string;
        readonly recordSha256: string;
        readonly v: 1;
      }>[];
      readonly roots: readonly string[];
      readonly v: 1;
    }>;
    readonly status: "prepared";
    readonly transformations: readonly ChangeDisclosureV1[];
    readonly v: 1;
  }>;
  readonly markdown: string;
  readonly v: 1;
}

interface DestinationV1 {
  readonly purpose: string;
  readonly targetPath: string;
  readonly v: 1;
}

interface RightsClearanceV1 {
  readonly decisionId: string;
  readonly disposition: "cleared-for-purpose";
  readonly purpose: string;
  readonly v: 1;
}

interface ReviewRequirementV1 {
  readonly route: string;
  readonly status: "required";
  readonly v: 1;
}

interface ConflictReviewV1 {
  readonly notes: readonly string[];
  readonly status: "none-observed" | "requires-resolution";
  readonly v: 1;
}

interface ChangeDisclosureV1 {
  readonly id: string;
  readonly recordKey: string;
  readonly summary: string;
  readonly v: 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => {
    if (typeof key !== "string" || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
  });
}

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function canonicalJson(value: unknown, path = "$", ancestors = new Set<object>()): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!validUnicode(value)) throw new TypeError(`${path} contains invalid Unicode.`);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${path} is not a canonical number.`);
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || value === null || ancestors.has(value)) {
    throw new TypeError(`${path} is not an acyclic JSON value.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => key !== "length" && (typeof key !== "string"
        || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length))) {
        throw new TypeError(`${path} has non-index array properties.`);
      }
      const output: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path} contains a sparse array.`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError(`${path}[${index}] is not an enumerable data property.`);
        }
        output.push(canonicalJson(descriptor.value, `${path}[${index}]`, ancestors));
      }
      return `[${output.join(",")}]`;
    }
    if (!isRecord(value)) throw new TypeError(`${path} is not a plain JSON object.`);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) throw new TypeError(`${path} has symbol properties.`);
    const keys = ownKeys as string[];
    keys.sort();
    return `{${keys.map((key) => {
      if (!validUnicode(key)) throw new TypeError(`${path} contains an invalid key.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${path}.${key} is not an enumerable data property.`);
      }
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, `${path}.${key}`, ancestors)}`;
    }).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function structurallyBounded(value: unknown): boolean {
  const pending: Array<readonly [unknown, number]> = [[value, 0]];
  const seen = new Set<object>();
  let nodes = 0;
  while (pending.length > 0) {
    const [candidate, depth] = pending.pop() as readonly [unknown, number];
    nodes += 1;
    if (nodes > MAX_STRUCTURAL_NODES || depth > MAX_STRUCTURAL_DEPTH) return false;
    if (typeof candidate === "string" && Buffer.byteLength(candidate, "utf8") > MAX_CAPSULE_BYTES) return false;
    if (typeof candidate !== "object" || candidate === null) continue;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      if (candidate.length > MAX_STRUCTURAL_NODES) return false;
      const keys = Reflect.ownKeys(candidate);
      if (keys.some((key) => key !== "length" && (typeof key !== "string"
        || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= candidate.length))) return false;
      for (let index = 0; index < candidate.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false;
        pending.push([descriptor.value, depth + 1]);
      }
    } else if (isRecord(candidate)) {
      const keys = Reflect.ownKeys(candidate);
      if (keys.length > MAX_STRUCTURAL_NODES || keys.some((key) => typeof key !== "string")) return false;
      for (const key of keys as string[]) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false;
        pending.push([descriptor.value, depth + 1]);
      }
    } else return false;
  }
  return true;
}

function sha(value: unknown): string | null {
  return typeof value === "string" && SHA256_PATTERN.test(value) ? value : null;
}

function code(value: unknown, maximum = 256): string | null {
  return typeof value === "string" && value.length <= maximum && CODE_PATTERN.test(value) ? value : null;
}

function recordKey(value: unknown): string | null {
  return typeof value === "string" && value.length <= 512 && RECORD_KEY_PATTERN.test(value) ? value : null;
}

function orderedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || (values[index - 1] as string) < value);
}

function parseProfile(value: unknown): OhAdoptionStoreProfileV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["applicationProfileSha256", "capabilities", "profileId",
    "profileKind", "profileSha256", "v"]) || value.v !== 1 || value.profileKind !== "working"
    || !isRecord(value.capabilities) || !exactKeys(value.capabilities, ["changesSince",
      "dependencyClosureExport", "exactSnapshots", "operationReplication", "semanticBundleCommit", "v",
      "wholeSpacePurge"])) return null;
  const capabilities = value.capabilities;
  if (capabilities.changesSince !== true || capabilities.dependencyClosureExport !== true
    || capabilities.exactSnapshots !== true || capabilities.operationReplication !== false
    || capabilities.semanticBundleCommit !== true || capabilities.v !== 1
    || capabilities.wholeSpacePurge !== true) return null;
  const applicationProfileSha256 = value.applicationProfileSha256 === null
    ? null : sha(value.applicationProfileSha256);
  const profileId = code(value.profileId);
  const profileSha256 = sha(value.profileSha256);
  if ((value.applicationProfileSha256 !== null && applicationProfileSha256 === null)
    || profileId === null || profileSha256 === null) return null;
  const payload = { applicationProfileSha256, capabilities: {
    changesSince: true as const, dependencyClosureExport: true as const, exactSnapshots: true as const,
    operationReplication: false as const, semanticBundleCommit: true as const, v: 1 as const,
    wholeSpacePurge: true as const,
  }, profileId, profileKind: "working" as const, v: 1 as const };
  return digest(payload) === profileSha256 ? { ...payload, profileSha256 } : null;
}

function parseBinding(value: unknown): OhAdoptionStoreBindingV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["bindingSha256", "contractSha256", "profile", "realmId",
    "spaceId", "v"]) || value.v !== 1) return null;
  const bindingSha256 = sha(value.bindingSha256);
  const contractSha256 = sha(value.contractSha256);
  const profile = parseProfile(value.profile);
  const realmId = code(value.realmId);
  const spaceId = code(value.spaceId);
  if (bindingSha256 === null || contractSha256 === null || profile === null || realmId === null || spaceId === null) {
    return null;
  }
  const payload = { contractSha256, profile, realmId, spaceId, v: 1 as const };
  return digest(payload) === bindingSha256 ? { ...payload, bindingSha256 } : null;
}

function parseHead(value: unknown): OhAdoptionHeadV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["generation", "graphRevisionSha256", "operationSha256",
    "recordsSha256", "sequence", "v"]) || value.v !== 1) return null;
  const generation = Number.isSafeInteger(value.generation) && (value.generation as number) >= 0
    ? value.generation as number : null;
  const sequence = Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0
    ? value.sequence as number : null;
  const graphRevisionSha256 = value.graphRevisionSha256 === null ? null : sha(value.graphRevisionSha256);
  const operationSha256 = value.operationSha256 === null ? null : sha(value.operationSha256);
  const recordsSha256 = sha(value.recordsSha256);
  return generation !== null && generation === sequence && recordsSha256 !== null
      && (value.graphRevisionSha256 === null || graphRevisionSha256 !== null)
      && (value.operationSha256 === null || operationSha256 !== null)
      && ((sequence === 0) === (operationSha256 === null))
      && ((sequence === 0) === (graphRevisionSha256 === null))
    ? { generation, graphRevisionSha256, operationSha256, recordsSha256, sequence, v: 1 }
    : null;
}

function parseRecord(value: unknown): OhAdoptionRecordV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["dependencies", "key", "kind", "recordSha256", "v", "value"])
    || value.v !== 1 || !Array.isArray(value.dependencies)
    || value.dependencies.length > MAX_DEPENDENCIES || !OH_RECORD_KINDS.has(value.kind as string)
    || !structurallyBounded(value.value)) return null;
  const key = recordKey(value.key);
  const kind = typeof value.kind === "string" ? value.kind : null;
  const recordSha256 = sha(value.recordSha256);
  const dependencies = value.dependencies.map(recordKey);
  if (key === null || kind === null || recordSha256 === null || dependencies.some((item) => item === null)
    || !orderedUnique(dependencies as string[]) || dependencies.includes(key)) return null;
  const payload = { dependencies: dependencies as string[], key, kind, v: 1 as const,
    value: value.value as OhAdoptionJsonValue };
  const encoded = canonicalJson(payload.value);
  return Buffer.byteLength(encoded, "utf8") <= MAX_RECORD_BYTES && digest(payload) === recordSha256
    ? { ...payload, recordSha256 } : null;
}

function parseExpectedSource(value: unknown): OhAdoptionExpectedSourceV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["authorityId", "binding", "head", "v"]) || value.v !== 1) return null;
  const authorityId = code(value.authorityId);
  const binding = parseBinding(value.binding);
  const head = parseHead(value.head);
  return authorityId !== null && binding !== null && head !== null
    ? { authorityId, binding, head, v: 1 } : null;
}

/**
 * Temporary structural adapter for Oh V1 closure capsules. Replace this parser
 * with @hraness/oh's verifier when the immutable v0.2.0 release is available.
 */
export function parseOhDependencyClosureCapsuleV1(
  value: unknown,
  expectedSource: unknown,
): OhDependencyClosureCapsuleV1 | null {
  try {
    if (!structurallyBounded(value) || Buffer.byteLength(canonicalJson(value), "utf8") > MAX_CAPSULE_BYTES
      || !isRecord(value) || !exactKeys(value, ["binding", "closureSha256", "head", "records", "roots", "v"])
      || value.v !== 1 || !Array.isArray(value.records) || !Array.isArray(value.roots)
      || value.records.length < 1 || value.records.length > MAX_RECORDS
      || value.roots.length < 1 || value.roots.length > MAX_ROOTS) return null;
    const expected = parseExpectedSource(expectedSource);
    const binding = parseBinding(value.binding);
    const head = parseHead(value.head);
    const closureSha256 = sha(value.closureSha256);
    const roots = value.roots.map(recordKey);
    const records = value.records.map(parseRecord);
    if (expected === null || binding === null || head === null || closureSha256 === null
      || roots.some((root) => root === null) || !orderedUnique(roots as string[])
      || records.some((record) => record === null)) return null;
    const parsedRecords = records as OhAdoptionRecordV1[];
    if (!orderedUnique(parsedRecords.map((record) => record.key))) return null;
    if (canonicalJson(binding) !== canonicalJson(expected.binding)
      || canonicalJson(head) !== canonicalJson(expected.head)) return null;
    const byKey = new Map(parsedRecords.map((record) => [record.key, record]));
    const reachable = new Set<string>();
    const pending = [...roots as string[]];
    while (pending.length > 0) {
      const key = pending.pop() as string;
      if (reachable.has(key)) continue;
      const record = byKey.get(key);
      if (record === undefined) return null;
      reachable.add(key);
      pending.push(...record.dependencies);
    }
    if (reachable.size !== parsedRecords.length) return null;
    const payload = { binding, head, records: parsedRecords, roots: roots as string[], v: 1 as const };
    return digest(payload) === closureSha256 ? { ...payload, closureSha256 } : null;
  } catch {
    return null;
  }
}

function singleLine(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.normalize("NFC") !== value
    || !validUnicode(value) || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) return null;
  return value;
}

function parseDestination(value: unknown): DestinationV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["purpose", "targetPath", "v"]) || value.v !== 1) return null;
  const purpose = code(value.purpose);
  if (purpose === null || typeof value.targetPath !== "string" || value.targetPath.length > 512
    || value.targetPath.includes("\\") || value.targetPath.startsWith("/")
    || posix.normalize(value.targetPath) !== value.targetPath
    || !/^notes\/[a-z0-9][a-z0-9._/-]*\.md$/u.test(value.targetPath)
    || value.targetPath.split("/").some((segment) => segment === "." || segment === ".." || segment.startsWith("."))) {
    return null;
  }
  return { purpose, targetPath: value.targetPath, v: 1 };
}

function parseRights(value: unknown, purpose: string): RightsClearanceV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["decisionId", "disposition", "purpose", "v"])
    || value.v !== 1 || value.disposition !== "cleared-for-purpose" || value.purpose !== purpose) return null;
  const decisionId = code(value.decisionId);
  return decisionId === null ? null
    : { decisionId, disposition: "cleared-for-purpose", purpose, v: 1 };
}

function parseReview(value: unknown): ReviewRequirementV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["route", "status", "v"])
    || value.v !== 1 || value.status !== "required") return null;
  const route = code(value.route);
  return route === null ? null : { route, status: "required", v: 1 };
}

function parseConflicts(value: unknown): ConflictReviewV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["notes", "status", "v"]) || value.v !== 1
    || (value.status !== "none-observed" && value.status !== "requires-resolution")
    || !Array.isArray(value.notes) || value.notes.length < 1 || value.notes.length > 64) return null;
  const notes = value.notes.map(singleLine);
  if (notes.some((note) => note === null)) return null;
  const sorted = [...notes as string[]].sort();
  return orderedUnique(sorted) ? { notes: sorted, status: value.status, v: 1 } : null;
}

function parseDisclosures(value: unknown, keys: ReadonlySet<string>): readonly ChangeDisclosureV1[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const parsed: ChangeDisclosureV1[] = [];
  for (const item of value) {
    if (!isRecord(item) || !exactKeys(item, ["id", "recordKey", "summary", "v"]) || item.v !== 1) return null;
    const id = code(item.id);
    const key = recordKey(item.recordKey);
    const summary = singleLine(item.summary);
    if (id === null || key === null || summary === null || !keys.has(key)) return null;
    parsed.push({ id, recordKey: key, summary, v: 1 });
  }
  parsed.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return orderedUnique(parsed.map((item) => item.id)) ? parsed : null;
}

function markdownEscape(value: string): string {
  return value.replace(/[\\`*_{}\[\]<>()#+.!|>-]/gu, "\\$&");
}

function renderMarkdown(manifest: OhAdoptionCandidateV1["manifest"], candidateSha256: string): string {
  const lines = [
    "# Oh adoption candidate",
    "",
    `- Status: \`${manifest.status}\``,
    `- Candidate: \`sha256:${candidateSha256}\``,
    `- Destination: \`${manifest.destination.targetPath}\``,
    `- Purpose: \`${manifest.destination.purpose}\``,
    `- Source authority: \`${manifest.source.authorityId}\``,
    `- Source binding: \`${manifest.source.binding.bindingSha256}\``,
    `- Source head sequence: \`${manifest.source.head.sequence}\``,
    `- Source head operation: \`${manifest.source.head.operationSha256 ?? "empty"}\``,
    `- Source graph revision: \`${manifest.source.head.graphRevisionSha256 ?? "empty"}\``,
    `- Source records digest: \`${manifest.source.head.recordsSha256}\``,
    `- Closure: \`${manifest.source.closureSha256}\``,
    "",
    "This is a review candidate, not reviewed knowledge. It does not mutate a vault or adopt the source operation chain, database, projection, or derived tuples.",
    "",
    "## Required decisions",
    "",
    `- Rights: \`${manifest.rights.disposition}\` via \`${manifest.rights.decisionId}\` for \`${manifest.rights.purpose}\``,
    `- Review: \`${manifest.review.status}\` via \`${manifest.review.route}\``,
    `- Conflicts: \`${manifest.conflicts.status}\``,
    ...manifest.conflicts.notes.map((note) => `  - ${markdownEscape(note)}`),
    "",
    "## Selected roots",
    "",
    ...manifest.source.roots.map((root) => `- \`${root}\``),
    "",
    "## Exact source records",
    "",
  ];
  for (const record of manifest.source.records) {
    lines.push(`### \`${record.key}\``, "", `- Kind: \`${record.kind}\``,
      `- Digest: \`${record.recordSha256}\``,
      `- Dependencies: ${record.dependencies.length === 0 ? "none" : record.dependencies.map((key) => `\`${key}\``).join(", ")}`, "");
  }
  lines.push("## Transformations", "",
    ...(manifest.transformations.length === 0 ? ["- None declared."] : manifest.transformations.map((item) =>
      `- \`${item.id}\` on \`${item.recordKey}\`: ${markdownEscape(item.summary)}`)), "",
    "## Redactions", "",
    ...(manifest.redactions.length === 0 ? ["- None declared."] : manifest.redactions.map((item) =>
      `- \`${item.id}\` on \`${item.recordKey}\`: ${markdownEscape(item.summary)}`)), "");
  return `${lines.join("\n")}\n`;
}

/**
 * Produces bytes for destination review only. This function has no filesystem,
 * Git, store-write, sync, or promotion capability.
 */
export function prepareOhAdoptionCandidateV1(value: unknown): OhAdoptionCandidateV1 {
  if (!isRecord(value) || !exactKeys(value, ["capsule", "conflicts", "destination", "expectedSource",
    "redactions", "review", "rights", "transformations", "v"]) || value.v !== 1) {
    throw new TypeError("Invalid Oh adoption candidate input.");
  }
  const expectedSource = parseExpectedSource(value.expectedSource);
  const capsule = parseOhDependencyClosureCapsuleV1(value.capsule, value.expectedSource);
  const destination = parseDestination(value.destination);
  if (expectedSource === null || capsule === null || destination === null) {
    throw new TypeError("The source capsule or destination is invalid.");
  }
  const rights = parseRights(value.rights, destination.purpose);
  const review = parseReview(value.review);
  const conflicts = parseConflicts(value.conflicts);
  const recordKeys = new Set(capsule.records.map((record) => record.key));
  const transformations = parseDisclosures(value.transformations, recordKeys);
  const redactions = parseDisclosures(value.redactions, recordKeys);
  const roots = new Set(capsule.roots);
  if (rights === null || review === null || conflicts === null || transformations === null || redactions === null
    || capsule.records.filter((record) => roots.has(record.key)).every((record) => record.kind === "view")) {
    throw new TypeError("Adoption requires rights, review, conflict, and authoritative-root declarations.");
  }
  const source = {
    authorityId: expectedSource.authorityId,
    binding: capsule.binding,
    closureSha256: capsule.closureSha256,
    head: capsule.head,
    records: capsule.records.map((record) => ({ dependencies: record.dependencies, key: record.key,
      kind: record.kind, recordSha256: record.recordSha256, v: 1 as const })),
    roots: capsule.roots,
    v: 1 as const,
  };
  const manifest = {
    conflicts,
    destination,
    format: "hraness.kb.oh-adoption-candidate.v1" as const,
    redactions,
    review,
    rights,
    source,
    status: "prepared" as const,
    transformations,
    v: 1 as const,
  };
  const candidateSha256 = digest(manifest);
  const markdown = renderMarkdown(manifest, candidateSha256);
  if (Buffer.byteLength(markdown, "utf8") > MAX_CAPSULE_BYTES) {
    throw new RangeError("The adoption candidate exceeds its Markdown byte limit.");
  }
  return { artifactSha256: createHash("sha256").update(markdown).digest("hex"), candidateSha256,
    manifest, markdown, v: 1 };
}
