import { createHash } from "node:crypto";
import { posix } from "node:path";

import { canonicalJson, canonicalSha256 } from "@hraness/oh";
import {
  parseOhHeadV1,
  parseOhStoreBindingV1,
  verifyOhDependencyClosureAgainstV1,
  type OhDependencyClosureV1,
  type OhHeadV1,
  type OhStoreBindingV1,
} from "@hraness/oh/store";

const CODE_PATTERN = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u;
const RECORD_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u;
const MAX_CAPSULE_BYTES = 16 * 1024 * 1024;
const MAX_RECORDS = 1_024;
const MAX_ROOTS = 256;
const MAX_TEXT_BYTES = 4_096;
const MAX_STRUCTURAL_NODES = 262_144;
const MAX_STRUCTURAL_DEPTH = 128;

export interface OhAdoptionExpectedSourceV1 {
  readonly authorityId: string;
  readonly binding: OhStoreBindingV1;
  readonly head: OhHeadV1;
  readonly v: 1;
}

export interface OhAdoptionDestinationV1 {
  readonly purpose: string;
  readonly targetPath: string;
  readonly v: 1;
}

export interface OhAdoptionRightsClearanceV1 {
  readonly decisionId: string;
  readonly disposition: "cleared-for-purpose";
  readonly purpose: string;
  readonly v: 1;
}

export interface OhAdoptionReviewRequirementV1 {
  readonly route: string;
  readonly status: "required";
  readonly v: 1;
}

export interface OhAdoptionConflictReviewV1 {
  readonly notes: readonly string[];
  readonly status: "none-observed" | "requires-resolution";
  readonly v: 1;
}

export interface OhAdoptionChangeDisclosureV1 {
  readonly id: string;
  readonly recordKey: string;
  readonly summary: string;
  readonly v: 1;
}

export interface OhAdoptionHostPolicyV1 {
  readonly conflicts: OhAdoptionConflictReviewV1;
  readonly destination: OhAdoptionDestinationV1;
  readonly expectedSource: OhAdoptionExpectedSourceV1;
  readonly review: OhAdoptionReviewRequirementV1;
  readonly rights: OhAdoptionRightsClearanceV1;
  readonly v: 1;
}

export interface OhAdoptionPrepareInputV1 {
  readonly capsule: OhDependencyClosureV1;
  readonly redactions: readonly OhAdoptionChangeDisclosureV1[];
  readonly transformations: readonly OhAdoptionChangeDisclosureV1[];
  readonly v: 1;
}

export interface OhAdoptionCandidateV1 {
  readonly artifactSha256: string;
  readonly candidateSha256: string;
  readonly manifest: Readonly<{
    readonly conflicts: OhAdoptionConflictReviewV1;
    readonly destination: OhAdoptionDestinationV1;
    readonly format: "hraness.kb.oh-adoption-candidate.v1";
    readonly redactions: readonly OhAdoptionChangeDisclosureV1[];
    readonly review: OhAdoptionReviewRequirementV1;
    readonly rights: OhAdoptionRightsClearanceV1;
    readonly source: Readonly<{
      readonly authorityId: string;
      readonly binding: Readonly<{
        readonly bindingSha256: string;
        readonly v: 1;
      }>;
      readonly closureSha256: string;
      readonly head: OhHeadV1;
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
    readonly transformations: readonly OhAdoptionChangeDisclosureV1[];
    readonly v: 1;
  }>;
  readonly markdown: string;
  readonly v: 1;
}

export interface OhAdoptionPreparerV1 {
  /** Accepts capsule bytes and disclosures only; all authority and policy are host-bound. */
  prepare(value: unknown): OhAdoptionCandidateV1;
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

function structurallyBounded(value: unknown): boolean {
  const pending: Array<readonly [unknown, number]> = [[value, 0]];
  const seen = new Set<object>();
  let nodes = 0;
  let scalarBytes = 0;
  while (pending.length > 0) {
    const [candidate, depth] = pending.pop() as readonly [unknown, number];
    nodes += 1;
    scalarBytes += 4;
    if (nodes > MAX_STRUCTURAL_NODES || depth > MAX_STRUCTURAL_DEPTH
      || scalarBytes > MAX_CAPSULE_BYTES) return false;
    if (typeof candidate === "string") {
      if (!validUnicode(candidate)) return false;
      scalarBytes += Buffer.byteLength(candidate, "utf8");
      if (scalarBytes > MAX_CAPSULE_BYTES) return false;
    }
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
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)
          || !validUnicode(key)) return false;
        scalarBytes += Buffer.byteLength(key, "utf8");
        if (scalarBytes > MAX_CAPSULE_BYTES) return false;
        pending.push([descriptor.value, depth + 1]);
      }
    } else return false;
  }
  return true;
}

function immutableClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => immutableClone(item))) as T;
  }
  if (isRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) clone[key] = immutableClone(value[key]);
    return Object.freeze(clone) as T;
  }
  return value;
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

function unsafeReviewCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f
    || (codePoint >= 0x7f && codePoint <= 0x9f)
    || codePoint === 0x061c
    || codePoint === 0x200e
    || codePoint === 0x200f
    || (codePoint >= 0x2028 && codePoint <= 0x202e)
    || (codePoint >= 0x2066 && codePoint <= 0x2069)
    || codePoint === 0xfeff;
}

function singleLine(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.normalize("NFC") !== value
    || !validUnicode(value) || [...value].some((character) =>
      unsafeReviewCodePoint(character.codePointAt(0) ?? 0))
    || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) return null;
  return value;
}

function parseExpectedSource(value: unknown): OhAdoptionExpectedSourceV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["authorityId", "binding", "head", "v"])
    || value.v !== 1) return null;
  const authorityId = code(value.authorityId);
  const binding = parseOhStoreBindingV1(value.binding);
  const head = parseOhHeadV1(value.head);
  return authorityId !== null && binding !== null && binding.profile.profileKind === "working" && head !== null
    ? immutableClone({ authorityId, binding, head, v: 1 }) : null;
}

function parseDestination(value: unknown): OhAdoptionDestinationV1 | null {
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

function parseRights(value: unknown, purpose: string): OhAdoptionRightsClearanceV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["decisionId", "disposition", "purpose", "v"])
    || value.v !== 1 || value.disposition !== "cleared-for-purpose" || value.purpose !== purpose) return null;
  const decisionId = code(value.decisionId);
  return decisionId === null ? null
    : { decisionId, disposition: "cleared-for-purpose", purpose, v: 1 };
}

function parseReview(value: unknown): OhAdoptionReviewRequirementV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["route", "status", "v"])
    || value.v !== 1 || value.status !== "required") return null;
  const route = code(value.route);
  return route === null ? null : { route, status: "required", v: 1 };
}

function parseConflicts(value: unknown): OhAdoptionConflictReviewV1 | null {
  if (!isRecord(value) || !exactKeys(value, ["notes", "status", "v"]) || value.v !== 1
    || (value.status !== "none-observed" && value.status !== "requires-resolution")
    || !Array.isArray(value.notes) || value.notes.length < 1 || value.notes.length > 64) return null;
  const notes = value.notes.map(singleLine);
  if (notes.some((note) => note === null)) return null;
  const sorted = [...notes as string[]].sort();
  return orderedUnique(sorted) ? { notes: sorted, status: value.status, v: 1 } : null;
}

function parseHostPolicy(value: unknown): OhAdoptionHostPolicyV1 | null {
  if (!structurallyBounded(value) || !isRecord(value)
    || !exactKeys(value, ["conflicts", "destination", "expectedSource", "review", "rights", "v"])
    || value.v !== 1) return null;
  const destination = parseDestination(value.destination);
  const expectedSource = parseExpectedSource(value.expectedSource);
  const conflicts = parseConflicts(value.conflicts);
  const review = parseReview(value.review);
  const rights = destination === null ? null : parseRights(value.rights, destination.purpose);
  return destination !== null && expectedSource !== null && conflicts !== null && review !== null && rights !== null
    ? immutableClone({ conflicts, destination, expectedSource, review, rights, v: 1 }) : null;
}

function verifyCapsule(
  value: unknown,
  expectedSource: OhAdoptionExpectedSourceV1,
): OhDependencyClosureV1 | null {
  try {
    if (!structurallyBounded(value) || !isRecord(value)
      || !exactKeys(value, ["binding", "closureSha256", "head", "records", "roots", "v"])
      || value.v !== 1 || !Array.isArray(value.records) || !Array.isArray(value.roots)
      || value.records.length < 1 || value.records.length > MAX_RECORDS
      || value.roots.length < 1 || value.roots.length > MAX_ROOTS
      || Buffer.byteLength(canonicalJson(value), "utf8") > MAX_CAPSULE_BYTES) return null;
    const verified = verifyOhDependencyClosureAgainstV1(value, {
      binding: expectedSource.binding,
      head: expectedSource.head,
    });
    return verified.ok && verified.closure.binding.profile.profileKind === "working"
      ? verified.closure : null;
  } catch {
    return null;
  }
}

function parseDisclosures(value: unknown, keys: ReadonlySet<string>): readonly OhAdoptionChangeDisclosureV1[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const parsed: OhAdoptionChangeDisclosureV1[] = [];
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

function prepareWithPolicy(
  value: unknown,
  policy: OhAdoptionHostPolicyV1,
): OhAdoptionCandidateV1 {
  if (!structurallyBounded(value) || !isRecord(value)
    || !exactKeys(value, ["capsule", "redactions", "transformations", "v"]) || value.v !== 1) {
    throw new TypeError("Invalid Oh adoption preparation input.");
  }
  const capsule = verifyCapsule(value.capsule, policy.expectedSource);
  if (capsule === null) throw new TypeError("The source capsule is invalid for the bound authority and head.");
  const recordKeys = new Set(capsule.records.map((record) => record.key));
  const transformations = parseDisclosures(value.transformations, recordKeys);
  const redactions = parseDisclosures(value.redactions, recordKeys);
  const roots = new Set(capsule.roots);
  if (transformations === null || redactions === null
    || capsule.records.filter((record) => roots.has(record.key)).every((record) => record.kind === "view")) {
    throw new TypeError("Adoption requires valid disclosures and an authoritative root.");
  }
  const source = {
    authorityId: policy.expectedSource.authorityId,
    binding: { bindingSha256: capsule.binding.bindingSha256, v: 1 as const },
    closureSha256: capsule.closureSha256,
    head: capsule.head,
    records: capsule.records.map((record) => ({ dependencies: record.dependencies, key: record.key,
      kind: record.kind, recordSha256: record.recordSha256, v: 1 as const })),
    roots: capsule.roots,
    v: 1 as const,
  };
  const manifest = {
    conflicts: policy.conflicts,
    destination: policy.destination,
    format: "hraness.kb.oh-adoption-candidate.v1" as const,
    redactions,
    review: policy.review,
    rights: policy.rights,
    source,
    status: "prepared" as const,
    transformations,
    v: 1 as const,
  };
  const candidateSha256 = canonicalSha256(manifest);
  const markdown = renderMarkdown(manifest, candidateSha256);
  if (Buffer.byteLength(markdown, "utf8") > MAX_CAPSULE_BYTES) {
    throw new RangeError("The adoption candidate exceeds its Markdown byte limit.");
  }
  return immutableClone({
    artifactSha256: createHash("sha256").update(markdown).digest("hex"),
    candidateSha256,
    manifest,
    markdown,
    v: 1,
  });
}

/**
 * Captures all authority, destination, rights, review, and conflict policy in
 * trusted host code. The returned facade can only prepare inert review bytes.
 */
export function createOhAdoptionPreparerV1(value: unknown): OhAdoptionPreparerV1 {
  const policy = parseHostPolicy(value);
  if (policy === null) throw new TypeError("Invalid Oh adoption host policy.");
  return Object.freeze({ prepare: (input: unknown) => prepareWithPolicy(input, policy) });
}
