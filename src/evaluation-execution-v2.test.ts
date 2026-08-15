import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { EvaluationRetriever, EvaluationRetrieverResult } from "./evaluation.js";
import { buildEvaluationEvidenceRegistry } from "./evaluation-evidence.js";
import {
  createKnowledgeBaseEvaluationCacheVerifierV2,
  createKnowledgeBaseEvaluationFourReaderOpenerV2,
  createKnowledgeBaseEvaluationRunnerV2Dependencies,
  type KnowledgeBaseEvaluationCacheVerifierV2,
  type KnowledgeBaseEvaluationFourReaderOpenerV2,
  type OpenFreshKnowledgeBaseEvaluationV2,
} from "./evaluation-execution-v2.js";
import {
  evaluationImplementationArtifactSha256V2,
  verifyEvaluationImplementationArtifactV2,
  type EvaluationImplementationSourceV2,
} from "./evaluation-implementation.js";
import type { KnowledgeBaseEvaluation } from "./evaluation-kb.js";
import {
  adaptVerifiedKnowledgeBaseEvaluationV2,
  createKnowledgeBaseEvaluationLaneDescriptorsV2,
  type KnowledgeBaseEvaluationRetrieverResultV2,
  type KnowledgeBaseEvaluationV2,
} from "./evaluation-kb-v2.js";
import type { KnowledgeBaseEvaluationRunnerV2Dependencies } from "./evaluation-kb-runner-v2.js";
import {
  createEvaluationReaderTokenizerV2,
  packKnowledgeBaseEvaluationContextV2,
  utf8ByteEvaluationReaderTokenizerV2,
  type EvaluationReaderTokenizerV2,
} from "./evaluation-packing-v2.js";
import {
  evaluationCandidateLockDigestV2,
  evaluationCorpusDigestV2,
  evaluationRetrieverDescriptorDigestV2,
  requiredPairedObservationsV2,
  type EvaluationMeasurementProfileV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

const CACHE_PREPARATION = "Prepare the isolated fixture cache once and retain that generation.";
const CACHE_DEFINITION = "Fixture live cache manifest v1\n";
const CACHE_SHA256 = createHash("sha256").update(CACHE_DEFINITION, "utf8").digest("hex");
const FOUR_READER_ID = "four-reader-batch-v1";
const FOUR_READER_DEFINITION = "Fixture four-reader opener v1\n";
const FOUR_READER_SHA256 = createHash("sha256").update(FOUR_READER_DEFINITION, "utf8").digest("hex");
const SOURCE_FAMILY_ID = "sf-0000000000000001";
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
const evidenceUnit = (() => {
  const found = evidenceRegistry.units.find(({ kind }) => kind === "paragraph");
  if (found === undefined) throw new Error("Execution fixture lost its paragraph evidence unit.");
  return found;
})();

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
  tokenizer: EvaluationReaderTokenizerV2 = utf8ByteEvaluationReaderTokenizerV2,
): RetrievalEvaluationCorpusV2 {
  const candidateLock = {
    baselineRetrieverId: "hybrid",
    candidateRetrieverIds: ["exact"],
    descriptorDigests: descriptors.map((descriptor) => ({
      retrieverId: descriptor.id,
      sha256: evaluationRetrieverDescriptorDigestV2(descriptor),
    })),
  };
  const nuggetId = "ng-0000000000000001";
  const value: MutableCorpus = {
    schemaVersion: 2,
    id: "execution-fixture",
    description: "Execution composition fixture.",
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
        contextCeilings: { utf8Bytes: 4_096, readerTokens: 4_096 },
      },
      environment: {
        tokenizer: { id: tokenizer.id, sha256: tokenizer.sha256 },
        runtime: { id: "fixture", sha256: "f".repeat(64) },
        hardware: { id: "fixture" },
        localModel: { kind: "none" },
        cache: { preparation: CACHE_PREPARATION, fingerprintSha256: CACHE_SHA256 },
        fourReaderBatch: { id: FOUR_READER_ID, sha256: FOUR_READER_SHA256 },
        incrementalMutation: {
          sourcePath: "notes/incremental-fixture.md",
          appendUtf8Sha256: "5".repeat(64),
          expectedPostMutationSha256: "6".repeat(64),
        },
      },
    },
    sourceFamilies: [{
      id: SOURCE_FAMILY_ID,
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    }],
    documents: [{
      id: evidenceUnit.documentId,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourcePath: evidenceUnit.sourcePath,
      trustClass: "authoritative-current",
    }],
    evidenceUnits: [{
      id: evidenceUnit.id,
      documentId: evidenceUnit.documentId,
      sourceFamilyId: SOURCE_FAMILY_ID,
      trustClass: "authoritative-current",
      sourcePath: evidenceUnit.sourcePath,
      lineRange: evidenceUnit.lineRange,
      headingPath: evidenceUnit.headingAncestry,
    }],
    measurementProfiles: profiles,
    retrievers: descriptors,
    candidateLock,
    queries: [{
      id: "q-0000000000000001",
      text: "What is the current policy?",
      split: "development",
      cohort: "text-only",
      strata: ["conceptual-recall"],
      primaryStratum: "conceptual-recall",
      expectedSupport: "insufficient",
      primaryLane: "hybrid",
      negativeSubtype: "missing-required-support",
      inputs: { text: "What is the current policy?" },
      inputOrigins: [{ lane: "text", origin: "query-text" }],
      gold: {
        documents: [{ documentId: evidenceUnit.documentId, relevance: 0 }],
        evidenceUnits: [{ evidenceUnitId: evidenceUnit.id, relevance: 0 }],
        nuggets: [{
          id: nuggetId,
          text: "The fixture deliberately lacks judged support.",
          required: true,
          acceptableSupportSets: [],
        }],
      },
      rawAssessments: [{
        assessorId: "assessor",
        expectedSupport: "insufficient",
        documents: [{ documentId: evidenceUnit.documentId, relevance: 0 }],
        evidenceUnits: [{ evidenceUnitId: evidenceUnit.id, relevance: 0 }],
        nuggets: [{ nuggetId, required: true, acceptableSupportSetIds: [] }],
      }],
      adjudication: { status: "single-assessor" },
    }],
  };
  value.manifest.corpusSha256 = evaluationCorpusDigestV2(value);
  return value;
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

function verifiedEvaluation(
  sealedCorpus: RetrievalEvaluationCorpusV2,
  close: () => Promise<void> = () => Promise.resolve(),
): KnowledgeBaseEvaluationV2 {
  const legacy: KnowledgeBaseEvaluation = Object.freeze({
    retrievers: Object.freeze(lanes.map((id): EvaluationRetriever => Object.freeze({
      id,
      retrieve: readyEmpty,
    }))),
    close,
  });
  return adaptVerifiedKnowledgeBaseEvaluationV2({
    corpus: sealedCorpus,
    evidenceRegistry,
    evaluation: legacy,
    laneDescriptors,
    accounting: () => Promise.resolve({
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 0, inputTokens: 0, durationMs: 0 },
      packedContext: { utf8Bytes: 0, readerTokens: 0 },
      peakRssBytes: 0,
      cacheBytes: 0,
    }),
    implementationArtifacts: sealedCorpus.retrievers.map((descriptor) =>
      verifyEvaluationImplementationArtifactV2({
        corpus: sealedCorpus,
        descriptor,
        loadedRepositoryCommit: frozen.repositoryCommit,
        sources: implementationSources(descriptor.id),
      })),
  });
}

function locator() {
  return {
    evidenceUnitId: evidenceUnit.id,
    sourceFamilyId: SOURCE_FAMILY_ID,
    sourceClass: "authored-note" as const,
    trustClass: "authoritative-current" as const,
    sourcePath: evidenceUnit.sourcePath,
    lineRange: evidenceUnit.lineRange,
    headingPath: evidenceUnit.headingAncestry,
  };
}

function retrieverResult(): KnowledgeBaseEvaluationRetrieverResultV2 {
  const provenance = locator();
  return {
    retrieverId: "exact",
    status: "ready",
    candidates: [{
      documentId: evidenceUnit.documentId,
      evidenceUnitIds: [evidenceUnit.id],
      rank: 1,
      provenance: [provenance],
    }],
    trace: {
      laneOutcomes: [],
      candidateDecisions: [{
        documentId: evidenceUnit.documentId,
        evidenceUnitIds: [evidenceUnit.id],
        laneId: "exact",
        sourceRank: 1,
        disposition: "accepted",
        reasonCodes: ["primary"],
        outputRank: 1,
        provenance: [provenance],
      }],
    },
    diagnostics: [],
    rawEvidence: [],
    evidenceUnits: [{
      evidenceUnitId: evidenceUnit.id,
      registryUnitId: evidenceUnit.id,
      documentId: evidenceUnit.documentId,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
      locator: provenance,
    }],
    timings: {},
    rawResources: {},
    resources: {
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 0, inputTokens: 0, durationMs: 0 },
      packedContext: { utf8Bytes: 0, readerTokens: 0 },
      peakRssBytes: 0,
      cacheBytes: 0,
    },
    elapsedMs: 0,
  };
}

function packingContract(sealedCorpus: RetrievalEvaluationCorpusV2) {
  return {
    suiteSha256: sealedCorpus.manifest.corpusSha256,
    tokenizer: sealedCorpus.experiment.environment.tokenizer,
    contextCeilings: sealedCorpus.experiment.protocol.contextCeilings,
  };
}

const operationMeasurer: KnowledgeBaseEvaluationRunnerV2Dependencies["measureRetrieverOperation"] =
  ({ descriptor }) => Promise.resolve({
    status: "unavailable",
    timings: { elapsedMs: 0, indexMs: 0, updateMs: 0, queryMs: 0, packingMs: 0 },
    resources: {
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 0, inputTokens: 0, durationMs: 0 },
      packedContext: { utf8Bytes: 0, readerTokens: 0 },
      peakRssBytes: 0,
      cacheBytes: 0,
    },
    trace: {
      laneOutcomes: descriptor.lanes.map((laneId) => ({
        laneId,
        applicability: "skipped",
        status: "unavailable",
        reasonCodes: ["operation-not-applicable"],
        rawRanking: [],
      })),
      candidateDecisions: [],
    },
  });

function cacheVerifier(
  verify: KnowledgeBaseEvaluationCacheVerifierV2["verify"] = () => CACHE_SHA256,
): KnowledgeBaseEvaluationCacheVerifierV2 {
  return createKnowledgeBaseEvaluationCacheVerifierV2({
    preparation: CACHE_PREPARATION,
    definition: CACHE_DEFINITION,
    verify,
  });
}

function fourReaderOpener(
  sealedCorpus: RetrievalEvaluationCorpusV2,
  open: OpenFreshKnowledgeBaseEvaluationV2 = () => Promise.resolve(verifiedEvaluation(sealedCorpus)),
): KnowledgeBaseEvaluationFourReaderOpenerV2 {
  return createKnowledgeBaseEvaluationFourReaderOpenerV2({
    id: FOUR_READER_ID,
    definition: FOUR_READER_DEFINITION,
    open,
  });
}

function dependencies(options: Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly openEvaluation?: OpenFreshKnowledgeBaseEvaluationV2;
  readonly opener?: KnowledgeBaseEvaluationFourReaderOpenerV2;
  readonly verifier?: KnowledgeBaseEvaluationCacheVerifierV2;
  readonly tokenizer?: EvaluationReaderTokenizerV2;
  readonly now?: () => number;
}>): KnowledgeBaseEvaluationRunnerV2Dependencies {
  return createKnowledgeBaseEvaluationRunnerV2Dependencies({
    corpus: options.corpus,
    evidenceRegistry,
    tokenizer: options.tokenizer ?? utf8ByteEvaluationReaderTokenizerV2,
    measureRetrieverOperation: operationMeasurer,
    fourReaderOpener: options.opener ?? fourReaderOpener(options.corpus, options.openEvaluation),
    cacheVerifier: options.verifier ?? cacheVerifier(),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject.");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("knowledge-base evaluation execution composition", () => {
  test("delegates exact packing and shares one live cache capability across warm and four-reader checks", async () => {
    const sealedCorpus = corpus();
    let clock = 10;
    let liveVerifications = 0;
    let closes = 0;
    const openedIndices: number[] = [];
    const composed = dependencies({
      corpus: sealedCorpus,
      verifier: cacheVerifier(() => {
        liveVerifications += 1;
        return CACHE_SHA256;
      }),
      openEvaluation: ({ readerIndex }) => {
        openedIndices.push(readerIndex);
        return Promise.resolve(verifiedEvaluation(sealedCorpus, () => {
          closes += 1;
          return Promise.resolve();
        }));
      },
      now: () => clock++,
    });

    const direct = await packKnowledgeBaseEvaluationContextV2({
      corpus: sealedCorpus,
      result: retrieverResult(),
      evidenceRegistry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    });
    const packed = await composed.pack({
      contract: packingContract(sealedCorpus),
      descriptor: laneDescriptors.exact,
      profileId: "packing",
      queryId: sealedCorpus.queries[0]!.id,
      result: retrieverResult(),
      repetition: 1,
      signal: new AbortController().signal,
    });
    expect(packed).toEqual({
      durationMs: 1,
      packedContext: { utf8Bytes: direct.utf8Bytes, readerTokens: direct.readerTokens },
      includedEvidenceUnitIds: [evidenceUnit.id],
      truncated: false,
      packedBytesSha256: direct.packedBytesSha256,
    });

    await composed.measureRetrieverOperation({
      operation: "cold-index",
      corpus: sealedCorpus,
      descriptor: laneDescriptors.exact,
      profile: profiles[0]!,
      repetition: 1,
      signal: new AbortController().signal,
    });
    await composed.verifyWarmCacheFingerprint({
      profileId: "warm-query",
      operation: "warm-query",
      repetition: 1,
      phase: "before",
      signal: new AbortController().signal,
    });
    const batch = await composed.openFourReaderBatch({
      profileId: "four-reader-query",
      repetition: 1,
      signal: new AbortController().signal,
    });
    expect(batch).toMatchObject({
      id: sealedCorpus.experiment.environment.fourReaderBatch.id,
      sha256: sealedCorpus.experiment.environment.fourReaderBatch.sha256,
    });
    expect(batch.evaluations).toHaveLength(4);
    expect(new Set(batch.evaluations).size).toBe(4);
    expect(openedIndices).toEqual([0, 1, 2, 3]);
    await batch.verifyCacheFingerprint(new AbortController().signal);
    await batch.verifyCacheFingerprint(new AbortController().signal);
    await composed.verifyWarmCacheFingerprint({
      profileId: "packing",
      operation: "packing",
      repetition: 1,
      phase: "after",
      signal: new AbortController().signal,
    });
    expect(liveVerifications).toBe(4);
    await Promise.all(batch.evaluations.map(({ close }) => close()));
    expect(closes).toBe(4);
  });

  test("closes every partial session when opening a four-reader batch fails", async () => {
    const sealedCorpus = corpus();
    let closes = 0;
    const composed = dependencies({
      corpus: sealedCorpus,
      openEvaluation: ({ readerIndex }) => {
        if (readerIndex === 2) return Promise.reject(new Error("third open failed"));
        return Promise.resolve(verifiedEvaluation(sealedCorpus, () => {
          closes += 1;
          return Promise.resolve();
        }));
      },
    });
    const failure = await rejected(composed.openFourReaderBatch({
      profileId: "four-reader-query",
      repetition: 1,
      signal: new AbortController().signal,
    }));
    expect(errorMessage(failure)).toContain("third open failed");
    expect(closes).toBe(2);
  });

  test("cleanup-owns a returned session before rejecting its missing verification brand", async () => {
    const sealedCorpus = corpus();
    let closes = 0;
    const malformed = Object.freeze({
      retrievers: Object.freeze([]),
      close: () => {
        closes += 1;
        return Promise.resolve();
      },
    }) as unknown as KnowledgeBaseEvaluationV2;
    const composed = dependencies({
      corpus: sealedCorpus,
      openEvaluation: () => Promise.resolve(malformed),
    });
    const failure = await rejected(composed.openFourReaderBatch({
      profileId: "four-reader-query",
      repetition: 1,
      signal: new AbortController().signal,
    }));
    expect(errorMessage(failure)).toContain("not the implementation-bound adapter");
    expect(closes).toBe(1);
  });

  test("rejects a duplicate reader session and closes it exactly once", async () => {
    const sealedCorpus = corpus();
    let closes = 0;
    const first = verifiedEvaluation(sealedCorpus, () => {
      closes += 1;
      return Promise.resolve();
    });
    const composed = dependencies({
      corpus: sealedCorpus,
      openEvaluation: () => Promise.resolve(first),
    });
    const failure = await rejected(composed.openFourReaderBatch({
      profileId: "four-reader-query",
      repetition: 1,
      signal: new AbortController().signal,
    }));
    expect(errorMessage(failure)).toContain("duplicate or reused session");
    expect(closes).toBe(1);
  });

  test("rejects forged or mismatched cache verifiers and fails on live drift", async () => {
    const sealedCorpus = corpus();
    const registered = cacheVerifier();
    const forged = { ...registered } as unknown as KnowledgeBaseEvaluationCacheVerifierV2;
    expect(() => dependencies({ corpus: sealedCorpus, verifier: forged })).toThrow(
      "not a registered capability",
    );

    const mismatched = createKnowledgeBaseEvaluationCacheVerifierV2({
      preparation: CACHE_PREPARATION,
      definition: "Different cache definition.\n",
      verify: () => CACHE_SHA256,
    });
    expect(() => dependencies({ corpus: sealedCorpus, verifier: mismatched })).toThrow(
      "does not match the sealed preparation and definition digest",
    );

    const drifting = dependencies({
      corpus: sealedCorpus,
      verifier: cacheVerifier(() => "f".repeat(64)),
    });
    const failure = await rejected(drifting.verifyWarmCacheFingerprint({
      profileId: "warm-query",
      operation: "warm-query",
      repetition: 1,
      phase: "before",
      signal: new AbortController().signal,
    }));
    expect(errorMessage(failure)).toContain("drifted from the sealed definition digest");
  });

  test("rejects forged or mismatched four-reader opener capabilities", () => {
    const sealedCorpus = corpus();
    const registered = fourReaderOpener(sealedCorpus);
    const forged = { ...registered } as unknown as KnowledgeBaseEvaluationFourReaderOpenerV2;
    expect(() => dependencies({ corpus: sealedCorpus, opener: forged })).toThrow(
      "not a registered capability",
    );

    const mismatched = createKnowledgeBaseEvaluationFourReaderOpenerV2({
      id: FOUR_READER_ID,
      definition: "Different four-reader opener.\n",
      open: () => Promise.resolve(verifiedEvaluation(sealedCorpus)),
    });
    expect(() => dependencies({ corpus: sealedCorpus, opener: mismatched })).toThrow(
      "does not match the sealed batch identity and definition digest",
    );
  });

  test("rejects tokenizer/corpus mismatch and defers structural forgery to the branded packer", async () => {
    const sealedCorpus = corpus();
    const alternate = createEvaluationReaderTokenizerV2({
      id: "execution-test-tokenizer-v1",
      definition: "Execution test tokenizer: one token per input.\n",
      count: (text) => text === "" ? 0 : 1,
    });
    expect(() => dependencies({ corpus: sealedCorpus, tokenizer: alternate })).toThrow(
      "does not match the sealed corpus",
    );

    const forged = {
      id: utf8ByteEvaluationReaderTokenizerV2.id,
      sha256: utf8ByteEvaluationReaderTokenizerV2.sha256,
      count: () => 0,
    } as unknown as EvaluationReaderTokenizerV2;
    const composed = dependencies({ corpus: sealedCorpus, tokenizer: forged });
    const failure = await rejected(composed.pack({
      contract: packingContract(sealedCorpus),
      descriptor: laneDescriptors.exact,
      profileId: "packing",
      queryId: sealedCorpus.queries[0]!.id,
      result: retrieverResult(),
      repetition: 1,
      signal: new AbortController().signal,
    }));
    expect(errorMessage(failure)).toContain("not a registered tokenizer capability");
  });
});
