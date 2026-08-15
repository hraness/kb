import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  agentContextMarkerForScope,
  agentContextNoteId,
  agentContextNotePath,
} from "./agent-context.js";

import type {
  EvaluationRetriever,
  EvaluationRetrieverResult,
} from "./evaluation.js";
import { buildEvaluationEvidenceRegistry } from "./evaluation-evidence.js";
import {
  evaluationImplementationArtifactSha256V2,
  verifyEvaluationImplementationArtifactV2,
  type EvaluationImplementationSourceV2,
  type VerifiedEvaluationImplementationArtifactV2,
} from "./evaluation-implementation.js";
import type { ExistingLaneClosureVariant } from "./evaluation-kb-closure.js";
import type {
  KnowledgeBaseEvaluation,
  KnowledgeBaseEvaluationRetrieverId,
} from "./evaluation-kb.js";
import type {
  GitCommandProvider,
  GitHistoryIndex,
} from "./git.js";
import {
  adaptVerifiedKnowledgeBaseEvaluationV2,
  createKnowledgeBaseEvaluationLaneDescriptorsV2,
  createKnowledgeBaseEvaluationRepeatedSampleV2,
  createKnowledgeBaseExistingLaneClosureDescriptorV2,
  knowledgeBaseExistingLaneClosureVariantsV2,
  openKnowledgeBaseEvaluationV2,
  type KnowledgeBaseEvaluationAccountingProviderV2,
  type KnowledgeBaseEvaluationLaneDescriptorsV2,
} from "./evaluation-kb-v2.js";
import {
  evaluationRetrieverDescriptorDigestV2,
  type EvaluationExecutionRequestV2,
  type EvaluationRetrieverDescriptorV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

const frozen = Object.freeze({
  repositoryCommit: "a".repeat(40),
  vaultTree: "b".repeat(40),
  vaultRoot: "kb",
});
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

const lanes = [
  "exact",
  "keyword",
  "semantic",
  "hybrid",
  "metadata",
  "graph",
  "path-context",
  "git",
] as const;

const evidenceDocumentIds = [
  "notes/a",
  "notes/b",
  "notes/c",
  "notes/d",
  "notes/e",
  "notes/g",
  "notes/live-result",
] as const;

const evidenceRegistry = buildEvaluationEvidenceRegistry({
  documents: evidenceDocumentIds.map((documentId) => ({
    documentId,
    sourcePath: `${documentId}.md`,
    trustClass: "authoritative-current",
    markdown: [
      `# ${documentId === "notes/live-result" ? "Live result" : documentId.slice("notes/".length).toUpperCase()}`,
      "",
      "First live evidence unit.",
      "",
      "Second live evidence unit.",
      "",
      "Third live evidence unit.",
      "",
      "Fourth live evidence unit.",
      "",
    ].join("\n"),
  })),
});

const accounting: KnowledgeBaseEvaluationAccountingProviderV2 = ({ lane, timings, resources }) => {
  const usesEmbedding = lane === "semantic" || lane === "hybrid";
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: usesEmbedding
      ? Object.freeze({
          calls: resources.embeddingCalls ?? 0,
          inputTokens: resources.embeddingInputTokens ?? 0,
          durationMs: timings.embeddingMs ?? 0,
        })
      : Object.freeze({ calls: 0, inputTokens: 0, durationMs: 0 }),
    packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
    peakRssBytes: resources.peakRssBytes ?? 0,
    cacheBytes: resources.cacheBytes ?? 0,
  });
};

function implementationSources(
  retrieverId: string,
): readonly EvaluationImplementationSourceV2[] {
  return Object.freeze([Object.freeze({
    sourcePath: `src/fixtures/${retrieverId}.ts`,
    bytes: Buffer.from(`export const retrieverId = ${JSON.stringify(retrieverId)};\n`, "utf8"),
  })]);
}

function implementationSha256(retrieverId: string): string {
  return evaluationImplementationArtifactSha256V2(implementationSources(retrieverId));
}

function laneDescriptors(limit = 10): KnowledgeBaseEvaluationLaneDescriptorsV2 {
  return createKnowledgeBaseEvaluationLaneDescriptorsV2(Object.fromEntries(
    lanes.map((lane) => [lane, {
      id: lane,
      role: lane === "hybrid" ? "baseline" : "ablation",
      version: `fixture-${lane}-v1`,
      implementationSha256: implementationSha256(lane),
      retrieveLimit: limit,
    }]),
  ) as Parameters<typeof createKnowledgeBaseEvaluationLaneDescriptorsV2>[0]);
}

function closureDescriptor(
  variant: ExistingLaneClosureVariant = knowledgeBaseExistingLaneClosureVariantsV2["structural-git-closure"],
) {
  return createKnowledgeBaseExistingLaneClosureDescriptorV2({
    id: "existing-lane-closure",
    role: "candidate",
    version: "fixture-existing-lane-closure-v1",
    implementationSha256: implementationSha256("existing-lane-closure"),
    variant,
  });
}

function corpusFor(
  descriptors: KnowledgeBaseEvaluationLaneDescriptorsV2,
  closure?: ReturnType<typeof closureDescriptor>,
  registry = evidenceRegistry,
): RetrievalEvaluationCorpusV2 {
  const retrievers = [
    ...Object.values(descriptors),
    ...(closure === undefined ? [] : [closure.descriptor]),
  ];
  return {
    manifest: {
      protocol: "kb-retrieval-evaluation-v2",
      sealedAt: "2026-08-01T00:00:00.000Z",
      corpusSha256: "a".repeat(64),
      candidateLockSha256: "b".repeat(64),
      buildContractSha256: "c".repeat(64),
    },
    frozen,
    sourceFamilies: [{
      id: "sf-0000000000000001",
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    }],
    documents: registry.documents.map((document) => ({
      id: document.documentId,
      sourceFamilyId: "sf-0000000000000001",
      trustClass: "authoritative-current",
    })),
    evidenceUnits: registry.units.map((unit) => ({
      id: unit.id,
      documentId: unit.documentId,
      sourceFamilyId: "sf-0000000000000001",
      trustClass: "authoritative-current",
      sourcePath: unit.sourcePath,
      lineRange: unit.lineRange,
      headingPath: unit.headingAncestry,
      ...(unit.pdfPage === undefined ? {} : { sourcePage: unit.pdfPage }),
    })),
    retrievers,
    candidateLock: {
      baselineRetrieverId: "hybrid",
      candidateRetrieverIds: closure === undefined ? [] : [closure.descriptor.id],
      descriptorDigests: retrievers.map((descriptor) => ({
        retrieverId: descriptor.id,
        sha256: evaluationRetrieverDescriptorDigestV2(descriptor),
      })),
    },
  } as unknown as RetrievalEvaluationCorpusV2;
}

function implementationArtifactsFor(
  corpus: RetrievalEvaluationCorpusV2,
): readonly VerifiedEvaluationImplementationArtifactV2[] {
  return Object.freeze(corpus.retrievers.map((descriptor) =>
    verifyEvaluationImplementationArtifactV2({
      corpus,
      descriptor,
      loadedRepositoryCommit: frozen.repositoryCommit,
      sources: implementationSources(descriptor.id),
    })));
}

function adapterRequirementsFor(
  corpus: RetrievalEvaluationCorpusV2,
  registry = evidenceRegistry,
) {
  return Object.freeze({
    evidenceRegistry: registry,
    accounting,
    implementationArtifacts: implementationArtifactsFor(corpus),
  });
}

const snapshotGit: GitCommandProvider = ({ arguments: args }) => {
  if (args[0] === "rev-parse" && args[1] === "--show-prefix") {
    return Promise.resolve({ status: "ok", stdout: "\n" });
  }
  if (args[0] === "rev-parse" && args[2] === "HEAD") {
    return Promise.resolve({ status: "ok", stdout: `${frozen.repositoryCommit}\n` });
  }
  if (args[0] === "rev-parse") {
    return Promise.resolve({ status: "ok", stdout: `${frozen.vaultTree}\n` });
  }
  if (args[0] === "cat-file") return Promise.resolve({ status: "ok", stdout: "tree\n" });
  if (args[0] === "status") return Promise.resolve({ status: "ok", stdout: "" });
  return Promise.resolve({ status: "failed", message: `Unexpected Git argv: ${args.join(" ")}` });
};

function evidenceAt(
  corpus: RetrievalEvaluationCorpusV2,
  documentId: string,
  line: number,
): RetrievalEvaluationCorpusV2["evidenceUnits"][number] {
  const unit = corpus.evidenceUnits
    .filter((candidate) =>
      candidate.documentId === documentId
      && candidate.lineRange.start <= line
      && candidate.lineRange.end >= line)
    .toSorted((left, right) =>
      (left.lineRange.end - left.lineRange.start) - (right.lineRange.end - right.lineRange.start))[0];
  if (unit === undefined) throw new Error(`missing evidence fixture for ${documentId}:${line}`);
  return unit;
}

function request(
  inputs: EvaluationExecutionRequestV2["query"]["inputs"],
  limit = 10,
  signal = new AbortController().signal,
): EvaluationExecutionRequestV2 {
  return Object.freeze({
    corpus: frozen,
    query: Object.freeze({ inputs: Object.freeze(inputs) }),
    limit,
    signal,
  });
}

type LaneImplementation = (
  request: Parameters<EvaluationRetriever["retrieve"]>[0],
) => Promise<EvaluationRetrieverResult> | EvaluationRetrieverResult;

function poisonWasInstalled(query: object): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(query, "qrels");
  if (descriptor?.get === undefined) return false;
  try {
    descriptor.get.call(query);
    return false;
  } catch (error) {
    return error instanceof Error && error.message.includes("forbidden query field qrels");
  }
}

function evaluationWith(
  implementations: Partial<Record<KnowledgeBaseEvaluationRetrieverId, LaneImplementation>>,
): KnowledgeBaseEvaluation {
  return Object.freeze({
    retrievers: Object.freeze(lanes.map((id): EvaluationRetriever => Object.freeze({
      id,
      retrieve: async (laneRequest) => {
        expect(Object.keys(laneRequest.query)).toEqual(["inputs"]);
        expect(poisonWasInstalled(laneRequest.query)).toBe(true);
        const implementation = implementations[id];
        if (implementation !== undefined) return await implementation(laneRequest);
        return Object.freeze({
          status: "unavailable" as const,
          hits: Object.freeze([]),
          diagnostics: Object.freeze([{ lane: id, status: "unavailable" as const }]),
          timings: Object.freeze({}),
          resources: Object.freeze({}),
        });
      },
    }))),
    close: () => Promise.resolve(),
  });
}

function ready(
  hits: EvaluationRetrieverResult["hits"],
  options: {
    readonly status?: EvaluationRetrieverResult["status"];
    readonly diagnostics?: EvaluationRetrieverResult["diagnostics"];
    readonly timings?: EvaluationRetrieverResult["timings"];
    readonly resources?: EvaluationRetrieverResult["resources"];
  } = {},
): EvaluationRetrieverResult {
  return Object.freeze({
    status: options.status ?? "ready",
    hits: Object.freeze(hits),
    diagnostics: Object.freeze(options.diagnostics ?? []),
    timings: Object.freeze(options.timings ?? {}),
    resources: Object.freeze(options.resources ?? {}),
  });
}

function lineEvidence(documentId: string, line: number): Readonly<Record<string, unknown>> {
  return Object.freeze({
    path: `${documentId}.md`,
    line,
    provenance: Object.freeze([Object.freeze({
      targetDocumentId: documentId,
      evidenceDocumentId: documentId,
      sourcePath: `${documentId}.md`,
      locator: Object.freeze({ kind: "line", line }),
    })]),
  });
}

async function productionBridgeFixture(): Promise<Readonly<{
  readonly repository: string;
  readonly root: string;
  readonly contextId: string;
  readonly registry: ReturnType<typeof buildEvaluationEvidenceRegistry>;
}>> {
  const repository = await mkdtemp(join(tmpdir(), "hraness-kb-v2-production-bridge-"));
  temporaryRoots.push(repository);
  const root = join(repository, "kb");
  await mkdir(join(root, "notes"), { recursive: true });
  await mkdir(join(root, "scopes"), { recursive: true });
  await mkdir(join(repository, "src"), { recursive: true });
  await writeFile(join(repository, "src", "file.ts"), "export const value = 1;\n", "utf8");
  await writeFile(
    join(repository, "src", "AGENTS.md"),
    `${agentContextMarkerForScope("src")}\n# Contents\n\n# Guidelines\n`,
    "utf8",
  );
  await writeFile(join(root, "index.md"), "# Evaluation vault\n", "utf8");

  const contextId = agentContextNoteId("src");
  const contextPath = agentContextNotePath("src");
  const markdownByPath = new Map<string, string>([
    ["notes/graph-source.md", "# Graph source\n\n[[notes/graph-target]]\n"],
    ["notes/graph-target.md", "# Graph target\n\nTarget-owned body.\n"],
    ["notes/direct-history.md", "# Direct history\n\nCurrent note text.\n"],
    ["notes/searched-history.md", "# Searched history\n\nCurrent note text.\n"],
    ["notes/alias-only.md", [
      "---",
      "aliases: [ALIAS_ONLY_TOKEN]",
      "---",
      "Body without the alias token.",
      "",
    ].join("\n")],
    ["notes/path-only-token.md", "Body without the path identity.\n"],
    ["notes/metadata-conjunction.md", [
      "---",
      "type: note",
      "status: selected",
      "tags: [coverage]",
      "---",
      "# Metadata conjunction",
      "",
    ].join("\n")],
    ["notes/file-memory.md", [
      "---",
      "type: note",
      "repository_scopes: [src/file.ts]",
      "---",
      "# File memory",
      "",
      "Exact file-owned memory.",
      "",
    ].join("\n")],
    [contextPath, [
      "---",
      "type: agent-context",
      "scope: src",
      "---",
      "# Source context",
      "",
    ].join("\n")],
  ]);
  await Promise.all([...markdownByPath].map(([path, markdown]) =>
    writeFile(join(root, path), markdown, "utf8")));
  const registry = buildEvaluationEvidenceRegistry({
    documents: [...markdownByPath].map(([sourcePath, markdown]) => ({
      documentId: sourcePath.replace(/\.md$/u, ""),
      sourcePath,
      trustClass: "authoritative-current",
      markdown,
    })),
  });
  return Object.freeze({ repository, root, contextId, registry });
}

function rejectionFrom(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected promise to reject.");
    },
    (error: unknown) => error,
  );
}

describe("knowledge-base evaluation v2 descriptors", () => {
  test("freezes all eight authored descriptors and binds every lane limit and order", () => {
    const descriptors = laneDescriptors(17);
    expect(Object.keys(descriptors)).toEqual([...lanes]);
    expect(Object.isFrozen(descriptors)).toBe(true);
    expect(descriptors.exact).toMatchObject({
      version: "fixture-exact-v1",
      lanes: ["exact"],
      configuration: {
        "lane-order": 1,
        "retrieve-limit": 17,
        "result-order": "raw-rank-ascending",
        "generative-llm-call-limit": 0,
      },
    });
    expect(descriptors.git.configuration["lane-order"]).toBe(8);
    expect(Object.isFrozen(descriptors.git.configuration)).toBe(true);
  });

  test("exposes deeply frozen closure ablations and binds their budgets and execution order", () => {
    const variant = knowledgeBaseExistingLaneClosureVariantsV2["structural-git-closure"];
    expect(Object.isFrozen(variant)).toBe(true);
    expect(Object.isFrozen(variant.structuralLanes)).toBe(true);
    const pair = closureDescriptor(variant);
    expect(pair.descriptor.lanes).toEqual([
      "git",
      "graph",
      "hybrid",
      "metadata",
      "path-context",
    ]);
    expect(pair.descriptor.configuration).toMatchObject({
      "execution-order": "hybrid,metadata,graph,path-context,git",
      "fusion-rule": "primary-prefix-then-round-robin-v1",
      "primary-retrieve-limit": 10,
      "primary-retain-limit": 5,
      "metadata-order": 1,
      "graph-order": 2,
      "path-context-order": 3,
      "git-mode": "explicit-input",
      "git-limit": 10,
      "output-limit": 10,
      "result-order": "primary-prefix-then-declared-lane-round-robin-by-source-rank",
    });
    expect(Object.entries(knowledgeBaseExistingLaneClosureVariantsV2).map(([id, candidate]) => [
      id,
      closureDescriptor(candidate).descriptor.lanes,
    ])).toEqual([
      ["primary-only", ["hybrid"]],
      ["metadata-closure", ["hybrid", "metadata"]],
      ["graph-closure", ["graph", "hybrid"]],
      ["path-context-closure", ["hybrid", "path-context"]],
      ["structural-closure", ["graph", "hybrid", "metadata", "path-context"]],
      ["structural-git-closure", ["git", "graph", "hybrid", "metadata", "path-context"]],
      ["structural-only", ["graph", "metadata", "path-context"]],
    ]);
  });

  test("rejects descriptor drift after the candidate lock", () => {
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors);
    const changedExact: EvaluationRetrieverDescriptorV2 = {
      ...descriptors.exact,
      configuration: {
        ...descriptors.exact.configuration,
        "retrieve-limit": 9,
      },
    };
    expect(() => adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      evaluation: evaluationWith({}),
      laneDescriptors: { ...descriptors, exact: changedExact },
    })).toThrow("not committed");
  });

  test("requires exactly one branded implementation artifact for every configured descriptor", () => {
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors);
    const artifacts = implementationArtifactsFor(corpus);
    const options = {
      evidenceRegistry,
      accounting,
      corpus,
      laneDescriptors: descriptors,
      evaluation: evaluationWith({}),
    };

    expect(() => adaptVerifiedKnowledgeBaseEvaluationV2({
      ...options,
      implementationArtifacts: undefined as never,
    })).toThrow("exact one-per-descriptor array");
    expect(() => adaptVerifiedKnowledgeBaseEvaluationV2({
      ...options,
      implementationArtifacts: artifacts.slice(0, -1),
    })).toThrow("Implementation artifact for retriever git is missing");
    expect(() => adaptVerifiedKnowledgeBaseEvaluationV2({
      ...options,
      implementationArtifacts: [...artifacts, artifacts[0] as VerifiedEvaluationImplementationArtifactV2],
    })).toThrow("Implementation artifact for retriever exact is duplicated");

    const closure = closureDescriptor();
    const corpusWithExtraDescriptor = corpusFor(descriptors, closure);
    expect(() => adaptVerifiedKnowledgeBaseEvaluationV2({
      ...options,
      corpus: corpusWithExtraDescriptor,
      implementationArtifacts: implementationArtifactsFor(corpusWithExtraDescriptor),
    })).toThrow("Implementation artifact for retriever existing-lane-closure is extra");

    const exact = artifacts[0] as VerifiedEvaluationImplementationArtifactV2;
    const forged = Object.freeze({
      retrieverId: exact.retrieverId,
      repositoryCommit: exact.repositoryCommit,
      implementationSha256: exact.implementationSha256,
      sourcePaths: exact.sourcePaths,
    }) as VerifiedEvaluationImplementationArtifactV2;
    expect(() => adaptVerifiedKnowledgeBaseEvaluationV2({
      ...options,
      implementationArtifacts: [forged, ...artifacts.slice(1)],
    })).toThrow("lacks a verified frozen implementation artifact");
  });
});

describe("knowledge-base evaluation v2 legacy lane adapter", () => {
  test("runs single and closure retrieval from a least-authority contract after the private corpus is revoked", async () => {
    const descriptors = laneDescriptors();
    const closure = closureDescriptor(knowledgeBaseExistingLaneClosureVariantsV2["primary-only"]);
    const corpus = corpusFor(descriptors, closure);
    let privateReads = 0;
    const guarded: RetrievalEvaluationCorpusV2 = { ...corpus };
    Object.defineProperties(guarded, {
      assessment: {
        configurable: true,
        get(): never {
          privateReads += 1;
          throw new Error("retrieval attempted to read private assessment labels");
        },
      },
      queries: {
        configurable: true,
        get(): never {
          privateReads += 1;
          throw new Error("retrieval attempted to read private query gold judgments");
        },
      },
    });
    const revocable = Proxy.revocable(guarded, {});
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus: revocable.proxy,
      laneDescriptors: descriptors,
      closureDescriptors: [closure],
      evaluation: evaluationWith({
        exact: () => ready([{
          documentId: "notes/a",
          rank: 1,
          evidence: lineEvidence("notes/a", 3),
        }]),
        hybrid: () => ready([{
          documentId: "notes/a",
          rank: 1,
          evidence: lineEvidence("notes/a", 3),
        }]),
      }),
    });
    expect(privateReads).toBe(0);
    revocable.revoke();

    const exact = adapted.retrievers.find(({ descriptor }) => descriptor.id === "exact");
    const closureRetriever = adapted.retrievers.find(({ descriptor }) =>
      descriptor.id === closure.descriptor.id);
    if (exact === undefined || closureRetriever === undefined) {
      throw new Error("missing least-authority adapter retriever");
    }
    expect(exact.descriptor).not.toBe(descriptors.exact);
    expect(Object.isFrozen(exact.descriptor)).toBe(true);
    expect(Object.isFrozen(exact.descriptor.configuration)).toBe(true);
    expect((await exact.retrieve(request({ text: "least authority" }))).candidates).toHaveLength(1);
    expect((await closureRetriever.retrieve(request({ text: "least authority" }))).candidates)
      .toHaveLength(1);
    expect(privateReads).toBe(0);
  });

  test("binds frozen corpus evidence to the exact live registry unit identity", () => {
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors);
    const driftedRegistry = buildEvaluationEvidenceRegistry({
      documents: evidenceRegistry.documents.map((document) => ({
        documentId: document.documentId,
        sourcePath: document.sourcePath,
        trustClass: document.trustClass,
        markdown: document.documentId === "notes/a"
          ? document.markdown.replace("First live evidence unit.", "Drift live evidence unit.")
          : document.markdown,
      })),
    });

    expect(() => adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      evidenceRegistry: driftedRegistry,
      corpus,
      laneDescriptors: descriptors,
      evaluation: evaluationWith({}),
    })).toThrow("does not preserve an exact live registry unit identity");
  });

  test("does not invoke a structured lane when its executable input is absent", async () => {
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors);
    let metadataCalls = 0;
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      evaluation: evaluationWith({
        metadata: () => {
          metadataCalls += 1;
          return ready([]);
        },
      }),
    });
    const metadata = adapted.retrievers.find(({ descriptor }) => descriptor.id === "metadata");
    if (metadata === undefined) throw new Error("missing metadata adapter");

    const result = await metadata.retrieve(request({ text: "No metadata input" }));

    expect(metadataCalls).toBe(0);
    expect(result.status).toBe("unavailable");
    expect(result.resources).toEqual({
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 0, inputTokens: 0, durationMs: 0 },
      packedContext: { utf8Bytes: 0, readerTokens: 0 },
      peakRssBytes: 0,
      cacheBytes: 0,
    });
    expect(result.trace.laneOutcomes).toEqual([{
      laneId: "metadata",
      applicability: "skipped",
      status: "unavailable",
      reasonCodes: ["missing-input"],
      rawRanking: [],
    }]);
  });

  test("passes only the lane input through poison getters and derives provenance from live evidence", async () => {
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors);
    const seenInputs: unknown[] = [];
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      evaluation: evaluationWith({
        exact: ({ query }) => {
          seenInputs.push(query.inputs);
          return ready([{
            documentId: "notes/live-result",
            rank: 1,
            score: 0.75,
            evidence: {
              path: "notes/live-result.md",
              line: 7,
              headingPath: ["Live result"],
              provenance: [{
                targetDocumentId: "notes/live-result",
                evidenceDocumentId: "notes/live-result",
                sourcePath: "notes/live-result.md",
                locator: { kind: "line", line: 7 },
              }],
            },
          }], {
            timings: { embeddingMs: 2.5, searchMs: 4 },
            resources: {
              embeddingCalls: 1,
              embeddingInputTokens: 12,
              peakRssBytes: 1_024,
              cacheBytes: 128,
            },
          });
        },
      }),
      now: (() => {
        let value = 100;
        return () => value += 5;
      })(),
    });
    const exact = adapted.retrievers.find(({ descriptor }) => descriptor.id === "exact");
    if (exact === undefined) throw new Error("missing exact adapter");
    const result = await exact.retrieve(request({
      text: "Only executable text",
      graph: { seeds: ["notes/oracle-seed"], depth: 1 },
      history: { query: "forbidden seed", noteIds: ["notes/oracle-seed"] },
    }));
    const unit = evidenceAt(corpus, "notes/live-result", 7);

    expect(seenInputs).toEqual([{ text: "Only executable text" }]);
    expect(result.candidates).toEqual([{
      documentId: "notes/live-result",
      evidenceUnitIds: [unit.id],
      rank: 1,
      score: 0.75,
      provenance: [{
        evidenceUnitId: unit.id,
        sourceFamilyId: unit.sourceFamilyId,
        sourceClass: "authored-note",
        trustClass: "authoritative-current",
        sourcePath: unit.sourcePath,
        lineRange: unit.lineRange,
        headingPath: unit.headingPath,
      }],
    }]);
    expect(result.trace.candidateDecisions[0]).toMatchObject({
      documentId: "notes/live-result",
      sourceRank: 1,
      disposition: "accepted",
      reasonCodes: ["primary"],
      outputRank: 1,
    });
    expect(result.resources).toEqual({
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 0, inputTokens: 0, durationMs: 0 },
      packedContext: { utf8Bytes: 0, readerTokens: 0 },
      peakRssBytes: 1_024,
      cacheBytes: 128,
    });
    expect(result.rawEvidence[0]?.evidence).toMatchObject({ path: "notes/live-result.md" });
  });

  test("does not synthesize document anchors or mine unrelated nested locators", async () => {
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors);
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      evaluation: evaluationWith({
        exact: () => ready([{
          documentId: "notes/a",
          rank: 1,
          evidence: { path: "notes/a.md" },
        }]),
        keyword: () => ready([{
          documentId: "notes/a",
          rank: 1,
          evidence: {
            path: "notes/a.md",
            locations: [{ line: 3 }, { line: 5 }],
          },
        }]),
      }),
    });
    const exact = adapted.retrievers.find(({ descriptor }) => descriptor.id === "exact");
    const keyword = adapted.retrievers.find(({ descriptor }) => descriptor.id === "keyword");
    if (exact === undefined || keyword === undefined) throw new Error("missing adapter");

    const result = await exact.retrieve(request({ text: "ambiguous provenance" }));
    expect(result.status).toBe("degraded");
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics).toContainEqual({
      code: "missing-provenance",
      lane: "exact",
      status: "degraded",
      message: "1 exact hit(s) lacked a lane-associated frozen source slice.",
    });
    expect(result.trace.laneOutcomes[0]?.rawRanking).toEqual([{
      documentId: "notes/a",
      evidenceUnitIds: [],
      rank: 1,
      provenance: [],
    }]);
    expect(result.trace.candidateDecisions[0]).toMatchObject({
      documentId: "notes/a",
      sourceRank: 1,
      disposition: "excluded",
      reasonCodes: ["missing-provenance"],
    });

    const nested = await keyword.retrieve(request({ text: "ambiguous locators" }));
    expect(nested.status).toBe("degraded");
    expect(nested.candidates).toEqual([]);
    expect(nested.trace.candidateDecisions[0]).toMatchObject({
      sourceRank: 1,
      disposition: "excluded",
      reasonCodes: ["missing-provenance"],
    });

    const missing = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      evaluation: evaluationWith({
        exact: () => ready([{
          documentId: "notes/not-cataloged",
          rank: 1,
          evidence: { path: "notes/not-cataloged.md" },
        }]),
      }),
    }).retrievers.find(({ descriptor }) => descriptor.id === "exact");
    if (missing === undefined) throw new Error("missing exact adapter");
    const unbound = await missing.retrieve(request({ text: "unbound document" }));
    expect(unbound.status).toBe("degraded");
    expect(unbound.candidates).toEqual([]);
    expect(unbound.trace.candidateDecisions[0]).toMatchObject({
      documentId: "notes/not-cataloged",
      disposition: "excluded",
      reasonCodes: ["missing-provenance"],
    });
  });

  test("binds real graph and path-context evidence while keeping Git document-level", async () => {
    const fixture = await productionBridgeFixture();
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors, undefined, fixture.registry);
    const evaluation = await openKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus, fixture.registry),
      corpus,
      laneDescriptors: descriptors,
      repository: fixture.repository,
      root: fixture.root,
      runGit: snapshotGit,
      indexGitHistory: (options): Promise<GitHistoryIndex> => Promise.resolve({
        status: "ready",
        repository: fixture.repository,
        root: fixture.root,
        vaultPrefix: "kb",
        head: frozen.repositoryCommit,
        scannedCommits: 2,
        notes: options.notes.flatMap((note) => {
          if (note.id !== "notes/direct-history" && note.id !== "notes/searched-history") {
            return [];
          }
          return [{
            id: note.id,
            path: note.path,
            repositoryPath: `kb/${note.path}`,
            commits: [{
              hash: note.id === "notes/direct-history" ? "c".repeat(40) : "d".repeat(40),
              committedAt: "2026-08-01T12:00:00.000Z",
              subject: `historical-target ${note.id}`,
              changedPaths: [`kb/${note.path}`, "src/file.ts"],
            }],
          }];
        }),
      }),
    });
    const exactRetriever = evaluation.retrievers.find(({ descriptor }) =>
      descriptor.id === "exact");
    const metadataRetriever = evaluation.retrievers.find(({ descriptor }) =>
      descriptor.id === "metadata");
    const graphRetriever = evaluation.retrievers.find(({ descriptor }) =>
      descriptor.id === "graph");
    const pathRetriever = evaluation.retrievers.find(({ descriptor }) =>
      descriptor.id === "path-context");
    const gitRetriever = evaluation.retrievers.find(({ descriptor }) =>
      descriptor.id === "git");
    if (
      exactRetriever === undefined
      || metadataRetriever === undefined
      || graphRetriever === undefined
      || pathRetriever === undefined
      || gitRetriever === undefined
    ) {
      throw new Error("missing production bridge retriever");
    }

    const alias = await exactRetriever.retrieve(request({ text: "ALIAS_ONLY_TOKEN" }));
    const aliasUnit = fixture.registry.units.find((unit) =>
      unit.documentId === "notes/alias-only" && unit.frontmatterField === "aliases");
    if (aliasUnit === undefined) throw new Error("missing alias evidence fixture");
    expect(alias.candidates).toMatchObject([{
      documentId: "notes/alias-only",
      evidenceUnitIds: [aliasUnit.id],
      provenance: [{ sourcePath: "notes/alias-only.md" }],
    }]);

    const pathOnly = await exactRetriever.retrieve(request({ text: "notes/path-only-token" }));
    expect(pathOnly.status).toBe("degraded");
    expect(pathOnly.candidates).toEqual([]);
    expect(pathOnly.trace.candidateDecisions[0]).toMatchObject({
      documentId: "notes/path-only-token",
      disposition: "excluded",
      reasonCodes: ["missing-provenance"],
    });

    const metadata = await metadataRetriever.retrieve(request({
      text: "unused metadata text",
      metadata: {
        filters: [
          { kind: "equals", path: "status", value: "selected" },
          { kind: "equals", path: "type", value: "note" },
        ],
        tags: ["coverage"],
      },
    }));
    const metadataUnitIds = fixture.registry.units.filter((unit) =>
      unit.documentId === "notes/metadata-conjunction"
      && ["status", "tags", "type"].includes(unit.frontmatterField ?? ""))
      .map(({ id }) => id).toSorted();
    expect(metadataUnitIds).toHaveLength(3);
    expect(metadata.candidates).toMatchObject([{
      documentId: "notes/metadata-conjunction",
      evidenceUnitIds: metadataUnitIds,
    }]);
    expect(metadata.candidates[0]?.provenance.map(({ sourcePath }) => sourcePath)).toEqual([
      "notes/metadata-conjunction.md",
      "notes/metadata-conjunction.md",
      "notes/metadata-conjunction.md",
    ]);

    const graph = await graphRetriever.retrieve(request({
      text: "unused graph text",
      graph: { seeds: ["notes/graph-source"], depth: 1 },
    }));
    const authoredLink = evidenceAt(corpus, "notes/graph-source", 3);
    const graphTarget = graph.candidates.find(({ documentId }) =>
      documentId === "notes/graph-target");
    expect(graphTarget).toMatchObject({
      documentId: "notes/graph-target",
      evidenceUnitIds: [authoredLink.id],
      provenance: [{
        evidenceUnitId: authoredLink.id,
        sourcePath: "notes/graph-source.md",
        lineRange: { start: 3, end: 3 },
      }],
    });
    expect(graphTarget?.provenance[0]?.sourcePath).not.toBe("notes/graph-target.md");
    expect(graph.rawEvidence.find(({ documentId }) =>
      documentId === "notes/graph-target")?.evidence).toMatchObject({
      neighborhoods: [{
        connections: [{
          kind: "link",
          edge: {
            source: "notes/graph-source.md",
            target: "notes/graph-target.md",
            line: 3,
          },
        }],
      }],
    });

    const pathContext = await pathRetriever.retrieve(request({
      text: "unused path text",
      context: { repositoryPath: "src/file.ts" },
    }));
    const scopeUnit = fixture.registry.units.find((unit) =>
      unit.documentId === fixture.contextId && unit.frontmatterField === "scope");
    const repositoryScopesUnit = fixture.registry.units.find((unit) =>
      unit.documentId === "notes/file-memory" && unit.frontmatterField === "repository_scopes");
    if (scopeUnit === undefined || repositoryScopesUnit === undefined) {
      throw new Error("missing frontmatter evidence fixture");
    }
    expect(pathContext.candidates.map(({ documentId, evidenceUnitIds }) => ({
      documentId,
      evidenceUnitIds,
    }))).toEqual([
      { documentId: fixture.contextId, evidenceUnitIds: [scopeUnit.id] },
      { documentId: "notes/file-memory", evidenceUnitIds: [repositoryScopesUnit.id] },
    ]);
    expect(pathContext.candidates.every(({ provenance }) =>
      provenance.every(({ lineRange }) => lineRange.start >= 1))).toBe(true);

    const history = await gitRetriever.retrieve(request({
      text: "unused Git text",
      history: {
        query: "historical-target",
        noteIds: ["notes/direct-history"],
      },
    }));
    expect(history.status).toBe("degraded");
    expect(history.candidates).toEqual([]);
    expect(history.trace.laneOutcomes[0]?.rawRanking.map((candidate) => ({
      documentId: candidate.documentId,
      rank: candidate.rank,
      evidenceUnitIds: candidate.evidenceUnitIds,
    }))).toEqual([
      { documentId: "notes/direct-history", rank: 1, evidenceUnitIds: [] },
      { documentId: "notes/searched-history", rank: 2, evidenceUnitIds: [] },
    ]);
    expect(history.trace.candidateDecisions.every((decision) =>
      decision.disposition === "excluded"
      && decision.reasonCodes[0] === "missing-provenance")).toBe(true);
    expect(history.diagnostics).toContainEqual({
      code: "missing-provenance",
      lane: "git",
      status: "degraded",
      message: "2 git hit(s) lacked a lane-associated frozen source slice.",
    });
    await evaluation.close();
  });

  test("the private bridge poisons labels, qrels, judgments, and assessment fields", async () => {
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors);
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      evaluation: evaluationWith({
        exact: ({ query }) => {
          void query.qrels;
          return ready([]);
        },
      }),
    });
    const exact = adapted.retrievers.find(({ descriptor }) => descriptor.id === "exact");
    if (exact === undefined) throw new Error("missing exact adapter");
    const failure = await rejectionFrom(exact.retrieve(request({ text: "poison" })));
    expect(failure).toBeInstanceOf(Error);
    if (failure instanceof Error) {
      expect(failure.message).toContain("forbidden query field qrels");
    }
  });

  test("opens through a snapshot-only legacy corpus bridge and closes on adapter rejection", async () => {
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors);
    let closed = 0;
    let sawSnapshot = false;
    const evaluation = evaluationWith({});
    const failure = await rejectionFrom(openKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      repository: "/fixture/repository",
      root: "/fixture/repository/kb",
      openEvaluation: (options) => {
        sawSnapshot = options.corpus.frozen === frozen;
        expect(() => options.corpus.queries).toThrow("forbidden corpus field queries");
        return Promise.resolve({
          ...evaluation,
          retrievers: evaluation.retrievers.slice(0, 7),
          close: () => {
            closed += 1;
            return Promise.resolve();
          },
        });
      },
    }));
    expect(failure).toBeInstanceOf(Error);
    if (failure instanceof Error) expect(failure.message).toContain("all eight");
    expect(sawSnapshot).toBe(true);
    expect(closed).toBe(1);
  });

  test("preserves aborts and rejects nonzero generative accounting or broken source ranks", async () => {
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors);
    expect(() => adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      accounting: undefined as never,
      corpus,
      laneDescriptors: descriptors,
      evaluation: evaluationWith({}),
    })).toThrow("requires a per-lane accounting provider");
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      accounting: (input) => input.lane === "keyword"
        ? ({
            llm: { calls: 1 as 0, inputTokens: 0, outputTokens: 0 },
            embedding: { calls: 0, inputTokens: 0, durationMs: 0 },
            packedContext: { utf8Bytes: 0, readerTokens: 0 },
            peakRssBytes: 0,
            cacheBytes: 0,
          })
        : accounting(input),
      corpus,
      laneDescriptors: descriptors,
      evaluation: evaluationWith({
        exact: () => ready([{ documentId: "notes/a", rank: 2 }]),
        keyword: () => ready([], { resources: { llmCalls: 1 } }),
      }),
    });
    const exact = adapted.retrievers.find(({ descriptor }) => descriptor.id === "exact");
    const keyword = adapted.retrievers.find(({ descriptor }) => descriptor.id === "keyword");
    if (exact === undefined || keyword === undefined) throw new Error("missing lane adapter");
    const rankFailure = await rejectionFrom(exact.retrieve(request({ text: "rank" })));
    const accountingFailure = await rejectionFrom(keyword.retrieve(request({ text: "llm" })));
    expect(rankFailure).toBeInstanceOf(Error);
    expect(accountingFailure).toBeInstanceOf(Error);
    if (rankFailure instanceof Error) expect(rankFailure.message).toContain("contiguous source ranks");
    if (accountingFailure instanceof Error) {
      expect(accountingFailure.message).toContain("literal-zero generative LLM");
    }

    const controller = new AbortController();
    const reason = new Error("stop now");
    controller.abort(reason);
    expect(await rejectionFrom(exact.retrieve(request({ text: "abort" }, 10, controller.signal)))).toBe(reason);
  });

  test("keeps accounting separate and carries the four-reader batch identity in strict samples", async () => {
    const descriptors = laneDescriptors();
    const corpus = corpusFor(descriptors);
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      evaluation: evaluationWith({
        semantic: () => ready([], {
          timings: { embeddingMs: 3 },
          resources: { embeddingCalls: 1, embeddingInputTokens: 9 },
        }),
      }),
      now: (() => {
        let time = 0;
        return () => time += 4;
      })(),
    });
    const semantic = adapted.retrievers.find(({ descriptor }) => descriptor.id === "semantic");
    if (semantic === undefined) throw new Error("missing semantic adapter");
    const result = await semantic.retrieve(request({ text: "sample" }));
    const sample = createKnowledgeBaseEvaluationRepeatedSampleV2({
      result,
      profileId: "four-reader-query",
      queryId: "q-0000000000000001",
      repetition: 1,
      concurrencyBatchIdentity: "four-reader-driver-v1",
      packedContext: { utf8Bytes: 512, readerTokens: 96 },
      timings: { packingMs: 2 },
    });
    expect(sample.resources).toEqual({
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 1, inputTokens: 9, durationMs: 3 },
      packedContext: { utf8Bytes: 512, readerTokens: 96 },
      peakRssBytes: 0,
      cacheBytes: 0,
    });
    expect(sample.timings).toMatchObject({ queryMs: 4, packingMs: 2 });
    expect(sample.concurrencyBatchIdentity).toBe("four-reader-driver-v1");
    const boundedEmbeddingSample = createKnowledgeBaseEvaluationRepeatedSampleV2({
      result,
      profileId: "warm-query",
      queryId: "q-0000000000000001",
      repetition: 1,
      embedding: {
        calls: 1,
        inputTokens: 0,
        inputTokensMeasured: false,
        durationMs: 4,
        durationScope: "embedding-backed-search-upper-bound",
      },
    });
    expect(boundedEmbeddingSample.resources.embedding).toEqual({
      calls: 1,
      inputTokens: 0,
      inputTokensMeasured: false,
      durationMs: 4,
      durationScope: "embedding-backed-search-upper-bound",
    });
    expect(() => createKnowledgeBaseEvaluationRepeatedSampleV2({
      result,
      profileId: "warm-query",
      repetition: 1,
      embedding: {
        calls: 0,
        inputTokens: 0,
        inputTokensMeasured: false,
        durationMs: 0,
      },
    })).toThrow("exact unannotated zero record");
    expect(() => createKnowledgeBaseEvaluationRepeatedSampleV2({
      result,
      profileId: "four-reader-query",
      queryId: "q-0000000000000001",
      repetition: 1,
      concurrencyBatchIdentity: "invalid\nbatch",
    })).toThrow("sample concurrencyBatchIdentity");
  });
});

describe("knowledge-base evaluation v2 existing-lane closure", () => {
  test("preserves child ranks, deduplicates by canonical document, and propagates provenance and degradation", async () => {
    const descriptors = laneDescriptors();
    const closure = closureDescriptor();
    const corpus = corpusFor(descriptors, closure);
    const calls: string[] = [];
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      closureDescriptors: [closure],
      evaluation: evaluationWith({
        hybrid: ({ query }) => {
          calls.push("hybrid");
          expect(query.inputs).toEqual({ text: "closure text" });
          return ready([
            { documentId: "notes/a", rank: 1, evidence: lineEvidence("notes/a", 3) },
            { documentId: "notes/b", rank: 2, evidence: lineEvidence("notes/b", 5) },
          ], {
            timings: { embeddingMs: 2.5 },
            resources: {
              embeddingCalls: 1,
              embeddingInputTokens: 7,
              peakRssBytes: 2_048,
              cacheBytes: 23,
            },
          });
        },
        metadata: ({ query }) => {
          calls.push("metadata");
          expect(query.inputs).toEqual({
            metadata: { filters: [{ kind: "equals", path: "status", value: "active" }], tags: [] },
          });
          return ready([
            { documentId: "notes/b", rank: 1, evidence: lineEvidence("notes/b", 5) },
            { documentId: "notes/c", rank: 2, evidence: lineEvidence("notes/c", 9) },
          ], { resources: { peakRssBytes: 4_096, cacheBytes: 23 } });
        },
        graph: ({ query }) => {
          calls.push("graph");
          expect(query.inputs).toEqual({ graph: { seeds: ["notes/a"], depth: 1 } });
          return ready([
            {
              documentId: "notes/d",
              rank: 1,
              evidence: { neighborhoods: [{ node: { path: "notes/d.md", line: 3 } }] },
            },
          ], {
            status: "degraded",
            diagnostics: [{ lane: "graph", status: "degraded", message: "bounded traversal" }],
            resources: { peakRssBytes: 1_024, cacheBytes: 23 },
          });
        },
        "path-context": ({ query }) => {
          calls.push("path-context");
          expect(query.inputs).toEqual({ context: { repositoryPath: "src/file.ts" } });
          return ready([{
            documentId: "notes/e",
            rank: 1,
            evidence: { kind: "repository-memory", record: { path: "notes/e.md", line: 3 } },
          }], { resources: { cacheBytes: 23 } });
        },
        git: ({ query }) => {
          calls.push("git");
          expect(query.inputs).toEqual({
            history: { query: "history phrase", noteIds: ["notes/a"] },
          });
          return ready([{
            documentId: "notes/g",
            rank: 1,
            evidence: { history: { path: "notes/g.md", line: 3 } },
          }], { resources: { cacheBytes: 23 } });
        },
      }),
    });
    const retriever = adapted.retrievers.find(({ descriptor }) =>
      descriptor.id === closure.descriptor.id);
    if (retriever === undefined) throw new Error("missing closure adapter");
    const result = await retriever.retrieve(request({
      text: "closure text",
      metadata: {
        filters: [{ kind: "equals", path: "status", value: "active" }],
        tags: [],
      },
      graph: { seeds: ["notes/a"], depth: 1 },
      context: { repositoryPath: "src/file.ts" },
      history: { query: "history phrase", noteIds: ["notes/a"] },
    }));

    expect(calls).toEqual(["hybrid", "metadata", "graph", "path-context", "git"]);
    expect(result.status).toBe("degraded");
    expect(result.candidates.map(({ documentId, rank, provenance }) => ({
      documentId,
      rank,
      sourcePath: provenance[0]?.sourcePath,
    }))).toEqual([
      { documentId: "notes/a", rank: 1, sourcePath: "notes/a.md" },
      { documentId: "notes/b", rank: 2, sourcePath: "notes/b.md" },
      { documentId: "notes/c", rank: 3, sourcePath: "notes/c.md" },
    ]);
    const firstEvidence = evidenceAt(corpus, "notes/a", 3);
    expect(result.candidates[0]).toMatchObject({
      evidenceUnitIds: [firstEvidence.id],
      provenance: [{
        evidenceUnitId: firstEvidence.id,
        sourceFamilyId: firstEvidence.sourceFamilyId,
        sourceClass: "authored-note",
        trustClass: "authoritative-current",
        sourcePath: firstEvidence.sourcePath,
        lineRange: firstEvidence.lineRange,
        headingPath: firstEvidence.headingPath,
      }],
    });
    expect(result.evidenceUnits.map(({ evidenceUnitId }) => evidenceUnitId).toSorted()).toEqual(
      result.candidates.flatMap(({ evidenceUnitIds }) => evidenceUnitIds).toSorted(),
    );
    const metadataOutcome = result.trace.laneOutcomes.find(({ laneId }) => laneId === "metadata");
    expect(metadataOutcome?.rawRanking.map(({ documentId, rank }) => ({ documentId, rank }))).toEqual([
      { documentId: "notes/b", rank: 1 },
      { documentId: "notes/c", rank: 2 },
    ]);
    expect(result.trace.candidateDecisions.find((decision) =>
      decision.laneId === "metadata" && decision.documentId === "notes/b")).toMatchObject({
      disposition: "excluded",
      reasonCodes: ["deduplicated"],
      sourceRank: 1,
    });
    for (const [laneId, documentId] of [
      ["graph", "notes/d"],
      ["path-context", "notes/e"],
      ["git", "notes/g"],
    ] as const) {
      expect(result.trace.candidateDecisions.find((decision) =>
        decision.laneId === laneId && decision.documentId === documentId)).toMatchObject({
        disposition: "excluded",
        evidenceUnitIds: [],
        provenance: [],
        reasonCodes: ["missing-provenance"],
        sourceRank: 1,
      });
      expect(result.trace.laneOutcomes.find(({ laneId: candidateLane }) =>
        candidateLane === laneId)?.rawRanking[0]).toMatchObject({
        documentId,
        evidenceUnitIds: [],
        provenance: [],
        rank: 1,
      });
    }
    expect(result.rawEvidence.find(({ laneId }) => laneId === "graph")?.evidence).toEqual({
      neighborhoods: [{ node: { path: "notes/d.md", line: 3 } }],
    });
    expect(result.rawEvidence.find(({ laneId }) => laneId === "git")?.evidence).toEqual({
      history: { path: "notes/g.md", line: 3 },
    });
    const sample = createKnowledgeBaseEvaluationRepeatedSampleV2({
      result,
      profileId: "warm-query",
      queryId: "q-0000000000000001",
      repetition: 1,
    });
    expect(sample.rawEvidence.find(({ laneId }) => laneId === "graph")?.evidence).toEqual({
      neighborhoods: [{ node: { path: "notes/d.md", line: 3 } }],
    });
    expect(sample.rawEvidence.find(({ laneId }) => laneId === "git")?.evidence).toEqual({
      history: { path: "notes/g.md", line: 3 },
    });
    expect(Object.isFrozen(sample.rawEvidence)).toBe(true);
    expect(Object.isFrozen(sample.rawEvidence.find(({ laneId }) => laneId === "graph")?.evidence))
      .toBe(true);
    expect(result.diagnostics).toContainEqual({
      code: "graph-degraded",
      lane: "graph",
      status: "degraded",
      message: "bounded traversal",
    });
    expect(result.resources).toEqual({
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 1, inputTokens: 7, durationMs: 2.5 },
      packedContext: { utf8Bytes: 0, readerTokens: 0 },
      peakRssBytes: 4_096,
      cacheBytes: 23,
    });
  });

  test("keeps Git explicit: missing history skips it without invoking the backend", async () => {
    const descriptors = laneDescriptors();
    const closure = closureDescriptor();
    const corpus = corpusFor(descriptors, closure);
    let gitCalls = 0;
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      closureDescriptors: [closure],
      evaluation: evaluationWith({
        hybrid: () => ready([]),
        metadata: () => ready([]),
        graph: () => ready([]),
        "path-context": () => ready([]),
        git: () => {
          gitCalls += 1;
          return ready([]);
        },
      }),
    });
    const retriever = adapted.retrievers.find(({ descriptor }) =>
      descriptor.id === closure.descriptor.id);
    if (retriever === undefined) throw new Error("missing closure adapter");
    const result = await retriever.retrieve(request({ text: "no git seed" }));
    expect(gitCalls).toBe(0);
    expect(result.trace.laneOutcomes.find(({ laneId }) => laneId === "git")).toEqual({
      laneId: "git",
      applicability: "skipped",
      status: "unavailable",
      reasonCodes: ["missing-input"],
      rawRanking: [],
    });
  });

  test("preserves QMD accounting qualifiers across child and closure aggregation", async () => {
    const descriptors = laneDescriptors();
    const closure = closureDescriptor({
      primary: { lane: "hybrid", retrieveLimit: 1, retainLimit: 1 },
      structuralLanes: [{ lane: "metadata", limit: 1 }],
      git: { mode: "off" },
      outputLimit: 1,
    });
    const corpus = corpusFor(descriptors, closure);
    const qualifiedAccounting: KnowledgeBaseEvaluationAccountingProviderV2 = async (input) => {
      const measured = await accounting(input);
      if (input.lane !== "hybrid") return measured;
      return Object.freeze({
        ...measured,
        embedding: Object.freeze({
          calls: 1,
          inputTokens: 0,
          inputTokensMeasured: false,
          durationMs: input.timings.embeddingMs ?? 0,
          durationScope: "embedding-backed-search-upper-bound",
        }),
      });
    };
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      accounting: qualifiedAccounting,
      corpus,
      laneDescriptors: descriptors,
      closureDescriptors: [closure],
      evaluation: evaluationWith({
        hybrid: () => ready([], {
          timings: { embeddingMs: 6 },
          resources: { embeddingCalls: 1 },
        }),
        metadata: () => ready([]),
      }),
    });
    const retriever = adapted.retrievers.find(({ descriptor }) =>
      descriptor.id === closure.descriptor.id);
    if (retriever === undefined) throw new Error("missing closure adapter");
    const result = await retriever.retrieve(request({
      text: "qualified accounting",
      metadata: { filters: [], tags: ["memory"] },
    }, 1));
    expect(result.resources.embedding).toEqual({
      calls: 1,
      inputTokens: 0,
      inputTokensMeasured: false,
      durationMs: 6,
      durationScope: "embedding-backed-search-upper-bound",
    });
  });

  test("maps a closure with no applicable lane to an unavailable strict sample", async () => {
    const descriptors = laneDescriptors();
    const closure = closureDescriptor(
      knowledgeBaseExistingLaneClosureVariantsV2["structural-only"],
    );
    const corpus = corpusFor(descriptors, closure);
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      closureDescriptors: [closure],
      evaluation: evaluationWith({}),
    });
    const retriever = adapted.retrievers.find(({ descriptor }) =>
      descriptor.id === closure.descriptor.id);
    if (retriever === undefined) throw new Error("missing closure adapter");

    const result = await retriever.retrieve(request({ text: "No structural inputs." }));
    const sample = createKnowledgeBaseEvaluationRepeatedSampleV2({
      result,
      profileId: "warm-query",
      queryId: "q-0000000000000001",
      repetition: 1,
    });

    expect(result.status).toBe("unavailable");
    expect(result.trace.laneOutcomes.every(({ applicability }) => applicability === "skipped")).toBe(true);
    expect(sample.status).toBe("unavailable");
  });

  test("propagates closure output bounds and aborts without rewriting ranks", async () => {
    const descriptors = laneDescriptors(2);
    const variant: ExistingLaneClosureVariant = {
      primary: { lane: "hybrid", retrieveLimit: 2, retainLimit: 2 },
      structuralLanes: [{ lane: "metadata", limit: 2 }],
      git: { mode: "off" },
      outputLimit: 2,
    };
    const closure = closureDescriptor(variant);
    const corpus = corpusFor(descriptors, closure);
    const adapted = adaptVerifiedKnowledgeBaseEvaluationV2({
      ...adapterRequirementsFor(corpus),
      corpus,
      laneDescriptors: descriptors,
      closureDescriptors: [closure],
      evaluation: evaluationWith({
        hybrid: () => ready([
          { documentId: "notes/a", rank: 1, evidence: lineEvidence("notes/a", 3) },
          { documentId: "notes/b", rank: 2, evidence: lineEvidence("notes/b", 5) },
        ]),
        metadata: () => ready([
          { documentId: "notes/c", rank: 1, evidence: lineEvidence("notes/c", 3) },
        ]),
      }),
    });
    const retriever = adapted.retrievers.find(({ descriptor }) =>
      descriptor.id === closure.descriptor.id);
    if (retriever === undefined) throw new Error("missing closure adapter");
    const result = await retriever.retrieve(request({
      text: "bounded",
      metadata: { filters: [{ kind: "exists", path: "status" }], tags: [] },
    }, 2));
    expect(result.candidates.map(({ documentId, rank }) => ({ documentId, rank }))).toEqual([
      { documentId: "notes/a", rank: 1 },
      { documentId: "notes/b", rank: 2 },
    ]);
    expect(result.trace.candidateDecisions.find(({ documentId }) => documentId === "notes/c")).toMatchObject({
      sourceRank: 1,
      disposition: "excluded",
      reasonCodes: ["output-limit"],
    });

    const controller = new AbortController();
    const reason = new Error("closure stopped");
    controller.abort(reason);
    expect(retriever.retrieve(request({ text: "abort" }, 2, controller.signal))).rejects.toBe(reason);
  });
});
