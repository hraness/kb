// @bun
import {
  GRAPH_LIMITS,
  GraphAuthorityError,
  validateGraphQueryRequest
} from "./index-11621h23.js";
import {
  validateRepositoryScopeSelection
} from "./index-06c9ctr6.js";
import"./index-5vwpzb5a.js";
import {
  isCanonicalNoteId,
  isCanonicalRelationPredicate
} from "./index-ekpwvbra.js";
import"./index-z1w83f81.js";

// src/oh/authority.ts
import { Database as Database2 } from "bun:sqlite";
import { isProxy as isProxy2 } from "util/types";
import { canonicalJson as canonicalJson4, canonicalSha256 as canonicalSha2562 } from "@hraness/oh";
import {
  createOhProjectionDatasetV1,
  createOhProjectionFactV1,
  createOhProjectionSnapshotV1,
  evaluateOhProjectionV1,
  parseOhProjectionResultV1
} from "@hraness/oh/projection";
import { createOhSqliteStoreAuthorityV1 } from "@hraness/oh/sqlite";
import { createOhStoreProfileV1, OH_WORKING_STORE_PROFILE_V1 } from "@hraness/oh/store";

// src/oh/programs.ts
import {
  createOhProjectionLiteralV1 as literal,
  createOhProjectionQueryV1,
  createOhProjectionRulePackV1,
  createOhProjectionRuleV1,
  ohProjectionConstantV1 as constant,
  ohProjectionVariableV1 as variable
} from "@hraness/oh/projection";

// src/oh/validation.ts
import { isProxy } from "util/types";
import { canonicalJson } from "@hraness/oh";
function detachedData(input, maximumBytes) {
  const seen = new Set;
  let nodes = 0, bytes = 0;
  function visit(value2, depth) {
    nodes += 1;
    if (nodes > 1e6 || depth > 192)
      throw new GraphAuthorityError("budget", "Graph input exceeds structural bounds.");
    if (value2 === null || typeof value2 === "boolean") {
      bytes += 5;
      return value2;
    }
    if (typeof value2 === "string") {
      bytes += Buffer.byteLength(value2) + 2;
      if (bytes > maximumBytes)
        throw new GraphAuthorityError("budget", "Graph input exceeds its byte bound.");
      return value2;
    }
    if (typeof value2 === "number" && Number.isFinite(value2)) {
      bytes += 32;
      return value2;
    }
    if (typeof value2 !== "object" || value2 === null || isProxy(value2) || seen.has(value2))
      throw new GraphAuthorityError("invalid-input", "Graph input must be acyclic plain data.");
    seen.add(value2);
    const array = Array.isArray(value2);
    if (!array && Object.getPrototypeOf(value2) !== Object.prototype && Object.getPrototypeOf(value2) !== null)
      throw new GraphAuthorityError("invalid-input", "Graph input must contain plain objects.");
    const keys = Reflect.ownKeys(value2);
    if (keys.length > 200000 || keys.some((key) => typeof key !== "string"))
      throw new GraphAuthorityError("budget", "Graph input has too many fields.");
    const output = Object.create(null);
    if (array && keys.length !== value2.length + 1)
      throw new GraphAuthorityError("invalid-input", "Graph arrays must be dense.");
    for (const key of keys) {
      if (array && key === "length")
        continue;
      if (array && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value2.length))
        throw new GraphAuthorityError("invalid-input", "Graph array has extra fields.");
      const descriptor = Object.getOwnPropertyDescriptor(value2, key);
      if (!descriptor.enumerable || !("value" in descriptor))
        throw new GraphAuthorityError("invalid-input", "Graph input accessors are forbidden.");
      bytes += Buffer.byteLength(key) + 4;
      if (bytes > maximumBytes)
        throw new GraphAuthorityError("budget", "Graph input exceeds its byte bound.");
      output[key] = visit(descriptor.value, depth + 1);
    }
    seen.delete(value2);
    return array ? Array.from({ length: value2.length }, (_, index) => output[String(index)]) : output;
  }
  const value = visit(input, 0);
  try {
    const encoded = canonicalJson(value);
    if (Buffer.byteLength(encoded) > maximumBytes)
      throw new GraphAuthorityError("budget", "Graph input exceeds its canonical byte bound.");
    return JSON.parse(encoded);
  } catch (error) {
    if (error instanceof GraphAuthorityError)
      throw error;
    throw new GraphAuthorityError("invalid-input", "Graph input is not canonical JSON data.");
  }
}
function exactKeys(value, required, optional = []) {
  const keys = Object.keys(value);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => !required.includes(key) && !optional.includes(key)))
    throw new GraphAuthorityError("invalid-input", "Graph input has missing or unexpected fields.");
}
function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value))
      deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

// src/oh/programs.ts
var DEFAULT_GRAPH_QUERY_LIMITS = Object.freeze({
  rows: 100,
  workUnits: 1e6,
  derivedTuples: 50000,
  rounds: 32,
  proofDepth: 32,
  proofNodes: 256,
  totalProofNodes: 8192,
  resultBytes: 1048576
});
function normalizeGraphQueryRequest(input) {
  const request = validateGraphQueryRequest(detachedData(input, 64 * 1024));
  const depth = request.program === "reachability" || request.program === "relation-closure" ? { depth: request.depth ?? 3 } : {};
  return Object.freeze({
    ...request,
    ...depth,
    limits: Object.freeze({ ...DEFAULT_GRAPH_QUERY_LIMITS, ...request.limits })
  });
}
var atom = (relation, ...terms) => literal({ relation, terms });
function compileGraphProgram(request) {
  const rules = [];
  const add = (ruleId, head, ...body) => {
    rules.push(createOhProjectionRuleV1({ ruleId: `wordcell.${ruleId}`, head, body }));
  };
  const a = variable("source"), b = variable("target"), line = variable("line"), predicate = variable("predicate");
  let columns;
  let where;
  switch (request.program) {
    case "backlinks": {
      add("backlink.link", atom("wordcell.answer", a, b, line, constant("link"), constant("")), atom("wordcell.link", a, b, line));
      add("backlink.relation", atom("wordcell.answer", a, b, line, constant("relation"), predicate), atom("wordcell.relation", a, b, predicate, line));
      columns = ["source", "target", "line", "kind", "predicate"];
      where = [atom("wordcell.answer", a, b, line, variable("kind"), predicate), atom("wordcell.selected", b)];
      break;
    }
    case "reachability":
    case "relation-closure": {
      const relation = request.program === "relation-closure";
      const edge = "wordcell.edge";
      if (relation)
        add("edge.relation", atom(edge, a, b), atom("wordcell.relation", a, b, constant(request.predicate), line));
      else {
        add("edge.link", atom(edge, a, b), atom("wordcell.link", a, b, line));
        add("edge.relation", atom(edge, a, b), atom("wordcell.relation", a, b, predicate, line));
      }
      const source = constant(request.note);
      add("walk.1", atom("wordcell.walk.1", b), atom(edge, source, b));
      for (let depth = 1;depth <= (request.depth ?? 3); depth += 1) {
        if (depth > 1)
          add(`walk.${depth}`, atom(`wordcell.walk.${depth}`, b), atom(`wordcell.walk.${depth - 1}`, a), atom(edge, a, b));
        add(`walk.answer.${depth}`, atom("wordcell.answer", source, b, constant(depth)), atom(`wordcell.walk.${depth}`, b));
      }
      columns = ["source", "target", "depth"];
      where = [atom("wordcell.answer", a, b, variable("depth"))];
      break;
    }
    case "scope-route": {
      add("scope", atom("wordcell.answer", a, constant(request.scope)), atom("wordcell.scope", a, constant(request.scope)));
      columns = ["note", "scope"];
      where = [atom("wordcell.answer", variable("note"), variable("scope"))];
      break;
    }
    case "shared-tags": {
      const note = variable("note"), other = variable("other"), tag = variable("tag");
      add("shared.tags", atom("wordcell.answer", note, other, tag), atom("wordcell.selected", note), atom("wordcell.tag", note, tag), atom("wordcell.tag", other, tag), atom("wordcell.peer", other));
      columns = ["note", "other", "tag"];
      where = [atom("wordcell.answer", note, other, tag)];
      break;
    }
    case "shared-concepts": {
      const note = variable("note"), other = variable("other"), concept = variable("concept");
      add("concept.link", atom("wordcell.concept-edge", a, b), atom("wordcell.link", a, b, line), atom("wordcell.concept", b));
      add("concept.relation", atom("wordcell.concept-edge", a, b), atom("wordcell.relation", a, b, predicate, line), atom("wordcell.concept", b));
      add("concept.reverse-link", atom("wordcell.concept-edge", a, b), atom("wordcell.link", b, a, line), atom("wordcell.concept", b));
      add("concept.reverse-relation", atom("wordcell.concept-edge", a, b), atom("wordcell.relation", b, a, predicate, line), atom("wordcell.concept", b));
      add("shared.concepts", atom("wordcell.answer", note, other, concept), atom("wordcell.selected", note), atom("wordcell.ordinary", note), atom("wordcell.concept-edge", note, concept), atom("wordcell.concept-edge", other, concept), atom("wordcell.peer", other), atom("wordcell.ordinary", other));
      columns = ["note", "other", "concept"];
      where = [atom("wordcell.answer", note, other, concept)];
      break;
    }
  }
  return {
    columns,
    query: createOhProjectionQueryV1({ queryId: `wordcell.${request.program}`, find: columns, where, limit: request.limits?.rows ?? DEFAULT_GRAPH_QUERY_LIMITS.rows }),
    rulePack: createOhProjectionRulePackV1({ rulePackId: `wordcell.${request.program}`, rulePackRevision: 1, rules })
  };
}

// src/oh/snapshot.ts
import { createHash } from "crypto";
import { canonicalJson as canonicalJson2, canonicalSha256, createKnowledgeGraphRecordV1 } from "@hraness/oh";
var digest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
var fail = (message) => {
  throw new GraphAuthorityError("invalid-input", message);
};
var nonempty = (value) => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= GRAPH_LIMITS.atomBytes;
var path = (value) => nonempty(value) && !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === "" || part === "." || part === "..");
var GRAPH_EXTRACTOR_PROFILE = Object.freeze({
  schemaVersion: 1,
  id: "wordcell.graph-facts.v1",
  relations: {
    note: ["id", "path", "title", "type"],
    link: ["source", "target", "line"],
    relation: ["source", "target", "predicate", "line"],
    "external-relation": ["source", "uri", "predicate", "line"],
    tag: ["id", "tag"],
    scope: ["id", "scope"],
    concept: ["id"]
  },
  selectors: "selected is the requested note; peers are all other notes; ordinary excludes type concept; scope is an exact constant",
  semantics: "positive walks of lengths 1..depth; shared concepts connect ordinary notes to concepts through explicit links or typed relations in either direction"
});
var GRAPH_EXTRACTOR_SHA256 = canonicalSha256(GRAPH_EXTRACTOR_PROFILE);
var GRAPH_MANIFEST_KEY = "view:wordcell/manifest";
function parseGraphSnapshot(input) {
  const snapshot = detachedData(input, GRAPH_LIMITS.sourceBytes);
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot))
    fail("Invalid graph snapshot.");
  exactKeys(snapshot, ["schemaVersion", "vaultIdentity", "revision", "catalogNoteId", "sourceDigests", "records", "factCount"]);
  if (snapshot.schemaVersion !== 1 || !digest(snapshot.vaultIdentity) || !digest(snapshot.revision) || !nonempty(snapshot.catalogNoteId) || !Array.isArray(snapshot.records) || snapshot.records.length > GRAPH_LIMITS.notes || !Array.isArray(snapshot.sourceDigests) || snapshot.sourceDigests.length > GRAPH_LIMITS.notes + 1 || !Number.isSafeInteger(snapshot.factCount) || snapshot.factCount < 0 || snapshot.factCount > GRAPH_LIMITS.facts)
    fail("Invalid graph snapshot identity or bounds.");
  const sourceDigests = new Map;
  let lastPath = "";
  for (const source of snapshot.sourceDigests) {
    if (source === null || typeof source !== "object" || Array.isArray(source))
      fail("Invalid graph source digest.");
    exactKeys(source, ["path", "contentSha256"]);
    if (!path(source.path) || source.path <= lastPath || !digest(source.contentSha256))
      fail("Graph source digests must be sorted unique paths and hashes.");
    sourceDigests.set(source.path, source.contentSha256);
    lastPath = source.path;
  }
  const ids = new Set, paths = new Set;
  let lastKey = "", count = 0;
  for (const record of snapshot.records) {
    if (record === null || typeof record !== "object" || Array.isArray(record))
      fail("Invalid graph source record.");
    exactKeys(record, ["key", "id", "path", "documentId", "contentSha256", "facts"]);
    if (!nonempty(record.id) || !isCanonicalNoteId(record.id) || record.path !== `${record.id}.md` || !path(record.path) || !digest(record.contentSha256) || record.documentId !== null && !nonempty(record.documentId) || !Array.isArray(record.facts) || ids.has(record.id) || paths.has(record.path) || record.id === snapshot.catalogNoteId)
      fail("Invalid or duplicated graph source identity.");
    const identity = record.documentId === null ? `path:${record.id}` : `document:${record.documentId}`;
    const expectedKey = `edition:note/${createHash("sha256").update(identity).digest("hex")}`;
    if (record.key !== expectedKey || record.key <= lastKey || sourceDigests.get(record.path) !== record.contentSha256)
      fail("Graph source key, order or digest differs.");
    lastKey = record.key;
    ids.add(record.id);
    paths.add(record.path);
    let lastFact = "", noteFacts = 0;
    for (const fact of record.facts) {
      if (fact === null || typeof fact !== "object" || Array.isArray(fact))
        fail("Invalid graph fact.");
      exactKeys(fact, ["relation", "tuple"]);
      if (!Array.isArray(fact.tuple) || fact.tuple[0] !== record.id)
        fail("Graph facts must belong to their source note.");
      const key = canonicalJson2([fact.relation, fact.tuple]);
      if (key <= lastFact)
        fail("Graph facts must be sorted and unique.");
      lastFact = key;
      for (const value of fact.tuple)
        if (Buffer.byteLength(canonicalJson2(value)) > GRAPH_LIMITS.atomBytes)
          fail("Graph atom exceeds its byte bound.");
      const tuple = fact.tuple;
      switch (fact.relation) {
        case "wordcell.note":
          if (tuple.length !== 4 || tuple[1] !== record.path || typeof tuple[2] !== "string" || typeof tuple[3] !== "string")
            fail("Invalid note fact.");
          noteFacts += 1;
          break;
        case "wordcell.link":
          if (tuple.length !== 3 || !nonempty(tuple[1]) || !Number.isSafeInteger(tuple[2]) || tuple[2] < 0)
            fail("Invalid link fact.");
          break;
        case "wordcell.relation":
        case "wordcell.external-relation":
          if (tuple.length !== 4 || !nonempty(tuple[1]) || !nonempty(tuple[2]) || !Number.isSafeInteger(tuple[3]) || tuple[3] < 0)
            fail("Invalid relation fact.");
          if (!isCanonicalRelationPredicate(tuple[2]))
            fail("Invalid relation predicate.");
          if (fact.relation === "wordcell.external-relation" && !tuple[1].startsWith("kb://"))
            fail("Invalid external relation target.");
          break;
        case "wordcell.tag":
        case "wordcell.scope":
          if (tuple.length !== 2 || !nonempty(tuple[1]))
            fail("Invalid tag or scope fact.");
          if (fact.relation === "wordcell.scope") {
            try {
              validateRepositoryScopeSelection([tuple[1]]);
            } catch {
              fail("Invalid repository scope fact.");
            }
          }
          break;
        case "wordcell.concept":
          if (tuple.length !== 1)
            fail("Invalid concept fact.");
          break;
        default:
          fail("Unknown graph fact relation.");
      }
      count += 1;
      if (count > GRAPH_LIMITS.facts)
        fail("Graph fact count exceeds its limit.");
    }
    if (noteFacts !== 1)
      fail("Every graph record must contain exactly one note fact.");
    const type = record.facts.find((fact) => fact.relation === "wordcell.note").tuple[3];
    if (record.facts.some((fact) => fact.relation === "wordcell.concept") !== (type.normalize("NFC").toLocaleLowerCase("en-US") === "concept"))
      fail("Concept facts must match authored note type.");
  }
  for (const record of snapshot.records)
    for (const fact of record.facts) {
      if ((fact.relation === "wordcell.link" || fact.relation === "wordcell.relation") && !ids.has(fact.tuple[1]))
        fail("Internal graph fact target is absent.");
    }
  if ([...sourceDigests.keys()].some((source) => !paths.has(source) && source !== `${snapshot.catalogNoteId}.md`))
    fail("Graph source inventory contains an unrepresented non-catalog note.");
  if (count !== snapshot.factCount || canonicalSha256({
    schemaVersion: 1,
    vaultIdentity: snapshot.vaultIdentity,
    catalogNoteId: snapshot.catalogNoteId,
    sourceDigests: snapshot.sourceDigests,
    records: snapshot.records
  }) !== snapshot.revision)
    fail("Graph snapshot revision or fact count differs.");
  return deepFreeze(snapshot);
}
function sourceGraphRecord(record) {
  return createKnowledgeGraphRecordV1({
    key: record.key,
    kind: "edition",
    dependencies: [],
    v: 1,
    value: JSON.parse(canonicalJson2(record))
  });
}
function manifestGraphRecord(snapshot) {
  return createKnowledgeGraphRecordV1({
    key: GRAPH_MANIFEST_KEY,
    kind: "view",
    dependencies: [],
    v: 1,
    value: JSON.parse(canonicalJson2({
      schemaVersion: 1,
      vaultIdentity: snapshot.vaultIdentity,
      revision: snapshot.revision,
      catalogNoteId: snapshot.catalogNoteId,
      sourceDigests: snapshot.sourceDigests,
      records: snapshot.records.length,
      facts: snapshot.factCount,
      extractorSha256: GRAPH_EXTRACTOR_SHA256
    }))
  });
}

// src/oh/schema.ts
import { Database } from "bun:sqlite";
import { canonicalJson as canonicalJson3 } from "@hraness/oh";
import { applyOhSqliteMigrations } from "@hraness/oh/sqlite";
var MAXIMUM_SCHEMA_ENTRIES = 256;
var MAXIMUM_SCHEMA_SQL_LENGTH = 16384;
var expectedSchema;
function schemaEntries(database) {
  const entries = database.query(`SELECT type,
    substr(name, 1, 257) AS name, length(name) AS nameLength,
    substr(tbl_name, 1, 257) AS tbl_name, length(tbl_name) AS tableNameLength,
    substr(sql, 1, ${MAXIMUM_SCHEMA_SQL_LENGTH + 1}) AS sql, length(sql) AS sqlLength
    FROM main.sqlite_schema LIMIT ${MAXIMUM_SCHEMA_ENTRIES + 1}`).all();
  if (entries.length > MAXIMUM_SCHEMA_ENTRIES || entries.some((entry) => entry.nameLength > 256 || entry.tableNameLength > 256 || (entry.sqlLength ?? 0) > MAXIMUM_SCHEMA_SQL_LENGTH)) {
    throw new GraphAuthorityError("corrupt-cache", "Graph cache schema exceeds its metadata bounds.");
  }
  return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.type < b.type ? -1 : 1);
}
function validateOhCacheSchema(database) {
  const entries = schemaEntries(database);
  if (entries.length === 0)
    return false;
  if (expectedSchema === undefined) {
    const trusted = new Database(":memory:", { strict: true });
    try {
      applyOhSqliteMigrations(trusted);
      expectedSchema = canonicalJson3(schemaEntries(trusted));
    } finally {
      trusted.close();
    }
  }
  if (canonicalJson3(entries) !== expectedSchema)
    throw new GraphAuthorityError("corrupt-cache", "Graph cache schema differs from the pinned Oh schema; rebuild it from Markdown.");
  return true;
}

// src/oh/authority.ts
var MAXIMUM_CACHE_OPERATIONS = 1024;
function cacheError(error) {
  return error instanceof GraphAuthorityError ? error : new GraphAuthorityError("corrupt-cache", "The graph cache failed Oh integrity verification; rebuild it from Markdown.");
}
async function openOhGraphAdapter(input, options = {}) {
  const snapshot = parseGraphSnapshot(input);
  if (options === null || typeof options !== "object" || isProxy2(options) || Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null || Reflect.ownKeys(options).some((key) => typeof key !== "string" || !Object.getOwnPropertyDescriptor(options, key)?.enumerable || !("value" in Object.getOwnPropertyDescriptor(options, key))))
    throw new GraphAuthorityError("invalid-input", "Graph adapter options must be plain data fields.");
  exactKeys(options, [], ["databasePath", "databaseBytes", "writable"]);
  if (options.databasePath !== undefined && options.databaseBytes !== undefined || options.databasePath !== undefined && (typeof options.databasePath !== "string" || options.databasePath.length === 0 || options.writable !== true) || options.databaseBytes !== undefined && (!(options.databaseBytes instanceof Uint8Array) || options.databaseBytes.byteLength < 1 || options.databaseBytes.byteLength > GRAPH_LIMITS.sourceBytes || options.writable === true) || options.writable !== undefined && typeof options.writable !== "boolean")
    throw new GraphAuthorityError("invalid-input", "Use writable staging paths or read-only cache bytes, never both.");
  const readonly = options.databaseBytes !== undefined;
  let records, expected;
  try {
    records = snapshot.records.map(sourceGraphRecord);
    expected = [...records, manifestGraphRecord(snapshot)].sort((a, b) => a.key < b.key ? -1 : 1);
  } catch (error) {
    if (error instanceof RangeError)
      throw new GraphAuthorityError("budget", "A graph source record exceeds the Oh record byte limit.");
    throw new GraphAuthorityError("invalid-input", "Graph source records are not valid Oh records.");
  }
  const profile = createOhStoreProfileV1({
    applicationProfileSha256: canonicalSha2562({ vaultIdentity: snapshot.vaultIdentity, extractorSha256: GRAPH_EXTRACTOR_SHA256 }),
    capabilities: OH_WORKING_STORE_PROFILE_V1.capabilities,
    profileId: "wordcell.graph.working.v1",
    profileKind: "working",
    v: 1
  });
  const spaceId = "wordcell.graph";
  let database;
  let store;
  let closed = false;
  try {
    let mapProof = function(proof, budget) {
      const reserve = (value) => {
        budget.remaining -= Buffer.byteLength(canonicalJson4(value)) + 16;
        if (budget.remaining < 0)
          throw new GraphAuthorityError("budget", "Graph proof source labels exceed the outward result byte limit.");
      };
      if (proof.kind === "truncated") {
        const result2 = { kind: proof.kind, relation: proof.relation, tuple: proof.tuple, reason: proof.reason };
        reserve(result2);
        return result2;
      }
      if (proof.kind === "derived") {
        const result2 = {
          kind: proof.kind,
          relation: proof.relation,
          tuple: proof.tuple,
          ruleId: proof.ruleId,
          ruleSha256: proof.ruleSha256,
          premisesTruncated: proof.premisesTruncated
        };
        reserve(result2);
        return { ...result2, premises: proof.premises.map((premise) => mapProof(premise, budget)) };
      }
      const result = { kind: "fact", relation: proof.relation, tuple: proof.tuple, sources: proof.sources.map((reference) => {
        const bound = recordMap.get(reference.key);
        if (bound === undefined || bound.record.recordSha256 !== reference.recordSha256)
          throw new GraphAuthorityError("corrupt-cache", "Projection proof contains an unbound source record.");
        return {
          key: reference.key,
          recordSha256: reference.recordSha256,
          noteId: bound.source.id,
          path: bound.source.path,
          contentSha256: bound.source.contentSha256
        };
      }) };
      reserve(result);
      return result;
    };
    database = readonly ? Database2.deserialize(new Uint8Array(options.databaseBytes), { strict: true }) : new Database2(options.databasePath ?? ":memory:", { create: true, strict: true });
    database.exec("PRAGMA trusted_schema = OFF");
    const hasSchema = validateOhCacheSchema(database);
    if (hasSchema) {
      const spaces = database.query("SELECT space_id FROM oh_spaces LIMIT 2").all();
      const bindings = database.query("SELECT binding_json FROM oh_space_bindings LIMIT 2").all();
      if (spaces.length !== 1 || spaces[0]?.space_id !== spaceId || bindings.length !== 1)
        throw new GraphAuthorityError("corrupt-cache", "Graph cache does not contain one bound Wordcell space.");
      const binding = JSON.parse(bindings[0].binding_json);
      if (binding.profile?.profileSha256 !== profile.profileSha256)
        throw new GraphAuthorityError("stale", "Graph cache belongs to a different vault or extractor profile.");
      const count = database.query(`SELECT count(*) AS count FROM (SELECT 1 FROM oh_operations LIMIT ${MAXIMUM_CACHE_OPERATIONS + 1})`).get()?.count;
      if (!Number.isSafeInteger(count) || count > MAXIMUM_CACHE_OPERATIONS)
        throw new GraphAuthorityError("budget", "Graph cache history exceeds its replay bound; run graph rebuild --fresh.");
    } else if (readonly)
      throw new GraphAuthorityError("corrupt-cache", "Graph cache has no Oh authority schema.");
    database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000");
    store = createOhSqliteStoreAuthorityV1({ database, profile, realmId: `wordcell:${snapshot.vaultIdentity}`, spaceId }).store;
    await store.verify();
    const current = await store.snapshot({ maximumRecords: GRAPH_LIMITS.notes + 1 });
    if (canonicalJson4(current.records) !== canonicalJson4(expected)) {
      if (readonly)
        throw new GraphAuthorityError("stale", "Graph cache does not match the current Markdown snapshot.");
      if (current.head.sequence >= MAXIMUM_CACHE_OPERATIONS)
        throw new GraphAuthorityError("budget", "Graph cache history is full; run graph rebuild --fresh.");
      if (current.records.some((record) => record.key !== GRAPH_MANIFEST_KEY && !/^edition:note\/[0-9a-f]{64}$/u.test(record.key)))
        throw new GraphAuthorityError("corrupt-cache", "Graph cache contains foreign records.");
      const prior = new Map(current.records.map((record) => [record.key, record]));
      const next = new Map(expected.map((record) => [record.key, record]));
      const changes = [];
      for (const record of expected)
        if (prior.get(record.key)?.recordSha256 !== record.recordSha256)
          changes.push({ kind: "put", record, v: 1 });
      for (const record of current.records)
        if (!next.has(record.key))
          changes.push({ kind: "tombstone", key: record.key, priorSha256: record.recordSha256, v: 1 });
      await store.commit({
        actorId: "wordcell.graph",
        changes,
        expectedHead: current.head,
        ...options.databasePath === undefined ? { instant: "1970-01-01T00:00:00.000Z" } : {},
        operationId: `graph:${snapshot.revision}:${current.head.sequence}`,
        maximumOperationBytes: GRAPH_LIMITS.sourceBytes
      });
    }
    const selectedStore = store;
    const materialized = await selectedStore.snapshot({ maximumRecords: GRAPH_LIMITS.notes + 1 });
    if (canonicalJson4(materialized.records) !== canonicalJson4(expected))
      throw new GraphAuthorityError("corrupt-cache", "Graph reconciliation did not retain exact source records.");
    const projectionSnapshot = createOhProjectionSnapshotV1({ ...materialized, spaceId });
    const recordMap = new Map(records.map((record, index) => [record.key, { record, source: snapshot.records[index] }]));
    const assertOpen = () => {
      if (closed)
        throw new GraphAuthorityError("closed", "The graph authority is closed.");
    };
    const assertCurrent = async () => {
      assertOpen();
      if (canonicalJson4(await selectedStore.head()) !== canonicalJson4(materialized.head))
        throw new GraphAuthorityError("stale", "Graph authority head changed after opening.");
    };
    async function query(value) {
      assertOpen();
      const request = normalizeGraphQueryRequest(value);
      await assertCurrent();
      const limits = request.limits;
      const program = compileGraphProgram(request);
      const facts = snapshot.records.flatMap((source, index) => {
        const record = records[index];
        const sources = [{ key: record.key, recordSha256: record.recordSha256, v: 1 }];
        const items = source.facts.map((fact) => createOhProjectionFactV1({ ...fact, sources }));
        if (request.program !== "scope-route" && source.id === request.note)
          items.push(createOhProjectionFactV1({ relation: "wordcell.selected", tuple: [source.id], sources }));
        if ((request.program === "shared-tags" || request.program === "shared-concepts") && source.id !== request.note)
          items.push(createOhProjectionFactV1({ relation: "wordcell.peer", tuple: [source.id], sources }));
        if (request.program === "shared-concepts" && !source.facts.some((fact) => fact.relation === "wordcell.concept"))
          items.push(createOhProjectionFactV1({ relation: "wordcell.ordinary", tuple: [source.id], sources }));
        return items;
      });
      try {
        const dataset = createOhProjectionDatasetV1({ extractorSha256: GRAPH_EXTRACTOR_SHA256, factPackId: "wordcell.graph-facts", factPackRevision: 1, facts, snapshot: projectionSnapshot });
        const result = evaluateOhProjectionV1({ ...program, dataset, snapshot: projectionSnapshot, options: {
          maximumDerivedTuples: limits.derivedTuples,
          maximumRounds: limits.rounds,
          maximumWorkUnits: limits.workUnits,
          maximumProofDepth: limits.proofDepth,
          maximumProofNodes: limits.proofNodes,
          maximumTotalProofNodes: limits.totalProofNodes,
          maximumResultBytes: limits.resultBytes
        } });
        if (parseOhProjectionResultV1(result, result.identity.projectionSha256) === null)
          throw new GraphAuthorityError("corrupt-cache", "Oh returned an invalid bounded projection result.");
        await assertCurrent();
        const proofBudget = { remaining: limits.resultBytes };
        const output = {
          schemaVersion: 1,
          authority: "derived",
          vaultIdentity: snapshot.vaultIdentity,
          revision: snapshot.revision,
          projectionSha256: result.identity.projectionSha256,
          request,
          columns: program.columns,
          rows: result.rows.map((row) => ({
            values: row.values,
            proofs: row.proofs.map((proof) => mapProof(proof, proofBudget)),
            proofsTruncated: row.proofsTruncated,
            supportCount: row.supportCount
          })),
          limits,
          truncated: result.stats.truncated,
          proofsTruncated: result.stats.proofsTruncated,
          truncationReasons: result.stats.truncationReasons,
          stats: {
            baseFacts: result.stats.baseFacts,
            derivedFacts: result.stats.derivedFacts,
            workUnits: result.stats.workUnits,
            rounds: result.stats.rounds,
            proofNodes: result.stats.proofNodes,
            queryMatches: result.stats.queryMatches
          }
        };
        if (Buffer.byteLength(canonicalJson4(output)) > limits.resultBytes)
          throw new GraphAuthorityError("budget", "Graph result with source labels exceeds the outward result byte limit.");
        return deepFreeze(output);
      } catch (error) {
        if (error instanceof GraphAuthorityError)
          throw error;
        if (error instanceof RangeError)
          throw new GraphAuthorityError("budget", error.message);
        throw error;
      }
    }
    return Object.freeze({
      query,
      verifyResult: async (value) => {
        assertOpen();
        try {
          const result = detachedData(value, GRAPH_LIMITS.resultBytes * 4);
          if (result === null || typeof result !== "object" || Array.isArray(result) || result.vaultIdentity !== snapshot.vaultIdentity || result.revision !== snapshot.revision)
            return false;
          const verified = await query(result.request);
          return canonicalJson4(result) === canonicalJson4(verified);
        } catch {
          return false;
        }
      },
      verify: async () => {
        await assertCurrent();
        await selectedStore.verify();
        const actual = await selectedStore.snapshot({ maximumRecords: GRAPH_LIMITS.notes + 1 });
        if (canonicalJson4(actual.records) !== canonicalJson4(expected))
          throw new GraphAuthorityError("corrupt-cache", "Graph cache differs from its exact snapshot.");
        return deepFreeze({
          schemaVersion: 1,
          status: "verified",
          vaultIdentity: snapshot.vaultIdentity,
          revision: snapshot.revision,
          records: snapshot.records.length,
          facts: snapshot.factCount
        });
      },
      close: async () => {
        if (!closed) {
          closed = true;
          await selectedStore.close();
        }
      }
    });
  } catch (error) {
    try {
      if (store !== undefined)
        await store.close();
      else
        database?.close();
    } catch {}
    throw cacheError(error);
  }
}
export {
  openOhGraphAdapter
};
