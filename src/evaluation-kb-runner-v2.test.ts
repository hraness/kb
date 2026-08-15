import { describe, expect, test } from "bun:test";

import type { EvaluationRetriever, EvaluationRetrieverResult } from "./evaluation.js";
import { buildEvaluationEvidenceRegistry } from "./evaluation-evidence.js";
import {
  evaluationImplementationArtifactSha256V2,
  verifyEvaluationImplementationArtifactV2,
  type EvaluationImplementationSourceV2,
} from "./evaluation-implementation.js";
import type { KnowledgeBaseEvaluation } from "./evaluation-kb.js";
import {
  adaptVerifiedKnowledgeBaseEvaluationV2,
  createKnowledgeBaseEvaluationLaneDescriptorsV2,
  createKnowledgeBaseExistingLaneClosureDescriptorV2,
  knowledgeBaseExistingLaneClosureVariantsV2,
  type KnowledgeBaseEvaluationV2,
} from "./evaluation-kb-v2.js";
import {
  KNOWLEDGE_BASE_EVALUATION_MAX_SAMPLE_TIMEOUT_MS,
  runKnowledgeBaseEvaluationV2,
  type KnowledgeBaseEvaluationRunnerV2Dependencies,
} from "./evaluation-kb-runner-v2.js";
import {
  evaluationCandidateLockDigestV2,
  evaluationCorpusDigestV2,
  evaluationRetrieverDescriptorDigestV2,
  requiredPairedObservationsV2,
  type EvaluationMeasurementProfileV2,
  type EvaluationRetrieverDescriptorV2,
  type EvaluationRetrieverTraceV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
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
const frozen = Object.freeze({
  repositoryCommit: "c".repeat(40),
  vaultTree: "d".repeat(40),
  vaultRoot: "kb",
});
const lanes = Object.freeze([
  "exact",
  "keyword",
  "semantic",
  "hybrid",
  "metadata",
  "graph",
  "path-context",
  "git",
] as const);

const evidenceRegistry = buildEvaluationEvidenceRegistry({
  documents: [{
    documentId: "notes/policy",
    sourcePath: "notes/policy.md",
    trustClass: "authoritative-current",
    markdown: "# Policy\n\nCurrent policy text.\n",
  }],
});
function requiredEvidenceUnit() {
  const unit = evidenceRegistry.units.find(({ kind }) => kind === "paragraph");
  if (unit === undefined) throw new Error("Runner fixture lost its evidence unit.");
  return unit;
}
const evidenceUnit = requiredEvidenceUnit();

function implementationSources(retrieverId: string): readonly EvaluationImplementationSourceV2[] {
  return Object.freeze([Object.freeze({
    sourcePath: `src/fixtures/${retrieverId}.ts`,
    bytes: Buffer.from(`export const retrieverId = ${JSON.stringify(retrieverId)};\n`, "utf8"),
  })]);
}

const laneDescriptors = createKnowledgeBaseEvaluationLaneDescriptorsV2(Object.fromEntries(
  lanes.map((lane) => [lane, {
    id: lane,
    role: lane === "hybrid"
      ? "baseline" as const
      : lane === "exact"
        ? "candidate" as const
        : "ablation" as const,
    version: `fixture-${lane}-v1`,
    implementationSha256: evaluationImplementationArtifactSha256V2(implementationSources(lane)),
    retrieveLimit: 1,
  }]),
) as Parameters<typeof createKnowledgeBaseEvaluationLaneDescriptorsV2>[0]);
const descriptors = Object.freeze(lanes.map((lane) => laneDescriptors[lane])
  .toSorted((left, right) => left.id.localeCompare(right.id)));
const closureDescriptor = createKnowledgeBaseExistingLaneClosureDescriptorV2({
  id: "closure-fixture",
  role: "candidate",
  version: "fixture-closure-v1",
  implementationSha256: evaluationImplementationArtifactSha256V2(
    implementationSources("closure-fixture"),
  ),
  variant: knowledgeBaseExistingLaneClosureVariantsV2["structural-git-closure"],
});

const profiles: readonly EvaluationMeasurementProfileV2[] = Object.freeze([{
  id: "cold-index",
  operation: "cold-index",
  scope: "retriever",
  cacheState: "cold",
  concurrency: 1,
  repetitions: 1,
}, {
  id: "four-reader-query",
  operation: "four-reader-query",
  scope: "query",
  cacheState: "warm",
  concurrency: 4,
  repetitions: 1,
}, {
  id: "incremental-update",
  operation: "incremental-update",
  scope: "retriever",
  cacheState: "changed-generation",
  concurrency: 1,
  repetitions: 1,
}, {
  id: "packing",
  operation: "packing",
  scope: "query",
  cacheState: "warm",
  concurrency: 1,
  repetitions: 1,
}, {
  id: "warm-query",
  operation: "warm-query",
  scope: "query",
  cacheState: "warm",
  concurrency: 1,
  repetitions: 1,
}]);

type MutableCorpus = Omit<RetrievalEvaluationCorpusV2, "manifest"> & {
  manifest: {
    protocol: "kb-retrieval-evaluation-v2";
    sealedAt: string;
    corpusSha256: string;
    candidateLockSha256: string;
    buildContractSha256: string;
  };
};

function corpus(
  queryCount = 4,
  split: "development" | "test" = "development",
  includeClosure = false,
  callerSeeded = false,
): RetrievalEvaluationCorpusV2 {
  const selectedDescriptors = includeClosure
    ? [...descriptors, closureDescriptor.descriptor]
        .toSorted((left, right) => left.id.localeCompare(right.id))
    : descriptors;
  const candidateLock = {
    baselineRetrieverId: "hybrid",
    candidateRetrieverIds: selectedDescriptors
      .filter(({ role }) => role === "candidate")
      .map(({ id }) => id),
    descriptorDigests: selectedDescriptors.map((descriptor) => ({
      retrieverId: descriptor.id,
      sha256: evaluationRetrieverDescriptorDigestV2(descriptor),
    })),
  };
  const value: MutableCorpus = {
    schemaVersion: 2,
    id: "runner-fixture",
    description: "Runner fixture.",
    manifest: {
      protocol: "kb-retrieval-evaluation-v2",
      sealedAt: "2026-08-06T00:00:00.000Z",
      corpusSha256: "0".repeat(64),
      candidateLockSha256: evaluationCandidateLockDigestV2(candidateLock),
      buildContractSha256: "b".repeat(64),
    },
    frozen,
    assessment: { rubricVersion: "fixture", assessors: [{ id: "assessor" }] },
    experiment: {
      protocol: {
        minimumUsefulEffects: [{
          metric: "document-recall-at-k",
          cohort: "caller-seeded",
          minimumAbsoluteDifference: 0.05,
        }],
        nonInferiorityMargins: [{
          metric: "warm-query-p95-ms",
          maximumAbsoluteRegression: 50,
          maximumRelativeRegression: 0.25,
        }],
        pairedPower,
        contextCeilings: { utf8Bytes: 1_024, readerTokens: 256 },
      },
      environment: {
        tokenizer: { id: "fixture", sha256: "e".repeat(64) },
        runtime: { id: "fixture", sha256: "f".repeat(64) },
        hardware: { id: "fixture" },
        localModel: { kind: "none" },
        cache: { preparation: "fixture", fingerprintSha256: "1".repeat(64) },
        fourReaderBatch: { id: "four-reader-batch", sha256: "2".repeat(64) },
        incrementalMutation: {
          sourcePath: "notes/incremental-fixture.md",
          appendUtf8Sha256: "3".repeat(64),
          expectedPostMutationSha256: "4".repeat(64),
        },
      },
    },
    sourceFamilies: [{
      id: "sf-0000000000000001",
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    }],
    documents: [{
      id: "notes/policy",
      sourceFamilyId: "sf-0000000000000001",
      sourcePath: evidenceUnit.sourcePath,
      trustClass: "authoritative-current",
    }],
    evidenceUnits: [{
      id: evidenceUnit.id,
      documentId: evidenceUnit.documentId,
      sourceFamilyId: "sf-0000000000000001",
      trustClass: "authoritative-current",
      sourcePath: evidenceUnit.sourcePath,
      lineRange: evidenceUnit.lineRange,
      headingPath: evidenceUnit.headingAncestry,
    }],
    measurementProfiles: profiles,
    retrievers: selectedDescriptors,
    candidateLock,
    queries: Array.from({ length: queryCount }, (_, index) => {
      const suffix = String(index + 1).padStart(16, "0");
      const nuggetId = `ng-${suffix}`;
      return {
        id: `q-${suffix}`,
        text: `Question ${index + 1}`,
        split,
        cohort: callerSeeded ? "caller-seeded" as const : "text-only" as const,
        strata: ["conceptual-recall" as const],
        primaryStratum: "conceptual-recall" as const,
        expectedSupport: "insufficient" as const,
        primaryLane: "hybrid" as const,
        negativeSubtype: "missing-required-support" as const,
        inputs: callerSeeded ? {
          text: `Question ${index + 1}`,
          metadata: { filters: [], tags: ["policy"] },
          graph: { seeds: ["notes/policy"], depth: 1 as const },
          context: { repositoryPath: "src/evaluation-kb-runner-v2.ts" },
          history: { query: `Question ${index + 1}`, noteIds: ["notes/policy"] },
        } : { text: `Question ${index + 1}` },
        inputOrigins: callerSeeded ? [
          { lane: "context" as const, origin: "caller" as const },
          { lane: "graph" as const, origin: "caller" as const },
          { lane: "history" as const, origin: "caller" as const },
          { lane: "metadata" as const, origin: "caller" as const },
          { lane: "text" as const, origin: "query-text" as const },
        ] : [{ lane: "text" as const, origin: "query-text" as const }],
        gold: {
          documents: [{ documentId: "notes/policy", relevance: 0 as const }],
          evidenceUnits: [{ evidenceUnitId: evidenceUnit.id, relevance: 0 as const }],
          nuggets: [{
            id: nuggetId,
            text: "The fixture deliberately lacks support.",
            required: true,
            acceptableSupportSets: [],
          }],
        },
        rawAssessments: [{
          assessorId: "assessor",
          expectedSupport: "insufficient" as const,
          documents: [{ documentId: "notes/policy", relevance: 0 as const }],
          evidenceUnits: [{ evidenceUnitId: evidenceUnit.id, relevance: 0 as const }],
          nuggets: [{
            nuggetId,
            required: true,
            acceptableSupportSetIds: [],
          }],
        }],
        adjudication: { status: "single-assessor" as const },
      };
    }),
  };
  value.manifest.corpusSha256 = evaluationCorpusDigestV2(value);
  return value;
}

function unavailableTrace(descriptor: EvaluationRetrieverDescriptorV2): EvaluationRetrieverTraceV2 {
  return Object.freeze({
    laneOutcomes: Object.freeze(descriptor.lanes.map((laneId) => Object.freeze({
      laneId,
      applicability: "skipped" as const,
      status: "unavailable" as const,
      reasonCodes: Object.freeze(["operation-only"]),
      rawRanking: Object.freeze([]),
    }))),
    candidateDecisions: Object.freeze([]),
  });
}

type EvaluationBehavior = (
  request: Parameters<EvaluationRetriever["retrieve"]>[0],
  lane: typeof lanes[number],
) =>
  ReturnType<EvaluationRetriever["retrieve"]>;

function verifiedEvaluation(
  sealedCorpus: RetrievalEvaluationCorpusV2,
  behavior: EvaluationBehavior,
  close: () => Promise<void> = () => Promise.resolve(),
): KnowledgeBaseEvaluationV2 {
  const legacy: KnowledgeBaseEvaluation = Object.freeze({
    retrievers: Object.freeze(lanes.map((id): EvaluationRetriever => Object.freeze({
      id,
      retrieve: (request) => behavior(request, id),
    }))),
    close,
  });
  return adaptVerifiedKnowledgeBaseEvaluationV2({
    corpus: sealedCorpus,
    evidenceRegistry,
    evaluation: legacy,
    laneDescriptors,
    ...(sealedCorpus.retrievers.some(({ id }) => id === closureDescriptor.descriptor.id)
      ? { closureDescriptors: [closureDescriptor] }
      : {}),
    accounting: ({ lane }) => Promise.resolve({
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: lane === "semantic" || lane === "hybrid"
        ? { calls: 1, inputTokens: 1, durationMs: 1 }
        : { calls: 0, inputTokens: 0, durationMs: 0 },
      packedContext: { utf8Bytes: 0, readerTokens: 0 },
      peakRssBytes: 1,
      cacheBytes: 2,
    }),
    implementationArtifacts: sealedCorpus.retrievers.map((retrieverDescriptor) =>
      verifyEvaluationImplementationArtifactV2({
        corpus: sealedCorpus,
        descriptor: retrieverDescriptor,
        loadedRepositoryCommit: frozen.repositoryCommit,
        sources: implementationSources(retrieverDescriptor.id),
      })),
  });
}

function readyEmpty(): Promise<EvaluationRetrieverResult> {
  return Promise.resolve(Object.freeze({
    status: "ready" as const,
    hits: Object.freeze([]),
    diagnostics: Object.freeze([]),
    timings: Object.freeze({ searchMs: 1 }),
    resources: Object.freeze({}),
  }));
}

function dependenciesFor(options: Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly behavior: EvaluationBehavior;
}>): KnowledgeBaseEvaluationRunnerV2Dependencies {
  return {
    measureRetrieverOperation: ({ descriptor }: { readonly descriptor: EvaluationRetrieverDescriptorV2 }) =>
      Promise.resolve({
        status: "unavailable" as const,
        timings: { elapsedMs: 1, indexMs: 1, updateMs: 0, queryMs: 0, packingMs: 0 },
        resources: {
          llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
          embedding: { calls: 0, inputTokens: 0, durationMs: 0 },
          packedContext: { utf8Bytes: 0, readerTokens: 0 },
          peakRssBytes: 1,
          cacheBytes: 2,
        },
        trace: unavailableTrace(descriptor),
      }),
    pack: () => Promise.resolve({
      durationMs: 2,
      packedContext: { utf8Bytes: 0, readerTokens: 0 },
      includedEvidenceUnitIds: Object.freeze([]),
      truncated: false,
      packedBytesSha256: EMPTY_SHA256,
    }),
    openFourReaderBatch: () => Promise.resolve({
      id: options.corpus.experiment.environment.fourReaderBatch.id,
      sha256: options.corpus.experiment.environment.fourReaderBatch.sha256,
      evaluations: Object.freeze(Array.from({ length: 4 }, () =>
        verifiedEvaluation(options.corpus, options.behavior))),
      verifyCacheFingerprint: () => Promise.resolve(
        options.corpus.experiment.environment.cache.fingerprintSha256,
      ),
    }),
    verifyWarmCacheFingerprint: () => Promise.resolve(
      options.corpus.experiment.environment.cache.fingerprintSha256,
    ),
  };
}

describe("knowledge-base evaluation v2 runner", () => {
  test("rejects a per-sample deadline above the code-owned ceiling", () => {
    const sealedCorpus = corpus();
    const behavior = () => Promise.resolve(readyEmpty());
    return expect(runKnowledgeBaseEvaluationV2({
      corpus: sealedCorpus,
      evaluation: verifiedEvaluation(sealedCorpus, behavior),
      split: "development",
      timeoutMs: KNOWLEDGE_BASE_EVALUATION_MAX_SAMPLE_TIMEOUT_MS + 1,
      dependencies: dependenciesFor({ corpus: sealedCorpus, behavior }),
    })).rejects.toThrow("timeoutMs must be an integer from 1 through 300000");
  });

  test("runs the complete canonical matrix with four distinct verified readers", async () => {
    const sealedCorpus = corpus();
    let active = 0;
    let maximumActive = 0;
    const behavior: EvaluationBehavior = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return readyEmpty();
    };
    const report = await runKnowledgeBaseEvaluationV2({
      corpus: sealedCorpus,
      evaluation: verifiedEvaluation(sealedCorpus, behavior),
      split: "development",
      timeoutMs: 1_000,
      dependencies: dependenciesFor({ corpus: sealedCorpus, behavior }),
    });
    expect(report.samples).toHaveLength(112);
    expect(maximumActive).toBe(4);
    expect(report.samples.filter(({ profileId }) => profileId === "four-reader-query")
      .every(({ concurrencyBatchIdentity }) => concurrencyBatchIdentity === "four-reader-batch")).toBe(true);
    expect(report.samples.filter(({ profileId }) => profileId === "packing")
      .every(({ packedContextTrace }) => packedContextTrace?.packedBytesSha256 === EMPTY_SHA256)).toBe(true);
  });

  test("measures complete query and packing operations at the runner boundary", async () => {
    const sealedCorpus = corpus();
    let clock = 0;
    const behavior: EvaluationBehavior = () => {
      clock += 7;
      return readyEmpty();
    };
    const baseDependencies = dependenciesFor({ corpus: sealedCorpus, behavior });
    const dependencies: KnowledgeBaseEvaluationRunnerV2Dependencies = {
      ...baseDependencies,
      now: () => clock,
      pack: () => {
        clock += 11;
        return Promise.resolve({
          durationMs: 1,
          packedContext: { utf8Bytes: 0, readerTokens: 0 },
          includedEvidenceUnitIds: Object.freeze([]),
          truncated: false,
          packedBytesSha256: EMPTY_SHA256,
        });
      },
    };
    const report = await runKnowledgeBaseEvaluationV2({
      corpus: sealedCorpus,
      evaluation: verifiedEvaluation(sealedCorpus, behavior),
      split: "development",
      timeoutMs: 1_000,
      dependencies,
    });
    const warm = report.samples.find(({ retrieverId, profileId, queryId }) =>
      retrieverId === "hybrid" && profileId === "warm-query" && queryId === "q-0000000000000001");
    expect(warm?.timings).toMatchObject({ elapsedMs: 7, queryMs: 7, packingMs: 0 });
    const packing = report.samples.find(({ retrieverId, profileId, queryId }) =>
      retrieverId === "hybrid" && profileId === "packing" && queryId === "q-0000000000000001");
    expect(packing?.timings).toMatchObject({ elapsedMs: 18, queryMs: 7, packingMs: 11 });
  });

  test("round-trips multi-lane closure raw evidence in locked descriptor order", async () => {
    const sealedCorpus = corpus(4, "development", true, true);
    const behavior: EvaluationBehavior = (_request, lane) => Promise.resolve(Object.freeze({
      status: "ready" as const,
      hits: Object.freeze([Object.freeze({
        documentId: "notes/policy",
        rank: 1,
        evidence: Object.freeze({
          lane,
          provenance: Object.freeze([Object.freeze({
            targetDocumentId: "notes/policy",
            evidenceDocumentId: "notes/policy",
            sourcePath: evidenceUnit.sourcePath,
            locator: Object.freeze({ kind: "line", line: evidenceUnit.lineRange.start }),
          })]),
        }),
      })]),
      diagnostics: Object.freeze([]),
      timings: Object.freeze({ searchMs: 1 }),
      resources: Object.freeze({}),
    }));
    const baseDependencies = dependenciesFor({ corpus: sealedCorpus, behavior });
    const report = await runKnowledgeBaseEvaluationV2({
      corpus: sealedCorpus,
      evaluation: verifiedEvaluation(sealedCorpus, behavior),
      split: "development",
      timeoutMs: 1_000,
      dependencies: {
        ...baseDependencies,
        pack: ({ result }) => Promise.resolve({
          durationMs: 1,
          packedContext: { utf8Bytes: 1, readerTokens: 1 },
          includedEvidenceUnitIds: result.candidates.flatMap(({ evidenceUnitIds }) =>
            evidenceUnitIds),
          truncated: false,
          packedBytesSha256: "a".repeat(64),
        }),
      },
    });
    const sample = report.samples.find(({ retrieverId, profileId, queryId }) =>
      retrieverId === closureDescriptor.descriptor.id
      && profileId === "warm-query"
      && queryId === "q-0000000000000001");
    if (sample === undefined) throw new Error("Missing parsed closure sample.");
    expect(sample.rawEvidence.map(({ laneId, rank }) => ({ laneId, rank }))).toEqual(
      sample.trace.laneOutcomes.flatMap(({ laneId, rawRanking }) =>
        rawRanking.map(({ rank }) => ({ laneId, rank }))),
    );
    expect(sample.rawEvidence.map(({ laneId }) => laneId)).toEqual([
      "git",
      "graph",
      "hybrid",
      "metadata",
      "path-context",
    ]);
  });

  test("rejects structural evaluator forgery and held-out execution without its seal", () => {
    const sealedCorpus = corpus();
    const forged = Object.freeze({
      retrievers: Object.freeze(descriptors.map((descriptor) => Object.freeze({
        descriptor,
        retrieve: () => Promise.reject(new Error("must not run")),
      }))),
      close: () => Promise.resolve(),
    });
    const dependencies = dependenciesFor({ corpus: sealedCorpus, behavior: readyEmpty });
    expect(runKnowledgeBaseEvaluationV2({
      corpus: sealedCorpus,
      evaluation: forged,
      split: "development",
      timeoutMs: 1_000,
      dependencies,
    })).rejects.toThrow("implementation-bound adapter");

    const heldOut = corpus(4, "test");
    expect(runKnowledgeBaseEvaluationV2({
      corpus: heldOut,
      evaluation: verifiedEvaluation(heldOut, readyEmpty),
      split: "test",
      timeoutMs: 1_000,
      dependencies: dependenciesFor({ corpus: heldOut, behavior: readyEmpty }),
    })).rejects.toThrow("independent promotion seal");
  });

  test("records settled bounded failures and rejects incomplete four-reader batches", async () => {
    const sealedCorpus = corpus();
    const failure: EvaluationBehavior = () => Promise.reject(new Error("retrieval failed\nwith details"));
    const dependencies: KnowledgeBaseEvaluationRunnerV2Dependencies = {
      ...dependenciesFor({ corpus: sealedCorpus, behavior: failure }),
      measureRetrieverOperation: () => Promise.reject(new Error("operation failed")),
      pack: () => Promise.reject(new Error("packing failed")),
    };
    const report = await runKnowledgeBaseEvaluationV2({
      corpus: sealedCorpus,
      evaluation: verifiedEvaluation(sealedCorpus, failure),
      split: "development",
      timeoutMs: 1_000,
      dependencies,
    });
    expect(report.samples.filter(({ status }) => status === "failed")).toHaveLength(64);
    expect(report.samples.filter(({ status }) => status === "unavailable")).toHaveLength(48);
    expect(report.samples.every(({ failure: sampleFailure }) => !sampleFailure?.message.includes("\n"))).toBe(true);

    const incomplete = corpus(3);
    expect(runKnowledgeBaseEvaluationV2({
      corpus: incomplete,
      evaluation: verifiedEvaluation(incomplete, failure),
      split: "development",
      timeoutMs: 1_000,
      dependencies: dependenciesFor({ corpus: incomplete, behavior: failure }),
    })).rejects.toThrow("requires complete batches of 4");
  });

  test("closes malformed and late-settling four-reader sessions", async () => {
    const sealedCorpus = corpus();
    let malformedCloses = 0;
    const malformed: KnowledgeBaseEvaluationRunnerV2Dependencies = {
      ...dependenciesFor({ corpus: sealedCorpus, behavior: readyEmpty }),
      openFourReaderBatch: () => Promise.resolve({
        id: sealedCorpus.experiment.environment.fourReaderBatch.id,
        sha256: sealedCorpus.experiment.environment.fourReaderBatch.sha256,
        evaluations: Object.freeze(Array.from({ length: 3 }, () =>
          verifiedEvaluation(sealedCorpus, readyEmpty, () => {
            malformedCloses += 1;
            return Promise.resolve();
          }))),
        verifyCacheFingerprint: () => Promise.resolve(
          sealedCorpus.experiment.environment.cache.fingerprintSha256,
        ),
      }),
    };
    expect(runKnowledgeBaseEvaluationV2({
      corpus: sealedCorpus,
      evaluation: verifiedEvaluation(sealedCorpus, readyEmpty),
      split: "development",
      timeoutMs: 1_000,
      dependencies: malformed,
    })).rejects.toThrow("four distinct verified evaluations");
    expect(malformedCloses).toBe(3);

    let lateCloses = 0;
    const lateEvaluations = Object.freeze(Array.from({ length: 4 }, () =>
      verifiedEvaluation(sealedCorpus, readyEmpty, () => {
        lateCloses += 1;
        return Promise.resolve();
      })));
    const late: KnowledgeBaseEvaluationRunnerV2Dependencies = {
      ...dependenciesFor({ corpus: sealedCorpus, behavior: readyEmpty }),
      openFourReaderBatch: ({ signal }) => new Promise((resolve) => {
        const settle = () => queueMicrotask(() => resolve({
          id: sealedCorpus.experiment.environment.fourReaderBatch.id,
          sha256: sealedCorpus.experiment.environment.fourReaderBatch.sha256,
          evaluations: lateEvaluations,
          verifyCacheFingerprint: () => Promise.resolve(
            sealedCorpus.experiment.environment.cache.fingerprintSha256,
          ),
        }));
        if (signal.aborted) settle();
        else signal.addEventListener("abort", settle, { once: true });
      }),
    };
    const report = await runKnowledgeBaseEvaluationV2({
      corpus: sealedCorpus,
      evaluation: verifiedEvaluation(sealedCorpus, readyEmpty),
      split: "development",
      timeoutMs: 1,
      dependencies: late,
    });
    expect(report.samples.filter(({ profileId, status }) =>
      profileId === "four-reader-query" && status === "failed")).toHaveLength(32);
    expect(lateCloses).toBe(4);
  });
});
