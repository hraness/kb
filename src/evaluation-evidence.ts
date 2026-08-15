import { createHash } from "node:crypto";

export const EVALUATION_EVIDENCE_SCHEMA_VERSION = 1;
export const EVALUATION_EVIDENCE_PARSER_VERSION = "evaluation-evidence-v1";
export const MAX_EVALUATION_EVIDENCE_DOCUMENTS = 10_000;
export const MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES = 8 * 1_024 * 1_024;
export const MAX_EVALUATION_EVIDENCE_TOTAL_BYTES = 64 * 1_024 * 1_024;
export const MAX_EVALUATION_EVIDENCE_LINES_PER_DOCUMENT = 200_000;
export const MAX_EVALUATION_EVIDENCE_LINE_BYTES = 1 * 1_024 * 1_024;
export const MAX_EVALUATION_EVIDENCE_UNIT_BYTES = 1 * 1_024 * 1_024;
export const MAX_EVALUATION_EVIDENCE_UNITS_PER_DOCUMENT = 100_000;
export const MAX_EVALUATION_EVIDENCE_TOTAL_UNITS = 100_000;
export const MAX_EVALUATION_EVIDENCE_LIST_ITEMS_PER_UNIT = 128;
export const MAX_EVALUATION_EVIDENCE_TABLE_LINES_PER_UNIT = 258;
export const MAX_EVALUATION_EVIDENCE_NEIGHBORS = 256;
export const MAX_EVALUATION_EVIDENCE_NEIGHBORHOOD_BYTES = 1 * 1_024 * 1_024;

const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/iu;
const PARSER_VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const UNIT_ID = /^eeu:[a-z0-9][a-z0-9._-]{0,63}:[0-9a-f]{64}$/u;
const PDF_PAGE_MARKER = /^\s*<!--\s*pdf-page:\s*([1-9][0-9]{0,8})\s*-->\s*$/u;

export type EvaluationEvidenceTrustClass = string;

export type EvaluationEvidenceDocument = {
  readonly documentId: string;
  readonly sourcePath: string;
  readonly markdown: string;
  readonly trustClass: EvaluationEvidenceTrustClass;
};

export type EvaluationEvidenceDocumentSnapshot = EvaluationEvidenceDocument & {
  readonly byteLength: number;
  readonly sourceSha256: string;
};

export type EvaluationEvidenceUnitKind =
  | "frontmatter-field"
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "code-block"
  | "pdf-page-span";

export type EvaluationEvidenceByteRange = {
  /** Inclusive UTF-8 byte offset. */
  readonly start: number;
  /** Exclusive UTF-8 byte offset. */
  readonly end: number;
};

export type EvaluationEvidenceLineRange = {
  /** Inclusive, 1-based source line. */
  readonly start: number;
  /** Inclusive, 1-based source line. */
  readonly end: number;
};

export type EvaluationEvidenceUnit = {
  readonly id: string;
  readonly parserVersion: string;
  readonly kind: EvaluationEvidenceUnitKind;
  readonly documentId: string;
  readonly sourcePath: string;
  readonly byteRange: EvaluationEvidenceByteRange;
  readonly lineRange: EvaluationEvidenceLineRange;
  readonly headingAncestry: readonly string[];
  readonly pdfPage?: number;
  readonly frontmatterField?: string;
  /** SHA-256 of exactly the UTF-8 bytes covered by byteRange. */
  readonly sha256: string;
  readonly trustClass: EvaluationEvidenceTrustClass;
  /** The exact source slice, including its authored newline bytes. */
  readonly text: string;
};

export type EvaluationEvidenceRegistry = {
  readonly schemaVersion: 1;
  readonly parserVersion: string;
  readonly documents: readonly EvaluationEvidenceDocumentSnapshot[];
  /** Canonical order: document identity, byte range, then unit kind and ID. */
  readonly units: readonly EvaluationEvidenceUnit[];
};

export type EvaluationEvidenceLocator =
  | { readonly documentId: string; readonly unitId: string }
  | { readonly documentId: string; readonly byteOffset: number }
  | { readonly documentId: string; readonly line: number }
  | { readonly documentId: string; readonly pdfPage: number };

export type EvaluationEvidenceNeighborRelation =
  | "parent-heading"
  | "adjacent-block"
  | "same-page";

export type EvaluationEvidenceNeighbor = {
  readonly relation: EvaluationEvidenceNeighborRelation;
  readonly direction?: "before" | "after";
  readonly unit: EvaluationEvidenceUnit;
};

export type EvaluationEvidenceNeighborhood = {
  readonly primary: EvaluationEvidenceUnit;
  readonly neighbors: readonly EvaluationEvidenceNeighbor[];
  /** Exact UTF-8 bytes in primary and all returned neighbors. */
  readonly bytesUsed: number;
  readonly maxBytes: number;
  readonly candidateCount: number;
  readonly truncated: boolean;
};

type SourceLine = {
  readonly number: number;
  readonly content: string;
  readonly startCharacter: number;
  readonly endCharacter: number;
  readonly startByte: number;
  readonly endByte: number;
};

type HeadingEntry = {
  readonly level: number;
  readonly text: string;
};

type UnitContext = {
  readonly headingAncestry: readonly string[];
  readonly pdfPage?: number;
  readonly frontmatterField?: string;
};

type MutablePageSpan = {
  readonly page: number;
  readonly startLine: number;
  readonly headingAncestry: readonly string[];
};

type NeighborCandidate = {
  readonly relation: EvaluationEvidenceNeighborRelation;
  readonly direction?: "before" | "after";
  readonly unit: EvaluationEvidenceUnit;
};

const KIND_ORDER: Readonly<Record<EvaluationEvidenceUnitKind, number>> = Object.freeze({
  "frontmatter-field": 0,
  heading: 1,
  paragraph: 2,
  list: 3,
  table: 4,
  "code-block": 5,
  "pdf-page-span": 6,
});

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function boundedSingleLine(value: unknown, label: string, maximumBytes: number): string {
  if (
    typeof value !== "string"
    || value === ""
    || value.trim() !== value
    || /[\0\r\n]/u.test(value)
    || hasUnpairedSurrogate(value)
    || value.normalize("NFC") !== value
    || Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new TypeError(
      `${label} must be a non-empty NFC single-line string of at most ${maximumBytes} UTF-8 bytes.`,
    );
  }
  return value;
}

function parserVersion(value: unknown): string {
  const parsed = boundedSingleLine(value, "parserVersion", 64);
  if (!PARSER_VERSION.test(parsed)) {
    throw new TypeError("parserVersion must be a lowercase version token.");
  }
  return parsed;
}

function confinedSourcePath(value: unknown): string {
  if (typeof value !== "string" || /[\0\r\n]/u.test(value) || hasUnpairedSurrogate(value)) {
    throw new TypeError("sourcePath must be a confined repository-relative path.");
  }
  const path = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    path === ""
    || path.normalize("NFC") !== path
    || path.startsWith("/")
    || WINDOWS_ABSOLUTE_PATH.test(path)
    || Buffer.byteLength(path, "utf8") > 4_096
    || path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError("sourcePath must be a confined repository-relative path.");
  }
  return path;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function unitId(input: {
  readonly parserVersion: string;
  readonly documentId: string;
  readonly kind: EvaluationEvidenceUnitKind;
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly sliceSha256: string;
}): string {
  const digest = createHash("sha256");
  digest.update("evaluation-evidence-unit\0", "utf8");
  for (const field of [
    input.parserVersion,
    input.documentId,
    input.kind,
    String(input.byteStart),
    String(input.byteEnd),
    input.sliceSha256,
  ]) {
    const bytes = Buffer.from(field, "utf8");
    digest.update(String(bytes.byteLength), "utf8");
    digest.update(":", "utf8");
    digest.update(bytes);
    digest.update("\0", "utf8");
  }
  return `eeu:${input.parserVersion}:${digest.digest("hex")}`;
}

function sourceLines(markdown: string, sourcePath: string): readonly SourceLine[] {
  const lines: SourceLine[] = [];
  let startCharacter = 0;
  let startByte = 0;

  while (startCharacter < markdown.length) {
    let contentEnd = startCharacter;
    while (
      contentEnd < markdown.length
      && markdown[contentEnd] !== "\n"
      && markdown[contentEnd] !== "\r"
    ) contentEnd += 1;

    let endCharacter = contentEnd;
    if (markdown[endCharacter] === "\r" && markdown[endCharacter + 1] === "\n") {
      endCharacter += 2;
    } else if (markdown[endCharacter] === "\r" || markdown[endCharacter] === "\n") {
      endCharacter += 1;
    }

    const raw = markdown.slice(startCharacter, endCharacter);
    const byteLength = Buffer.byteLength(raw, "utf8");
    if (byteLength > MAX_EVALUATION_EVIDENCE_LINE_BYTES) {
      throw new RangeError(
        `${sourcePath} has a line larger than ${MAX_EVALUATION_EVIDENCE_LINE_BYTES} UTF-8 bytes.`,
      );
    }
    lines.push(Object.freeze({
      number: lines.length + 1,
      content: markdown.slice(startCharacter, contentEnd),
      startCharacter,
      endCharacter,
      startByte,
      endByte: startByte + byteLength,
    }));
    if (lines.length > MAX_EVALUATION_EVIDENCE_LINES_PER_DOCUMENT) {
      throw new RangeError(
        `${sourcePath} has more than ${MAX_EVALUATION_EVIDENCE_LINES_PER_DOCUMENT} lines.`,
      );
    }
    startCharacter = endCharacter;
    startByte += byteLength;
  }

  return Object.freeze(lines);
}

function frontmatterBounds(lines: readonly SourceLine[]): { readonly close: number; readonly body: number } | undefined {
  const first = lines[0]?.content.replace(/^\uFEFF/u, "");
  if (first !== "---") return undefined;
  for (let index = 1; index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)[ \t]*$/u.test(lines[index]?.content ?? "")) {
      return Object.freeze({ close: index, body: index + 1 });
    }
  }
  // A missing delimiter is ordinary malformed Markdown, not synthesized frontmatter.
  return undefined;
}

function frontmatterField(line: string): string | undefined {
  const match = /^([^ \t#][^:]{0,255}?):(?:[ \t]|$)/u.exec(line);
  const field = match?.[1]?.trim();
  return field === undefined || field === "" ? undefined : field;
}

function atxHeading(line: string): { readonly level: number; readonly text: string } | undefined {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/u.exec(line);
  const hashes = match?.[1];
  if (hashes === undefined) return undefined;
  const text = (match?.[2] ?? "")
    .replace(/[ \t]+#+[ \t]*$/u, "")
    .trim();
  return Object.freeze({ level: hashes.length, text });
}

function setextLevel(line: string): 1 | 2 | undefined {
  if (/^ {0,3}=+[ \t]*$/u.test(line)) return 1;
  if (/^ {0,3}-+[ \t]*$/u.test(line)) return 2;
  return undefined;
}

function thematicBreak(line: string): boolean {
  const compact = line.replace(/[ \t]/gu, "");
  return /^(?:\*{3,}|-{3,}|_{3,})$/u.test(compact);
}

function fenceOpening(line: string): { readonly marker: "`" | "~"; readonly length: number } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})[^\r\n]*$/u.exec(line);
  const fence = match?.[1];
  if (fence === undefined) return undefined;
  return Object.freeze({ marker: fence[0] as "`" | "~", length: fence.length });
}

function closesFence(
  line: string,
  opening: { readonly marker: "`" | "~"; readonly length: number },
): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/u.exec(line);
  const fence = match?.[1];
  return fence !== undefined
    && fence[0] === opening.marker
    && fence.length >= opening.length;
}

function listItem(line: string): boolean {
  return /^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])(?:[ \t]+|$)/u.test(line);
}

function indented(line: string): boolean {
  return /^(?: {2,}|\t)/u.test(line);
}

function indentedCode(line: string): boolean {
  return /^(?: {4}|\t)/u.test(line);
}

function unescapedPipeCount(line: string): number {
  let count = 0;
  let slashRun = 0;
  for (const character of line) {
    if (character === "\\") {
      slashRun += 1;
    } else {
      if (character === "|" && slashRun % 2 === 0) count += 1;
      slashRun = 0;
    }
  }
  return count;
}

function tableDelimiter(line: string): boolean {
  let content = line.trim();
  if (content.startsWith("|")) content = content.slice(1);
  if (content.endsWith("|")) content = content.slice(0, -1);
  const cells = content.split(/(?<!\\)\|/u).map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function startsTable(lines: readonly SourceLine[], index: number): boolean {
  const header = lines[index]?.content;
  const delimiter = lines[index + 1]?.content;
  return header !== undefined
    && delimiter !== undefined
    && unescapedPipeCount(header) > 0
    && tableDelimiter(delimiter);
}

function pdfPage(line: string): number | undefined {
  const value = PDF_PAGE_MARKER.exec(line)?.[1];
  if (value === undefined) return undefined;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : undefined;
}

function headingPath(stack: readonly HeadingEntry[]): readonly string[] {
  return Object.freeze(stack.map((entry) => entry.text));
}

function updateHeadingStack(
  stack: HeadingEntry[],
  heading: { readonly level: number; readonly text: string },
): void {
  while ((stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
  stack.push(Object.freeze({ level: heading.level, text: heading.text }));
}

function compareUnits(left: EvaluationEvidenceUnit, right: EvaluationEvidenceUnit): number {
  return compareText(left.documentId, right.documentId)
    || left.byteRange.start - right.byteRange.start
    || left.byteRange.end - right.byteRange.end
    || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || compareText(left.id, right.id);
}

function freezeUnit(input: {
  readonly id: string;
  readonly parserVersion: string;
  readonly kind: EvaluationEvidenceUnitKind;
  readonly documentId: string;
  readonly sourcePath: string;
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly headingAncestry: readonly string[];
  readonly pdfPage?: number;
  readonly frontmatterField?: string;
  readonly sha256: string;
  readonly trustClass: string;
  readonly text: string;
}): EvaluationEvidenceUnit {
  return Object.freeze({
    id: input.id,
    parserVersion: input.parserVersion,
    kind: input.kind,
    documentId: input.documentId,
    sourcePath: input.sourcePath,
    byteRange: Object.freeze({ start: input.byteStart, end: input.byteEnd }),
    lineRange: Object.freeze({ start: input.lineStart, end: input.lineEnd }),
    headingAncestry: Object.freeze([...input.headingAncestry]),
    ...(input.pdfPage === undefined ? {} : { pdfPage: input.pdfPage }),
    ...(input.frontmatterField === undefined ? {} : { frontmatterField: input.frontmatterField }),
    sha256: input.sha256,
    trustClass: input.trustClass,
    text: input.text,
  });
}

function parseDocument(
  document: EvaluationEvidenceDocumentSnapshot,
  analysisVersion: string,
): readonly EvaluationEvidenceUnit[] {
  const lines = sourceLines(document.markdown, document.sourcePath);
  const units: EvaluationEvidenceUnit[] = [];

  const addExactSpan = (
    kind: EvaluationEvidenceUnitKind,
    startLine: number,
    endLine: number,
    context: UnitContext,
  ): void => {
    if (startLine < 0 || endLine <= startLine || endLine > lines.length) {
      throw new RangeError(`Parser produced an invalid source range for ${document.sourcePath}.`);
    }
    const first = lines[startLine];
    const last = lines[endLine - 1];
    if (first === undefined || last === undefined) {
      throw new RangeError(`Parser produced an unresolved source range for ${document.sourcePath}.`);
    }
    const text = document.markdown.slice(first.startCharacter, last.endCharacter);
    const byteLength = last.endByte - first.startByte;
    if (byteLength <= 0 || byteLength > MAX_EVALUATION_EVIDENCE_UNIT_BYTES) {
      throw new RangeError(`Parser produced an oversized source unit for ${document.sourcePath}.`);
    }
    if (Buffer.byteLength(text, "utf8") !== byteLength) {
      throw new Error(`Parser lost UTF-8 byte fidelity for ${document.sourcePath}.`);
    }
    const sliceSha256 = sha256(Buffer.from(text, "utf8"));
    units.push(freezeUnit({
      id: unitId({
        parserVersion: analysisVersion,
        documentId: document.documentId,
        kind,
        byteStart: first.startByte,
        byteEnd: last.endByte,
        sliceSha256,
      }),
      parserVersion: analysisVersion,
      kind,
      documentId: document.documentId,
      sourcePath: document.sourcePath,
      byteStart: first.startByte,
      byteEnd: last.endByte,
      lineStart: first.number,
      lineEnd: last.number,
      headingAncestry: context.headingAncestry,
      ...(context.pdfPage === undefined ? {} : { pdfPage: context.pdfPage }),
      ...(context.frontmatterField === undefined
        ? {}
        : { frontmatterField: context.frontmatterField }),
      sha256: sliceSha256,
      trustClass: document.trustClass,
      text,
    }));
    if (units.length > MAX_EVALUATION_EVIDENCE_UNITS_PER_DOCUMENT) {
      throw new RangeError(
        `${document.sourcePath} produced more than ${MAX_EVALUATION_EVIDENCE_UNITS_PER_DOCUMENT} evidence units.`,
      );
    }
  };

  const addBoundedSpan = (
    kind: EvaluationEvidenceUnitKind,
    startLine: number,
    endLine: number,
    context: UnitContext,
    maximumLines = Number.POSITIVE_INFINITY,
  ): void => {
    let chunkStart = startLine;
    while (chunkStart < endLine) {
      const first = lines[chunkStart];
      if (first === undefined) {
        throw new RangeError(`Parser produced an unresolved source range for ${document.sourcePath}.`);
      }
      let chunkEnd = chunkStart;
      while (chunkEnd < endLine && chunkEnd - chunkStart < maximumLines) {
        const line = lines[chunkEnd];
        if (line === undefined) break;
        if (line.endByte - first.startByte > MAX_EVALUATION_EVIDENCE_UNIT_BYTES) break;
        chunkEnd += 1;
      }
      if (chunkEnd === chunkStart) {
        throw new RangeError(
          `${document.sourcePath} contains a source line too large for an evidence unit.`,
        );
      }
      addExactSpan(kind, chunkStart, chunkEnd, context);
      chunkStart = chunkEnd;
    }
  };

  const frontmatter = frontmatterBounds(lines);
  if (frontmatter !== undefined) {
    let index = 1;
    while (index < frontmatter.close) {
      const field = frontmatterField(lines[index]?.content ?? "");
      if (field === undefined) {
        index += 1;
        continue;
      }
      let end = index + 1;
      while (
        end < frontmatter.close
        && frontmatterField(lines[end]?.content ?? "") === undefined
      ) end += 1;
      addBoundedSpan("frontmatter-field", index, end, {
        headingAncestry: Object.freeze([]),
        frontmatterField: field,
      });
      index = end;
    }
  }

  const headings: HeadingEntry[] = [];
  let activePage: MutablePageSpan | undefined;
  let index = frontmatter?.body ?? 0;

  const context = (): UnitContext => Object.freeze({
    headingAncestry: headingPath(headings),
    ...(activePage === undefined ? {} : { pdfPage: activePage.page }),
  });

  const finishPage = (endLine: number): void => {
    if (activePage === undefined || endLine <= activePage.startLine) return;
    addBoundedSpan("pdf-page-span", activePage.startLine, endLine, {
      headingAncestry: activePage.headingAncestry,
      pdfPage: activePage.page,
    });
  };

  while (index < lines.length) {
    const line = lines[index]?.content ?? "";
    const markerPage = pdfPage(line);
    if (markerPage !== undefined) {
      finishPage(index);
      activePage = Object.freeze({
        page: markerPage,
        startLine: index,
        headingAncestry: headingPath(headings),
      });
      index += 1;
      continue;
    }

    const opening = fenceOpening(line);
    if (opening !== undefined) {
      let end = index + 1;
      while (end < lines.length && !closesFence(lines[end]?.content ?? "", opening)) end += 1;
      if (end < lines.length) end += 1;
      addBoundedSpan("code-block", index, end, context());
      index = end;
      continue;
    }

    const heading = atxHeading(line);
    if (heading !== undefined) {
      updateHeadingStack(headings, heading);
      addBoundedSpan("heading", index, index + 1, context());
      index += 1;
      continue;
    }

    const nextSetextLevel = setextLevel(lines[index + 1]?.content ?? "");
    if (
      line.trim() !== ""
      && nextSetextLevel !== undefined
      && !listItem(line)
      && !indentedCode(line)
    ) {
      updateHeadingStack(headings, { level: nextSetextLevel, text: line.trim() });
      addBoundedSpan("heading", index, index + 2, context());
      index += 2;
      continue;
    }

    if (startsTable(lines, index)) {
      let end = index + 2;
      while (
        end < lines.length
        && (lines[end]?.content.trim() ?? "") !== ""
        && unescapedPipeCount(lines[end]?.content ?? "") > 0
      ) end += 1;
      addBoundedSpan(
        "table",
        index,
        end,
        context(),
        MAX_EVALUATION_EVIDENCE_TABLE_LINES_PER_UNIT,
      );
      index = end;
      continue;
    }

    if (listItem(line)) {
      let end = index + 1;
      while (end < lines.length) {
        const candidate = lines[end]?.content ?? "";
        if (candidate.trim() === "") {
          let next = end + 1;
          while (next < lines.length && (lines[next]?.content.trim() ?? "") === "") next += 1;
          const continuation = lines[next]?.content ?? "";
          if (next < lines.length && (listItem(continuation) || indented(continuation))) {
            end = next;
            continue;
          }
          break;
        }
        if (!listItem(candidate) && !indented(candidate)) break;
        end += 1;
      }

      let chunkStart = index;
      let itemCount = 0;
      for (let cursor = index; cursor < end; cursor += 1) {
        if (!listItem(lines[cursor]?.content ?? "")) continue;
        if (itemCount === MAX_EVALUATION_EVIDENCE_LIST_ITEMS_PER_UNIT) {
          addBoundedSpan("list", chunkStart, cursor, context());
          chunkStart = cursor;
          itemCount = 0;
        }
        itemCount += 1;
      }
      addBoundedSpan("list", chunkStart, end, context());
      index = end;
      continue;
    }

    if (indentedCode(line)) {
      let end = index + 1;
      let lastCodeLine = end;
      while (end < lines.length) {
        const candidate = lines[end]?.content ?? "";
        if (indentedCode(candidate)) {
          end += 1;
          lastCodeLine = end;
          continue;
        }
        if (candidate.trim() === "") {
          end += 1;
          continue;
        }
        break;
      }
      addBoundedSpan("code-block", index, lastCodeLine, context());
      index = end;
      continue;
    }

    if (line.trim() === "" || thematicBreak(line)) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < lines.length) {
      const candidate = lines[end]?.content ?? "";
      const candidateHeading = atxHeading(candidate);
      if (
        candidate.trim() === ""
        || pdfPage(candidate) !== undefined
        || fenceOpening(candidate) !== undefined
        || candidateHeading !== undefined
        || listItem(candidate)
        || indentedCode(candidate)
        || thematicBreak(candidate)
        || startsTable(lines, end)
      ) break;
      end += 1;
    }
    addBoundedSpan("paragraph", index, end, context());
    index = end;
  }

  finishPage(lines.length);
  units.sort(compareUnits);

  const ids = new Set<string>();
  const ranges = new Set<string>();
  for (const unit of units) {
    if (ids.has(unit.id)) {
      throw new Error(`Parser produced duplicate evidence unit ID ${unit.id}.`);
    }
    ids.add(unit.id);
    const rangeKey = `${unit.kind}:${unit.byteRange.start}:${unit.byteRange.end}`;
    if (ranges.has(rangeKey)) {
      throw new Error(`Parser produced duplicate ${unit.kind} source range in ${document.sourcePath}.`);
    }
    ranges.add(rangeKey);
  }

  return Object.freeze(units);
}

function documentSnapshot(value: EvaluationEvidenceDocument, index: number): EvaluationEvidenceDocumentSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`documents[${index}] must be an object.`);
  }
  const documentId = boundedSingleLine(value.documentId, `documents[${index}].documentId`, 4_096);
  const sourcePath = confinedSourcePath(value.sourcePath);
  const trustClass = boundedSingleLine(value.trustClass, `documents[${index}].trustClass`, 256);
  if (typeof value.markdown !== "string" || hasUnpairedSurrogate(value.markdown)) {
    throw new TypeError(`documents[${index}].markdown must be a well-formed Unicode string.`);
  }
  if (value.markdown.includes("\0")) {
    throw new TypeError(`documents[${index}].markdown must not contain NUL bytes.`);
  }
  const byteLength = Buffer.byteLength(value.markdown, "utf8");
  if (byteLength > MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES) {
    throw new RangeError(
      `documents[${index}].markdown exceeds ${MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES} UTF-8 bytes.`,
    );
  }
  return Object.freeze({
    documentId,
    sourcePath,
    markdown: value.markdown,
    trustClass,
    byteLength,
    sourceSha256: sha256(Buffer.from(value.markdown, "utf8")),
  });
}

export function buildEvaluationEvidenceRegistry(input: {
  readonly documents: readonly EvaluationEvidenceDocument[];
  readonly parserVersion?: string;
}): EvaluationEvidenceRegistry {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Evidence registry input must be an object.");
  }
  if (!Array.isArray(input.documents)) {
    throw new TypeError("documents must be an array.");
  }
  if (input.documents.length > MAX_EVALUATION_EVIDENCE_DOCUMENTS) {
    throw new RangeError(`documents must contain at most ${MAX_EVALUATION_EVIDENCE_DOCUMENTS} entries.`);
  }
  const analysisVersion = parserVersion(
    input.parserVersion ?? EVALUATION_EVIDENCE_PARSER_VERSION,
  );
  const documents = input.documents.map(documentSnapshot).toSorted((left, right) => (
    compareText(left.documentId, right.documentId)
    || compareText(left.sourcePath, right.sourcePath)
  ));
  const documentIds = new Set<string>();
  const sourcePaths = new Set<string>();
  let totalBytes = 0;
  for (const document of documents) {
    if (documentIds.has(document.documentId)) {
      throw new TypeError(`documents contains duplicate documentId ${document.documentId}.`);
    }
    if (sourcePaths.has(document.sourcePath)) {
      throw new TypeError(`documents contains duplicate sourcePath ${document.sourcePath}.`);
    }
    documentIds.add(document.documentId);
    sourcePaths.add(document.sourcePath);
    totalBytes += document.byteLength;
    if (totalBytes > MAX_EVALUATION_EVIDENCE_TOTAL_BYTES) {
      throw new RangeError(
        `documents exceed ${MAX_EVALUATION_EVIDENCE_TOTAL_BYTES} total UTF-8 bytes.`,
      );
    }
  }

  const frozenDocuments = Object.freeze(documents);
  const parsedUnits: EvaluationEvidenceUnit[] = [];
  for (const document of frozenDocuments) {
    const documentUnits = parseDocument(document, analysisVersion);
    if (parsedUnits.length + documentUnits.length > MAX_EVALUATION_EVIDENCE_TOTAL_UNITS) {
      throw new RangeError(
        `documents produce more than ${MAX_EVALUATION_EVIDENCE_TOTAL_UNITS} total evidence units.`,
      );
    }
    parsedUnits.push(...documentUnits);
  }
  const units = Object.freeze(parsedUnits.toSorted(compareUnits));
  return Object.freeze({
    schemaVersion: EVALUATION_EVIDENCE_SCHEMA_VERSION,
    parserVersion: analysisVersion,
    documents: frozenDocuments,
    units,
  });
}

function canonicalValue(
  value: unknown,
  seen: Set<object>,
): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Registry contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new TypeError("Registry contains an unsupported value.");
  if (seen.has(value)) throw new TypeError("Registry must not contain cycles.");
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => canonicalValue(entry, seen)).join(",")}]`;
  } else {
    const record = value as Readonly<Record<string, unknown>>;
    result = `{${Object.keys(record).toSorted().map((key) => (
      `${JSON.stringify(key)}:${canonicalValue(record[key], seen)}`
    )).join(",")}}`;
  }
  seen.delete(value);
  return result;
}

function canonicalRegistry(value: unknown): string {
  return canonicalValue(value, new Set());
}

export function validateEvaluationEvidenceRegistry(
  registry: unknown,
  options: {
    readonly documents?: readonly EvaluationEvidenceDocument[];
    readonly parserVersion?: string;
  } = {},
): asserts registry is EvaluationEvidenceRegistry {
  if (registry === null || typeof registry !== "object" || Array.isArray(registry)) {
    throw new TypeError("Evaluation evidence registry must be an object.");
  }
  const candidate = registry as Partial<EvaluationEvidenceRegistry>;
  const expectedVersion = parserVersion(
    options.parserVersion ?? EVALUATION_EVIDENCE_PARSER_VERSION,
  );
  if (candidate.parserVersion !== expectedVersion) {
    throw new Error(
      `Evaluation evidence parser version drift: expected ${expectedVersion}, received ${String(candidate.parserVersion)}.`,
    );
  }
  const candidateDocuments: unknown = candidate.documents;
  const candidateUnits: unknown = candidate.units;
  if (!Array.isArray(candidateDocuments) || !Array.isArray(candidateUnits)) {
    throw new TypeError("Evaluation evidence registry must contain document and unit arrays.");
  }
  const declaredDocuments = candidate.documents;
  if (declaredDocuments === undefined) {
    throw new TypeError("Evaluation evidence registry must contain document snapshots.");
  }
  const sourceDocuments = options.documents ?? declaredDocuments.map((document) => ({
    documentId: document.documentId,
    sourcePath: document.sourcePath,
    markdown: document.markdown,
    trustClass: document.trustClass,
  }));
  const rebuilt = buildEvaluationEvidenceRegistry({
    documents: sourceDocuments,
    parserVersion: expectedVersion,
  });
  if (canonicalRegistry(candidate) !== canonicalRegistry(rebuilt)) {
    throw new Error(
      "Evaluation evidence registry validation failed: source bytes, paths, trust, ranges, hashes, or IDs drifted.",
    );
  }
}

function integerInRange(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function usefulUnitOrder(left: EvaluationEvidenceUnit, right: EvaluationEvidenceUnit): number {
  const leftPage = left.kind === "pdf-page-span" ? 1 : 0;
  const rightPage = right.kind === "pdf-page-span" ? 1 : 0;
  return leftPage - rightPage
    || (left.byteRange.end - left.byteRange.start) - (right.byteRange.end - right.byteRange.start)
    || compareUnits(left, right);
}

function nearestUnitByByte(
  units: readonly EvaluationEvidenceUnit[],
  byteOffset: number,
): EvaluationEvidenceUnit | undefined {
  return units.toSorted((left, right) => {
    const leftDistance = byteOffset < left.byteRange.start
      ? left.byteRange.start - byteOffset
      : byteOffset >= left.byteRange.end
        ? byteOffset - left.byteRange.end + 1
        : 0;
    const rightDistance = byteOffset < right.byteRange.start
      ? right.byteRange.start - byteOffset
      : byteOffset >= right.byteRange.end
        ? byteOffset - right.byteRange.end + 1
        : 0;
    return leftDistance - rightDistance || usefulUnitOrder(left, right);
  })[0];
}

function nearestUnitByLine(
  units: readonly EvaluationEvidenceUnit[],
  line: number,
): EvaluationEvidenceUnit | undefined {
  return units.toSorted((left, right) => {
    const leftDistance = line < left.lineRange.start
      ? left.lineRange.start - line
      : line > left.lineRange.end
        ? line - left.lineRange.end
        : 0;
    const rightDistance = line < right.lineRange.start
      ? right.lineRange.start - line
      : line > right.lineRange.end
        ? line - right.lineRange.end
        : 0;
    return leftDistance - rightDistance || usefulUnitOrder(left, right);
  })[0];
}

function resolvePrimary(
  registry: EvaluationEvidenceRegistry,
  locator: EvaluationEvidenceLocator,
): EvaluationEvidenceUnit {
  if (locator === null || typeof locator !== "object" || Array.isArray(locator)) {
    throw new TypeError("Evidence locator must be an object.");
  }
  const documentId = boundedSingleLine(locator.documentId, "locator.documentId", 4_096);
  const document = registry.documents.find((entry) => entry.documentId === documentId);
  if (document === undefined) throw new Error(`Unknown evidence document ${documentId}.`);
  const units = registry.units.filter((unit) => unit.documentId === documentId);
  const keys = ["unitId", "byteOffset", "line", "pdfPage"].filter((key) => (
    Object.prototype.hasOwnProperty.call(locator, key)
  ));
  if (keys.length !== 1) {
    throw new TypeError("Evidence locator must define exactly one of unitId, byteOffset, line, or pdfPage.");
  }

  if ("unitId" in locator) {
    const id = boundedSingleLine(locator.unitId, "locator.unitId", 256);
    if (!UNIT_ID.test(id)) throw new TypeError("locator.unitId is not an evidence unit ID.");
    const unit = units.find((candidate) => candidate.id === id);
    if (unit === undefined) throw new Error(`Unknown evidence unit ${id} in ${documentId}.`);
    return unit;
  }

  const nonPageUnits = units.filter((unit) => unit.kind !== "pdf-page-span");
  if ("byteOffset" in locator) {
    const byteOffset = integerInRange(
      locator.byteOffset,
      "locator.byteOffset",
      0,
      Math.max(0, document.byteLength - 1),
    );
    const containing = nonPageUnits.filter((unit) => (
      unit.byteRange.start <= byteOffset && byteOffset < unit.byteRange.end
    )).toSorted(usefulUnitOrder)[0];
    const unit = containing
      ?? nearestUnitByByte(nonPageUnits, byteOffset)
      ?? nearestUnitByByte(units, byteOffset);
    if (unit === undefined) throw new Error(`${documentId} has no evidence unit at byte ${byteOffset}.`);
    return unit;
  }

  if ("line" in locator) {
    const lineCount = sourceLines(document.markdown, document.sourcePath).length;
    const line = integerInRange(locator.line, "locator.line", 1, lineCount);
    const containing = nonPageUnits.filter((unit) => (
      unit.lineRange.start <= line && line <= unit.lineRange.end
    )).toSorted(usefulUnitOrder)[0];
    const unit = containing
      ?? nearestUnitByLine(nonPageUnits, line)
      ?? nearestUnitByLine(units, line);
    if (unit === undefined) throw new Error(`${documentId} has no evidence unit at line ${line}.`);
    return unit;
  }

  const page = integerInRange(locator.pdfPage, "locator.pdfPage", 1, 999_999_999);
  const pageSpans = units.filter((unit) => unit.kind === "pdf-page-span" && unit.pdfPage === page);
  const unit = pageSpans.toSorted(usefulUnitOrder)[0]
    ?? units.filter((candidate) => candidate.pdfPage === page).toSorted(usefulUnitOrder)[0];
  if (unit === undefined) throw new Error(`${documentId} has no evidence for PDF page ${page}.`);
  return unit;
}

function sameHeadingPath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function neighborCandidates(
  registry: EvaluationEvidenceRegistry,
  primary: EvaluationEvidenceUnit,
): readonly NeighborCandidate[] {
  const documentUnits = registry.units.filter((unit) => unit.documentId === primary.documentId);
  const blockUnits = documentUnits.filter((unit) => unit.kind !== "pdf-page-span");
  const candidates: NeighborCandidate[] = [];
  const seen = new Set([primary.id]);
  const add = (candidate: NeighborCandidate | undefined): void => {
    if (candidate === undefined || seen.has(candidate.unit.id)) return;
    seen.add(candidate.unit.id);
    candidates.push(Object.freeze({
      relation: candidate.relation,
      ...(candidate.direction === undefined ? {} : { direction: candidate.direction }),
      unit: candidate.unit,
    }));
  };

  const maximumHeadingDepth = primary.kind === "heading"
    ? primary.headingAncestry.length - 1
    : primary.headingAncestry.length;
  for (let depth = maximumHeadingDepth; depth > 0; depth -= 1) {
    const prefix = primary.headingAncestry.slice(0, depth);
    for (let index = blockUnits.length - 1; index >= 0; index -= 1) {
      const unit = blockUnits[index];
      if (
        unit !== undefined
        && unit.kind === "heading"
        && unit.byteRange.start <= primary.byteRange.start
        && sameHeadingPath(unit.headingAncestry, prefix)
      ) {
        add({ relation: "parent-heading", unit });
        break;
      }
    }
  }

  const primaryBlockIndex = blockUnits.findIndex((unit) => unit.id === primary.id);
  if (primaryBlockIndex >= 0) {
    const before = blockUnits[primaryBlockIndex - 1];
    const after = blockUnits[primaryBlockIndex + 1];
    if (before !== undefined) add({ relation: "adjacent-block", direction: "before", unit: before });
    if (after !== undefined) add({ relation: "adjacent-block", direction: "after", unit: after });
  }

  if (primary.pdfPage !== undefined) {
    for (const unit of blockUnits) {
      if (unit.pdfPage === primary.pdfPage) add({ relation: "same-page", unit });
    }
  }
  return Object.freeze(candidates);
}

export function resolveEvaluationEvidenceNeighborhood(
  registry: EvaluationEvidenceRegistry,
  locator: EvaluationEvidenceLocator,
  options: {
    readonly maxBytes: number;
    readonly maxNeighbors?: number;
  },
): EvaluationEvidenceNeighborhood {
  validateEvaluationEvidenceRegistry(registry);
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Evidence neighborhood options must be an object.");
  }
  const maxBytes = integerInRange(
    options.maxBytes,
    "maxBytes",
    1,
    MAX_EVALUATION_EVIDENCE_NEIGHBORHOOD_BYTES,
  );
  const maxNeighbors = integerInRange(
    options.maxNeighbors ?? 32,
    "maxNeighbors",
    0,
    MAX_EVALUATION_EVIDENCE_NEIGHBORS,
  );
  const primary = resolvePrimary(registry, locator);
  const primaryBytes = primary.byteRange.end - primary.byteRange.start;
  if (primaryBytes > maxBytes) {
    throw new RangeError(
      `maxBytes ${maxBytes} cannot fit primary evidence unit ${primary.id} (${primaryBytes} bytes).`,
    );
  }

  const candidates = neighborCandidates(registry, primary);
  const neighbors: EvaluationEvidenceNeighbor[] = [];
  let bytesUsed = primaryBytes;
  let truncated = false;
  for (const candidate of candidates) {
    const bytes = candidate.unit.byteRange.end - candidate.unit.byteRange.start;
    if (neighbors.length >= maxNeighbors || bytesUsed + bytes > maxBytes) {
      truncated = true;
      continue;
    }
    neighbors.push(Object.freeze({
      relation: candidate.relation,
      ...(candidate.direction === undefined ? {} : { direction: candidate.direction }),
      unit: candidate.unit,
    }));
    bytesUsed += bytes;
  }

  return Object.freeze({
    primary,
    neighbors: Object.freeze(neighbors),
    bytesUsed,
    maxBytes,
    candidateCount: candidates.length,
    truncated,
  });
}
