import { Database } from "bun:sqlite";
import { isProxy } from "node:util/types";
import { canonicalJson, canonicalSha256, type KnowledgeGraphChangeV1, type KnowledgeGraphRecordV1 } from "@hraness/oh";
import {
  createOhProjectionDatasetV1, createOhProjectionFactV1, createOhProjectionSnapshotV1,
  evaluateOhProjectionV1, parseOhProjectionResultV1, type OhProjectionProofV1,
} from "@hraness/oh/projection";
import { createOhSqliteStoreAuthorityV1 } from "@hraness/oh/sqlite";
import { createOhStoreProfileV1, OH_WORKING_STORE_PROFILE_V1, type OhStoreV1 } from "@hraness/oh/store";
import {
  GRAPH_LIMITS, GraphAuthorityError, type GraphAuthority, type GraphProof,
  type GraphQueryLimits, type GraphQueryRequest, type GraphQueryResult, type GraphSnapshot,
} from "../graph-authority-model";
import { compileGraphProgram, normalizeGraphQueryRequest } from "./programs";
import { GRAPH_EXTRACTOR_SHA256, GRAPH_MANIFEST_KEY, manifestGraphRecord, parseGraphSnapshot, sourceGraphRecord } from "./snapshot";
import { deepFreeze, detachedData, exactKeys } from "./validation";
import { validateOhCacheSchema } from "./schema";

export type OhGraphAdapterOptions = Readonly<{
  databasePath?: string;
  databaseBytes?: Uint8Array;
  writable?: boolean;
}>;
const MAXIMUM_CACHE_OPERATIONS = 1_024;

function cacheError(error: unknown): GraphAuthorityError {
  return error instanceof GraphAuthorityError ? error : new GraphAuthorityError("corrupt-cache", "The graph cache failed Oh integrity verification; rebuild it from Markdown.");
}

/** Paths identify coordinator-owned staging files. Read-only verification accepts bytes only. */
export async function openOhGraphAdapter(input: GraphSnapshot, options: OhGraphAdapterOptions = {}): Promise<GraphAuthority> {
  const snapshot = parseGraphSnapshot(input);
  if (options === null || typeof options !== "object" || isProxy(options)
    || (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
    || Reflect.ownKeys(options).some(key => typeof key !== "string" || !Object.getOwnPropertyDescriptor(options, key)?.enumerable
      || !("value" in Object.getOwnPropertyDescriptor(options, key)!))) throw new GraphAuthorityError("invalid-input", "Graph adapter options must be plain data fields.");
  exactKeys(options as Record<string, unknown>, [], ["databasePath", "databaseBytes", "writable"]);
  if ((options.databasePath !== undefined && options.databaseBytes !== undefined)
    || (options.databasePath !== undefined && (typeof options.databasePath !== "string" || options.databasePath.length === 0 || options.writable !== true))
    || (options.databaseBytes !== undefined && (!(options.databaseBytes instanceof Uint8Array) || options.databaseBytes.byteLength < 1 || options.databaseBytes.byteLength > GRAPH_LIMITS.sourceBytes || options.writable === true))
    || (options.writable !== undefined && typeof options.writable !== "boolean")) throw new GraphAuthorityError("invalid-input", "Use writable staging paths or read-only cache bytes, never both.");
  const readonly = options.databaseBytes !== undefined;
  let records: KnowledgeGraphRecordV1[], expected: KnowledgeGraphRecordV1[];
  try {
    records = snapshot.records.map(sourceGraphRecord);
    expected = [...records, manifestGraphRecord(snapshot)].sort((a, b) => a.key < b.key ? -1 : 1);
  } catch (error) {
    if (error instanceof RangeError) throw new GraphAuthorityError("budget", "A graph source record exceeds the Oh record byte limit.");
    throw new GraphAuthorityError("invalid-input", "Graph source records are not valid Oh records.");
  }
  const profile = createOhStoreProfileV1({
    applicationProfileSha256: canonicalSha256({ vaultIdentity: snapshot.vaultIdentity, extractorSha256: GRAPH_EXTRACTOR_SHA256 }),
    capabilities: OH_WORKING_STORE_PROFILE_V1.capabilities,
    profileId: "wordcell.graph.working.v1", profileKind: "working", v: 1,
  });
  const spaceId = "wordcell.graph";
  let database: Database | undefined;
  let store: OhStoreV1 | undefined;
  let closed = false;
  try {
    database = readonly
      ? Database.deserialize(new Uint8Array(options.databaseBytes!), { strict: true })
      : new Database(options.databasePath ?? ":memory:", { create: true, strict: true });
    database.exec("PRAGMA trusted_schema = OFF");
    const hasSchema = validateOhCacheSchema(database);
    if (hasSchema) {
      const spaces = database.query<{ space_id: string }, []>("SELECT space_id FROM oh_spaces LIMIT 2").all();
      const bindings = database.query<{ binding_json: string }, []>("SELECT binding_json FROM oh_space_bindings LIMIT 2").all();
      if (spaces.length !== 1 || spaces[0]?.space_id !== spaceId || bindings.length !== 1) throw new GraphAuthorityError("corrupt-cache", "Graph cache does not contain one bound Wordcell space.");
      const binding = JSON.parse(bindings[0]!.binding_json) as { profile?: { profileSha256?: unknown } };
      if (binding.profile?.profileSha256 !== profile.profileSha256) throw new GraphAuthorityError("stale", "Graph cache belongs to a different vault or extractor profile.");
      const count = database.query<{ count: number }, []>(`SELECT count(*) AS count FROM (SELECT 1 FROM oh_operations LIMIT ${MAXIMUM_CACHE_OPERATIONS + 1})`).get()?.count;
      if (!Number.isSafeInteger(count) || count! > MAXIMUM_CACHE_OPERATIONS) throw new GraphAuthorityError("budget", "Graph cache history exceeds its replay bound; run graph rebuild --fresh.");
    } else if (readonly) throw new GraphAuthorityError("corrupt-cache", "Graph cache has no Oh authority schema.");
    database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000");
    store = createOhSqliteStoreAuthorityV1({ database, profile, realmId: `wordcell:${snapshot.vaultIdentity}`, spaceId }).store;
    await store.verify();
    const current = await store.snapshot({ maximumRecords: GRAPH_LIMITS.notes + 1 });
    if (canonicalJson(current.records) !== canonicalJson(expected)) {
      if (readonly) throw new GraphAuthorityError("stale", "Graph cache does not match the current Markdown snapshot.");
      if (current.head.sequence >= MAXIMUM_CACHE_OPERATIONS) throw new GraphAuthorityError("budget", "Graph cache history is full; run graph rebuild --fresh.");
      if (current.records.some(record => record.key !== GRAPH_MANIFEST_KEY && !/^edition:note\/[0-9a-f]{64}$/u.test(record.key))) throw new GraphAuthorityError("corrupt-cache", "Graph cache contains foreign records.");
      const prior = new Map(current.records.map(record => [record.key, record]));
      const next = new Map(expected.map(record => [record.key, record]));
      const changes: KnowledgeGraphChangeV1[] = [];
      for (const record of expected) if (prior.get(record.key)?.recordSha256 !== record.recordSha256) changes.push({ kind: "put", record, v: 1 });
      for (const record of current.records) if (!next.has(record.key)) changes.push({ kind: "tombstone", key: record.key, priorSha256: record.recordSha256, v: 1 });
      await store.commit({ actorId: "wordcell.graph", changes, expectedHead: current.head,
        // Disposable projections use a fixed logical genesis instant, never wall-clock evidence.
        // Persisted authorities retain real timestamps and their distinct operation history.
        ...(options.databasePath === undefined ? { instant: "1970-01-01T00:00:00.000Z" } : {}),
        operationId: `graph:${snapshot.revision}:${current.head.sequence}`, maximumOperationBytes: GRAPH_LIMITS.sourceBytes });
    }
    const selectedStore = store;
    const materialized = await selectedStore.snapshot({ maximumRecords: GRAPH_LIMITS.notes + 1 });
    if (canonicalJson(materialized.records) !== canonicalJson(expected)) throw new GraphAuthorityError("corrupt-cache", "Graph reconciliation did not retain exact source records.");
    const projectionSnapshot = createOhProjectionSnapshotV1({ ...materialized, spaceId });
    const recordMap = new Map(records.map((record, index) => [record.key, { record, source: snapshot.records[index]! }]));
    const assertOpen = () => { if (closed) throw new GraphAuthorityError("closed", "The graph authority is closed."); };
    const assertCurrent = async () => {
      assertOpen();
      if (canonicalJson(await selectedStore.head()) !== canonicalJson(materialized.head)) throw new GraphAuthorityError("stale", "Graph authority head changed after opening.");
    };
    function mapProof(proof: OhProjectionProofV1, budget: { remaining: number }): GraphProof {
      const reserve = (value: unknown) => {
        budget.remaining -= Buffer.byteLength(canonicalJson(value)) + 16;
        if (budget.remaining < 0) throw new GraphAuthorityError("budget", "Graph proof source labels exceed the outward result byte limit.");
      };
      if (proof.kind === "truncated") {
        const result = { kind: proof.kind, relation: proof.relation, tuple: proof.tuple, reason: proof.reason };
        reserve(result); return result;
      }
      if (proof.kind === "derived") {
        const result = { kind: proof.kind, relation: proof.relation, tuple: proof.tuple,
          ruleId: proof.ruleId, ruleSha256: proof.ruleSha256, premisesTruncated: proof.premisesTruncated };
        reserve(result);
        return { ...result, premises: proof.premises.map(premise => mapProof(premise, budget)) };
      }
      const result = { kind: "fact" as const, relation: proof.relation, tuple: proof.tuple, sources: proof.sources.map(reference => {
        const bound = recordMap.get(reference.key);
        if (bound === undefined || bound.record.recordSha256 !== reference.recordSha256) throw new GraphAuthorityError("corrupt-cache", "Projection proof contains an unbound source record.");
        return { key: reference.key, recordSha256: reference.recordSha256, noteId: bound.source.id,
          path: bound.source.path, contentSha256: bound.source.contentSha256 };
      }) };
      reserve(result); return result;
    }
    async function query(value: GraphQueryRequest): Promise<GraphQueryResult> {
      assertOpen();
      const request = normalizeGraphQueryRequest(value);
      await assertCurrent();
      const limits = request.limits as Required<GraphQueryLimits>;
      const program = compileGraphProgram(request);
      const facts = snapshot.records.flatMap((source, index) => {
        const record = records[index]!;
        const sources = [{ key: record.key, recordSha256: record.recordSha256, v: 1 as const }];
        const items = source.facts.map(fact => createOhProjectionFactV1({ ...fact, sources }));
        if (request.program !== "scope-route" && source.id === request.note) items.push(createOhProjectionFactV1({ relation: "wordcell.selected", tuple: [source.id], sources }));
        if ((request.program === "shared-tags" || request.program === "shared-concepts") && source.id !== request.note) items.push(createOhProjectionFactV1({ relation: "wordcell.peer", tuple: [source.id], sources }));
        if (request.program === "shared-concepts" && !source.facts.some(fact => fact.relation === "wordcell.concept")) items.push(createOhProjectionFactV1({ relation: "wordcell.ordinary", tuple: [source.id], sources }));
        return items;
      });
      try {
        const dataset = createOhProjectionDatasetV1({ extractorSha256: GRAPH_EXTRACTOR_SHA256, factPackId: "wordcell.graph-facts", factPackRevision: 1, facts, snapshot: projectionSnapshot });
        const result = evaluateOhProjectionV1({ ...program, dataset, snapshot: projectionSnapshot, options: {
          maximumDerivedTuples: limits.derivedTuples, maximumRounds: limits.rounds, maximumWorkUnits: limits.workUnits,
          maximumProofDepth: limits.proofDepth, maximumProofNodes: limits.proofNodes, maximumTotalProofNodes: limits.totalProofNodes, maximumResultBytes: limits.resultBytes,
        } });
        if (parseOhProjectionResultV1(result, result.identity.projectionSha256) === null) throw new GraphAuthorityError("corrupt-cache", "Oh returned an invalid bounded projection result.");
        await assertCurrent();
        const proofBudget = { remaining: limits.resultBytes };
        const output: GraphQueryResult = { schemaVersion: 1, authority: "derived", vaultIdentity: snapshot.vaultIdentity,
          revision: snapshot.revision, projectionSha256: result.identity.projectionSha256,
          request, columns: program.columns, rows: result.rows.map(row => ({ values: row.values,
            proofs: row.proofs.map(proof => mapProof(proof, proofBudget)), proofsTruncated: row.proofsTruncated, supportCount: row.supportCount })),
          limits, truncated: result.stats.truncated, proofsTruncated: result.stats.proofsTruncated,
          truncationReasons: result.stats.truncationReasons, stats: { baseFacts: result.stats.baseFacts,
            derivedFacts: result.stats.derivedFacts, workUnits: result.stats.workUnits, rounds: result.stats.rounds,
            proofNodes: result.stats.proofNodes, queryMatches: result.stats.queryMatches } };
        if (Buffer.byteLength(canonicalJson(output)) > limits.resultBytes) throw new GraphAuthorityError("budget", "Graph result with source labels exceeds the outward result byte limit.");
        return deepFreeze(output);
      } catch (error) {
        if (error instanceof GraphAuthorityError) throw error;
        if (error instanceof RangeError) throw new GraphAuthorityError("budget", error.message);
        throw error;
      }
    }
    return Object.freeze({
      query,
      verifyResult: async (value: unknown) => {
        assertOpen();
        try {
          const result = detachedData(value, GRAPH_LIMITS.resultBytes * 4) as GraphQueryResult;
          if (result === null || typeof result !== "object" || Array.isArray(result)
            || result.vaultIdentity !== snapshot.vaultIdentity || result.revision !== snapshot.revision) return false;
          const verified = await query(result.request);
          return canonicalJson(result) === canonicalJson(verified);
        } catch { return false; }
      },
      verify: async () => {
        await assertCurrent();
        await selectedStore.verify();
        const actual = await selectedStore.snapshot({ maximumRecords: GRAPH_LIMITS.notes + 1 });
        if (canonicalJson(actual.records) !== canonicalJson(expected)) throw new GraphAuthorityError("corrupt-cache", "Graph cache differs from its exact snapshot.");
        return deepFreeze({ schemaVersion: 1 as const, status: "verified" as const, vaultIdentity: snapshot.vaultIdentity,
          revision: snapshot.revision, records: snapshot.records.length, facts: snapshot.factCount });
      },
      close: async () => { if (!closed) { closed = true; await selectedStore.close(); } },
    });
  } catch (error) {
    try { if (store !== undefined) await store.close(); else database?.close(); } catch { /* preserve original failure */ }
    throw cacheError(error);
  }
}
