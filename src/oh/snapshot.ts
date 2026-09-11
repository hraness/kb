import { createHash } from "node:crypto";
import { canonicalJson, canonicalSha256, createKnowledgeGraphRecordV1, type JsonValue } from "@hraness/oh";
import { GRAPH_LIMITS, GraphAuthorityError, type GraphSnapshot, type GraphSourceRecord } from "../graph-authority-model";
import { isCanonicalNoteId, isCanonicalRelationPredicate } from "../graph";
import { validateRepositoryScopeSelection } from "../repository-memory";
import { detachedData, exactKeys, deepFreeze } from "./validation";

const digest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const fail = (message: string): never => { throw new GraphAuthorityError("invalid-input", message); };
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= GRAPH_LIMITS.atomBytes;
const path = (value: unknown): value is string => nonempty(value) && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some(part => part === "" || part === "." || part === "..");

export const GRAPH_EXTRACTOR_PROFILE = Object.freeze({
  schemaVersion: 1,
  id: "wordcell.graph-facts.v1",
  relations: { note: ["id", "path", "title", "type"], link: ["source", "target", "line"],
    relation: ["source", "target", "predicate", "line"], "external-relation": ["source", "uri", "predicate", "line"],
    tag: ["id", "tag"], scope: ["id", "scope"], concept: ["id"] },
  selectors: "selected is the requested note; peers are all other notes; ordinary excludes type concept; scope is an exact constant",
  semantics: "positive walks of lengths 1..depth; shared concepts connect ordinary notes to concepts through explicit links or typed relations in either direction",
});
export const GRAPH_EXTRACTOR_SHA256 = canonicalSha256(GRAPH_EXTRACTOR_PROFILE);
export const GRAPH_MANIFEST_KEY = "view:wordcell/manifest";

export function parseGraphSnapshot(input: unknown): GraphSnapshot {
  const snapshot = detachedData(input, GRAPH_LIMITS.sourceBytes) as GraphSnapshot;
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) fail("Invalid graph snapshot.");
  exactKeys(snapshot as unknown as Record<string, unknown>, ["schemaVersion", "vaultIdentity", "revision", "catalogNoteId", "sourceDigests", "records", "factCount"]);
  if (snapshot.schemaVersion !== 1 || !digest(snapshot.vaultIdentity) || !digest(snapshot.revision) || !nonempty(snapshot.catalogNoteId)
    || !Array.isArray(snapshot.records) || snapshot.records.length > GRAPH_LIMITS.notes || !Array.isArray(snapshot.sourceDigests)
    || snapshot.sourceDigests.length > GRAPH_LIMITS.notes + 1 || !Number.isSafeInteger(snapshot.factCount)
    || snapshot.factCount < 0 || snapshot.factCount > GRAPH_LIMITS.facts) fail("Invalid graph snapshot identity or bounds.");
  const sourceDigests = new Map<string, string>();
  let lastPath = "";
  for (const source of snapshot.sourceDigests) {
    if (source === null || typeof source !== "object" || Array.isArray(source)) fail("Invalid graph source digest.");
    exactKeys(source as unknown as Record<string, unknown>, ["path", "contentSha256"]);
    if (!path(source.path) || source.path <= lastPath || !digest(source.contentSha256)) fail("Graph source digests must be sorted unique paths and hashes.");
    sourceDigests.set(source.path, source.contentSha256); lastPath = source.path;
  }
  const ids = new Set<string>(), paths = new Set<string>();
  let lastKey = "", count = 0;
  for (const record of snapshot.records) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) fail("Invalid graph source record.");
    exactKeys(record as unknown as Record<string, unknown>, ["key", "id", "path", "documentId", "contentSha256", "facts"]);
    if (!nonempty(record.id) || !isCanonicalNoteId(record.id) || record.path !== `${record.id}.md` || !path(record.path) || !digest(record.contentSha256)
      || (record.documentId !== null && !nonempty(record.documentId)) || !Array.isArray(record.facts)
      || ids.has(record.id) || paths.has(record.path) || record.id === snapshot.catalogNoteId) fail("Invalid or duplicated graph source identity.");
    const identity = record.documentId === null ? `path:${record.id}` : `document:${record.documentId}`;
    const expectedKey = `edition:note/${createHash("sha256").update(identity).digest("hex")}`;
    if (record.key !== expectedKey || record.key <= lastKey || sourceDigests.get(record.path) !== record.contentSha256) fail("Graph source key, order or digest differs.");
    lastKey = record.key; ids.add(record.id); paths.add(record.path);
    let lastFact = "", noteFacts = 0;
    for (const fact of record.facts) {
      if (fact === null || typeof fact !== "object" || Array.isArray(fact)) fail("Invalid graph fact.");
      exactKeys(fact as unknown as Record<string, unknown>, ["relation", "tuple"]);
      if (!Array.isArray(fact.tuple) || fact.tuple[0] !== record.id) fail("Graph facts must belong to their source note.");
      const key = canonicalJson([fact.relation, fact.tuple]);
      if (key <= lastFact) fail("Graph facts must be sorted and unique.");
      lastFact = key;
      for (const value of fact.tuple) if (Buffer.byteLength(canonicalJson(value)) > GRAPH_LIMITS.atomBytes) fail("Graph atom exceeds its byte bound.");
      const tuple = fact.tuple;
      switch (fact.relation) {
        case "wordcell.note":
          if (tuple.length !== 4 || tuple[1] !== record.path || typeof tuple[2] !== "string" || typeof tuple[3] !== "string") fail("Invalid note fact.");
          noteFacts += 1; break;
        case "wordcell.link":
          if (tuple.length !== 3 || !nonempty(tuple[1]) || !Number.isSafeInteger(tuple[2]) || (tuple[2] as number) < 0) fail("Invalid link fact.");
          break;
        case "wordcell.relation":
        case "wordcell.external-relation":
          if (tuple.length !== 4 || !nonempty(tuple[1]) || !nonempty(tuple[2]) || !Number.isSafeInteger(tuple[3]) || (tuple[3] as number) < 0) fail("Invalid relation fact.");
          if (!isCanonicalRelationPredicate(tuple[2] as string)) fail("Invalid relation predicate.");
          if (fact.relation === "wordcell.external-relation" && !(tuple[1] as string).startsWith("kb://")) fail("Invalid external relation target.");
          break;
        case "wordcell.tag":
        case "wordcell.scope":
          if (tuple.length !== 2 || !nonempty(tuple[1])) fail("Invalid tag or scope fact.");
          if (fact.relation === "wordcell.scope") {
            try { validateRepositoryScopeSelection([tuple[1] as string]); } catch { fail("Invalid repository scope fact."); }
          }
          break;
        case "wordcell.concept":
          if (tuple.length !== 1) fail("Invalid concept fact.");
          break;
        default: fail("Unknown graph fact relation.");
      }
      count += 1;
      if (count > GRAPH_LIMITS.facts) fail("Graph fact count exceeds its limit.");
    }
    if (noteFacts !== 1) fail("Every graph record must contain exactly one note fact.");
    const type = record.facts.find(fact => fact.relation === "wordcell.note")!.tuple[3];
    if (record.facts.some(fact => fact.relation === "wordcell.concept") !== ((type as string).normalize("NFC").toLocaleLowerCase("en-US") === "concept")) fail("Concept facts must match authored note type.");
  }
  for (const record of snapshot.records) for (const fact of record.facts) {
    if ((fact.relation === "wordcell.link" || fact.relation === "wordcell.relation") && !ids.has(fact.tuple[1] as string)) fail("Internal graph fact target is absent.");
  }
  if ([...sourceDigests.keys()].some(source => !paths.has(source) && source !== `${snapshot.catalogNoteId}.md`)) fail("Graph source inventory contains an unrepresented non-catalog note.");
  if (count !== snapshot.factCount || canonicalSha256({ schemaVersion: 1, vaultIdentity: snapshot.vaultIdentity,
    catalogNoteId: snapshot.catalogNoteId, sourceDigests: snapshot.sourceDigests, records: snapshot.records }) !== snapshot.revision) fail("Graph snapshot revision or fact count differs.");
  return deepFreeze(snapshot);
}

export function sourceGraphRecord(record: GraphSourceRecord) {
  return createKnowledgeGraphRecordV1({ key: record.key, kind: "edition", dependencies: [], v: 1,
    value: JSON.parse(canonicalJson(record)) as JsonValue });
}

export function manifestGraphRecord(snapshot: GraphSnapshot) {
  return createKnowledgeGraphRecordV1({ key: GRAPH_MANIFEST_KEY, kind: "view", dependencies: [], v: 1,
    value: JSON.parse(canonicalJson({ schemaVersion: 1, vaultIdentity: snapshot.vaultIdentity, revision: snapshot.revision,
      catalogNoteId: snapshot.catalogNoteId, sourceDigests: snapshot.sourceDigests,
      records: snapshot.records.length, facts: snapshot.factCount, extractorSha256: GRAPH_EXTRACTOR_SHA256 })) as JsonValue });
}
