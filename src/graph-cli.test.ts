import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { main, parseArguments } from "./cli-program.js";
import { analyzeVault, parseNote } from "./graph.js";
import { parseGraphCommand } from "./graph-cli.js";
import {
  GRAPH_LIMITS,
  type GraphAuthority,
  type GraphQueryRequest,
  type GraphQueryResult,
  type GraphVerification,
} from "./graph-authority-model.js";
import { validateGraphQueryRequest } from "./graph-query.js";
import type { GraphPercolationResult } from "./graph-percolation.js";
import { openKnowledgeBase } from "./sdk.js";
import type { VaultSnapshot } from "./vault.js";

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { sink: { stdout: (value: string) => { stdout.push(value); }, stderr: (value: string) => { stderr.push(value); } },
    text: () => stdout.join(""), errors: () => stderr.join("") };
}

const verification: GraphVerification = { schemaVersion: 1, status: "verified", vaultIdentity: "vault",
  revision: "a".repeat(64), records: 2, facts: 3 };

function result(request: GraphQueryRequest): GraphQueryResult {
  return { schemaVersion: 1, authority: "derived", vaultIdentity: verification.vaultIdentity,
    revision: verification.revision, projectionSha256: "b".repeat(64), request,
    columns: ["source", "target"], rows: [], truncated: false, proofsTruncated: false, truncationReasons: [],
    limits: { rows: GRAPH_LIMITS.rows, workUnits: GRAPH_LIMITS.workUnits, derivedTuples: GRAPH_LIMITS.derivedTuples,
      rounds: GRAPH_LIMITS.rounds, proofDepth: GRAPH_LIMITS.proofDepth, proofNodes: GRAPH_LIMITS.proofNodes,
      totalProofNodes: GRAPH_LIMITS.totalProofNodes, resultBytes: GRAPH_LIMITS.resultBytes },
    stats: { baseFacts: 3, derivedFacts: 0, workUnits: 1, rounds: 1, proofNodes: 0, queryMatches: 0 } };
}

function proofPercolation(): GraphPercolationResult {
  return { schemaVersion: 1, kind: "wordcell.graph-percolation", revision: verification.revision,
    suggestions: { schemaVersion: 2, candidates: [], truncated: false },
    positiveSupport: { sharedTags: result({ program: "shared-tags", note: "notes/a" }),
      sharedConcepts: result({ program: "shared-concepts", note: "notes/a" }) } };
}

function snapshot(): VaultSnapshot {
  const notes = [parseNote("notes/a.md", "# Alpha\n\n[[notes/b]]\n"), parseNote("notes/b.md", "# Beta\n")];
  return { root: "/vault", indexPath: "/vault/index.md", catalogMode: "authored", index: "authored", notes,
    analysis: analyzeVault(notes, { mentionScope: () => false }) };
}

function authority(overrides: Partial<GraphAuthority> = {}): GraphAuthority {
  return { query: (request) => Promise.resolve(result(request)), verifyResult: () => Promise.resolve(true),
    verify: () => Promise.resolve(verification), close: () => Promise.resolve(), ...overrides };
}

describe("bounded graph request protocol", () => {
  test("copies and freezes named requests before asynchronous callers can mutate them", () => {
    const input = { program: "reachability", note: "notes/a", depth: 2, limits: { rows: 3 } };
    const checked = validateGraphQueryRequest(input);
    input.note = "notes/b";
    input.limits.rows = 99;
    expect(checked).toEqual({ program: "reachability", note: "notes/a", depth: 2, limits: { rows: 3 } });
    expect(Object.isFrozen(checked)).toBe(true);
    expect(Object.isFrozen(checked.limits)).toBe(true);
  });

  test("rejects executable fields, extra options, wrong identities, and unbounded work", () => {
    let getterReads = 0;
    const accessor = { get program() { getterReads += 1; return "backlinks"; }, note: "notes/a" };
    const proxy = new Proxy({ program: "backlinks", note: "notes/a" }, {
      getPrototypeOf() { getterReads += 1; throw new Error("must not run proxy trap"); },
      ownKeys() { getterReads += 1; throw new Error("must not run proxy trap"); },
    });
    const invalid: unknown[] = [accessor, proxy, Object.create({ program: "backlinks", note: "notes/a" }),
      { program: "backlinks", note: "notes/a", [Symbol("hidden")]: true },
      { program: "backlinks", note: "notes/a", depth: 1 },
      { program: "relation-closure", note: "notes/a", predicate: "Related-To" },
      { program: "reachability", note: "../a", depth: 1 },
      { program: "backlinks", note: "notes/a.md" },
      { program: "scope-route", scope: "./src" },
      { program: "scope-route", scope: "src", note: "notes/a" },
      { program: "backlinks", note: "notes/a", limits: { rows: GRAPH_LIMITS.rows + 1 } },
      { program: "backlinks", note: "notes/a", limits: { rows: 0 } },
      { program: "backlinks", note: "notes/a", limits: { time: 10 } },
      { program: "ask", note: "notes/a" },
    ];
    for (const value of invalid) expect(() => validateGraphQueryRequest(value)).toThrow();
    expect(getterReads).toBe(0);
  });

  test("valid named requests have idempotent validation across bounded counts", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: GRAPH_LIMITS.rows }),
      fc.integer({ min: 1, max: GRAPH_LIMITS.depth }), (rows, depth) => {
        const request = validateGraphQueryRequest({ program: "relation-closure", note: "notes/a",
          predicate: "depends-on", depth, limits: { rows } });
        expect(validateGraphQueryRequest(request)).toEqual(request);
      }));
  });
});

describe("graph CLI integration", () => {
  test("preserves the legacy graph report and recognizes only explicit new actions", () => {
    expect(parseArguments(["graph", "--root", "vault", "--json"])).toMatchObject({ ok: true,
      value: { kind: "graph", root: "vault", json: true } });
    expect(parseArguments(["graph", "query", "--program", "reachability", "--note", "notes/a", "--depth", "2",
      "--limit", "4", "--persisted", "--index", "home.md", "--json"])).toEqual({ ok: true,
      value: { kind: "graph-query", root: ".", index: "home.md", json: true, persisted: true,
        request: { program: "reachability", note: "notes/a", depth: 2, limits: { rows: 4 } } } });
    expect(parseGraphCommand(["rebuild", "--fresh"])).toEqual({ ok: true,
      value: { kind: "graph-rebuild", root: ".", json: false, fresh: true } });
  });

  test("validates program-specific arguments before any filesystem or authority call", async () => {
    let calls = 0;
    const invalid = [
      ["query", "--program", "backlinks", "--note", "notes/a", "--depth", "2"],
      ["query", "--program", "scope-route", "--note", "notes/a"],
      ["query", "--program", "relation-closure", "--note", "notes/a"],
      ["query", "--program", "reachability", "--note", "notes/a", "--depth", "9"],
      ["query", "--program", "backlinks", "--note", "notes/a", "--limit", "1e3"],
      ["query", "--program", "backlinks", "--note", "notes/a", "--limit", "01"],
      ["query", "--program", "backlinks", "--note", "notes/a", "--limit", "1001"],
      ["query", "--program", "backlinks", "--program", "reachability", "--note", "notes/a"],
      ["query", "--program", "backlinks", "--note", "notes/a", "--fresh"],
      ["verify", "--fresh"], ["rebuild", "--persisted"], ["query", "--program", "backlinks", "--note"],
    ];
    for (const arguments_ of invalid) {
      const captured = output();
      expect(await main(["graph", ...arguments_, "--json"], captured.sink, {
        queryGraph: () => { calls += 1; throw new Error("unexpected query"); },
        rebuildGraph: () => { calls += 1; throw new Error("unexpected rebuild"); },
        verifyGraph: () => { calls += 1; throw new Error("unexpected verify"); },
      })).toBe(2);
      expect(JSON.parse(captured.text())).toMatchObject({ ok: false, error: { kind: "parse" } });
    }
    expect(calls).toBe(0);
  });

  test("routes rebuild and persisted verification with the selected root and index", async () => {
    const calls: unknown[] = [];
    for (const action of ["rebuild", "verify"] as const) {
      const captured = output();
      expect(await main(["graph", action, "--root", "vault", "--index", "home.md", "--json",
        ...(action === "rebuild" ? ["--fresh"] : [])], captured.sink, {
        rebuildGraph: async (root, options) => { calls.push({ action: "rebuild", root, options }); return verification; },
        verifyGraph: async (root, options) => { calls.push({ action: "verify", root, options }); return verification; },
      })).toBe(0);
      expect(JSON.parse(captured.text())).toEqual(verification);
      expect(captured.errors()).toBe("");
    }
    expect(calls).toEqual([{ action: "rebuild", root: "vault", options: { index: "home.md", fresh: true } },
      { action: "verify", root: "vault", options: { index: "home.md" } }]);
  });

  test("defaults queries to memory and exposes incomplete evidence with a nonzero exit", async () => {
    const captured = output();
    const calls: unknown[] = [];
    expect(await main(["graph", "query", "--program", "backlinks", "--note", "notes/a", "--json"], captured.sink, {
      queryGraph: async (root, request, options) => {
        calls.push({ root, options });
        return { ...result(request), proofsTruncated: true, truncationReasons: ["proof-nodes"] };
      },
    })).toBe(4);
    expect(calls).toEqual([{ root: ".", options: { persisted: false } }]);
    expect(JSON.parse(captured.text())).toMatchObject({ authority: "derived", proofsTruncated: true,
      truncationReasons: ["proof-nodes"] });
  });

  test("requires an explicit percolation note and separates proof output from V2", async () => {
    expect(parseArguments(["percolate", "--proofs", "--json"])).toMatchObject({ ok: false });
    expect(parseArguments(["percolate", "notes/a", "--proofs", "--proofs"])).toMatchObject({ ok: false });
    const scanned = snapshot();
    const captures: unknown[] = [];
    const withProofs = output();
    expect(await main(["percolate", "notes/a", "--proofs", "--json"], withProofs.sink, {
      scanVault: async (root, options) => { captures.push({ root, options }); return scanned; },
      percolateWithGraph: async (input, options) => {
        expect(input).toBe(scanned);
        expect(options).toEqual({ note: "notes/a", minSupport: 2, limit: 25 });
        return proofPercolation();
      },
    })).toBe(0);
    expect(captures).toMatchObject([{ options: { mentionScope: "notes/a" } }]);
    expect(JSON.parse(withProofs.text())).toEqual(proofPercolation());
    const legacy = output();
    expect(await main(["percolate", "notes/a", "--json"], legacy.sink, {
      scanVault: async () => scanned,
      percolateVault: () => proofPercolation().suggestions,
      percolateWithGraph: () => { throw new Error("unexpected proof query"); },
    })).toBe(0);
    expect(JSON.parse(legacy.text())).toEqual({ root: "/vault", note: "notes/a", minSupport: 2,
      limit: 25, schemaVersion: 2, candidates: [], truncated: false });
  });

  test("keeps errors and foreign row text within the existing terminal boundary", async () => {
    const captured = output();
    expect(await main(["graph", "query", "--program", "backlinks", "--note", "notes/a"], captured.sink, {
      queryGraph: async (root, request) => {
        void root;
        return { ...result(request), rows: [{ values: ["\u001b[2Jforeign", "notes/a"], proofs: [], proofsTruncated: false, supportCount: 1 }] };
      },
    })).toBe(0);
    expect(captured.text()).not.toContain("\u001b");
    const failed = output();
    expect(await main(["graph", "verify", "--json"], failed.sink, {
      verifyGraph: () => { throw new Error("stale projection\u001b[2J"); },
    })).toBe(1);
    expect(JSON.parse(failed.text())).toMatchObject({ ok: false, error: { kind: "runtime" } });
    expect(failed.text()).not.toContain("\u001b");
  });
});

describe("SDK graph authority lifecycle", () => {
  test("shares the original scan, stays lazy, and copies requests before queued work", async () => {
    const scanned = snapshot();
    let scans = 0;
    let opens = 0;
    let closes = 0;
    const requests: GraphQueryRequest[] = [];
    const kb = await openKnowledgeBase({ root: "/vault" }, {
      scanVault: async () => { scans += 1; return scanned; },
      openGraphAuthority: async (input) => {
        expect(input).toBe(scanned);
        opens += 1;
        return authority({ query: async (request) => { requests.push(request); return result(request); },
          close: async () => { closes += 1; } });
      },
    });
    expect(kb.list()).toHaveLength(2);
    expect(kb.links("notes/a").nodes).toHaveLength(2);
    expect(opens).toBe(0);
    await expect(kb.graphQuery({ program: "backlinks", note: "../a" })).rejects.toThrow("canonical note ID");
    expect(opens).toBe(0);
    const input: GraphQueryRequest = { program: "reachability", note: "notes/a", limits: { rows: 2 } };
    const pending = kb.graphQuery(input);
    Object.assign(input, { note: "notes/b" });
    Object.assign(input.limits!, { rows: 9 });
    const answered = await pending;
    expect(requests).toEqual([{ program: "reachability", note: "notes/a", limits: { rows: 2 } }]);
    expect(await kb.graphVerifyResult(answered)).toBe(true);
    expect(scans).toBe(1);
    expect(opens).toBe(1);
    const firstClose = kb.close();
    expect(kb.close()).toBe(firstClose);
    await firstClose;
    expect(closes).toBe(1);
    await expect(kb.graphQuery({ program: "backlinks", note: "notes/a" })).rejects.toThrow("closed");
    await expect(kb.graphVerifyResult(answered)).rejects.toThrow("closed");
  });

  test("proof percolation uses the original scan without opening the session graph authority", async () => {
    const scanned = snapshot();
    const calls: unknown[] = [];
    const kb = await openKnowledgeBase({ root: "/vault" }, {
      scanVault: async () => scanned,
      openGraphAuthority: () => { throw new Error("unexpected shared graph open"); },
      percolateWithGraph: async (input, options) => {
        expect(input).toBe(scanned);
        calls.push(options);
        return proofPercolation();
      },
    });
    const options = { note: "notes/a", limit: 2 };
    const pending = kb.percolateWithProofs(options);
    options.note = "notes/b";
    const closing = kb.close();
    expect(await pending).toEqual(proofPercolation());
    await closing;
    expect(calls).toEqual([{ note: "notes/a", limit: 2 }]);
    await expect(kb.percolateWithProofs({ note: "notes/a" })).rejects.toThrow("closed");
  });

  test("serializes accepted operations and waits for them before closing", async () => {
    const events: string[] = [];
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const began = new Promise<void>((resolve) => { started = resolve; });
    const kb = await openKnowledgeBase({ root: "/vault" }, {
      scanVault: async () => snapshot(),
      openGraphAuthority: async () => authority({
        query: async (request) => { events.push("query"); started?.(); await wait; events.push("query done"); return result(request); },
        verifyResult: async () => { events.push("verify"); return true; },
        close: async () => { events.push("close"); },
      }),
    });
    const first = kb.graphQuery({ program: "backlinks", note: "notes/a" });
    const second = kb.graphVerifyResult({});
    const closing = kb.close();
    await began;
    expect(events).toEqual(["query"]);
    release?.();
    await Promise.all([first, second, closing]);
    expect(events).toEqual(["query", "query done", "verify", "close"]);
  });

  test("closes after failed queries, preserves close errors, and never opens unused graphs", async () => {
    let opens = 0;
    const unused = await openKnowledgeBase({ root: "/vault" }, {
      scanVault: async () => snapshot(), openGraphAuthority: async () => { opens += 1; return authority(); },
    });
    await unused.close();
    expect(opens).toBe(0);
    const kb = await openKnowledgeBase({ root: "/vault" }, {
      scanVault: async () => snapshot(),
      openGraphAuthority: async () => authority({ query: () => Promise.reject(new Error("bounded query failed")),
        close: () => Promise.reject(new Error("graph close failed")) }),
    });
    await expect(kb.graphQuery({ program: "backlinks", note: "notes/a" })).rejects.toThrow("bounded query failed");
    const closing = kb.close();
    expect(kb.close()).toBe(closing);
    await expect(closing).rejects.toThrow("graph close failed");
  });
});
