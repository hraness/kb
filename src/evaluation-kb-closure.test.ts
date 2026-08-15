import { describe, expect, test } from "bun:test";

import {
  freezeExistingLaneClosureVariant,
  runExistingLaneClosure as executeExistingLaneClosure,
  MAX_EXISTING_LANE_CLOSURE_PROVENANCE_BYTES,
  MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES,
  MAX_EXISTING_LANE_CLOSURE_TOTAL_EVIDENCE_UNITS,
  type ExistingLaneClosureAccounting,
  type ExistingLaneClosureBackend,
  type ExistingLaneClosureEvidenceLocator,
  type ExistingLaneClosureEvidenceRegistry,
  type ExistingLaneClosureExecutableInputs,
  type ExistingLaneClosureHit,
  type ExistingLaneClosureLaneResult,
  type ExistingLaneClosureQuery,
  type ExistingLaneClosureVariant,
  type RunExistingLaneClosureRequest,
} from "./evaluation-kb-closure.js";

const registryUnits = new Map<string, ExistingLaneClosureEvidenceLocator>();

function locator(
  evidenceUnitId: string,
  documentId: string,
  options: {
    readonly headingPath?: readonly string[];
    readonly sourcePath?: string;
  } = {},
): ExistingLaneClosureEvidenceLocator {
  const value: ExistingLaneClosureEvidenceLocator = Object.freeze({
    evidenceUnitId,
    documentId,
    sourceFamilyId: "authored-family",
    sourceClass: "authored-note",
    trustClass: "authoritative-current",
    sourcePath: options.sourcePath ?? `${documentId}.md`,
    lineRange: Object.freeze({ start: 1, end: 3 }),
    headingPath: Object.freeze([...(options.headingPath ?? ["Evidence"])]),
  });
  registryUnits.set(evidenceUnitId, value);
  return value;
}

function evidenceRegistry(): ExistingLaneClosureEvidenceRegistry {
  return Object.freeze({ units: Object.freeze([...registryUnits.values()]) });
}

function accounting(options: {
  readonly embeddingCalls?: number;
  readonly embeddingInputTokens?: number;
  readonly embeddingInputTokensMeasured?: false;
  readonly embeddingDurationMs?: number;
  readonly embeddingDurationScope?: "embedding-backed-search-upper-bound";
  readonly contextUtf8Bytes?: number;
  readonly contextReaderTokens?: number;
  readonly peakRssBytes?: number;
  readonly cacheBytes?: number;
} = {}): ExistingLaneClosureAccounting {
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: options.embeddingCalls ?? 0,
      inputTokens: options.embeddingInputTokens ?? 0,
      ...(options.embeddingInputTokensMeasured === false
        ? { inputTokensMeasured: false as const }
        : {}),
      durationMs: options.embeddingDurationMs ?? 0,
      ...(options.embeddingDurationScope === undefined
        ? {}
        : { durationScope: options.embeddingDurationScope }),
    }),
    packedContext: Object.freeze({
      utf8Bytes: options.contextUtf8Bytes ?? 0,
      readerTokens: options.contextReaderTokens ?? 0,
    }),
    peakRssBytes: options.peakRssBytes ?? 0,
    cacheBytes: options.cacheBytes ?? 0,
  });
}

function runExistingLaneClosure(
  request: Omit<RunExistingLaneClosureRequest, "evidenceRegistry">,
) {
  return executeExistingLaneClosure({ ...request, evidenceRegistry: evidenceRegistry() });
}

function backend<Input>(
  retrieve: ExistingLaneClosureBackend<Input>["retrieve"],
): ExistingLaneClosureBackend<Input> {
  return Object.freeze({ retrieve });
}

function hit(
  documentId: string,
  rank: number,
  options: {
    readonly canonicalDocumentId?: string;
    readonly marker?: string;
    readonly provenance?: boolean;
    readonly evidenceDocumentId?: string;
  } = {},
): ExistingLaneClosureHit {
  const evidence = Object.freeze({ marker: options.marker ?? documentId });
  const canonicalDocumentId = options.canonicalDocumentId ?? documentId;
  const unitId = `${documentId}:unit`;
  const evidenceLocator = locator(
    unitId,
    options.evidenceDocumentId ?? canonicalDocumentId,
  );
  return Object.freeze({
    documentId,
    canonicalDocumentId,
    rank,
    evidenceUnits: options.provenance === false
      ? Object.freeze([])
      : Object.freeze([Object.freeze({ id: unitId, locator: evidenceLocator })]),
    evidence,
  });
}

function result(
  status: ExistingLaneClosureLaneResult["status"],
  hits: readonly ExistingLaneClosureHit[] = [],
  options: {
    readonly diagnostics?: ExistingLaneClosureLaneResult["diagnostics"];
    readonly timings?: Readonly<Record<string, number>>;
    readonly resources?: Readonly<Record<string, number>>;
    readonly accounting?: ExistingLaneClosureAccounting;
  } = {},
): ExistingLaneClosureLaneResult {
  return Object.freeze({
    status,
    hits: Object.freeze([...hits]),
    ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics }),
    ...(options.timings === undefined ? {} : { timings: options.timings }),
    ...(options.resources === undefined ? {} : { resources: options.resources }),
    accounting: options.accounting ?? accounting(),
  });
}

function frozenVariant(value: unknown): ExistingLaneClosureVariant {
  return freezeExistingLaneClosureVariant(value);
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("existing-lane closure variant", () => {
  test("freezes every budget and the declared unique structural order", () => {
    const source = {
      primary: { lane: "hybrid", retrieveLimit: 8, retainLimit: 4 },
      structuralLanes: [
        { lane: "graph", limit: 3 },
        { lane: "metadata", limit: 2 },
        { lane: "path-context", limit: 1 },
      ],
      git: { mode: "explicit-input", limit: 5 },
      outputLimit: 7,
    } satisfies ExistingLaneClosureVariant;
    const variant = frozenVariant(source);

    expect(variant).toEqual(source);
    expect(Object.isFrozen(variant)).toBe(true);
    expect(Object.isFrozen(variant.primary)).toBe(true);
    expect(Object.isFrozen(variant.structuralLanes)).toBe(true);
    expect(variant.structuralLanes.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(variant.git)).toBe(true);
    source.structuralLanes.reverse();
    expect(variant.structuralLanes.map(({ lane }) => lane)).toEqual([
      "graph",
      "metadata",
      "path-context",
    ]);
  });

  test("rejects invalid budgets, descriptors, and repeated structural lanes", () => {
    expect(() => frozenVariant({
      primary: { lane: "hybrid", retrieveLimit: 2, retainLimit: 3 },
      structuralLanes: [],
      git: { mode: "off" },
      outputLimit: 3,
    })).toThrow("may not exceed retrieveLimit");
    expect(() => frozenVariant({
      primary: null,
      structuralLanes: [
        { lane: "graph", limit: 2 },
        { lane: "graph", limit: 2 },
      ],
      git: { mode: "off" },
      outputLimit: 3,
    })).toThrow("must be unique");
    expect(() => frozenVariant({
      primary: null,
      structuralLanes: [{ lane: "router", limit: 1 }],
      git: { mode: "off" },
      outputLimit: 3,
    })).toThrow("metadata, graph, or path-context");
    expect(() => frozenVariant({
      primary: null,
      structuralLanes: [],
      git: { mode: "off", limit: 1 },
      outputLimit: 3,
    })).toThrow("unknown field");
    expect(() => frozenVariant({
      primary: null,
      structuralLanes: [],
      git: { mode: "off" },
      outputLimit: 0,
    })).toThrow("outputLimit");
  });
});

describe("existing-lane closure composition", () => {
  test("retains the primary prefix unchanged, appends in order, and traces every budget decision", async () => {
    const primaryOne = hit("notes/primary-one", 1, { marker: "primary-one" });
    const primaryTwo = hit("notes/primary-two", 2, { marker: "primary-two" });
    const outsideRetain = hit("notes/outside-retain", 3);
    const duplicate = hit("aliases/primary-one", 1, {
      canonicalDocumentId: "notes/primary-one",
      marker: "metadata-duplicate",
    });
    const appended = hit("notes/appended", 2);
    const outsideOutput = hit("notes/outside-output", 3);
    const hybridInput = Object.freeze({ text: "structured text" });
    const metadataInput = Object.freeze({
      filters: Object.freeze([{ kind: "equals" as const, path: "type", value: "plan" }]),
      tags: Object.freeze([]),
    });
    const calls: string[] = [];
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: { lane: "hybrid", retrieveLimit: 4, retainLimit: 2 },
        structuralLanes: [{ lane: "metadata", limit: 3 }],
        git: { mode: "off" },
        outputLimit: 3,
      }),
      query: { inputs: { hybrid: hybridInput, metadata: metadataInput } },
      backends: {
        hybrid: backend((request) => {
          calls.push("hybrid");
          expect(Object.keys(request)).toEqual(["input", "limit", "signal"]);
          expect(request.input).not.toBe(hybridInput);
          expect(request.input).toEqual(hybridInput);
          expect(Object.isFrozen(request.input)).toBe(true);
          expect(request.limit).toBe(4);
          return Promise.resolve(result("ready", [primaryTwo, outsideRetain, primaryOne], {
            timings: { searchMs: 4 },
            resources: { embeddingCalls: 1, embeddingMs: 7 },
            accounting: accounting({
              embeddingCalls: 1,
              embeddingInputTokens: 9,
              embeddingDurationMs: 7,
              peakRssBytes: 100,
              cacheBytes: 10,
            }),
          }));
        }),
        metadata: backend((request) => {
          calls.push("metadata");
          expect(Object.keys(request)).toEqual(["input", "limit", "signal"]);
          expect(request.input).not.toBe(metadataInput);
          expect(request.input).toEqual(metadataInput);
          expect(Object.isFrozen(request.input.filters)).toBe(true);
          expect(request.limit).toBe(3);
          return Promise.resolve(result("ready", [duplicate, appended, outsideOutput], {
            timings: { listMs: 2 },
            resources: { contextUtf8Bytes: 128 },
            accounting: accounting({
              contextUtf8Bytes: 128,
              contextReaderTokens: 32,
              peakRssBytes: 80,
              cacheBytes: 10,
            }),
          }));
        }),
      },
      signal: signal(),
    });

    expect(calls).toEqual(["hybrid", "metadata"]);
    expect(closure.status).toBe("ready");
    expect(closure.hits).toEqual([primaryOne, primaryTwo, appended]);
    expect(closure.hits[0]).not.toBe(primaryOne);
    expect(closure.hits[1]).not.toBe(primaryTwo);
    expect(closure.hits[0]).toEqual(primaryOne);
    expect(closure.hits[1]).toEqual(primaryTwo);
    expect(closure.hits[0]?.evidence).not.toBe(primaryOne.evidence);
    expect(closure.trace.lanes.map(({ lane }) => lane)).toEqual(["hybrid", "metadata", "git"]);
    expect(closure.trace.fusion).toEqual({
      id: "primary-prefix-then-round-robin-v1",
      primaryLane: "hybrid",
      appendedLaneOrder: ["metadata"],
    });
    expect(closure.trace.lanes[0]?.candidates.map(({ reasonCode }) => reasonCode)).toEqual([
      "primary",
      "primary",
      "primary-retain-limit",
    ]);
    expect(closure.trace.lanes[1]?.candidates.map(({ reasonCode }) => reasonCode)).toEqual([
      "deduplicated",
      "appended",
      "output-limit",
    ]);
    expect(closure.trace.lanes[1]?.candidates[0]).toMatchObject({
      decision: "excluded",
      sourceRank: 1,
      outputRank: 1,
      evidenceUnitIds: ["aliases/primary-one:unit"],
    });
    expect(closure.trace.documents.map(({ canonicalDocumentId, outputRank }) => ({
      canonicalDocumentId,
      outputRank,
    }))).toEqual([
      { canonicalDocumentId: "notes/primary-one", outputRank: 1 },
      { canonicalDocumentId: "notes/primary-two", outputRank: 2 },
      { canonicalDocumentId: "notes/appended", outputRank: 3 },
    ]);
    expect(closure.trace.documents[0]?.sources.map(({ lane }) => lane)).toEqual([
      "hybrid",
      "metadata",
    ]);
    expect(closure.timings).toEqual({
      "hybrid.searchMs": 4,
      "metadata.listMs": 2,
    });
    expect(closure.resources).toEqual({
      "hybrid.embeddingCalls": 1,
      "hybrid.embeddingMs": 7,
      "metadata.contextUtf8Bytes": 128,
    });
    expect(closure.accounting).toEqual({
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 1, inputTokens: 9, durationMs: 7 },
      packedContext: { utf8Bytes: 128, readerTokens: 32 },
      peakRssBytes: 100,
      cacheBytes: 10,
    });
  });

  test("keeps a five-hit primary prefix and round-robins every applicable closure lane", async () => {
    const primary = Array.from({ length: 10 }, (_, index) =>
      hit(`notes/primary-${index + 1}`, index + 1));
    const metadataHits = [
      hit("aliases/primary-1", 1, { canonicalDocumentId: "notes/primary-1" }),
      hit("notes/metadata-2", 2),
      hit("notes/metadata-3", 3),
    ];
    const graphHits = [
      hit("notes/graph-missing", 1, { provenance: false }),
      hit("notes/graph-2", 2),
      hit("notes/graph-3", 3),
    ];
    const pathHits = [
      hit("notes/path-1", 1),
      hit("notes/path-2", 2),
      hit("notes/path-3", 3),
    ];
    const gitHits = [
      hit("notes/git-1", 1),
      hit("notes/git-2", 2),
      hit("notes/git-3", 3),
    ];
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: { lane: "hybrid", retrieveLimit: 10, retainLimit: 5 },
        structuralLanes: [
          { lane: "metadata", limit: 3 },
          { lane: "graph", limit: 3 },
          { lane: "path-context", limit: 3 },
        ],
        git: { mode: "explicit-input", limit: 3 },
        outputLimit: 10,
      }),
      query: {
        inputs: {
          hybrid: { text: "multi-view evidence" },
          metadata: { filters: [], tags: ["agents"] },
          graph: { seeds: ["notes/primary-1"], depth: 1 },
          pathContext: { repositoryPath: "src" },
          history: { query: "multi-view history", noteIds: ["notes/primary-1"] },
        },
      },
      backends: {
        hybrid: backend(() => Promise.resolve(result("ready", primary))),
        metadata: backend(() => Promise.resolve(result("ready", metadataHits))),
        graph: backend(() => Promise.resolve(result("ready", graphHits))),
        pathContext: backend(() => Promise.resolve(result("ready", pathHits))),
        git: backend(() => Promise.resolve(result("ready", gitHits))),
      },
      signal: signal(),
    });

    expect(closure.hits.map(({ canonicalDocumentId }) => canonicalDocumentId)).toEqual([
      "notes/primary-1",
      "notes/primary-2",
      "notes/primary-3",
      "notes/primary-4",
      "notes/primary-5",
      "notes/path-1",
      "notes/git-1",
      "notes/metadata-2",
      "notes/graph-2",
      "notes/path-2",
    ]);
    expect(closure.trace.fusion).toEqual({
      id: "primary-prefix-then-round-robin-v1",
      primaryLane: "hybrid",
      appendedLaneOrder: ["metadata", "graph", "path-context", "git"],
    });
    expect(closure.trace.lanes[0]?.candidates.slice(5).every(({ reasonCode }) =>
      reasonCode === "primary-retain-limit")).toBe(true);
    expect(closure.trace.lanes[1]?.candidates[0]).toMatchObject({
      reasonCode: "deduplicated",
      outputRank: 1,
    });
    expect(closure.trace.lanes[2]?.candidates[0]).toMatchObject({
      reasonCode: "missing-provenance",
      decision: "excluded",
    });
    expect(closure.trace.lanes[4]?.candidates[0]).toMatchObject({
      reasonCode: "appended",
      outputRank: 7,
    });
  });

  test("accepts cross-document relationship evidence only from the graph lane", async () => {
    const graphHit = hit("notes/graph-target", 1, {
      evidenceDocumentId: "notes/graph-seed",
    });
    const base = {
      query: {
        inputs: {
          metadata: { filters: [], tags: ["agents"] },
          graph: { seeds: ["notes/graph-seed"], depth: 1 },
        },
      },
      signal: signal(),
    } as const;
    const graph = await runExistingLaneClosure({
      ...base,
      variant: frozenVariant({
        primary: null,
        structuralLanes: [{ lane: "graph", limit: 1 }],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      backends: {
        graph: backend(() => Promise.resolve(result("ready", [graphHit]))),
      },
    });
    expect(graph.status).toBe("ready");
    expect(graph.hits).toHaveLength(1);
    expect(graph.trace.lanes.find(({ lane }) => lane === "graph")
      ?.candidates[0]?.provenance[0]?.documentId)
      .toBe("notes/graph-seed");

    expect(runExistingLaneClosure({
      ...base,
      variant: frozenVariant({
        primary: null,
        structuralLanes: [{ lane: "metadata", limit: 1 }],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      backends: {
        metadata: backend(() => Promise.resolve(result("ready", [graphHit]))),
      },
    })).rejects.toThrow("different canonical document");
  });

  test("rejects lane-local cache byte counts for one shared semantic substrate", () => {
    const cacheA = hit("notes/cache-a", 1);
    const cacheB = hit("notes/cache-b", 1);
    expect(runExistingLaneClosure({
      variant: frozenVariant({
        primary: { lane: "hybrid", retrieveLimit: 2, retainLimit: 1 },
        structuralLanes: [{ lane: "metadata", limit: 1 }],
        git: { mode: "off" },
        outputLimit: 2,
      }),
      query: {
        inputs: {
          hybrid: { text: "shared cache" },
          metadata: { filters: [], tags: ["cache"] },
        },
      },
      backends: {
        hybrid: backend(() => Promise.resolve(result("ready", [cacheA], {
          accounting: accounting({ cacheBytes: 10 }),
        }))),
        metadata: backend(() => Promise.resolve(result("ready", [cacheB], {
          accounting: accounting({ cacheBytes: 11 }),
        }))),
      },
      signal: signal(),
    })).rejects.toThrow("one identical shared-cache byte count");
  });

  test("executes structural-only variants in their frozen order and passes explicit Git input verbatim", async () => {
    const order: string[] = [];
    const metadata = Object.freeze({
      filters: Object.freeze([]),
      tags: Object.freeze(["agents"]),
    });
    const graph = Object.freeze({ seeds: Object.freeze(["notes/root"]), depth: 2 as const });
    const pathContext = Object.freeze({ repositoryPath: "src" });
    const history = Object.freeze({
      query: "literal history query",
      noteIds: Object.freeze(["notes/root"]),
    });
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: null,
        structuralLanes: [
          { lane: "graph", limit: 3 },
          { lane: "metadata", limit: 2 },
          { lane: "path-context", limit: 4 },
        ],
        git: { mode: "explicit-input", limit: 5 },
        outputLimit: 10,
      }),
      query: { inputs: { metadata, graph, pathContext, history } },
      backends: {
        graph: backend((request) => {
          order.push("graph");
          expect(request.input).not.toBe(graph);
          expect(request.input).toEqual(graph);
          expect(request.limit).toBe(3);
          return Promise.resolve(result("ready"));
        }),
        metadata: backend((request) => {
          order.push("metadata");
          expect(request.input).not.toBe(metadata);
          expect(request.input).toEqual(metadata);
          expect(request.limit).toBe(2);
          return Promise.resolve(result("ready"));
        }),
        pathContext: backend((request) => {
          order.push("path-context");
          expect(request.input).not.toBe(pathContext);
          expect(request.input).toEqual(pathContext);
          expect(request.limit).toBe(4);
          return Promise.resolve(result("ready"));
        }),
        git: backend((request) => {
          order.push("git");
          expect(Object.keys(request)).toEqual(["input", "limit", "signal"]);
          expect(request.input).not.toBe(history);
          expect(request.input).toEqual({
            query: "literal history query",
            noteIds: ["notes/root"],
          });
          expect(request.limit).toBe(5);
          return Promise.resolve(result("ready"));
        }),
      },
      signal: signal(),
    });

    expect(order).toEqual(["graph", "metadata", "path-context", "git"]);
    expect(closure.status).toBe("ready");
    expect(closure.hits).toEqual([]);
    expect(closure.trace.lanes.map(({ invocation }) => invocation)).toEqual([
      "disabled",
      "invoked",
      "invoked",
      "invoked",
      "invoked",
    ]);
  });

  test("skips missing executable inputs without degradation and never infers Git seeds", async () => {
    let gitCalls = 0;
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: { lane: "hybrid", retrieveLimit: 2, retainLimit: 2 },
        structuralLanes: [
          { lane: "metadata", limit: 2 },
          { lane: "graph", limit: 2 },
          { lane: "path-context", limit: 2 },
        ],
        git: { mode: "explicit-input", limit: 2 },
        outputLimit: 5,
      }),
      query: { inputs: { hybrid: { text: "primary only" } } },
      backends: {
        hybrid: backend(() => Promise.resolve(result("ready"))),
        git: backend(() => {
          gitCalls += 1;
          return Promise.resolve(result("ready"));
        }),
      },
      signal: signal(),
    });

    expect(gitCalls).toBe(0);
    expect(closure.status).toBe("ready");
    expect(closure.hits).toEqual([]);
    expect(closure.trace.lanes.map(({ invocation }) => invocation)).toEqual([
      "invoked",
      "skipped-missing-input",
      "skipped-missing-input",
      "skipped-missing-input",
      "skipped-missing-input",
    ]);
  });

  test("does not inspect history or call Git when the variant disables it", async () => {
    const inputs: { hybrid: { text: string }; readonly history?: never } = {
      hybrid: { text: "structured" },
    };
    Object.defineProperty(inputs, "history", {
      enumerable: true,
      get(): never {
        throw new Error("Git-off closure inspected history");
      },
    });
    let gitCalls = 0;
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: { lane: "hybrid", retrieveLimit: 1, retainLimit: 1 },
        structuralLanes: [],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      query: { inputs },
      backends: {
        hybrid: backend(() => Promise.resolve(result("ready"))),
        git: backend(() => {
          gitCalls += 1;
          return Promise.resolve(result("ready"));
        }),
      },
      signal: signal(),
    });

    expect(gitCalls).toBe(0);
    expect(closure.status).toBe("ready");
    expect(closure.trace.lanes.at(-1)).toMatchObject({
      lane: "git",
      invocation: "disabled",
      status: "skipped",
    });
  });

  test("excludes missing provenance explicitly and degrades an otherwise ready result", async () => {
    const noProvenance = hit("notes/untraceable", 1, { provenance: false });
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: null,
        structuralLanes: [{ lane: "metadata", limit: 1 }],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      query: {
        inputs: { metadata: { filters: [], tags: ["evidence"] } },
      },
      backends: {
        metadata: backend(() => Promise.resolve(result("ready", [noProvenance]))),
      },
      signal: signal(),
    });

    expect(closure.status).toBe("degraded");
    expect(closure.hits).toEqual([]);
    expect(closure.trace.lanes[1]?.candidates).toEqual([
      expect.objectContaining({
        decision: "excluded",
        reasonCode: "missing-provenance",
        evidenceUnitIds: [],
        provenance: [],
      }),
    ]);
  });

  test("propagates QMD degradation while preserving an exact fallback hit", async () => {
    const exactFallback = hit("notes/exact-fallback", 1);
    const diagnostics = Object.freeze([
      Object.freeze({ code: "exact-ready", status: "ready" as const }),
      Object.freeze({
        code: "qmd-unavailable",
        status: "unavailable" as const,
        message: "QMD unavailable; exact results retained.",
      }),
    ]);
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: { lane: "hybrid", retrieveLimit: 3, retainLimit: 3 },
        structuralLanes: [],
        git: { mode: "off" },
        outputLimit: 3,
      }),
      query: { inputs: { hybrid: { text: "fallback" } } },
      backends: {
        hybrid: backend(() => Promise.resolve(result("degraded", [exactFallback], {
          diagnostics,
        }))),
      },
      signal: signal(),
    });

    expect(closure.status).toBe("degraded");
    expect(closure.hits).toEqual([exactFallback]);
    expect(closure.hits[0]).not.toBe(exactFallback);
    expect(closure.trace.lanes[0]?.diagnostics).toEqual(diagnostics);
  });

  test("preserves graph cycle and truncation diagnostics on a structural-only run", async () => {
    const graphHit = hit("notes/b", 1);
    const diagnostics = Object.freeze([
      Object.freeze({
        code: "graph-cycle",
        status: "degraded" as const,
        details: Object.freeze({ seed: "notes/a", repeated: "notes/a" }),
      }),
      Object.freeze({
        code: "graph-truncated",
        status: "degraded" as const,
        message: "Traversal reached its declared limit.",
      }),
    ]);
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: null,
        structuralLanes: [{ lane: "graph", limit: 2 }],
        git: { mode: "off" },
        outputLimit: 2,
      }),
      query: { inputs: { graph: { seeds: ["notes/a"], depth: 2 } } },
      backends: {
        graph: backend(() => Promise.resolve(result("degraded", [graphHit], {
          diagnostics,
        }))),
      },
      signal: signal(),
    });

    expect(closure.status).toBe("degraded");
    expect(closure.trace.lanes[1]?.diagnostics).toEqual(diagnostics);
    expect(closure.trace.lanes[1]).toMatchObject({
      lane: "graph",
      invocation: "invoked",
      status: "degraded",
    });
  });

  test("returns unavailable only when every invoked lane is unavailable", async () => {
    const variant = frozenVariant({
      primary: null,
      structuralLanes: [
        { lane: "metadata", limit: 1 },
        { lane: "graph", limit: 1 },
      ],
      git: { mode: "off" },
      outputLimit: 2,
    });
    const query = {
      inputs: {
        metadata: { filters: [], tags: ["agent"] },
        graph: { seeds: ["notes/root"], depth: 1 as const },
      },
    };
    const allUnavailable = await runExistingLaneClosure({
      variant,
      query,
      backends: {
        metadata: backend(() => Promise.resolve(result("unavailable", [], {
          diagnostics: [{ code: "metadata-offline", status: "unavailable" }],
        }))),
        graph: backend(() => Promise.resolve(result("unavailable", [], {
          diagnostics: [{ code: "graph-offline", status: "unavailable" }],
        }))),
      },
      signal: signal(),
    });
    const partiallyReady = await runExistingLaneClosure({
      variant,
      query,
      backends: {
        metadata: backend(() => Promise.resolve(result("ready"))),
        graph: backend(() => Promise.resolve(result("unavailable"))),
      },
      signal: signal(),
    });

    expect(allUnavailable.status).toBe("unavailable");
    expect(allUnavailable.hits).toEqual([]);
    expect(partiallyReady.status).toBe("degraded");
  });

  test("returns unavailable when no lane is invoked", async () => {
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: null,
        structuralLanes: [],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      query: { inputs: {} },
      backends: {},
      signal: signal(),
    });

    expect(closure.status).toBe("unavailable");
    expect(closure.hits).toEqual([]);
    expect(closure.trace.lanes).toEqual([
      expect.objectContaining({ lane: "hybrid", invocation: "disabled" }),
      expect.objectContaining({ lane: "git", invocation: "disabled" }),
    ]);
  });
});

describe("existing-lane closure isolation and failures", () => {
  test("never reads query prose, labels, judgments, nuggets, trust, or assessor fields", async () => {
    const inputs: ExistingLaneClosureExecutableInputs = {
      hybrid: { text: "executable hybrid text" },
      metadata: { filters: [], tags: ["agents"] },
      graph: { seeds: ["notes/root"], depth: 1 },
      pathContext: { repositoryPath: "src" },
      history: { query: "declared history", noteIds: ["notes/root"] },
    };
    const queryObject: Record<string, unknown> = { inputs };
    const forbidden = [
      "text",
      "class",
      "strata",
      "split",
      "answer",
      "supportLabels",
      "qrels",
      "evidenceJudgments",
      "nuggets",
      "trust",
      "assessors",
      "adjudication",
    ];
    for (const field of forbidden) {
      Object.defineProperty(queryObject, field, {
        enumerable: true,
        get(): never {
          throw new Error(`closure read forbidden field ${field}`);
        },
      });
    }
    const seenInputs: unknown[] = [];
    const ready = <Input>() => backend<Input>((request) => {
      expect(Object.keys(request)).toEqual(["input", "limit", "signal"]);
      seenInputs.push(request.input);
      return Promise.resolve(result("ready"));
    });
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: { lane: "hybrid", retrieveLimit: 2, retainLimit: 1 },
        structuralLanes: [
          { lane: "metadata", limit: 1 },
          { lane: "graph", limit: 1 },
          { lane: "path-context", limit: 1 },
        ],
        git: { mode: "explicit-input", limit: 1 },
        outputLimit: 3,
      }),
      query: queryObject as ExistingLaneClosureQuery,
      backends: {
        hybrid: ready(),
        metadata: ready(),
        graph: ready(),
        pathContext: ready(),
        git: ready(),
      },
      signal: signal(),
    });

    expect(closure.status).toBe("ready");
    expect(seenInputs).toEqual([
      inputs.hybrid,
      inputs.metadata,
      inputs.graph,
      inputs.pathContext,
      inputs.history,
    ]);
    expect(seenInputs[0]).not.toBe(inputs.hybrid);
    expect(seenInputs[1]).not.toBe(inputs.metadata);
    expect(seenInputs[2]).not.toBe(inputs.graph);
    expect(seenInputs[3]).not.toBe(inputs.pathContext);
    expect(seenInputs[4]).not.toBe(inputs.history);
  });

  test("deep-copies lane inputs and rejects nested capability-bearing shapes before backend work", async () => {
    const metadata = {
      filters: [{ kind: "equals" as const, path: "type", value: "plan" }],
      tags: ["agents"],
    };
    let observed: unknown;
    await runExistingLaneClosure({
      variant: frozenVariant({
        primary: null,
        structuralLanes: [{ lane: "metadata", limit: 1 }],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      query: { inputs: { metadata } },
      backends: {
        metadata: backend((request) => {
          observed = request.input;
          expect(request.input).not.toBe(metadata);
          expect(request.input.filters).not.toBe(metadata.filters);
          expect(request.input.filters[0]).not.toBe(metadata.filters[0]);
          expect(request.input.tags).not.toBe(metadata.tags);
          expect(Object.isFrozen(request.input)).toBe(true);
          expect(Object.isFrozen(request.input.filters)).toBe(true);
          expect(Object.isFrozen(request.input.filters[0])).toBe(true);
          expect(Object.isFrozen(request.input.tags)).toBe(true);
          return Promise.resolve(result("ready"));
        }),
      },
      signal: signal(),
    });
    metadata.filters[0]!.path = "status";
    metadata.tags[0] = "changed";
    expect(observed).toEqual({
      filters: [{ kind: "equals", path: "type", value: "plan" }],
      tags: ["agents"],
    });

    const symbolMetadata = { filters: [], tags: ["agents"] };
    Object.defineProperty(symbolMetadata, Symbol("capability"), {
      enumerable: true,
      value: "secret",
    });
    const nonEnumerableFilter = { kind: "exists", path: "type" };
    Object.defineProperty(nonEnumerableFilter, "secret", {
      enumerable: false,
      value: "hidden",
    });
    const inheritedMetadata = Object.assign(
      Object.create({ secret: "prototype" }) as Record<string, unknown>,
      { filters: [], tags: ["agents"] },
    );
    let hostileGetterCalls = 0;
    const accessorTags = ["agents"];
    Object.defineProperty(accessorTags, "0", {
      enumerable: true,
      get(): string {
        hostileGetterCalls += 1;
        throw new Error("hostile tag getter ran");
      },
    });
    const hostileInputs: unknown[] = [
      symbolMetadata,
      { filters: [nonEnumerableFilter], tags: [] },
      inheritedMetadata,
      { filters: [], tags: accessorTags },
    ];
    let hybridCalls = 0;
    for (const hostile of hostileInputs) {
      expect(runExistingLaneClosure({
        variant: frozenVariant({
          primary: { lane: "hybrid", retrieveLimit: 1, retainLimit: 1 },
          structuralLanes: [{ lane: "metadata", limit: 1 }],
          git: { mode: "off" },
          outputLimit: 1,
        }),
        query: {
          inputs: {
            hybrid: { text: "valid" },
            metadata: hostile as NonNullable<ExistingLaneClosureExecutableInputs["metadata"]>,
          },
        },
        backends: {
          hybrid: backend(() => {
            hybridCalls += 1;
            return Promise.resolve(result("ready"));
          }),
          metadata: backend(() => Promise.resolve(result("ready"))),
        },
        signal: signal(),
      })).rejects.toThrow();
    }
    expect(hybridCalls).toBe(0);
    expect(hostileGetterCalls).toBe(0);
  });

  test("keeps each evidence unit paired with one exact registry-bound typed locator", async () => {
    const documentId = "notes/multi-unit";
    const firstLocator = locator("unit:multi:first", documentId, { headingPath: ["First"] });
    const secondLocator = locator("unit:multi:second", documentId, { headingPath: ["Second"] });
    const multiUnitHit: ExistingLaneClosureHit = {
      documentId,
      canonicalDocumentId: documentId,
      rank: 1,
      evidenceUnits: [
        { id: firstLocator.evidenceUnitId, locator: firstLocator },
        { id: secondLocator.evidenceUnitId, locator: secondLocator },
      ],
    };
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: null,
        structuralLanes: [{ lane: "metadata", limit: 1 }],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      query: { inputs: { metadata: { filters: [], tags: ["evidence"] } } },
      backends: {
        metadata: backend(() => Promise.resolve(result("ready", [multiUnitHit]))),
      },
      signal: signal(),
    });
    const trace = closure.trace.lanes[1]?.candidates[0];
    expect(trace?.evidenceUnits.map(({ id, locator: value }) => ({
      id,
      locatorId: value.evidenceUnitId,
      headingPath: value.headingPath,
    }))).toEqual([
      { id: "unit:multi:first", locatorId: "unit:multi:first", headingPath: ["First"] },
      { id: "unit:multi:second", locatorId: "unit:multi:second", headingPath: ["Second"] },
    ]);
    expect(trace?.evidenceUnitIds).toEqual(trace?.provenance.map(({ evidenceUnitId }) => evidenceUnitId));

    const mismatchedLocator = {
      ...secondLocator,
      sourcePath: "notes/wrong.md",
    };
    const invalidHit: ExistingLaneClosureHit = {
      documentId,
      canonicalDocumentId: documentId,
      rank: 1,
      evidenceUnits: [
        { id: firstLocator.evidenceUnitId, locator: firstLocator },
        { id: secondLocator.evidenceUnitId, locator: mismatchedLocator },
      ],
    };
    expect(runExistingLaneClosure({
      variant: frozenVariant({
        primary: null,
        structuralLanes: [{ lane: "metadata", limit: 1 }],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      query: { inputs: { metadata: { filters: [], tags: ["evidence"] } } },
      backends: {
        metadata: backend(() => Promise.resolve(result("ready", [invalidHit]))),
      },
      signal: signal(),
    })).rejects.toThrow("frozen registry binding");
  });

  test("validates all configured descriptors and backends before any backend work", () => {
    let hybridCalls = 0;
    const variant = frozenVariant({
      primary: { lane: "hybrid", retrieveLimit: 2, retainLimit: 1 },
      structuralLanes: [{ lane: "graph", limit: 2 }],
      git: { mode: "off" },
      outputLimit: 2,
    });
    const invalidGraph = { seeds: [], depth: 2 } as unknown as NonNullable<
      ExistingLaneClosureExecutableInputs["graph"]
    >;
    expect(runExistingLaneClosure({
      variant,
      query: { inputs: { hybrid: { text: "valid" }, graph: invalidGraph } },
      backends: {
        hybrid: backend(() => {
          hybridCalls += 1;
          return Promise.resolve(result("ready"));
        }),
        graph: backend(() => Promise.resolve(result("ready"))),
      },
      signal: signal(),
    })).rejects.toThrow("seeds");
    expect(hybridCalls).toBe(0);

    expect(runExistingLaneClosure({
      variant,
      query: {
        inputs: {
          hybrid: { text: "valid" },
          graph: { seeds: ["notes/root"], depth: 1 },
        },
      },
      backends: {
        hybrid: backend(() => {
          hybridCalls += 1;
          return Promise.resolve(result("ready"));
        }),
      },
      signal: signal(),
    })).rejects.toThrow("graph backend");
    expect(hybridCalls).toBe(0);
  });

  test("stops before the next lane when aborted and preserves the abort failure", async () => {
    const controller = new AbortController();
    const abortReason = new Error("stop closure");
    let graphCalls = 0;
    let caught: unknown;
    try {
      await runExistingLaneClosure({
        variant: frozenVariant({
          primary: null,
          structuralLanes: [
            { lane: "metadata", limit: 1 },
            { lane: "graph", limit: 1 },
          ],
          git: { mode: "off" },
          outputLimit: 2,
        }),
        query: {
          inputs: {
            metadata: { filters: [], tags: ["agents"] },
            graph: { seeds: ["notes/root"], depth: 1 },
          },
        },
        backends: {
          metadata: backend(() => {
            controller.abort(abortReason);
            return Promise.resolve(result("ready"));
          }),
          graph: backend(() => {
            graphCalls += 1;
            return Promise.resolve(result("ready"));
          }),
        },
        signal: controller.signal,
      });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBe(abortReason);
    expect(graphCalls).toBe(0);
  });

  test("does not convert backend exceptions into a degraded or empty result", async () => {
    const backendFailure = new Error("hybrid backend failed");
    let caught: unknown;
    try {
      await runExistingLaneClosure({
        variant: frozenVariant({
          primary: { lane: "hybrid", retrieveLimit: 1, retainLimit: 1 },
          structuralLanes: [],
          git: { mode: "off" },
          outputLimit: 1,
        }),
        query: { inputs: { hybrid: { text: "failure" } } },
        backends: {
          hybrid: backend(() => Promise.reject(backendFailure)),
        },
        signal: signal(),
      });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBe(backendFailure);
  });

  test("requires one exact accounting record from every invoked backend", () => {
    const variant = frozenVariant({
      primary: { lane: "hybrid", retrieveLimit: 1, retainLimit: 1 },
      structuralLanes: [],
      git: { mode: "off" },
      outputLimit: 1,
    });
    const base = { status: "ready" as const, hits: [] };
    expect(runExistingLaneClosure({
      variant,
      query: { inputs: { hybrid: { text: "accounting" } } },
      backends: {
        hybrid: backend(() => Promise.resolve(base as unknown as ExistingLaneClosureLaneResult)),
      },
      signal: signal(),
    })).rejects.toThrow("accounting is required");

    const caseVariant = {
      LLM: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 0, inputTokens: 0, durationMs: 0 },
      packedContext: { utf8Bytes: 0, readerTokens: 0 },
      peakRssBytes: 0,
      cacheBytes: 0,
    };
    expect(runExistingLaneClosure({
      variant,
      query: { inputs: { hybrid: { text: "accounting" } } },
      backends: {
        hybrid: backend(() => Promise.resolve({
          ...base,
          accounting: caseVariant as unknown as ExistingLaneClosureAccounting,
        })),
      },
      signal: signal(),
    })).rejects.toThrow("unknown field LLM");

    const omittedCounter = {
      ...accounting(),
      llm: { calls: 0, outputTokens: 0 },
    };
    expect(runExistingLaneClosure({
      variant,
      query: { inputs: { hybrid: { text: "accounting" } } },
      backends: {
        hybrid: backend(() => Promise.resolve({
          ...base,
          accounting: omittedCounter as unknown as ExistingLaneClosureAccounting,
        })),
      },
      signal: signal(),
    })).rejects.toThrow("inputTokens is required");

    for (const embedding of [
      { calls: 1, inputTokens: 2, inputTokensMeasured: false, durationMs: 1 },
      { calls: 0, inputTokens: 0, inputTokensMeasured: false, durationMs: 0 },
      {
        calls: 0,
        inputTokens: 0,
        durationMs: 0,
        durationScope: "embedding-backed-search-upper-bound",
      },
    ]) {
      expect(runExistingLaneClosure({
        variant,
        query: { inputs: { hybrid: { text: "accounting" } } },
        backends: {
          hybrid: backend(() => Promise.resolve({
            ...base,
            accounting: { ...accounting(), embedding } as unknown as ExistingLaneClosureAccounting,
          })),
        },
        signal: signal(),
      })).rejects.toThrow(/explicit placeholder|exact unannotated zero record/u);
    }
  });

  test("propagates unavailable token counts and duration upper bounds through closure aggregation", async () => {
    const variant = frozenVariant({
      primary: { lane: "hybrid", retrieveLimit: 1, retainLimit: 1 },
      structuralLanes: [{ lane: "metadata", limit: 1 }],
      git: { mode: "off" },
      outputLimit: 1,
    });
    const closure = await runExistingLaneClosure({
      variant,
      query: {
        inputs: {
          hybrid: { text: "accounting" },
          metadata: { filters: [], tags: ["memory"] },
        },
      },
      backends: {
        hybrid: backend(() => Promise.resolve({
          status: "ready",
          hits: [],
          accounting: accounting({
            embeddingCalls: 1,
            embeddingInputTokensMeasured: false,
            embeddingDurationMs: 7,
            embeddingDurationScope: "embedding-backed-search-upper-bound",
          }),
        })),
        metadata: backend(() => Promise.resolve({
          status: "ready",
          hits: [],
          accounting: accounting(),
        })),
      },
      signal: signal(),
    });
    expect(closure.accounting.embedding).toEqual({
      calls: 1,
      inputTokens: 0,
      inputTokensMeasured: false,
      durationMs: 7,
      durationScope: "embedding-backed-search-upper-bound",
    });
  });

  test("deep-snapshots backend hits, evidence, diagnostics, and accounting", async () => {
    const documentId = "notes/mutable-backend";
    const boundLocator = locator("unit:mutable", documentId);
    const mutableLocator = {
      ...boundLocator,
      lineRange: { ...boundLocator.lineRange },
      headingPath: [...boundLocator.headingPath],
    };
    const mutableEvidence = { nested: { value: "before" } };
    const mutableUnits = [{ id: boundLocator.evidenceUnitId, locator: mutableLocator }];
    const mutableHit = {
      documentId,
      canonicalDocumentId: documentId,
      rank: 1,
      evidenceUnits: mutableUnits,
      evidence: mutableEvidence,
    };
    const mutableDetails = { phase: "before" };
    const mutableDiagnostics = [{
      code: "mutable-diagnostic",
      status: "ready" as const,
      details: mutableDetails,
    }];
    const mutableAccounting = {
      llm: { calls: 0 as const, inputTokens: 0 as const, outputTokens: 0 as const },
      embedding: { calls: 1, inputTokens: 2, durationMs: 3 },
      packedContext: { utf8Bytes: 4, readerTokens: 5 },
      peakRssBytes: 6,
      cacheBytes: 7,
    };
    const mutableResult = {
      status: "ready" as const,
      hits: [mutableHit],
      diagnostics: mutableDiagnostics,
      timings: { searchMs: 1 },
      resources: { resultCount: 1 },
      accounting: mutableAccounting,
    };
    const closure = await runExistingLaneClosure({
      variant: frozenVariant({
        primary: { lane: "hybrid", retrieveLimit: 1, retainLimit: 1 },
        structuralLanes: [],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      query: { inputs: { hybrid: { text: "mutable" } } },
      backends: {
        hybrid: backend(() => Promise.resolve(mutableResult)),
      },
      signal: signal(),
    });

    mutableHit.documentId = "notes/changed";
    mutableEvidence.nested.value = "after";
    mutableUnits.splice(0);
    mutableDetails.phase = "after";
    mutableAccounting.embedding.calls = 99;
    expect(closure.hits[0]).toMatchObject({
      documentId,
      evidence: { nested: { value: "before" } },
    });
    expect(closure.hits[0]?.evidenceUnits).toHaveLength(1);
    expect(closure.trace.lanes[0]?.candidates[0]?.evidence).toEqual({
      nested: { value: "before" },
    });
    expect(closure.trace.lanes[0]?.diagnostics[0]?.details).toEqual({ phase: "before" });
    expect(closure.accounting.embedding.calls).toBe(1);
    expect(Object.isFrozen(closure.hits[0])).toBe(true);
    expect(Object.isFrozen(closure.hits[0]?.evidence)).toBe(true);
    expect(Object.isFrozen((closure.hits[0]?.evidence as { nested: object }).nested)).toBe(true);
    expect(Object.isFrozen(closure.trace.lanes[0]?.candidates[0]?.evidence)).toBe(true);
    expect(Object.isFrozen((closure.trace.lanes[0]?.candidates[0]?.evidence as {
      nested: object;
    }).nested)).toBe(true);
    expect(Object.isFrozen(closure.hits[0]?.evidenceUnits?.[0]?.locator)).toBe(true);
  });

  test("produces byte-stable trace data across repeated deterministic execution", async () => {
    const stableHit = hit("notes/stable", 1);
    const stableDuplicate = hit(
      "aliases/stable",
      1,
      { canonicalDocumentId: "notes/stable" },
    );
    const variant = frozenVariant({
      primary: { lane: "hybrid", retrieveLimit: 2, retainLimit: 2 },
      structuralLanes: [{ lane: "graph", limit: 2 }],
      git: { mode: "off" },
      outputLimit: 2,
    });
    const request = {
      variant,
      query: {
        inputs: {
          hybrid: { text: "stable" },
          graph: { seeds: ["notes/stable"], depth: 1 as const },
        },
      },
      backends: {
        hybrid: backend(() => Promise.resolve(result("ready", [stableHit], {
          timings: { searchMs: 1 },
          resources: { embeddingCalls: 1 },
        }))),
        graph: backend(() => Promise.resolve(result("ready", [stableDuplicate]))),
      },
    };
    const first = await runExistingLaneClosure({ ...request, signal: signal() });
    const second = await runExistingLaneClosure({ ...request, signal: signal() });

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.trace)).toBe(true);
    expect(Object.isFrozen(first.trace.lanes)).toBe(true);
    expect(Object.isFrozen(first.trace.documents[0]?.sources)).toBe(true);
  });

  test("rejects nonzero child LLM accounting while keeping embedding costs independent", () => {
    expect(runExistingLaneClosure({
      variant: frozenVariant({
        primary: { lane: "hybrid", retrieveLimit: 1, retainLimit: 1 },
        structuralLanes: [],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      query: { inputs: { hybrid: { text: "cost" } } },
      backends: {
        hybrid: backend(() => Promise.resolve(result("ready", [], {
          accounting: {
            ...accounting({ embeddingCalls: 1 }),
            llm: { calls: 1, inputTokens: 0, outputTokens: 0 },
          } as unknown as ExistingLaneClosureAccounting,
        }))),
      },
      signal: signal(),
    })).rejects.toThrow("literal-zero");
  });
});

describe("existing-lane closure aggregate bounds", () => {
  test("rejects total candidate capacity before any backend work", () => {
    expect(MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES).toBe(4_096);
    expect(() => frozenVariant({
      primary: { lane: "hybrid", retrieveLimit: 1_000, retainLimit: 1_000 },
      structuralLanes: [
        { lane: "metadata", limit: 1_000 },
        { lane: "graph", limit: 1_000 },
        { lane: "path-context", limit: 1_000 },
      ],
      git: { mode: "explicit-input", limit: 1_000 },
      outputLimit: 1_000,
    })).toThrow(`exceeds ${MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES}`);
  });

  test("rejects aggregate evidence-unit references before selection", () => {
    const unitCount = MAX_EXISTING_LANE_CLOSURE_TOTAL_EVIDENCE_UNITS + 1;
    const unitsByDocument: ExistingLaneClosureHit[] = [];
    for (let offset = 0; offset < unitCount; offset += 100) {
      const documentId = `notes/evidence-cap-${offset / 100}`;
      const units = Array.from({ length: Math.min(100, unitCount - offset) }, (_, index) => {
        const value = locator(`unit:evidence-cap:${offset + index}`, documentId);
        return { id: value.evidenceUnitId, locator: value };
      });
      unitsByDocument.push({
        documentId,
        canonicalDocumentId: documentId,
        rank: unitsByDocument.length + 1,
        evidenceUnits: units,
      });
    }
    expect(runExistingLaneClosure({
      variant: frozenVariant({
        primary: null,
        structuralLanes: [{ lane: "metadata", limit: unitsByDocument.length }],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      query: { inputs: { metadata: { filters: [], tags: ["cap"] } } },
      backends: {
        metadata: backend(() => Promise.resolve(result("ready", unitsByDocument))),
      },
      signal: signal(),
    })).rejects.toThrow("aggregate evidence-unit bound");
  });

  test("rejects aggregate typed-locator bytes before selection", () => {
    const documentId = "notes/provenance-cap";
    const pathPayload = "x".repeat(Math.ceil(MAX_EXISTING_LANE_CLOSURE_PROVENANCE_BYTES / 100) + 300);
    const units = Array.from({ length: 100 }, (_, index) => {
      const value = locator(`unit:provenance-cap:${index}`, documentId, {
        sourcePath: `sources/${pathPayload}-${index}.md`,
      });
      return { id: value.evidenceUnitId, locator: value };
    });
    const provenanceHeavyHit: ExistingLaneClosureHit = {
      documentId,
      canonicalDocumentId: documentId,
      rank: 1,
      evidenceUnits: units,
    };
    expect(runExistingLaneClosure({
      variant: frozenVariant({
        primary: null,
        structuralLanes: [{ lane: "metadata", limit: 1 }],
        git: { mode: "off" },
        outputLimit: 1,
      }),
      query: { inputs: { metadata: { filters: [], tags: ["cap"] } } },
      backends: {
        metadata: backend(() => Promise.resolve(result("ready", [provenanceHeavyHit]))),
      },
      signal: signal(),
    })).rejects.toThrow("aggregate provenance-byte bound");
  });
});
