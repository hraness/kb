import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fc from "fast-check";

import { GRAPH_LIMITS, GraphAuthorityError, type GraphFact } from "./graph-authority-model.js";
import { createGraphSnapshot } from "./graph-facts.js";
import { analyzeVault, parseNote, type Note } from "./graph.js";
import type { VaultSnapshot } from "./vault.js";

function snapshot(notes: readonly Note[], root = "/vault", catalog = "index.md"): VaultSnapshot {
  return {
    root,
    indexPath: `${root}/${catalog}`,
    catalogMode: "authored",
    index: "authored",
    notes,
    // Deliberately empty: extraction must derive its own analysis from the source bytes.
    analysis: analyzeVault([]),
  };
}

const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,18}$/);
const allFacts = (notes: readonly Note[]): readonly GraphFact[] =>
  createGraphSnapshot(snapshot(notes)).records.flatMap((record) => record.facts);

function codeOf(run: () => unknown): GraphAuthorityError["code"] | null {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(GraphAuthorityError);
    return (error as GraphAuthorityError).code;
  }
  return null;
}

describe("authored graph snapshots", () => {
  test("retains exact local and external relation direction, source lines, tags, and scope declarations", () => {
    const alpha = parseNote("notes/alpha.md", [
      "---",
      "title: Alpha",
      "document_id: alpha-v1",
      "type: note",
      "tags: [Shared, '#shared', second]",
      "repository_scopes: [src, src/query.ts]",
      "relations:",
      "  supports: notes/beta",
      "  cites: kb://owner/other/stable-note",
      "---",
      "# Alpha",
      "",
      "[[notes/beta]] [[notes/beta]] [[notes/alpha]] [[index]] [[image.png]]",
    ].join("\n"));
    const beta = parseNote("notes/beta.md", "---\ntype: CONCEPT\n---\n# Beta\n");
    const catalog = parseNote("index.md", "# Navigation\n[[notes/alpha]]\n");
    const graph = createGraphSnapshot(snapshot([beta, catalog, alpha]));
    expect(graph.records).toHaveLength(2);
    expect(graph.factCount).toBe(10);
    expect(graph.sourceDigests).toEqual([catalog, alpha, beta].map((note) => ({
      path: note.path, contentSha256: digest(note.content),
    })));
    expect(graph.records.find(({ id }) => id === alpha.id)).toMatchObject({
      key: `edition:note/${digest("document:alpha-v1")}`,
      id: "notes/alpha", path: "notes/alpha.md", documentId: "alpha-v1",
      contentSha256: digest(alpha.content),
    });
    expect(graph.records.flatMap(({ facts }) => facts)).toEqual(expect.arrayContaining([
      { relation: "wordcell.note", tuple: ["notes/alpha", "notes/alpha.md", "Alpha", "note"] },
      { relation: "wordcell.note", tuple: ["notes/beta", "notes/beta.md", "Beta", "CONCEPT"] },
      { relation: "wordcell.concept", tuple: ["notes/beta"] },
      { relation: "wordcell.link", tuple: ["notes/alpha", "notes/beta", 13] },
      { relation: "wordcell.relation", tuple: ["notes/alpha", "notes/beta", "supports", 8] },
      { relation: "wordcell.external-relation", tuple: ["notes/alpha", "kb://owner/other/stable-note", "cites", 9] },
      { relation: "wordcell.tag", tuple: ["notes/alpha", "shared"] },
      { relation: "wordcell.tag", tuple: ["notes/alpha", "second"] },
      { relation: "wordcell.scope", tuple: ["notes/alpha", "src"] },
      { relation: "wordcell.scope", tuple: ["notes/alpha", "src/query.ts"] },
    ]));
    for (const record of graph.records) {
      expect(record.facts.every((fact) => fact.tuple[0] === record.id)).toBe(true);
    }
  });

  test("keeps authored self-relations, omits self-wikilinks, and invents no reverse or broken edges", () => {
    const note = parseNote("alpha.md", "---\nrelations:\n  supports: alpha\n  cites: missing\n---\n# Alpha\n[[alpha]] [[missing]]\n");
    expect(allFacts([note])).toEqual([
      { relation: "wordcell.note", tuple: ["alpha", "alpha.md", "Alpha", ""] },
      { relation: "wordcell.relation", tuple: ["alpha", "alpha", "supports", 3] },
    ]);
  });

  test("reparses raw content rather than trusting forged analysis or parsed metadata", () => {
    const alpha = parseNote("alpha.md", "# Alpha\n");
    const beta = parseNote("beta.md", "# Beta\n");
    const original = createGraphSnapshot(snapshot([alpha, beta]));
    const forged: Note = { ...alpha, title: "Forged", tags: ["injected"], metadata: { document_id: "forged" },
      links: [{ target: "beta", line: 900, embedded: false }] };
    const input = { ...snapshot([forged, beta]), analysis: analyzeVault([forged, beta]) };
    expect(createGraphSnapshot(input)).toEqual(original);
  });

  test("binds every source byte, including a custom catalog, and never projects that catalog", () => {
    const catalog = parseNote("navigation/front.md", "# Front\n[[alpha]]\n");
    const notes = [catalog, parseNote("alpha.md", "# Alpha\n[[navigation/front]] [[index]]\n"),
      parseNote("index.md", "# Ordinary note\n")];
    const graph = createGraphSnapshot(snapshot(notes, "/vault", catalog.path));
    expect(graph.catalogNoteId).toBe("navigation/front");
    expect(graph.records.map(({ id }) => id).sort()).toEqual(["alpha", "index"]);
    expect(graph.records.flatMap(({ facts }) => facts).filter(({ relation }) => relation === "wordcell.link"))
      .toEqual([{ relation: "wordcell.link", tuple: ["alpha", "index", 2] }]);
    const changed = createGraphSnapshot(snapshot([
      parseNote(catalog.path, `${catalog.content}\n<!-- changed -->`), ...notes.slice(1),
    ], "/vault", catalog.path));
    expect(changed.records).toEqual(graph.records);
    expect(changed.revision).not.toBe(graph.revision);
    expect(createGraphSnapshot(snapshot(notes)).revision).not.toBe(graph.revision);
  });

  test("canonical root identity prevents evidence transplant between vaults", () => {
    const notes = [parseNote("alpha.md", "# Alpha\n")];
    const first = createGraphSnapshot(snapshot(notes));
    const equivalent = createGraphSnapshot(snapshot(notes, "/vault/./"));
    const other = createGraphSnapshot(snapshot(notes, "/other"));
    expect(equivalent).toEqual(first);
    expect(first.vaultIdentity).toBe(digest("/vault"));
    expect(other.records).toEqual(first.records);
    expect(other.revision).not.toBe(first.revision);
    for (const root of ["relative", "", "/vault\0bad"]) {
      expect(codeOf(() => createGraphSnapshot(snapshot(notes, root)))).toBe("invalid-input");
    }
    for (const indexPath of ["index.md", "/other/index.md", "/vault", "/vault/index.txt"]) {
      expect(codeOf(() => createGraphSnapshot({ ...snapshot(notes), indexPath }))).toBe("invalid-input");
    }
  });

  test("rejects invalid or duplicate stable identities including the excluded catalog", () => {
    const stable = parseNote("alpha.md", "---\ndocument_id: stable\n---\n# Alpha\n");
    for (const path of ["beta.md", "index.md"]) {
      const duplicate = parseNote(path, "---\ndocument_id: stable\n---\n# Other\n");
      expect(codeOf(() => createGraphSnapshot(snapshot([stable, duplicate])))).toBe("invalid-input");
    }
    for (const value of ["UPPER", "null", "[]", "' spaces '", "1"]) {
      const invalid = parseNote("alpha.md", `---\ndocument_id: ${value}\n---\n# Alpha\n`);
      expect(codeOf(() => createGraphSnapshot(snapshot([invalid])))).toBe("invalid-input");
    }
    const missing = createGraphSnapshot(snapshot([parseNote("alpha.md", "# Alpha\n")])).records[0]!;
    expect(missing.documentId).toBeNull();
    expect(missing.key).toBe(`edition:note/${digest("path:alpha")}`);
  });

  test("rejects malformed scope metadata without emitting partial scope facts", () => {
    for (const declaration of [
      "repository_scopes: src", "Repository_Scopes: [src]", "repository_scopes: []",
      "repository_scopes: [src, '../outside']", "repository_scopes: [src, Src]",
    ]) {
      const note = parseNote("alpha.md", `---\n${declaration}\n---\n# Alpha\n`);
      expect(codeOf(() => createGraphSnapshot(snapshot([note])))).toBe("invalid-input");
    }
  });

  test("validates public structural boundaries and canonical note identities", () => {
    const note = parseNote("alpha.md", "# Alpha\n");
    expect(codeOf(() => createGraphSnapshot(snapshot([note, note])))).toBe("invalid-input");
    expect(codeOf(() => createGraphSnapshot(snapshot([note, { ...note, path: "alpha.MD" }])))).toBe("invalid-input");
    for (const path of ["../alpha.md", "/alpha.md", "./alpha.md", "x\\alpha.md", "e\u0301.md", "alpha.txt"]) {
      expect(codeOf(() => createGraphSnapshot(snapshot([{ ...note, path }])))).toBe("invalid-input");
    }
    const invalid: unknown[] = [null, {}, { ...snapshot([]), notes: null },
      { ...snapshot([]), notes: [null] }, { ...snapshot([]), notes: [{ ...note, id: "beta" }] },
      { ...snapshot([]), notes: [{ ...note, content: 42 }] },
      { ...snapshot([]), notes: [{ ...note, content: "---\nmissing closure" }] }];
    for (const input of invalid) {
      expect(codeOf(() => createGraphSnapshot(input as VaultSnapshot))).toBe("invalid-input");
    }
  });

  test("rejects note and aggregate source limits before parsing oversized content", () => {
    const note = parseNote("alpha.md", "# Alpha\n");
    expect(codeOf(() => createGraphSnapshot(snapshot(Array(GRAPH_LIMITS.notes + 1).fill(note)))))
      .toBe("budget");
    const oversized = { ...note, content: "x".repeat(GRAPH_LIMITS.sourceBytes + 1) };
    expect(codeOf(() => createGraphSnapshot(snapshot([oversized])))).toBe("budget");
    const half = "x".repeat(GRAPH_LIMITS.sourceBytes / 2 + 1);
    expect(codeOf(() => createGraphSnapshot(snapshot([
      { ...note, content: half }, { ...note, path: "beta.md", id: "beta", content: half },
    ])))).toBe("budget");
  });

  test("bounds graph atom bytes using UTF-8 and refuses a complete oversized fact edition", () => {
    const note = parseNote("alpha.md", `# ${"é".repeat(GRAPH_LIMITS.atomBytes / 2 + 1)}\n`);
    expect(codeOf(() => createGraphSnapshot(snapshot([note])))).toBe("budget");
    const tags = Array.from({ length: 100 }, (_, index) => `tag-${index}`).join(", ");
    const notes = Array.from({ length: 1_000 }, (_, index) => parseNote(`note-${index}.md`,
      `---\ntags: [${tags}]\n---\n# Note\n`));
    expect(codeOf(() => createGraphSnapshot(snapshot(notes)))).toBe("budget");
  });

  test("deep-freezes output while leaving all caller-owned inputs untouched", () => {
    const input = snapshot([parseNote("alpha.md", "---\ntags: [one]\n---\n# Alpha\n")]);
    const before = structuredClone(input);
    const graph = createGraphSnapshot(input);
    expect(input).toEqual(before);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(input.notes[0])).toBe(false);
    const assertFrozen = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const nested of Object.values(value)) assertFrozen(nested);
    };
    assertFrozen(graph);
  });
});

describe("graph extraction properties", () => {
  test("note permutations produce byte-identical editions with deterministic fact de-duplication", () => {
    fc.assert(fc.property(fc.uniqueArray(segment, { minLength: 1, maxLength: 24 }), (ids) => {
      const notes = ids.map((id, index) => parseNote(`${id}.md`, [
        "---", "tags: [shared, shared]", `document_id: d-${id}-id`, "---", `# ${id}`,
        `[[${ids[(index + 1) % ids.length]}]] [[${ids[(index + 1) % ids.length]}]]`,
      ].join("\n")));
      const before = JSON.stringify(notes);
      const graph = createGraphSnapshot(snapshot(notes));
      expect(createGraphSnapshot(snapshot([...notes].reverse()))).toEqual(graph);
      expect(JSON.stringify(notes)).toBe(before);
      expect(graph.factCount).toBe(ids.length * (ids.length > 1 ? 3 : 2));
      expect(graph.records.every(({ facts }) =>
        new Set(facts.map((fact) => JSON.stringify(fact))).size === facts.length)).toBe(true);
    }), { numRuns: 60 });
  });

  test("stable IDs preserve source keys on rename while edits, deletion, and path identities change revisions", () => {
    fc.assert(fc.property(fc.tuple(segment, segment).filter(([a, b]) => a !== b), ([from, to]) => {
      const source = "---\ndocument_id: stable\n---\n# A stable note\n";
      const original = createGraphSnapshot(snapshot([parseNote(`${from}.md`, source)]));
      const renamed = createGraphSnapshot(snapshot([parseNote(`${to}.md`, source)]));
      expect(renamed.records[0]!.key).toBe(original.records[0]!.key);
      expect(renamed.records[0]!.contentSha256).toBe(original.records[0]!.contentSha256);
      expect(renamed.revision).not.toBe(original.revision);
      const edited = createGraphSnapshot(snapshot([parseNote(`${from}.md`, `${source}\n<!-- edit -->`)]));
      expect(edited.records[0]!.facts).toEqual(original.records[0]!.facts);
      expect(edited.revision).not.toBe(original.revision);
      expect(createGraphSnapshot(snapshot([])).revision).not.toBe(original.revision);
      const pathOne = createGraphSnapshot(snapshot([parseNote(`${from}.md`, "# Legacy\n")]));
      const pathTwo = createGraphSnapshot(snapshot([parseNote(`${to}.md`, "# Legacy\n")]));
      expect(pathOne.records[0]!.key).not.toBe(pathTwo.records[0]!.key);
    }), { numRuns: 60 });
  });
});
