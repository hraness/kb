import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { buildEvaluationEvidenceRegistry } from "./evaluation-evidence.js";
import {
  createEvaluationReaderTokenizerV2,
  packKnowledgeBaseEvaluationContextV2,
  utf8ByteEvaluationReaderTokenizerV2,
  type EvaluationReaderTokenizerV2,
} from "./evaluation-packing-v2.js";
import type { KnowledgeBaseEvaluationRetrieverResultV2 } from "./evaluation-kb-v2.js";

const registry = buildEvaluationEvidenceRegistry({
  documents: [{
    documentId: "notes/a",
    sourcePath: "notes/a.md",
    trustClass: "authoritative-current",
    markdown: "# A\n\nFirst fact.\n\nSecond fact.\n",
  }],
});
function fixtureEvidence(text: string) {
  const unit = registry.units.find((candidate) => candidate.text === text);
  if (unit === undefined) throw new Error("Missing packing fixture evidence.");
  return unit;
}
const first = fixtureEvidence("First fact.\n");
const second = fixtureEvidence("Second fact.\n");
const boundarySensitiveTokenizer = createEvaluationReaderTokenizerV2({
  id: "boundary-sensitive-test-tokenizer-v1",
  definition: "Test tokenizer: one framing token plus one token per fact; v1\n",
  count: (text) => text === "" ? 0 : 1 + (text.match(/fact\./gu)?.length ?? 0),
});
const SOURCE_FAMILY_ID = "sf-0000000000000001";
const corpusEvidenceUnits = registry.units.map((unit) => ({
  id: unit.id,
  documentId: unit.documentId,
  sourceFamilyId: SOURCE_FAMILY_ID,
  trustClass: "authoritative-current" as const,
  sourcePath: unit.sourcePath,
  lineRange: unit.lineRange,
  headingPath: unit.headingAncestry,
  ...(unit.pdfPage === undefined ? {} : { sourcePage: unit.pdfPage }),
}));

function corpus(
  utf8Bytes = 1_024,
  readerTokens = 1_024,
  tokenizer: EvaluationReaderTokenizerV2 = utf8ByteEvaluationReaderTokenizerV2,
): Parameters<typeof packKnowledgeBaseEvaluationContextV2>[0]["corpus"] {
  return {
    experiment: {
      environment: { tokenizer: {
        id: tokenizer.id,
        sha256: tokenizer.sha256,
      } },
      protocol: { contextCeilings: { utf8Bytes, readerTokens } },
    },
    sourceFamilies: [{
      id: SOURCE_FAMILY_ID,
      sourceClass: "authored-note",
      trustClass: "authoritative-current",
    }],
    documents: [{
      id: first.documentId,
      sourceFamilyId: SOURCE_FAMILY_ID,
      sourcePath: first.sourcePath,
      trustClass: "authoritative-current",
    }],
    evidenceUnits: corpusEvidenceUnits,
  };
}

function locator(unit: typeof first) {
  return {
    evidenceUnitId: unit.id,
    sourceFamilyId: SOURCE_FAMILY_ID,
    sourceClass: "authored-note" as const,
    trustClass: "authoritative-current" as const,
    sourcePath: unit.sourcePath,
    lineRange: unit.lineRange,
    headingPath: unit.headingAncestry,
  };
}

function binding(unit: typeof first) {
  const evidenceLocator = locator(unit);
  return {
    evidenceUnitId: unit.id,
    registryUnitId: unit.id,
    documentId: unit.documentId,
    sourceFamilyId: evidenceLocator.sourceFamilyId,
    sourceClass: evidenceLocator.sourceClass,
    trustClass: evidenceLocator.trustClass,
    locator: evidenceLocator,
  };
}

function result(
  units: readonly (typeof first)[] = [first],
  withEvidence = true,
): KnowledgeBaseEvaluationRetrieverResultV2 {
  const firstUnit = units[0];
  const evidenceUnitIds = withEvidence ? units.map(({ id }) => id) : [];
  const provenance = withEvidence ? units.map(locator) : [];
  return {
    retrieverId: "candidate",
    status: "ready",
    candidates: firstUnit === undefined ? [] : [{
      documentId: firstUnit.documentId,
      evidenceUnitIds,
      rank: 1,
      provenance,
    }],
    trace: {
      laneOutcomes: [],
      candidateDecisions: firstUnit === undefined ? [] : [{
        documentId: firstUnit.documentId,
        evidenceUnitIds,
        laneId: "hybrid",
        sourceRank: 1,
        disposition: "accepted",
        reasonCodes: ["primary"],
        outputRank: 1,
        provenance,
      }],
    },
    diagnostics: [],
    rawEvidence: [],
    evidenceUnits: units.map(binding),
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

describe("evaluation context packing", () => {
  test("packs exact accepted registry text with inspectable provenance under both ceilings", async () => {
    const packed = await packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: result(),
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    });
    expect(packed.text).toContain(
      `[notes/a.md:3-3 evidence=${first.id} source=authored-note trust=authoritative-current]`,
    );
    expect(packed.text).toContain("First fact.");
    expect(packed.readerTokens).toBe(packed.utf8Bytes);
    expect(packed.includedEvidenceUnitIds).toEqual([first.id]);
    expect(packed.truncated).toBe(false);
    expect(packed.packedBytesSha256).toBe(
      createHash("sha256").update(packed.text, "utf8").digest("hex"),
    );
  });

  test("stops at a whole evidence boundary and rejects tokenizer drift or missing provenance", async () => {
    const truncated = await packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(8, 8),
      result: result(),
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    });
    expect(truncated).toMatchObject({ text: "", utf8Bytes: 0, readerTokens: 0, truncated: true });
    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: result(),
      evidenceRegistry: registry,
      tokenizer: boundarySensitiveTokenizer,
    })).rejects.toThrow("does not match");
    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: result([first], false),
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    })).rejects.toThrow("must carry ranked evidence provenance");
  });

  test("rejects substituted metadata or live text before rendering", () => {
    const valid = result();
    const original = valid.evidenceUnits[0]!;
    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: {
        ...valid,
        evidenceUnits: [{
          ...original,
          sourceClass: "repository-file",
          locator: { ...original.locator, sourceClass: "repository-file" },
        }],
      },
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    })).rejects.toThrow("does not exactly match its live registry metadata");

    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: valid,
      evidenceRegistry: {
        ...registry,
        units: registry.units.map((unit) => unit.id === first.id
          ? { ...unit, text: "Substituted fact.\n" }
          : unit),
      },
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    })).rejects.toThrow("registry validation failed");

    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: {
        ...valid,
        evidenceUnits: [{ ...original, registryUnitId: second.id }],
      },
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    })).rejects.toThrow("does not exactly match its live registry metadata");
  });

  test("packs cross-document relationship evidence only for graph decisions", async () => {
    const valid = result();
    const decision = valid.trace.candidateDecisions[0]!;
    const graphResult: KnowledgeBaseEvaluationRetrieverResultV2 = {
      ...valid,
      candidates: [{
        ...valid.candidates[0]!,
        documentId: "notes/graph-target",
      }],
      trace: {
        ...valid.trace,
        candidateDecisions: [{
          ...decision,
          documentId: "notes/graph-target",
          laneId: "graph",
        }],
      },
    };
    const packed = await packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: graphResult,
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    });
    expect(packed.includedEvidenceUnitIds).toEqual([first.id]);

    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: {
        ...graphResult,
        trace: {
          ...graphResult.trace,
          candidateDecisions: [{
            ...graphResult.trace.candidateDecisions[0]!,
            laneId: "metadata",
          }],
        },
      },
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    })).rejects.toThrow("does not match verified live evidence");
  });

  test("packs evidence contributed by a deduplicated structural lane", async () => {
    const aggregate = result([first, second]);
    const primary = aggregate.trace.candidateDecisions[0]!;
    const deduplicated: KnowledgeBaseEvaluationRetrieverResultV2 = {
      ...aggregate,
      trace: {
        ...aggregate.trace,
        candidateDecisions: [{
          ...primary,
          evidenceUnitIds: [first.id],
          provenance: [locator(first)],
        }, {
          documentId: first.documentId,
          evidenceUnitIds: [second.id],
          laneId: "metadata",
          sourceRank: 1,
          disposition: "excluded",
          reasonCodes: ["deduplicated"],
          provenance: [locator(second)],
        }],
      },
    };
    const packed = await packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: deduplicated,
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    });
    expect(packed.includedEvidenceUnitIds).toEqual([first.id, second.id]);
    expect(packed.text.indexOf("First fact.")).toBeLessThan(packed.text.indexOf("Second fact."));
  });

  test("rejects duplicate result, corpus, and registry bindings", () => {
    const valid = result();
    const original = valid.evidenceUnits[0]!;
    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: { ...valid, evidenceUnits: [original, original] },
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    })).rejects.toThrow("repeats corpus unit");

    const secondBinding = binding(second);
    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: {
        ...result([first, second]),
        evidenceUnits: [original, { ...secondBinding, registryUnitId: original.registryUnitId }],
      },
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    })).rejects.toThrow("repeats live registry binding");

    const duplicateCorpus = corpus();
    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: {
        ...duplicateCorpus,
        evidenceUnits: [...duplicateCorpus.evidenceUnits, duplicateCorpus.evidenceUnits[0]!],
      },
      result: valid,
      evidenceRegistry: registry,
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    })).rejects.toThrow("Evaluation corpus repeats evidence unit");

    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: valid,
      evidenceRegistry: { ...registry, units: [...registry.units, registry.units[0]!] },
      tokenizer: utf8ByteEvaluationReaderTokenizerV2,
    })).rejects.toThrow("Live evidence registry repeats unit");
  });

  test("rejects forged tokenizers and counts each prospective full context", async () => {
    const forged = {
      id: utf8ByteEvaluationReaderTokenizerV2.id,
      sha256: utf8ByteEvaluationReaderTokenizerV2.sha256,
      count: () => 0,
    } as unknown as EvaluationReaderTokenizerV2;
    expect(packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(),
      result: result(),
      evidenceRegistry: registry,
      tokenizer: forged,
    })).rejects.toThrow("not a registered tokenizer capability");

    const packed = await packKnowledgeBaseEvaluationContextV2({
      corpus: corpus(4_096, 3, boundarySensitiveTokenizer),
      result: result([first, second]),
      evidenceRegistry: registry,
      tokenizer: boundarySensitiveTokenizer,
    });
    expect(packed.includedEvidenceUnitIds).toEqual([first.id, second.id]);
    expect(packed.readerTokens).toBe(3);
    expect(packed.truncated).toBe(false);
  });
});
