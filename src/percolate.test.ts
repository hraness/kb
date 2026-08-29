import { describe, expect, test } from "bun:test";

import {
  MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE,
  PERCOLATION_RESULT_SCHEMA_VERSION,
  parsePercolationCliOutput,
  parsePercolationCliOutputV1,
  parsePercolationResult,
  parsePercolationResultV1,
  percolateVault,
  type MissingConceptCandidate,
  type MissingRelationCandidate,
  type PercolationCliOutputV1,
  type PercolationCliOutputV2,
  type PercolationResultV1,
} from "./percolate.js";
import {
  analyzeVault,
  parseNote,
  type Note,
  type VaultAnalysis,
} from "./graph.js";

function discoveryFixture(): readonly Note[] {
  return [
    parseNote("concepts/retrieval.md", [
      "---",
      "type: concept",
      "---",
      "# Retrieval",
    ].join("\n")),
    parseNote("notes/a.md", [
      "---",
      "tags: [retrieval, local-first, shared]",
      "relations:",
      "  about:",
      "    - concepts/retrieval",
      "---",
      "# Alpha",
    ].join("\n")),
    parseNote("notes/b.md", [
      "---",
      "tags: [retrieval, local-first, shared]",
      "relations:",
      "  about:",
      "    - concepts/retrieval",
      "---",
      "# Beta",
    ].join("\n")),
    parseNote(
      "notes/source.md",
      "# Source\n\nTarget System should be connected after review.\n",
    ),
    parseNote("notes/target.md", "# Target System\n"),
  ];
}

function denseAnalysis(notes: readonly Note[]): VaultAnalysis {
  return {
    noteCount: notes.length,
    contextualLinks: [],
    backlinks: [],
    authoredRelations: [],
    externalAuthoredRelations: [],
    noteConnections: notes.map((note) => ({
      id: note.id,
      path: note.path,
      inboundContextualCount: 0,
      outboundContextualCount: 0,
      backlinks: [],
      inboundRelationCount: 0,
      outboundRelationCount: 0,
      relationBacklinks: [],
    })),
    issues: [],
    relationIssues: [],
    orphans: notes.map((note) => note.path),
    mentions: [],
  };
}

describe("read-only graph percolation", () => {
  test("finds repeated tags without concepts and shared neighborhoods without edges", () => {
    const notes = discoveryFixture();
    const result = percolateVault(notes, analyzeVault(notes));
    const concepts = result.candidates.filter(
      (candidate): candidate is MissingConceptCandidate =>
        candidate.kind === "missing-concept",
    );

    expect(concepts.map((candidate) => candidate.tag)).toEqual([
      "local-first",
      "shared",
    ]);
    expect(concepts[0]).toMatchObject({
      suggestedId: "notes/local-first",
      support: 2,
      evidenceTruncated: false,
    });
    expect(concepts.some((candidate) => candidate.tag === "retrieval")).toBe(false);

    const shared = result.candidates.find(
      (candidate): candidate is MissingRelationCandidate =>
        candidate.kind === "missing-relation"
        && candidate.source === "notes/a"
        && candidate.target === "notes/b",
    );
    expect(shared).toBeDefined();
    expect(shared?.support).toBe(4);
    expect(shared?.predicate).toEqual({ kind: "required" });
    expect(new Set(shared?.evidence.map((evidence) => evidence.kind))).toEqual(
      new Set(["shared-concept", "shared-tag"]),
    );
    expect(result.schemaVersion).toBe(PERCOLATION_RESULT_SCHEMA_VERSION);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(shared)).toBe(true);
    expect(Object.isFrozen(shared?.evidence)).toBe(true);
  });

  test("parses V2 and historical V1 as distinct immutable contracts", () => {
    const v2 = percolateVault(discoveryFixture(), analyzeVault(discoveryFixture()));
    expect(parsePercolationResult(v2)).toEqual(v2);
    expect(() => parsePercolationResultV1(v2)).toThrow("exactly");

    const v1: PercolationResultV1 = {
      candidates: v2.candidates.map((candidate) =>
        candidate.kind === "missing-relation"
          ? {
              kind: candidate.kind,
              source: candidate.source,
              target: candidate.target,
              suggestedPredicate: "related-to" as const,
              support: candidate.support,
              evidenceTruncated: candidate.evidenceTruncated,
              evidence: candidate.evidence,
            }
          : candidate),
      truncated: v2.truncated,
    };
    const parsedV1 = parsePercolationResultV1(v1);
    expect(parsedV1).toEqual(v1);
    expect(Object.isFrozen(parsedV1)).toBe(true);
    expect(Object.isFrozen(parsedV1.candidates)).toBe(true);
    expect(() => parsePercolationResult(v1)).toThrow("exactly");

    const cliV1: PercolationCliOutputV1 = {
      root: "/vault",
      note: "Alpha lookup",
      minSupport: 2,
      candidates: parsedV1.candidates,
      truncated: parsedV1.truncated,
    };
    const cliV2: PercolationCliOutputV2 = {
      root: "/vault",
      note: "Alpha lookup",
      minSupport: 2,
      limit: 25,
      schemaVersion: 2,
      candidates: v2.candidates,
      truncated: v2.truncated,
    };
    expect(parsePercolationCliOutputV1(cliV1)).toEqual(cliV1);
    expect(parsePercolationCliOutput(cliV2)).toEqual(cliV2);
    expect(() => parsePercolationCliOutput(cliV1)).toThrow("exactly");
    expect(() => parsePercolationCliOutputV1(cliV2)).toThrow("exactly");
    expect(() => parsePercolationResult(cliV2)).toThrow("exactly");
  });

  test("rejects structural capabilities, ambiguity, and inconsistent evidence", () => {
    const notes = discoveryFixture();
    const valid = percolateVault(notes, analyzeVault(notes));
    const relation = valid.candidates.find((candidate) =>
      candidate.kind === "missing-relation");
    expect(relation).toBeDefined();
    if (relation === undefined) throw new Error("missing fixture relation");

    expect(parsePercolationResult({
      ...valid,
      candidates: valid.candidates.map((candidate) =>
        candidate === relation
          ? { ...candidate, predicate: { kind: "suggested", value: "evidenced-by" } }
          : candidate),
    }).candidates).toContainEqual(expect.objectContaining({
      kind: "missing-relation",
      predicate: { kind: "suggested", value: "evidenced-by" },
    }));

    expect(() => parsePercolationResult({ ...valid, extra: true })).toThrow("exactly");
    expect(() => parsePercolationResult(Object.assign(
      Object.create({ inherited: true }) as object,
      valid,
    ))).toThrow("plain data object");
    const accessor = { ...valid } as Record<string, unknown>;
    Object.defineProperty(accessor, "truncated", {
      enumerable: true,
      get: () => false,
    });
    expect(() => parsePercolationResult(accessor)).toThrow("data property");
    expect(() => parsePercolationResult({
      ...valid,
      candidates: [
        ...valid.candidates,
        ...Array.from({ length: 1_001 - valid.candidates.length }, () => relation),
      ],
    })).toThrow("1,000-entry limit");
    expect(() => parsePercolationResult({
      ...valid,
      candidates: valid.candidates.map((candidate) =>
        candidate === relation
          ? {
              ...candidate,
              evidence: candidate.evidence.map((evidence, index) =>
                index === 0 && "note" in evidence
                  ? { ...evidence, note: "notes/not-an-endpoint", path: "notes/not-an-endpoint.md" }
                  : evidence),
            }
          : candidate),
    })).toThrow("unordered endpoints");
    expect(() => parsePercolationResult({
      ...valid,
      candidates: valid.candidates.toReversed(),
    })).toThrow("canonical percolation ordering");
  });

  test("turns graph mentions into sourced candidates and respects explicit edges", () => {
    const unlinkedNotes = discoveryFixture();
    const unlinked = percolateVault(
      unlinkedNotes,
      analyzeVault(unlinkedNotes),
    ).candidates.find((candidate) =>
      candidate.kind === "unlinked-mention"
      && candidate.source === "notes/source"
      && candidate.target === "notes/target");
    expect(unlinked).toMatchObject({
      support: 1,
      evidenceTruncated: false,
      evidence: [{
        kind: "mention",
        line: 3,
        phrase: "Target System",
      }],
    });

    const linkedNotes = [
      parseNote(
        "notes/a.md",
        "---\ntags: [shared]\n---\n# Alpha\n\n[[notes/b]]\n",
      ),
      parseNote("notes/b.md", "---\ntags: [shared]\n---\n# Beta\n"),
    ];
    const linked = percolateVault(linkedNotes, analyzeVault(linkedNotes));
    expect(linked.candidates.some((candidate) =>
      candidate.kind === "missing-relation"
      && candidate.source === "notes/a"
      && candidate.target === "notes/b")).toBe(false);
  });

  test("reports self, reciprocal, and invalid authored relationship hygiene", () => {
    const notes = [
      parseNote("notes/a.md", [
        "---",
        "relations:",
        "  self-check: [notes/a]",
        "  mirrors: [notes/b]",
        "  broken: [notes/missing, notes/missing]",
        "  Malformed: [notes/b]",
        "---",
        "# Alpha",
      ].join("\n")),
      parseNote("notes/b.md", [
        "---",
        "relations:",
        "  mirrors: [notes/a]",
        "---",
        "# Beta",
      ].join("\n")),
    ];
    const result = percolateVault(notes, analyzeVault(notes));
    const problems = result.candidates
      .filter((candidate) => candidate.kind === "relation-hygiene")
      .map((candidate) => candidate.problem);

    expect(problems).toContain("self-relation");
    expect(problems).toContain("reciprocal-relation");
    expect(problems).toContain("broken-relation");
    expect(problems).toContain("malformed-relation");
    expect(problems.filter((problem) => problem === "broken-relation"))
      .toHaveLength(1);
    expect(result.candidates
      .filter((candidate) => candidate.kind === "relation-hygiene")
      .every((candidate) => candidate.evidence.length > 0)).toBe(true);
  });

  test("bounds nested ambiguous-target evidence before materializing candidates", () => {
    const note = parseNote("notes/a.md", "# Alpha\n");
    const candidates = Array.from(
      { length: MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE + 1 },
      (_, index) => `notes/candidate-${String(index).padStart(3, "0")}`,
    );
    const relationIssue = {
      kind: "ambiguous" as const,
      source: note.path,
      line: 2,
      predicate: "related-to",
      target: "candidate",
      candidates,
    };
    const analysis = {
      ...denseAnalysis([note]),
      relationIssues: [relationIssue],
    };

    const result = percolateVault([note], analysis);
    const hygiene = result.candidates.find((candidate) =>
      candidate.kind === "relation-hygiene");
    expect(hygiene).toMatchObject({
      kind: "relation-hygiene",
      problem: "ambiguous-relation",
      evidenceTruncated: true,
    });
    expect(hygiene?.evidence[0]).toMatchObject({
      kind: "relation-issue",
      candidatesTruncated: true,
    });
    expect(
      hygiene?.evidence[0]?.kind === "relation-issue"
        ? hygiene.evidence[0].candidates
        : [],
    ).toHaveLength(MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE);

    expect(() =>
      percolateVault([note], {
        ...analysis,
        relationIssues: Array.from({ length: 2_500 }, () => relationIssue),
      })).toThrow("evidence limit");
  });

  test("is deterministic across permutations and does not mutate inputs", () => {
    const notes = discoveryFixture();
    const analysis = analyzeVault(notes);
    const notesBefore = JSON.stringify(notes);
    const analysisBefore = JSON.stringify(analysis);
    const forward = percolateVault(notes, analysis);
    const reversed = [...notes].reverse();

    expect(percolateVault(reversed, analyzeVault(reversed))).toEqual(forward);
    expect(JSON.stringify(notes)).toBe(notesBefore);
    expect(JSON.stringify(analysis)).toBe(analysisBefore);
  });

  test("keeps bounded shared evidence deterministic across authored tag order", () => {
    const tags = Array.from(
      { length: 60 },
      (_, index) => `tag-${String(index).padStart(2, "0")}`,
    );
    const notesFor = (orderedTags: readonly string[]): readonly Note[] => [
      parseNote(
        "notes/a.md",
        `---\ntags: [${orderedTags.join(", ")}]\n---\n# Alpha\n`,
      ),
      parseNote(
        "notes/b.md",
        `---\ntags: [${orderedTags.join(", ")}]\n---\n# Beta\n`,
      ),
    ];
    const forwardNotes = notesFor(tags);
    const reverseNotes = notesFor(tags.toReversed());
    const forward = percolateVault(forwardNotes, analyzeVault(forwardNotes), {
      limit: 1_000,
    });
    const reverse = percolateVault(reverseNotes, analyzeVault(reverseNotes), {
      limit: 1_000,
    });

    expect(reverse).toEqual(forward);
    const relation = forward.candidates.find((candidate) =>
      candidate.kind === "missing-relation");
    expect(relation).toMatchObject({
      support: 60,
      evidenceTruncated: true,
    });
    expect(relation?.evidence).toHaveLength(
      MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE,
    );
  });

  test("never suggests an occupied concept ID and exposes the collision", () => {
    const notes = [
      parseNote("notes/foo.md", "---\ntype: note\n---\n# Foo memo\n"),
      parseNote("notes/a.md", "---\ntags: [foo]\n---\n# Alpha\n"),
      parseNote("notes/b.md", "---\ntags: [foo]\n---\n# Beta\n"),
    ];
    const concept = percolateVault(notes, analyzeVault(notes)).candidates.find(
      (candidate): candidate is MissingConceptCandidate =>
        candidate.kind === "missing-concept",
    );

    expect(concept).toMatchObject({
      tag: "foo",
      suggestedId: "notes/foo-concept",
      collidesWith: "notes/foo",
    });
  });

  test("keeps suggestions compact for unusually long authored tags", () => {
    const tag = "long-".repeat(1_000);
    const notes = [
      parseNote("notes/a.md", `---\ntags: ["${tag}"]\n---\n# Alpha\n`),
      parseNote("notes/b.md", `---\ntags: ["${tag}"]\n---\n# Beta\n`),
    ];
    const concept = percolateVault(notes, analyzeVault(notes)).candidates.find(
      (candidate): candidate is MissingConceptCandidate =>
        candidate.kind === "missing-concept",
    );

    expect(concept?.suggestedId).toStartWith("notes/long-long-");
    expect(concept?.suggestedId.length).toBeLessThan(180);
  });

  test("keeps scoped mention and percolation pairing linear and deterministic", () => {
    const notes = Array.from({ length: 710 }, (_, index) =>
      parseNote(
        `notes/n-${String(index).padStart(3, "0")}.md`,
        `---\ntags: [dense, shared]\n---\n# Note ${index}\n`,
      ));
    const options = {
      note: "notes/n-000",
      limit: 1,
    } as const;
    const analysisFor = (ordered: readonly Note[]): VaultAnalysis =>
      analyzeVault(ordered, {
        mentionScope: (note) => note.id === options.note,
        maxMentionPairs: ordered.length * 2,
        maxMentions: ordered.length * 2,
      });
    const result = percolateVault(notes, analysisFor(notes), options);
    const candidate = result.candidates[0];

    expect(candidate).toMatchObject({
      kind: "missing-concept",
      tag: "dense",
      suggestedId: "notes/dense",
      support: 710,
      evidenceTruncated: true,
    });
    expect(candidate?.evidence).toHaveLength(
      MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE,
    );
    expect(candidate?.evidence.some((evidence) =>
      "note" in evidence && evidence.note === "notes/n-000")).toBe(true);
    expect(result.truncated).toBe(true);
    const reversed = notes.toReversed();
    expect(percolateVault(reversed, analysisFor(reversed), options)).toEqual(result);
  });
});
