import { describe, expect, test } from "bun:test";

import { openGraphAuthority, type GraphProof } from "./graph-authority.js";
import { percolateWithGraph } from "./graph-percolation.js";
import { analyzeVault, parseNote, type Note } from "./graph.js";
import { percolateVault } from "./percolate.js";
import type { VaultSnapshot } from "./vault.js";

function snapshot(notes: readonly Note[], catalog = "navigation/front"): VaultSnapshot {
  return {
    root: "/wordcell-percolation-fixture",
    indexPath: `/wordcell-percolation-fixture/${catalog}.md`,
    catalogMode: "authored",
    index: "authored",
    notes,
    analysis: analyzeVault(notes, { catalogNoteId: catalog, mentionScope: () => false }),
  };
}

function fixture(): VaultSnapshot {
  return snapshot([
    parseNote("navigation/front.md", "# Navigation\n[[notes/alpha]] [[notes/beta]]\n"),
    parseNote("notes/alpha.md", "---\ndocument_id: alpha\ntags: [shared, second]\n---\n# Alpha Design\n\n[[concepts/graph]]\n"),
    parseNote("notes/beta.md", "---\ndocument_id: beta\ntags: [shared, second]\nrelations:\n  applies: concepts/graph\n---\n# Beta Design\n"),
    parseNote("concepts/graph.md", "---\ntype: concept\n---\n# Graph Systems\n"),
    parseNote("notes/gamma.md", "# Gamma Design\n\nAlpha Design offers a useful example.\n"),
  ]);
}

function baseline(input: VaultSnapshot, limit = 25) {
  const notes = input.notes.map(({ path, content }) => parseNote(path, content));
  return percolateVault(notes, analyzeVault(notes, {
    catalogNoteId: "navigation/front",
    mentionScope: (note) => note.id === "notes/alpha",
    maxMentionPairs: 250_000,
  }), { note: "notes/alpha", minSupport: 2, limit });
}

function proofPaths(proofs: readonly GraphProof[]): string[] {
  return proofs.flatMap((proof) => proof.kind === "fact"
    ? proof.sources.map((source) => source.path)
    : proof.kind === "derived" ? proofPaths(proof.premises) : []);
}

describe("percolation with actual Oh proofs", () => {
  test("retains V2 suggestions and returns independently verifiable authored tag and concept support", async () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = await percolateWithGraph(input, { note: "notes/alpha", minSupport: 2, limit: 25 });
    expect(result.schemaVersion).toBe(1);
    expect(result.kind).toBe("wordcell.graph-percolation");
    expect(result.suggestions).toEqual(baseline(input));
    expect(result.suggestions.schemaVersion).toBe(2);
    expect(result.suggestions.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "missing-relation", source: "notes/alpha", target: "notes/beta", support: 3 }),
      expect.objectContaining({ kind: "unlinked-mention", source: "notes/gamma", target: "notes/alpha" }),
    ]));
    const { sharedTags, sharedConcepts } = result.positiveSupport;
    expect(sharedTags.rows.map(({ values }) => values)).toEqual([
      ["notes/alpha", "notes/beta", "second"], ["notes/alpha", "notes/beta", "shared"],
    ]);
    expect(sharedConcepts.rows.map(({ values }) => values))
      .toEqual([["notes/alpha", "notes/beta", "concepts/graph"]]);
    expect(new Set(proofPaths(sharedConcepts.rows.flatMap(({ proofs }) => proofs))))
      .toEqual(new Set(["notes/alpha.md", "notes/beta.md", "concepts/graph.md"]));
    const authority = await openGraphAuthority(input);
    try {
      for (const support of [sharedTags, sharedConcepts]) {
        expect(support.authority).toBe("derived");
        expect(support.revision).toBe(result.revision);
        expect(support.limits).toMatchObject({ rows: 1_000, workUnits: 1_000_000, resultBytes: 1_048_576 });
        expect(support.truncated).toBe(false);
        expect(support.proofsTruncated).toBe(false);
        expect(await authority.verifyResult(support)).toBe(true);
        expect(await authority.verifyResult(JSON.parse(JSON.stringify(support)))).toBe(true);
      }
      const forged = structuredClone(sharedTags);
      Object.assign(forged, { revision: "0".repeat(64) });
      expect(await authority.verifyResult(forged)).toBe(false);
    } finally { await authority.close(); }
    expect(input).toEqual(before);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.positiveSupport)).toBe(true);
  });

  test("keeps suggestion truncation distinct from complete positive support", async () => {
    const input = fixture();
    const result = await percolateWithGraph(input, { note: "notes/alpha", minSupport: 2, limit: 1 });
    expect(result.suggestions).toEqual(baseline(input, 1));
    expect(result.suggestions.candidates).toHaveLength(1);
    expect(result.suggestions.truncated).toBe(true);
    expect(result.positiveSupport.sharedTags.rows).toHaveLength(2);
    expect(result.positiveSupport.sharedConcepts.rows).toHaveLength(1);
    for (const support of Object.values(result.positiveSupport)) {
      expect(support.truncated).toBe(false);
      expect(support.proofsTruncated).toBe(false);
    }
  });

  test("handles a common shared tag within budget and still rejects an explicitly insufficient query budget", async () => {
    const notes = Array.from({ length: 128 }, (_, index) => parseNote(`notes/n-${index}.md`,
      `---\ntags: [crowded]\n---\n# Unique ${index}\n`));
    const input = snapshot(notes);
    const before = JSON.stringify(input);
    const result = await percolateWithGraph(input, { note: "notes/n-0", limit: 1 });
    expect(result.positiveSupport.sharedTags.rows).toHaveLength(127);
    expect(result.positiveSupport.sharedTags.truncated).toBe(false);
    expect(result.positiveSupport.sharedTags.proofsTruncated).toBe(false);
    expect(result.positiveSupport.sharedTags.stats.workUnits).toBeLessThan(1_000_000);
    const authority = await openGraphAuthority(input);
    try {
      await expect(authority.query({ program: "shared-tags", note: "notes/n-0", limits: { workUnits: 1 } }))
        .rejects.toMatchObject({ name: "GraphAuthorityError", code: "budget" });
    } finally { await authority.close(); }
    expect(JSON.stringify(input)).toBe(before);
  });

  test("rejects unavailable, ambiguous, and catalog selections without changing the snapshot", async () => {
    const input = fixture();
    const before = structuredClone(input);
    for (const note of ["missing", "navigation/front"]) {
      await expect(percolateWithGraph(input, { note })).rejects.toMatchObject({ code: "invalid-input" });
    }
    const ambiguous = snapshot([...input.notes,
      parseNote("other/alpha.md", "# Alpha Design\n")]);
    await expect(percolateWithGraph(ambiguous, { note: "Alpha Design" }))
      .rejects.toMatchObject({ code: "invalid-input" });
    expect(input).toEqual(before);
  });
});
