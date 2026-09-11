import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  analyzeVault,
  isCanonicalNoteId,
  parseNote,
  VaultAnalysisBudgetError,
  type Note,
} from "./graph.js";
import {
  GRAPH_LIMITS,
  GraphAuthorityError,
  type GraphAtom,
  type GraphFact,
  type GraphFactRelation,
  type GraphSnapshot,
  type GraphSourceRecord,
} from "./graph-authority-model.js";
import { documentIdState } from "./portfolio-identity.js";
import { analyzeAuthoredRepositoryScopes } from "./repository-memory.js";
import type { VaultSnapshot } from "./vault.js";

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** Internal protocol serialization: only freshly constructed, finite JSON values enter here. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).toSorted(([left], [right]) => compareText(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function invalid(message: string): never {
  throw new GraphAuthorityError("invalid-input", message);
}

function budget(message: string): never {
  throw new GraphAuthorityError("budget", message);
}

function textAtom(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be a string.`);
  if (Buffer.byteLength(value, "utf8") > GRAPH_LIMITS.atomBytes) {
    budget(`${label} exceeds the ${GRAPH_LIMITS.atomBytes} byte graph atom limit.`);
  }
  return value;
}

function markdownPath(value: unknown, label: string): string {
  const path = textAtom(value, label);
  if (!path.toLowerCase().endsWith(".md") || !isCanonicalNoteId(path.slice(0, -3))) {
    invalid(`${label} must be a canonical vault-relative Markdown path.`);
  }
  return path;
}

type CheckedSource = Readonly<{ note: Note; documentId: string | null; scopes: readonly string[] }>;

/**
 * Derive a bounded, immutable graph edition from authored Markdown.
 * Caller-provided parsed fields and analysis are not evidence: facts are reparsed
 * from the same bytes whose digests bind every returned source record.
 */
export function createGraphSnapshot(snapshot: VaultSnapshot): GraphSnapshot {
  if (snapshot === null || typeof snapshot !== "object") invalid("A vault snapshot is required.");
  const rootInput = textAtom(snapshot.root, "Vault root");
  if (!isAbsolute(rootInput) || rootInput.includes("\0")) invalid("Vault root must be absolute.");
  const root = resolve(rootInput);
  const indexPath = textAtom(snapshot.indexPath, "Catalog path");
  if (!isAbsolute(indexPath) || indexPath.includes("\0")) invalid("Catalog path must be absolute.");
  const catalogPath = markdownPath(relative(root, resolve(indexPath)).split(sep).join("/"), "Catalog path");
  const catalogNoteId = catalogPath.slice(0, -3);
  if (!Array.isArray(snapshot.notes)) invalid("Vault notes must be an array.");
  if (snapshot.notes.length > GRAPH_LIMITS.notes) {
    budget(`Graph exceeds the ${GRAPH_LIMITS.notes} note limit.`);
  }

  let sourceBytes = 0;
  const paths = new Set<string>();
  // Bound all source bytes and identities before parsing or materializing facts.
  const sources = snapshot.notes.map((value: unknown) => {
    if (value === null || typeof value !== "object") invalid("Every vault note must be an object.");
    const candidate = value as Record<string, unknown>;
    const path = markdownPath(candidate.path, "Note path");
    if (candidate.id !== path.slice(0, -3)) invalid(`Note ID must match its canonical path: ${path}.`);
    if (paths.has(path)) invalid(`Duplicate note path: ${path}.`);
    paths.add(path);
    if (typeof candidate.content !== "string") invalid(`Note content must be a string: ${path}.`);
    sourceBytes += Buffer.byteLength(candidate.content, "utf8");
    if (sourceBytes > GRAPH_LIMITS.sourceBytes) {
      budget(`Graph sources exceed the ${GRAPH_LIMITS.sourceBytes} byte limit.`);
    }
    return { path, content: candidate.content };
  }).toSorted((left, right) => compareText(left.path, right.path));

  const documentIds = new Set<string>();
  const noteIds = new Set<string>();
  let connectionObservations = 0;
  const checked: CheckedSource[] = sources.map(({ path, content }) => {
    let note: Note;
    try {
      note = parseNote(path, content);
    } catch {
      invalid(`Cannot parse authored Markdown: ${path}.`);
    }
    if (noteIds.has(note.id)) invalid(`Duplicate note ID: ${note.id}.`);
    noteIds.add(note.id);
    textAtom(note.title, `Title in ${path}`);
    textAtom(note.properties.type ?? "", `Type in ${path}`);
    for (const tag of note.tags) textAtom(tag, `Tag in ${path}`);
    const identity = documentIdState(note.metadata);
    if (identity.kind === "invalid") invalid(`Invalid document_id in ${path}.`);
    const documentId = identity.kind === "valid" ? identity.documentId : null;
    if (documentId !== null) {
      if (documentIds.has(documentId)) invalid(`Duplicate document_id: ${documentId}.`);
      documentIds.add(documentId);
    }
    const scopes = analyzeAuthoredRepositoryScopes(note.metadata);
    if (!scopes.valid) invalid(`Invalid repository_scopes in ${path}.`);
    for (const scope of scopes.scopes) textAtom(scope, `Repository scope in ${path}`);
    connectionObservations += note.links.length
      + (note.relationDeclarations?.length ?? 0) + (note.relationIssues?.length ?? 0);
    if (connectionObservations > GRAPH_LIMITS.facts) {
      budget(`Graph connections exceed the ${GRAPH_LIMITS.facts} observation limit.`);
    }
    return { note, documentId, scopes: scopes.scopes };
  });

  let analysis: ReturnType<typeof analyzeVault>;
  try {
    analysis = analyzeVault(checked.map(({ note }) => note), {
      catalogNoteId,
      mentionScope: () => false,
      maxNotes: GRAPH_LIMITS.notes,
      maxConnectionObservations: GRAPH_LIMITS.facts,
    });
  } catch (error) {
    if (error instanceof VaultAnalysisBudgetError) budget(error.message);
    throw error;
  }

  const included = new Set(analysis.noteConnections.map(({ id }) => id));
  const factGroups = new Map<string, Map<string, GraphFact>>();
  let factCount = 0;
  const add = (source: string, relation: GraphFactRelation, tuple: readonly GraphAtom[]): void => {
    if (!included.has(source)) invalid(`Graph fact has no authored source: ${source}.`);
    for (const atom of tuple) {
      if (typeof atom === "string") textAtom(atom, relation);
      else if (typeof atom === "number" && (!Number.isSafeInteger(atom) || atom < 1)) {
        invalid(`Graph source lines must be positive safe integers: ${source}.`);
      }
    }
    const key = canonicalJson({ relation, tuple });
    const group = factGroups.get(source) ?? new Map<string, GraphFact>();
    if (group.has(key)) return;
    if (factCount >= GRAPH_LIMITS.facts) budget(`Graph exceeds the ${GRAPH_LIMITS.facts} fact limit.`);
    factCount += 1;
    group.set(key, Object.freeze({ relation, tuple: Object.freeze([...tuple]) }));
    factGroups.set(source, group);
  };
  for (const { note, scopes } of checked) {
    if (!included.has(note.id)) continue;
    const type = note.properties.type ?? "";
    add(note.id, "wordcell.note", [note.id, note.path, note.title, type]);
    if (type.normalize("NFC").toLocaleLowerCase("en-US") === "concept") {
      add(note.id, "wordcell.concept", [note.id]);
    }
    for (const tag of note.tags) add(note.id, "wordcell.tag", [note.id, tag]);
    for (const scope of scopes) add(note.id, "wordcell.scope", [note.id, scope]);
  }
  for (const link of analysis.contextualLinks) {
    const source = link.source.slice(0, -3);
    add(source, "wordcell.link", [source, link.target.slice(0, -3), link.line]);
  }
  for (const relation of analysis.authoredRelations) {
    add(relation.source, "wordcell.relation", [
      relation.source, relation.target, relation.predicate, relation.provenance.line,
    ]);
  }
  for (const relation of analysis.externalAuthoredRelations) {
    add(relation.source, "wordcell.external-relation", [
      relation.source, relation.target, relation.predicate, relation.provenance.line,
    ]);
  }

  const sourceDigests = Object.freeze(sources.map(({ path, content }) =>
    Object.freeze({ path, contentSha256: sha256(content) })));
  const digests = new Map(sourceDigests.map(({ path, contentSha256 }) => [path, contentSha256]));
  const records: readonly GraphSourceRecord[] = Object.freeze(checked
    .filter(({ note }) => included.has(note.id))
    .map(({ note, documentId }): GraphSourceRecord => Object.freeze({
      key: `edition:note/${sha256(documentId === null ? `path:${note.id}` : `document:${documentId}`)}`,
      id: note.id,
      path: note.path,
      documentId,
      contentSha256: digests.get(note.path)!,
      facts: Object.freeze([...(factGroups.get(note.id)?.entries() ?? [])]
        .toSorted(([left], [right]) => compareText(left, right)).map(([, fact]) => fact)),
    }))
    .toSorted((left, right) => compareText(left.key, right.key)));
  const identity = Object.freeze({ schemaVersion: 1 as const, vaultIdentity: sha256(root),
    catalogNoteId, sourceDigests, records });
  return Object.freeze({ ...identity, revision: sha256(canonicalJson(identity)), factCount });
}
