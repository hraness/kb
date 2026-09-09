import { createHash } from "node:crypto";
import { posix, relative, resolve, sep } from "node:path";
import { Document, isMap, isScalar, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { type NoteLockOptions } from "./note-lock.js";
import { isCanonicalNoteId, isCanonicalRelationPredicate } from "./graph.js";
import { parseDocumentId, parseQualifiedDocumentUri } from "./portfolio-identity.js";

export const MAX_NOTE_BYTES = 16 * 1024 * 1024;
export const NOTE_REVISION_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const MAX_PARENT_DIRECTORY_ENTRIES = 100_000;
export const MAX_RECOVERY_LOCATIONS_PER_NOTE = 8;

export type NoteRevision = `sha256:${string}`;

export interface NoteRelation {
  readonly predicate: string;
  readonly target: string;
}

export interface NoteAuthoringResult {
  readonly changed: boolean;
  /** Exact vault-relative Markdown path. */
  readonly path: string;
  readonly revision: NoteRevision;
  readonly relations: readonly NoteRelation[];
  /** Stable authored identity when the note has one valid document_id. */
  readonly documentId?: string;
}

export interface CreateNoteInput {
  /** Exact extensionless vault-root note ID, for example `notes/local-first`. */
  readonly id: string;
  /** Stable ID independent of note path. Generated for new notes when omitted. */
  readonly documentId?: string;
  readonly title: string;
  readonly type: string;
  readonly tags?: readonly string[];
  /** Markdown after frontmatter. Defaults to one H1; a final newline is added. */
  readonly body?: string;
}

export interface CreateConceptNoteInput {
  readonly id: string;
  readonly documentId?: string;
  readonly title: string;
  readonly tags?: readonly string[];
  readonly body?: string;
}

export interface AuthoringInstallContext {
  readonly operation: "create" | "replace";
  readonly path: string;
  readonly temporaryPath: string;
  /**
   * Private recovery path used by replacements. It is absent for creates and
   * remains on disk only when restoring it without clobbering a raced writer
   * is impossible.
   */
  readonly recoveryPath?: string;
}

export interface AuthoringDependencies {
  /** Stable authored document identity. Distinct from transaction filenames. */
  readonly documentId: () => string;
  /** Private transaction/recovery filename token. */
  readonly token: () => string;
  /**
   * Test and embedding seam immediately before ownership and source revision
   * are rechecked. Callers should normally omit this.
   */
  readonly beforeInstall?: (context: AuthoringInstallContext) => Promise<void>;
  /**
   * Deterministic test seam after the final optimistic read but immediately
   * before the no-clobber create or replacement transaction starts.
   */
  readonly beforeCommit?: (context: AuthoringInstallContext) => Promise<void>;
  /**
   * Deterministic test seam after an expected replacement source has been
   * moved and verified at recoveryPath, before the new content is linked.
   */
  readonly afterSourceQuarantined?: (
    context: Required<AuthoringInstallContext>,
  ) => Promise<void>;
}

export interface AuthoringOptions {
  readonly expectedRevision?: NoteRevision;
  readonly lock?: NoteLockOptions;
  readonly dependencies?: Partial<AuthoringDependencies>;
}

export class InvalidCanonicalNoteIdError extends TypeError {
  readonly noteId: string;

  constructor(noteId: string) {
    super(`not an exact canonical note ID: ${JSON.stringify(noteId)}`);
    this.name = "InvalidCanonicalNoteIdError";
    this.noteId = noteId;
  }
}

export class NoteRevisionConflictError extends Error {
  readonly path: string;
  readonly expected: NoteRevision | null;
  readonly actual: NoteRevision | null;
  /** Vault-relative path retaining the displaced bytes, when restoration raced. */
  readonly recoveryPath: string | null;

  constructor(
    path: string,
    expected: NoteRevision | null,
    actual: NoteRevision | null,
    recoveryPath: string | null = null,
  ) {
    super(recoveryPath === null
      ? "the note changed during authoring; retry from its current revision"
      : `the note changed during authoring; displaced bytes remain at ${recoveryPath}`);
    this.name = "NoteRevisionConflictError";
    this.path = path;
    this.expected = expected;
    this.actual = actual;
    this.recoveryPath = recoveryPath;
  }
}

export class NoteAlreadyExistsError extends Error {
  readonly path: string;

  constructor(path: string, reason: string) {
    super(`the existing note is incompatible with this create request: ${reason}`);
    this.name = "NoteAlreadyExistsError";
    this.path = path;
  }
}

export class NoteRecoveryRequiredError extends Error {
  readonly path: string;
  readonly recoveryPath: string;

  constructor(path: string, recoveryPath: string, cause: unknown) {
    super(`authoring stopped; displaced bytes remain at ${recoveryPath}`, { cause });
    this.name = "NoteRecoveryRequiredError";
    this.path = path;
    this.recoveryPath = recoveryPath;
  }
}

export interface Vault {
  readonly root: string;
}

export interface NoteSnapshot {
  readonly path: string;
  readonly relativePath: string;
  readonly content: string;
  readonly revision: NoteRevision;
  readonly device: bigint;
  readonly inode: bigint;
  readonly size: bigint;
  readonly modifiedAtNs: bigint;
  readonly changedAtNs: bigint;
  readonly mode: number;
}

export interface FrontmatterParts {
  readonly document: Document;
  readonly hadFrontmatter: boolean;
  readonly openingDelimiter: string;
  readonly closingDelimiter: string;
  readonly newline: "\n" | "\r\n";
  /** Exact bytes after the existing closing delimiter, including its newline. */
  readonly bodySuffix: string;
}

export interface RelationNodes {
  readonly root: YAMLMap;
  readonly relations: YAMLMap | null;
}

export function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function revisionFor(bytes: Uint8Array): NoteRevision {
  return `sha256:${sha256(bytes)}`;
}

export function inside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== ""
    && fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`);
}

/** Validate and return an exact extensionless canonical vault note ID. */
export function canonicalNoteId(value: string): string {
  if (!isCanonicalNoteId(value)) {
    throw new InvalidCanonicalNoteIdError(value);
  }
  return value;
}

/** Validate a local exact note ID or a stable canonical cross-vault URI. */
export function canonicalRelationTarget(value: string): string {
  if (value.startsWith("kb://")) return parseQualifiedDocumentUri(value).uri;
  return canonicalNoteId(value);
}

/** Normalize a caller predicate to the strict lower-kebab authored form. */
export function normalizeRelationPredicate(value: string): string {
  const normalized = value
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase("en-US")
    .replaceAll("_", "-")
    .replace(/\s+/gu, "-")
    .replace(/-{2,}/gu, "-");
  if (!isCanonicalRelationPredicate(normalized)) {
    throw new TypeError(`not a valid relation predicate: ${JSON.stringify(value)}`);
  }
  return normalized;
}

export function exactPredicate(value: string): string {
  const normalized = normalizeRelationPredicate(value);
  if (value !== normalized) {
    throw new Error(`authored relation predicate is not canonical kebab-case: ${value}`);
  }
  return value;
}

export function requireRevision(value: string): NoteRevision {
  if (!NOTE_REVISION_PATTERN.test(value)) {
    throw new TypeError("expectedRevision is not a KB note revision");
  }
  return value as NoteRevision;
}

export function pathFor(vault: Vault, id: string): {
  readonly path: string;
  readonly relativePath: string;
} {
  const canonicalId = canonicalNoteId(id);
  const relativePath = `${canonicalId}.md`;
  const path = resolve(vault.root, ...relativePath.split("/"));
  if (!inside(vault.root, path)) {
    throw new InvalidCanonicalNoteIdError(id);
  }
  return { path, relativePath };
}

export function sameSnapshot(left: NoteSnapshot, right: NoteSnapshot): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.modifiedAtNs === right.modifiedAtNs
    && left.changedAtNs === right.changedAtNs
    && left.mode === right.mode
    && left.revision === right.revision;
}

export function frontmatter(content: string, relativePath: string): FrontmatterParts {
  const firstLineEnd = content.indexOf("\n");
  const openingEnd = firstLineEnd === -1 ? content.length : firstLineEnd;
  const openingContentEnd = content[openingEnd - 1] === "\r"
    ? openingEnd - 1
    : openingEnd;
  const opening = content.slice(0, openingContentEnd);
  if (opening.trim() !== "---") {
    return {
      document: parseFrontmatterDocument("", relativePath),
      hadFrontmatter: false,
      openingDelimiter: "---",
      closingDelimiter: "---",
      newline: content.includes("\r\n") ? "\r\n" : "\n",
      bodySuffix: content,
    };
  }
  if (firstLineEnd === -1) {
    throw new Error(`invalid YAML frontmatter in ${relativePath}: missing closing delimiter`);
  }
  const newline = content[firstLineEnd - 1] === "\r" ? "\r\n" : "\n";
  let cursor = firstLineEnd + 1;
  for (;;) {
    const nextNewline = content.indexOf("\n", cursor);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    const lineContentEnd = content[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
    const line = content.slice(cursor, lineContentEnd);
    if (line.trim() === "---") {
      const yamlSource = content.slice(firstLineEnd + 1, cursor);
      return {
        document: parseFrontmatterDocument(yamlSource, relativePath),
        hadFrontmatter: true,
        openingDelimiter: content.slice(0, openingContentEnd),
        closingDelimiter: content.slice(cursor, lineContentEnd),
        newline,
        bodySuffix: content.slice(lineContentEnd),
      };
    }
    if (nextNewline === -1) break;
    cursor = nextNewline + 1;
  }
  throw new Error(`invalid YAML frontmatter in ${relativePath}: missing closing delimiter`);
}

export function parseFrontmatterDocument(source: string, relativePath: string): Document {
  const document = parseDocument(source, {
    keepSourceTokens: true,
    schema: "core",
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`invalid YAML frontmatter in ${relativePath}`);
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new Error(`invalid YAML frontmatter in ${relativePath}: expected a mapping`);
  }
  if (isMap(document.contents)) {
    const seen = new Set<string>();
    for (const pair of document.contents.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
        throw new Error(`invalid YAML frontmatter in ${relativePath}: keys must be strings`);
      }
      const folded = pair.key.value.toLocaleLowerCase("en-US");
      if (seen.has(folded)) {
        throw new Error(
          `invalid YAML frontmatter in ${relativePath}: keys must not differ only by case`,
        );
      }
      seen.add(folded);
    }
  }
  return document;
}

export function relationNodes(
  parts: FrontmatterParts,
  relativePath: string,
  create: boolean,
): RelationNodes {
  const { document } = parts;
  if (document.contents === null) {
    if (!create) {
      const detached = document.createNode({});
      if (!isMap(detached)) throw new Error("YAML did not create a mapping");
      return { root: detached, relations: null };
    }
    document.contents = document.createNode({});
  }
  if (!isMap(document.contents)) {
    throw new Error(`invalid YAML frontmatter in ${relativePath}: expected a mapping`);
  }
  const root = document.contents;
  const relationPair = root.items.find((pair) =>
    isScalar(pair.key)
    && typeof pair.key.value === "string"
    && pair.key.value.toLocaleLowerCase("en-US") === "relations");
  const existing = relationPair?.value;
  if (existing === undefined) {
    if (!create) return { root, relations: null };
    const created = document.createNode({});
    if (!isMap(created)) throw new Error("YAML did not create a relation mapping");
    root.set("relations", created);
    return { root, relations: created };
  }
  if (!isMap(existing)) {
    throw new Error(`invalid relations in ${relativePath}: expected a mapping`);
  }
  return { root, relations: existing };
}

export function scalarString(value: unknown): string | null {
  return isScalar(value) && typeof value.value === "string" ? value.value : null;
}

export function relationsFromParts(
  parts: FrontmatterParts,
  relativePath: string,
): readonly NoteRelation[] {
  const { relations } = relationNodes(parts, relativePath, false);
  if (relations === null) return [];
  const output: NoteRelation[] = [];
  const seen = new Set<string>();
  for (const pair of relations.items) {
    const predicateValue = scalarString(pair.key);
    if (predicateValue === null) {
      throw new Error(`invalid relations in ${relativePath}: predicates must be strings`);
    }
    const predicate = exactPredicate(predicateValue);
    const scalarTarget = scalarString(pair.value);
    if (scalarTarget !== null) {
      const target = canonicalRelationTarget(scalarTarget);
      const key = `${predicate}\0${target}`;
      if (!seen.has(key)) {
        seen.add(key);
        output.push({ predicate, target });
      }
      continue;
    }
    if (!isSeq(pair.value)) {
      throw new Error(
        `invalid relations in ${relativePath}: ${predicate} targets must be a string or array`,
      );
    }
    for (const item of pair.value.items) {
      const targetValue = scalarString(item);
      if (targetValue === null) {
        throw new Error(
          `invalid relations in ${relativePath}: ${predicate} targets must be strings`,
        );
      }
      const target = canonicalRelationTarget(targetValue);
      const key = `${predicate}\0${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ predicate, target });
    }
  }
  return output.toSorted((left, right) =>
    left.predicate.localeCompare(right.predicate)
    || left.target.localeCompare(right.target));
}

export type RelationValue =
  | { readonly kind: "scalar"; readonly target: string }
  | { readonly kind: "sequence"; readonly sequence: YAMLSeq }
  | null;

export function relationValue(
  relations: YAMLMap,
  predicate: string,
  relativePath: string,
): RelationValue {
  const value = relations.get(predicate, true);
  if (value === undefined) return null;
  const scalarTarget = scalarString(value);
  if (scalarTarget !== null) {
    return { kind: "scalar", target: canonicalRelationTarget(scalarTarget) };
  }
  if (!isSeq(value)) {
    throw new Error(
      `invalid relations in ${relativePath}: ${predicate} targets must be a string or array`,
    );
  }
  for (const item of value.items) {
    if (scalarString(item) === null) {
      throw new Error(
        `invalid relations in ${relativePath}: ${predicate} targets must be strings`,
      );
    }
  }
  return { kind: "sequence", sequence: value };
}

export function renderFrontmatter(parts: FrontmatterParts): string {
  let yaml = parts.document.toString({ lineWidth: 0 });
  if (parts.newline === "\r\n") yaml = yaml.replaceAll("\n", "\r\n");
  if (!yaml.endsWith(parts.newline)) yaml += parts.newline;
  if (parts.hadFrontmatter) {
    return parts.openingDelimiter
      + parts.newline
      + yaml
      + parts.closingDelimiter
      + parts.bodySuffix;
  }
  return parts.openingDelimiter
    + parts.newline
    + yaml
    + parts.closingDelimiter
    + parts.newline
    + parts.bodySuffix;
}

export function compareScalarNodes(left: unknown, right: unknown): number {
  return (scalarString(left) ?? "").localeCompare(scalarString(right) ?? "");
}

export function addRelationToParts(
  parts: FrontmatterParts,
  relativePath: string,
  predicate: string,
  target: string,
): boolean {
  const { relations } = relationNodes(parts, relativePath, true);
  if (relations === null) throw new Error("YAML did not create relations");
  const existing = relationValue(relations, predicate, relativePath);
  if (existing === null) {
    const created = parts.document.createNode([target], { flow: true });
    if (!isSeq(created)) throw new Error("YAML did not create a relation sequence");
    relations.set(predicate, created);
    return true;
  }
  if (existing.kind === "scalar") {
    if (existing.target === target) return false;
    const created = parts.document.createNode(
      [existing.target, target].toSorted((left, right) => left.localeCompare(right)),
      { flow: true },
    );
    if (!isSeq(created)) throw new Error("YAML did not create a relation sequence");
    relations.set(predicate, created);
    return true;
  }
  const sequence = existing.sequence;
  if (sequence.items.some((item) => scalarString(item) === target)) return false;
  sequence.add(parts.document.createNode(target));
  sequence.items.sort(compareScalarNodes);
  return true;
}

export function removeRelationFromParts(
  parts: FrontmatterParts,
  relativePath: string,
  predicate: string,
  target: string,
  sourceId: string,
): boolean {
  const { root, relations } = relationNodes(parts, relativePath, false);
  if (relations === null) return false;
  const value = relations.get(predicate, true);
  if (value === undefined) return false;

  const repairableTarget = (raw: string): string | null => {
    if (raw.startsWith("kb://")) {
      try {
        return canonicalRelationTarget(raw);
      } catch {
        return null;
      }
    }
    let candidate = raw;
    if (candidate.toLocaleLowerCase("en-US").endsWith(".md")) {
      candidate = candidate.slice(0, -3);
    }
    if (candidate.startsWith(".")) {
      candidate = posix.normalize(posix.join(posix.dirname(sourceId), candidate));
    }
    return isCanonicalNoteId(candidate) ? candidate : null;
  };
  const matches = (node: unknown): boolean => {
    const raw = scalarString(node);
    return raw !== null && repairableTarget(raw) === target;
  };

  if (!isSeq(value)) {
    if (!matches(value)) return false;
    relations.delete(predicate);
    if (relations.items.length === 0) root.delete("relations");
    return true;
  }
  const sequence = value;
  const retained = sequence.items.filter((item) => !matches(item));
  if (retained.length === sequence.items.length) return false;
  if (retained.length === 0) {
    relations.delete(predicate);
    if (relations.items.length === 0) root.delete("relations");
  } else {
    sequence.items = retained;
  }
  return true;
}

export interface RecoveryLocation {
  readonly directory: string;
  readonly path: string;
  readonly relativePath: string;
  readonly device: bigint;
  readonly inode: bigint;
}

export interface DirectoryIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

export function recoveryRelativePath(vault: Vault, path: string): string {
  return relative(vault.root, path).split(sep).join("/");
}

export function sameQuarantinedSnapshot(
  quarantined: NoteSnapshot,
  expected: NoteSnapshot,
): boolean {
  // A rename may update ctime on some supported filesystems. Identity, bytes,
  // mode, size, and mtime still prove that the entry moved was the snapshot
  // accepted by the optimistic read.
  return quarantined.device === expected.device
    && quarantined.inode === expected.inode
    && quarantined.size === expected.size
    && quarantined.modifiedAtNs === expected.modifiedAtNs
    && quarantined.mode === expected.mode
    && quarantined.revision === expected.revision;
}

export function withRecoveryPath(
  error: unknown,
  relativePath: string,
  recoveryPath: string,
): Error {
  if (error instanceof NoteRevisionConflictError) {
    return new NoteRevisionConflictError(
      error.path,
      error.expected,
      error.actual,
      recoveryPath,
    );
  }
  return new NoteRecoveryRequiredError(relativePath, recoveryPath, error);
}

export function checkedExpectedRevision(options: AuthoringOptions): NoteRevision | undefined {
  return options.expectedRevision === undefined
    ? undefined
    : requireRevision(options.expectedRevision);
}

export function assertExpected(
  snapshot: NoteSnapshot,
  expected: NoteRevision | undefined,
): void {
  if (expected !== undefined && snapshot.revision !== expected) {
    throw new NoteRevisionConflictError(
      snapshot.relativePath,
      expected,
      snapshot.revision,
    );
  }
}

export function noteResult(
  snapshot: Pick<NoteSnapshot, "relativePath" | "revision">,
  relations: readonly NoteRelation[],
  changed: boolean,
  documentId?: string,
): NoteAuthoringResult {
  return {
    changed,
    path: snapshot.relativePath,
    revision: snapshot.revision,
    relations,
    ...(documentId === undefined ? {} : { documentId }),
  };
}

export function validateTitle(title: string): string {
  if (
    title === ""
    || title !== title.trim()
    || title.includes("\n")
    || title.includes("\r")
    || title.length > 512
  ) {
    throw new TypeError("a note title must be a non-empty single line");
  }
  return title;
}

export function validateType(type: string): string {
  const canonical = normalizeRelationPredicate(type);
  if (canonical !== type) throw new TypeError("a note type must be canonical kebab-case");
  return type;
}

export function validateTags(tags: readonly string[] | undefined): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of tags ?? []) {
    const tag = candidate.trim().replace(/^#+/u, "").normalize("NFC");
    if (
      tag === ""
      || tag.includes("\n")
      || tag.includes("\r")
      || tag.length > 128
    ) {
      throw new TypeError(`not a valid note tag: ${JSON.stringify(candidate)}`);
    }
    const folded = tag.toLocaleLowerCase("en-US");
    if (seen.has(folded)) continue;
    seen.add(folded);
    result.push(tag);
  }
  return result;
}

export function normalizedRequestedBody(body: string): string {
  return body.endsWith("\n") ? body : `${body}\n`;
}

export function renderCreatedNote(input: CreateNoteInput, documentId: string): string {
  const title = validateTitle(input.title);
  const type = validateType(input.type);
  const tags = validateTags(input.tags);
  const metadata: Record<string, unknown> = { document_id: documentId, type, title };
  if (tags.length > 0) metadata["tags"] = tags;
  const document = new Document(metadata, { schema: "core" });
  const body = normalizedRequestedBody(input.body ?? `# ${title}\n`);
  return `---\n${document.toString({ lineWidth: 0 })}---\n\n${body}`;
}

export function topLevelScalar(
  parts: FrontmatterParts,
  key: string,
): string | null {
  if (!isMap(parts.document.contents)) return null;
  return scalarString(parts.document.contents.get(key, true));
}

export function topLevelStrings(
  parts: FrontmatterParts,
  key: string,
): readonly string[] {
  if (!isMap(parts.document.contents)) return [];
  const value = parts.document.contents.get(key, true);
  if (value === undefined) return [];
  if (isScalar(value) && typeof value.value === "string") return [value.value];
  if (!isSeq(value)) return [];
  return value.items.flatMap((item) => {
    const candidate = scalarString(item);
    return candidate === null ? [] : [candidate];
  });
}

export type ExistingDocumentId =
  | { readonly kind: "invalid" }
  | { readonly kind: "missing" }
  | { readonly kind: "valid"; readonly documentId: string };

export function existingDocumentId(parts: FrontmatterParts): ExistingDocumentId {
  if (!isMap(parts.document.contents)) return { kind: "missing" };
  const values = parts.document.contents.items.flatMap((pair) => {
    const key = scalarString(pair.key);
    if (key?.normalize("NFC").toLocaleLowerCase("en-US") !== "document_id") return [];
    const value = scalarString(pair.value);
    return value === null ? [null] : [value];
  });
  if (values.length === 0) return { kind: "missing" };
  if (values.length !== 1 || values[0] === null) return { kind: "invalid" };
  try {
    return { kind: "valid", documentId: parseDocumentId(values[0]) };
  } catch {
    return { kind: "invalid" };
  }
}

export type CompatibleCreate = {
  readonly documentId?: string;
  readonly relations: readonly NoteRelation[];
};

export function assertCompatibleCreate(
  snapshot: NoteSnapshot,
  input: CreateNoteInput,
  requestedDocumentId: string | undefined,
): CompatibleCreate {
  const parts = frontmatter(snapshot.content, snapshot.relativePath);
  const requestedType = validateType(input.type);
  const requestedTitle = validateTitle(input.title);
  if (topLevelScalar(parts, "type") !== requestedType) {
    throw new NoteAlreadyExistsError(snapshot.relativePath, "type differs");
  }
  if (topLevelScalar(parts, "title") !== requestedTitle) {
    throw new NoteAlreadyExistsError(snapshot.relativePath, "title differs");
  }
  const presentTags = new Set(
    topLevelStrings(parts, "tags").map((tag) => tag.toLocaleLowerCase("en-US")),
  );
  const missingTag = validateTags(input.tags)
    .find((tag) => !presentTags.has(tag.toLocaleLowerCase("en-US")));
  if (missingTag !== undefined) {
    throw new NoteAlreadyExistsError(snapshot.relativePath, `tag is missing: ${missingTag}`);
  }
  if (
    input.body !== undefined
    && parts.bodySuffix !== `${parts.newline}${parts.newline}${normalizedRequestedBody(input.body)}`
  ) {
    throw new NoteAlreadyExistsError(snapshot.relativePath, "body differs");
  }
  const existingId = existingDocumentId(parts);
  if (
    requestedDocumentId !== undefined
    && (existingId.kind !== "valid" || existingId.documentId !== requestedDocumentId)
  ) {
    throw new NoteAlreadyExistsError(
      snapshot.relativePath,
      existingId.kind === "missing" ? "document_id is missing" : "document_id differs",
    );
  }
  return {
    relations: relationsFromParts(parts, snapshot.relativePath),
    ...(existingId.kind === "valid" ? { documentId: existingId.documentId } : {}),
  };
}
