import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { canonicalJson, canonicalSha256 } from "@hraness/oh";
import fc from "fast-check";
import { GraphAuthorityError, type GraphFact, type GraphSnapshot, type GraphSourceRecord } from "../graph-authority-model";
import { openOhGraphAdapter } from "./authority";
import { normalizeGraphQueryRequest } from "./programs";

const scratch: string[] = [];
afterEach(() => { for (const path of scratch.splice(0)) rmSync(path, { recursive: true, force: true }); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function note(id: string, options: { links?: string[]; tags?: string[]; concept?: boolean; relations?: [string, string][]; scope?: string; content?: string } = {}): GraphSourceRecord {
  const path = `${id}.md`;
  const facts: GraphFact[] = [{ relation: "wordcell.note", tuple: [id, path, id, options.concept ? "concept" : ""] }];
  for (const to of options.links ?? []) facts.push({ relation: "wordcell.link", tuple: [id, to, 1] });
  for (const tag of options.tags ?? []) facts.push({ relation: "wordcell.tag", tuple: [id, tag] });
  for (const [to, predicate] of options.relations ?? []) facts.push({ relation: "wordcell.relation", tuple: [id, to, predicate, 2] });
  if (options.scope !== undefined) facts.push({ relation: "wordcell.scope", tuple: [id, options.scope] });
  if (options.concept) facts.push({ relation: "wordcell.concept", tuple: [id] });
  // Use codepoint order, matching the protocol rather than locale collation.
  facts.sort((a, b) => canonicalJson([a.relation, a.tuple]) < canonicalJson([b.relation, b.tuple]) ? -1 : 1);
  return { key: `edition:note/${hash(`path:${id}`)}`, id, path, documentId: null, contentSha256: hash(options.content ?? id), facts };
}
function snapshot(records: GraphSourceRecord[], vault = "test"): GraphSnapshot {
  records.sort((a, b) => a.key < b.key ? -1 : 1);
  const sourceDigests = records.map(({ path, contentSha256 }) => ({ path, contentSha256 })).sort((a, b) => a.path < b.path ? -1 : 1);
  const input = { schemaVersion: 1 as const, vaultIdentity: hash(vault), catalogNoteId: "index", sourceDigests, records };
  return { ...input, revision: canonicalSha256(input), factCount: records.reduce((sum, record) => sum + record.facts.length, 0) };
}
function fixture() {
  return snapshot([note("a", { links: ["b", "concept"], tags: ["x"], relations: [["b", "supports"]], scope: "src" }),
    note("b", { links: ["c", "concept"], tags: ["x"], relations: [["c", "supports"]] }),
    note("c", { links: ["a"] }), note("concept", { concept: true })]);
}

describe("Oh graph authority", () => {
  test("evaluates all named programs with exact sources and positive bounded walks", async () => {
    const authority = await openOhGraphAdapter(fixture());
    try {
      const backlinks = await authority.query({ program: "backlinks", note: "b" });
      expect(backlinks.columns).toEqual(["source", "target", "line", "kind", "predicate"]);
      expect(backlinks.rows.map(row => row.values)).toEqual([["a", "b", 1, "link", ""], ["a", "b", 2, "relation", "supports"]]);
      expect((await authority.query({ program: "scope-route", scope: "src" })).rows.map(row => row.values)).toEqual([["a", "src"]]);
      expect((await authority.query({ program: "shared-tags", note: "a" })).rows.map(row => row.values)).toEqual([["a", "b", "x"]]);
      expect((await authority.query({ program: "shared-concepts", note: "a" })).rows.map(row => row.values)).toEqual([["a", "b", "concept"]]);
      expect((await authority.query({ program: "relation-closure", note: "a", predicate: "supports", depth: 3 })).rows.map(row => row.values)).toEqual([["a", "b", 1], ["a", "c", 2]]);
      const walk = await authority.query({ program: "reachability", note: "a", depth: 3 });
      expect(walk.rows.map(row => row.values)).toContainEqual(["a", "a", 3]);
      expect(await authority.verifyResult(walk)).toBe(true);
      expect(await authority.verify()).toMatchObject({ status: "verified", records: 4 });
      expect(Object.isFrozen(walk.rows[0]?.proofs)).toBe(true);
    } finally { await authority.close(); }
  });

  test("preserves explicit result/proof truncation and fails closed on work exhaustion", async () => {
    const authority = await openOhGraphAdapter(fixture());
    try {
      const result = await authority.query({ program: "reachability", note: "a", depth: 3, limits: { rows: 1, proofNodes: 1, totalProofNodes: 1 } });
      expect(result.truncated).toBe(true);
      expect(result.proofsTruncated).toBe(true);
      expect(result.truncationReasons).toContain("query-limit");
      expect(await authority.verifyResult(result)).toBe(true);
      await expect(authority.query({ program: "reachability", note: "a", limits: { workUnits: 1 } })).rejects.toMatchObject({ code: "budget" });
    } finally { await authority.close(); }
  });

  test("shared concepts preserve either authored edge direction and exclude concept endpoints", async () => {
    const authority = await openOhGraphAdapter(snapshot([note("a"), note("b", { links: ["concept"] }),
      note("c"), note("concept", { concept: true, links: ["a"], relations: [["c", "supports"], ["other-concept", "supports"]] }),
      note("other-concept", { concept: true })]));
    try {
      const result = await authority.query({ program: "shared-concepts", note: "a" });
      expect(result.rows.map(row => row.values)).toEqual([["a", "b", "concept"], ["a", "c", "concept"]]);
      expect(canonicalJson(result.rows)).toContain('"noteId":"concept"');
      expect((await authority.query({ program: "shared-concepts", note: "other-concept" })).rows).toEqual([]);
      expect(await authority.verifyResult(result)).toBe(true);
    } finally { await authority.close(); }
  });

  test("shared support for 128 notes stays within the default work budget", async () => {
    const input = snapshot([...Array.from({ length: 128 }, (_, index) => note(`n${index}`, {
      tags: ["common"], links: ["concept"],
    })), note("concept", { concept: true })]);
    const authority = await openOhGraphAdapter(input);
    try {
      for (const program of ["shared-tags", "shared-concepts"] as const) {
        const result = await authority.query({ program, note: "n0", limits: { rows: 128 } });
        expect(result.rows).toHaveLength(127);
        expect(result.truncated).toBe(false);
        expect(result.proofsTruncated).toBe(false);
        expect(result.stats.workUnits).toBeLessThan(1_000_000);
        expect(await authority.verifyResult(result)).toBe(true);
      }
    } finally { await authority.close(); }
  });

  test("equivalent disposable authorities share logical genesis and verify exact proofs", async () => {
    const first = await openOhGraphAdapter(fixture());
    // An independent construction must not inherit ambient time in its projection identity.
    const second = await openOhGraphAdapter(fixture());
    try {
      const result = await first.query({ program: "shared-tags", note: "a" });
      expect(await second.verifyResult(result)).toBe(true);
      expect(await second.query(result.request)).toEqual(result);
      expect(await second.verifyResult({ ...result, projectionSha256: "0".repeat(64) })).toBe(false);
    } finally { await first.close(); await second.close(); }
  });

  test("reconciles atomically, skips no-op commits and verifies a byte copy without filesystem effects", async () => {
    const directory = mkdtempSync(join(tmpdir(), "wordcell-oh-")); scratch.push(directory);
    const path = join(directory, "stage.sqlite");
    const initial = fixture();
    const first = await openOhGraphAdapter(initial, { databasePath: path, writable: true });
    const original = await first.query({ program: "backlinks", note: "b" });
    await first.close();
    const firstBytes = readFileSync(path);
    const noop = await openOhGraphAdapter(initial, { databasePath: path, writable: true });
    expect((await noop.query({ program: "backlinks", note: "b" })).projectionSha256).toBe(original.projectionSha256);
    await noop.close();
    expect(readFileSync(path).equals(firstBytes)).toBe(true);
    const files = readdirSync(directory);
    const read = await openOhGraphAdapter(initial, { databaseBytes: firstBytes, writable: false });
    expect((await read.query({ program: "backlinks", note: "b" })).projectionSha256).toBe(original.projectionSha256);
    await read.close();
    expect(readFileSync(path).equals(firstBytes)).toBe(true);
    expect(readdirSync(directory)).toEqual(files);
    expect(files).toEqual(["stage.sqlite"]);
    const changed = snapshot([note("a", { links: ["b"], content: "changed" }), note("b")]);
    await expect(openOhGraphAdapter(changed, { databaseBytes: firstBytes })).rejects.toMatchObject({ code: "stale" });
    const update = await openOhGraphAdapter(changed, { databasePath: path, writable: true });
    expect(await update.verifyResult(original)).toBe(false);
    const incremental = await update.query({ program: "backlinks", note: "b" });
    const rebuilt = await openOhGraphAdapter(changed);
    const fresh = await rebuilt.query({ program: "backlinks", note: "b" });
    expect(incremental.rows).toEqual(fresh.rows);
    expect(incremental.projectionSha256).not.toBe(fresh.projectionSha256);
    await update.close(); await rebuilt.close();
  });

  test("rejects forged revisions, source tuples, references, records and profile ownership", async () => {
    const input = fixture();
    await expect(openOhGraphAdapter({ ...input, revision: "0".repeat(64) })).rejects.toMatchObject({ code: "invalid-input" });
    const broken = structuredClone(input);
    (broken.records[0]!.facts as GraphFact[]).push({ relation: "wordcell.link", tuple: ["foreign", "missing", 1] });
    await expect(openOhGraphAdapter(broken)).rejects.toBeInstanceOf(GraphAuthorityError);
    const directory = mkdtempSync(join(tmpdir(), "wordcell-oh-")); scratch.push(directory);
    const path = join(directory, "stage.sqlite");
    const writer = await openOhGraphAdapter(input, { databasePath: path, writable: true }); await writer.close();
    const foreign = snapshot([...input.records], "foreign");
    await expect(openOhGraphAdapter(foreign, { databaseBytes: readFileSync(path) })).rejects.toMatchObject({ code: "stale" });
    const database = new Database(path);
    database.run("UPDATE oh_records SET record_json = '{}' WHERE kind = 'edition'"); database.close();
    await expect(openOhGraphAdapter(input, { databaseBytes: readFileSync(path) })).rejects.toMatchObject({ code: "corrupt-cache" });
  });

  test("authenticates schema before recursive views, triggers or altered tables can run", async () => {
    const directory = mkdtempSync(join(tmpdir(), "wordcell-oh-")); scratch.push(directory);
    const path = join(directory, "stage.sqlite");
    const input = fixture();
    const writer = await openOhGraphAdapter(input, { databasePath: path, writable: true });
    await writer.close();
    const pristine = readFileSync(path);
    for (const mutation of [
      `DROP TABLE oh_operations; CREATE VIEW oh_operations AS
        WITH RECURSIVE walk(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM walk WHERE n < 1000000000)
        SELECT n FROM walk`,
      `CREATE TRIGGER foreign_write BEFORE INSERT ON oh_contracts BEGIN
        UPDATE oh_records SET record_json = '{}'; END`,
      "ALTER TABLE oh_records ADD COLUMN foreign_data TEXT",
      "CREATE VIEW foreign_read AS SELECT * FROM oh_records",
    ]) {
      const database = Database.deserialize(pristine);
      database.exec(mutation);
      const bytes = database.serialize();
      database.close();
      await expect(openOhGraphAdapter(input, { databaseBytes: bytes })).rejects.toMatchObject({
        code: "corrupt-cache", message: "Graph cache schema differs from the pinned Oh schema; rebuild it from Markdown.",
      });
    }
    const staging = new Database(path);
    staging.exec("CREATE TRIGGER foreign_write BEFORE INSERT ON oh_contracts BEGIN UPDATE oh_records SET record_json = '{}'; END");
    staging.close();
    const before = readFileSync(path);
    await expect(openOhGraphAdapter(input, { databasePath: path, writable: true })).rejects.toMatchObject({ code: "corrupt-cache" });
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  test("rejects foreign/stale/re-signed proofs, accessors, cycles, proxies and deep inputs", async () => {
    const authority = await openOhGraphAdapter(fixture());
    try {
      const result = await authority.query({ program: "backlinks", note: "b" });
      const tampered = structuredClone(result) as unknown as { rows: { values: unknown[] }[] };
      tampered.rows[0]!.values[0] = "forged";
      expect(await authority.verifyResult(tampered)).toBe(false);
      let calls = 0;
      expect(await authority.verifyResult({ get request() { calls += 1; return result.request; } })).toBe(false);
      expect(calls).toBe(0);
      const cyclic: unknown[] = []; cyclic.push(cyclic);
      expect(await authority.verifyResult(cyclic)).toBe(false);
      expect(await authority.verifyResult(new Proxy(result, { get() { throw new Error("must not read"); } }))).toBe(false);
    } finally { await authority.close(); }
    await expect(authority.query({ program: "backlinks", note: "b" })).rejects.toMatchObject({ code: "closed" });
    await authority.close();
  });

  test("validates requests without I/O and supports empty snapshots", async () => {
    expect(() => normalizeGraphQueryRequest({ program: "reachability", note: "a", depth: 9 })).toThrow(GraphAuthorityError);
    expect(() => normalizeGraphQueryRequest({ program: "backlinks", note: "a", limits: { rows: 1001 } })).toThrow(GraphAuthorityError);
    expect(() => normalizeGraphQueryRequest({ program: "backlinks", note: "a", unexpected: true })).toThrow(GraphAuthorityError);
    const empty = await openOhGraphAdapter(snapshot([]));
    expect((await empty.query({ program: "backlinks", note: "missing" })).rows).toEqual([]);
    await empty.close();
    await expect(openOhGraphAdapter(fixture(), { databasePath: "/must-not-open", writable: false })).rejects.toMatchObject({ code: "invalid-input" });
  });

  test("bounded positive walks match an independent layer-by-layer graph traversal", async () => {
    await fc.assert(fc.asyncProperty(fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 })), { maxLength: 10, selector: ([a, b]) => `${a}:${b}` }), async edges => {
      const input = snapshot(Array.from({ length: 4 }, (_, from) => note(`n${from}`, { links: edges.filter(([a]) => a === from).map(([, b]) => `n${b}`).sort() })));
      const authority = await openOhGraphAdapter(input);
      try {
        const result = await authority.query({ program: "reachability", note: "n0", depth: 3 });
        const expected: (string | number)[][] = [];
        let frontier = new Set([0]);
        for (let depth = 1; depth <= 3; depth += 1) {
          frontier = new Set(edges.filter(([from]) => frontier.has(from)).map(([, target]) => target));
          for (const target of frontier) expected.push(["n0", `n${target}`, depth]);
        }
        expected.sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : 1);
        expect(result.rows.map(row => row.values)).toEqual(expected);
        expect(await authority.verifyResult(result)).toBe(true);
      } finally { await authority.close(); }
    }), { numRuns: 25, seed: 2101 });
  });
});
