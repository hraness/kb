import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  EVALUATION_EVIDENCE_PARSER_VERSION,
  MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES,
  MAX_EVALUATION_EVIDENCE_TOTAL_UNITS,
  MAX_EVALUATION_EVIDENCE_LINE_BYTES,
  MAX_EVALUATION_EVIDENCE_LIST_ITEMS_PER_UNIT,
  buildEvaluationEvidenceRegistry,
  resolveEvaluationEvidenceNeighborhood,
  validateEvaluationEvidenceRegistry,
  type EvaluationEvidenceDocument,
  type EvaluationEvidenceRegistry,
  type EvaluationEvidenceUnit,
} from "./evaluation-evidence.js";

function document(
  markdown: string,
  overrides: Partial<EvaluationEvidenceDocument> = {},
): EvaluationEvidenceDocument {
  return {
    documentId: "notes/evidence",
    sourcePath: "notes/evidence.md",
    trustClass: "authored",
    markdown,
    ...overrides,
  };
}

function byteLength(unit: EvaluationEvidenceUnit): number {
  return unit.byteRange.end - unit.byteRange.start;
}

function unitWithText(registry: EvaluationEvidenceRegistry, prefix: string): EvaluationEvidenceUnit {
  const unit = registry.units.find((candidate) => candidate.text.startsWith(prefix));
  if (unit === undefined) throw new Error(`Missing unit beginning ${JSON.stringify(prefix)}.`);
  return unit;
}

function exactSlice(markdown: string, unit: EvaluationEvidenceUnit): string {
  return Buffer.from(markdown, "utf8")
    .subarray(unit.byteRange.start, unit.byteRange.end)
    .toString("utf8");
}

const structuralMarkdown = [
  "---",
  "title: Café evidence",
  "tags:",
  "  - parsing",
  "status: current",
  "---",
  "",
  "# Root",
  "",
  "Intro café 😀.",
  "Continued paragraph.",
  "",
  "## Child",
  "",
  "- first item",
  "  continuation",
  "- second item",
  "",
  "| Name | Value |",
  "| --- | ---: |",
  "| alpha | 1 |",
  "",
  "```ts",
  "const marker = '<!-- pdf-page: 99 -->';",
  "```",
  "",
  "<!-- pdf-page: 7 -->",
  "",
  "Page paragraph.",
  "",
  "### Deep",
  "Tail paragraph.",
  "",
].join("\n");

describe("evaluation evidence parsing", () => {
  test("derives every requested Markdown unit without synthesizing source text", () => {
    const registry = buildEvaluationEvidenceRegistry({
      documents: [document(structuralMarkdown, { trustClass: "maintained-author" })],
    });
    expect(new Set(registry.units.map((unit) => unit.kind))).toEqual(new Set([
      "frontmatter-field",
      "heading",
      "paragraph",
      "list",
      "table",
      "code-block",
      "pdf-page-span",
    ]));
    expect(registry.units
      .filter((unit) => unit.kind === "frontmatter-field")
      .map((unit) => ({ field: unit.frontmatterField, text: unit.text }))).toEqual([
      { field: "title", text: "title: Café evidence\n" },
      { field: "tags", text: "tags:\n  - parsing\n" },
      { field: "status", text: "status: current\n" },
    ]);

    const intro = unitWithText(registry, "Intro café");
    expect(intro).toMatchObject({
      kind: "paragraph",
      headingAncestry: ["Root"],
      trustClass: "maintained-author",
    });
    expect(intro.text).toBe("Intro café 😀.\nContinued paragraph.\n");
    expect(unitWithText(registry, "- first item")).toMatchObject({
      kind: "list",
      headingAncestry: ["Root", "Child"],
    });
    expect(unitWithText(registry, "| Name").kind).toBe("table");

    const code = unitWithText(registry, "```ts");
    expect(code.kind).toBe("code-block");
    expect(code.text).toContain("<!-- pdf-page: 99 -->");
    expect(code.pdfPage).toBeUndefined();
    expect(registry.units.some((unit) => unit.pdfPage === 99)).toBe(false);

    expect(unitWithText(registry, "### Deep")).toMatchObject({
      kind: "heading",
      headingAncestry: ["Root", "Child", "Deep"],
      pdfPage: 7,
    });
    expect(registry.units.find((unit) => unit.kind === "pdf-page-span")).toMatchObject({
      pdfPage: 7,
      headingAncestry: ["Root", "Child"],
    });
    for (const unit of registry.units) {
      expect(unit.documentId).toBe("notes/evidence");
      expect(unit.sourcePath).toBe("notes/evidence.md");
      expect(unit.text).toBe(exactSlice(structuralMarkdown, unit));
    }
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.units)).toBe(true);
    expect(Object.isFrozen(registry.units[0]?.byteRange)).toBe(true);
  });

  test("keeps CRLF, Unicode, byte and line ranges, and slice hashes exact", () => {
    const markdown = [
      "---",
      "title: Café 😀",
      "---",
      "",
      "# Hé",
      "",
      "nai\u0308ve 😀 text.",
    ].join("\r\n") + "\r\n";
    const registry = buildEvaluationEvidenceRegistry({ documents: [document(markdown)] });
    const paragraph = unitWithText(registry, "nai\u0308ve");
    const expectedText = "nai\u0308ve 😀 text.\r\n";
    const expectedStart = Buffer.from(markdown).indexOf(Buffer.from(expectedText));
    expect(paragraph.text).toBe(expectedText);
    expect(paragraph.lineRange).toEqual({ start: 7, end: 7 });
    expect(paragraph.byteRange).toEqual({
      start: expectedStart,
      end: expectedStart + Buffer.byteLength(expectedText),
    });
    expect(paragraph.sha256).toBe(createHash("sha256").update(expectedText).digest("hex"));
    for (const unit of registry.units) {
      expect(unit.text).toBe(exactSlice(markdown, unit));
      expect(byteLength(unit)).toBe(Buffer.byteLength(unit.text));
    }
  });

  test("recovers malformed fences and frontmatter as exact source spans", () => {
    const unclosed = [
      "# Visible",
      "",
      "```ts",
      "# not a heading",
      "<!-- pdf-page: 12 -->",
      "const value = 1;",
    ].join("\n");
    const fenced = buildEvaluationEvidenceRegistry({ documents: [document(unclosed)] });
    expect(fenced.units.map((unit) => unit.kind)).toEqual(["heading", "code-block"]);
    expect(unitWithText(fenced, "```ts").text).toBe(
      "```ts\n# not a heading\n<!-- pdf-page: 12 -->\nconst value = 1;",
    );
    expect(fenced.units.some((unit) => unit.pdfPage === 12)).toBe(false);

    const malformed = "---\ntitle: still source\n# Recovered\n\nBody.\n";
    const recovered = buildEvaluationEvidenceRegistry({ documents: [document(malformed)] });
    expect(recovered.units.some((unit) => unit.kind === "frontmatter-field")).toBe(false);
    expect(recovered.units.some((unit) => unit.kind === "heading")).toBe(true);
    expect(recovered.units.map((unit) => unit.text).join("")).toContain("title: still source");
  });

  test("bounds long lists without dropping or inventing bytes", () => {
    const markdown = Array.from(
      { length: MAX_EVALUATION_EVIDENCE_LIST_ITEMS_PER_UNIT + 1 },
      (_, index) => `- item ${index}`,
    ).join("\n") + "\n";
    const lists = buildEvaluationEvidenceRegistry({ documents: [document(markdown)] })
      .units.filter((unit) => unit.kind === "list");
    expect(lists).toHaveLength(2);
    expect(lists.map((unit) => unit.text).join("")).toBe(markdown);
    expect(lists[0]?.text.match(/^- item/gmu)).toHaveLength(
      MAX_EVALUATION_EVIDENCE_LIST_ITEMS_PER_UNIT,
    );
    expect(lists[1]?.text.match(/^- item/gmu)).toHaveLength(1);
  });
});

describe("stable identity and fail-closed validation", () => {
  test("orders canonically and derives stable IDs without source paths or trust labels", () => {
    const markdown = "# Identity\n\nExact source.\n";
    const alpha = document(markdown, {
      documentId: "notes/alpha",
      sourcePath: "first/location.md",
      trustClass: "authored",
    });
    const beta = document("# Beta\n", {
      documentId: "notes/beta",
      sourcePath: "notes/beta.md",
    });
    const ordered = buildEvaluationEvidenceRegistry({ documents: [alpha, beta] });
    expect(buildEvaluationEvidenceRegistry({ documents: [beta, alpha] })).toEqual(ordered);

    const moved = buildEvaluationEvidenceRegistry({
      documents: [{ ...alpha, sourcePath: "moved/location.md", trustClass: "capture" }],
    });
    expect(moved.units.map((unit) => unit.id)).toEqual(
      ordered.units.filter((unit) => unit.documentId === "notes/alpha").map((unit) => unit.id),
    );
    expect(moved.units.every((unit) => !unit.id.includes("moved"))).toBe(true);
    expect(buildEvaluationEvidenceRegistry({
      documents: [{ ...alpha, documentId: "notes/renamed" }],
    }).units.map((unit) => unit.id)).not.toEqual(moved.units.map((unit) => unit.id));

    const nextParser = buildEvaluationEvidenceRegistry({
      documents: [alpha],
      parserVersion: "evaluation-evidence-v2",
    });
    expect(nextParser.units.map((unit) => unit.id)).not.toEqual(moved.units.map((unit) => unit.id));
    expect(nextParser.units.every((unit) => unit.id.startsWith("eeu:evaluation-evidence-v2:")))
      .toBe(true);
  });

  test("rejects source, parser, ID, range, and duplicate drift", () => {
    const original = document("# Stable\n\nEvidence.\n");
    const registry = buildEvaluationEvidenceRegistry({ documents: [original] });
    expect(() => validateEvaluationEvidenceRegistry(registry)).not.toThrow();
    expect(() => validateEvaluationEvidenceRegistry(registry, {
      documents: [{ ...original, markdown: "# Stable\n \nEvidence.\n" }],
    })).toThrow("validation failed");
    expect(() => validateEvaluationEvidenceRegistry(registry, {
      parserVersion: "evaluation-evidence-v2",
    })).toThrow("parser version drift");

    const changedId = structuredClone(registry) as unknown as { units: Array<{ id: string }> };
    changedId.units[0]!.id = `eeu:${EVALUATION_EVIDENCE_PARSER_VERSION}:${"0".repeat(64)}`;
    expect(() => validateEvaluationEvidenceRegistry(changedId)).toThrow("validation failed");

    const changedRange = structuredClone(registry) as unknown as {
      units: Array<{ byteRange: { start: number; end: number } }>;
    };
    changedRange.units[0]!.byteRange.end -= 1;
    expect(() => validateEvaluationEvidenceRegistry(changedRange)).toThrow("validation failed");

    const duplicate = structuredClone(registry) as unknown as { units: unknown[] };
    duplicate.units.push(structuredClone(duplicate.units[0]));
    expect(() => validateEvaluationEvidenceRegistry(duplicate)).toThrow("validation failed");
  });

  test("rejects duplicate identities, unsafe paths, and hostile source text", () => {
    const first = document("# One\n");
    expect(() => buildEvaluationEvidenceRegistry({
      documents: [first, { ...first, sourcePath: "notes/two.md" }],
    })).toThrow("duplicate documentId");
    expect(() => buildEvaluationEvidenceRegistry({
      documents: [first, { ...first, documentId: "notes/two" }],
    })).toThrow("duplicate sourcePath");
    for (const sourcePath of ["../escape.md", "/absolute.md", "C:\\vault\\note.md"]) {
      expect(() => buildEvaluationEvidenceRegistry({
        documents: [{ ...first, sourcePath }],
      })).toThrow("confined repository-relative path");
    }
    expect(() => buildEvaluationEvidenceRegistry({
      documents: [{ ...first, markdown: "bad\0source" }],
    })).toThrow("must not contain NUL");
    expect(() => buildEvaluationEvidenceRegistry({
      documents: [{ ...first, markdown: "bad\ud800source" }],
    })).toThrow("well-formed Unicode");
  });
});

describe("local evidence neighborhoods", () => {
  const markdown = [
    "# Root",
    "",
    "## Child",
    "",
    "Before paragraph.",
    "",
    "Primary 😀 paragraph.",
    "",
    "After paragraph.",
    "",
  ].join("\n");

  test("packs the smallest block, parent headings, and adjacent blocks under one budget", () => {
    const registry = buildEvaluationEvidenceRegistry({ documents: [document(markdown)] });
    const primary = unitWithText(registry, "Primary");
    const child = unitWithText(registry, "## Child");
    const exactBudget = byteLength(primary) + byteLength(child);
    const bounded = resolveEvaluationEvidenceNeighborhood(
      registry,
      { documentId: primary.documentId, line: 7 },
      { maxBytes: exactBudget, maxNeighbors: 10 },
    );
    expect(bounded.primary.id).toBe(primary.id);
    expect(bounded.neighbors.map(({ relation, unit }) => [relation, unit.text.trim()])).toEqual([
      ["parent-heading", "## Child"],
    ]);
    expect(bounded).toMatchObject({ bytesUsed: exactBudget, candidateCount: 4, truncated: true });

    const full = resolveEvaluationEvidenceNeighborhood(
      registry,
      { documentId: primary.documentId, unitId: primary.id },
      { maxBytes: 10_000 },
    );
    expect(full.neighbors.map(({ relation, direction, unit }) => ({
      relation,
      direction,
      text: unit.text.trim(),
    }))).toEqual([
      { relation: "parent-heading", direction: undefined, text: "## Child" },
      { relation: "parent-heading", direction: undefined, text: "# Root" },
      { relation: "adjacent-block", direction: "before", text: "Before paragraph." },
      { relation: "adjacent-block", direction: "after", text: "After paragraph." },
    ]);
    expect(full.bytesUsed).toBe(
      byteLength(primary) + full.neighbors.reduce((sum, neighbor) => sum + byteLength(neighbor.unit), 0),
    );
    expect(full.truncated).toBe(false);
    expect(() => resolveEvaluationEvidenceNeighborhood(
      registry,
      { documentId: primary.documentId, byteOffset: primary.byteRange.start },
      { maxBytes: byteLength(primary) - 1 },
    )).toThrow("cannot fit primary evidence unit");
  });

  test("returns same-page blocks without crossing the page boundary", () => {
    const pageMarkdown = [
      "<!-- pdf-page: 1 -->",
      "# Page One",
      "",
      "First block.",
      "",
      "Second block.",
      "",
      "Third block.",
      "",
      "<!-- pdf-page: 2 -->",
      "# Page Two",
      "",
      "Other page.",
      "",
    ].join("\n");
    const registry = buildEvaluationEvidenceRegistry({ documents: [document(pageMarkdown)] });
    const first = unitWithText(registry, "First block");
    const neighborhood = resolveEvaluationEvidenceNeighborhood(
      registry,
      { documentId: first.documentId, byteOffset: first.byteRange.start + 2 },
      { maxBytes: 10_000 },
    );
    expect(neighborhood.primary.kind).toBe("paragraph");
    expect(neighborhood.primary.pdfPage).toBe(1);
    expect(neighborhood.neighbors.find((neighbor) => neighbor.relation === "same-page")?.unit.text)
      .toBe("Third block.\n");
    expect(neighborhood.neighbors.some((neighbor) => neighbor.unit.pdfPage === 2)).toBe(false);

    const page = resolveEvaluationEvidenceNeighborhood(
      registry,
      { documentId: first.documentId, pdfPage: 1 },
      { maxBytes: 10_000 },
    );
    expect(page.primary.kind).toBe("pdf-page-span");
    expect(page.neighbors.every((neighbor) => neighbor.relation === "same-page")).toBe(true);
    expect(page.neighbors.every((neighbor) => neighbor.unit.pdfPage === 1)).toBe(true);
  });

  test("rejects ambiguous locators and applies the neighbor count bound", () => {
    const registry = buildEvaluationEvidenceRegistry({ documents: [document(markdown)] });
    const primary = unitWithText(registry, "Primary");
    const ambiguousLocator = Object.assign(
      { documentId: primary.documentId, unitId: primary.id },
      { line: 7 },
    );
    expect(() => resolveEvaluationEvidenceNeighborhood(
      registry,
      ambiguousLocator,
      { maxBytes: 10_000 },
    )).toThrow("exactly one");
    const none = resolveEvaluationEvidenceNeighborhood(
      registry,
      { documentId: primary.documentId, unitId: primary.id },
      { maxBytes: 10_000, maxNeighbors: 0 },
    );
    expect(none.neighbors).toEqual([]);
    expect(none.truncated).toBe(true);
  });
});

describe("bounds and determinism", () => {
  test("accepts empty frozen inputs and rejects oversized documents and lines", () => {
    const noDocuments = buildEvaluationEvidenceRegistry({ documents: [] });
    expect(noDocuments.documents).toEqual([]);
    expect(noDocuments.units).toEqual([]);

    const empty = buildEvaluationEvidenceRegistry({ documents: [document("")] });
    expect(empty.documents).toHaveLength(1);
    expect(empty.units).toEqual([]);
    expect(() => resolveEvaluationEvidenceNeighborhood(
      empty,
      { documentId: "notes/evidence", line: 1 },
      { maxBytes: 10 },
    )).toThrow();

    expect(() => buildEvaluationEvidenceRegistry({
      documents: [document("x".repeat(MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES + 1))],
    })).toThrow("exceeds");
    expect(() => buildEvaluationEvidenceRegistry({
      documents: [document("x".repeat(MAX_EVALUATION_EVIDENCE_LINE_BYTES + 1))],
    })).toThrow("line larger");
  });

  test("bounds aggregate evidence units before registry sorting", () => {
    const unitsPerDocument = Math.floor(MAX_EVALUATION_EVIDENCE_TOTAL_UNITS / 2) + 1;
    const markdown = Array.from(
      { length: unitsPerDocument },
      (_, index) => `# H${index}\n`,
    ).join("");
    expect(() => buildEvaluationEvidenceRegistry({
      documents: ["a", "b"].map((suffix) => ({
        documentId: `aggregate-unit-bound-${suffix}`,
        sourcePath: `notes/aggregate-unit-bound-${suffix}.md`,
        markdown,
        trustClass: "maintained-synthesis",
      })),
    })).toThrow(`more than ${MAX_EVALUATION_EVIDENCE_TOTAL_UNITS} total evidence units`);
  });

  test("is deterministic across newline and Unicode variants in property-like loops", () => {
    const newlines = ["\n", "\r\n", "\r"] as const;
    for (let seed = 0; seed < 48; seed += 1) {
      const newline = newlines[seed % newlines.length] ?? "\n";
      const accent = seed % 2 === 0 ? "é" : "e\u0301";
      const markdown = [
        "---",
        `title: Seed ${seed}`,
        "---",
        `# Héading ${accent}`,
        "",
        `Paragraph ${seed} 😀 ${accent}.`,
        "",
        `- item ${seed}`,
        `- item ${seed + 1}`,
      ].join(newline) + newline;
      const input = document(markdown, {
        documentId: `notes/property-${seed.toString().padStart(2, "0")}`,
        sourcePath: `notes/property-${seed.toString().padStart(2, "0")}.md`,
      });
      const first = buildEvaluationEvidenceRegistry({ documents: [input] });
      const second = buildEvaluationEvidenceRegistry({ documents: [structuredClone(input)] });
      expect(second).toEqual(first);
      expect(() => validateEvaluationEvidenceRegistry(first, { documents: [input] })).not.toThrow();
      for (const unit of first.units) {
        expect(exactSlice(markdown, unit)).toBe(unit.text);
        expect(unit.id).toMatch(/^eeu:evaluation-evidence-v1:[0-9a-f]{64}$/u);
      }
      const starts = first.units.map((unit) => unit.byteRange.start);
      expect(starts).toEqual(starts.toSorted((left, right) => left - right));
    }
  });
});
