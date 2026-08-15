import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  evaluationCandidateLockDigestV2,
  evaluationCorpusDigestV2,
  evaluationCorpusGitBlobCommitmentV2,
  evaluationRetrieverDescriptorDigestV2,
  evaluationSourceFamilyClusterIdsV2,
  parseRetrievalEvaluationCorpusV2,
  parseRetrievalEvaluationReportV2,
  projectEvaluationExecutionQueryV2,
  requiredPairedObservationsV2,
  validatePromotionCorpusV2,
  type EvaluationMinimumUsefulEffectMetricV2,
  type EvaluationNonInferiorityMetricV2,
  type EvaluationRepeatedSampleV2,
  type EvaluationStratumV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

type MutableCorpus = DeepMutable<RetrievalEvaluationCorpusV2>;

const ZERO_SHA = "0".repeat(64);
const NON_PROMOTION = { claimPromotion: false } as const;

function hexId(prefix: string, index: number): string {
  return `${prefix}-${index.toString(16).padStart(16, "0")}`;
}

function registryUnitId(index: number): string {
  return `eeu:evaluation-evidence-v1:${index.toString(16).padStart(64, "0")}`;
}

function experiment(): DeepMutable<RetrievalEvaluationCorpusV2["experiment"]> {
  const pairedPower = {
    alpha: 0.05,
    targetPower: 0.8,
    assumedDiscordantRate: 0.25,
    assumedEffect: 0.25,
    minimumUsefulEffect: 0.05,
  } as const;
  return {
    protocol: {
      minimumUsefulEffects: (["nugget-coverage"] as readonly EvaluationMinimumUsefulEffectMetricV2[]).map((metric) => ({
        metric,
        cohort: "caller-seeded" as const,
        minimumAbsoluteDifference: 0.05,
      })),
      nonInferiorityMargins: ([
        "active-current-state-accuracy",
        "code-path-context-accuracy",
        "conceptual-recall-accuracy",
        "document-recall-at-k",
        "evidence-recall-at-k",
        "exact-identity-accuracy",
        "four-reader-query-p95-ms",
        "local-context-accuracy",
        "metadata-constraint-accuracy",
        "multi-note-relational-accuracy",
        "packing-p95-ms",
        "source-provenance-accuracy",
        "temporal-stale-current-accuracy",
        "warm-query-p95-ms",
      ] as readonly EvaluationNonInferiorityMetricV2[]).map((metric) => ({
        metric,
        maximumAbsoluteRegression: metric.endsWith("-p95-ms") ? 50 : 0.02,
        maximumRelativeRegression: 0.25,
      })).toSorted((left, right) => left.metric.localeCompare(right.metric)),
      pairedPower: {
        ...pairedPower,
        requiredPairs: requiredPairedObservationsV2(pairedPower),
      },
      contextCeilings: { utf8Bytes: 16_384, readerTokens: 4_096 },
    },
    environment: {
      tokenizer: { id: "tokenizer-v1", sha256: "1".repeat(64) },
      runtime: { id: "bun-1.3.14-darwin-arm64", sha256: "2".repeat(64) },
      hardware: { id: "apple-silicon-8-core-16-gib" },
      localModel: { kind: "none" as const },
      cache: {
        preparation: "Delete the isolated evaluator cache, build once, then retain the frozen generation.",
        fingerprintSha256: "3".repeat(64),
      },
      fourReaderBatch: { id: "four-reader-driver-v1", sha256: "4".repeat(64) },
      incrementalMutation: {
        sourcePath: "notes/incremental-fixture.md",
        appendUtf8Sha256: "5".repeat(64),
        expectedPostMutationSha256: "6".repeat(64),
      },
    },
  };
}

function rawAssessmentFor(
  assessorId: string,
  query: MutableCorpus["queries"][number],
): MutableCorpus["queries"][number]["rawAssessments"][number] {
  return {
    assessorId,
    expectedSupport: query.expectedSupport,
    documents: structuredClone(query.gold.documents),
    evidenceUnits: structuredClone(query.gold.evidenceUnits),
    nuggets: query.gold.nuggets.map((nugget) => ({
      nuggetId: nugget.id,
      required: nugget.required,
      acceptableSupportSetIds: nugget.acceptableSupportSets.map(({ id }) => id),
    })),
  };
}

function sealCorpus(corpus: MutableCorpus): MutableCorpus {
  corpus.candidateLock.candidateRetrieverIds = corpus.retrievers
    .filter(({ role }) => role === "candidate")
    .map(({ id }) => id);
  corpus.candidateLock.descriptorDigests = corpus.retrievers.map((descriptor) => ({
    retrieverId: descriptor.id,
    sha256: evaluationRetrieverDescriptorDigestV2(descriptor),
  }));
  corpus.manifest.candidateLockSha256 = evaluationCandidateLockDigestV2(corpus.candidateLock);
  corpus.manifest.corpusSha256 = ZERO_SHA;
  corpus.manifest.corpusSha256 = evaluationCorpusDigestV2(corpus);
  return corpus;
}

function baseCorpus(): MutableCorpus {
  const query: MutableCorpus["queries"][number] = {
    id: hexId("q", 1),
    text: "Where is the current policy?",
    split: "development",
    cohort: "text-only",
    strata: ["conceptual-recall"],
    primaryStratum: "conceptual-recall",
    expectedSupport: "supported",
    primaryLane: "hybrid",
    inputs: { text: "Where is the current policy?" },
    inputOrigins: [{ lane: "text", origin: "query-text" }],
    gold: {
      documents: [{ documentId: "development/policy.md", relevance: 3 }],
      evidenceUnits: [{ evidenceUnitId: registryUnitId(1), relevance: 3 }],
      nuggets: [{
        id: hexId("ng", 1),
        text: "The policy lives in the maintained note.",
        required: true,
        acceptableSupportSets: [{
          id: hexId("ss", 1),
          evidenceUnitIds: [registryUnitId(1)],
        }],
      }],
    },
    rawAssessments: [],
    adjudication: { status: "single-assessor" },
  };
  query.rawAssessments = [rawAssessmentFor("assessor-a", query)];
  return sealCorpus({
    schemaVersion: 2,
    id: "evaluation-suite",
    description: "A strict evaluator v2 fixture.",
    manifest: {
      protocol: "kb-retrieval-evaluation-v2",
      sealedAt: "2026-08-05T12:00:00.000Z",
      corpusSha256: ZERO_SHA,
      candidateLockSha256: ZERO_SHA,
      buildContractSha256: "e".repeat(64),
    },
    frozen: {
      repositoryCommit: "a".repeat(40),
      vaultTree: "b".repeat(40),
      vaultRoot: "kb",
    },
    assessment: {
      rubricVersion: "rubric-v2",
      assessors: [{ id: "assessor-a" }, { id: "assessor-b" }],
    },
    experiment: experiment(),
    sourceFamilies: [{
      id: hexId("sf", 1),
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    }],
    documents: [{
      id: "development/policy.md",
      sourcePath: "development/policy.md",
      sourceFamilyId: hexId("sf", 1),
      trustClass: "authoritative-current",
    }],
    evidenceUnits: [{
      id: registryUnitId(1),
      documentId: "development/policy.md",
      sourceFamilyId: hexId("sf", 1),
      trustClass: "authoritative-current",
      sourcePath: "development/policy.md",
      lineRange: { start: 1, end: 3 },
      headingPath: ["Policy"],
    }],
    measurementProfiles: [{
      id: "warm-query",
      operation: "warm-query",
      scope: "query",
      cacheState: "warm",
      concurrency: 1,
      repetitions: 1,
    }],
    retrievers: [{
      id: "baseline",
      role: "baseline",
      version: "1",
      implementationSha256: "c".repeat(64),
      lanes: ["hybrid"],
      configuration: { "output-limit": 10 },
    }, {
      id: "candidate",
      role: "candidate",
      version: "1",
      implementationSha256: "d".repeat(64),
      lanes: ["hybrid"],
      configuration: { "output-limit": 10 },
    }],
    candidateLock: {
      baselineRetrieverId: "baseline",
      candidateRetrieverIds: [],
      descriptorDigests: [],
    },
    queries: [query],
  });
}

function promotionCorpus(): MutableCorpus {
  const queries: MutableCorpus["queries"] = [];
  const sourceFamilies: MutableCorpus["sourceFamilies"] = [];
  const documents: MutableCorpus["documents"] = [];
  const evidenceUnits: MutableCorpus["evidenceUnits"] = [];
  const smallerStrata = [
    "active-current-state",
    "code-path-context",
    "conceptual-recall",
    "exact-identity",
    "metadata-constraint",
  ] as const;
  const criticalStrata = [
    "local-context",
    "multi-note-relational",
    "source-provenance",
    "temporal-stale-current",
  ] as const;
  for (let index = 0; index < 168; index += 1) {
    const split = index < 48 ? "development" : "test";
    const splitIndex = index < 48 ? index : index - 48;
    const cohort = split === "development"
      ? splitIndex < 24 ? "caller-seeded" : "text-only"
      : splitIndex < 60 ? "caller-seeded" : "text-only";
    const cohortIndex = split === "development" ? splitIndex % 24 : splitIndex % 60;
    const supported = split === "development" ? cohortIndex < 12 : cohortIndex % 3 !== 2;
    const primaryStratum = split === "development"
      ? "conceptual-recall" as const
      : cohortIndex < 20
        ? smallerStrata[Math.floor(cohortIndex / 4)]!
        : criticalStrata[Math.floor((cohortIndex - 20) / 10)]!;
    const documentId = `${split}/${index.toString().padStart(4, "0")}.md`;
    const familyId = hexId("sf", index + 1);
    const unitId = registryUnitId(index + 1);
    const nuggetId = hexId("ng", index + 1);
    const supportSetId = hexId("ss", index + 1);
    sourceFamilies.push({
      id: familyId,
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
      familyAssignmentSha256: (index + 1).toString(16).padStart(64, "0"),
    });
    documents.push({
      id: documentId,
      sourcePath: documentId,
      sourceFamilyId: familyId,
      trustClass: "authoritative-current",
    });
    evidenceUnits.push({
      id: unitId,
      documentId,
      sourceFamilyId: familyId,
      trustClass: "authoritative-current",
      sourcePath: documentId,
      lineRange: { start: 1, end: 1 },
      headingPath: [],
    });
    const text = `Opaque evaluation prompt ${index + 1}`;
    const inputs: MutableCorpus["queries"][number]["inputs"] = cohort === "text-only"
      ? { text }
      : {
          text,
          metadata: { filters: [], tags: ["promotion"] },
          graph: { seeds: [documentId], depth: 1 },
          context: { repositoryPath: "projects/app" },
          history: { query: text, noteIds: [documentId] },
        };
    const query: MutableCorpus["queries"][number] = {
      id: hexId("q", index + 1),
      text,
      split,
      cohort,
      strata: (supported ? [primaryStratum] : [primaryStratum, "no-answer-near-miss"])
        .toSorted() as EvaluationStratumV2[],
      primaryStratum,
      expectedSupport: supported ? "supported" : "insufficient",
      primaryLane: "hybrid",
      ...(supported ? {} : { negativeSubtype: "topical-near-miss" as const }),
      inputs,
      inputOrigins: cohort === "text-only"
        ? [{ lane: "text", origin: "query-text" }]
        : [
            { lane: "context", origin: "caller" },
            { lane: "graph", origin: "caller" },
            { lane: "history", origin: "caller" },
            { lane: "metadata", origin: "caller" },
            { lane: "text", origin: "query-text" },
          ],
      gold: {
        documents: [{ documentId, relevance: supported ? 3 : 1 }],
        evidenceUnits: [{ evidenceUnitId: unitId, relevance: supported ? 3 : 1 }],
        nuggets: [{
          id: nuggetId,
          text: `Required fact ${index + 1}`,
          required: true,
          acceptableSupportSets: supported
            ? [{ id: supportSetId, evidenceUnitIds: [unitId] }]
            : [],
        }],
      },
      rawAssessments: [],
      adjudication: { status: "single-assessor" },
    };
    const primaryOrdinal = cohortIndex < 20 ? cohortIndex % 4 : cohortIndex % 10;
    const dual = split === "test" && (
      primaryOrdinal < (cohortIndex < 20 ? 2 : 3)
      || (!supported && cohortIndex < 15)
    );
    query.rawAssessments = [rawAssessmentFor("assessor-a", query)];
    if (dual) {
      query.rawAssessments.push(rawAssessmentFor("assessor-b", query));
      query.adjudication = { status: "agreed" };
    }
    queries.push(query);
  }
  const seed = baseCorpus();
  seed.sourceFamilies = sourceFamilies;
  seed.documents = documents;
  seed.evidenceUnits = evidenceUnits;
  seed.queries = queries;
  seed.measurementProfiles = [
    { id: "cold-index", operation: "cold-index", scope: "retriever", cacheState: "cold", concurrency: 1, repetitions: 3 },
    { id: "four-reader-query", operation: "four-reader-query", scope: "query", cacheState: "warm", concurrency: 4, repetitions: 3 },
    { id: "incremental-update", operation: "incremental-update", scope: "retriever", cacheState: "changed-generation", concurrency: 1, repetitions: 3 },
    { id: "packing", operation: "packing", scope: "query", cacheState: "warm", concurrency: 1, repetitions: 3 },
    { id: "warm-query", operation: "warm-query", scope: "query", cacheState: "warm", concurrency: 1, repetitions: 3 },
  ];
  return sealCorpus(seed);
}

function locatorFor(
  corpus: MutableCorpus,
  unit: MutableCorpus["evidenceUnits"][number],
) {
  const family = corpus.sourceFamilies.find(({ id }) => id === unit.sourceFamilyId);
  if (family === undefined) throw new Error("fixture source family is missing");
  return {
    evidenceUnitId: unit.id,
    sourceFamilyId: unit.sourceFamilyId,
    sourceClass: family.sourceClass,
    trustClass: unit.trustClass,
    sourcePath: unit.sourcePath,
    lineRange: structuredClone(unit.lineRange),
    headingPath: structuredClone(unit.headingPath),
    ...(unit.sourcePage === undefined ? {} : { sourcePage: unit.sourcePage }),
  };
}

function sampleFor(
  retrieverId: string,
  corpus: MutableCorpus,
): DeepMutable<EvaluationRepeatedSampleV2> {
  const unit = corpus.evidenceUnits[0];
  const document = corpus.documents[0];
  const query = corpus.queries[0];
  if (unit === undefined || document === undefined || query === undefined) {
    throw new Error("fixture evidence is missing");
  }
  const provenance = [locatorFor(corpus, unit)];
  return {
    retrieverId,
    profileId: "warm-query",
    queryId: query.id,
    repetition: 1,
    status: "ready",
    timings: { elapsedMs: 4, indexMs: 0, updateMs: 0, queryMs: 3, packingMs: 1 },
    resources: {
      llm: { calls: 0, inputTokens: 0, outputTokens: 0 },
      embedding: { calls: 1, inputTokens: 12, durationMs: 2 },
      packedContext: { utf8Bytes: 256, readerTokens: 64 },
      peakRssBytes: 1_024,
      cacheBytes: 512,
    },
    trace: {
      laneOutcomes: [{
        laneId: "hybrid",
        applicability: "applied",
        status: "ready",
        reasonCodes: [],
        rawRanking: [{
          documentId: document.id,
          evidenceUnitIds: [unit.id],
          rank: 1,
          score: 0.9,
          provenance: structuredClone(provenance),
        }],
      }],
      candidateDecisions: [{
        documentId: document.id,
        evidenceUnitIds: [unit.id],
        laneId: "hybrid",
        sourceRank: 1,
        disposition: "accepted",
        reasonCodes: ["primary"],
        outputRank: 1,
        provenance: structuredClone(provenance),
      }],
    },
    rawEvidence: [{
      laneId: "hybrid",
      documentId: document.id,
      rank: 1,
      evidence: { source: "fixture", queryId: query.id },
    }],
  };
}

function reportFor(corpus: MutableCorpus) {
  return {
    schemaVersion: 2,
    suiteSha256: corpus.manifest.corpusSha256,
    candidateLockSha256: corpus.manifest.candidateLockSha256,
    split: "development" as const,
    samples: [sampleFor("baseline", corpus), sampleFor("candidate", corpus)],
  };
}

const EMPTY_PACKED_SHA256 = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
const FIXTURE_PACKED_SHA256 = createHash("sha256").update("packed fixture", "utf8").digest("hex");

function packingCorpus(): MutableCorpus {
  const corpus = baseCorpus();
  corpus.measurementProfiles[0] = {
    id: "packing",
    operation: "packing",
    scope: "query",
    cacheState: "warm",
    concurrency: 1,
    repetitions: 1,
  };
  return sealCorpus(corpus);
}

function packingReportFor(corpus: MutableCorpus) {
  const report = reportFor(corpus);
  for (const sample of report.samples) {
    sample.profileId = "packing";
    sample.packedContextTrace = {
      evidenceUnitIds: [corpus.evidenceUnits[0]!.id],
      truncated: false,
      packedBytesSha256: FIXTURE_PACKED_SHA256,
    };
  }
  return report;
}

function addSecondFixtureEvidence(corpus: MutableCorpus) {
  const secondUnit = {
    id: registryUnitId(2),
    documentId: corpus.documents[0]!.id,
    sourceFamilyId: corpus.sourceFamilies[0]!.id,
    trustClass: "authoritative-current" as const,
    sourcePath: corpus.evidenceUnits[0]!.sourcePath,
    lineRange: { start: 5, end: 6 },
    headingPath: ["Policy", "Details"],
  };
  corpus.evidenceUnits.push(secondUnit);
  sealCorpus(corpus);
  return secondUnit;
}

function twoEvidencePackingFixture() {
  const corpus = packingCorpus();
  const secondUnit = addSecondFixtureEvidence(corpus);
  const firstUnit = corpus.evidenceUnits[0]!;
  const report = packingReportFor(corpus);
  const evidenceUnitIds = [firstUnit.id, secondUnit.id];
  const provenance = [locatorFor(corpus, firstUnit), locatorFor(corpus, secondUnit)];
  for (const sample of report.samples) {
    sample.trace.laneOutcomes[0]!.rawRanking[0]!.evidenceUnitIds = structuredClone(evidenceUnitIds);
    sample.trace.laneOutcomes[0]!.rawRanking[0]!.provenance = structuredClone(provenance);
    sample.trace.candidateDecisions[0]!.evidenceUnitIds = structuredClone(evidenceUnitIds);
    sample.trace.candidateDecisions[0]!.provenance = structuredClone(provenance);
    sample.packedContextTrace!.evidenceUnitIds = structuredClone(evidenceUnitIds);
  }
  return { corpus, report, firstUnit, secondUnit };
}

function parseCorpus(corpus: unknown) {
  return parseRetrievalEvaluationCorpusV2(corpus, NON_PROMOTION);
}

function validatePromotion(
  corpus: MutableCorpus,
  expectedCorpusSha256 = corpus.manifest.corpusSha256,
) {
  return validatePromotionCorpusV2(corpus, { expectedCorpusSha256 });
}

describe("evaluation v2 corpus", () => {
  test("requires an explicit non-promotion claim and digest-covers the experiment and build contracts", () => {
    const corpus = baseCorpus();
    const unaryParser = parseRetrievalEvaluationCorpusV2 as unknown as (input: unknown) => unknown;
    expect(() => unaryParser(corpus)).toThrow("explicit promotion claim");
    expect(() => parseRetrievalEvaluationCorpusV2(corpus, {
      claimPromotion: true,
      expectedSeal: { expectedCorpusSha256: corpus.manifest.corpusSha256 },
    })).toThrow("exactly 168");

    const changedEnvironment = structuredClone(corpus);
    changedEnvironment.experiment.environment.hardware.id = "different-hardware";
    expect(() => parseCorpus(changedEnvironment)).toThrow("corpusSha256");

    const changedBuildContract = structuredClone(corpus);
    changedBuildContract.manifest.buildContractSha256 = "8".repeat(64);
    expect(() => parseCorpus(changedBuildContract)).toThrow("corpusSha256");
    expect(changedBuildContract.manifest.candidateLockSha256).toBe(
      corpus.manifest.candidateLockSha256,
    );

    const changedEffectCohort = structuredClone(corpus);
    changedEffectCohort.experiment.protocol.minimumUsefulEffects[0]!.cohort = "text-only";
    expect(() => parseCorpus(changedEffectCohort)).toThrow("corpusSha256");

    const invalidEffectCohort = structuredClone(corpus);
    invalidEffectCohort.experiment.protocol.minimumUsefulEffects[0]!.cohort =
      "all" as "caller-seeded";
    sealCorpus(invalidEffectCohort);
    expect(() => parseCorpus(invalidEffectCohort)).toThrow("caller-seeded or text-only");

    const duplicateEffect = structuredClone(corpus);
    duplicateEffect.experiment.protocol.minimumUsefulEffects.splice(
      1,
      0,
      structuredClone(duplicateEffect.experiment.protocol.minimumUsefulEffects[0]!),
    );
    sealCorpus(duplicateEffect);
    expect(() => parseCorpus(duplicateEffect)).toThrow("must not repeat an ID");

    const bothCohorts = structuredClone(corpus);
    bothCohorts.experiment.protocol.minimumUsefulEffects.splice(1, 0, {
      metric: "document-recall-at-k",
      cohort: "text-only",
      minimumAbsoluteDifference: 0.04,
    });
    bothCohorts.experiment.protocol.minimumUsefulEffects.sort((left, right) =>
      `${left.metric}:${left.cohort}`.localeCompare(`${right.metric}:${right.cohort}`));
    sealCorpus(bothCohorts);
    expect(parseCorpus(bothCohorts).experiment.protocol.minimumUsefulEffects.slice(0, 2))
      .toEqual(bothCohorts.experiment.protocol.minimumUsefulEffects.slice(0, 2));

    const falsePowerCount = structuredClone(corpus);
    falsePowerCount.experiment.protocol.pairedPower.requiredPairs += 1;
    sealCorpus(falsePowerCount);
    expect(() => parseCorpus(falsePowerCount)).toThrow("must equal the derived count");

    expect(requiredPairedObservationsV2({
      alpha: 0.05,
      targetPower: 0.8,
      assumedDiscordantRate: 0.25,
      assumedEffect: 0.25,
      minimumUsefulEffect: 0.05,
    })).toBe(35);

    const changedMutation = structuredClone(corpus);
    changedMutation.experiment.environment.incrementalMutation.appendUtf8Sha256 = "7".repeat(64);
    expect(() => parseCorpus(changedMutation)).toThrow("corpusSha256");

    const traversingMutation = structuredClone(corpus);
    traversingMutation.experiment.environment.incrementalMutation.sourcePath = "../outside.md";
    sealCorpus(traversingMutation);
    expect(() => parseCorpus(traversingMutation)).toThrow("confined");

    const uppercaseMutationDigest = structuredClone(corpus);
    uppercaseMutationDigest.experiment.environment.incrementalMutation.expectedPostMutationSha256 =
      "A".repeat(64);
    sealCorpus(uppercaseMutationDigest);
    expect(() => parseCorpus(uppercaseMutationDigest)).toThrow(
      "64 lowercase hexadecimal characters",
    );

    const emptyEffects = structuredClone(corpus);
    emptyEffects.experiment.protocol.minimumUsefulEffects = [];
    sealCorpus(emptyEffects);
    expect(() => parseCorpus(emptyEffects)).toThrow("minimumUsefulEffects");

    const zeroQualityMargin = structuredClone(corpus);
    const qualityMargin = zeroQualityMargin.experiment.protocol.nonInferiorityMargins.find(
      ({ metric }) => metric === "document-recall-at-k",
    );
    if (qualityMargin === undefined) throw new Error("Fixture lacks its quality margin.");
    qualityMargin.maximumAbsoluteRegression = 0;
    qualityMargin.maximumRelativeRegression = 0;
    sealCorpus(zeroQualityMargin);
    expect(parseCorpus(zeroQualityMargin).experiment.protocol.nonInferiorityMargins)
      .toContainEqual(qualityMargin);

    const zeroLatencyMargin = structuredClone(corpus);
    const latencyMargin = zeroLatencyMargin.experiment.protocol.nonInferiorityMargins.find(
      ({ metric }) => metric === "warm-query-p95-ms",
    );
    if (latencyMargin === undefined) throw new Error("Fixture lacks its latency margin.");
    latencyMargin.maximumAbsoluteRegression = 0;
    latencyMargin.maximumRelativeRegression = 0;
    sealCorpus(zeroLatencyMargin);
    expect(() => parseCorpus(zeroLatencyMargin)).toThrow("non-zero latency margin");
  });

  test("parses a sealed strict corpus and rejects unknown fields or a changed commitment", () => {
    const corpus = baseCorpus();
    const parsed = parseCorpus(corpus);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.manifest.buildContractSha256).toBe("e".repeat(64));
    expect(Object.isFrozen(parsed)).toBe(true);

    const missingBuildContract = structuredClone(corpus) as Omit<MutableCorpus, "manifest"> & {
      manifest: Partial<MutableCorpus["manifest"]>;
    };
    delete missingBuildContract.manifest.buildContractSha256;
    expect(() => parseCorpus(missingBuildContract)).toThrow("manifest.buildContractSha256");

    const invalidBuildContract = structuredClone(corpus);
    invalidBuildContract.manifest.buildContractSha256 = "E".repeat(64);
    expect(() => parseCorpus(invalidBuildContract)).toThrow(
      "manifest.buildContractSha256 must be 64 lowercase hexadecimal characters",
    );

    const unknown = structuredClone(corpus) as MutableCorpus & { surprise?: boolean };
    unknown.surprise = true;
    sealCorpus(unknown);
    expect(() => parseCorpus(unknown)).toThrow("unknown fields");

    const changed = structuredClone(corpus);
    changed.description = "Changed after the seal.";
    expect(() => parseCorpus(changed)).toThrow("corpusSha256");

    const familyCommitment = structuredClone(corpus);
    familyCommitment.sourceFamilies[0]!.familyAssignmentSha256 = "f".repeat(64);
    sealCorpus(familyCommitment);
    expect(parseCorpus(familyCommitment).sourceFamilies[0]?.familyAssignmentSha256).toBe(
      "f".repeat(64),
    );

    const malformedFamilyCommitment = structuredClone(familyCommitment);
    malformedFamilyCommitment.sourceFamilies[0]!.familyAssignmentSha256 = "F".repeat(64);
    sealCorpus(malformedFamilyCommitment);
    expect(() => parseCorpus(malformedFamilyCommitment)).toThrow(
      "sourceFamilies[0].familyAssignmentSha256 must be 64 lowercase hexadecimal characters",
    );

    const unknownFamilyField = structuredClone(corpus) as MutableCorpus & {
      sourceFamilies: (MutableCorpus["sourceFamilies"][number] & { reviewerIds?: string[] })[];
    };
    unknownFamilyField.sourceFamilies[0]!.reviewerIds = ["private-reviewer"];
    sealCorpus(unknownFamilyField);
    expect(() => parseCorpus(unknownFamilyField)).toThrow("unknown fields");
  });

  test("binds every catalog document to one source path without requiring a qrel", () => {
    const corpus = baseCorpus();
    corpus.sourceFamilies.push({
      id: hexId("sf", 2),
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    });
    corpus.documents.push({
      id: "notes/unjudged.md",
      sourcePath: "notes/unjudged.md",
      sourceFamilyId: hexId("sf", 2),
      trustClass: "authoritative-current",
    });
    corpus.evidenceUnits.push({
      id: registryUnitId(2),
      documentId: "notes/unjudged.md",
      sourceFamilyId: hexId("sf", 2),
      trustClass: "authoritative-current",
      sourcePath: "notes/unjudged.md",
      lineRange: { start: 1, end: 1 },
      headingPath: [],
    });
    sealCorpus(corpus);
    expect(parseCorpus(corpus).documents.at(-1)?.sourcePath).toBe("notes/unjudged.md");

    const mismatched = structuredClone(corpus);
    mismatched.evidenceUnits.at(-1)!.sourcePath = "notes/other.md";
    sealCorpus(mismatched);
    expect(() => parseCorpus(mismatched)).toThrow("source path disagrees with document");
  });

  test("fails closed when a descriptor changes after the candidate lock", () => {
    const corpus = baseCorpus();
    corpus.retrievers[1]!.configuration["output-limit"] = 11;
    corpus.manifest.corpusSha256 = evaluationCorpusDigestV2(corpus);
    expect(() => parseCorpus(corpus)).toThrow("descriptor digest");
  });

  test("allows a topically relevant insufficient near miss without complete nugget support", () => {
    const corpus = baseCorpus();
    const query = corpus.queries[0]!;
    query.expectedSupport = "insufficient";
    query.negativeSubtype = "topical-near-miss";
    query.gold.documents[0]!.relevance = 1;
    query.gold.evidenceUnits[0]!.relevance = 1;
    query.gold.nuggets[0]!.acceptableSupportSets = [];
    query.rawAssessments = [rawAssessmentFor("assessor-a", query)];
    sealCorpus(corpus);
    const parsed = parseCorpus(corpus);
    expect(parsed.queries[0]?.gold.documents[0]?.relevance).toBe(1);
    expect(parsed.queries[0]?.gold.evidenceUnits[0]?.relevance).toBe(1);
  });

  test("requires explicit adjudication for independent assessor disagreement", () => {
    const corpus = baseCorpus();
    const query = corpus.queries[0]!;
    const second = rawAssessmentFor("assessor-b", query);
    second.documents[0]!.relevance = 2;
    query.rawAssessments.push(second);
    query.adjudication = { status: "agreed" };
    sealCorpus(corpus);
    expect(() => parseCorpus(corpus)).toThrow("disagreement");

    query.adjudication = {
      status: "resolved",
      adjudicatorId: "assessor-a",
      rationale: "The maintained note is the stronger document-level match.",
    };
    sealCorpus(corpus);
    expect(parseCorpus(corpus).queries[0]?.adjudication.status).toBe("resolved");
  });

  test("rejects traversal, invalid ranges, broken evidence references, and noncanonical order", () => {
    const traversal = baseCorpus();
    traversal.evidenceUnits[0]!.sourcePath = "../outside.md";
    sealCorpus(traversal);
    expect(() => parseCorpus(traversal)).toThrow("confined");

    const range = baseCorpus();
    range.evidenceUnits[0]!.lineRange = { start: 4, end: 3 };
    sealCorpus(range);
    expect(() => parseCorpus(range)).toThrow("precede");

    const reference = baseCorpus();
    reference.queries[0]!.gold.evidenceUnits[0]!.evidenceUnitId = registryUnitId(99);
    reference.queries[0]!.rawAssessments[0]!.evidenceUnits[0]!.evidenceUnitId = registryUnitId(99);
    sealCorpus(reference);
    expect(() => parseCorpus(reference)).toThrow("unknown unit");

    const order = baseCorpus();
    order.assessment.assessors.reverse();
    sealCorpus(order);
    expect(() => parseCorpus(order)).toThrow("canonical ID order");
  });

  test("binds registry evidence identity, source paths, trust classes, and heading ancestry", () => {
    const registryId = baseCorpus();
    registryId.evidenceUnits[0]!.id = hexId("eu", 1);
    registryId.queries[0]!.gold.evidenceUnits[0]!.evidenceUnitId = hexId("eu", 1);
    registryId.queries[0]!.gold.nuggets[0]!.acceptableSupportSets[0]!.evidenceUnitIds = [hexId("eu", 1)];
    registryId.queries[0]!.rawAssessments = [rawAssessmentFor("assessor-a", registryId.queries[0]!)];
    sealCorpus(registryId);
    expect(() => parseCorpus(registryId)).toThrow("registry-compatible");

    const trust = baseCorpus();
    trust.sourceFamilies[0]!.sourceClass = "captured-source";
    sealCorpus(trust);
    expect(() => parseCorpus(trust)).toThrow("incompatible");

    const heading = baseCorpus();
    heading.evidenceUnits[0]!.headingPath = [" Policy"];
    sealCorpus(heading);
    expect(() => parseCorpus(heading)).toThrow("leading or trailing whitespace");

    const relabeledPath = baseCorpus();
    relabeledPath.sourceFamilies.push({
      id: hexId("sf", 2),
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    });
    relabeledPath.documents.push({
      id: "development/second.md",
      sourcePath: "development/second.md",
      sourceFamilyId: hexId("sf", 2),
      trustClass: "authoritative-current",
    });
    relabeledPath.evidenceUnits.push({
      id: registryUnitId(2),
      documentId: "development/second.md",
      sourceFamilyId: hexId("sf", 2),
      trustClass: "authoritative-current",
      sourcePath: "development/policy.md",
      lineRange: { start: 5, end: 6 },
      headingPath: ["Second"],
    });
    sealCorpus(relabeledPath);
    expect(() => parseCorpus(relabeledPath)).toThrow("source path disagrees with document");

    const relabeledRange = baseCorpus();
    relabeledRange.evidenceUnits.push({
      id: registryUnitId(2),
      documentId: relabeledRange.evidenceUnits[0]!.documentId,
      sourceFamilyId: relabeledRange.evidenceUnits[0]!.sourceFamilyId,
      trustClass: relabeledRange.evidenceUnits[0]!.trustClass,
      sourcePath: relabeledRange.evidenceUnits[0]!.sourcePath,
      lineRange: structuredClone(relabeledRange.evidenceUnits[0]!.lineRange),
      headingPath: ["Relabeled"],
      sourcePage: 1,
    });
    sealCorpus(relabeledRange);
    expect(() => parseCorpus(relabeledRange)).toThrow("repeats a canonical source range");
  });
});

describe("evaluation v2 leakage-safe execution projection", () => {
  test("touches no gold fields and gives a text-only retriever only inputs.text", () => {
    const poison = (): never => {
      throw new Error("gold field was touched");
    };
    const query: Record<string, unknown> = {
      cohort: "text-only",
      inputs: { text: "Only this text is executable." },
    };
    for (const key of ["labels", "qrels", "nuggets", "trust", "split", "strata", "gold", "rawAssessments"]) {
      Object.defineProperty(query, key, { enumerable: true, get: poison });
    }
    const projected = projectEvaluationExecutionQueryV2(
      query as unknown as Pick<RetrievalEvaluationCorpusV2["queries"][number], "cohort" | "inputs">,
    );
    expect(projected).toEqual({ inputs: { text: "Only this text is executable." } });
    expect(Object.keys(projected)).toEqual(["inputs"]);
    expect(Object.keys(projected.inputs)).toEqual(["text"]);
  });

  test("requires a structured executable lane for caller-seeded queries", () => {
    expect(() => projectEvaluationExecutionQueryV2({
      cohort: "caller-seeded",
      inputs: { text: "Missing the seed." },
    })).toThrow("structured executable lane");

    expect(projectEvaluationExecutionQueryV2({
      cohort: "caller-seeded",
      inputs: {
        text: "Use the explicit graph seed.",
        graph: { seeds: ["kb/note.md"], depth: 1 },
      },
    })).toEqual({
      inputs: {
        text: "Use the explicit graph seed.",
        graph: { seeds: ["kb/note.md"], depth: 1 },
      },
    });
  });
});

describe("evaluation v2 repeated samples", () => {
  test("accepts a complete matrix with separate embedding and packed-context accounting", () => {
    const corpus = baseCorpus();
    const parsed = parseRetrievalEvaluationReportV2(
      reportFor(corpus),
      parseCorpus(corpus),
    );
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.samples[0]?.resources.llm).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 });
    expect(parsed.samples[0]?.resources.embedding).toEqual({ calls: 1, inputTokens: 12, durationMs: 2 });
    expect(parsed.samples[0]?.resources.packedContext).toEqual({ utf8Bytes: 256, readerTokens: 64 });
  });

  test("preserves explicit unavailable-token and upper-bound embedding accounting", () => {
    const corpus = baseCorpus();
    const report = reportFor(corpus);
    report.samples[0]!.resources.embedding = {
      calls: 1,
      inputTokens: 0,
      inputTokensMeasured: false,
      durationMs: 2,
      durationScope: "embedding-backed-search-upper-bound",
    };
    expect(parseRetrievalEvaluationReportV2(report, parseCorpus(corpus))
      .samples[0]?.resources.embedding).toEqual({
      calls: 1,
      inputTokens: 0,
      inputTokensMeasured: false,
      durationMs: 2,
      durationScope: "embedding-backed-search-upper-bound",
    });
  });

  test("rejects contradictory or forged embedding measurement annotations", () => {
    const corpus = baseCorpus();
    const parseEmbedding = (embedding: unknown) => {
      const report = reportFor(corpus);
      report.samples[0]!.resources.embedding = embedding as typeof report.samples[0]["resources"]["embedding"];
      return parseRetrievalEvaluationReportV2(report, parseCorpus(corpus));
    };
    expect(() => parseEmbedding({
      calls: 1,
      inputTokens: 3,
      inputTokensMeasured: false,
      durationMs: 2,
    })).toThrow("explicit placeholder");
    expect(() => parseEmbedding({
      calls: 0,
      inputTokens: 0,
      inputTokensMeasured: false,
      durationMs: 0,
    })).toThrow("exact unannotated zero record");
    expect(() => parseEmbedding({
      calls: 0,
      inputTokens: 0,
      durationMs: 0,
      durationScope: "embedding-backed-search-upper-bound",
    })).toThrow("exact unannotated zero record");
    expect(() => parseEmbedding({
      calls: 1,
      inputTokens: 0,
      inputTokensMeasured: true,
      durationMs: 2,
    })).toThrow("literal false");
    expect(() => parseEmbedding({
      calls: 1,
      inputTokens: 0,
      durationMs: 2,
      durationScope: "query-total",
    })).toThrow("embedding-backed-search-upper-bound");
  });

  test("requires an immutable packed-context commitment for every successful packing sample", () => {
    const corpus = packingCorpus();
    const parsed = parseRetrievalEvaluationReportV2(
      packingReportFor(corpus),
      parseCorpus(corpus),
    );
    expect(parsed.samples[0]?.packedContextTrace).toEqual({
      evidenceUnitIds: [corpus.evidenceUnits[0]!.id],
      truncated: false,
      packedBytesSha256: FIXTURE_PACKED_SHA256,
    });
    expect(Object.isFrozen(parsed.samples[0]?.packedContextTrace)).toBe(true);
    expect(Object.isFrozen(parsed.samples[0]?.packedContextTrace?.evidenceUnitIds)).toBe(true);

    const truncatedFixture = twoEvidencePackingFixture();
    truncatedFixture.report.samples[0]!.packedContextTrace = {
      evidenceUnitIds: [truncatedFixture.firstUnit.id],
      truncated: true,
      packedBytesSha256: FIXTURE_PACKED_SHA256,
    };
    expect(parseRetrievalEvaluationReportV2(
      truncatedFixture.report,
      parseCorpus(truncatedFixture.corpus),
    ).samples[0]?.packedContextTrace?.evidenceUnitIds).toEqual([truncatedFixture.firstUnit.id]);
  });

  test("forbids missing, extra, or failed-state packed-context traces", () => {
    const corpus = packingCorpus();
    const missing = packingReportFor(corpus);
    delete missing.samples[0]!.packedContextTrace;
    expect(() => parseRetrievalEvaluationReportV2(missing, parseCorpus(corpus))).toThrow(
      "required for every nonfailed packing sample",
    );

    const warmCorpus = baseCorpus();
    const extra = reportFor(warmCorpus);
    extra.samples[0]!.packedContextTrace = {
      evidenceUnitIds: [warmCorpus.evidenceUnits[0]!.id],
      truncated: false,
      packedBytesSha256: FIXTURE_PACKED_SHA256,
    };
    expect(() => parseRetrievalEvaluationReportV2(extra, parseCorpus(warmCorpus))).toThrow(
      "forbidden for non-packing samples",
    );

    const failed = packingReportFor(corpus);
    failed.samples[0]!.status = "failed";
    failed.samples[0]!.failure = { kind: "timeout", message: "Packing timed out." };
    failed.samples[0]!.trace.laneOutcomes[0]!.rawRanking = [];
    failed.samples[0]!.trace.candidateDecisions = [];
    failed.samples[0]!.rawEvidence = [];
    expect(() => parseRetrievalEvaluationReportV2(failed, parseCorpus(corpus))).toThrow(
      "forbidden for failed packing samples",
    );
  });

  test("rejects missing, duplicate, reordered, and unaccepted packed evidence IDs", () => {
    const missingFixture = twoEvidencePackingFixture();
    missingFixture.report.samples[0]!.packedContextTrace!.evidenceUnitIds = [
      missingFixture.firstUnit.id,
    ];
    expect(() => parseRetrievalEvaluationReportV2(
      missingFixture.report,
      parseCorpus(missingFixture.corpus),
    )).toThrow("must include every accepted evidence unit");

    const duplicateFixture = twoEvidencePackingFixture();
    duplicateFixture.report.samples[0]!.packedContextTrace!.evidenceUnitIds = [
      duplicateFixture.firstUnit.id,
      duplicateFixture.firstUnit.id,
    ];
    expect(() => parseRetrievalEvaluationReportV2(
      duplicateFixture.report,
      parseCorpus(duplicateFixture.corpus),
    )).toThrow("must not contain duplicates");

    const reorderedFixture = twoEvidencePackingFixture();
    reorderedFixture.report.samples[0]!.packedContextTrace!.evidenceUnitIds = [
      reorderedFixture.secondUnit.id,
      reorderedFixture.firstUnit.id,
    ];
    expect(() => parseRetrievalEvaluationReportV2(
      reorderedFixture.report,
      parseCorpus(reorderedFixture.corpus),
    )).toThrow("preserve accepted output and evidence order");

    const unacceptedCorpus = packingCorpus();
    const unacceptedUnit = addSecondFixtureEvidence(unacceptedCorpus);
    const unaccepted = packingReportFor(unacceptedCorpus);
    unaccepted.samples[0]!.packedContextTrace!.evidenceUnitIds = [unacceptedUnit.id];
    expect(() => parseRetrievalEvaluationReportV2(
      unaccepted,
      parseCorpus(unacceptedCorpus),
    )).toThrow("not registry-bound to an accepted trace decision");
  });

  test("rejects invalid packed-context SHA and byte or truncation state", () => {
    const corpus = packingCorpus();
    const sha = packingReportFor(corpus);
    sha.samples[0]!.packedContextTrace!.packedBytesSha256 = FIXTURE_PACKED_SHA256.toUpperCase();
    expect(() => parseRetrievalEvaluationReportV2(sha, parseCorpus(corpus))).toThrow(
      "64 lowercase hexadecimal characters",
    );

    const truncation = packingReportFor(corpus);
    truncation.samples[0]!.packedContextTrace!.truncated = true;
    expect(() => parseRetrievalEvaluationReportV2(truncation, parseCorpus(corpus))).toThrow(
      "must omit at least one accepted evidence unit",
    );

    const byteCount = packingReportFor(corpus);
    byteCount.samples[0]!.resources.packedContext = { utf8Bytes: 0, readerTokens: 0 };
    expect(() => parseRetrievalEvaluationReportV2(byteCount, parseCorpus(corpus))).toThrow(
      "evidence count contradicts",
    );

    const emptyDigest = packingReportFor(corpus);
    emptyDigest.samples[0]!.packedContextTrace!.packedBytesSha256 = EMPTY_PACKED_SHA256;
    expect(() => parseRetrievalEvaluationReportV2(emptyDigest, parseCorpus(corpus))).toThrow(
      "packed-bytes SHA-256 contradicts",
    );
  });

  test("rejects nonzero LLM use and an incomplete sample matrix", () => {
    const corpus = baseCorpus();
    const parsedCorpus = parseCorpus(corpus);
    const llm = reportFor(corpus);
    llm.samples[0]!.resources.llm.calls = 1 as 0;
    expect(() => parseRetrievalEvaluationReportV2(llm, parsedCorpus)).toThrow("literal zero LLM");
    const missing = reportFor(corpus);
    missing.samples.pop();
    expect(() => parseRetrievalEvaluationReportV2(missing, parsedCorpus)).toThrow("sample matrix");
  });

  test("rejects noncanonical rankings and incomplete typed lane traces", () => {
    const corpus = baseCorpus();
    const parsedCorpus = parseCorpus(corpus);
    const ranking = reportFor(corpus);
    ranking.samples[0]!.trace.laneOutcomes[0]!.rawRanking[0]!.rank = 2;
    expect(() => parseRetrievalEvaluationReportV2(ranking, parsedCorpus)).toThrow("contiguous");
    const trace = reportFor(corpus);
    trace.samples[0]!.trace.laneOutcomes = [];
    expect(() => parseRetrievalEvaluationReportV2(trace, parsedCorpus)).toThrow("every locked descriptor lane");
  });

  test("requires decision lanes and rows to join exactly to locked raw rankings", () => {
    const corpus = baseCorpus();
    const parsedCorpus = parseCorpus(corpus);

    const foreignLane = reportFor(corpus);
    foreignLane.samples[0]!.trace.candidateDecisions[0]!.laneId = "exact";
    expect(() => parseRetrievalEvaluationReportV2(foreignLane, parsedCorpus)).toThrow("locked descriptor");

    const wrongRank = reportFor(corpus);
    wrongRank.samples[0]!.trace.candidateDecisions[0]!.sourceRank = 2;
    expect(() => parseRetrievalEvaluationReportV2(wrongRank, parsedCorpus)).toThrow("does not join");

    const mismatchedEvidenceCorpus = baseCorpus();
    const secondUnit = {
      id: registryUnitId(2),
      documentId: mismatchedEvidenceCorpus.documents[0]!.id,
      sourceFamilyId: mismatchedEvidenceCorpus.sourceFamilies[0]!.id,
      trustClass: "authoritative-current" as const,
      sourcePath: mismatchedEvidenceCorpus.evidenceUnits[0]!.sourcePath,
      lineRange: { start: 5, end: 6 },
      headingPath: ["Policy", "Details"],
    };
    mismatchedEvidenceCorpus.evidenceUnits.push(secondUnit);
    sealCorpus(mismatchedEvidenceCorpus);
    const mismatchedEvidence = reportFor(mismatchedEvidenceCorpus);
    mismatchedEvidence.samples[0]!.trace.candidateDecisions[0]!.evidenceUnitIds = [secondUnit.id];
    mismatchedEvidence.samples[0]!.trace.candidateDecisions[0]!.provenance = [
      locatorFor(mismatchedEvidenceCorpus, secondUnit),
    ];
    expect(() => parseRetrievalEvaluationReportV2(
      mismatchedEvidence,
      parseCorpus(mismatchedEvidenceCorpus),
    )).toThrow("evidence and provenance must match");
  });

  test("allows only graph rows to cite an authored relationship in another document", () => {
    const corpus = baseCorpus();
    const targetFamilyId = hexId("sf", 2);
    const targetDocumentId = "development/graph-target.md";
    corpus.sourceFamilies.push({
      id: targetFamilyId,
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    });
    corpus.documents.push({
      id: targetDocumentId,
      sourcePath: targetDocumentId,
      sourceFamilyId: targetFamilyId,
      trustClass: "authoritative-current",
    });
    corpus.documents = corpus.documents.toSorted((left, right) =>
      left.id.localeCompare(right.id));
    for (const retriever of corpus.retrievers) retriever.lanes = ["graph"];
    sealCorpus(corpus);
    const graph = reportFor(corpus);
    for (const sample of graph.samples) {
      sample.trace.laneOutcomes[0]!.laneId = "graph";
      sample.trace.laneOutcomes[0]!.rawRanking[0]!.documentId = targetDocumentId;
      sample.trace.candidateDecisions[0]!.laneId = "graph";
      sample.trace.candidateDecisions[0]!.documentId = targetDocumentId;
      sample.rawEvidence[0]!.laneId = "graph";
      sample.rawEvidence[0]!.documentId = targetDocumentId;
    }
    expect(parseRetrievalEvaluationReportV2(graph, parseCorpus(corpus)).samples)
      .toHaveLength(2);

    const metadataCorpus = structuredClone(corpus);
    for (const retriever of metadataCorpus.retrievers) retriever.lanes = ["metadata"];
    sealCorpus(metadataCorpus);
    const metadata = structuredClone(graph);
    metadata.suiteSha256 = metadataCorpus.manifest.corpusSha256;
    metadata.candidateLockSha256 = metadataCorpus.manifest.candidateLockSha256;
    for (const sample of metadata.samples) {
      sample.trace.laneOutcomes[0]!.laneId = "metadata";
      sample.trace.candidateDecisions[0]!.laneId = "metadata";
      sample.rawEvidence[0]!.laneId = "metadata";
    }
    expect(() => parseRetrievalEvaluationReportV2(metadata, parseCorpus(metadataCorpus)))
      .toThrow("belongs to a different document");
  });

  test("round-trips bounded graph and Git lane-native evidence for accepted and excluded rows", () => {
    const corpus = baseCorpus();
    const targetFamilyId = hexId("sf", 2);
    const targetDocumentId = "development/graph-target.md";
    corpus.sourceFamilies.push({
      id: targetFamilyId,
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    });
    corpus.documents.push({
      id: targetDocumentId,
      sourcePath: targetDocumentId,
      sourceFamilyId: targetFamilyId,
      trustClass: "authoritative-current",
    });
    corpus.documents = corpus.documents.toSorted((left, right) =>
      left.id.localeCompare(right.id));
    for (const retriever of corpus.retrievers) {
      retriever.lanes = ["git" as const, "graph" as const].toSorted();
    }
    sealCorpus(corpus);
    const report = reportFor(corpus);
    const unit = corpus.evidenceUnits[0]!;
    const provenance = [locatorFor(corpus, unit)];
    for (const sample of report.samples) {
      sample.status = "degraded";
      sample.trace = {
        laneOutcomes: [{
          laneId: "git",
          applicability: "applied",
          status: "degraded",
          reasonCodes: ["missing-provenance"],
          rawRanking: [{
            documentId: targetDocumentId,
            evidenceUnitIds: [],
            rank: 1,
            provenance: [],
          }],
        }, {
          laneId: "graph",
          applicability: "applied",
          status: "ready",
          reasonCodes: [],
          rawRanking: [{
            documentId: targetDocumentId,
            evidenceUnitIds: [unit.id],
            rank: 1,
            provenance: structuredClone(provenance),
          }],
        }],
        candidateDecisions: [{
          documentId: targetDocumentId,
          evidenceUnitIds: [],
          laneId: "git",
          sourceRank: 1,
          disposition: "excluded",
          reasonCodes: ["missing-provenance"],
          provenance: [],
        }, {
          documentId: targetDocumentId,
          evidenceUnitIds: [unit.id],
          laneId: "graph",
          sourceRank: 1,
          disposition: "accepted",
          reasonCodes: ["appended"],
          outputRank: 1,
          provenance: structuredClone(provenance),
        }],
      };
      sample.rawEvidence = [{
        laneId: "git",
        documentId: targetDocumentId,
        rank: 1,
        evidence: {
          commits: [{ hash: "a".repeat(40), paths: ["src/evaluation-v2.ts"] }],
        },
      }, {
        laneId: "graph",
        documentId: targetDocumentId,
        rank: 1,
        evidence: {
          relation: {
            sourceDocumentId: unit.documentId,
            targetDocumentId,
            type: "supports",
          },
        },
      }];
    }
    const parsed = parseRetrievalEvaluationReportV2(report, parseCorpus(corpus));
    expect(parsed.samples[0]?.rawEvidence).toEqual(report.samples[0]?.rawEvidence);
    expect(Object.isFrozen(parsed.samples[0]?.rawEvidence)).toBe(true);
    expect(Object.isFrozen(parsed.samples[0]?.rawEvidence[0]?.evidence)).toBe(true);
  });

  test("rejects missing, unjoined, non-JSON, or oversized lane-native evidence", () => {
    const corpus = baseCorpus();
    const missing = reportFor(corpus);
    Reflect.deleteProperty(missing.samples[0]!, "rawEvidence");
    expect(() => parseRetrievalEvaluationReportV2(missing, parseCorpus(corpus)))
      .toThrow("sample.rawEvidence");

    const unjoined = reportFor(corpus);
    unjoined.samples[0]!.rawEvidence[0]!.rank = 2;
    expect(() => parseRetrievalEvaluationReportV2(unjoined, parseCorpus(corpus)))
      .toThrow("same canonical lane, document, and rank");

    const nonJson = reportFor(corpus);
    nonJson.samples[0]!.rawEvidence[0]!.evidence = { invalid: () => undefined };
    expect(() => parseRetrievalEvaluationReportV2(nonJson, parseCorpus(corpus)))
      .toThrow("only JSON values");

    const oversized = reportFor(corpus);
    oversized.samples[0]!.rawEvidence[0]!.evidence = { text: "x".repeat(64 * 1_024 + 1) };
    expect(() => parseRetrievalEvaluationReportV2(oversized, parseCorpus(corpus)))
      .toThrow("bounded NFC JSON text");
  });

  test("requires accepted rows to have unique contiguous outputs and registry-bound provenance", () => {
    const corpus = baseCorpus();
    const missing = reportFor(corpus);
    missing.samples[0]!.trace.laneOutcomes[0]!.rawRanking[0]!.evidenceUnitIds = [];
    missing.samples[0]!.trace.laneOutcomes[0]!.rawRanking[0]!.provenance = [];
    missing.samples[0]!.trace.candidateDecisions[0]!.evidenceUnitIds = [];
    missing.samples[0]!.trace.candidateDecisions[0]!.provenance = [];
    expect(() => parseRetrievalEvaluationReportV2(missing, parseCorpus(corpus))).toThrow(
      "registry-bound evidence-unit provenance",
    );

    const arbitrary = reportFor(corpus);
    arbitrary.samples[0]!.trace.laneOutcomes[0]!.rawRanking[0]!.provenance[0]!.sourcePath =
      "development/arbitrary.md";
    expect(() => parseRetrievalEvaluationReportV2(arbitrary, parseCorpus(corpus))).toThrow(
      "exactly match its frozen registry evidence unit",
    );

    const duplicateRanksCorpus = baseCorpus();
    duplicateRanksCorpus.sourceFamilies.push({
      id: hexId("sf", 2),
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    });
    duplicateRanksCorpus.documents.push({
      id: "development/second.md",
      sourcePath: "development/second.md",
      sourceFamilyId: hexId("sf", 2),
      trustClass: "authoritative-current",
    });
    const secondUnit = {
      id: registryUnitId(2),
      documentId: "development/second.md",
      sourceFamilyId: hexId("sf", 2),
      trustClass: "authoritative-current" as const,
      sourcePath: "development/second.md",
      lineRange: { start: 1, end: 2 },
      headingPath: ["Second"],
    };
    duplicateRanksCorpus.evidenceUnits.push(secondUnit);
    sealCorpus(duplicateRanksCorpus);
    const duplicateRanks = reportFor(duplicateRanksCorpus);
    const lane = duplicateRanks.samples[0]!.trace.laneOutcomes[0]!;
    lane.rawRanking.push({
      documentId: secondUnit.documentId,
      evidenceUnitIds: [secondUnit.id],
      rank: 2,
      provenance: [locatorFor(duplicateRanksCorpus, secondUnit)],
    });
    duplicateRanks.samples[0]!.trace.candidateDecisions.push({
      documentId: secondUnit.documentId,
      evidenceUnitIds: [secondUnit.id],
      laneId: "hybrid",
      sourceRank: 2,
      disposition: "accepted",
      reasonCodes: ["primary"],
      outputRank: 1,
      provenance: [locatorFor(duplicateRanksCorpus, secondUnit)],
    });
    expect(() => parseRetrievalEvaluationReportV2(
      duplicateRanks,
      parseCorpus(duplicateRanksCorpus),
    )).toThrow("output ranks must be unique");

    const duplicateDocumentsCorpus = baseCorpus();
    for (const retriever of duplicateDocumentsCorpus.retrievers) {
      retriever.lanes = ["exact", "hybrid"];
    }
    sealCorpus(duplicateDocumentsCorpus);
    const duplicateDocuments = reportFor(duplicateDocumentsCorpus);
    const duplicateSample = duplicateDocuments.samples[0]!;
    const hybridOutcome = duplicateSample.trace.laneOutcomes[0]!;
    const hybridDecision = duplicateSample.trace.candidateDecisions[0]!;
    hybridDecision.outputRank = 2;
    duplicateSample.trace.laneOutcomes.unshift({
      ...structuredClone(hybridOutcome),
      laneId: "exact",
    });
    duplicateSample.trace.candidateDecisions.unshift({
      ...structuredClone(hybridDecision),
      laneId: "exact",
      outputRank: 1,
    });
    expect(() => parseRetrievalEvaluationReportV2(
      duplicateDocuments,
      parseCorpus(duplicateDocumentsCorpus),
    )).toThrow("output documents must be unique");
  });

  test("reconciles lane, sample, failure, context, and four-reader batch state", () => {
    const corpus = baseCorpus();
    const status = reportFor(corpus);
    status.samples[0]!.status = "degraded";
    expect(() => parseRetrievalEvaluationReportV2(status, parseCorpus(corpus))).toThrow(
      "status must reconcile",
    );

    const reasons = reportFor(corpus);
    reasons.samples[0]!.status = "degraded";
    reasons.samples[0]!.trace.laneOutcomes[0]!.status = "degraded";
    expect(() => parseRetrievalEvaluationReportV2(reasons, parseCorpus(corpus))).toThrow(
      "require a reason code",
    );

    const disposition = reportFor(corpus);
    disposition.samples[0]!.trace.candidateDecisions[0]!.reasonCodes = ["trust"];
    expect(() => parseRetrievalEvaluationReportV2(disposition, parseCorpus(corpus))).toThrow(
      "contradict the candidate disposition",
    );

    const failed = reportFor(corpus);
    failed.samples[0]!.status = "failed";
    failed.samples[0]!.failure = { kind: "timeout", message: "The bounded run timed out." };
    expect(() => parseRetrievalEvaluationReportV2(failed, parseCorpus(corpus))).toThrow(
      "failed samples cannot retain rankings",
    );

    const ceiling = reportFor(corpus);
    ceiling.samples[0]!.resources.packedContext.utf8Bytes = 16_385;
    expect(() => parseRetrievalEvaluationReportV2(ceiling, parseCorpus(corpus))).toThrow(
      "context exceeds",
    );

    const concurrentCorpus = baseCorpus();
    concurrentCorpus.measurementProfiles[0] = {
      id: "four-reader-query",
      operation: "four-reader-query",
      scope: "query",
      cacheState: "warm",
      concurrency: 4,
      repetitions: 1,
    };
    sealCorpus(concurrentCorpus);
    const concurrent = reportFor(concurrentCorpus);
    for (const sample of concurrent.samples) {
      sample.profileId = "four-reader-query";
      sample.concurrencyBatchIdentity = "four-reader-driver-v1";
    }
    expect(parseRetrievalEvaluationReportV2(concurrent, parseCorpus(concurrentCorpus)).samples)
      .toHaveLength(2);
    delete concurrent.samples[0]!.concurrencyBatchIdentity;
    expect(() => parseRetrievalEvaluationReportV2(concurrent, parseCorpus(concurrentCorpus))).toThrow(
      "four-reader batch identity",
    );
  });
});

describe("evaluation v2 promotion corpus", () => {
  test("enforces the sealed 168-query design with explicit primary-stratum distribution", () => {
    const corpus = promotionCorpus();
    const parsed = validatePromotion(corpus);
    expect(parsed.queries).toHaveLength(168);
    expect(parsed.queries.filter(({ split }) => split === "development")).toHaveLength(48);
    expect(parsed.queries.filter(({ split }) => split === "test")).toHaveLength(120);
    expect(parsed.queries.filter(({ cohort }) => cohort === "caller-seeded")).toHaveLength(84);
    expect(parsed.queries.filter(({ cohort }) => cohort === "text-only")).toHaveLength(84);
    for (const cohort of ["caller-seeded", "text-only"] as const) {
      for (const expectedSupport of ["supported", "insufficient"] as const) {
        expect(parsed.queries.filter((query) =>
          query.split === "development"
          && query.cohort === cohort
          && query.expectedSupport === expectedSupport)).toHaveLength(12);
      }
    }
    expect(parsed.queries[48]?.strata).toEqual(["active-current-state"]);
    expect(parsed.queries[48]?.primaryStratum).toBe("active-current-state");

    const bothCohorts = structuredClone(corpus);
    bothCohorts.experiment.protocol.minimumUsefulEffects.push({
      metric: "document-recall-at-k",
      cohort: "text-only",
      minimumAbsoluteDifference: 0.05,
    });
    bothCohorts.experiment.protocol.minimumUsefulEffects.sort((left, right) =>
      `${left.metric}:${left.cohort}`.localeCompare(`${right.metric}:${right.cohort}`));
    sealCorpus(bothCohorts);
    expect(() => validatePromotion(bothCohorts)).toThrow("exactly one caller-seeded nugget-coverage");
  });

  test("does not let multiply-tagged questions satisfy every promotion quota", () => {
    const corpus = promotionCorpus();
    const acceptanceStrata = [
      "active-current-state",
      "code-path-context",
      "conceptual-recall",
      "exact-identity",
      "local-context",
      "metadata-constraint",
      "multi-note-relational",
      "source-provenance",
      "temporal-stale-current",
    ] as const;
    for (const query of corpus.queries.filter(({ split }) => split === "test")) {
      query.primaryStratum = "local-context";
      query.strata = [
        ...acceptanceStrata,
        ...(query.expectedSupport === "insufficient" ? ["no-answer-near-miss" as const] : []),
      ].toSorted();
    }
    sealCorpus(corpus);
    expect(() => validatePromotion(corpus)).toThrow("primary active-current-state");
  });

  test("requires meaningful per-cohort and dual-assessment coverage in every stratum", () => {
    const cohort = promotionCorpus();
    const callerActive = cohort.queries.find((query) =>
      query.split === "test"
      && query.cohort === "caller-seeded"
      && query.primaryStratum === "active-current-state");
    const textLocal = cohort.queries.find((query) =>
      query.split === "test"
      && query.cohort === "text-only"
      && query.primaryStratum === "local-context");
    if (callerActive === undefined || textLocal === undefined) throw new Error("fixture strata missing");
    callerActive.primaryStratum = "local-context";
    callerActive.strata = [
      "local-context",
      ...(callerActive.expectedSupport === "insufficient" ? ["no-answer-near-miss" as const] : []),
    ].toSorted() as EvaluationStratumV2[];
    textLocal.primaryStratum = "active-current-state";
    textLocal.strata = [
      "active-current-state",
      ...(textLocal.expectedSupport === "insufficient" ? ["no-answer-near-miss" as const] : []),
    ].toSorted() as EvaluationStratumV2[];
    sealCorpus(cohort);
    expect(() => validatePromotion(cohort)).toThrow("caller-seeded cohort");

    const assessment = promotionCorpus();
    const activeDual = assessment.queries.filter((query) =>
      query.split === "test"
      && query.cohort === "caller-seeded"
      && query.primaryStratum === "active-current-state"
      && query.rawAssessments.length >= 2);
    for (const query of activeDual.slice(0, 2)) {
      query.rawAssessments = [query.rawAssessments[0]!];
      query.adjudication = { status: "single-assessor" };
    }
    sealCorpus(assessment);
    expect(() => validatePromotion(assessment)).toThrow("independently dual-assessed");
  });

  test("requires complete protocol commitments and non-empty locked configurations", () => {
    const emptyConfiguration = promotionCorpus();
    emptyConfiguration.retrievers[0]!.configuration = {};
    sealCorpus(emptyConfiguration);
    expect(() => validatePromotion(emptyConfiguration)).toThrow("non-empty configuration");

    const incompleteProtocol = promotionCorpus();
    incompleteProtocol.experiment.protocol.nonInferiorityMargins.pop();
    sealCorpus(incompleteProtocol);
    expect(() => validatePromotion(incompleteProtocol)).toThrow("every required metric-specific");

    const diagnosticAsGate = promotionCorpus();
    diagnosticAsGate.experiment.protocol.nonInferiorityMargins.push({
      metric: "context-precision",
      maximumAbsoluteRegression: 0.02,
      maximumRelativeRegression: 0.25,
    });
    diagnosticAsGate.experiment.protocol.nonInferiorityMargins.sort((left, right) =>
      left.metric.localeCompare(right.metric));
    sealCorpus(diagnosticAsGate);
    expect(() => validatePromotion(diagnosticAsGate)).toThrow("every required metric-specific");

    const underpowered = promotionCorpus();
    const underpoweredDesign = {
      alpha: 0.05,
      targetPower: 0.8,
      assumedDiscordantRate: 0.25,
      assumedEffect: 0.15,
      minimumUsefulEffect: 0.05,
    } as const;
    underpowered.experiment.protocol.pairedPower = {
      ...underpoweredDesign,
      requiredPairs: requiredPairedObservationsV2(underpoweredDesign),
    };
    sealCorpus(underpowered);
    expect(() => validatePromotion(underpowered)).toThrow("prospective design requires");
  });

  test("requires the balanced development cells and independently powered source-family clusters", () => {
    const confounded = promotionCorpus();
    const callerSupported = confounded.queries.find((query) =>
      query.split === "development"
      && query.cohort === "caller-seeded"
      && query.expectedSupport === "supported");
    const textInsufficient = confounded.queries.find((query) =>
      query.split === "development"
      && query.cohort === "text-only"
      && query.expectedSupport === "insufficient");
    if (callerSupported === undefined || textInsufficient === undefined) {
      throw new Error("Balanced development fixture is incomplete.");
    }
    const callerInputs = structuredClone(callerSupported.inputs);
    const callerOrigins = structuredClone(callerSupported.inputOrigins);
    callerSupported.cohort = "text-only";
    callerSupported.inputs = structuredClone(textInsufficient.inputs);
    callerSupported.inputOrigins = structuredClone(textInsufficient.inputOrigins);
    textInsufficient.cohort = "caller-seeded";
    textInsufficient.inputs = callerInputs;
    textInsufficient.inputOrigins = callerOrigins;
    sealCorpus(confounded);
    expect(() => validatePromotion(confounded)).toThrow("exactly 12 supported");

    const clustered = promotionCorpus();
    const eligible = clustered.queries.filter((query) =>
      query.split === "test"
      && query.cohort === "caller-seeded"
      && query.expectedSupport === "supported").slice(0, 7);
    const retainedFamilyId = clustered.documents.find(({ id }) => id === eligible[0]?.gold.documents[0]?.documentId)
      ?.sourceFamilyId;
    if (eligible.length !== 7 || retainedFamilyId === undefined) {
      throw new Error("Powered test fixture is incomplete.");
    }
    for (const query of eligible) {
      const documentId = query.gold.documents[0]?.documentId;
      const evidenceUnitId = query.gold.evidenceUnits[0]?.evidenceUnitId;
      const document = clustered.documents.find(({ id }) => id === documentId);
      const evidence = clustered.evidenceUnits.find(({ id }) => id === evidenceUnitId);
      if (document === undefined || evidence === undefined) throw new Error("Cluster fixture lost evidence.");
      document.sourceFamilyId = retainedFamilyId;
      evidence.sourceFamilyId = retainedFamilyId;
    }
    sealCorpus(clustered);
    expect(() => validatePromotion(clustered)).toThrow("independent source-family clusters");
  });

  test("clusters heterogeneous provenance families by their shared reviewed assignment", () => {
    const corpus = promotionCorpus();
    const first = corpus.sourceFamilies[0];
    const second = corpus.sourceFamilies[1];
    if (first === undefined || second === undefined) throw new Error("fixture families are missing");
    second.sourceClass = "captured-source";
    second.trustClass = "untrusted-capture";
    corpus.documents[1]!.trustClass = "untrusted-capture";
    corpus.evidenceUnits[1]!.trustClass = "untrusted-capture";
    if (first.familyAssignmentSha256 === undefined) throw new Error("fixture assignment is missing");
    second.familyAssignmentSha256 = first.familyAssignmentSha256;
    sealCorpus(corpus);
    const parsed = parseCorpus(corpus);
    const clusters = evaluationSourceFamilyClusterIdsV2(
      parsed.queries.slice(0, 2),
      parsed.documents,
      parsed.evidenceUnits,
      parsed.sourceFamilies,
    );
    expect(clusters.get(parsed.queries[0]!.id)).toBe(clusters.get(parsed.queries[1]!.id));
  });

  test("allows sealed full-vault catalog entries that are not graded qrels", () => {
    const corpus = promotionCorpus();
    const familyId = hexId("sf", 10_000);
    const sourcePath = "notes/catalog-only.md";
    corpus.sourceFamilies.push({
      id: familyId,
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    });
    corpus.sourceFamilies.sort((left, right) => left.id.localeCompare(right.id));
    corpus.documents.push({
      id: sourcePath,
      sourcePath,
      sourceFamilyId: familyId,
      trustClass: "authoritative-current",
    });
    corpus.documents.sort((left, right) => left.id.localeCompare(right.id));
    corpus.evidenceUnits.push({
      id: registryUnitId(10_000),
      documentId: sourcePath,
      sourceFamilyId: familyId,
      trustClass: "authoritative-current",
      sourcePath,
      lineRange: { start: 1, end: 1 },
      headingPath: [],
    });
    corpus.evidenceUnits.sort((left, right) => left.id.localeCompare(right.id));
    sealCorpus(corpus);

    expect(validatePromotion(corpus).documents.some(({ id }) => id === sourcePath)).toBe(true);
  });

  test("requires an independent external seal and supports a canonical Git blob commitment", () => {
    const corpus = promotionCorpus();
    const expectedCorpusSha256 = corpus.manifest.corpusSha256;
    corpus.description = "Mutated and internally resealed after external commitment.";
    sealCorpus(corpus);
    expect(() => validatePromotion(corpus, expectedCorpusSha256)).toThrow("independently supplied");

    const gitSealed = promotionCorpus();
    const expectedGitBlob = evaluationCorpusGitBlobCommitmentV2(gitSealed);
    expect(validatePromotionCorpusV2(gitSealed, { expectedGitBlob }).queries).toHaveLength(168);
  });

  test("fails closed on wrong counts, readable IDs, and source-family split leakage", () => {
    const count = promotionCorpus();
    count.queries.pop();
    sealCorpus(count);
    expect(() => validatePromotion(count)).toThrow("exactly 168");

    const readable = promotionCorpus();
    readable.queries[0]!.id = "development-policy-query";
    sealCorpus(readable);
    expect(() => validatePromotion(readable)).toThrow("opaque and canonical");

    const leakage = promotionCorpus();
    const developmentFamily = leakage.sourceFamilies[0]!.id;
    leakage.documents[48]!.sourceFamilyId = developmentFamily;
    leakage.evidenceUnits[48]!.sourceFamilyId = developmentFamily;
    sealCorpus(leakage);
    expect(() => validatePromotion(leakage)).toThrow("crosses development and test");

    const unreviewedFamily = promotionCorpus();
    delete unreviewedFamily.sourceFamilies[0]!.familyAssignmentSha256;
    sealCorpus(unreviewedFamily);
    expect(() => validatePromotion(unreviewedFamily)).toThrow(
      "lacks an independently reviewed family-assignment commitment",
    );
  });
});
