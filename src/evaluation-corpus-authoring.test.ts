import { describe, expect, test } from "bun:test";

import {
  compilePromotionCorpusAuthoringV2,
  compileRetrievalEvaluationCorpusAuthoringV2,
  promotionCorpusLabelPredictabilityV2,
  promotionCorpusDiagnosticsV2,
  type AuthoredEvidenceSelectorV2,
  type HumanAuthoredEvaluationQuestionV2,
  type PromotionCorpusAuthoringInputV2,
  type PromotionCorpusMarkdownDocumentV2,
} from "./evaluation-corpus-authoring.js";
import { parseRetrievalEvaluationCorpusV2 } from "./evaluation-v2.js";

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

type MutableInput = DeepMutable<PromotionCorpusAuthoringInputV2>;
type MutableQuestion = DeepMutable<HumanAuthoredEvaluationQuestionV2>;

const POLICY_MARKDOWN = "# Policy\r\n\r\nCurrent café policy lives here.\r\n\r\n## Details\r\n\r\nUse current evidence.\r\n";
const POLICY_TEXT = "Current café policy lives here.\r\n";

function selector(
  sourcePath = "notes/policy.md",
  exactText = POLICY_TEXT,
): DeepMutable<AuthoredEvidenceSelectorV2> {
  return {
    sourcePath,
    kind: "paragraph",
    headingPath: ["Policy"],
    exactText,
  };
}

function document(
  sourcePath = "notes/policy.md",
  sourceFamilyKey = "policy-family",
  markdown = POLICY_MARKDOWN,
): DeepMutable<PromotionCorpusMarkdownDocumentV2> {
  return {
    sourcePath,
    markdown,
    sourceFamilyKey,
    sourceClass: "authored-note",
    trustClass: "authoritative-current",
  };
}

function sourceFamilyReviewPolicy(): NonNullable<MutableInput["reviewPolicy"]> {
  return {
    sourceFamilyAssignment: {
      protocolId: "causal-evidence-lineage-v1",
      protocolSha256: "9".repeat(64),
      reviewerIds: ["family-reviewer-a", "family-reviewer-b", "family-reviewer-c"],
    },
  };
}

function reviewedDocument(
  sourcePath = "notes/policy.md",
  sourceFamilyKey = "policy-family",
  rationale = "These records describe one shared causal policy lineage.",
  options: Readonly<{
    markdown?: string;
    sourceClass?: "authored-note" | "captured-source";
    trustClass?: "authoritative-current" | "maintained-synthesis" | "untrusted-capture";
    reviewerIds?: readonly string[];
  }> = {},
): DeepMutable<PromotionCorpusMarkdownDocumentV2> {
  return {
    sourcePath,
    markdown: options.markdown ?? POLICY_MARKDOWN,
    sourceFamilyKey,
    sourceClass: options.sourceClass ?? "authored-note",
    trustClass: options.trustClass ?? "authoritative-current",
    sourceFamilyRationale: rationale,
    sourceFamilyReviewerIds: [...(options.reviewerIds
      ?? ["family-reviewer-a", "family-reviewer-b"])],
  };
}

function supportedQuestion(options: {
  readonly key?: string;
  readonly text?: string;
  readonly split?: "development" | "test";
  readonly sourcePath?: string;
  readonly exactText?: string;
  readonly evidenceSelector?: DeepMutable<AuthoredEvidenceSelectorV2>;
} = {}): MutableQuestion {
  const key = options.key ?? "policy-location";
  const text = options.text ?? "Where is the current café policy?";
  const sourcePath = options.sourcePath ?? "notes/policy.md";
  const evidence = options.evidenceSelector ?? selector(sourcePath, options.exactText ?? POLICY_TEXT);
  return {
    key,
    text,
    split: options.split ?? "development",
    cohort: "text-only",
    strata: ["source-provenance", "conceptual-recall", "source-provenance"],
    primaryStratum: "conceptual-recall",
    expectedSupport: "supported",
    primaryLane: "hybrid",
    inputs: { text },
    inputOrigins: [{ lane: "text", origin: "query-text" }],
    gold: {
      documents: [{ sourcePath, relevance: 3 }],
      evidenceUnits: [{ selector: evidence, relevance: 3 }],
      nuggets: [{
        key: "location",
        text: "The current policy is in the maintained policy note.",
        required: true,
        acceptableSupportSets: [{ key: "policy-unit", evidence: [evidence, evidence] }],
      }],
    },
    rawAssessments: [{
      assessorId: "assessor-a",
      expectedSupport: "supported",
      documents: [{ sourcePath, relevance: 3 }],
      evidenceUnits: [{ selector: evidence, relevance: 3 }],
      nuggets: [{ nuggetKey: "location", acceptableSupportSetKeys: ["policy-unit"] }],
    }],
    adjudication: { status: "single-assessor" },
  };
}

function baseInput(): MutableInput {
  return {
    id: "authored-evaluation",
    description: "Human-authored evidence selector fixture.",
    sealedAt: "2026-08-05T12:00:00.000Z",
    buildContractSha256: "e".repeat(64),
    frozen: {
      repositoryCommit: "a".repeat(40),
      vaultTree: "b".repeat(40),
      vaultRoot: "kb",
    },
    assessment: {
      rubricVersion: "current-evidence-relevance-0-3-v2",
      assessors: [{ id: "assessor-a" }, { id: "assessor-b" }],
    },
    experiment: {
      protocol: {
        minimumUsefulEffects: [{
          metric: "document-recall-at-k",
          cohort: "caller-seeded",
          minimumAbsoluteDifference: 0.05,
        }],
        nonInferiorityMargins: [{
          metric: "conceptual-recall-accuracy",
          maximumAbsoluteRegression: 0.05,
          maximumRelativeRegression: 0,
        }],
        contextCeilings: { utf8Bytes: 16_384, readerTokens: 4_096 },
        pairedPower: {
          alpha: 0.05,
          targetPower: 0.8,
          assumedDiscordantRate: 0.25,
          assumedEffect: 0.25,
          minimumUsefulEffect: 0.05,
          requiredPairs: 35,
        },
      },
      environment: {
        tokenizer: { id: "fixture-tokenizer", sha256: "1".repeat(64) },
        runtime: { id: "bun-1.3.14", sha256: "2".repeat(64) },
        hardware: { id: "fixture-machine" },
        localModel: { kind: "none" },
        cache: { preparation: "empty fixture cache", fingerprintSha256: "3".repeat(64) },
        fourReaderBatch: { id: "fixture-batch", sha256: "4".repeat(64) },
        incrementalMutation: {
          sourcePath: "notes/incremental-fixture.md",
          appendUtf8Sha256: "5".repeat(64),
          expectedPostMutationSha256: "6".repeat(64),
        },
      },
    },
    documents: [document()],
    questions: [supportedQuestion()],
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
      configuration: {},
    }, {
      id: "candidate",
      role: "candidate",
      version: "1",
      implementationSha256: "d".repeat(64),
      lanes: ["hybrid"],
      configuration: { "output-limit": 10 },
    }],
    baselineRetrieverId: "baseline",
  };
}

function expectCompiled(input: PromotionCorpusAuthoringInputV2) {
  const result = compileRetrievalEvaluationCorpusAuthoringV2(input);
  if (!result.ok) throw new Error(result.errors.map(({ message }) => message).join("\n"));
  return result;
}

describe("human-authored evaluation corpus compilation", () => {
  test("compiles stably, preserves prose and declarations, and seals a v2 corpus", () => {
    const first = expectCompiled(baseInput());
    const second = expectCompiled(structuredClone(baseInput()));

    expect(first.corpus.manifest.corpusSha256).toBe(second.corpus.manifest.corpusSha256);
    expect(first.corpus.manifest.candidateLockSha256).toBe(second.corpus.manifest.candidateLockSha256);
    expect(first.corpus.manifest.buildContractSha256).toBe("e".repeat(64));
    expect(JSON.stringify(first.corpus)).toBe(JSON.stringify(second.corpus));
    expect(parseRetrievalEvaluationCorpusV2(first.corpus, { claimPromotion: false })).toEqual(first.corpus);
    expect(first.externalSeal).toEqual({ expectedCorpusSha256: first.corpus.manifest.corpusSha256 });
    expect(first.corpus.queries[0]?.text).toBe("Where is the current café policy?");
    expect(first.corpus.queries[0]?.inputs).toEqual({ text: "Where is the current café policy?" });
    expect(first.corpus.queries[0]?.inputOrigins).toEqual([{ lane: "text", origin: "query-text" }]);
    expect(first.corpus.queries[0]?.strata).toEqual(["conceptual-recall", "source-provenance"]);
    expect(first.corpus.queries[0]?.id).toMatch(/^q-[0-9a-f]{16}$/);
    expect(first.corpus.sourceFamilies[0]?.id).toMatch(/^sf-[0-9a-f]{16}$/);
  });

  test("seals reviewed causal-family assignments without disclosing private review material", () => {
    const first = baseInput();
    first.reviewPolicy = sourceFamilyReviewPolicy();
    first.documents = [reviewedDocument()];
    const compiled = expectCompiled(first);
    const family = compiled.corpus.sourceFamilies[0];
    expect(family?.familyAssignmentSha256).toMatch(/^[0-9a-f]{64}$/);
    const sealed = JSON.stringify(compiled.corpus);
    expect(sealed).not.toContain("family-reviewer-a");
    expect(sealed).not.toContain("shared causal policy lineage");
    expect(sealed).not.toContain("policy-family");

    const mutated = structuredClone(first);
    mutated.documents[0]!.sourceFamilyRationale =
      "These records describe one separately reviewed causal policy lineage.";
    const mutatedCompiled = expectCompiled(mutated);
    expect(mutatedCompiled.corpus.sourceFamilies[0]?.familyAssignmentSha256)
      .not.toBe(family?.familyAssignmentSha256);
    expect(mutatedCompiled.corpus.manifest.corpusSha256)
      .not.toBe(compiled.corpus.manifest.corpusSha256);

    const pathMembershipMutation = structuredClone(first);
    pathMembershipMutation.documents.push(reviewedDocument(
      "notes/policy-appendix.md",
      "policy-family",
      "These records describe one shared causal policy lineage.",
      { markdown: "# Policy appendix\n\nAdditional policy evidence.\n" },
    ));
    const membershipCompiled = expectCompiled(pathMembershipMutation);
    expect(membershipCompiled.corpus.sourceFamilies[0]?.familyAssignmentSha256)
      .not.toBe(family?.familyAssignmentSha256);
    expect(membershipCompiled.corpus.manifest.corpusSha256)
      .not.toBe(compiled.corpus.manifest.corpusSha256);
  });

  test("rejects incomplete, non-independent, duplicate, and undeclared family reviewers", () => {
    const invalidCases: readonly [string, (input: MutableInput) => void, string][] = [
      ["missing", (input) => {
        input.documents[0] = reviewedDocument();
        delete input.documents[0].sourceFamilyReviewerIds;
      }, "incomplete-source-family-review"],
      ["one", (input) => {
        input.documents[0] = reviewedDocument(undefined, undefined, undefined, {
          reviewerIds: ["family-reviewer-a"],
        });
      }, "invalid-source-family-reviewers"],
      ["duplicate", (input) => {
        input.documents[0] = reviewedDocument(undefined, undefined, undefined, {
          reviewerIds: ["family-reviewer-a", "family-reviewer-a"],
        });
      }, "duplicate-source-family-reviewers"],
      ["undeclared", (input) => {
        input.documents[0] = reviewedDocument(undefined, undefined, undefined, {
          reviewerIds: ["family-reviewer-a", "family-reviewer-z"],
        });
      }, "undeclared-source-family-reviewers"],
    ];
    for (const [, mutate, expectedCode] of invalidCases) {
      const input = baseInput();
      input.reviewPolicy = sourceFamilyReviewPolicy();
      mutate(input);
      const result = compileRetrievalEvaluationCorpusAuthoringV2(input);
      expect(result.ok).toBe(false);
      expect(result.errors.map(({ code }) => code)).toContain(expectedCode);
    }
  });

  test("requires one consistent reviewed rationale within a causal family", () => {
    const input = baseInput();
    input.reviewPolicy = sourceFamilyReviewPolicy();
    input.documents = [
      reviewedDocument(),
      reviewedDocument(
        "notes/policy-history.md",
        "policy-family",
        "This record was assigned by a conflicting lineage rationale.",
        { markdown: "# History\n\nPrior policy evidence.\n" },
      ),
    ];
    const result = compileRetrievalEvaluationCorpusAuthoringV2(input);
    expect(result.ok).toBe(false);
    expect(result.errors.map(({ code }) => code)).toContain("conflicting-source-family-review");
  });

  test("rejects boilerplate review used to disguise per-note family splitting", () => {
    const input = baseInput();
    input.reviewPolicy = sourceFamilyReviewPolicy();
    input.documents = [
      reviewedDocument(),
      reviewedDocument(
        "notes/policy-copy.md",
        "policy-copy-family",
        "These records describe one shared causal policy lineage.",
        { markdown: "# Policy copy\n\nSeparate evidence bytes.\n" },
      ),
    ];
    const result = compileRetrievalEvaluationCorpusAuthoringV2(input);
    expect(result.ok).toBe(false);
    expect(result.errors.map(({ code }) => code)).toContain("opaque-source-family-splitting");
  });

  test("keeps mixed capture and synthesis provenance in one causal assignment cluster", () => {
    const input = baseInput();
    input.reviewPolicy = sourceFamilyReviewPolicy();
    input.documents = [
      reviewedDocument("sources/policy.md", "policy-lineage", undefined, {
        markdown: "# Captured policy\n\nPrimary source bytes.\n",
        sourceClass: "captured-source",
        trustClass: "untrusted-capture",
      }),
      reviewedDocument("notes/policy.md", "policy-lineage", undefined, {
        sourceClass: "authored-note",
        trustClass: "maintained-synthesis",
      }),
    ];
    const compiled = expectCompiled(input);
    expect(compiled.corpus.sourceFamilies).toHaveLength(2);
    expect(new Set(compiled.corpus.sourceFamilies.map(({ familyAssignmentSha256 }) =>
      familyAssignmentSha256))).toEqual(new Set([compiled.corpus.sourceFamilies[0]?.familyAssignmentSha256]));
    expect(new Set(compiled.corpus.sourceFamilies.map(({ sourceClass }) => sourceClass)))
      .toEqual(new Set(["authored-note", "captured-source"]));
  });

  test("fails closed on ambiguous, zero, and drifted selectors", () => {
    const ambiguous = baseInput();
    ambiguous.documents[0] = document(
      "notes/policy.md",
      "policy-family",
      "# Policy\n\nRepeated evidence.\n\nRepeated evidence.\n",
    );
    ambiguous.questions[0] = supportedQuestion({
      exactText: "Repeated evidence.\n",
      text: "Which repeated evidence is intended?",
    });
    const ambiguousResult = compileRetrievalEvaluationCorpusAuthoringV2(ambiguous);
    expect(ambiguousResult.ok).toBe(false);
    expect(ambiguousResult.errors.map(({ code }) => code)).toContain("selector-ambiguous");

    const zero = baseInput();
    zero.questions[0] = supportedQuestion({ exactText: "Text absent from the frozen source.\r\n" });
    const zeroResult = compileRetrievalEvaluationCorpusAuthoringV2(zero);
    expect(zeroResult.ok).toBe(false);
    expect(zeroResult.errors.map(({ code }) => code)).toContain("selector-zero-or-drifted-match");

    const pinned = expectCompiled(baseInput()).resolvedEvidence[0];
    if (pinned === undefined) throw new Error("Pinned evidence is missing.");
    const drift = baseInput();
    drift.documents[0] = document(
      "notes/policy.md",
      "policy-family",
      POLICY_MARKDOWN.replace("# Policy", "# Policy changed"),
    );
    drift.questions[0] = supportedQuestion({
      evidenceSelector: {
        ...selector(),
        headingPath: ["Policy changed"],
        expectedUnitId: pinned.registryUnitId,
        expectedUnitSha256: pinned.unitSha256,
      },
    });
    const driftResult = compileRetrievalEvaluationCorpusAuthoringV2(drift);
    expect(driftResult.ok).toBe(false);
    expect(driftResult.errors.map(({ code }) => code)).toContain("selector-unit-drift");
  });

  test("retains exact CRLF, Unicode, byte ranges, line ranges, hashes, and registry IDs", () => {
    const compiled = expectCompiled(baseInput());
    const resolved = compiled.resolvedEvidence[0];
    if (resolved === undefined) throw new Error("Resolved evidence is missing.");
    expect(resolved.exactText).toBe(POLICY_TEXT);
    expect(resolved.lineRange).toEqual({ start: 3, end: 3 });
    expect(resolved.headingPath).toEqual(["Policy"]);
    expect(resolved.registryUnitId).toMatch(/^eeu:evaluation-evidence-v1:[0-9a-f]{64}$/);
    expect(resolved.corpusEvidenceUnitId).toBe(resolved.registryUnitId);
    expect(Buffer.byteLength(resolved.exactText, "utf8")).toBe(
      resolved.byteRange.end - resolved.byteRange.start,
    );
    expect(compiled.corpus.evidenceUnits[0]).toMatchObject({
      id: resolved?.corpusEvidenceUnitId,
      sourcePath: "notes/policy.md",
      lineRange: { start: 3, end: 3 },
      headingPath: ["Policy"],
    });

    const rangeInput = baseInput();
    rangeInput.questions[0] = supportedQuestion({
      evidenceSelector: {
        sourcePath: "notes/policy.md",
        lineRange: { start: 3, end: 3 },
        expectedSourceSha256: resolved.sourceSha256,
        expectedByteRange: resolved.byteRange,
      },
    });
    expect(expectCompiled(rangeInput).resolvedEvidence[0]?.registryUnitId).toBe(resolved.registryUnitId);

    rangeInput.documents[0] = document(
      "notes/policy.md",
      "policy-family",
      POLICY_MARKDOWN.replace("Current café", "Changed café"),
    );
    const changed = compileRetrievalEvaluationCorpusAuthoringV2(rangeInput);
    expect(changed.ok).toBe(false);
    expect(changed.errors.map(({ code }) => code)).toContain("selector-source-drift");
  });

  test("allows topical near misses but forbids complete required support", () => {
    const topical = baseInput();
    const question = supportedQuestion();
    question.expectedSupport = "insufficient";
    question.negativeSubtype = "topical-near-miss";
    question.strata = ["no-answer-near-miss"];
    question.primaryStratum = "no-answer-near-miss";
    question.gold.documents[0]!.relevance = 1;
    question.gold.evidenceUnits[0]!.relevance = 1;
    question.gold.nuggets[0]!.acceptableSupportSets = [];
    question.rawAssessments[0]!.expectedSupport = "insufficient";
    question.rawAssessments[0]!.documents[0]!.relevance = 1;
    question.rawAssessments[0]!.evidenceUnits[0]!.relevance = 1;
    question.rawAssessments[0]!.nuggets[0]!.acceptableSupportSetKeys = [];
    topical.questions[0] = question;

    const compiled = expectCompiled(topical);
    expect(compiled.corpus.queries[0]?.expectedSupport).toBe("insufficient");
    expect(compiled.corpus.queries[0]?.gold.evidenceUnits[0]?.relevance).toBe(1);
    expect(compiled.corpus.queries[0]?.gold.nuggets[0]?.acceptableSupportSets).toEqual([]);

    question.gold.nuggets[0]!.acceptableSupportSets = [{
      key: "policy-unit",
      evidence: [selector()],
    }];
    question.rawAssessments[0]!.expectedSupport = "supported";
    question.rawAssessments[0]!.nuggets[0]!.acceptableSupportSetKeys = ["policy-unit"];
    const complete = compileRetrievalEvaluationCorpusAuthoringV2(topical);
    expect(complete.ok).toBe(false);
    expect(complete.errors.some(({ message }) => message.includes("insufficient but contains complete"))).toBe(true);
  });

  test("preserves independent assessor disagreement and explicit resolution", () => {
    const input = baseInput();
    const question = supportedQuestion();
    question.rawAssessments = [
      question.rawAssessments[0]!,
      {
        assessorId: "assessor-b",
        expectedSupport: "supported",
        documents: [{ sourcePath: "notes/policy.md", relevance: 2 }],
        evidenceUnits: [{ selector: selector(), relevance: 3 }],
        nuggets: [{ nuggetKey: "location", acceptableSupportSetKeys: ["policy-unit"] }],
      },
    ];
    question.adjudication = {
      status: "resolved",
      adjudicatorId: "assessor-a",
      rationale: "The final document grade follows the maintained-source rubric.",
    };
    input.questions[0] = question;
    const compiled = expectCompiled(input);
    const output = compiled.corpus.queries[0];
    expect(output?.rawAssessments.map(({ assessorId }) => assessorId)).toEqual(["assessor-a", "assessor-b"]);
    expect(output?.rawAssessments[1]?.documents[0]?.relevance).toBe(2);
    expect(output?.adjudication).toEqual({
      status: "resolved",
      adjudicatorId: "assessor-a",
      rationale: "The final document grade follows the maintained-source rubric.",
    });
  });

  test("preserves assessor disagreement about whether a final nugget is required", () => {
    const input = baseInput();
    const question = supportedQuestion();
    question.gold.nuggets.push({
      key: "source-authority",
      text: "The source is maintained and authoritative.",
      required: true,
      acceptableSupportSets: [{ key: "source-authority-unit", evidence: [selector()] }],
    });
    question.rawAssessments[0]!.nuggets.push({
      nuggetKey: "source-authority",
      acceptableSupportSetKeys: ["source-authority-unit"],
    });
    question.rawAssessments.push({
      assessorId: "assessor-b",
      expectedSupport: "supported",
      documents: structuredClone(question.rawAssessments[0]!.documents),
      evidenceUnits: structuredClone(question.rawAssessments[0]!.evidenceUnits),
      nuggets: [{
        nuggetKey: "location",
        required: true,
        acceptableSupportSetKeys: ["policy-unit"],
      }, {
        nuggetKey: "source-authority",
        required: false,
        acceptableSupportSetKeys: [],
      }],
    });
    question.adjudication = {
      status: "resolved",
      adjudicatorId: "assessor-a",
      rationale: "The final rubric requires source authority; the independent assessor did not.",
    };
    input.questions[0] = question;
    const output = expectCompiled(input).corpus.queries[0];
    expect(output?.gold.nuggets[1]?.required).toBe(true);
    expect(output?.rawAssessments[1]?.nuggets[1]?.required).toBe(false);
    expect(output?.rawAssessments[1]?.expectedSupport).toBe("supported");
  });

  test("changes the corpus commitment for authored query or evidence mutation", () => {
    const first = expectCompiled(baseInput());
    const queryMutation = baseInput();
    queryMutation.questions[0]!.text = "Where does the current café policy live?";
    queryMutation.questions[0]!.inputs.text = "Where does the current café policy live?";
    const second = expectCompiled(queryMutation);
    expect(second.corpus.manifest.corpusSha256).not.toBe(first.corpus.manifest.corpusSha256);

    const experimentMutation = baseInput();
    experimentMutation.experiment.protocol.contextCeilings.utf8Bytes += 1;
    const third = expectCompiled(experimentMutation);
    expect(third.corpus.manifest.corpusSha256).not.toBe(first.corpus.manifest.corpusSha256);

    const cohortMutation = baseInput();
    cohortMutation.experiment.protocol.minimumUsefulEffects[0]!.cohort = "text-only";
    const fourth = expectCompiled(cohortMutation);
    expect(fourth.corpus.experiment.protocol.minimumUsefulEffects[0]?.cohort).toBe("text-only");
    expect(fourth.corpus.manifest.corpusSha256).not.toBe(first.corpus.manifest.corpusSha256);

    const buildContractMutation = baseInput();
    buildContractMutation.buildContractSha256 = "f".repeat(64);
    const fifth = expectCompiled(buildContractMutation);
    expect(fifth.corpus.manifest.buildContractSha256).toBe("f".repeat(64));
    expect(fifth.corpus.manifest.corpusSha256).not.toBe(first.corpus.manifest.corpusSha256);
    expect(fifth.corpus.manifest.candidateLockSha256).toBe(
      first.corpus.manifest.candidateLockSha256,
    );

    const changedAfterSeal = structuredClone(first.corpus) as DeepMutable<typeof first.corpus>;
    changedAfterSeal.description = "Changed after sealing.";
    expect(() => parseRetrievalEvaluationCorpusV2(changedAfterSeal, { claimPromotion: false })).toThrow("corpusSha256");
  });

  test("requires a canonical build contract digest before sealing", () => {
    const missing: Partial<MutableInput> = baseInput();
    delete missing.buildContractSha256;
    const missingResult = compileRetrievalEvaluationCorpusAuthoringV2(
      missing as PromotionCorpusAuthoringInputV2,
    );
    expect(missingResult.ok).toBe(false);
    expect(missingResult.errors.some(({ code, message }) =>
      code === "invalid-compiled-corpus"
      && message.includes("buildContractSha256"))).toBe(true);

    const invalid = baseInput();
    invalid.buildContractSha256 = "E".repeat(64);
    const invalidResult = compileRetrievalEvaluationCorpusAuthoringV2(invalid);
    expect(invalidResult.ok).toBe(false);
    expect(invalidResult.errors.some(({ code, message }) =>
      code === "invalid-compiled-corpus"
      && message.includes("64 lowercase hexadecimal characters"))).toBe(true);
  });

  test("rejects incompatible trust and duplicate source bindings before sealing", () => {
    const trust = baseInput();
    trust.documents[0]!.sourceClass = "captured-source";
    const trustResult = compileRetrievalEvaluationCorpusAuthoringV2(trust);
    expect(trustResult.ok).toBe(false);
    expect(trustResult.errors.map(({ code }) => code)).toContain("incompatible-source-trust");

    const binding = baseInput();
    binding.documents.push(document("notes/policy.md", "other-family"));
    const bindingResult = compileRetrievalEvaluationCorpusAuthoringV2(binding);
    expect(bindingResult.ok).toBe(false);
    expect(bindingResult.errors.map(({ code }) => code)).toContain("duplicate-source-path-binding");

    const duplicateEffect = baseInput();
    duplicateEffect.experiment.protocol.minimumUsefulEffects.push(structuredClone(
      duplicateEffect.experiment.protocol.minimumUsefulEffects[0]!,
    ));
    const duplicateEffectResult = compileRetrievalEvaluationCorpusAuthoringV2(duplicateEffect);
    expect(duplicateEffectResult.ok).toBe(false);
    expect(duplicateEffectResult.errors.some(({ code, message }) =>
      code === "invalid-compiled-corpus"
      && message.includes("repeats a minimum useful effect"))).toBe(true);
  });

  test("requires an independently supplied seal before making a promotion claim", () => {
    const mismatched = compilePromotionCorpusAuthoringV2(baseInput(), {
      expectedCorpusSha256: "f".repeat(64),
    });
    expect(mismatched.ok).toBe(false);
    expect(mismatched.errors.some(({ code, message }) =>
      code === "invalid-promotion-corpus"
      && message.includes("independently supplied corpus digest"))).toBe(true);
  });

  test("does not read ranking-shaped properties", () => {
    const input = baseInput() as PromotionCorpusAuthoringInputV2 & Record<string, unknown>;
    const poison = (): never => {
      throw new Error("ranking data was read");
    };
    Object.defineProperty(input, "rankings", { enumerable: true, get: poison });
    Object.defineProperty(input.questions[0]!, "retrieverOutput", { enumerable: true, get: poison });
    const compiled = expectCompiled(input);
    expect(compiled.corpus.queries[0]?.text).toBe("Where is the current café policy?");
  });
});

describe("promotion layout and leakage review", () => {
  test("reports the exact 168 split/cohort/support ledger and discrete granularity", () => {
    const repeat = (
      value: HumanAuthoredEvaluationQuestionV2["primaryStratum"],
      length: number,
    ): HumanAuthoredEvaluationQuestionV2["primaryStratum"][] => Array.from({ length }, () => value);
    const primaryPattern = [
      ...repeat("active-current-state", 4),
      ...repeat("code-path-context", 4),
      ...repeat("conceptual-recall", 4),
      ...repeat("exact-identity", 4),
      ...repeat("local-context", 10),
      ...repeat("metadata-constraint", 4),
      ...repeat("multi-note-relational", 10),
      ...repeat("source-provenance", 10),
      ...repeat("temporal-stale-current", 10),
    ];
    expect(primaryPattern).toHaveLength(60);
    const questions = Array.from({ length: 168 }, (_, index) => {
      const split = index < 48 ? "development" as const : "test" as const;
      const splitIndex = index < 48 ? index : index - 48;
      const cohort = split === "development"
        ? splitIndex < 24 ? "caller-seeded" as const : "text-only" as const
        : splitIndex < 60 ? "caller-seeded" as const : "text-only" as const;
      const cohortIndex = split === "test" && cohort === "text-only" ? splitIndex - 60 : splitIndex;
      const primaryStratum = split === "test"
        ? primaryPattern[cohortIndex] ?? "conceptual-recall"
        : "conceptual-recall" as const;
      const supported = split === "test" ? cohortIndex < 40 : splitIndex % 24 < 12;
      const dual = split === "test";
      return {
        key: `question-${index}`,
        text: `Question ${index}`,
        split,
        cohort,
        expectedSupport: supported ? "supported" as const : "insufficient" as const,
        primaryStratum,
        strata: supported ? [primaryStratum] : [primaryStratum, "no-answer-near-miss"] as const,
        inputs: cohort === "caller-seeded"
          ? {
              text: `Question ${index}`,
              context: { repositoryPath: "projects/app" },
              graph: { seeds: ["notes/policy"], depth: 1 as const },
              history: { query: `Question ${index}`, noteIds: ["notes/policy"] },
              metadata: { filters: [], tags: ["promotion"] },
            }
          : { text: `Question ${index}` },
        rawAssessments: dual ? [{}, {}] : [{}],
      };
    });
    const diagnostics = promotionCorpusDiagnosticsV2(
      questions as unknown as Parameters<typeof promotionCorpusDiagnosticsV2>[0],
      baseInput().experiment,
      undefined,
      35,
    );
    expect(diagnostics.promotionLayoutReady).toBe(true);
    expect(diagnostics.quotaLedger.every(({ met }) => met)).toBe(true);
    expect(diagnostics.quotaLedger.find(({ id }) => id === "test-supported")?.actual).toBe(80);
    expect(diagnostics.quotaLedger.find(({ id }) => id === "test-insufficient")?.actual).toBe(40);
    expect(diagnostics.quotaLedger.find(({ id }) => id === "development-text-only-insufficient")?.actual)
      .toBe(12);
    expect(diagnostics.pairedPower).toEqual({
      eligibleCallerSeededSupportedTestPairs: 40,
      independentSourceFamilyClusters: 35,
      requiredPairs: 35,
      met: true,
    });
    expect(diagnostics.powerGranularity.rows.find(({ id }) => id === "test")?.oneOutcomeStep.percentagePoints)
      .toBe(0.833333);
    expect(diagnostics.powerGranularity.rows.find(({ id }) => id === "test-insufficient")?.oneOutcomeStep.percentagePoints)
      .toBe(2.5);
    expect(diagnostics.powerGranularity.rows.find(({ id }) => id === "test-stratum-local-context"))
      .toMatchObject({ queryCount: 20, representsFivePointsExactly: true, nearestObservableFivePointDelta: 5 });
  });

  test("makes family split leakage, copied families, prompt duplicates, and n-gram overlap explicit", () => {
    const splitLeak = baseInput();
    splitLeak.questions = [
      supportedQuestion({ key: "development-policy" }),
      supportedQuestion({ key: "test-policy", split: "test", text: "Find the held-out policy." }),
    ];
    const splitResult = compileRetrievalEvaluationCorpusAuthoringV2(splitLeak);
    expect(splitResult.ok).toBe(false);
    expect(splitResult.errors.map(({ code }) => code)).toContain("source-family-split-leakage");
    expect(splitResult.errors.map(({ code }) => code)).toContain("source-path-split-leakage");
    expect(splitResult.reviewIssues.map(({ code }) => code)).toContain("source-family-split-leakage");

    const copied = baseInput();
    copied.documents = [
      document("development/policy.md", "development-family"),
      document("test/policy-copy.md", "test-family"),
    ];
    copied.questions = [
      supportedQuestion({
        key: "development-copy",
        sourcePath: "development/policy.md",
        text: "Where is the current policy for the alpha workspace today?",
      }),
      supportedQuestion({
        key: "test-copy",
        sourcePath: "test/policy-copy.md",
        split: "test",
        text: "Where is the current policy for the alpha workspace now?",
      }),
    ];
    copied.reviewPolicy = { ngramSize: 3, crossSplitNgramThreshold: 0.6 };
    const copiedResult = compileRetrievalEvaluationCorpusAuthoringV2(copied);
    expect(copiedResult.ok).toBe(false);
    expect(copiedResult.reviewIssues.map(({ code }) => code)).toContain("copied-source-family-cross-split");
    expect(copiedResult.reviewIssues.map(({ code }) => code)).toContain("high-cross-split-ngram-overlap");

    const duplicate = baseInput();
    duplicate.questions = [
      supportedQuestion({ key: "prompt-one", text: "Where is POLICY?" }),
      supportedQuestion({ key: "prompt-two", text: "where is policy" }),
    ];
    const duplicateResult = expectCompiled(duplicate);
    expect(duplicateResult.reviewIssues.map(({ code }) => code)).toContain("duplicate-normalized-prompt");

    const crossSplitDuplicate = baseInput();
    crossSplitDuplicate.questions = [
      supportedQuestion({ key: "development-prompt", text: "Where is POLICY?" }),
      supportedQuestion({ key: "test-prompt", split: "test", text: "where is policy" }),
    ];
    const crossSplitDuplicateResult = compileRetrievalEvaluationCorpusAuthoringV2(crossSplitDuplicate);
    expect(crossSplitDuplicateResult.ok).toBe(false);
    expect(crossSplitDuplicateResult.errors.map(({ code }) => code))
      .toContain("exact-cross-split-prompt-duplicate");
    expect(crossSplitDuplicateResult.reviewIssues.map(({ code }) => code))
      .toContain("exact-cross-split-prompt-duplicate");

    const weakenedReview = baseInput();
    weakenedReview.reviewPolicy = { ngramSize: 4, crossSplitNgramThreshold: 0.9 };
    const weakenedReviewResult = compileRetrievalEvaluationCorpusAuthoringV2(weakenedReview);
    expect(weakenedReviewResult.ok).toBe(false);
    expect(weakenedReviewResult.errors.map(({ code }) => code)).toContain("invalid-review-policy");
  });

  test("audits prompt-only label predictability with a deterministic balanced-accuracy ceiling", () => {
    const questions = [
      supportedQuestion({ key: "supported-a", text: "Where is the alpha policy recorded?" }),
      supportedQuestion({ key: "supported-b", text: "Where is the alpha procedure recorded?" }),
      supportedQuestion({ key: "insufficient-a", text: "What exact beta deadline was promised?" }),
      supportedQuestion({ key: "insufficient-b", text: "What exact beta date was promised?" }),
    ];
    questions[2]!.expectedSupport = "insufficient";
    questions[3]!.expectedSupport = "insufficient";
    const diagnostics = promotionCorpusLabelPredictabilityV2(questions, undefined);
    const support = diagnostics.rows.find(({ label }) => label === "expected-support");
    expect(diagnostics.classifier).toBe("leave-one-out-token-jaccard-1nn-v1");
    expect(support).toMatchObject({ balancedAccuracy: 1, ceiling: 0.65, met: false });
    expect(() => promotionCorpusLabelPredictabilityV2(questions, {
      labelPredictabilityCeiling: 0.66,
    })).toThrow("cannot weaken");

    const promotionInput = baseInput();
    promotionInput.questions = questions;
    const promoted = compilePromotionCorpusAuthoringV2(promotionInput, {
      expectedCorpusSha256: "f".repeat(64),
    });
    expect(promoted.ok).toBe(false);
    expect(promoted.errors.map(({ code }) => code)).toContain("prompt-label-predictability-ceiling");
  });
});
