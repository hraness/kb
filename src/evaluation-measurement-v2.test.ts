import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createKnowledgeBaseEvaluationRetrieverOperationMeasurerV2,
  evaluationIncrementalMutationSha256V2,
  executeKnowledgeBaseEvaluationMeasurementChildV2,
  measureEvaluationCacheBytesV2,
  type EvaluationIncrementalMutationV2,
  type EvaluationMeasurementChildProcessFactoryV2,
  type EvaluationMeasurementChildRequestV2,
  type EvaluationMeasurementChildResponseV2,
} from "./evaluation-measurement-v2.js";
import {
  recommendedEmbeddingModel,
  recommendedEmbeddingModelSha256,
  type SemanticIndexOptions,
  type SemanticIndexResult,
} from "./semantic.js";
import {
  requiredPairedObservationsV2,
  type EvaluationMeasurementProfileV2,
  type EvaluationRetrieverDescriptorV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

const descriptor: EvaluationRetrieverDescriptorV2 = Object.freeze({
  id: "hybrid-candidate",
  role: "candidate",
  version: "fixture-v1",
  implementationSha256: "a".repeat(64),
  lanes: Object.freeze(["hybrid" as const]),
  configuration: Object.freeze({ "retrieve-limit": 5 }),
});

const pairedPowerDesign = Object.freeze({
  alpha: 0.05,
  targetPower: 0.8,
  assumedDiscordantRate: 0.25,
  assumedEffect: 0.25,
  minimumUsefulEffect: 0.05,
});
const pairedPower = Object.freeze({
  ...pairedPowerDesign,
  requiredPairs: requiredPairedObservationsV2(pairedPowerDesign),
});

const coldProfile: EvaluationMeasurementProfileV2 = Object.freeze({
  id: "cold-index",
  operation: "cold-index",
  scope: "retriever",
  cacheState: "cold",
  concurrency: 1,
  repetitions: 2,
});

const updateProfile: EvaluationMeasurementProfileV2 = Object.freeze({
  id: "incremental-update",
  operation: "incremental-update",
  scope: "retriever",
  cacheState: "changed-generation",
  concurrency: 1,
  repetitions: 2,
});

const mutationInitialContent = "# Changed\n\nBefore.\n";
const mutationSource = Object.freeze({
  sourcePath: "notes/changed-note.md",
  appendText: "\nPinned incremental measurement sentence.\n",
  expectedPostMutationSha256: createHash("sha256")
    .update("# Changed\n\nBefore.\n\nPinned incremental measurement sentence.\n", "utf8")
    .digest("hex"),
});

const mutation: EvaluationIncrementalMutationV2 = Object.freeze({
  ...mutationSource,
  sha256: evaluationIncrementalMutationSha256V2(mutationSource),
});

function corpus(
  lockedDescriptor: EvaluationRetrieverDescriptorV2 = descriptor,
): RetrievalEvaluationCorpusV2 {
  const fixture: Pick<
    RetrievalEvaluationCorpusV2,
    "experiment" | "frozen" | "measurementProfiles" | "retrievers"
  > = {
    frozen: {
      repositoryCommit: "b".repeat(40),
      vaultTree: "c".repeat(40),
      vaultRoot: "kb",
    },
    experiment: {
      protocol: {
        minimumUsefulEffects: [],
        nonInferiorityMargins: [],
        pairedPower,
        contextCeilings: { utf8Bytes: 1, readerTokens: 1 },
      },
      environment: {
        tokenizer: { id: "fixture-tokenizer", sha256: "d".repeat(64) },
        runtime: { id: "fixture-runtime", sha256: "e".repeat(64) },
        hardware: { id: "fixture-hardware" },
        localModel: {
          kind: "model",
          id: recommendedEmbeddingModel,
          sha256: recommendedEmbeddingModelSha256,
        },
        cache: { preparation: "fixture", fingerprintSha256: "f".repeat(64) },
        fourReaderBatch: { id: "fixture-four-reader", sha256: "1".repeat(64) },
        incrementalMutation: {
          sourcePath: mutation.sourcePath,
          appendUtf8Sha256: createHash("sha256")
            .update(mutation.appendText, "utf8")
            .digest("hex"),
          expectedPostMutationSha256: mutation.expectedPostMutationSha256,
        },
      },
    },
    retrievers: [lockedDescriptor],
    measurementProfiles: [coldProfile, updateProfile],
  };
  return fixture as unknown as RetrievalEvaluationCorpusV2;
}

function responseFor(
  request: EvaluationMeasurementChildRequestV2,
  overrides: Readonly<{
    readonly llmCalls?: number;
    readonly updated?: number;
  }> = {},
): EvaluationMeasurementChildResponseV2 | Record<string, unknown> {
  const incremental = request.phase === "incremental-update";
  const docsProcessed = incremental ? 1 : 2;
  const embedding = {
    docsProcessed,
    chunksEmbedded: docsProcessed,
    errors: 0,
    durationMs: 2,
  };
  return {
    protocol: request.protocol,
    version: request.version,
    kind: "response",
    requestId: request.requestId,
    phase: request.phase,
    elapsedMs: 8,
    index: {
      model: recommendedEmbeddingModel,
      documentCount: 2,
      update: incremental
        ? {
            collections: 1,
            indexed: 0,
            updated: overrides.updated ?? 1,
            unchanged: 1,
            removed: 0,
            needsEmbedding: 1,
          }
        : {
            collections: 1,
            indexed: 2,
            updated: overrides.updated ?? 0,
            unchanged: 0,
            removed: 0,
            needsEmbedding: 2,
          },
      embedding,
    },
    resources: {
      llm: { calls: overrides.llmCalls ?? 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 1, inputTokens: 0, inputTokensMeasured: false, durationMs: 2 },
      packedContext: { utf8Bytes: 0, readerTokens: 0 },
      peakRssBytes: 123_456,
      cacheBytes: 789,
    },
  };
}

function successfulFactory(
  seen: EvaluationMeasurementChildRequestV2[],
  response?: (request: EvaluationMeasurementChildRequestV2) => unknown,
): EvaluationMeasurementChildProcessFactoryV2 {
  return (spawnRequest) => {
    const request = JSON.parse(new TextDecoder().decode(spawnRequest.stdin)) as EvaluationMeasurementChildRequestV2;
    seen.push(request);
    expect(spawnRequest.environment.XDG_CACHE_HOME).toBe(join(request.workRoot, "cache", "xdg"));
    expect(spawnRequest.environment.HF_HUB_OFFLINE).toBe("1");
    expect(spawnRequest.environment.QMD_EMBED_PARALLELISM).toBe("1");
    expect(spawnRequest.environment.QMD_LLAMA_GPU).toBe("auto");
    expect(spawnRequest.environment.QMD_GENERATE_MODEL)
      .toBe(join(request.workRoot, ".generative-llm-forbidden.gguf"));
    expect(spawnRequest.environment.QMD_RERANK_MODEL)
      .toBe(join(request.workRoot, ".reranker-llm-forbidden.gguf"));
    expect(spawnRequest.environment.TMPDIR).toBe(request.workRoot);
    expect(spawnRequest.environment.NODE_OPTIONS).toBeUndefined();
    expect(spawnRequest.environment.BUN_OPTIONS).toBeUndefined();
    return Promise.resolve({
      termination: "exit",
      exitCode: 0,
      stdout: Buffer.from(JSON.stringify(response?.(request) ?? responseFor(request))),
      stderr: Buffer.from("bounded native diagnostic\n"),
    });
  };
}

function fixtureMeasurer(
  temporary: string,
  childProcessFactory: EvaluationMeasurementChildProcessFactoryV2,
) {
  return createKnowledgeBaseEvaluationRetrieverOperationMeasurerV2({
    repository: join(temporary, "repository"),
    root: join(temporary, "repository", "kb"),
    embeddingModelFile: join(temporary, "pinned.gguf"),
    mutation,
    timeoutMs: 1_000,
    temporaryDirectory: temporary,
    childCommand: ["fixture-child"],
    childProcessFactory,
  });
}

describe("evaluation measurement parent boundary", () => {
  test("adapts an exact cold-index child response for the v2 runner", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-measurement-test-"));
    const seen: EvaluationMeasurementChildRequestV2[] = [];
    try {
      const measure = fixtureMeasurer(temporary, successfulFactory(seen));
      const measured = await measure({
        operation: "cold-index",
        corpus: corpus(),
        descriptor,
        profile: coldProfile,
        repetition: 1,
        signal: new AbortController().signal,
      });
      expect(measured).toMatchObject({
        status: "ready",
        timings: { elapsedMs: 8, indexMs: 8, updateMs: 0 },
        resources: {
          llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
          embedding: { calls: 1, inputTokens: 0, inputTokensMeasured: false, durationMs: 2 },
          peakRssBytes: 123_456,
          cacheBytes: 789,
        },
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        phase: "cold-index",
        embeddingModelFile: join(temporary, "pinned.gguf"),
      });
      expect(seen[0]?.mutation).toBeUndefined();
      expect(measured.trace.laneOutcomes).toEqual([{
        laneId: "hybrid",
        applicability: "applied",
        status: "ready",
        reasonCodes: [],
        rawRanking: [],
      }]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("measures one shared QMD substrate per sealed profile repetition", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-measurement-test-"));
    const seen: EvaluationMeasurementChildRequestV2[] = [];
    try {
      const measure = fixtureMeasurer(temporary, successfulFactory(seen));
      const first = await measure({
        operation: "cold-index",
        corpus: corpus(),
        descriptor,
        profile: coldProfile,
        repetition: 1,
        signal: new AbortController().signal,
      });
      const second = await measure({
        operation: "cold-index",
        corpus: corpus(),
        descriptor,
        profile: coldProfile,
        repetition: 1,
        signal: new AbortController().signal,
      });
      const nextRepetition = await measure({
        operation: "cold-index",
        corpus: corpus(),
        descriptor,
        profile: coldProfile,
        repetition: 2,
        signal: new AbortController().signal,
      });
      expect(seen).toHaveLength(2);
      expect(first.timings).toEqual(second.timings);
      expect(nextRepetition.status).toBe("ready");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("prepares in one child and measures the exact update in a second fresh child", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-measurement-test-"));
    const seen: EvaluationMeasurementChildRequestV2[] = [];
    try {
      const measure = fixtureMeasurer(temporary, successfulFactory(seen));
      const measured = await measure({
        operation: "incremental-update",
        corpus: corpus(),
        descriptor,
        profile: updateProfile,
        repetition: 2,
        signal: new AbortController().signal,
      });
      expect(seen.map(({ phase }) => phase)).toEqual(["incremental-prepare", "incremental-update"]);
      expect(seen[0]?.requestId).toBe(seen[1]?.requestId);
      expect(seen[0]?.workRoot).toBe(seen[1]?.workRoot);
      expect(seen[1]?.mutation).toEqual(mutation);
      expect(measured).toMatchObject({
        status: "ready",
        timings: { elapsedMs: 8, indexMs: 0, updateMs: 8 },
        resources: { peakRssBytes: 123_456, cacheBytes: 789 },
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("fails closed on malformed output, timeout, nonzero exit, nonzero LLM work, and count drift", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-measurement-test-"));
    try {
      const cases: readonly [string, EvaluationMeasurementChildProcessFactoryV2][] = [
        ["malformed", () => Promise.resolve({
          termination: "exit", exitCode: 0, stdout: Buffer.from("not-json"), stderr: new Uint8Array(),
        })],
        ["timeout", () => Promise.resolve({
          termination: "timeout", exitCode: null, stdout: new Uint8Array(), stderr: new Uint8Array(),
        })],
        ["exit", () => Promise.resolve({
          termination: "exit", exitCode: 9, stdout: new Uint8Array(), stderr: Buffer.from("failure"),
        })],
        ["llm", successfulFactory([], (request) => responseFor(request, { llmCalls: 1 }))],
        ["counts", successfulFactory([], (request) => responseFor(request, { updated: 1 }))],
      ];
      for (const [label, factory] of cases) {
        const measure = fixtureMeasurer(temporary, factory);
        expect(measure({
          operation: "cold-index",
          corpus: corpus(),
          descriptor,
          profile: coldProfile,
          repetition: 1,
          signal: new AbortController().signal,
        }), label).rejects.toThrow();
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("rejects an incremental mutation that drifts from the sealed experiment before spawning", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-measurement-test-"));
    let spawned = 0;
    try {
      const measure = fixtureMeasurer(temporary, () => {
        spawned += 1;
        return Promise.reject(new Error("must not spawn"));
      });
      const base = corpus();
      const mutations = [
        { ...base.experiment.environment.incrementalMutation, sourcePath: "notes/other.md" },
        { ...base.experiment.environment.incrementalMutation, appendUtf8Sha256: "0".repeat(64) },
        {
          ...base.experiment.environment.incrementalMutation,
          expectedPostMutationSha256: "0".repeat(64),
        },
      ];
      for (const incrementalMutation of mutations) {
        const drifted: RetrievalEvaluationCorpusV2 = {
          ...base,
          experiment: {
            ...base.experiment,
            environment: { ...base.experiment.environment, incrementalMutation },
          },
        };
        expect(measure({
          operation: "incremental-update",
          corpus: drifted,
          descriptor,
          profile: updateProfile,
          repetition: 1,
          signal: new AbortController().signal,
        })).rejects.toThrow("sealed experiment identity");
      }
      expect(spawned).toBe(0);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("returns unavailable without spawning for retrievers without a QMD lane", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-measurement-test-"));
    const exactDescriptor: EvaluationRetrieverDescriptorV2 = { ...descriptor, lanes: ["exact"] };
    let spawned = 0;
    try {
      const measure = fixtureMeasurer(temporary, () => {
        spawned += 1;
        return Promise.reject(new Error("must not spawn"));
      });
      const measured = await measure({
        operation: "cold-index",
        corpus: corpus(exactDescriptor),
        descriptor: exactDescriptor,
        profile: coldProfile,
        repetition: 1,
        signal: new AbortController().signal,
      });
      expect(spawned).toBe(0);
      expect(measured.status).toBe("unavailable");
      expect(measured.trace.laneOutcomes[0]).toMatchObject({
        laneId: "exact",
        applicability: "skipped",
        status: "unavailable",
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});

describe("evaluation measurement child boundary", () => {
  test("materializes, indexes, mutates, and then measures one changed note with pinned model bytes", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-measurement-child-test-"));
    const repository = join(temporary, "repository");
    const root = join(repository, "kb");
    const modelFile = join(temporary, "pinned.gguf");
    const workRoot = await realpath(
      await mkdtemp(join(temporary, "hraness-kb-evaluation-measurement-")),
    );
    const xdgCache = join(workRoot, "cache", "xdg");
    const requests: SemanticIndexOptions[] = [];
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "index.md"), "# Index\n", "utf8");
    await writeFile(join(root, "notes", "changed-note.md"), mutationInitialContent, "utf8");
    await writeFile(join(root, "notes", "stable-note.md"), "# Stable\n\nStill stable.\n", "utf8");
    await writeFile(modelFile, "test-only model bytes", "utf8");
    const requestBase = {
      protocol: "kb-evaluation-measurement-child-v2",
      version: 1,
      kind: "request",
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      repository,
      root,
      frozen: {
        repositoryCommit: "b".repeat(40),
        vaultTree: "c".repeat(40),
        vaultRoot: "kb",
      },
      embeddingModelFile: modelFile,
      workRoot,
      mutation,
    } as const;
    const fakeIndex = async (options: SemanticIndexOptions): Promise<SemanticIndexResult> => {
      requests.push(options);
      await writeFile(options.database as string, "123456789", "utf8");
      const update = requests.length === 1
        ? { collections: 1, indexed: 2, updated: 0, unchanged: 0, removed: 0, needsEmbedding: 2 }
        : { collections: 1, indexed: 0, updated: 1, unchanged: 1, removed: 0, needsEmbedding: 1 };
      const docsProcessed = requests.length === 1 ? 2 : 1;
      return {
        root: options.root,
        database: options.database as string,
        model: recommendedEmbeddingModel,
        update,
        embedding: { docsProcessed, chunksEmbedded: docsProcessed, errors: 0, durationMs: 3 },
      };
    };
    const childDependencies = {
      verifyFrozenSnapshot: () => Promise.resolve(),
      indexSemanticVault: fakeIndex,
      peakRssBytes: () => 654_321,
      environment: {
        XDG_CACHE_HOME: xdgCache,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        GGML_METAL_NO_RESIDENCY: "1",
        QMD_EMBED_PARALLELISM: "1",
        QMD_LLAMA_GPU: "auto",
        QMD_GENERATE_MODEL: join(workRoot, ".generative-llm-forbidden.gguf"),
        QMD_RERANK_MODEL: join(workRoot, ".reranker-llm-forbidden.gguf"),
        TMPDIR: workRoot,
        TMP: workRoot,
        TEMP: workRoot,
      },
    } as const;
    try {
      const forbiddenGenerateModel = join(workRoot, ".generative-llm-forbidden.gguf");
      await writeFile(forbiddenGenerateModel, "must never load", "utf8");
      expect(executeKnowledgeBaseEvaluationMeasurementChildV2(
        { ...requestBase, phase: "incremental-prepare" } satisfies EvaluationMeasurementChildRequestV2,
        childDependencies,
      )).rejects.toThrow("generative model guard must remain absent");
      await rm(forbiddenGenerateModel, { force: true });

      expect(executeKnowledgeBaseEvaluationMeasurementChildV2(
        { ...requestBase, phase: "incremental-prepare" } satisfies EvaluationMeasurementChildRequestV2,
        {
          ...childDependencies,
          environment: { ...childDependencies.environment, NODE_OPTIONS: "--require=untrusted.cjs" },
        },
      )).rejects.toThrow("environment is not isolated and pinned");
      expect(requests).toHaveLength(0);

      const prepared = await executeKnowledgeBaseEvaluationMeasurementChildV2(
        { ...requestBase, phase: "incremental-prepare" } satisfies EvaluationMeasurementChildRequestV2,
        childDependencies,
      );
      expect(prepared.index.update).toMatchObject({ indexed: 2, updated: 0, unchanged: 0 });
      expect(prepared.resources).toMatchObject({ peakRssBytes: 654_321, cacheBytes: 9 });
      expect(await readFile(join(workRoot, "vault", mutation.sourcePath), "utf8"))
        .toBe(`# Changed\n\nBefore.\n${mutation.appendText}`);

      await writeFile(join(workRoot, "cache", "qmd.sqlite"), "tampered!", "utf8");
      expect(executeKnowledgeBaseEvaluationMeasurementChildV2(
        { ...requestBase, phase: "incremental-update" } satisfies EvaluationMeasurementChildRequestV2,
        childDependencies,
      )).rejects.toThrow("prepared cache changed");
      expect(requests).toHaveLength(1);
      await writeFile(join(workRoot, "cache", "qmd.sqlite"), "123456789", "utf8");

      const updated = await executeKnowledgeBaseEvaluationMeasurementChildV2(
        { ...requestBase, phase: "incremental-update" } satisfies EvaluationMeasurementChildRequestV2,
        childDependencies,
      );
      expect(updated.index.update).toEqual({
        collections: 1,
        indexed: 0,
        updated: 1,
        unchanged: 1,
        removed: 0,
        needsEmbedding: 1,
      });
      expect(updated.resources).toMatchObject({ peakRssBytes: 654_321, cacheBytes: 9 });
      expect(requests).toEqual([{
        root: join(workRoot, "vault"),
        database: join(workRoot, "cache", "qmd.sqlite"),
        embeddingModelFile: modelFile,
      }, {
        root: join(workRoot, "vault"),
        database: join(workRoot, "cache", "qmd.sqlite"),
        embeddingModelFile: modelFile,
      }]);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("counts the isolated cache exactly and rejects symlink aliases", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-cache-measurement-test-"));
    await mkdir(join(temporary, "nested"));
    await writeFile(join(temporary, "one"), "1234", "utf8");
    await writeFile(join(temporary, "nested", "two"), "12345", "utf8");
    try {
      expect(await measureEvaluationCacheBytesV2(temporary)).toBe(9);
      await symlink(join(temporary, "one"), join(temporary, "alias"));
      expect(measureEvaluationCacheBytesV2(temporary)).rejects.toThrow("symbolic links");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
