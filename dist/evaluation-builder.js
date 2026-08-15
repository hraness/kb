#!/usr/bin/env bun
// @bun
import {
  knowledgeBaseEvaluationRetrieverIds,
  openKnowledgeBaseEvaluation,
  verifyFrozenEvaluationSnapshot
} from "./index-y6djytnb.js";
import"./index-2hsmrc38.js";
import {
  indexSemanticVault,
  recommendedEmbeddingModel,
  recommendedEmbeddingModelSha256,
  scanVault
} from "./index-etpd4zz0.js";
import {
  MAX_EVALUATION_DIAGNOSTICS,
  MAX_EVALUATION_EVIDENCE_BYTES,
  MAX_EVALUATION_RESULTS_PER_QUERY
} from "./index-b88v3vtm.js";
import {
  runGitCommand
} from "./index-1gwbassd.js";
import"./index-tthfg4xy.js";
import"./index-d13v9ckt.js";
import"./index-48pz4jpc.js";
import"./index-06c9ctr6.js";
import"./index-5vwpzb5a.js";
import"./index-4962kvds.js";

// src/evaluation-builder.ts
import { createHash as createHash9, randomBytes } from "crypto";
import { constants as fsConstants } from "fs";
import {
  link,
  lstat as lstat2,
  open as open2,
  realpath as realpath2,
  unlink
} from "fs/promises";
import {
  basename as basename2,
  dirname as dirname2,
  isAbsolute as isAbsolute2,
  relative as relative2,
  resolve as resolve2,
  sep as sep2
} from "path";
import { z } from "zod";

// src/evaluation-corpus-authoring.ts
import { createHash as createHash3 } from "crypto";

// src/evaluation-evidence.ts
import { createHash } from "crypto";
var EVALUATION_EVIDENCE_SCHEMA_VERSION = 1;
var EVALUATION_EVIDENCE_PARSER_VERSION = "evaluation-evidence-v1";
var MAX_EVALUATION_EVIDENCE_DOCUMENTS = 1e4;
var MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES = 8 * 1024 * 1024;
var MAX_EVALUATION_EVIDENCE_TOTAL_BYTES = 64 * 1024 * 1024;
var MAX_EVALUATION_EVIDENCE_LINES_PER_DOCUMENT = 200000;
var MAX_EVALUATION_EVIDENCE_LINE_BYTES = 1 * 1024 * 1024;
var MAX_EVALUATION_EVIDENCE_UNIT_BYTES = 1 * 1024 * 1024;
var MAX_EVALUATION_EVIDENCE_UNITS_PER_DOCUMENT = 1e5;
var MAX_EVALUATION_EVIDENCE_TOTAL_UNITS = 1e5;
var MAX_EVALUATION_EVIDENCE_LIST_ITEMS_PER_UNIT = 128;
var MAX_EVALUATION_EVIDENCE_TABLE_LINES_PER_UNIT = 258;
var MAX_EVALUATION_EVIDENCE_NEIGHBORS = 256;
var MAX_EVALUATION_EVIDENCE_NEIGHBORHOOD_BYTES = 1 * 1024 * 1024;
var WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/iu;
var PARSER_VERSION = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
var UNIT_ID = /^eeu:[a-z0-9][a-z0-9._-]{0,63}:[0-9a-f]{64}$/u;
var PDF_PAGE_MARKER = /^\s*<!--\s*pdf-page:\s*([1-9][0-9]{0,8})\s*-->\s*$/u;
var KIND_ORDER = Object.freeze({
  "frontmatter-field": 0,
  heading: 1,
  paragraph: 2,
  list: 3,
  table: 4,
  "code-block": 5,
  "pdf-page-span": 6
});
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function hasUnpairedSurrogate(value) {
  for (let index = 0;index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (next < 56320 || next > 57343)
        return true;
      index += 1;
    } else if (code >= 56320 && code <= 57343) {
      return true;
    }
  }
  return false;
}
function boundedSingleLine(value, label, maximumBytes) {
  if (typeof value !== "string" || value === "" || value.trim() !== value || /[\0\r\n]/u.test(value) || hasUnpairedSurrogate(value) || value.normalize("NFC") !== value || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new TypeError(`${label} must be a non-empty NFC single-line string of at most ${maximumBytes} UTF-8 bytes.`);
  }
  return value;
}
function parserVersion(value) {
  const parsed = boundedSingleLine(value, "parserVersion", 64);
  if (!PARSER_VERSION.test(parsed)) {
    throw new TypeError("parserVersion must be a lowercase version token.");
  }
  return parsed;
}
function confinedSourcePath(value) {
  if (typeof value !== "string" || /[\0\r\n]/u.test(value) || hasUnpairedSurrogate(value)) {
    throw new TypeError("sourcePath must be a confined repository-relative path.");
  }
  const path = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (path === "" || path.normalize("NFC") !== path || path.startsWith("/") || WINDOWS_ABSOLUTE_PATH.test(path) || Buffer.byteLength(path, "utf8") > 4096 || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new TypeError("sourcePath must be a confined repository-relative path.");
  }
  return path;
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function unitId(input) {
  const digest = createHash("sha256");
  digest.update("evaluation-evidence-unit\x00", "utf8");
  for (const field of [
    input.parserVersion,
    input.documentId,
    input.kind,
    String(input.byteStart),
    String(input.byteEnd),
    input.sliceSha256
  ]) {
    const bytes = Buffer.from(field, "utf8");
    digest.update(String(bytes.byteLength), "utf8");
    digest.update(":", "utf8");
    digest.update(bytes);
    digest.update("\x00", "utf8");
  }
  return `eeu:${input.parserVersion}:${digest.digest("hex")}`;
}
function sourceLines(markdown, sourcePath) {
  const lines = [];
  let startCharacter = 0;
  let startByte = 0;
  while (startCharacter < markdown.length) {
    let contentEnd = startCharacter;
    while (contentEnd < markdown.length && markdown[contentEnd] !== `
` && markdown[contentEnd] !== "\r")
      contentEnd += 1;
    let endCharacter = contentEnd;
    if (markdown[endCharacter] === "\r" && markdown[endCharacter + 1] === `
`) {
      endCharacter += 2;
    } else if (markdown[endCharacter] === "\r" || markdown[endCharacter] === `
`) {
      endCharacter += 1;
    }
    const raw = markdown.slice(startCharacter, endCharacter);
    const byteLength = Buffer.byteLength(raw, "utf8");
    if (byteLength > MAX_EVALUATION_EVIDENCE_LINE_BYTES) {
      throw new RangeError(`${sourcePath} has a line larger than ${MAX_EVALUATION_EVIDENCE_LINE_BYTES} UTF-8 bytes.`);
    }
    lines.push(Object.freeze({
      number: lines.length + 1,
      content: markdown.slice(startCharacter, contentEnd),
      startCharacter,
      endCharacter,
      startByte,
      endByte: startByte + byteLength
    }));
    if (lines.length > MAX_EVALUATION_EVIDENCE_LINES_PER_DOCUMENT) {
      throw new RangeError(`${sourcePath} has more than ${MAX_EVALUATION_EVIDENCE_LINES_PER_DOCUMENT} lines.`);
    }
    startCharacter = endCharacter;
    startByte += byteLength;
  }
  return Object.freeze(lines);
}
function frontmatterBounds(lines) {
  const first = lines[0]?.content.replace(/^\uFEFF/u, "");
  if (first !== "---")
    return;
  for (let index = 1;index < lines.length; index += 1) {
    if (/^(?:---|\.\.\.)[ \t]*$/u.test(lines[index]?.content ?? "")) {
      return Object.freeze({ close: index, body: index + 1 });
    }
  }
  return;
}
function frontmatterField(line) {
  const match = /^([^ \t#][^:]{0,255}?):(?:[ \t]|$)/u.exec(line);
  const field = match?.[1]?.trim();
  return field === undefined || field === "" ? undefined : field;
}
function atxHeading(line) {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/u.exec(line);
  const hashes = match?.[1];
  if (hashes === undefined)
    return;
  const text = (match?.[2] ?? "").replace(/[ \t]+#+[ \t]*$/u, "").trim();
  return Object.freeze({ level: hashes.length, text });
}
function setextLevel(line) {
  if (/^ {0,3}=+[ \t]*$/u.test(line))
    return 1;
  if (/^ {0,3}-+[ \t]*$/u.test(line))
    return 2;
  return;
}
function thematicBreak(line) {
  const compact = line.replace(/[ \t]/gu, "");
  return /^(?:\*{3,}|-{3,}|_{3,})$/u.test(compact);
}
function fenceOpening(line) {
  const match = /^ {0,3}(`{3,}|~{3,})[^\r\n]*$/u.exec(line);
  const fence = match?.[1];
  if (fence === undefined)
    return;
  return Object.freeze({ marker: fence[0], length: fence.length });
}
function closesFence(line, opening) {
  const match = /^ {0,3}(`+|~+)[ \t]*$/u.exec(line);
  const fence = match?.[1];
  return fence !== undefined && fence[0] === opening.marker && fence.length >= opening.length;
}
function listItem(line) {
  return /^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])(?:[ \t]+|$)/u.test(line);
}
function indented(line) {
  return /^(?: {2,}|\t)/u.test(line);
}
function indentedCode(line) {
  return /^(?: {4}|\t)/u.test(line);
}
function unescapedPipeCount(line) {
  let count = 0;
  let slashRun = 0;
  for (const character of line) {
    if (character === "\\") {
      slashRun += 1;
    } else {
      if (character === "|" && slashRun % 2 === 0)
        count += 1;
      slashRun = 0;
    }
  }
  return count;
}
function tableDelimiter(line) {
  let content = line.trim();
  if (content.startsWith("|"))
    content = content.slice(1);
  if (content.endsWith("|"))
    content = content.slice(0, -1);
  const cells = content.split(/(?<!\\)\|/u).map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}
function startsTable(lines, index) {
  const header = lines[index]?.content;
  const delimiter = lines[index + 1]?.content;
  return header !== undefined && delimiter !== undefined && unescapedPipeCount(header) > 0 && tableDelimiter(delimiter);
}
function pdfPage(line) {
  const value = PDF_PAGE_MARKER.exec(line)?.[1];
  if (value === undefined)
    return;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : undefined;
}
function headingPath(stack) {
  return Object.freeze(stack.map((entry) => entry.text));
}
function updateHeadingStack(stack, heading) {
  while ((stack.at(-1)?.level ?? 0) >= heading.level)
    stack.pop();
  stack.push(Object.freeze({ level: heading.level, text: heading.text }));
}
function compareUnits(left, right) {
  return compareText(left.documentId, right.documentId) || left.byteRange.start - right.byteRange.start || left.byteRange.end - right.byteRange.end || KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || compareText(left.id, right.id);
}
function freezeUnit(input) {
  return Object.freeze({
    id: input.id,
    parserVersion: input.parserVersion,
    kind: input.kind,
    documentId: input.documentId,
    sourcePath: input.sourcePath,
    byteRange: Object.freeze({ start: input.byteStart, end: input.byteEnd }),
    lineRange: Object.freeze({ start: input.lineStart, end: input.lineEnd }),
    headingAncestry: Object.freeze([...input.headingAncestry]),
    ...input.pdfPage === undefined ? {} : { pdfPage: input.pdfPage },
    ...input.frontmatterField === undefined ? {} : { frontmatterField: input.frontmatterField },
    sha256: input.sha256,
    trustClass: input.trustClass,
    text: input.text
  });
}
function parseDocument(document, analysisVersion) {
  const lines = sourceLines(document.markdown, document.sourcePath);
  const units = [];
  const addExactSpan = (kind, startLine, endLine, context2) => {
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
        sliceSha256
      }),
      parserVersion: analysisVersion,
      kind,
      documentId: document.documentId,
      sourcePath: document.sourcePath,
      byteStart: first.startByte,
      byteEnd: last.endByte,
      lineStart: first.number,
      lineEnd: last.number,
      headingAncestry: context2.headingAncestry,
      ...context2.pdfPage === undefined ? {} : { pdfPage: context2.pdfPage },
      ...context2.frontmatterField === undefined ? {} : { frontmatterField: context2.frontmatterField },
      sha256: sliceSha256,
      trustClass: document.trustClass,
      text
    }));
    if (units.length > MAX_EVALUATION_EVIDENCE_UNITS_PER_DOCUMENT) {
      throw new RangeError(`${document.sourcePath} produced more than ${MAX_EVALUATION_EVIDENCE_UNITS_PER_DOCUMENT} evidence units.`);
    }
  };
  const addBoundedSpan = (kind, startLine, endLine, context2, maximumLines = Number.POSITIVE_INFINITY) => {
    let chunkStart = startLine;
    while (chunkStart < endLine) {
      const first = lines[chunkStart];
      if (first === undefined) {
        throw new RangeError(`Parser produced an unresolved source range for ${document.sourcePath}.`);
      }
      let chunkEnd = chunkStart;
      while (chunkEnd < endLine && chunkEnd - chunkStart < maximumLines) {
        const line = lines[chunkEnd];
        if (line === undefined)
          break;
        if (line.endByte - first.startByte > MAX_EVALUATION_EVIDENCE_UNIT_BYTES)
          break;
        chunkEnd += 1;
      }
      if (chunkEnd === chunkStart) {
        throw new RangeError(`${document.sourcePath} contains a source line too large for an evidence unit.`);
      }
      addExactSpan(kind, chunkStart, chunkEnd, context2);
      chunkStart = chunkEnd;
    }
  };
  const frontmatter = frontmatterBounds(lines);
  if (frontmatter !== undefined) {
    let index2 = 1;
    while (index2 < frontmatter.close) {
      const field = frontmatterField(lines[index2]?.content ?? "");
      if (field === undefined) {
        index2 += 1;
        continue;
      }
      let end = index2 + 1;
      while (end < frontmatter.close && frontmatterField(lines[end]?.content ?? "") === undefined)
        end += 1;
      addBoundedSpan("frontmatter-field", index2, end, {
        headingAncestry: Object.freeze([]),
        frontmatterField: field
      });
      index2 = end;
    }
  }
  const headings = [];
  let activePage;
  let index = frontmatter?.body ?? 0;
  const context = () => Object.freeze({
    headingAncestry: headingPath(headings),
    ...activePage === undefined ? {} : { pdfPage: activePage.page }
  });
  const finishPage = (endLine) => {
    if (activePage === undefined || endLine <= activePage.startLine)
      return;
    addBoundedSpan("pdf-page-span", activePage.startLine, endLine, {
      headingAncestry: activePage.headingAncestry,
      pdfPage: activePage.page
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
        headingAncestry: headingPath(headings)
      });
      index += 1;
      continue;
    }
    const opening = fenceOpening(line);
    if (opening !== undefined) {
      let end2 = index + 1;
      while (end2 < lines.length && !closesFence(lines[end2]?.content ?? "", opening))
        end2 += 1;
      if (end2 < lines.length)
        end2 += 1;
      addBoundedSpan("code-block", index, end2, context());
      index = end2;
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
    if (line.trim() !== "" && nextSetextLevel !== undefined && !listItem(line) && !indentedCode(line)) {
      updateHeadingStack(headings, { level: nextSetextLevel, text: line.trim() });
      addBoundedSpan("heading", index, index + 2, context());
      index += 2;
      continue;
    }
    if (startsTable(lines, index)) {
      let end2 = index + 2;
      while (end2 < lines.length && (lines[end2]?.content.trim() ?? "") !== "" && unescapedPipeCount(lines[end2]?.content ?? "") > 0)
        end2 += 1;
      addBoundedSpan("table", index, end2, context(), MAX_EVALUATION_EVIDENCE_TABLE_LINES_PER_UNIT);
      index = end2;
      continue;
    }
    if (listItem(line)) {
      let end2 = index + 1;
      while (end2 < lines.length) {
        const candidate = lines[end2]?.content ?? "";
        if (candidate.trim() === "") {
          let next = end2 + 1;
          while (next < lines.length && (lines[next]?.content.trim() ?? "") === "")
            next += 1;
          const continuation = lines[next]?.content ?? "";
          if (next < lines.length && (listItem(continuation) || indented(continuation))) {
            end2 = next;
            continue;
          }
          break;
        }
        if (!listItem(candidate) && !indented(candidate))
          break;
        end2 += 1;
      }
      let chunkStart = index;
      let itemCount = 0;
      for (let cursor = index;cursor < end2; cursor += 1) {
        if (!listItem(lines[cursor]?.content ?? ""))
          continue;
        if (itemCount === MAX_EVALUATION_EVIDENCE_LIST_ITEMS_PER_UNIT) {
          addBoundedSpan("list", chunkStart, cursor, context());
          chunkStart = cursor;
          itemCount = 0;
        }
        itemCount += 1;
      }
      addBoundedSpan("list", chunkStart, end2, context());
      index = end2;
      continue;
    }
    if (indentedCode(line)) {
      let end2 = index + 1;
      let lastCodeLine = end2;
      while (end2 < lines.length) {
        const candidate = lines[end2]?.content ?? "";
        if (indentedCode(candidate)) {
          end2 += 1;
          lastCodeLine = end2;
          continue;
        }
        if (candidate.trim() === "") {
          end2 += 1;
          continue;
        }
        break;
      }
      addBoundedSpan("code-block", index, lastCodeLine, context());
      index = end2;
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
      if (candidate.trim() === "" || pdfPage(candidate) !== undefined || fenceOpening(candidate) !== undefined || candidateHeading !== undefined || listItem(candidate) || indentedCode(candidate) || thematicBreak(candidate) || startsTable(lines, end))
        break;
      end += 1;
    }
    addBoundedSpan("paragraph", index, end, context());
    index = end;
  }
  finishPage(lines.length);
  units.sort(compareUnits);
  const ids = new Set;
  const ranges = new Set;
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
function documentSnapshot(value, index) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`documents[${index}] must be an object.`);
  }
  const documentId = boundedSingleLine(value.documentId, `documents[${index}].documentId`, 4096);
  const sourcePath = confinedSourcePath(value.sourcePath);
  const trustClass = boundedSingleLine(value.trustClass, `documents[${index}].trustClass`, 256);
  if (typeof value.markdown !== "string" || hasUnpairedSurrogate(value.markdown)) {
    throw new TypeError(`documents[${index}].markdown must be a well-formed Unicode string.`);
  }
  if (value.markdown.includes("\x00")) {
    throw new TypeError(`documents[${index}].markdown must not contain NUL bytes.`);
  }
  const byteLength = Buffer.byteLength(value.markdown, "utf8");
  if (byteLength > MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES) {
    throw new RangeError(`documents[${index}].markdown exceeds ${MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES} UTF-8 bytes.`);
  }
  return Object.freeze({
    documentId,
    sourcePath,
    markdown: value.markdown,
    trustClass,
    byteLength,
    sourceSha256: sha256(Buffer.from(value.markdown, "utf8"))
  });
}
function buildEvaluationEvidenceRegistry(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Evidence registry input must be an object.");
  }
  if (!Array.isArray(input.documents)) {
    throw new TypeError("documents must be an array.");
  }
  if (input.documents.length > MAX_EVALUATION_EVIDENCE_DOCUMENTS) {
    throw new RangeError(`documents must contain at most ${MAX_EVALUATION_EVIDENCE_DOCUMENTS} entries.`);
  }
  const analysisVersion = parserVersion(input.parserVersion ?? EVALUATION_EVIDENCE_PARSER_VERSION);
  const documents = input.documents.map(documentSnapshot).toSorted((left, right) => compareText(left.documentId, right.documentId) || compareText(left.sourcePath, right.sourcePath));
  const documentIds = new Set;
  const sourcePaths = new Set;
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
      throw new RangeError(`documents exceed ${MAX_EVALUATION_EVIDENCE_TOTAL_BYTES} total UTF-8 bytes.`);
    }
  }
  const frozenDocuments = Object.freeze(documents);
  const parsedUnits = [];
  for (const document of frozenDocuments) {
    const documentUnits = parseDocument(document, analysisVersion);
    if (parsedUnits.length + documentUnits.length > MAX_EVALUATION_EVIDENCE_TOTAL_UNITS) {
      throw new RangeError(`documents produce more than ${MAX_EVALUATION_EVIDENCE_TOTAL_UNITS} total evidence units.`);
    }
    parsedUnits.push(...documentUnits);
  }
  const units = Object.freeze(parsedUnits.toSorted(compareUnits));
  return Object.freeze({
    schemaVersion: EVALUATION_EVIDENCE_SCHEMA_VERSION,
    parserVersion: analysisVersion,
    documents: frozenDocuments,
    units
  });
}
function canonicalValue(value, seen) {
  if (value === null)
    return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Registry contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (typeof value !== "object")
    throw new TypeError("Registry contains an unsupported value.");
  if (seen.has(value))
    throw new TypeError("Registry must not contain cycles.");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => canonicalValue(entry, seen)).join(",")}]`;
  } else {
    const record = value;
    result = `{${Object.keys(record).toSorted().map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key], seen)}`).join(",")}}`;
  }
  seen.delete(value);
  return result;
}
function canonicalRegistry(value) {
  return canonicalValue(value, new Set);
}
function validateEvaluationEvidenceRegistry(registry, options = {}) {
  if (registry === null || typeof registry !== "object" || Array.isArray(registry)) {
    throw new TypeError("Evaluation evidence registry must be an object.");
  }
  const candidate = registry;
  const expectedVersion = parserVersion(options.parserVersion ?? EVALUATION_EVIDENCE_PARSER_VERSION);
  if (candidate.parserVersion !== expectedVersion) {
    throw new Error(`Evaluation evidence parser version drift: expected ${expectedVersion}, received ${String(candidate.parserVersion)}.`);
  }
  const candidateDocuments = candidate.documents;
  const candidateUnits = candidate.units;
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
    trustClass: document.trustClass
  }));
  const rebuilt = buildEvaluationEvidenceRegistry({
    documents: sourceDocuments,
    parserVersion: expectedVersion
  });
  if (canonicalRegistry(candidate) !== canonicalRegistry(rebuilt)) {
    throw new Error("Evaluation evidence registry validation failed: source bytes, paths, trust, ranges, hashes, or IDs drifted.");
  }
}
function integerInRange(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}
function usefulUnitOrder(left, right) {
  const leftPage = left.kind === "pdf-page-span" ? 1 : 0;
  const rightPage = right.kind === "pdf-page-span" ? 1 : 0;
  return leftPage - rightPage || left.byteRange.end - left.byteRange.start - (right.byteRange.end - right.byteRange.start) || compareUnits(left, right);
}
function nearestUnitByByte(units, byteOffset) {
  return units.toSorted((left, right) => {
    const leftDistance = byteOffset < left.byteRange.start ? left.byteRange.start - byteOffset : byteOffset >= left.byteRange.end ? byteOffset - left.byteRange.end + 1 : 0;
    const rightDistance = byteOffset < right.byteRange.start ? right.byteRange.start - byteOffset : byteOffset >= right.byteRange.end ? byteOffset - right.byteRange.end + 1 : 0;
    return leftDistance - rightDistance || usefulUnitOrder(left, right);
  })[0];
}
function nearestUnitByLine(units, line) {
  return units.toSorted((left, right) => {
    const leftDistance = line < left.lineRange.start ? left.lineRange.start - line : line > left.lineRange.end ? line - left.lineRange.end : 0;
    const rightDistance = line < right.lineRange.start ? right.lineRange.start - line : line > right.lineRange.end ? line - right.lineRange.end : 0;
    return leftDistance - rightDistance || usefulUnitOrder(left, right);
  })[0];
}
function resolvePrimary(registry, locator) {
  if (locator === null || typeof locator !== "object" || Array.isArray(locator)) {
    throw new TypeError("Evidence locator must be an object.");
  }
  const documentId = boundedSingleLine(locator.documentId, "locator.documentId", 4096);
  const document = registry.documents.find((entry) => entry.documentId === documentId);
  if (document === undefined)
    throw new Error(`Unknown evidence document ${documentId}.`);
  const units = registry.units.filter((unit2) => unit2.documentId === documentId);
  const keys = ["unitId", "byteOffset", "line", "pdfPage"].filter((key) => Object.prototype.hasOwnProperty.call(locator, key));
  if (keys.length !== 1) {
    throw new TypeError("Evidence locator must define exactly one of unitId, byteOffset, line, or pdfPage.");
  }
  if ("unitId" in locator) {
    const id = boundedSingleLine(locator.unitId, "locator.unitId", 256);
    if (!UNIT_ID.test(id))
      throw new TypeError("locator.unitId is not an evidence unit ID.");
    const unit2 = units.find((candidate) => candidate.id === id);
    if (unit2 === undefined)
      throw new Error(`Unknown evidence unit ${id} in ${documentId}.`);
    return unit2;
  }
  const nonPageUnits = units.filter((unit2) => unit2.kind !== "pdf-page-span");
  if ("byteOffset" in locator) {
    const byteOffset = integerInRange(locator.byteOffset, "locator.byteOffset", 0, Math.max(0, document.byteLength - 1));
    const containing = nonPageUnits.filter((unit3) => unit3.byteRange.start <= byteOffset && byteOffset < unit3.byteRange.end).toSorted(usefulUnitOrder)[0];
    const unit2 = containing ?? nearestUnitByByte(nonPageUnits, byteOffset) ?? nearestUnitByByte(units, byteOffset);
    if (unit2 === undefined)
      throw new Error(`${documentId} has no evidence unit at byte ${byteOffset}.`);
    return unit2;
  }
  if ("line" in locator) {
    const lineCount = sourceLines(document.markdown, document.sourcePath).length;
    const line = integerInRange(locator.line, "locator.line", 1, lineCount);
    const containing = nonPageUnits.filter((unit3) => unit3.lineRange.start <= line && line <= unit3.lineRange.end).toSorted(usefulUnitOrder)[0];
    const unit2 = containing ?? nearestUnitByLine(nonPageUnits, line) ?? nearestUnitByLine(units, line);
    if (unit2 === undefined)
      throw new Error(`${documentId} has no evidence unit at line ${line}.`);
    return unit2;
  }
  const page = integerInRange(locator.pdfPage, "locator.pdfPage", 1, 999999999);
  const pageSpans = units.filter((unit2) => unit2.kind === "pdf-page-span" && unit2.pdfPage === page);
  const unit = pageSpans.toSorted(usefulUnitOrder)[0] ?? units.filter((candidate) => candidate.pdfPage === page).toSorted(usefulUnitOrder)[0];
  if (unit === undefined)
    throw new Error(`${documentId} has no evidence for PDF page ${page}.`);
  return unit;
}
function sameHeadingPath(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
function neighborCandidates(registry, primary) {
  const documentUnits = registry.units.filter((unit) => unit.documentId === primary.documentId);
  const blockUnits = documentUnits.filter((unit) => unit.kind !== "pdf-page-span");
  const candidates = [];
  const seen = new Set([primary.id]);
  const add = (candidate) => {
    if (candidate === undefined || seen.has(candidate.unit.id))
      return;
    seen.add(candidate.unit.id);
    candidates.push(Object.freeze({
      relation: candidate.relation,
      ...candidate.direction === undefined ? {} : { direction: candidate.direction },
      unit: candidate.unit
    }));
  };
  const maximumHeadingDepth = primary.kind === "heading" ? primary.headingAncestry.length - 1 : primary.headingAncestry.length;
  for (let depth = maximumHeadingDepth;depth > 0; depth -= 1) {
    const prefix = primary.headingAncestry.slice(0, depth);
    for (let index = blockUnits.length - 1;index >= 0; index -= 1) {
      const unit = blockUnits[index];
      if (unit !== undefined && unit.kind === "heading" && unit.byteRange.start <= primary.byteRange.start && sameHeadingPath(unit.headingAncestry, prefix)) {
        add({ relation: "parent-heading", unit });
        break;
      }
    }
  }
  const primaryBlockIndex = blockUnits.findIndex((unit) => unit.id === primary.id);
  if (primaryBlockIndex >= 0) {
    const before = blockUnits[primaryBlockIndex - 1];
    const after = blockUnits[primaryBlockIndex + 1];
    if (before !== undefined)
      add({ relation: "adjacent-block", direction: "before", unit: before });
    if (after !== undefined)
      add({ relation: "adjacent-block", direction: "after", unit: after });
  }
  if (primary.pdfPage !== undefined) {
    for (const unit of blockUnits) {
      if (unit.pdfPage === primary.pdfPage)
        add({ relation: "same-page", unit });
    }
  }
  return Object.freeze(candidates);
}
function resolveEvaluationEvidenceNeighborhood(registry, locator, options) {
  validateEvaluationEvidenceRegistry(registry);
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Evidence neighborhood options must be an object.");
  }
  const maxBytes = integerInRange(options.maxBytes, "maxBytes", 1, MAX_EVALUATION_EVIDENCE_NEIGHBORHOOD_BYTES);
  const maxNeighbors = integerInRange(options.maxNeighbors ?? 32, "maxNeighbors", 0, MAX_EVALUATION_EVIDENCE_NEIGHBORS);
  const primary = resolvePrimary(registry, locator);
  const primaryBytes = primary.byteRange.end - primary.byteRange.start;
  if (primaryBytes > maxBytes) {
    throw new RangeError(`maxBytes ${maxBytes} cannot fit primary evidence unit ${primary.id} (${primaryBytes} bytes).`);
  }
  const candidates = neighborCandidates(registry, primary);
  const neighbors = [];
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
      ...candidate.direction === undefined ? {} : { direction: candidate.direction },
      unit: candidate.unit
    }));
    bytesUsed += bytes;
  }
  return Object.freeze({
    primary,
    neighbors: Object.freeze(neighbors),
    bytesUsed,
    maxBytes,
    candidateCount: candidates.length,
    truncated
  });
}

// src/evaluation-v2.ts
import { createHash as createHash2 } from "crypto";
var RETRIEVAL_EVALUATION_V2_SCHEMA_VERSION = 2;
var RETRIEVAL_EVALUATION_V2_PROTOCOL = "kb-retrieval-evaluation-v2";
var PROMOTION_EVALUATION_QUERY_COUNT_V2 = 168;
var PROMOTION_DEVELOPMENT_QUERY_COUNT_V2 = 48;
var PROMOTION_TEST_QUERY_COUNT_V2 = 120;
var PROMOTION_TEST_SUPPORTED_COUNT_V2 = 80;
var PROMOTION_TEST_INSUFFICIENT_COUNT_V2 = 40;
var PROMOTION_COHORT_COUNT_V2 = 84;
var PROMOTION_TEST_COHORT_COUNT_V2 = 60;
var PROMOTION_DUAL_ASSESSMENT_MINIMUM_V2 = 42;
var PROMOTION_STRATUM_COHORT_DUAL_FRACTION_V2 = 0.25;
var PROMOTION_STRATUM_COHORT_DUAL_MINIMUM_V2 = 2;
var MAX_EVALUATION_V2_QUERIES = 2000;
var MAX_EVALUATION_V2_DOCUMENTS = 20000;
var MAX_EVALUATION_V2_EVIDENCE_UNITS = 1e5;
var MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY = 2000;
var MAX_EVALUATION_V2_NUGGETS_PER_QUERY = 100;
var MAX_EVALUATION_V2_SUPPORT_SETS_PER_NUGGET = 100;
var MAX_EVALUATION_V2_RESULTS_PER_LANE = 1000;
var MAX_EVALUATION_V2_TRACE_DECISIONS = 1e4;
var MAX_EVALUATION_V2_SAMPLES = 2000000;
var MAX_EVALUATION_V2_TEXT_BYTES = 16 * 1024;
var MAX_EVALUATION_V2_REPORT_TRACE_ITEMS = 5000000;
var MAX_EVALUATION_V2_REPORT_PROVENANCE_ITEMS = 5000000;
var MAX_EVALUATION_V2_REPORT_TRACE_BYTES = 256 * 1024 * 1024;
var MAX_EVALUATION_V2_REPORT_PROVENANCE_BYTES = 128 * 1024 * 1024;
var MAX_EVALUATION_V2_REPORT_RAW_EVIDENCE_ITEMS = 5000000;
var MAX_EVALUATION_V2_REPORT_RAW_EVIDENCE_BYTES = 256 * 1024 * 1024;
var MAX_EVALUATION_V2_PACKED_CONTEXT_EVIDENCE_UNITS = 1e4;
var MAX_EVALUATION_V2_RAW_EVIDENCE_PER_SAMPLE = 1e4;
var MAX_EVALUATION_V2_RAW_EVIDENCE_DEPTH = 12;
var MAX_EVALUATION_V2_RAW_EVIDENCE_ARRAY_ITEMS = 1e4;
var MAX_EVALUATION_V2_RAW_EVIDENCE_OBJECT_FIELDS = 1000;
var MAX_EVALUATION_V2_RAW_EVIDENCE_STRING_BYTES = 64 * 1024;
var MAX_EVALUATION_V2_RAW_EVIDENCE_BYTES_PER_SAMPLE = 8 * 1024 * 1024;
var MAX_EVALUATION_V2_REPORT_PACKED_CONTEXT_ITEMS = 5000000;
var MAX_EVALUATION_V2_REPORT_PACKED_CONTEXT_BYTES = 128 * 1024 * 1024;
var EMPTY_PACKED_CONTEXT_SHA256 = createHash2("sha256").update(Buffer.alloc(0)).digest("hex");
var PROMOTION_CRITICAL_STRATUM_MINIMA_V2 = Object.freeze({
  "local-context": 20,
  "multi-note-relational": 20,
  "source-provenance": 20,
  "temporal-stale-current": 20
});
var PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2 = Object.freeze({
  "active-current-state": 8,
  "code-path-context": 8,
  "conceptual-recall": 8,
  "exact-identity": 8,
  "local-context": 20,
  "metadata-constraint": 8,
  "multi-note-relational": 20,
  "source-provenance": 20,
  "temporal-stale-current": 20
});
var PROMOTION_ACCEPTANCE_STRATUM_COHORT_MINIMA_V2 = Object.freeze({
  "active-current-state": 4,
  "code-path-context": 4,
  "conceptual-recall": 4,
  "exact-identity": 4,
  "local-context": 10,
  "metadata-constraint": 4,
  "multi-note-relational": 10,
  "source-provenance": 10,
  "temporal-stale-current": 10
});
var PROMOTION_CRITICAL_INPUT_MINIMA_V2 = Object.freeze({
  context: 20,
  graph: 20,
  history: 20,
  metadata: 20
});
var EVALUATION_SOURCE_TRUST_COMPATIBILITY_V2 = Object.freeze({
  "authored-note": Object.freeze([
    "authoritative-current",
    "authoritative-historical",
    "maintained-synthesis"
  ]),
  "captured-source": Object.freeze([
    "captured-primary",
    "captured-secondary",
    "untrusted-capture"
  ]),
  "git-history": Object.freeze(["authoritative-historical"]),
  "repository-file": Object.freeze(["authoritative-current"])
});
var sha256Pattern = /^[0-9a-f]{64}$/u;
var gitObjectPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
var evidenceUnitIdPattern = /^eeu:[a-z0-9][a-z0-9._-]{0,63}:[0-9a-f]{64}$/u;
var canonicalIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
var opaquePatterns = Object.freeze({
  evidenceUnit: evidenceUnitIdPattern,
  nugget: /^ng-[0-9a-f]{16}$/u,
  query: /^q-[0-9a-f]{16}$/u,
  sourceFamily: /^sf-[0-9a-f]{16}$/u,
  supportSet: /^ss-[0-9a-f]{16}$/u
});
var windowsAbsolutePattern = /^[a-z]:[\\/]/iu;
var strata = new Set([
  "active-current-state",
  "code-path-context",
  "conceptual-recall",
  "exact-identity",
  "local-context",
  "metadata-constraint",
  "multi-note-relational",
  "no-answer-near-miss",
  "source-provenance",
  "temporal-stale-current"
]);
var lanes = new Set([
  "exact",
  "git",
  "graph",
  "hybrid",
  "keyword",
  "metadata",
  "note",
  "path-context",
  "semantic"
]);
var trustClasses = new Set([
  "authoritative-current",
  "authoritative-historical",
  "captured-primary",
  "captured-secondary",
  "maintained-synthesis",
  "untrusted-capture"
]);
var minimumUsefulEffectMetrics = new Set([
  "document-recall-at-k",
  "evidence-recall-at-k",
  "false-abstention-rate",
  "no-answer-accuracy",
  "nugget-coverage"
]);
var nonInferiorityMetrics = new Set([
  "active-current-state-accuracy",
  "code-path-context-accuracy",
  "context-precision",
  "conceptual-recall-accuracy",
  "document-recall-at-k",
  "evidence-recall-at-k",
  "exact-identity-accuracy",
  "local-context-accuracy",
  "metadata-constraint-accuracy",
  "multi-note-relational-accuracy",
  "source-provenance-accuracy",
  "temporal-stale-current-accuracy",
  "four-reader-query-p95-ms",
  "packing-p95-ms",
  "warm-query-p95-ms"
]);
var promotionNonInferiorityMetrics = new Set([
  "active-current-state-accuracy",
  "code-path-context-accuracy",
  "conceptual-recall-accuracy",
  "document-recall-at-k",
  "evidence-recall-at-k",
  "exact-identity-accuracy",
  "local-context-accuracy",
  "metadata-constraint-accuracy",
  "multi-note-relational-accuracy",
  "source-provenance-accuracy",
  "temporal-stale-current-accuracy",
  "four-reader-query-p95-ms",
  "packing-p95-ms",
  "warm-query-p95-ms"
]);
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}
function strictKeys(value, allowed, label) {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extra.length > 0) {
    throw new TypeError(`${label} has unknown fields: ${extra.toSorted().join(", ")}.`);
  }
}
function boundedString(value, label, maximumBytes = MAX_EVALUATION_V2_TEXT_BYTES) {
  if (typeof value !== "string" || value.trim() === "" || /[\0\r\n]/u.test(value) || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new TypeError(`${label} must be a non-empty, single-line string of at most ${maximumBytes} UTF-8 bytes.`);
  }
  const normalized = value.normalize("NFC");
  if (normalized !== value)
    throw new TypeError(`${label} must be NFC-normalized.`);
  return normalized;
}
function bridgeString(value, label, maximumBytes = 512) {
  const parsed = boundedString(value, label, maximumBytes);
  if (parsed.trim() !== parsed) {
    throw new TypeError(`${label} must not have leading or trailing whitespace.`);
  }
  return parsed;
}
function optionalBoundedString(value, label) {
  return value === undefined ? undefined : boundedString(value, label);
}
function canonicalId(value, label) {
  const id = boundedString(value, label, 256);
  if (!canonicalIdPattern.test(id)) {
    throw new TypeError(`${label} must be a canonical lowercase hyphenated ID.`);
  }
  return id;
}
function confinedPath(value, label, allowRoot = false) {
  const path = boundedString(value, label, 4096);
  if (allowRoot && path === ".")
    return path;
  if (path.startsWith("/") || path.startsWith("./") || path.includes("\\") || windowsAbsolutePattern.test(path) || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new TypeError(`${label} must be a canonical confined repository-relative path.`);
  }
  return path;
}
function safeInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}
function nonnegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}
function positiveNumber(value, label) {
  const parsed = nonnegativeNumber(value, label);
  if (parsed === 0)
    throw new TypeError(`${label} must be greater than zero.`);
  return parsed;
}
function inverseNormalCdf(probability) {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) {
    throw new RangeError("Normal quantile probability must be between zero and one.");
  }
  const a = [
    -39.69683028665376,
    220.9460984245205,
    -275.9285104469687,
    138.357751867269,
    -30.66479806614716,
    2.506628277459239
  ];
  const b = [
    -54.47609879822406,
    161.5858368580409,
    -155.6989798598866,
    66.80131188771972,
    -13.28068155288572
  ];
  const c = [
    -0.007784894002430293,
    -0.3223964580411365,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783
  ];
  const d = [
    0.007784695709041462,
    0.3224671290700398,
    2.445134137142996,
    3.754408661907416
  ];
  const lower = 0.02425;
  const upper = 1 - lower;
  if (probability < lower) {
    const q2 = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q2 + c[1]) * q2 + c[2]) * q2 + c[3]) * q2 + c[4]) * q2 + c[5]) / ((((d[0] * q2 + d[1]) * q2 + d[2]) * q2 + d[3]) * q2 + 1);
  }
  if (probability > upper) {
    const q2 = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q2 + c[1]) * q2 + c[2]) * q2 + c[3]) * q2 + c[4]) * q2 + c[5]) / ((((d[0] * q2 + d[1]) * q2 + d[2]) * q2 + d[3]) * q2 + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function requiredPairedObservationsV2(design) {
  const { alpha, targetPower, assumedDiscordantRate, assumedEffect, minimumUsefulEffect } = design;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 0.5) {
    throw new RangeError("Paired-power alpha must be between zero and 0.5.");
  }
  if (!Number.isFinite(targetPower) || targetPower <= 0.5 || targetPower >= 1) {
    throw new RangeError("Paired-power targetPower must be between 0.5 and one.");
  }
  if (!Number.isFinite(assumedDiscordantRate) || assumedDiscordantRate <= 0 || assumedDiscordantRate > 1)
    throw new RangeError("Paired-power assumedDiscordantRate must be in (0, 1].");
  if (!Number.isFinite(minimumUsefulEffect) || minimumUsefulEffect < 0 || minimumUsefulEffect >= assumedDiscordantRate)
    throw new RangeError("Paired-power minimumUsefulEffect must be in [0, discordance).");
  if (!Number.isFinite(assumedEffect) || assumedEffect <= minimumUsefulEffect || assumedEffect > assumedDiscordantRate) {
    throw new RangeError("Paired-power assumedEffect must exceed the minimum useful effect and not exceed discordance.");
  }
  const nullVariance = assumedDiscordantRate - minimumUsefulEffect ** 2;
  const alternativeVariance = assumedDiscordantRate - assumedEffect ** 2;
  if (nullVariance <= 0 || alternativeVariance < 0) {
    throw new RangeError("Paired-power assumptions imply an invalid paired variance.");
  }
  const numerator = inverseNormalCdf(1 - alpha) * Math.sqrt(nullVariance) + inverseNormalCdf(targetPower) * Math.sqrt(alternativeVariance);
  const required = Math.ceil((numerator / (assumedEffect - minimumUsefulEffect)) ** 2);
  if (!Number.isSafeInteger(required) || required < 1 || required > MAX_EVALUATION_V2_QUERIES) {
    throw new RangeError(`Paired-power design requires ${String(required)} observations, outside the evaluator bound.`);
  }
  return required;
}
function evidenceUnitId(value, label) {
  const id = bridgeString(value, label, 160);
  if (!evidenceUnitIdPattern.test(id)) {
    throw new TypeError(`${label} must use the registry-compatible eeu:<parser-version>:<sha256> form.`);
  }
  return id;
}
function assertCanonicalOrder(values, key, label) {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length)
    throw new TypeError(`${label} must not repeat an ID.`);
  const sorted = keys.toSorted((left, right) => left.localeCompare(right));
  if (keys.some((candidate, index) => candidate !== sorted[index])) {
    throw new TypeError(`${label} must be in canonical ID order.`);
  }
}
function stringList(value, label, options) {
  if (!Array.isArray(value) || !options.allowEmpty && value.length === 0 || value.length > options.maximum) {
    const lower = options.allowEmpty ? 0 : 1;
    throw new TypeError(`${label} must contain from ${lower} through ${options.maximum} entries.`);
  }
  const parsed = value.map((entry, index) => boundedString(entry, `${label}[${index}]`, 4096));
  if (new Set(parsed).size !== parsed.length)
    throw new TypeError(`${label} must not contain duplicates.`);
  if (options.canonical) {
    const sorted = parsed.toSorted((left, right) => left.localeCompare(right));
    if (parsed.some((entry, index) => entry !== sorted[index])) {
      throw new TypeError(`${label} must be in canonical order.`);
    }
  }
  return Object.freeze(parsed);
}
function parseHeadingPath(value, label) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new TypeError(`${label} must contain at most 32 heading components.`);
  }
  return Object.freeze(value.map((entry, index) => bridgeString(entry, `${label}[${index}]`, 4096)));
}
function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Commitment input contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const input = value;
    return `{${Object.keys(input).toSorted().map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`;
  }
  throw new TypeError("Commitment input must be JSON-compatible.");
}
function sha2562(value) {
  return createHash2("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
function requireSha256(value, label) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new TypeError(`${label} must be 64 lowercase hexadecimal characters.`);
  }
  return value;
}
function parseMetadataFilter(value, label) {
  const input = record(value, label);
  strictKeys(input, ["kind", "path", "value"], label);
  const path = boundedString(input.path, `${label}.path`, 2048);
  if (input.kind === "exists") {
    if (input.value !== undefined)
      throw new TypeError(`${label}.value is forbidden for exists.`);
    return Object.freeze({ kind: "exists", path });
  }
  if (input.kind !== "equals")
    throw new TypeError(`${label}.kind must be equals or exists.`);
  const filterValue = input.value;
  if (filterValue !== null && typeof filterValue !== "boolean" && typeof filterValue !== "number" && typeof filterValue !== "string")
    throw new TypeError(`${label}.value must be a JSON scalar.`);
  if (typeof filterValue === "number" && !Number.isFinite(filterValue)) {
    throw new TypeError(`${label}.value must be finite.`);
  }
  return Object.freeze({
    kind: "equals",
    path,
    value: typeof filterValue === "string" ? boundedString(filterValue, `${label}.value`) : filterValue
  });
}
function parseRetrievalInputsV2(value, label) {
  const input = record(value, label);
  strictKeys(input, ["context", "graph", "history", "metadata", "noteId", "text"], label);
  const text = boundedString(input.text, `${label}.text`);
  const noteId = input.noteId === undefined ? undefined : confinedPath(input.noteId, `${label}.noteId`);
  let metadata;
  if (input.metadata !== undefined) {
    const metadataInput = record(input.metadata, `${label}.metadata`);
    strictKeys(metadataInput, ["filters", "tags"], `${label}.metadata`);
    if (!Array.isArray(metadataInput.filters) || metadataInput.filters.length > 32) {
      throw new TypeError(`${label}.metadata.filters must have at most 32 entries.`);
    }
    const filters = metadataInput.filters.map((entry, index) => parseMetadataFilter(entry, `${label}.metadata.filters[${index}]`));
    const filterKeys = filters.map(canonicalJson);
    if (new Set(filterKeys).size !== filterKeys.length) {
      throw new TypeError(`${label}.metadata.filters must not contain duplicates.`);
    }
    if (filterKeys.some((entry, index) => entry !== filterKeys.toSorted()[index])) {
      throw new TypeError(`${label}.metadata.filters must be in canonical order.`);
    }
    const tags = stringList(metadataInput.tags, `${label}.metadata.tags`, {
      allowEmpty: true,
      canonical: true,
      maximum: 32
    });
    if (filters.length === 0 && tags.length === 0) {
      throw new TypeError(`${label}.metadata must contain at least one filter or tag.`);
    }
    metadata = Object.freeze({ filters: Object.freeze(filters), tags });
  }
  let graph;
  if (input.graph !== undefined) {
    const graphInput = record(input.graph, `${label}.graph`);
    strictKeys(graphInput, ["depth", "seeds"], `${label}.graph`);
    const rawSeeds = stringList(graphInput.seeds, `${label}.graph.seeds`, {
      canonical: true,
      maximum: 20
    });
    const seeds = rawSeeds.map((seed, index) => confinedPath(seed, `${label}.graph.seeds[${index}]`));
    if (graphInput.depth !== 1 && graphInput.depth !== 2) {
      throw new TypeError(`${label}.graph.depth must be 1 or 2.`);
    }
    graph = Object.freeze({ depth: graphInput.depth, seeds: Object.freeze(seeds) });
  }
  let context;
  if (input.context !== undefined) {
    const contextInput = record(input.context, `${label}.context`);
    strictKeys(contextInput, ["repositoryPath"], `${label}.context`);
    context = Object.freeze({
      repositoryPath: confinedPath(contextInput.repositoryPath, `${label}.context.repositoryPath`, true)
    });
  }
  let history;
  if (input.history !== undefined) {
    const historyInput = record(input.history, `${label}.history`);
    strictKeys(historyInput, ["noteIds", "query"], `${label}.history`);
    const rawNoteIds = stringList(historyInput.noteIds, `${label}.history.noteIds`, {
      allowEmpty: true,
      canonical: true,
      maximum: 100
    });
    const noteIds = rawNoteIds.map((id, index) => confinedPath(id, `${label}.history.noteIds[${index}]`));
    history = Object.freeze({
      query: boundedString(historyInput.query, `${label}.history.query`, 2048),
      noteIds: Object.freeze(noteIds)
    });
  }
  return Object.freeze({
    text,
    ...context === undefined ? {} : { context },
    ...graph === undefined ? {} : { graph },
    ...history === undefined ? {} : { history },
    ...metadata === undefined ? {} : { metadata },
    ...noteId === undefined ? {} : { noteId }
  });
}
function inputLanes(inputs) {
  return Object.freeze([
    ...inputs.context === undefined ? [] : ["context"],
    ...inputs.graph === undefined ? [] : ["graph"],
    ...inputs.history === undefined ? [] : ["history"],
    ...inputs.metadata === undefined ? [] : ["metadata"],
    ...inputs.noteId === undefined ? [] : ["noteId"],
    "text"
  ].toSorted());
}
function parseInputOrigins(value, inputs, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    throw new TypeError(`${label} must contain from 1 through 6 entries.`);
  }
  const origins = value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const input = record(entry, itemLabel);
    strictKeys(input, ["lane", "origin"], itemLabel);
    if (input.lane !== "context" && input.lane !== "graph" && input.lane !== "history" && input.lane !== "metadata" && input.lane !== "noteId" && input.lane !== "text")
      throw new TypeError(`${itemLabel}.lane is invalid.`);
    if (input.origin !== "caller" && input.origin !== "query-text") {
      throw new TypeError(`${itemLabel}.origin must be caller or query-text.`);
    }
    if (input.lane === "text" && input.origin !== "query-text") {
      throw new TypeError(`${itemLabel} must declare query-text for the text lane.`);
    }
    if (input.lane !== "text" && input.origin !== "caller") {
      throw new TypeError(`${itemLabel} must declare caller for a structured lane.`);
    }
    return Object.freeze({ lane: input.lane, origin: input.origin });
  });
  assertCanonicalOrder(origins, ({ lane }) => lane, label);
  const expected = inputLanes(inputs);
  const actual = origins.map(({ lane }) => lane);
  if (expected.length !== actual.length || expected.some((lane, index) => lane !== actual[index]))
    throw new TypeError(`${label} must declare exactly the executable input lanes.`);
  return Object.freeze(origins);
}
function validateCohortInputs(cohort, inputs, label) {
  const structured = inputLanes(inputs).filter((lane) => lane !== "text");
  if (cohort === "text-only" && structured.length > 0) {
    throw new TypeError(`${label} text-only queries may expose only inputs.text.`);
  }
  if (cohort === "caller-seeded" && structured.length === 0) {
    throw new TypeError(`${label} caller-seeded queries require a structured executable lane.`);
  }
}
function validatePrimaryLaneInput(lane, inputs, label) {
  const present = lane === "metadata" ? inputs.metadata !== undefined : lane === "graph" ? inputs.graph !== undefined : lane === "path-context" ? inputs.context !== undefined : lane === "git" ? inputs.history !== undefined : lane === "note" ? inputs.noteId !== undefined : true;
  if (!present)
    throw new TypeError(`${label} primary lane ${lane} has no executable input.`);
}
function parseSourceFamily(value, index) {
  const label = `sourceFamilies[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["familyAssignmentSha256", "id", "sourceClass", "trustClass"], label);
  if (input.sourceClass !== "authored-note" && input.sourceClass !== "captured-source" && input.sourceClass !== "git-history" && input.sourceClass !== "repository-file")
    throw new TypeError(`${label}.sourceClass is invalid.`);
  if (typeof input.trustClass !== "string" || !trustClasses.has(input.trustClass)) {
    throw new TypeError(`${label}.trustClass is invalid.`);
  }
  const compatibleTrust = EVALUATION_SOURCE_TRUST_COMPATIBILITY_V2[input.sourceClass];
  if (!compatibleTrust.includes(input.trustClass)) {
    throw new TypeError(`${label} sourceClass and trustClass are incompatible.`);
  }
  return Object.freeze({
    id: boundedString(input.id, `${label}.id`, 256),
    sourceClass: input.sourceClass,
    trustClass: input.trustClass,
    ...input.familyAssignmentSha256 === undefined ? {} : {
      familyAssignmentSha256: requireSha256(input.familyAssignmentSha256, `${label}.familyAssignmentSha256`)
    }
  });
}
function parseDocument2(value, index) {
  const label = `documents[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["id", "sourceFamilyId", "sourcePath", "trustClass"], label);
  if (typeof input.trustClass !== "string" || !trustClasses.has(input.trustClass)) {
    throw new TypeError(`${label}.trustClass is invalid.`);
  }
  return Object.freeze({
    id: confinedPath(input.id, `${label}.id`),
    sourcePath: confinedPath(input.sourcePath, `${label}.sourcePath`),
    sourceFamilyId: boundedString(input.sourceFamilyId, `${label}.sourceFamilyId`, 256),
    trustClass: input.trustClass
  });
}
function parseLineRange(value, label) {
  const input = record(value, label);
  strictKeys(input, ["end", "start"], label);
  const start = safeInteger(input.start, `${label}.start`, 1, 1e7);
  const end = safeInteger(input.end, `${label}.end`, 1, 1e7);
  if (end < start)
    throw new TypeError(`${label}.end must not precede start.`);
  return Object.freeze({ start, end });
}
function parseEvidenceUnit(value, index) {
  const label = `evidenceUnits[${index}]`;
  const input = record(value, label);
  strictKeys(input, [
    "documentId",
    "headingPath",
    "id",
    "lineRange",
    "sourceFamilyId",
    "sourcePage",
    "sourcePath",
    "trustClass"
  ], label);
  if (typeof input.trustClass !== "string" || !trustClasses.has(input.trustClass)) {
    throw new TypeError(`${label}.trustClass is invalid.`);
  }
  const sourcePage = input.sourcePage === undefined ? undefined : safeInteger(input.sourcePage, `${label}.sourcePage`, 1, 1e6);
  return Object.freeze({
    id: evidenceUnitId(input.id, `${label}.id`),
    documentId: confinedPath(input.documentId, `${label}.documentId`),
    sourceFamilyId: boundedString(input.sourceFamilyId, `${label}.sourceFamilyId`, 256),
    trustClass: input.trustClass,
    sourcePath: confinedPath(input.sourcePath, `${label}.sourcePath`),
    lineRange: parseLineRange(input.lineRange, `${label}.lineRange`),
    headingPath: parseHeadingPath(input.headingPath, `${label}.headingPath`),
    ...sourcePage === undefined ? {} : { sourcePage }
  });
}
function parseRelevance(value, label) {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
    throw new TypeError(`${label} must be an integer from 0 through 3.`);
  }
  return value;
}
function parseDocumentJudgments(value, label) {
  if (!Array.isArray(value) || value.length > MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY) {
    throw new TypeError(`${label} must have at most ${MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY} entries.`);
  }
  const judgments = value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const input = record(entry, itemLabel);
    strictKeys(input, ["documentId", "relevance"], itemLabel);
    return Object.freeze({
      documentId: confinedPath(input.documentId, `${itemLabel}.documentId`),
      relevance: parseRelevance(input.relevance, `${itemLabel}.relevance`)
    });
  });
  assertCanonicalOrder(judgments, ({ documentId }) => documentId, label);
  return Object.freeze(judgments);
}
function parseEvidenceUnitJudgments(value, label) {
  if (!Array.isArray(value) || value.length > MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY) {
    throw new TypeError(`${label} must have at most ${MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY} entries.`);
  }
  const judgments = value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const input = record(entry, itemLabel);
    strictKeys(input, ["evidenceUnitId", "relevance"], itemLabel);
    return Object.freeze({
      evidenceUnitId: evidenceUnitId(input.evidenceUnitId, `${itemLabel}.evidenceUnitId`),
      relevance: parseRelevance(input.relevance, `${itemLabel}.relevance`)
    });
  });
  assertCanonicalOrder(judgments, ({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2, label);
  return Object.freeze(judgments);
}
function parseNuggets(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_EVALUATION_V2_NUGGETS_PER_QUERY) {
    throw new TypeError(`${label} must contain from 1 through ${MAX_EVALUATION_V2_NUGGETS_PER_QUERY} entries.`);
  }
  const nuggets = value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const input = record(entry, itemLabel);
    strictKeys(input, ["acceptableSupportSets", "id", "required", "text"], itemLabel);
    if (typeof input.required !== "boolean") {
      throw new TypeError(`${itemLabel}.required must be boolean.`);
    }
    if (!Array.isArray(input.acceptableSupportSets) || input.acceptableSupportSets.length > MAX_EVALUATION_V2_SUPPORT_SETS_PER_NUGGET) {
      throw new TypeError(`${itemLabel}.acceptableSupportSets must have at most ${MAX_EVALUATION_V2_SUPPORT_SETS_PER_NUGGET} entries.`);
    }
    const acceptableSupportSets = input.acceptableSupportSets.map((supportEntry, supportIndex) => {
      const supportLabel = `${itemLabel}.acceptableSupportSets[${supportIndex}]`;
      const supportInput = record(supportEntry, supportLabel);
      strictKeys(supportInput, ["evidenceUnitIds", "id"], supportLabel);
      return Object.freeze({
        id: boundedString(supportInput.id, `${supportLabel}.id`, 256),
        evidenceUnitIds: Object.freeze(stringList(supportInput.evidenceUnitIds, `${supportLabel}.evidenceUnitIds`, { canonical: true, maximum: 100 }).map((id, evidenceIndex) => evidenceUnitId(id, `${supportLabel}.evidenceUnitIds[${evidenceIndex}]`)))
      });
    });
    assertCanonicalOrder(acceptableSupportSets, ({ id }) => id, `${itemLabel}.acceptableSupportSets`);
    return Object.freeze({
      id: boundedString(input.id, `${itemLabel}.id`, 256),
      text: boundedString(input.text, `${itemLabel}.text`, 4096),
      required: input.required,
      acceptableSupportSets: Object.freeze(acceptableSupportSets)
    });
  });
  assertCanonicalOrder(nuggets, ({ id }) => id, label);
  if (!nuggets.some(({ required }) => required)) {
    throw new TypeError(`${label} must contain at least one required nugget.`);
  }
  return Object.freeze(nuggets);
}
function parseGold(value, label) {
  const input = record(value, label);
  strictKeys(input, ["documents", "evidenceUnits", "nuggets"], label);
  return Object.freeze({
    documents: parseDocumentJudgments(input.documents, `${label}.documents`),
    evidenceUnits: parseEvidenceUnitJudgments(input.evidenceUnits, `${label}.evidenceUnits`),
    nuggets: parseNuggets(input.nuggets, `${label}.nuggets`)
  });
}
function parseRawAssessments(value, queryIndex, finalNuggets) {
  const label = `queries[${queryIndex}].rawAssessments`;
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new TypeError(`${label} must contain from 1 through 10 entries.`);
  }
  const assessments = value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    const input = record(entry, itemLabel);
    strictKeys(input, ["assessorId", "documents", "evidenceUnits", "expectedSupport", "nuggets"], itemLabel);
    if (input.expectedSupport !== "supported" && input.expectedSupport !== "insufficient") {
      throw new TypeError(`${itemLabel}.expectedSupport must be insufficient or supported.`);
    }
    if (!Array.isArray(input.nuggets) || input.nuggets.length > MAX_EVALUATION_V2_NUGGETS_PER_QUERY) {
      throw new TypeError(`${itemLabel}.nuggets has too many entries.`);
    }
    const nuggets = input.nuggets.map((nuggetEntry, nuggetIndex) => {
      const nuggetLabel = `${itemLabel}.nuggets[${nuggetIndex}]`;
      const nuggetInput = record(nuggetEntry, nuggetLabel);
      strictKeys(nuggetInput, ["acceptableSupportSetIds", "nuggetId", "required"], nuggetLabel);
      const nuggetId = boundedString(nuggetInput.nuggetId, `${nuggetLabel}.nuggetId`, 256);
      const finalRequired = finalNuggets.find(({ id }) => id === nuggetId)?.required;
      if (nuggetInput.required !== undefined && typeof nuggetInput.required !== "boolean") {
        throw new TypeError(`${nuggetLabel}.required must be boolean.`);
      }
      return Object.freeze({
        nuggetId,
        required: nuggetInput.required ?? finalRequired ?? true,
        acceptableSupportSetIds: stringList(nuggetInput.acceptableSupportSetIds, `${nuggetLabel}.acceptableSupportSetIds`, { allowEmpty: true, canonical: true, maximum: MAX_EVALUATION_V2_SUPPORT_SETS_PER_NUGGET })
      });
    });
    assertCanonicalOrder(nuggets, ({ nuggetId }) => nuggetId, `${itemLabel}.nuggets`);
    return Object.freeze({
      assessorId: boundedString(input.assessorId, `${itemLabel}.assessorId`, 256),
      expectedSupport: input.expectedSupport,
      documents: parseDocumentJudgments(input.documents, `${itemLabel}.documents`),
      evidenceUnits: parseEvidenceUnitJudgments(input.evidenceUnits, `${itemLabel}.evidenceUnits`),
      nuggets: Object.freeze(nuggets)
    });
  });
  assertCanonicalOrder(assessments, ({ assessorId }) => assessorId, label);
  return Object.freeze(assessments);
}
function parseAdjudication(value, queryIndex) {
  const label = `queries[${queryIndex}].adjudication`;
  const input = record(value, label);
  strictKeys(input, ["adjudicatorId", "rationale", "status"], label);
  if (input.status === "single-assessor" || input.status === "agreed") {
    if (input.adjudicatorId !== undefined || input.rationale !== undefined) {
      throw new TypeError(`${label} may name an adjudicator only when status is resolved.`);
    }
    return Object.freeze({ status: input.status });
  }
  if (input.status !== "resolved") {
    throw new TypeError(`${label}.status must be agreed, resolved, or single-assessor.`);
  }
  return Object.freeze({
    status: "resolved",
    adjudicatorId: boundedString(input.adjudicatorId, `${label}.adjudicatorId`, 256),
    rationale: boundedString(input.rationale, `${label}.rationale`, 4096)
  });
}
function finalNuggetRows(gold) {
  return Object.freeze(gold.nuggets.map((nugget) => Object.freeze({
    nuggetId: nugget.id,
    required: nugget.required,
    acceptableSupportSetIds: Object.freeze(nugget.acceptableSupportSets.map(({ id }) => id))
  })));
}
function judgmentSignature(judgment) {
  return canonicalJson(judgment);
}
function finalJudgmentSignature(query) {
  return judgmentSignature({
    expectedSupport: query.expectedSupport,
    documents: query.gold.documents,
    evidenceUnits: query.gold.evidenceUnits,
    nuggets: finalNuggetRows(query.gold)
  });
}
function rawJudgmentSignature(judgment) {
  return judgmentSignature({
    expectedSupport: judgment.expectedSupport,
    documents: judgment.documents,
    evidenceUnits: judgment.evidenceUnits,
    nuggets: judgment.nuggets
  });
}
function hasCompleteSupport(expectedSupportSets, selectedSupportSetIds, evidenceGrades) {
  return expectedSupportSets.some((supportSet) => selectedSupportSetIds.has(supportSet.id) && supportSet.evidenceUnitIds.every((id) => (evidenceGrades.get(id) ?? 0) > 0));
}
function hasCompleteRequiredNuggetCoverage(nuggets, selected, evidenceGrades) {
  return nuggets.filter(({ required }) => required).every((nugget) => hasCompleteSupport(nugget.acceptableSupportSets, selected.get(nugget.id) ?? new Set, evidenceGrades));
}
function validateGoldReferences(query, documents, evidenceUnits, assessorIds, label) {
  const documentGrades = new Map(query.gold.documents.map((row) => [row.documentId, row.relevance]));
  const evidenceGrades = new Map(query.gold.evidenceUnits.map((row) => [row.evidenceUnitId, row.relevance]));
  for (const row of query.gold.documents) {
    if (!documents.has(row.documentId)) {
      throw new TypeError(`${label}.gold.documents references unknown document ${row.documentId}.`);
    }
  }
  for (const row of query.gold.evidenceUnits) {
    const unit = evidenceUnits.get(row.evidenceUnitId);
    if (unit === undefined) {
      throw new TypeError(`${label}.gold.evidenceUnits references unknown unit ${row.evidenceUnitId}.`);
    }
    if (!documentGrades.has(unit.documentId)) {
      throw new TypeError(`${label}.gold must judge the document containing ${row.evidenceUnitId}.`);
    }
    if (row.relevance > 0 && (documentGrades.get(unit.documentId) ?? 0) === 0) {
      throw new TypeError(`${label}.gold cannot place relevant evidence in an irrelevant document.`);
    }
  }
  const supportSetIds = new Set;
  for (const nugget of query.gold.nuggets) {
    for (const supportSet of nugget.acceptableSupportSets) {
      if (supportSetIds.has(supportSet.id)) {
        throw new TypeError(`${label}.gold support-set IDs must be unique across nuggets.`);
      }
      supportSetIds.add(supportSet.id);
      for (const unitId2 of supportSet.evidenceUnitIds) {
        if (!evidenceUnits.has(unitId2)) {
          throw new TypeError(`${label}.gold support set references unknown unit ${unitId2}.`);
        }
        if ((evidenceGrades.get(unitId2) ?? 0) === 0) {
          throw new TypeError(`${label}.gold support set ${supportSet.id} must use positively judged units.`);
        }
      }
    }
  }
  const finalSelection = new Map(finalNuggetRows(query.gold).map((row) => [
    row.nuggetId,
    new Set(row.acceptableSupportSetIds)
  ]));
  const complete = hasCompleteRequiredNuggetCoverage(query.gold.nuggets, finalSelection, evidenceGrades);
  if (query.expectedSupport === "supported" && !complete) {
    throw new TypeError(`${label} is supported but has no complete acceptable support for every required nugget.`);
  }
  if (query.expectedSupport === "insufficient" && complete) {
    throw new TypeError(`${label} is insufficient but contains complete acceptable support for all required nuggets.`);
  }
  if (query.expectedSupport === "supported" && query.negativeSubtype !== undefined) {
    throw new TypeError(`${label}.negativeSubtype is forbidden for supported queries.`);
  }
  if (query.expectedSupport === "insufficient" && query.negativeSubtype === undefined) {
    throw new TypeError(`${label}.negativeSubtype is required for insufficient queries.`);
  }
  const finalSignature = finalJudgmentSignature(query);
  const rawSignatures = query.rawAssessments.map(rawJudgmentSignature);
  for (const raw of query.rawAssessments) {
    if (!assessorIds.has(raw.assessorId)) {
      throw new TypeError(`${label}.rawAssessments names undeclared assessor ${raw.assessorId}.`);
    }
    if (canonicalJson(raw.documents.map(({ documentId }) => documentId)) !== canonicalJson(query.gold.documents.map(({ documentId }) => documentId))) {
      throw new TypeError(`${label} raw assessors must judge the complete final document pool.`);
    }
    if (canonicalJson(raw.evidenceUnits.map(({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2)) !== canonicalJson(query.gold.evidenceUnits.map(({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2))) {
      throw new TypeError(`${label} raw assessors must judge the complete final evidence-unit pool.`);
    }
    if (canonicalJson(raw.nuggets.map(({ nuggetId }) => nuggetId)) !== canonicalJson(query.gold.nuggets.map(({ id }) => id))) {
      throw new TypeError(`${label} raw assessors must judge every final nugget.`);
    }
    const rawEvidenceGrades = new Map(raw.evidenceUnits.map((row) => [row.evidenceUnitId, row.relevance]));
    if (!raw.nuggets.some(({ required }) => required)) {
      throw new TypeError(`${label} raw assessments must require at least one final nugget.`);
    }
    const rawSelection = new Map(raw.nuggets.map((row) => [
      row.nuggetId,
      new Set(row.acceptableSupportSetIds)
    ]));
    for (const row of raw.nuggets) {
      const nugget = query.gold.nuggets.find(({ id }) => id === row.nuggetId);
      const allowed = new Set(nugget?.acceptableSupportSets.map(({ id }) => id) ?? []);
      for (const id of row.acceptableSupportSetIds) {
        if (!allowed.has(id)) {
          throw new TypeError(`${label} raw assessment references unknown support set ${id}.`);
        }
      }
    }
    const rawRequiredNuggets = query.gold.nuggets.map((nugget) => Object.freeze({
      ...nugget,
      required: raw.nuggets.find(({ nuggetId }) => nuggetId === nugget.id)?.required ?? nugget.required
    }));
    const rawComplete = hasCompleteRequiredNuggetCoverage(rawRequiredNuggets, rawSelection, rawEvidenceGrades);
    if (raw.expectedSupport === "supported" !== rawComplete) {
      throw new TypeError(`${label} raw assessment support state contradicts its support-set coverage.`);
    }
  }
  const distinct = new Set(rawSignatures);
  if (query.rawAssessments.length === 1) {
    if (query.adjudication.status !== "single-assessor" || rawSignatures[0] !== finalSignature) {
      throw new TypeError(`${label} single assessment requires explicit single-assessor adjudication and matching final gold.`);
    }
    return;
  }
  if (distinct.size === 1) {
    if (query.adjudication.status !== "agreed" || rawSignatures[0] !== finalSignature) {
      throw new TypeError(`${label} matching independent assessments require explicit agreed adjudication and matching final gold.`);
    }
    return;
  }
  if (query.adjudication.status !== "resolved") {
    throw new TypeError(`${label} assessment disagreement requires explicit resolved adjudication.`);
  }
  if (!assessorIds.has(query.adjudication.adjudicatorId)) {
    throw new TypeError(`${label}.adjudication.adjudicatorId must name a declared assessor.`);
  }
}
function parseQuery(value, index) {
  const label = `queries[${index}]`;
  const input = record(value, label);
  strictKeys(input, [
    "adjudication",
    "cohort",
    "expectedSupport",
    "gold",
    "id",
    "inputOrigins",
    "inputs",
    "negativeSubtype",
    "primaryLane",
    "primaryStratum",
    "rawAssessments",
    "split",
    "strata",
    "text"
  ], label);
  if (input.split !== "development" && input.split !== "test") {
    throw new TypeError(`${label}.split must be development or test.`);
  }
  if (input.cohort !== "caller-seeded" && input.cohort !== "text-only") {
    throw new TypeError(`${label}.cohort must be caller-seeded or text-only.`);
  }
  if (input.expectedSupport !== "supported" && input.expectedSupport !== "insufficient") {
    throw new TypeError(`${label}.expectedSupport must be insufficient or supported.`);
  }
  if (typeof input.primaryLane !== "string" || !lanes.has(input.primaryLane)) {
    throw new TypeError(`${label}.primaryLane is invalid.`);
  }
  const negativeSubtype = input.negativeSubtype;
  if (negativeSubtype !== undefined && negativeSubtype !== "boundary-near-miss" && negativeSubtype !== "conflicting-evidence" && negativeSubtype !== "missing-required-support" && negativeSubtype !== "stale-only" && negativeSubtype !== "topical-near-miss" && negativeSubtype !== "unknown-entity")
    throw new TypeError(`${label}.negativeSubtype is invalid.`);
  if (!Array.isArray(input.strata) || input.strata.length < 1 || input.strata.length > strata.size) {
    throw new TypeError(`${label}.strata must be a non-empty bounded array.`);
  }
  const parsedStrata = input.strata.map((entry, stratumIndex) => {
    if (typeof entry !== "string" || !strata.has(entry)) {
      throw new TypeError(`${label}.strata[${stratumIndex}] is invalid.`);
    }
    return entry;
  });
  if (new Set(parsedStrata).size !== parsedStrata.length) {
    throw new TypeError(`${label}.strata must not contain duplicates.`);
  }
  const sortedStrata = parsedStrata.toSorted();
  if (parsedStrata.some((entry, stratumIndex) => entry !== sortedStrata[stratumIndex])) {
    throw new TypeError(`${label}.strata must be in canonical order.`);
  }
  if (typeof input.primaryStratum !== "string" || !strata.has(input.primaryStratum) || !parsedStrata.includes(input.primaryStratum)) {
    throw new TypeError(`${label}.primaryStratum must name one of the query strata.`);
  }
  const inputs = parseRetrievalInputsV2(input.inputs, `${label}.inputs`);
  validateCohortInputs(input.cohort, inputs, label);
  validatePrimaryLaneInput(input.primaryLane, inputs, label);
  const gold = parseGold(input.gold, `${label}.gold`);
  return Object.freeze({
    id: boundedString(input.id, `${label}.id`, 256),
    text: boundedString(input.text, `${label}.text`),
    split: input.split,
    cohort: input.cohort,
    strata: Object.freeze(parsedStrata),
    primaryStratum: input.primaryStratum,
    expectedSupport: input.expectedSupport,
    primaryLane: input.primaryLane,
    ...negativeSubtype === undefined ? {} : { negativeSubtype },
    inputs,
    inputOrigins: parseInputOrigins(input.inputOrigins, inputs, `${label}.inputOrigins`),
    gold,
    rawAssessments: parseRawAssessments(input.rawAssessments, index, gold.nuggets),
    adjudication: parseAdjudication(input.adjudication, index)
  });
}
function parseAssessor(value, index) {
  const label = `assessment.assessors[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["affiliation", "displayName", "id"], label);
  const displayName = optionalBoundedString(input.displayName, `${label}.displayName`);
  const affiliation = optionalBoundedString(input.affiliation, `${label}.affiliation`);
  return Object.freeze({
    id: canonicalId(input.id, `${label}.id`),
    ...displayName === undefined ? {} : { displayName },
    ...affiliation === undefined ? {} : { affiliation }
  });
}
function parseMeasurementProfile(value, index) {
  const label = `measurementProfiles[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["cacheState", "concurrency", "id", "operation", "repetitions", "scope"], label);
  if (input.operation !== "cold-index" && input.operation !== "four-reader-query" && input.operation !== "incremental-update" && input.operation !== "packing" && input.operation !== "warm-query")
    throw new TypeError(`${label}.operation is invalid.`);
  if (input.scope !== "query" && input.scope !== "retriever") {
    throw new TypeError(`${label}.scope must be query or retriever.`);
  }
  if (input.cacheState !== "changed-generation" && input.cacheState !== "cold" && input.cacheState !== "not-applicable" && input.cacheState !== "warm")
    throw new TypeError(`${label}.cacheState is invalid.`);
  const concurrency = safeInteger(input.concurrency, `${label}.concurrency`, 1, 64);
  const repetitions = safeInteger(input.repetitions, `${label}.repetitions`, 1, 100);
  const expected = {
    "cold-index": { scope: "retriever", cacheState: "cold", concurrency: 1 },
    "four-reader-query": { scope: "query", cacheState: "warm", concurrency: 4 },
    "incremental-update": { scope: "retriever", cacheState: "changed-generation", concurrency: 1 },
    packing: { scope: "query", cacheState: "warm", concurrency: 1 },
    "warm-query": { scope: "query", cacheState: "warm", concurrency: 1 }
  };
  const required = expected[input.operation];
  if (input.scope !== required.scope || input.cacheState !== required.cacheState || concurrency !== required.concurrency) {
    throw new TypeError(`${label} does not match the fixed ${input.operation} operation profile.`);
  }
  return Object.freeze({
    id: canonicalId(input.id, `${label}.id`),
    operation: input.operation,
    scope: input.scope,
    cacheState: input.cacheState,
    concurrency,
    repetitions
  });
}
function parseExperiment(value) {
  const input = record(value, "experiment");
  strictKeys(input, ["environment", "protocol"], "experiment");
  const protocolInput = record(input.protocol, "experiment.protocol");
  strictKeys(protocolInput, ["contextCeilings", "minimumUsefulEffects", "nonInferiorityMargins", "pairedPower"], "experiment.protocol");
  if (!Array.isArray(protocolInput.minimumUsefulEffects) || protocolInput.minimumUsefulEffects.length < 1 || protocolInput.minimumUsefulEffects.length > minimumUsefulEffectMetrics.size * 2) {
    throw new TypeError("experiment.protocol.minimumUsefulEffects must be a non-empty bounded array.");
  }
  const minimumUsefulEffects = protocolInput.minimumUsefulEffects.map((entry, index) => {
    const label = `experiment.protocol.minimumUsefulEffects[${index}]`;
    const effectInput = record(entry, label);
    strictKeys(effectInput, ["cohort", "metric", "minimumAbsoluteDifference"], label);
    if (typeof effectInput.metric !== "string" || !minimumUsefulEffectMetrics.has(effectInput.metric))
      throw new TypeError(`${label}.metric is invalid.`);
    if (effectInput.cohort !== "caller-seeded" && effectInput.cohort !== "text-only") {
      throw new TypeError(`${label}.cohort must be caller-seeded or text-only.`);
    }
    const minimumAbsoluteDifference = positiveNumber(effectInput.minimumAbsoluteDifference, `${label}.minimumAbsoluteDifference`);
    if (minimumAbsoluteDifference > 1) {
      throw new TypeError(`${label}.minimumAbsoluteDifference must not exceed one.`);
    }
    return Object.freeze({
      metric: effectInput.metric,
      cohort: effectInput.cohort,
      minimumAbsoluteDifference
    });
  });
  assertCanonicalOrder(minimumUsefulEffects, ({ metric, cohort }) => `${metric}:${cohort}`, "experiment.protocol.minimumUsefulEffects");
  if (!Array.isArray(protocolInput.nonInferiorityMargins) || protocolInput.nonInferiorityMargins.length < 1 || protocolInput.nonInferiorityMargins.length > nonInferiorityMetrics.size) {
    throw new TypeError("experiment.protocol.nonInferiorityMargins must be a non-empty bounded array.");
  }
  const nonInferiorityMargins = protocolInput.nonInferiorityMargins.map((entry, index) => {
    const label = `experiment.protocol.nonInferiorityMargins[${index}]`;
    const marginInput = record(entry, label);
    strictKeys(marginInput, ["maximumAbsoluteRegression", "maximumRelativeRegression", "metric"], label);
    if (typeof marginInput.metric !== "string" || !nonInferiorityMetrics.has(marginInput.metric))
      throw new TypeError(`${label}.metric is invalid.`);
    const maximumAbsoluteRegression = nonnegativeNumber(marginInput.maximumAbsoluteRegression, `${label}.maximumAbsoluteRegression`);
    const maximumRelativeRegression = nonnegativeNumber(marginInput.maximumRelativeRegression, `${label}.maximumRelativeRegression`);
    const boundedQuality = !marginInput.metric.endsWith("-p95-ms");
    if (boundedQuality && maximumAbsoluteRegression > 1) {
      throw new TypeError(`${label}.maximumAbsoluteRegression must not exceed one for quality metrics.`);
    }
    if (maximumRelativeRegression > 10) {
      throw new TypeError(`${label}.maximumRelativeRegression must not exceed ten.`);
    }
    if (!boundedQuality && maximumAbsoluteRegression === 0 && maximumRelativeRegression === 0) {
      throw new TypeError(`${label} must declare a non-zero latency margin.`);
    }
    return Object.freeze({
      metric: marginInput.metric,
      maximumAbsoluteRegression,
      maximumRelativeRegression
    });
  });
  assertCanonicalOrder(nonInferiorityMargins, ({ metric }) => metric, "experiment.protocol.nonInferiorityMargins");
  const pairedPowerInput = record(protocolInput.pairedPower, "experiment.protocol.pairedPower");
  strictKeys(pairedPowerInput, [
    "alpha",
    "assumedDiscordantRate",
    "assumedEffect",
    "minimumUsefulEffect",
    "requiredPairs",
    "targetPower"
  ], "experiment.protocol.pairedPower");
  const pairedPowerWithoutCount = Object.freeze({
    alpha: positiveNumber(pairedPowerInput.alpha, "experiment.protocol.pairedPower.alpha"),
    targetPower: positiveNumber(pairedPowerInput.targetPower, "experiment.protocol.pairedPower.targetPower"),
    assumedDiscordantRate: positiveNumber(pairedPowerInput.assumedDiscordantRate, "experiment.protocol.pairedPower.assumedDiscordantRate"),
    assumedEffect: positiveNumber(pairedPowerInput.assumedEffect, "experiment.protocol.pairedPower.assumedEffect"),
    minimumUsefulEffect: nonnegativeNumber(pairedPowerInput.minimumUsefulEffect, "experiment.protocol.pairedPower.minimumUsefulEffect")
  });
  const expectedRequiredPairs = requiredPairedObservationsV2(pairedPowerWithoutCount);
  const requiredPairs = safeInteger(pairedPowerInput.requiredPairs, "experiment.protocol.pairedPower.requiredPairs", 1, MAX_EVALUATION_V2_QUERIES);
  if (requiredPairs !== expectedRequiredPairs) {
    throw new TypeError(`experiment.protocol.pairedPower.requiredPairs must equal the derived count ${expectedRequiredPairs}.`);
  }
  const pairedPower = Object.freeze({ ...pairedPowerWithoutCount, requiredPairs });
  const ceilingsInput = record(protocolInput.contextCeilings, "experiment.protocol.contextCeilings");
  strictKeys(ceilingsInput, ["readerTokens", "utf8Bytes"], "experiment.protocol.contextCeilings");
  const contextCeilings = Object.freeze({
    utf8Bytes: safeInteger(ceilingsInput.utf8Bytes, "experiment.protocol.contextCeilings.utf8Bytes", 1, 1e9),
    readerTokens: safeInteger(ceilingsInput.readerTokens, "experiment.protocol.contextCeilings.readerTokens", 1, 1e9)
  });
  const environmentInput = record(input.environment, "experiment.environment");
  strictKeys(environmentInput, [
    "cache",
    "fourReaderBatch",
    "hardware",
    "incrementalMutation",
    "localModel",
    "runtime",
    "tokenizer"
  ], "experiment.environment");
  const tokenizerInput = record(environmentInput.tokenizer, "experiment.environment.tokenizer");
  strictKeys(tokenizerInput, ["id", "sha256"], "experiment.environment.tokenizer");
  const runtimeInput = record(environmentInput.runtime, "experiment.environment.runtime");
  strictKeys(runtimeInput, ["id", "sha256"], "experiment.environment.runtime");
  const hardwareInput = record(environmentInput.hardware, "experiment.environment.hardware");
  strictKeys(hardwareInput, ["id"], "experiment.environment.hardware");
  const cacheInput = record(environmentInput.cache, "experiment.environment.cache");
  strictKeys(cacheInput, ["fingerprintSha256", "preparation"], "experiment.environment.cache");
  const fourReaderBatchInput = record(environmentInput.fourReaderBatch, "experiment.environment.fourReaderBatch");
  strictKeys(fourReaderBatchInput, ["id", "sha256"], "experiment.environment.fourReaderBatch");
  const incrementalMutationInput = record(environmentInput.incrementalMutation, "experiment.environment.incrementalMutation");
  strictKeys(incrementalMutationInput, ["appendUtf8Sha256", "expectedPostMutationSha256", "sourcePath"], "experiment.environment.incrementalMutation");
  const localModelInput = record(environmentInput.localModel, "experiment.environment.localModel");
  if (localModelInput.kind !== "none" && localModelInput.kind !== "model") {
    throw new TypeError("experiment.environment.localModel.kind must be model or none.");
  }
  strictKeys(localModelInput, localModelInput.kind === "none" ? ["kind"] : ["id", "kind", "sha256"], "experiment.environment.localModel");
  const localModel = localModelInput.kind === "none" ? Object.freeze({ kind: "none" }) : Object.freeze({
    kind: "model",
    id: bridgeString(localModelInput.id, "experiment.environment.localModel.id", 512),
    sha256: requireSha256(localModelInput.sha256, "experiment.environment.localModel.sha256")
  });
  return Object.freeze({
    protocol: Object.freeze({
      minimumUsefulEffects: Object.freeze(minimumUsefulEffects),
      nonInferiorityMargins: Object.freeze(nonInferiorityMargins),
      pairedPower,
      contextCeilings
    }),
    environment: Object.freeze({
      tokenizer: Object.freeze({
        id: bridgeString(tokenizerInput.id, "experiment.environment.tokenizer.id", 512),
        sha256: requireSha256(tokenizerInput.sha256, "experiment.environment.tokenizer.sha256")
      }),
      runtime: Object.freeze({
        id: bridgeString(runtimeInput.id, "experiment.environment.runtime.id", 512),
        sha256: requireSha256(runtimeInput.sha256, "experiment.environment.runtime.sha256")
      }),
      hardware: Object.freeze({
        id: bridgeString(hardwareInput.id, "experiment.environment.hardware.id", 1024)
      }),
      localModel,
      cache: Object.freeze({
        preparation: bridgeString(cacheInput.preparation, "experiment.environment.cache.preparation", 2048),
        fingerprintSha256: requireSha256(cacheInput.fingerprintSha256, "experiment.environment.cache.fingerprintSha256")
      }),
      fourReaderBatch: Object.freeze({
        id: bridgeString(fourReaderBatchInput.id, "experiment.environment.fourReaderBatch.id", 512),
        sha256: requireSha256(fourReaderBatchInput.sha256, "experiment.environment.fourReaderBatch.sha256")
      }),
      incrementalMutation: Object.freeze({
        sourcePath: confinedPath(incrementalMutationInput.sourcePath, "experiment.environment.incrementalMutation.sourcePath"),
        appendUtf8Sha256: requireSha256(incrementalMutationInput.appendUtf8Sha256, "experiment.environment.incrementalMutation.appendUtf8Sha256"),
        expectedPostMutationSha256: requireSha256(incrementalMutationInput.expectedPostMutationSha256, "experiment.environment.incrementalMutation.expectedPostMutationSha256")
      })
    })
  });
}
function parseConfiguration(value, label) {
  const input = record(value, label);
  if (Object.keys(input).length > 64)
    throw new TypeError(`${label} may have at most 64 fields.`);
  const output = {};
  for (const rawKey of Object.keys(input).toSorted()) {
    const key = canonicalId(rawKey, `${label} key`);
    const candidate = input[rawKey];
    if (candidate !== null && typeof candidate !== "boolean" && typeof candidate !== "number" && typeof candidate !== "string")
      throw new TypeError(`${label}.${key} must be a JSON scalar.`);
    if (typeof candidate === "number" && !Number.isFinite(candidate)) {
      throw new TypeError(`${label}.${key} must be finite.`);
    }
    output[key] = typeof candidate === "string" ? boundedString(candidate, `${label}.${key}`) : candidate;
  }
  return Object.freeze(output);
}
function parseRetrieverDescriptor(value, index) {
  const label = `retrievers[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["configuration", "id", "implementationSha256", "lanes", "role", "version"], label);
  if (input.role !== "ablation" && input.role !== "baseline" && input.role !== "candidate") {
    throw new TypeError(`${label}.role is invalid.`);
  }
  if (!Array.isArray(input.lanes) || input.lanes.length < 1 || input.lanes.length > lanes.size) {
    throw new TypeError(`${label}.lanes must be a non-empty bounded array.`);
  }
  const parsedLanes = input.lanes.map((lane, laneIndex) => {
    if (typeof lane !== "string" || !lanes.has(lane)) {
      throw new TypeError(`${label}.lanes[${laneIndex}] is invalid.`);
    }
    return lane;
  });
  const sortedLanes = parsedLanes.toSorted();
  if (new Set(parsedLanes).size !== parsedLanes.length || parsedLanes.some((lane, index2) => lane !== sortedLanes[index2])) {
    throw new TypeError(`${label}.lanes must be unique and in canonical order.`);
  }
  return Object.freeze({
    id: canonicalId(input.id, `${label}.id`),
    role: input.role,
    version: boundedString(input.version, `${label}.version`, 512),
    implementationSha256: requireSha256(input.implementationSha256, `${label}.implementationSha256`),
    lanes: Object.freeze(parsedLanes),
    configuration: parseConfiguration(input.configuration, `${label}.configuration`)
  });
}
function parseCandidateLock(value) {
  const label = "candidateLock";
  const input = record(value, label);
  strictKeys(input, ["baselineRetrieverId", "candidateRetrieverIds", "descriptorDigests"], label);
  const candidateRetrieverIds = stringList(input.candidateRetrieverIds, `${label}.candidateRetrieverIds`, {
    canonical: true,
    maximum: 32
  }).map((id, index) => canonicalId(id, `${label}.candidateRetrieverIds[${index}]`));
  if (!Array.isArray(input.descriptorDigests) || input.descriptorDigests.length < 1 || input.descriptorDigests.length > 64) {
    throw new TypeError(`${label}.descriptorDigests must contain from 1 through 64 entries.`);
  }
  const descriptorDigests = input.descriptorDigests.map((entry, index) => {
    const itemLabel = `${label}.descriptorDigests[${index}]`;
    const digestInput = record(entry, itemLabel);
    strictKeys(digestInput, ["retrieverId", "sha256"], itemLabel);
    return Object.freeze({
      retrieverId: canonicalId(digestInput.retrieverId, `${itemLabel}.retrieverId`),
      sha256: requireSha256(digestInput.sha256, `${itemLabel}.sha256`)
    });
  });
  assertCanonicalOrder(descriptorDigests, ({ retrieverId }) => retrieverId, `${label}.descriptorDigests`);
  return Object.freeze({
    baselineRetrieverId: canonicalId(input.baselineRetrieverId, `${label}.baselineRetrieverId`),
    candidateRetrieverIds: Object.freeze(candidateRetrieverIds),
    descriptorDigests: Object.freeze(descriptorDigests)
  });
}
function evaluationRetrieverDescriptorDigestV2(descriptor) {
  return sha2562(descriptor);
}
function evaluationCandidateLockDigestV2(lock) {
  return sha2562(lock);
}
function corpusCommitmentPayload(value) {
  return {
    schemaVersion: value.schemaVersion,
    id: value.id,
    description: value.description,
    manifest: {
      protocol: value.manifest.protocol,
      sealedAt: value.manifest.sealedAt,
      buildContractSha256: value.manifest.buildContractSha256
    },
    frozen: value.frozen,
    assessment: value.assessment,
    experiment: value.experiment,
    sourceFamilies: value.sourceFamilies,
    documents: value.documents,
    evidenceUnits: value.evidenceUnits,
    measurementProfiles: value.measurementProfiles,
    retrievers: value.retrievers,
    candidateLock: value.candidateLock,
    queries: value.queries
  };
}
function evaluationCorpusDigestV2(corpus) {
  return sha2562(corpusCommitmentPayload(corpus));
}
function evaluationCorpusGitBlobCommitmentV2(corpus, objectFormat = "sha1") {
  const bytes = Buffer.from(canonicalJson(corpus), "utf8");
  return createHash2(objectFormat).update(`blob ${bytes.byteLength}\x00`, "utf8").update(bytes).digest("hex");
}
function parseManifest(value) {
  const input = record(value, "manifest");
  strictKeys(input, ["buildContractSha256", "candidateLockSha256", "corpusSha256", "protocol", "sealedAt"], "manifest");
  if (input.protocol !== RETRIEVAL_EVALUATION_V2_PROTOCOL) {
    throw new TypeError(`manifest.protocol must be ${RETRIEVAL_EVALUATION_V2_PROTOCOL}.`);
  }
  const timestamp = new Date(input.sealedAt);
  if (typeof input.sealedAt !== "string" || Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== input.sealedAt) {
    throw new TypeError("manifest.sealedAt must be a canonical ISO timestamp.");
  }
  return Object.freeze({
    protocol: RETRIEVAL_EVALUATION_V2_PROTOCOL,
    sealedAt: input.sealedAt,
    corpusSha256: requireSha256(input.corpusSha256, "manifest.corpusSha256"),
    candidateLockSha256: requireSha256(input.candidateLockSha256, "manifest.candidateLockSha256"),
    buildContractSha256: requireSha256(input.buildContractSha256, "manifest.buildContractSha256")
  });
}
function validateDescriptorLock(corpus) {
  const descriptorIds = corpus.retrievers.map(({ id }) => id);
  const lockIds = corpus.candidateLock.descriptorDigests.map(({ retrieverId }) => retrieverId);
  if (descriptorIds.length !== lockIds.length || descriptorIds.some((id, index) => id !== lockIds[index])) {
    throw new TypeError("candidateLock must commit to every retriever descriptor exactly once.");
  }
  const descriptors = new Map(corpus.retrievers.map((descriptor) => [descriptor.id, descriptor]));
  for (const locked of corpus.candidateLock.descriptorDigests) {
    const descriptor = descriptors.get(locked.retrieverId);
    if (descriptor === undefined || evaluationRetrieverDescriptorDigestV2(descriptor) !== locked.sha256) {
      throw new TypeError(`candidateLock descriptor digest does not match ${locked.retrieverId}.`);
    }
  }
  if (descriptors.get(corpus.candidateLock.baselineRetrieverId)?.role !== "baseline") {
    throw new TypeError("candidateLock.baselineRetrieverId must name a baseline descriptor.");
  }
  const candidates = corpus.retrievers.filter(({ role }) => role === "candidate").map(({ id }) => id);
  if (candidates.length !== corpus.candidateLock.candidateRetrieverIds.length || candidates.some((id, index) => id !== corpus.candidateLock.candidateRetrieverIds[index])) {
    throw new TypeError("candidateLock.candidateRetrieverIds must exactly name candidate descriptors.");
  }
  if (evaluationCandidateLockDigestV2(corpus.candidateLock) !== corpus.manifest.candidateLockSha256) {
    throw new TypeError("manifest.candidateLockSha256 does not match candidateLock.");
  }
}
function parseRetrievalEvaluationCorpusV2(inputValue, options) {
  if (options === undefined || typeof options !== "object" || options === null) {
    throw new TypeError("evaluation v2 corpus parsing requires an explicit promotion claim.");
  }
  const parsedOptions = record(options, "evaluation v2 corpus parse options");
  if (parsedOptions.claimPromotion !== true && parsedOptions.claimPromotion !== false) {
    throw new TypeError("evaluation v2 corpus parsing requires claimPromotion true or false.");
  }
  strictKeys(parsedOptions, parsedOptions.claimPromotion ? ["claimPromotion", "expectedSeal"] : ["claimPromotion"], "evaluation v2 corpus parse options");
  const input = record(inputValue, "evaluation v2 corpus");
  strictKeys(input, [
    "assessment",
    "candidateLock",
    "description",
    "documents",
    "evidenceUnits",
    "experiment",
    "frozen",
    "id",
    "manifest",
    "measurementProfiles",
    "queries",
    "retrievers",
    "schemaVersion",
    "sourceFamilies"
  ], "evaluation v2 corpus");
  if (input.schemaVersion !== RETRIEVAL_EVALUATION_V2_SCHEMA_VERSION) {
    throw new TypeError(`evaluation v2 corpus schemaVersion must be ${RETRIEVAL_EVALUATION_V2_SCHEMA_VERSION}.`);
  }
  const frozenInput = record(input.frozen, "frozen");
  strictKeys(frozenInput, ["repositoryCommit", "vaultRoot", "vaultTree"], "frozen");
  if (typeof frozenInput.repositoryCommit !== "string" || !gitObjectPattern.test(frozenInput.repositoryCommit)) {
    throw new TypeError("frozen.repositoryCommit must be a lowercase Git object ID.");
  }
  if (typeof frozenInput.vaultTree !== "string" || !gitObjectPattern.test(frozenInput.vaultTree)) {
    throw new TypeError("frozen.vaultTree must be a lowercase Git object ID.");
  }
  const assessmentInput = record(input.assessment, "assessment");
  strictKeys(assessmentInput, ["assessors", "rubricVersion"], "assessment");
  if (!Array.isArray(assessmentInput.assessors) || assessmentInput.assessors.length < 1 || assessmentInput.assessors.length > 100) {
    throw new TypeError("assessment.assessors must contain from 1 through 100 entries.");
  }
  const assessors = assessmentInput.assessors.map(parseAssessor);
  assertCanonicalOrder(assessors, ({ id }) => id, "assessment.assessors");
  if (!Array.isArray(input.sourceFamilies) || input.sourceFamilies.length < 1 || input.sourceFamilies.length > MAX_EVALUATION_V2_DOCUMENTS) {
    throw new TypeError("sourceFamilies must be a non-empty bounded array.");
  }
  const sourceFamilies = input.sourceFamilies.map(parseSourceFamily);
  assertCanonicalOrder(sourceFamilies, ({ id }) => id, "sourceFamilies");
  if (!Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > MAX_EVALUATION_V2_DOCUMENTS) {
    throw new TypeError("documents must be a non-empty bounded array.");
  }
  const documents = input.documents.map(parseDocument2);
  assertCanonicalOrder(documents, ({ id }) => id, "documents");
  if (!Array.isArray(input.evidenceUnits) || input.evidenceUnits.length < 1 || input.evidenceUnits.length > MAX_EVALUATION_V2_EVIDENCE_UNITS) {
    throw new TypeError("evidenceUnits must be a non-empty bounded array.");
  }
  const evidenceUnits = input.evidenceUnits.map(parseEvidenceUnit);
  assertCanonicalOrder(evidenceUnits, ({ id }) => id, "evidenceUnits");
  if (!Array.isArray(input.measurementProfiles) || input.measurementProfiles.length < 1 || input.measurementProfiles.length > 32) {
    throw new TypeError("measurementProfiles must contain from 1 through 32 entries.");
  }
  const measurementProfiles = input.measurementProfiles.map(parseMeasurementProfile);
  assertCanonicalOrder(measurementProfiles, ({ id }) => id, "measurementProfiles");
  if (new Set(measurementProfiles.map(({ operation }) => operation)).size !== measurementProfiles.length) {
    throw new TypeError("measurementProfiles must not repeat an operation.");
  }
  if (!Array.isArray(input.retrievers) || input.retrievers.length < 1 || input.retrievers.length > 64) {
    throw new TypeError("retrievers must contain from 1 through 64 entries.");
  }
  const retrievers = input.retrievers.map(parseRetrieverDescriptor);
  assertCanonicalOrder(retrievers, ({ id }) => id, "retrievers");
  if (!Array.isArray(input.queries) || input.queries.length < 1 || input.queries.length > MAX_EVALUATION_V2_QUERIES) {
    throw new TypeError(`queries must contain from 1 through ${MAX_EVALUATION_V2_QUERIES} entries.`);
  }
  const queries = input.queries.map(parseQuery);
  assertCanonicalOrder(queries, ({ id }) => id, "queries");
  const nuggetIds = queries.flatMap(({ gold }) => gold.nuggets.map(({ id }) => id));
  if (new Set(nuggetIds).size !== nuggetIds.length) {
    throw new TypeError("query nuggets must use corpus-wide unique IDs.");
  }
  const supportSetIds = queries.flatMap(({ gold }) => gold.nuggets.flatMap(({ acceptableSupportSets }) => acceptableSupportSets.map(({ id }) => id)));
  if (new Set(supportSetIds).size !== supportSetIds.length) {
    throw new TypeError("acceptable support sets must use corpus-wide unique IDs.");
  }
  const corpus = Object.freeze({
    schemaVersion: 2,
    id: canonicalId(input.id, "id"),
    description: boundedString(input.description, "description"),
    manifest: parseManifest(input.manifest),
    frozen: Object.freeze({
      repositoryCommit: frozenInput.repositoryCommit,
      vaultTree: frozenInput.vaultTree,
      vaultRoot: confinedPath(frozenInput.vaultRoot, "frozen.vaultRoot")
    }),
    assessment: Object.freeze({
      rubricVersion: boundedString(assessmentInput.rubricVersion, "assessment.rubricVersion", 256),
      assessors: Object.freeze(assessors)
    }),
    experiment: parseExperiment(input.experiment),
    sourceFamilies: Object.freeze(sourceFamilies),
    documents: Object.freeze(documents),
    evidenceUnits: Object.freeze(evidenceUnits),
    measurementProfiles: Object.freeze(measurementProfiles),
    retrievers: Object.freeze(retrievers),
    candidateLock: parseCandidateLock(input.candidateLock),
    queries: Object.freeze(queries)
  });
  const familyById = new Map(sourceFamilies.map((family) => [family.id, family]));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const evidenceById = new Map(evidenceUnits.map((unit) => [unit.id, unit]));
  const assessorIds = new Set(assessors.map(({ id }) => id));
  const documentBySourcePath = new Map;
  for (const document of documents) {
    const family = familyById.get(document.sourceFamilyId);
    if (family === undefined)
      throw new TypeError(`document ${document.id} references an unknown source family.`);
    if (family.trustClass !== document.trustClass) {
      throw new TypeError(`document ${document.id} trust declaration disagrees with its source family.`);
    }
    const previousDocumentId = documentBySourcePath.get(document.sourcePath);
    if (previousDocumentId !== undefined) {
      throw new TypeError(`document source path ${document.sourcePath} is already bound to ${previousDocumentId}.`);
    }
    documentBySourcePath.set(document.sourcePath, document.id);
  }
  const occupiedRanges = new Set;
  const sourceIdentityByPath = new Map;
  for (const unit of evidenceUnits) {
    const document = documentById.get(unit.documentId);
    const family = familyById.get(unit.sourceFamilyId);
    if (document === undefined)
      throw new TypeError(`evidence unit ${unit.id} references an unknown document.`);
    if (family === undefined)
      throw new TypeError(`evidence unit ${unit.id} references an unknown source family.`);
    if (document.sourceFamilyId !== unit.sourceFamilyId || document.trustClass !== unit.trustClass || family.trustClass !== unit.trustClass) {
      throw new TypeError(`evidence unit ${unit.id} has inconsistent source-family or trust declarations.`);
    }
    if (document.sourcePath !== unit.sourcePath) {
      throw new TypeError(`evidence unit ${unit.id} source path disagrees with document ${document.id}.`);
    }
    const previousSourceIdentity = sourceIdentityByPath.get(unit.sourcePath);
    if (previousSourceIdentity !== undefined && (previousSourceIdentity.documentId !== unit.documentId || previousSourceIdentity.sourceFamilyId !== unit.sourceFamilyId)) {
      throw new TypeError(`source path ${unit.sourcePath} must belong to exactly one document and source family.`);
    }
    sourceIdentityByPath.set(unit.sourcePath, {
      documentId: unit.documentId,
      sourceFamilyId: unit.sourceFamilyId
    });
    const rangeKey = `${unit.sourcePath}\x00${unit.lineRange.start}\x00${unit.lineRange.end}`;
    if (occupiedRanges.has(rangeKey))
      throw new TypeError(`evidence unit ${unit.id} repeats a canonical source range.`);
    occupiedRanges.add(rangeKey);
  }
  for (const query of queries) {
    validateGoldReferences(query, documentById, evidenceById, assessorIds, `query ${query.id}`);
  }
  validateDescriptorLock(corpus);
  if (evaluationCorpusDigestV2(corpus) !== corpus.manifest.corpusSha256) {
    throw new TypeError("manifest.corpusSha256 does not match the sealed evaluation corpus.");
  }
  if (options.claimPromotion) {
    const expectedSeal = record(options.expectedSeal, "promotion expected seal");
    strictKeys(expectedSeal, ["expectedCorpusSha256", "expectedGitBlob"], "promotion expected seal");
    const hasCorpusSha256 = expectedSeal.expectedCorpusSha256 !== undefined;
    const hasGitBlob = expectedSeal.expectedGitBlob !== undefined;
    if (hasCorpusSha256 === hasGitBlob) {
      throw new TypeError("promotion expected seal must supply exactly one corpus digest or Git blob commitment.");
    }
    if (hasCorpusSha256) {
      const expected = requireSha256(expectedSeal.expectedCorpusSha256, "promotion expected seal.expectedCorpusSha256");
      if (expected !== evaluationCorpusDigestV2(corpus)) {
        throw new TypeError("promotion corpus does not match the independently supplied corpus digest.");
      }
    } else {
      if (typeof expectedSeal.expectedGitBlob !== "string" || !gitObjectPattern.test(expectedSeal.expectedGitBlob)) {
        throw new TypeError("promotion expected seal.expectedGitBlob must be a lowercase Git object ID.");
      }
      const objectFormat = expectedSeal.expectedGitBlob.length === 40 ? "sha1" : "sha256";
      if (evaluationCorpusGitBlobCommitmentV2(corpus, objectFormat) !== expectedSeal.expectedGitBlob) {
        throw new TypeError("promotion corpus does not match the independently supplied Git blob commitment.");
      }
    }
    validatePromotionCorpusLayoutV2(corpus);
  }
  return corpus;
}
function assertEvaluationRetrieverLockedV2(corpus, descriptor) {
  const locked = corpus.candidateLock.descriptorDigests.find(({ retrieverId }) => retrieverId === descriptor.id);
  const declared = corpus.retrievers.find(({ id }) => id === descriptor.id);
  const digest = evaluationRetrieverDescriptorDigestV2(descriptor);
  if (locked === undefined || declared === undefined || locked.sha256 !== digest || evaluationRetrieverDescriptorDigestV2(declared) !== digest)
    throw new TypeError(`Retriever descriptor ${descriptor.id} is not committed by the sealed suite.`);
}
function projectEvaluationExecutionQueryV2(query) {
  const cohort = query.cohort;
  if (cohort !== "caller-seeded" && cohort !== "text-only") {
    throw new TypeError("execution query cohort is invalid.");
  }
  const inputs = parseRetrievalInputsV2(query.inputs, "execution query inputs");
  validateCohortInputs(cohort, inputs, "execution query");
  return cohort === "text-only" ? Object.freeze({ inputs: Object.freeze({ text: inputs.text }) }) : Object.freeze({ inputs });
}
function createEvaluationExecutionRequestV2(options) {
  assertEvaluationRetrieverLockedV2(options.corpus, options.descriptor);
  return Object.freeze({
    corpus: options.corpus.frozen,
    query: projectEvaluationExecutionQueryV2(options.query),
    limit: safeInteger(options.limit, "execution limit", 1, MAX_EVALUATION_V2_RESULTS_PER_LANE),
    signal: options.signal
  });
}
function referencedFamilyIds(query, evidenceById, documentById) {
  const families = new Set;
  for (const { documentId } of query.gold.documents) {
    const familyId = documentById.get(documentId)?.sourceFamilyId;
    if (familyId !== undefined)
      families.add(familyId);
  }
  for (const { evidenceUnitId: evidenceUnitId2 } of query.gold.evidenceUnits) {
    const familyId = evidenceById.get(evidenceUnitId2)?.sourceFamilyId;
    if (familyId !== undefined)
      families.add(familyId);
  }
  return families;
}
function evaluationSourceFamilyClusterIdsV2(queries, documents, evidenceUnits, sourceFamilies = []) {
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const evidenceById = new Map(evidenceUnits.map((unit) => [unit.id, unit]));
  const clusterKeyByFamilyId = new Map(sourceFamilies.map((family) => [
    family.id,
    family.familyAssignmentSha256 === undefined ? family.id : `family-assignment:${family.familyAssignmentSha256}`
  ]));
  const familiesByQuery = new Map(queries.map((query) => {
    const families = [...referencedFamilyIds(query, evidenceById, documentById)].map((familyId) => clusterKeyByFamilyId.get(familyId) ?? familyId).toSorted();
    if (families.length === 0)
      throw new TypeError(`Query ${query.id} has no sealed source-family cluster.`);
    return [query.id, families];
  }));
  const parent = new Map;
  const find = (id) => {
    const existing = parent.get(id);
    if (existing === undefined) {
      parent.set(id, id);
      return id;
    }
    if (existing === id)
      return id;
    const root = find(existing);
    parent.set(id, root);
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot)
      return;
    const root = leftRoot < rightRoot ? leftRoot : rightRoot;
    parent.set(root === leftRoot ? rightRoot : leftRoot, root);
  };
  for (const families of familiesByQuery.values()) {
    const first = families[0];
    if (first === undefined)
      continue;
    for (const family of families.slice(1))
      union(first, family);
  }
  return new Map([...familiesByQuery].map(([queryId, families]) => {
    const first = families[0];
    if (first === undefined)
      throw new TypeError(`Query ${queryId} has no source family.`);
    return [queryId, find(first)];
  }));
}
function requireOpaqueIds(corpus) {
  for (const query of corpus.queries) {
    if (!opaquePatterns.query.test(query.id)) {
      throw new TypeError(`promotion query ID ${query.id} must be opaque and canonical.`);
    }
    for (const nugget of query.gold.nuggets) {
      if (!opaquePatterns.nugget.test(nugget.id)) {
        throw new TypeError(`promotion nugget ID ${nugget.id} must be opaque and canonical.`);
      }
      for (const supportSet of nugget.acceptableSupportSets) {
        if (!opaquePatterns.supportSet.test(supportSet.id)) {
          throw new TypeError(`promotion support-set ID ${supportSet.id} must be opaque and canonical.`);
        }
      }
    }
  }
  for (const family of corpus.sourceFamilies) {
    if (!opaquePatterns.sourceFamily.test(family.id)) {
      throw new TypeError(`promotion source-family ID ${family.id} must be opaque and canonical.`);
    }
  }
  for (const unit of corpus.evidenceUnits) {
    if (!opaquePatterns.evidenceUnit.test(unit.id)) {
      throw new TypeError(`promotion evidence-unit ID ${unit.id} must be opaque and canonical.`);
    }
  }
}
function validatePromotionCorpusLayoutV2(corpus) {
  if (corpus.queries.length !== PROMOTION_EVALUATION_QUERY_COUNT_V2) {
    throw new TypeError(`promotion corpus must contain exactly ${PROMOTION_EVALUATION_QUERY_COUNT_V2} queries.`);
  }
  const development = corpus.queries.filter(({ split }) => split === "development");
  const test = corpus.queries.filter(({ split }) => split === "test");
  if (development.length !== PROMOTION_DEVELOPMENT_QUERY_COUNT_V2 || test.length !== PROMOTION_TEST_QUERY_COUNT_V2) {
    throw new TypeError("promotion corpus must contain exactly 48 development and 120 test queries.");
  }
  for (const cohort of ["caller-seeded", "text-only"]) {
    if (development.filter((query) => query.cohort === cohort).length !== 24) {
      throw new TypeError(`promotion development split must contain exactly 24 ${cohort} queries.`);
    }
    for (const expectedSupport of ["supported", "insufficient"]) {
      if (development.filter((query) => query.cohort === cohort && query.expectedSupport === expectedSupport).length !== 12) {
        throw new TypeError(`promotion development ${cohort} cohort must contain exactly 12 ${expectedSupport} queries.`);
      }
    }
  }
  if (test.filter(({ expectedSupport }) => expectedSupport === "supported").length !== PROMOTION_TEST_SUPPORTED_COUNT_V2 || test.filter(({ expectedSupport }) => expectedSupport === "insufficient").length !== PROMOTION_TEST_INSUFFICIENT_COUNT_V2)
    throw new TypeError("promotion test split must contain exactly 80 supported and 40 insufficient queries.");
  for (const cohort of ["caller-seeded", "text-only"]) {
    if (corpus.queries.filter((query) => query.cohort === cohort).length !== PROMOTION_COHORT_COUNT_V2) {
      throw new TypeError(`promotion corpus must contain exactly 84 ${cohort} queries.`);
    }
    if (test.filter((query) => query.cohort === cohort).length !== PROMOTION_TEST_COHORT_COUNT_V2) {
      throw new TypeError(`promotion test split must contain exactly 60 ${cohort} queries.`);
    }
    if (test.filter((query) => query.cohort === cohort && query.expectedSupport === "supported").length !== 40 || test.filter((query) => query.cohort === cohort && query.expectedSupport === "insufficient").length !== 20) {
      throw new TypeError(`promotion test ${cohort} cohort must contain exactly 40 supported and 20 insufficient queries.`);
    }
  }
  for (const [stratum, minimum] of Object.entries(PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2)) {
    if (test.filter((query) => query.primaryStratum === stratum).length < minimum) {
      throw new TypeError(`promotion test split requires at least ${minimum} primary ${stratum} queries.`);
    }
    for (const cohort of ["caller-seeded", "text-only"]) {
      const cohortMinimum = PROMOTION_ACCEPTANCE_STRATUM_COHORT_MINIMA_V2[stratum];
      if (test.filter((query) => query.cohort === cohort && query.primaryStratum === stratum).length < cohortMinimum) {
        throw new TypeError(`promotion test ${cohort} cohort requires at least ${cohortMinimum} primary ${stratum} queries.`);
      }
    }
  }
  for (const query of test) {
    if (query.expectedSupport === "insufficient" !== query.strata.includes("no-answer-near-miss")) {
      throw new TypeError("promotion test insufficient queries must be explicitly stratified as no-answer near misses, and supported queries must not be.");
    }
  }
  for (const [inputLane, minimum] of Object.entries(PROMOTION_CRITICAL_INPUT_MINIMA_V2)) {
    if (test.filter((query) => query.inputs[inputLane] !== undefined).length < minimum) {
      throw new TypeError(`promotion test split requires at least ${minimum} executable ${inputLane} lane inputs.`);
    }
  }
  const dual = corpus.queries.filter(({ rawAssessments }) => rawAssessments.length >= 2);
  if (dual.length < PROMOTION_DUAL_ASSESSMENT_MINIMUM_V2) {
    throw new TypeError("promotion corpus requires independent dual assessment for at least 25 percent of queries.");
  }
  const promotionStrata = [
    ...Object.keys(PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2),
    "no-answer-near-miss"
  ];
  for (const stratum of promotionStrata) {
    for (const cohort of ["caller-seeded", "text-only"]) {
      const cell = test.filter((query) => query.cohort === cohort && (stratum === "no-answer-near-miss" ? query.strata.includes(stratum) : query.primaryStratum === stratum));
      const minimumDual = Math.max(PROMOTION_STRATUM_COHORT_DUAL_MINIMUM_V2, Math.ceil(cell.length * PROMOTION_STRATUM_COHORT_DUAL_FRACTION_V2));
      if (cell.filter(({ rawAssessments }) => rawAssessments.length >= 2).length < minimumDual) {
        throw new TypeError(`promotion test ${cohort} ${stratum} stratum requires at least ${minimumDual} independently dual-assessed queries.`);
      }
    }
  }
  const effects = corpus.experiment.protocol.minimumUsefulEffects;
  if (effects.length !== 1 || effects[0]?.metric !== "nugget-coverage" || effects[0].cohort !== "caller-seeded") {
    throw new TypeError("promotion experiment must declare exactly one caller-seeded nugget-coverage minimum useful effect.");
  }
  const marginMetrics = corpus.experiment.protocol.nonInferiorityMargins.map(({ metric }) => metric);
  if (marginMetrics.length !== promotionNonInferiorityMetrics.size || [...promotionNonInferiorityMetrics].some((metric) => !marginMetrics.includes(metric))) {
    throw new TypeError("promotion experiment must predeclare every required metric-specific non-inferiority margin.");
  }
  const pairedPower = corpus.experiment.protocol.pairedPower;
  if (pairedPower.alpha !== 0.05 || pairedPower.targetPower < 0.8 || pairedPower.minimumUsefulEffect !== effects[0].minimumAbsoluteDifference) {
    throw new TypeError("promotion paired-power design must use one-sided alpha 0.05, at least 80 percent power, and the primary MUE threshold.");
  }
  const eligiblePrimaryPairs = test.filter((query) => query.cohort === "caller-seeded" && query.expectedSupport === "supported").length;
  if (eligiblePrimaryPairs < pairedPower.requiredPairs) {
    throw new TypeError(`promotion primary effect has ${eligiblePrimaryPairs} eligible pairs but its prospective design requires ${pairedPower.requiredPairs}.`);
  }
  const testClusterIds = evaluationSourceFamilyClusterIdsV2(test, corpus.documents, corpus.evidenceUnits, corpus.sourceFamilies);
  const eligiblePrimaryClusters = new Set(test.filter((query) => query.cohort === "caller-seeded" && query.expectedSupport === "supported").map((query) => testClusterIds.get(query.id))).size;
  if (eligiblePrimaryClusters < pairedPower.requiredPairs) {
    throw new TypeError(`promotion primary effect has ${eligiblePrimaryClusters} independent source-family clusters but its prospective design requires ${pairedPower.requiredPairs}.`);
  }
  for (const descriptor of corpus.retrievers) {
    if (Object.keys(descriptor.configuration).length === 0) {
      throw new TypeError(`promotion retriever descriptor ${descriptor.id} must have a non-empty configuration.`);
    }
  }
  const evidenceById = new Map(corpus.evidenceUnits.map((unit) => [unit.id, unit]));
  const documentById = new Map(corpus.documents.map((document) => [document.id, document]));
  const sourceFamilyById = new Map(corpus.sourceFamilies.map((family) => [family.id, family]));
  const familySplits = new Map;
  for (const query of corpus.queries) {
    for (const familyId of referencedFamilyIds(query, evidenceById, documentById)) {
      const family = sourceFamilyById.get(familyId);
      if (family?.familyAssignmentSha256 === undefined) {
        throw new TypeError(`promotion source family ${familyId} is referenced by a query but lacks an independently reviewed family-assignment commitment.`);
      }
      const familyClusterId = `family-assignment:${family.familyAssignmentSha256}`;
      const previous = familySplits.get(familyClusterId);
      if (previous !== undefined && previous !== query.split) {
        throw new TypeError(`source-family assignment ${family.familyAssignmentSha256} crosses development and test splits.`);
      }
      familySplits.set(familyClusterId, query.split);
    }
  }
  requireOpaqueIds(corpus);
  const requiredOperations = new Set([
    "cold-index",
    "four-reader-query",
    "incremental-update",
    "packing",
    "warm-query"
  ]);
  for (const profile of corpus.measurementProfiles) {
    requiredOperations.delete(profile.operation);
    if (profile.repetitions < 3) {
      throw new TypeError(`promotion measurement profile ${profile.id} requires at least three repetitions.`);
    }
  }
  if (requiredOperations.size > 0) {
    throw new TypeError(`promotion corpus is missing measurement profiles: ${[...requiredOperations].toSorted().join(", ")}.`);
  }
}
function validatePromotionCorpusDesignV2(input) {
  const corpus = parseRetrievalEvaluationCorpusV2(input, { claimPromotion: false });
  validatePromotionCorpusLayoutV2(corpus);
  return corpus;
}
function validatePromotionCorpusV2(input, expectedSeal) {
  return parseRetrievalEvaluationCorpusV2(input, {
    claimPromotion: true,
    expectedSeal
  });
}
function parseEvidenceLocator(value, label, documentId, laneId, evidenceById, familyById) {
  const input = record(value, label);
  strictKeys(input, [
    "evidenceUnitId",
    "headingPath",
    "lineRange",
    "sourceClass",
    "sourceFamilyId",
    "sourcePage",
    "sourcePath",
    "trustClass"
  ], label);
  const parsedEvidenceUnitId = evidenceUnitId(input.evidenceUnitId, `${label}.evidenceUnitId`);
  const unit = evidenceById.get(parsedEvidenceUnitId);
  if (unit === undefined)
    throw new TypeError(`${label} references unknown evidence unit ${parsedEvidenceUnitId}.`);
  if (unit.documentId !== documentId && laneId !== "graph") {
    throw new TypeError(`${label} evidence unit ${parsedEvidenceUnitId} belongs to a different document.`);
  }
  const family = familyById.get(unit.sourceFamilyId);
  if (family === undefined)
    throw new TypeError(`${label} evidence unit has an unknown source family.`);
  if (input.sourceFamilyId !== unit.sourceFamilyId || input.sourceClass !== family.sourceClass || input.trustClass !== unit.trustClass) {
    throw new TypeError(`${label} source-family, source-class, or trust declaration is not registry-bound.`);
  }
  const sourcePage = input.sourcePage === undefined ? undefined : safeInteger(input.sourcePage, `${label}.sourcePage`, 1, 1e6);
  const parsed = Object.freeze({
    evidenceUnitId: parsedEvidenceUnitId,
    sourceFamilyId: boundedString(input.sourceFamilyId, `${label}.sourceFamilyId`, 256),
    sourceClass: input.sourceClass,
    trustClass: input.trustClass,
    sourcePath: confinedPath(input.sourcePath, `${label}.sourcePath`),
    lineRange: parseLineRange(input.lineRange, `${label}.lineRange`),
    headingPath: parseHeadingPath(input.headingPath, `${label}.headingPath`),
    ...sourcePage === undefined ? {} : { sourcePage }
  });
  const expected = {
    evidenceUnitId: unit.id,
    sourceFamilyId: unit.sourceFamilyId,
    sourceClass: family.sourceClass,
    trustClass: unit.trustClass,
    sourcePath: unit.sourcePath,
    lineRange: unit.lineRange,
    headingPath: unit.headingPath,
    ...unit.sourcePage === undefined ? {} : { sourcePage: unit.sourcePage }
  };
  if (canonicalJson(parsed) !== canonicalJson(expected)) {
    throw new TypeError(`${label} must exactly match its frozen registry evidence unit.`);
  }
  return parsed;
}
function parseEvidenceLocators(value, label, documentId, laneId, evidenceUnitIds, evidenceById, familyById) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError(`${label} must contain at most 100 per-unit locators.`);
  }
  const parsed = value.map((entry, index) => parseEvidenceLocator(entry, `${label}[${index}]`, documentId, laneId, evidenceById, familyById));
  assertCanonicalOrder(parsed, ({ evidenceUnitId: id }) => id, label);
  if (parsed.length !== evidenceUnitIds.length || parsed.some(({ evidenceUnitId: id }, index) => id !== evidenceUnitIds[index])) {
    throw new TypeError(`${label} must preserve a one-to-one locator association for every evidence unit.`);
  }
  return Object.freeze(parsed);
}
function parseRankedCandidate(value, label, laneId, evidenceById, documentById, familyById) {
  const input = record(value, label);
  strictKeys(input, ["documentId", "evidenceUnitIds", "provenance", "rank", "score"], label);
  const documentId = confinedPath(input.documentId, `${label}.documentId`);
  if (!documentById.has(documentId))
    throw new TypeError(`${label} references unknown document ${documentId}.`);
  const evidenceUnitIds = Object.freeze(stringList(input.evidenceUnitIds, `${label}.evidenceUnitIds`, {
    allowEmpty: true,
    canonical: true,
    maximum: 100
  }).map((id, evidenceIndex) => evidenceUnitId(id, `${label}.evidenceUnitIds[${evidenceIndex}]`)));
  for (const id of evidenceUnitIds) {
    const unit = evidenceById.get(id);
    if (unit === undefined)
      throw new TypeError(`${label} references unknown evidence unit ${id}.`);
    if (unit.documentId !== documentId && laneId !== "graph") {
      throw new TypeError(`${label} evidence unit ${id} belongs to a different document.`);
    }
  }
  if (input.score !== undefined && (typeof input.score !== "number" || !Number.isFinite(input.score))) {
    throw new TypeError(`${label}.score must be finite.`);
  }
  return Object.freeze({
    documentId,
    evidenceUnitIds,
    rank: safeInteger(input.rank, `${label}.rank`, 1, MAX_EVALUATION_V2_RESULTS_PER_LANE),
    ...input.score === undefined ? {} : { score: input.score },
    provenance: parseEvidenceLocators(input.provenance, `${label}.provenance`, documentId, laneId, evidenceUnitIds, evidenceById, familyById)
  });
}
function parseLaneOutcome(value, index, evidenceById, documentById, familyById) {
  const label = `sample.trace.laneOutcomes[${index}]`;
  const input = record(value, label);
  strictKeys(input, ["applicability", "laneId", "rawRanking", "reasonCodes", "status"], label);
  if (typeof input.laneId !== "string" || !lanes.has(input.laneId)) {
    throw new TypeError(`${label}.laneId is invalid.`);
  }
  if (input.applicability !== "applied" && input.applicability !== "skipped") {
    throw new TypeError(`${label}.applicability is invalid.`);
  }
  if (input.status !== "degraded" && input.status !== "ready" && input.status !== "unavailable") {
    throw new TypeError(`${label}.status is invalid.`);
  }
  const reasonCodes = stringList(input.reasonCodes, `${label}.reasonCodes`, {
    allowEmpty: true,
    canonical: true,
    maximum: 100
  }).map((code, reasonIndex) => canonicalId(code, `${label}.reasonCodes[${reasonIndex}]`));
  if (!Array.isArray(input.rawRanking) || input.rawRanking.length > MAX_EVALUATION_V2_RESULTS_PER_LANE) {
    throw new TypeError(`${label}.rawRanking has too many entries.`);
  }
  const rawRanking = input.rawRanking.map((entry, rankIndex) => parseRankedCandidate(entry, `${label}.rawRanking[${rankIndex}]`, input.laneId, evidenceById, documentById, familyById));
  if (rawRanking.some(({ rank }, rankIndex) => rank !== rankIndex + 1)) {
    throw new TypeError(`${label}.rawRanking ranks must be contiguous and canonical.`);
  }
  if (new Set(rawRanking.map(({ documentId }) => documentId)).size !== rawRanking.length) {
    throw new TypeError(`${label}.rawRanking must not repeat a document.`);
  }
  if ((input.applicability === "skipped" || input.status === "unavailable") && rawRanking.length > 0) {
    throw new TypeError(`${label} skipped or unavailable lanes may not contain a raw ranking.`);
  }
  if ((input.applicability === "skipped" || input.status === "degraded" || input.status === "unavailable") && reasonCodes.length === 0) {
    throw new TypeError(`${label} skipped, degraded, or unavailable lanes require a reason code.`);
  }
  if (input.applicability === "skipped" && input.status === "degraded") {
    throw new TypeError(`${label} skipped lanes cannot have degraded status.`);
  }
  return Object.freeze({
    laneId: input.laneId,
    applicability: input.applicability,
    status: input.status,
    reasonCodes: Object.freeze(reasonCodes),
    rawRanking: Object.freeze(rawRanking)
  });
}
var candidateReasons = new Set([
  "appended",
  "boundary",
  "deduplicated",
  "missing-provenance",
  "output-limit",
  "primary",
  "primary-retain-limit",
  "trust",
  "unsupported"
]);
function parseCandidateDecision(value, index, evidenceById, documentById, familyById) {
  const label = `sample.trace.candidateDecisions[${index}]`;
  const input = record(value, label);
  strictKeys(input, [
    "disposition",
    "documentId",
    "evidenceUnitIds",
    "laneId",
    "outputRank",
    "provenance",
    "reasonCodes",
    "sourceRank"
  ], label);
  if (typeof input.laneId !== "string" || !lanes.has(input.laneId)) {
    throw new TypeError(`${label}.laneId is invalid.`);
  }
  if (input.disposition !== "accepted" && input.disposition !== "excluded") {
    throw new TypeError(`${label}.disposition is invalid.`);
  }
  const documentId = confinedPath(input.documentId, `${label}.documentId`);
  if (!documentById.has(documentId))
    throw new TypeError(`${label} references unknown document ${documentId}.`);
  const evidenceUnitIds = Object.freeze(stringList(input.evidenceUnitIds, `${label}.evidenceUnitIds`, {
    allowEmpty: true,
    canonical: true,
    maximum: 100
  }).map((id, evidenceIndex) => evidenceUnitId(id, `${label}.evidenceUnitIds[${evidenceIndex}]`)));
  for (const id of evidenceUnitIds) {
    const unit = evidenceById.get(id);
    if (unit === undefined)
      throw new TypeError(`${label} references unknown evidence unit ${id}.`);
    if (unit.documentId !== documentId && input.laneId !== "graph") {
      throw new TypeError(`${label} evidence unit ${id} belongs to another document.`);
    }
  }
  if (!Array.isArray(input.reasonCodes) || input.reasonCodes.length < 1 || input.reasonCodes.length > 20) {
    throw new TypeError(`${label}.reasonCodes must be a non-empty bounded array.`);
  }
  const reasonCodes = input.reasonCodes.map((reason, reasonIndex) => {
    if (typeof reason !== "string" || !candidateReasons.has(reason)) {
      throw new TypeError(`${label}.reasonCodes[${reasonIndex}] is invalid.`);
    }
    return reason;
  });
  if (new Set(reasonCodes).size !== reasonCodes.length || reasonCodes.some((reason, reasonIndex) => reason !== reasonCodes.toSorted()[reasonIndex])) {
    throw new TypeError(`${label}.reasonCodes must be unique and in canonical order.`);
  }
  const outputRank = input.outputRank === undefined ? undefined : safeInteger(input.outputRank, `${label}.outputRank`, 1, MAX_EVALUATION_V2_RESULTS_PER_LANE);
  if (input.disposition === "accepted" !== (outputRank !== undefined)) {
    throw new TypeError(`${label} accepted decisions require outputRank and excluded decisions forbid it.`);
  }
  const provenance = parseEvidenceLocators(input.provenance, `${label}.provenance`, documentId, input.laneId, evidenceUnitIds, evidenceById, familyById);
  if (input.disposition === "accepted" && (evidenceUnitIds.length === 0 || provenance.length === 0)) {
    throw new TypeError(`${label} accepted decisions require registry-bound evidence-unit provenance.`);
  }
  const allowedReasons = input.disposition === "accepted" ? new Set(["appended", "primary"]) : new Set([
    "boundary",
    "deduplicated",
    "missing-provenance",
    "output-limit",
    "primary-retain-limit",
    "trust",
    "unsupported"
  ]);
  if (reasonCodes.some((reason) => !allowedReasons.has(reason))) {
    throw new TypeError(`${label}.reasonCodes contradict the candidate disposition.`);
  }
  if (input.disposition === "accepted" && reasonCodes.length !== 1) {
    throw new TypeError(`${label} accepted decisions require exactly one acceptance reason.`);
  }
  if (reasonCodes.includes("missing-provenance") && provenance.length > 0) {
    throw new TypeError(`${label} cannot report missing-provenance with registry-bound provenance.`);
  }
  if (reasonCodes.includes("missing-provenance") && reasonCodes.length !== 1) {
    throw new TypeError(`${label} missing-provenance must be the sole exclusion reason.`);
  }
  return Object.freeze({
    documentId,
    evidenceUnitIds,
    laneId: input.laneId,
    sourceRank: safeInteger(input.sourceRank, `${label}.sourceRank`, 1, MAX_EVALUATION_V2_RESULTS_PER_LANE),
    disposition: input.disposition,
    reasonCodes: Object.freeze(reasonCodes),
    ...outputRank === undefined ? {} : { outputRank },
    provenance
  });
}
function parseTrace(value, descriptor, evidenceById, documentById, familyById) {
  const input = record(value, "sample.trace");
  strictKeys(input, ["candidateDecisions", "laneOutcomes"], "sample.trace");
  if (!Array.isArray(input.laneOutcomes) || input.laneOutcomes.length > lanes.size) {
    throw new TypeError("sample.trace.laneOutcomes is invalid.");
  }
  const laneOutcomes = input.laneOutcomes.map((entry, index) => parseLaneOutcome(entry, index, evidenceById, documentById, familyById));
  const actualLanes = laneOutcomes.map(({ laneId }) => laneId);
  if (actualLanes.length !== descriptor.lanes.length || actualLanes.some((lane, index) => lane !== descriptor.lanes[index])) {
    throw new TypeError("sample.trace must report every locked descriptor lane in canonical order.");
  }
  if (!Array.isArray(input.candidateDecisions) || input.candidateDecisions.length > MAX_EVALUATION_V2_TRACE_DECISIONS) {
    throw new TypeError("sample.trace.candidateDecisions has too many entries.");
  }
  const candidateDecisions = input.candidateDecisions.map((entry, index) => parseCandidateDecision(entry, index, evidenceById, documentById, familyById));
  const laneOrder = new Map(descriptor.lanes.map((lane, index) => [lane, index]));
  for (let index = 1;index < candidateDecisions.length; index += 1) {
    const previous = candidateDecisions[index - 1];
    const current = candidateDecisions[index];
    if (previous === undefined || current === undefined)
      continue;
    const comparison = (laneOrder.get(previous.laneId) ?? 0) - (laneOrder.get(current.laneId) ?? 0) || previous.sourceRank - current.sourceRank || previous.documentId.localeCompare(current.documentId);
    if (comparison > 0)
      throw new TypeError("sample.trace.candidateDecisions must be in canonical lane/rank/document order.");
  }
  const decisionKeys = candidateDecisions.map((decision) => `${decision.laneId}\x00${decision.sourceRank}\x00${decision.documentId}`);
  if (new Set(decisionKeys).size !== decisionKeys.length) {
    throw new TypeError("sample.trace.candidateDecisions must not repeat a lane/rank/document decision.");
  }
  const rawRankingByKey = new Map(laneOutcomes.flatMap((outcome) => outcome.rawRanking.map((candidate) => [
    `${outcome.laneId}\x00${candidate.rank}\x00${candidate.documentId}`,
    candidate
  ])));
  if (candidateDecisions.length !== rawRankingByKey.size) {
    throw new TypeError("sample.trace must make exactly one candidate decision for every raw-ranking row.");
  }
  for (const decision of candidateDecisions) {
    if (!laneOrder.has(decision.laneId)) {
      throw new TypeError(`sample.trace decision lane ${decision.laneId} is not in the locked descriptor.`);
    }
    const key = `${decision.laneId}\x00${decision.sourceRank}\x00${decision.documentId}`;
    const ranked = rawRankingByKey.get(key);
    if (ranked === undefined) {
      throw new TypeError("sample.trace candidate decision does not join to its raw-ranking lane/rank/document row.");
    }
    if (canonicalJson(decision.evidenceUnitIds) !== canonicalJson(ranked.evidenceUnitIds) || canonicalJson(decision.provenance) !== canonicalJson(ranked.provenance)) {
      throw new TypeError("sample.trace candidate decision evidence and provenance must match its raw-ranking row.");
    }
  }
  const accepted = candidateDecisions.filter(({ disposition }) => disposition === "accepted");
  const outputRanks = accepted.map(({ outputRank }) => outputRank).toSorted((left, right) => left - right);
  if (new Set(outputRanks).size !== outputRanks.length) {
    throw new TypeError("sample.trace accepted output ranks must be unique.");
  }
  if (outputRanks.some((rank, index) => rank !== index + 1)) {
    throw new TypeError("sample.trace accepted output ranks must be contiguous.");
  }
  if (new Set(accepted.map(({ documentId }) => documentId)).size !== accepted.length) {
    throw new TypeError("sample.trace accepted output documents must be unique.");
  }
  return Object.freeze({
    laneOutcomes: Object.freeze(laneOutcomes),
    candidateDecisions: Object.freeze(candidateDecisions)
  });
}
function hasUnpairedSurrogate2(value) {
  for (let index = 0;index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (next < 56320 || next > 57343)
        return true;
      index += 1;
    } else if (code >= 56320 && code <= 57343)
      return true;
  }
  return false;
}
function copyLaneNativeJson(value, label, depth = 0, ancestors = new WeakSet) {
  if (value === null || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(`${label} numbers must be finite.`);
    return value;
  }
  if (typeof value === "string") {
    if (value.includes("\x00") || hasUnpairedSurrogate2(value) || value.normalize("NFC") !== value || Buffer.byteLength(value, "utf8") > MAX_EVALUATION_V2_RAW_EVIDENCE_STRING_BYTES)
      throw new TypeError(`${label} strings must be bounded NFC JSON text.`);
    return value;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`${label} must contain only JSON values.`);
  }
  if (depth >= MAX_EVALUATION_V2_RAW_EVIDENCE_DEPTH) {
    throw new TypeError(`${label} exceeds the lane-native evidence depth bound.`);
  }
  if (ancestors.has(value))
    throw new TypeError(`${label} must not contain cycles.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_EVALUATION_V2_RAW_EVIDENCE_ARRAY_ITEMS) {
        throw new TypeError(`${label} exceeds the lane-native evidence array bound.`);
      }
      return Object.freeze(value.map((entry, index) => copyLaneNativeJson(entry, `${label}[${index}]`, depth + 1, ancestors)));
    }
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must contain only plain JSON objects.`);
    }
    const input = value;
    const keys = Object.keys(input);
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string") || keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      return descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor);
    }))
      throw new TypeError(`${label} must contain only enumerable JSON data properties.`);
    if (keys.length > MAX_EVALUATION_V2_RAW_EVIDENCE_OBJECT_FIELDS) {
      throw new TypeError(`${label} exceeds the lane-native evidence object-field bound.`);
    }
    const output = Object.create(null);
    for (const key of keys.toSorted()) {
      if (key.includes("\x00") || hasUnpairedSurrogate2(key) || key.normalize("NFC") !== key || Buffer.byteLength(key, "utf8") > 4096)
        throw new TypeError(`${label} has an invalid JSON field name.`);
      output[key] = copyLaneNativeJson(input[key], `${label}.${key}`, depth + 1, ancestors);
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}
function parseLaneNativeEvidence(value, trace) {
  if (!Array.isArray(value) || value.length > MAX_EVALUATION_V2_RAW_EVIDENCE_PER_SAMPLE) {
    throw new TypeError(`sample.rawEvidence must contain at most ${MAX_EVALUATION_V2_RAW_EVIDENCE_PER_SAMPLE} rows.`);
  }
  const expected = trace.laneOutcomes.flatMap(({ laneId, rawRanking }) => rawRanking.map(({ documentId, rank }) => ({ laneId, documentId, rank })));
  if (value.length !== expected.length) {
    throw new TypeError("sample.rawEvidence must contain exactly one row for every raw-ranking row.");
  }
  const parsed = value.map((entry, index) => {
    const label = `sample.rawEvidence[${index}]`;
    const input = record(entry, label);
    strictKeys(input, ["documentId", "evidence", "laneId", "rank"], label);
    const expectedRow = expected[index];
    if (expectedRow === undefined)
      throw new Error("Lost expected lane-native evidence row.");
    if (input.laneId !== expectedRow.laneId || input.documentId !== expectedRow.documentId || input.rank !== expectedRow.rank) {
      throw new TypeError(`${label} must join the same canonical lane, document, and rank as its raw-ranking row.`);
    }
    const hasEvidence = Object.hasOwn(input, "evidence");
    const evidence = hasEvidence ? copyLaneNativeJson(input.evidence, `${label}.evidence`) : undefined;
    return Object.freeze({
      laneId: expectedRow.laneId,
      documentId: expectedRow.documentId,
      rank: expectedRow.rank,
      ...hasEvidence ? { evidence } : {}
    });
  });
  boundedJsonByteSize(parsed, MAX_EVALUATION_V2_RAW_EVIDENCE_BYTES_PER_SAMPLE, "sample.rawEvidence");
  return Object.freeze(parsed);
}
function parseResources(value, contextCeilings) {
  const input = record(value, "sample.resources");
  strictKeys(input, ["cacheBytes", "embedding", "llm", "packedContext", "peakRssBytes"], "sample.resources");
  const llm = record(input.llm, "sample.resources.llm");
  strictKeys(llm, ["calls", "inputTokens", "outputTokens"], "sample.resources.llm");
  if (llm.calls !== 0 || llm.inputTokens !== 0 || llm.outputTokens !== 0) {
    throw new TypeError("evaluation memory operations require literal zero LLM calls and input/output tokens.");
  }
  const embedding = record(input.embedding, "sample.resources.embedding");
  strictKeys(embedding, ["calls", "durationMs", "durationScope", "inputTokens", "inputTokensMeasured"], "sample.resources.embedding");
  const embeddingCalls = safeInteger(embedding.calls, "sample.resources.embedding.calls", 0, 1e9);
  const embeddingInputTokens = safeInteger(embedding.inputTokens, "sample.resources.embedding.inputTokens", 0, 1e9);
  const embeddingDurationMs = nonnegativeNumber(embedding.durationMs, "sample.resources.embedding.durationMs");
  const inputTokensMeasured = embedding.inputTokensMeasured;
  if (Object.hasOwn(embedding, "inputTokensMeasured") && inputTokensMeasured !== false) {
    throw new TypeError("sample.resources.embedding.inputTokensMeasured must be literal false when present.");
  }
  const durationScopeValue = embedding.durationScope;
  if (Object.hasOwn(embedding, "durationScope") && durationScopeValue !== "embedding-backed-search-upper-bound") {
    throw new TypeError("sample.resources.embedding.durationScope must be embedding-backed-search-upper-bound when present.");
  }
  const durationScope = durationScopeValue === "embedding-backed-search-upper-bound" ? durationScopeValue : undefined;
  if (embeddingCalls === 0) {
    if (embeddingInputTokens !== 0 || embeddingDurationMs !== 0 || inputTokensMeasured !== undefined || durationScope !== undefined) {
      throw new TypeError("zero-call embedding accounting must be the exact unannotated zero record.");
    }
  } else if (inputTokensMeasured === false && embeddingInputTokens !== 0) {
    throw new TypeError("unmeasured embedding input tokens must use zero only as an explicit placeholder.");
  }
  const packedContext = record(input.packedContext, "sample.resources.packedContext");
  strictKeys(packedContext, ["readerTokens", "utf8Bytes"], "sample.resources.packedContext");
  const utf8Bytes = safeInteger(packedContext.utf8Bytes, "sample.resources.packedContext.utf8Bytes", 0, 1e9);
  const readerTokens = safeInteger(packedContext.readerTokens, "sample.resources.packedContext.readerTokens", 0, 1e9);
  if (utf8Bytes > contextCeilings.utf8Bytes || readerTokens > contextCeilings.readerTokens) {
    throw new TypeError("sample packed context exceeds the digest-covered byte or token ceiling.");
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: embeddingCalls,
      inputTokens: embeddingInputTokens,
      ...inputTokensMeasured === false ? { inputTokensMeasured } : {},
      durationMs: embeddingDurationMs,
      ...durationScope === undefined ? {} : { durationScope }
    }),
    packedContext: Object.freeze({
      utf8Bytes,
      readerTokens
    }),
    peakRssBytes: safeInteger(input.peakRssBytes, "sample.resources.peakRssBytes", 0, Number.MAX_SAFE_INTEGER),
    cacheBytes: safeInteger(input.cacheBytes, "sample.resources.cacheBytes", 0, Number.MAX_SAFE_INTEGER)
  });
}
function acceptedEvidenceOrder(trace) {
  const ordered = [];
  const seen = new Set;
  const accepted = trace.candidateDecisions.filter(({ disposition }) => disposition === "accepted").toSorted((left, right) => (left.outputRank ?? Number.MAX_SAFE_INTEGER) - (right.outputRank ?? Number.MAX_SAFE_INTEGER));
  for (const decision of accepted) {
    for (const evidenceUnitId2 of decision.evidenceUnitIds) {
      if (!seen.has(evidenceUnitId2))
        ordered.push(evidenceUnitId2);
      seen.add(evidenceUnitId2);
    }
  }
  return Object.freeze(ordered);
}
function parsePackedContextTrace(value, profile, status, trace, accounting) {
  const packingSample = profile.operation === "packing";
  if (!packingSample || status === "failed") {
    if (value !== undefined) {
      const sampleKind = packingSample ? "failed packing" : "non-packing";
      throw new TypeError(`sample.packedContextTrace is forbidden for ${sampleKind} samples.`);
    }
    return;
  }
  if (value === undefined) {
    throw new TypeError("sample.packedContextTrace is required for every nonfailed packing sample.");
  }
  const input = record(value, "sample.packedContextTrace");
  strictKeys(input, ["evidenceUnitIds", "packedBytesSha256", "truncated"], "sample.packedContextTrace");
  if (typeof input.truncated !== "boolean") {
    throw new TypeError("sample.packedContextTrace.truncated must be boolean.");
  }
  if (!Array.isArray(input.evidenceUnitIds) || input.evidenceUnitIds.length > MAX_EVALUATION_V2_PACKED_CONTEXT_EVIDENCE_UNITS) {
    throw new TypeError(`sample.packedContextTrace.evidenceUnitIds must contain at most ${MAX_EVALUATION_V2_PACKED_CONTEXT_EVIDENCE_UNITS} entries.`);
  }
  const evidenceUnitIds = input.evidenceUnitIds.map((entry, index) => evidenceUnitId(entry, `sample.packedContextTrace.evidenceUnitIds[${index}]`));
  if (new Set(evidenceUnitIds).size !== evidenceUnitIds.length) {
    throw new TypeError("sample.packedContextTrace.evidenceUnitIds must not contain duplicates.");
  }
  const packedBytesSha256 = requireSha256(input.packedBytesSha256, "sample.packedContextTrace.packedBytesSha256");
  const acceptedOrder = acceptedEvidenceOrder(trace);
  let acceptedCursor = 0;
  for (const packedId of evidenceUnitIds) {
    const acceptedIndex = acceptedOrder.indexOf(packedId, acceptedCursor);
    if (acceptedIndex < 0) {
      if (acceptedOrder.includes(packedId)) {
        throw new TypeError("sample.packedContextTrace.evidenceUnitIds must preserve accepted output and evidence order.");
      }
      throw new TypeError(`sample.packedContextTrace evidence unit ${packedId} is not registry-bound to an accepted trace decision.`);
    }
    acceptedCursor = acceptedIndex + 1;
  }
  if (!input.truncated) {
    if (evidenceUnitIds.length !== acceptedOrder.length || evidenceUnitIds.some((id, index) => id !== acceptedOrder[index])) {
      throw new TypeError("A nontruncated sample.packedContextTrace must include every accepted evidence unit in order.");
    }
  } else if (evidenceUnitIds.length >= acceptedOrder.length) {
    throw new TypeError("A truncated sample.packedContextTrace must omit at least one accepted evidence unit.");
  }
  if (accounting.utf8Bytes === 0 !== (evidenceUnitIds.length === 0)) {
    throw new TypeError("sample.packedContextTrace evidence count contradicts packed-context UTF-8 byte accounting.");
  }
  if (accounting.utf8Bytes === 0 && accounting.readerTokens !== 0) {
    throw new TypeError("Empty packed-context byte accounting cannot report nonzero reader tokens.");
  }
  if (evidenceUnitIds.length > accounting.utf8Bytes) {
    throw new TypeError("sample.packedContextTrace evidence count exceeds its packed-context UTF-8 byte count.");
  }
  if (accounting.utf8Bytes === 0 && packedBytesSha256 !== EMPTY_PACKED_CONTEXT_SHA256 || accounting.utf8Bytes > 0 && packedBytesSha256 === EMPTY_PACKED_CONTEXT_SHA256) {
    throw new TypeError("sample.packedContextTrace packed-bytes SHA-256 contradicts packed-context byte accounting.");
  }
  return Object.freeze({
    evidenceUnitIds: Object.freeze(evidenceUnitIds),
    truncated: input.truncated,
    packedBytesSha256
  });
}
function parseSample(value, index, split, descriptorById, profileById, queryById, evidenceById, documentById, familyById, experiment) {
  const label = `samples[${index}]`;
  const input = record(value, label);
  strictKeys(input, [
    "concurrencyBatchIdentity",
    "failure",
    "packedContextTrace",
    "profileId",
    "queryId",
    "repetition",
    "rawEvidence",
    "resources",
    "retrieverId",
    "status",
    "timings",
    "trace"
  ], label);
  const retrieverId = canonicalId(input.retrieverId, `${label}.retrieverId`);
  const profileId = canonicalId(input.profileId, `${label}.profileId`);
  const descriptor = descriptorById.get(retrieverId);
  const profile = profileById.get(profileId);
  if (descriptor === undefined)
    throw new TypeError(`${label} names unknown retriever ${retrieverId}.`);
  if (profile === undefined)
    throw new TypeError(`${label} names unknown profile ${profileId}.`);
  const queryId = input.queryId === undefined ? undefined : boundedString(input.queryId, `${label}.queryId`, 256);
  if (profile.scope === "query" !== (queryId !== undefined)) {
    throw new TypeError(`${label}.queryId presence must match the measurement profile scope.`);
  }
  if (queryId !== undefined) {
    const query = queryById.get(queryId);
    if (query === undefined)
      throw new TypeError(`${label} names unknown query ${queryId}.`);
    if (split !== "all" && query.split !== split)
      throw new TypeError(`${label} query is outside the report split.`);
  }
  const repetition = safeInteger(input.repetition, `${label}.repetition`, 1, profile.repetitions);
  const concurrencyBatchIdentity = input.concurrencyBatchIdentity === undefined ? undefined : bridgeString(input.concurrencyBatchIdentity, `${label}.concurrencyBatchIdentity`, 512);
  if (profile.operation === "four-reader-query") {
    if (concurrencyBatchIdentity !== experiment.environment.fourReaderBatch.id) {
      throw new TypeError(`${label}.concurrencyBatchIdentity must match the digest-covered four-reader batch identity.`);
    }
  } else if (concurrencyBatchIdentity !== undefined) {
    throw new TypeError(`${label}.concurrencyBatchIdentity is reserved for four-reader samples.`);
  }
  if (input.status !== "degraded" && input.status !== "failed" && input.status !== "ready" && input.status !== "unavailable") {
    throw new TypeError(`${label}.status is invalid.`);
  }
  const timingsInput = record(input.timings, `${label}.timings`);
  strictKeys(timingsInput, ["elapsedMs", "indexMs", "packingMs", "queryMs", "updateMs"], `${label}.timings`);
  const timings = Object.freeze({
    elapsedMs: nonnegativeNumber(timingsInput.elapsedMs, `${label}.timings.elapsedMs`),
    indexMs: nonnegativeNumber(timingsInput.indexMs, `${label}.timings.indexMs`),
    updateMs: nonnegativeNumber(timingsInput.updateMs, `${label}.timings.updateMs`),
    queryMs: nonnegativeNumber(timingsInput.queryMs, `${label}.timings.queryMs`),
    packingMs: nonnegativeNumber(timingsInput.packingMs, `${label}.timings.packingMs`)
  });
  let failure;
  if (input.failure !== undefined) {
    const failureInput = record(input.failure, `${label}.failure`);
    strictKeys(failureInput, ["kind", "message"], `${label}.failure`);
    if (failureInput.kind !== "exception" && failureInput.kind !== "invalid-result" && failureInput.kind !== "timeout") {
      throw new TypeError(`${label}.failure.kind is invalid.`);
    }
    failure = Object.freeze({
      kind: failureInput.kind,
      message: boundedString(failureInput.message, `${label}.failure.message`, 2000)
    });
  }
  if (input.status === "failed" !== (failure !== undefined)) {
    throw new TypeError(`${label} failed status and failure details must occur together.`);
  }
  const trace = parseTrace(input.trace, descriptor, evidenceById, documentById, familyById);
  const rawEvidence = parseLaneNativeEvidence(input.rawEvidence, trace);
  if (input.status === "failed") {
    if (trace.candidateDecisions.length > 0 || trace.laneOutcomes.some(({ rawRanking }) => rawRanking.length > 0)) {
      throw new TypeError(`${label} failed samples cannot retain rankings or candidate decisions.`);
    }
  } else {
    const applied = trace.laneOutcomes.filter(({ applicability }) => applicability === "applied");
    const laneStatus = applied.length === 0 || applied.every(({ status }) => status === "unavailable") ? "unavailable" : applied.some(({ status }) => status !== "ready") ? "degraded" : "ready";
    if (input.status !== laneStatus) {
      throw new TypeError(`${label} status must reconcile with its locked lane outcomes.`);
    }
  }
  const resources = parseResources(input.resources, experiment.protocol.contextCeilings);
  const packedContextTrace = parsePackedContextTrace(input.packedContextTrace, profile, input.status, trace, resources.packedContext);
  return Object.freeze({
    retrieverId,
    profileId,
    ...queryId === undefined ? {} : { queryId },
    repetition,
    ...concurrencyBatchIdentity === undefined ? {} : { concurrencyBatchIdentity },
    status: input.status,
    timings,
    resources,
    trace,
    rawEvidence,
    ...packedContextTrace === undefined ? {} : { packedContextTrace },
    ...failure === undefined ? {} : { failure }
  });
}
function sampleKey(sample) {
  return `${sample.retrieverId}\x00${sample.profileId}\x00${sample.queryId ?? ""}\x00${sample.repetition}`;
}
function compareSamples(left, right) {
  return left.retrieverId.localeCompare(right.retrieverId) || left.profileId.localeCompare(right.profileId) || (left.queryId ?? "").localeCompare(right.queryId ?? "") || left.repetition - right.repetition;
}
function boundedJsonByteSize(value, maximum, label) {
  const stack = [value];
  let bytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      bytes += Buffer.byteLength(JSON.stringify(current), "utf8");
    } else if (typeof current === "number") {
      bytes += Number.isFinite(current) ? Buffer.byteLength(JSON.stringify(current), "utf8") : 8;
    } else if (typeof current === "boolean" || current === null || current === undefined) {
      bytes += current === true ? 4 : 5;
    } else if (Array.isArray(current)) {
      bytes += Math.max(0, current.length - 1) + 2;
      if (bytes > maximum)
        throw new TypeError(`${label} exceeds its aggregate UTF-8 byte bound.`);
      for (const entry of current)
        stack.push(entry);
    } else if (typeof current === "object") {
      const entries = Object.entries(current);
      bytes += Math.max(0, entries.length - 1) + 2;
      if (bytes > maximum)
        throw new TypeError(`${label} exceeds its aggregate UTF-8 byte bound.`);
      for (const [key, entry] of entries) {
        bytes += Buffer.byteLength(JSON.stringify(key), "utf8") + 1;
        if (bytes > maximum)
          throw new TypeError(`${label} exceeds its aggregate UTF-8 byte bound.`);
        stack.push(entry);
      }
    } else {
      bytes += 16;
    }
    if (bytes > maximum)
      throw new TypeError(`${label} exceeds its aggregate UTF-8 byte bound.`);
  }
  return bytes;
}
function preflightReportTraceBounds(samples) {
  let traceItems = 0;
  let provenanceItems = 0;
  let rawEvidenceItems = 0;
  let packedContextItems = 0;
  let traceBytes = 0;
  let provenanceBytes = 0;
  let rawEvidenceBytes = 0;
  let packedContextBytes = 0;
  for (const [sampleIndex, sampleValue] of samples.entries()) {
    const sample = record(sampleValue, `samples[${sampleIndex}]`);
    const trace = record(sample.trace, `samples[${sampleIndex}].trace`);
    const laneOutcomes = Array.isArray(trace.laneOutcomes) ? trace.laneOutcomes : [];
    const decisions = Array.isArray(trace.candidateDecisions) ? trace.candidateDecisions : [];
    traceItems += laneOutcomes.length + decisions.length;
    if (traceItems > MAX_EVALUATION_V2_REPORT_TRACE_ITEMS) {
      throw new TypeError("evaluation report exceeds the aggregate trace item bound.");
    }
    const provenanceCollections = [];
    for (const laneValue of laneOutcomes) {
      const lane = record(laneValue, `samples[${sampleIndex}].trace lane`);
      const rawRanking = Array.isArray(lane.rawRanking) ? lane.rawRanking : [];
      traceItems += rawRanking.length;
      if (traceItems > MAX_EVALUATION_V2_REPORT_TRACE_ITEMS) {
        throw new TypeError("evaluation report exceeds the aggregate trace item bound.");
      }
      for (const rankedValue of rawRanking) {
        const ranked = record(rankedValue, `samples[${sampleIndex}].trace raw ranking`);
        if (ranked.provenance !== undefined)
          provenanceCollections.push(ranked.provenance);
      }
    }
    for (const decisionValue of decisions) {
      const decision = record(decisionValue, `samples[${sampleIndex}].trace decision`);
      if (decision.provenance !== undefined)
        provenanceCollections.push(decision.provenance);
    }
    traceBytes += boundedJsonByteSize(trace, MAX_EVALUATION_V2_REPORT_TRACE_BYTES - traceBytes, "evaluation report trace");
    for (const provenanceValue of provenanceCollections) {
      if (Array.isArray(provenanceValue))
        provenanceItems += provenanceValue.length;
      if (provenanceItems > MAX_EVALUATION_V2_REPORT_PROVENANCE_ITEMS) {
        throw new TypeError("evaluation report exceeds the aggregate provenance item bound.");
      }
      provenanceBytes += boundedJsonByteSize(provenanceValue, MAX_EVALUATION_V2_REPORT_PROVENANCE_BYTES - provenanceBytes, "evaluation report provenance");
    }
    const rawEvidence = Array.isArray(sample.rawEvidence) ? sample.rawEvidence : [];
    rawEvidenceItems += rawEvidence.length;
    if (rawEvidenceItems > MAX_EVALUATION_V2_REPORT_RAW_EVIDENCE_ITEMS) {
      throw new TypeError("evaluation report exceeds the aggregate lane-native evidence item bound.");
    }
    rawEvidenceBytes += boundedJsonByteSize(rawEvidence, MAX_EVALUATION_V2_REPORT_RAW_EVIDENCE_BYTES - rawEvidenceBytes, "evaluation report lane-native evidence");
    if (sample.packedContextTrace !== undefined) {
      const packedContextTrace = record(sample.packedContextTrace, `samples[${sampleIndex}].packedContextTrace`);
      if (Array.isArray(packedContextTrace.evidenceUnitIds)) {
        packedContextItems += packedContextTrace.evidenceUnitIds.length;
      }
      if (packedContextItems > MAX_EVALUATION_V2_REPORT_PACKED_CONTEXT_ITEMS) {
        throw new TypeError("evaluation report exceeds the aggregate packed-context evidence item bound.");
      }
      packedContextBytes += boundedJsonByteSize(packedContextTrace, MAX_EVALUATION_V2_REPORT_PACKED_CONTEXT_BYTES - packedContextBytes, "evaluation report packed-context trace");
    }
  }
}
function expectedSampleCardinality(corpus, queryCount) {
  let perRetriever = 0;
  for (const profile of corpus.measurementProfiles) {
    const targets = profile.scope === "query" ? queryCount : 1;
    const profileCount = targets * profile.repetitions;
    if (!Number.isSafeInteger(profileCount) || profileCount > MAX_EVALUATION_V2_SAMPLES) {
      throw new TypeError("evaluation report expected sample matrix exceeds the supported cardinality.");
    }
    perRetriever += profileCount;
    if (!Number.isSafeInteger(perRetriever) || perRetriever > MAX_EVALUATION_V2_SAMPLES) {
      throw new TypeError("evaluation report expected sample matrix exceeds the supported cardinality.");
    }
  }
  const total = perRetriever * corpus.retrievers.length;
  if (!Number.isSafeInteger(total) || total > MAX_EVALUATION_V2_SAMPLES) {
    throw new TypeError("evaluation report expected sample matrix exceeds the supported cardinality.");
  }
  return total;
}
function parseRetrievalEvaluationReportV2(inputValue, corpus) {
  const input = record(inputValue, "evaluation v2 report");
  strictKeys(input, ["candidateLockSha256", "samples", "schemaVersion", "split", "suiteSha256"], "evaluation v2 report");
  if (input.schemaVersion !== 2)
    throw new TypeError("evaluation v2 report schemaVersion must be 2.");
  const suiteSha256 = requireSha256(input.suiteSha256, "report.suiteSha256");
  const candidateLockSha256 = requireSha256(input.candidateLockSha256, "report.candidateLockSha256");
  if (suiteSha256 !== corpus.manifest.corpusSha256 || candidateLockSha256 !== corpus.manifest.candidateLockSha256) {
    throw new TypeError("evaluation report commitments do not match the sealed corpus and candidate lock.");
  }
  if (input.split !== "all" && input.split !== "development" && input.split !== "test") {
    throw new TypeError("evaluation report split is invalid.");
  }
  const split = input.split;
  if (!Array.isArray(input.samples) || input.samples.length < 1 || input.samples.length > MAX_EVALUATION_V2_SAMPLES) {
    throw new TypeError("evaluation report samples must be a non-empty bounded array.");
  }
  const queries = corpus.queries.filter((query) => split === "all" || query.split === split);
  const expectedCount = expectedSampleCardinality(corpus, queries.length);
  if (input.samples.length !== expectedCount) {
    throw new TypeError("evaluation report sample matrix is incomplete or contains an unexpected sample.");
  }
  preflightReportTraceBounds(input.samples);
  const descriptorById = new Map(corpus.retrievers.map((descriptor) => [descriptor.id, descriptor]));
  const profileById = new Map(corpus.measurementProfiles.map((profile) => [profile.id, profile]));
  const queryById = new Map(corpus.queries.map((query) => [query.id, query]));
  const evidenceById = new Map(corpus.evidenceUnits.map((unit) => [unit.id, unit]));
  const documentById = new Map(corpus.documents.map((document) => [document.id, document]));
  const familyById = new Map(corpus.sourceFamilies.map((family) => [family.id, family]));
  const samples = input.samples.map((sample, index) => parseSample(sample, index, split, descriptorById, profileById, queryById, evidenceById, documentById, familyById, corpus.experiment));
  if (new Set(samples.map(sampleKey)).size !== samples.length) {
    throw new TypeError("evaluation report repeats a retriever/profile/query/repetition sample.");
  }
  const sorted = samples.toSorted(compareSamples);
  if (samples.some((sample, index) => sampleKey(sample) !== sampleKey(sorted[index]))) {
    throw new TypeError("evaluation report samples must be in canonical order.");
  }
  return Object.freeze({
    schemaVersion: 2,
    suiteSha256,
    candidateLockSha256,
    split,
    samples: Object.freeze(samples)
  });
}

// src/evaluation-corpus-authoring.ts
var ZERO_SHA256 = "0".repeat(64);
var SHA256_PATTERN = /^[0-9a-f]{64}$/u;
var DEFAULT_NGRAM_SIZE = 3;
var DEFAULT_CROSS_SPLIT_NGRAM_THRESHOLD = 0.8;
var DEFAULT_LABEL_PREDICTABILITY_CEILING = 0.65;
var LABEL_PREDICTABILITY_CLASSIFIER = "leave-one-out-token-jaccard-1nn-v1";
var MIN_SOURCE_FAMILY_RATIONALE_BYTES = 24;
var MAX_SOURCE_FAMILY_RATIONALE_BYTES = 2048;
var MAX_SOURCE_FAMILY_REVIEWERS = 32;
var MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES = 256;

class AuthoringFailure extends Error {
  code;
  queryKeys;
  sourcePaths;
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthoringFailure";
    this.code = code;
    this.queryKeys = details.queryKeys;
    this.sourcePaths = details.sourcePaths;
  }
}
function compareText2(left, right) {
  return left.localeCompare(right);
}
function uniqueSorted(values) {
  return Object.freeze([...new Set(values)].toSorted(compareText2));
}
function canonicalJson2(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical input contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map(canonicalJson2).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const input = value;
    return `{${Object.keys(input).toSorted(compareText2).map((key) => `${JSON.stringify(key)}:${canonicalJson2(input[key])}`).join(",")}}`;
  }
  throw new TypeError("Canonical input must be JSON-compatible.");
}
function framedDigest(domain, fields) {
  const digest = createHash3("sha256");
  digest.update(`${domain}\x00`, "utf8");
  for (const field of fields) {
    const bytes = Buffer.from(field, "utf8");
    digest.update(`${bytes.byteLength}:`, "utf8");
    digest.update(bytes);
    digest.update("\x00", "utf8");
  }
  return digest.digest("hex");
}
function opaqueId(prefix, fields) {
  return `${prefix}-${framedDigest(`promotion-corpus-${prefix}-v1`, fields).slice(0, 16)}`;
}
function authoredKey(value, label) {
  if (typeof value !== "string" || value.trim() === "" || /[\0\r\n]/u.test(value) || value.normalize("NFC") !== value || Buffer.byteLength(value, "utf8") > 4096)
    throw new AuthoringFailure("invalid-authoring-key", `${label} must be a non-empty NFC single-line string.`);
  return value;
}
function canonicalReviewerIds(value, label) {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_SOURCE_FAMILY_REVIEWERS) {
    throw new AuthoringFailure("invalid-source-family-reviewers", `${label} must contain from 2 through ${MAX_SOURCE_FAMILY_REVIEWERS} independent reviewer IDs.`);
  }
  const reviewerIds = value.map((reviewerId, index) => {
    const id = authoredKey(reviewerId, `${label}[${index}]`);
    if (Buffer.byteLength(id, "utf8") > MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES) {
      throw new AuthoringFailure("invalid-source-family-reviewers", `${label}[${index}] exceeds ${MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES} UTF-8 bytes.`);
    }
    return id;
  });
  const canonical = reviewerIds.toSorted(compareText2);
  if (!sameStrings(reviewerIds, canonical)) {
    throw new AuthoringFailure("noncanonical-source-family-reviewers", `${label} must be in canonical order.`);
  }
  if (new Set(reviewerIds).size !== reviewerIds.length) {
    throw new AuthoringFailure("duplicate-source-family-reviewers", `${label} must contain distinct reviewer IDs.`);
  }
  return Object.freeze(reviewerIds);
}
function canonicalSourceFamilyReview(document, index, declaredReviewerIds) {
  const hasRationale = document.sourceFamilyRationale !== undefined;
  const hasReviewers = document.sourceFamilyReviewerIds !== undefined;
  if (!hasRationale && !hasReviewers)
    return;
  if (!hasRationale || !hasReviewers) {
    throw new AuthoringFailure("incomplete-source-family-review", `documents[${index}] must declare both sourceFamilyRationale and sourceFamilyReviewerIds.`, { sourcePaths: [document.sourcePath] });
  }
  if (declaredReviewerIds === undefined) {
    throw new AuthoringFailure("missing-source-family-review-protocol", `documents[${index}] has reviewed family metadata but reviewPolicy.sourceFamilyAssignment is absent.`, { sourcePaths: [document.sourcePath] });
  }
  const rationale = document.sourceFamilyRationale;
  if (typeof rationale !== "string" || rationale.normalize("NFC") !== rationale || rationale.trim() !== rationale || rationale.includes("\x00") || Buffer.byteLength(rationale, "utf8") < MIN_SOURCE_FAMILY_RATIONALE_BYTES || Buffer.byteLength(rationale, "utf8") > MAX_SOURCE_FAMILY_RATIONALE_BYTES) {
    throw new AuthoringFailure("invalid-source-family-rationale", `documents[${index}].sourceFamilyRationale must be trimmed NFC text from ${MIN_SOURCE_FAMILY_RATIONALE_BYTES} through ${MAX_SOURCE_FAMILY_RATIONALE_BYTES} UTF-8 bytes.`, { sourcePaths: [document.sourcePath] });
  }
  const reviewerIds = canonicalReviewerIds(document.sourceFamilyReviewerIds, `documents[${index}].sourceFamilyReviewerIds`);
  const declared = new Set(declaredReviewerIds);
  const undeclared = reviewerIds.filter((reviewerId) => !declared.has(reviewerId));
  if (undeclared.length > 0) {
    throw new AuthoringFailure("undeclared-source-family-reviewers", `documents[${index}] names undeclared family reviewers: ${undeclared.join(", ")}.`, { sourcePaths: [document.sourcePath] });
  }
  return Object.freeze({ rationale, reviewerIds });
}
function canonicalSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be 64 lowercase hexadecimal characters.`);
  }
  return value;
}
function confinedPath2(value, label) {
  if (typeof value !== "string" || value === "" || value.normalize("NFC") !== value || /[\0\r\n\\]/u.test(value) || value.startsWith("/") || value.startsWith("./") || /^[a-z]:[\\/]/iu.test(value) || value.split("/").some((part) => part === "" || part === "." || part === ".."))
    throw new AuthoringFailure("invalid-source-path", `${label} must be a canonical confined repository-relative path.`);
  return value;
}
function sameStrings(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
function sameRange(left, right) {
  return left.start === right.start && left.end === right.end;
}
function selectorLabel(selector) {
  const position = selector.lineRange === undefined ? `${selector.kind ?? "unit"} exact text` : `lines ${selector.lineRange.start}-${selector.lineRange.end}`;
  return `${selector.sourcePath} (${position})`;
}
function resolveSelector(selector, context) {
  const sourcePath = confinedPath2(selector.sourcePath, "evidence selector sourcePath");
  const hasLineRange = selector.lineRange !== undefined;
  const hasExactText = selector.exactText !== undefined;
  if (!hasLineRange && !hasExactText) {
    throw new AuthoringFailure("selector-incomplete", `Evidence selector ${sourcePath} must supply exactText or an explicit lineRange.`, { sourcePaths: [sourcePath] });
  }
  if (!hasLineRange && selector.kind === undefined) {
    throw new AuthoringFailure("selector-incomplete", `Exact-text selector ${sourcePath} must name its evidence-unit kind.`, { sourcePaths: [sourcePath] });
  }
  if (selector.headingPath !== undefined && selector.heading !== undefined && selector.headingPath.at(-1) !== selector.heading) {
    throw new AuthoringFailure("selector-inconsistent-heading", `Evidence selector ${sourcePath} has inconsistent heading and headingPath guards.`, { sourcePaths: [sourcePath] });
  }
  const document = context.registryDocumentsByPath.get(sourcePath);
  if (document === undefined) {
    throw new AuthoringFailure("selector-source-missing", `Evidence selector names unknown frozen source ${sourcePath}.`, { sourcePaths: [sourcePath] });
  }
  if (selector.expectedSourceSha256 !== undefined && selector.expectedSourceSha256 !== document.sourceSha256) {
    throw new AuthoringFailure("selector-source-drift", `Frozen source ${sourcePath} drifted from selector source commitment ${selector.expectedSourceSha256}.`, { sourcePaths: [sourcePath] });
  }
  const matches = context.registry.units.filter((unit2) => unit2.sourcePath === sourcePath && (selector.kind === undefined || unit2.kind === selector.kind) && (selector.headingPath === undefined || sameStrings(unit2.headingAncestry, selector.headingPath)) && (selector.heading === undefined || unit2.headingAncestry.at(-1) === selector.heading) && (selector.exactText === undefined || unit2.text === selector.exactText) && (selector.lineRange === undefined || sameRange(unit2.lineRange, selector.lineRange)));
  if (matches.length === 0) {
    throw new AuthoringFailure(selector.expectedUnitId === undefined ? "selector-zero-or-drifted-match" : "selector-unit-drift", `Evidence selector ${selectorLabel(selector)} resolved to zero registry units; the selector is stale or does not match the frozen Markdown exactly.`, { sourcePaths: [sourcePath] });
  }
  if (matches.length > 1) {
    throw new AuthoringFailure("selector-ambiguous", `Evidence selector ${selectorLabel(selector)} resolved to ${matches.length} registry units. Add an exact heading, kind, text, or range guard.`, { sourcePaths: [sourcePath] });
  }
  const unit = matches[0];
  if (unit === undefined)
    throw new Error("Unique evidence selector resolution was lost.");
  if (selector.expectedUnitId !== undefined && selector.expectedUnitId !== unit.id || selector.expectedUnitSha256 !== undefined && selector.expectedUnitSha256 !== unit.sha256 || selector.expectedByteRange !== undefined && !sameRange(selector.expectedByteRange, unit.byteRange)) {
    throw new AuthoringFailure("selector-unit-drift", `Evidence selector ${selectorLabel(selector)} matched a unit whose ID, bytes, or hash drifted from its review commitment.`, { sourcePaths: [sourcePath] });
  }
  const existing = context.resolvedByRegistryId.get(unit.id);
  if (existing !== undefined)
    return existing;
  const corpusDocument = context.corpusDocumentsByPath.get(sourcePath);
  if (corpusDocument === undefined)
    throw new Error(`Resolved source ${sourcePath} lost its corpus declaration.`);
  if (Buffer.byteLength(unit.text, "utf8") !== unit.byteRange.end - unit.byteRange.start) {
    throw new Error(`Evidence unit ${unit.id} lost UTF-8 byte fidelity.`);
  }
  const resolved = Object.freeze({
    corpusEvidenceUnitId: unit.id,
    registryUnitId: unit.id,
    parserVersion: unit.parserVersion,
    kind: unit.kind,
    documentId: corpusDocument.documentId,
    sourcePath: unit.sourcePath,
    byteRange: Object.freeze({ ...unit.byteRange }),
    lineRange: Object.freeze({ ...unit.lineRange }),
    headingPath: Object.freeze([...unit.headingAncestry]),
    ...unit.pdfPage === undefined ? {} : { sourcePage: unit.pdfPage },
    unitSha256: unit.sha256,
    sourceSha256: document.sourceSha256,
    trustClass: unit.trustClass,
    exactText: unit.text
  });
  context.resolvedByRegistryId.set(unit.id, resolved);
  return resolved;
}
function canonicalInputs(inputs) {
  const filters = inputs.metadata?.filters.map((filter) => filter.kind === "exists" ? Object.freeze({ kind: "exists", path: filter.path }) : Object.freeze({ kind: "equals", path: filter.path, value: filter.value }));
  const canonicalFilters = filters === undefined ? undefined : Object.freeze([...new Map(filters.map((filter) => [canonicalJson2(filter), filter])).values()].toSorted((left, right) => compareText2(canonicalJson2(left), canonicalJson2(right))));
  return Object.freeze({
    text: inputs.text,
    ...inputs.context === undefined ? {} : { context: Object.freeze({ repositoryPath: inputs.context.repositoryPath }) },
    ...inputs.graph === undefined ? {} : { graph: Object.freeze({ seeds: uniqueSorted(inputs.graph.seeds), depth: inputs.graph.depth }) },
    ...inputs.history === undefined ? {} : {
      history: Object.freeze({
        query: inputs.history.query,
        noteIds: uniqueSorted(inputs.history.noteIds)
      })
    },
    ...inputs.metadata === undefined || canonicalFilters === undefined ? {} : {
      metadata: Object.freeze({
        filters: canonicalFilters,
        tags: uniqueSorted(inputs.metadata.tags)
      })
    },
    ...inputs.noteId === undefined ? {} : { noteId: inputs.noteId }
  });
}
function canonicalOrigins(origins, queryKey) {
  const byLane = new Map;
  for (const origin of origins) {
    const previous = byLane.get(origin.lane);
    if (previous !== undefined && previous.origin !== origin.origin) {
      throw new AuthoringFailure("conflicting-input-origin", `Question ${queryKey} supplies conflicting origins for ${origin.lane}.`, { queryKeys: [queryKey] });
    }
    byLane.set(origin.lane, Object.freeze({ lane: origin.lane, origin: origin.origin }));
  }
  return Object.freeze([...byLane.values()].toSorted((left, right) => compareText2(left.lane, right.lane)));
}
function canonicalJudgments(judgments, id, label) {
  const byId = new Map;
  for (const judgment of judgments) {
    const key = id(judgment);
    const previous = byId.get(key);
    if (previous !== undefined && previous.relevance !== judgment.relevance) {
      throw new AuthoringFailure("conflicting-relevance-judgment", `${label} gives ${key} conflicting relevance grades.`);
    }
    byId.set(key, judgment);
  }
  return Object.freeze([...byId.values()].toSorted((left, right) => compareText2(id(left), id(right))));
}
function compileDocumentJudgments(judgments, documentsByPath, label) {
  const compiled = judgments.map((judgment) => {
    const sourcePath = confinedPath2(judgment.sourcePath, `${label} sourcePath`);
    const document = documentsByPath.get(sourcePath);
    if (document === undefined) {
      throw new AuthoringFailure("judgment-document-missing", `${label} names unknown frozen source ${sourcePath}.`, { sourcePaths: [sourcePath] });
    }
    return Object.freeze({ documentId: document.documentId, relevance: judgment.relevance });
  });
  return canonicalJudgments(compiled, ({ documentId }) => documentId, label);
}
function compileEvidenceJudgments(judgments, context, label) {
  const compiled = judgments.map((judgment) => Object.freeze({
    evidenceUnitId: resolveSelector(judgment.selector, context).corpusEvidenceUnitId,
    relevance: judgment.relevance
  }));
  return canonicalJudgments(compiled, ({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2, label);
}
function compileQuestion(question, context) {
  const queryKey = authoredKey(question.key, "question.key");
  const queryId = opaqueId("q", [queryKey]);
  const nuggetKeys = new Set;
  const supportKeys = new Set;
  const supportIdsByNugget = new Map;
  const nuggets = question.gold.nuggets.map((nugget) => {
    const nuggetKey = authoredKey(nugget.key, `question ${queryKey} nugget key`);
    if (nuggetKeys.has(nuggetKey)) {
      throw new AuthoringFailure("duplicate-nugget-key", `Question ${queryKey} repeats nugget key ${nuggetKey}.`, {
        queryKeys: [queryKey]
      });
    }
    nuggetKeys.add(nuggetKey);
    const supportIds = new Map;
    const acceptableSupportSets = nugget.acceptableSupportSets.map((supportSet) => {
      const supportKey = authoredKey(supportSet.key, `question ${queryKey} support-set key`);
      const scopedKey = `${nuggetKey}\x00${supportKey}`;
      if (supportKeys.has(scopedKey)) {
        throw new AuthoringFailure("duplicate-support-set-key", `Question ${queryKey} nugget ${nuggetKey} repeats support-set key ${supportKey}.`, { queryKeys: [queryKey] });
      }
      supportKeys.add(scopedKey);
      const supportId = opaqueId("ss", [queryKey, nuggetKey, supportKey]);
      supportIds.set(supportKey, supportId);
      const evidenceUnitIds = uniqueSorted(supportSet.evidence.map((selector) => resolveSelector(selector, context).corpusEvidenceUnitId));
      return Object.freeze({ id: supportId, evidenceUnitIds });
    }).toSorted((left, right) => compareText2(left.id, right.id));
    supportIdsByNugget.set(nuggetKey, supportIds);
    return Object.freeze({
      id: opaqueId("ng", [queryKey, nuggetKey]),
      text: nugget.text,
      required: nugget.required,
      acceptableSupportSets: Object.freeze(acceptableSupportSets)
    });
  }).toSorted((left, right) => compareText2(left.id, right.id));
  const gold = Object.freeze({
    documents: compileDocumentJudgments(question.gold.documents, context.corpusDocumentsByPath, `question ${queryKey} gold documents`),
    evidenceUnits: compileEvidenceJudgments(question.gold.evidenceUnits, context, `question ${queryKey} gold evidence`),
    nuggets: Object.freeze(nuggets)
  });
  const nuggetIdByKey = new Map(question.gold.nuggets.map((nugget) => [
    nugget.key,
    opaqueId("ng", [queryKey, nugget.key])
  ]));
  const nuggetRequiredByKey = new Map(question.gold.nuggets.map((nugget) => [nugget.key, nugget.required]));
  const assessorIds = new Set;
  const rawAssessments = question.rawAssessments.map((assessment) => {
    if (assessorIds.has(assessment.assessorId)) {
      throw new AuthoringFailure("duplicate-assessor-decision", `Question ${queryKey} repeats assessor ${assessment.assessorId}.`, { queryKeys: [queryKey] });
    }
    assessorIds.add(assessment.assessorId);
    const rawNuggetKeys = new Set;
    const rawNuggets = assessment.nuggets.map((decision) => {
      if (rawNuggetKeys.has(decision.nuggetKey)) {
        throw new AuthoringFailure("duplicate-assessor-nugget-decision", `Question ${queryKey} assessor ${assessment.assessorId} repeats nugget ${decision.nuggetKey}.`, { queryKeys: [queryKey] });
      }
      rawNuggetKeys.add(decision.nuggetKey);
      const nuggetId = nuggetIdByKey.get(decision.nuggetKey);
      const supportIds = supportIdsByNugget.get(decision.nuggetKey);
      if (nuggetId === undefined || supportIds === undefined) {
        throw new AuthoringFailure("assessor-nugget-missing", `Question ${queryKey} assessor ${assessment.assessorId} names unknown nugget ${decision.nuggetKey}.`, { queryKeys: [queryKey] });
      }
      const acceptableSupportSetIds = uniqueSorted(decision.acceptableSupportSetKeys.map((key) => {
        const id = supportIds.get(key);
        if (id === undefined) {
          throw new AuthoringFailure("assessor-support-set-missing", `Question ${queryKey} assessor ${assessment.assessorId} names unknown support set ${key}.`, { queryKeys: [queryKey] });
        }
        return id;
      }));
      return Object.freeze({
        nuggetId,
        required: decision.required ?? nuggetRequiredByKey.get(decision.nuggetKey) ?? true,
        acceptableSupportSetIds
      });
    }).toSorted((left, right) => compareText2(left.nuggetId, right.nuggetId));
    return Object.freeze({
      assessorId: assessment.assessorId,
      expectedSupport: assessment.expectedSupport,
      documents: compileDocumentJudgments(assessment.documents, context.corpusDocumentsByPath, `question ${queryKey} assessor ${assessment.assessorId} documents`),
      evidenceUnits: compileEvidenceJudgments(assessment.evidenceUnits, context, `question ${queryKey} assessor ${assessment.assessorId} evidence`),
      nuggets: Object.freeze(rawNuggets)
    });
  }).toSorted((left, right) => compareText2(left.assessorId, right.assessorId));
  const adjudication = question.adjudication.status === "resolved" ? Object.freeze({
    status: "resolved",
    adjudicatorId: question.adjudication.adjudicatorId,
    rationale: question.adjudication.rationale
  }) : Object.freeze({ status: question.adjudication.status });
  return Object.freeze({
    id: queryId,
    text: question.text,
    split: question.split,
    cohort: question.cohort,
    strata: uniqueSorted(question.strata),
    primaryStratum: question.primaryStratum,
    expectedSupport: question.expectedSupport,
    primaryLane: question.primaryLane,
    ...question.negativeSubtype === undefined ? {} : { negativeSubtype: question.negativeSubtype },
    inputs: canonicalInputs(question.inputs),
    inputOrigins: canonicalOrigins(question.inputOrigins, queryKey),
    gold,
    rawAssessments: Object.freeze(rawAssessments),
    adjudication
  });
}
function cloneExperiment(experiment) {
  const effects = new Map;
  for (const effect of experiment.protocol.minimumUsefulEffects) {
    const cloned = Object.freeze({
      metric: effect.metric,
      cohort: effect.cohort,
      minimumAbsoluteDifference: effect.minimumAbsoluteDifference
    });
    const key = `${effect.metric}:${effect.cohort}`;
    const previous = effects.get(key);
    if (previous !== undefined) {
      throw new AuthoringFailure(canonicalJson2(previous) === canonicalJson2(cloned) ? "duplicate-minimum-useful-effect" : "conflicting-minimum-useful-effect", `Experiment metric ${effect.metric} repeats a minimum useful effect for ${effect.cohort}.`);
    }
    effects.set(key, cloned);
  }
  const margins = new Map;
  for (const margin of experiment.protocol.nonInferiorityMargins) {
    const cloned = Object.freeze({
      metric: margin.metric,
      maximumAbsoluteRegression: margin.maximumAbsoluteRegression,
      maximumRelativeRegression: margin.maximumRelativeRegression
    });
    const previous = margins.get(margin.metric);
    if (previous !== undefined && canonicalJson2(previous) !== canonicalJson2(cloned)) {
      throw new AuthoringFailure("conflicting-non-inferiority-margin", `Experiment metric ${margin.metric} has conflicting non-inferiority margins.`);
    }
    margins.set(margin.metric, cloned);
  }
  const localModel = experiment.environment.localModel.kind === "none" ? Object.freeze({ kind: "none" }) : Object.freeze({
    kind: "model",
    id: experiment.environment.localModel.id,
    sha256: experiment.environment.localModel.sha256
  });
  return Object.freeze({
    protocol: Object.freeze({
      minimumUsefulEffects: Object.freeze([...effects.values()].toSorted((left, right) => compareText2(`${left.metric}:${left.cohort}`, `${right.metric}:${right.cohort}`))),
      nonInferiorityMargins: Object.freeze([...margins.values()].toSorted((left, right) => compareText2(left.metric, right.metric))),
      contextCeilings: Object.freeze({
        utf8Bytes: experiment.protocol.contextCeilings.utf8Bytes,
        readerTokens: experiment.protocol.contextCeilings.readerTokens
      }),
      pairedPower: Object.freeze({
        alpha: experiment.protocol.pairedPower.alpha,
        targetPower: experiment.protocol.pairedPower.targetPower,
        assumedDiscordantRate: experiment.protocol.pairedPower.assumedDiscordantRate,
        assumedEffect: experiment.protocol.pairedPower.assumedEffect,
        minimumUsefulEffect: experiment.protocol.pairedPower.minimumUsefulEffect,
        requiredPairs: experiment.protocol.pairedPower.requiredPairs
      })
    }),
    environment: Object.freeze({
      tokenizer: Object.freeze({
        id: experiment.environment.tokenizer.id,
        sha256: experiment.environment.tokenizer.sha256
      }),
      runtime: Object.freeze({
        id: experiment.environment.runtime.id,
        sha256: experiment.environment.runtime.sha256
      }),
      hardware: Object.freeze({ id: experiment.environment.hardware.id }),
      localModel,
      cache: Object.freeze({
        preparation: experiment.environment.cache.preparation,
        fingerprintSha256: experiment.environment.cache.fingerprintSha256
      }),
      fourReaderBatch: Object.freeze({
        id: experiment.environment.fourReaderBatch.id,
        sha256: experiment.environment.fourReaderBatch.sha256
      }),
      incrementalMutation: Object.freeze({
        sourcePath: experiment.environment.incrementalMutation.sourcePath,
        appendUtf8Sha256: experiment.environment.incrementalMutation.appendUtf8Sha256,
        expectedPostMutationSha256: experiment.environment.incrementalMutation.expectedPostMutationSha256
      })
    })
  });
}
function cloneAssessors(assessors) {
  const byId = new Map;
  for (const assessor of assessors) {
    const cloned = Object.freeze({
      id: assessor.id,
      ...assessor.displayName === undefined ? {} : { displayName: assessor.displayName },
      ...assessor.affiliation === undefined ? {} : { affiliation: assessor.affiliation }
    });
    const previous = byId.get(assessor.id);
    if (previous !== undefined && canonicalJson2(previous) !== canonicalJson2(cloned)) {
      throw new AuthoringFailure("conflicting-assessor", `Assessor ${assessor.id} has conflicting declarations.`);
    }
    byId.set(assessor.id, cloned);
  }
  return Object.freeze([...byId.values()].toSorted((left, right) => compareText2(left.id, right.id)));
}
function cloneMeasurementProfiles(profiles) {
  const byId = new Map;
  for (const profile of profiles) {
    const cloned = Object.freeze({
      id: profile.id,
      operation: profile.operation,
      scope: profile.scope,
      cacheState: profile.cacheState,
      concurrency: profile.concurrency,
      repetitions: profile.repetitions
    });
    const previous = byId.get(profile.id);
    if (previous !== undefined && canonicalJson2(previous) !== canonicalJson2(cloned)) {
      throw new AuthoringFailure("conflicting-measurement-profile", `Measurement profile ${profile.id} conflicts.`);
    }
    byId.set(profile.id, cloned);
  }
  return Object.freeze([...byId.values()].toSorted((left, right) => compareText2(left.id, right.id)));
}
function cloneRetrievers(retrievers) {
  const byId = new Map;
  for (const retriever of retrievers) {
    const configuration = {};
    for (const key of Object.keys(retriever.configuration).toSorted(compareText2)) {
      const value = retriever.configuration[key];
      if (value !== undefined)
        configuration[key] = value;
    }
    const cloned = Object.freeze({
      id: retriever.id,
      role: retriever.role,
      version: retriever.version,
      implementationSha256: retriever.implementationSha256,
      lanes: uniqueSorted(retriever.lanes),
      configuration: Object.freeze(configuration)
    });
    const previous = byId.get(retriever.id);
    if (previous !== undefined && canonicalJson2(previous) !== canonicalJson2(cloned)) {
      throw new AuthoringFailure("conflicting-retriever", `Retriever ${retriever.id} has conflicting descriptors.`);
    }
    byId.set(retriever.id, cloned);
  }
  return Object.freeze([...byId.values()].toSorted((left, right) => compareText2(left.id, right.id)));
}
function issueFromFailure(error) {
  if (error instanceof AuthoringFailure) {
    return Object.freeze({
      severity: "error",
      code: error.code,
      message: error.message,
      ...error.queryKeys === undefined ? {} : { queryKeys: Object.freeze([...error.queryKeys]) },
      ...error.sourcePaths === undefined ? {} : { sourcePaths: Object.freeze([...error.sourcePaths]) }
    });
  }
  return Object.freeze({
    severity: "error",
    code: "invalid-corpus-authoring-input",
    message: error instanceof Error ? error.message : String(error)
  });
}
function canonicalIssues(issues) {
  const byKey = new Map;
  for (const issue of issues) {
    byKey.set(canonicalJson2(issue), issue);
  }
  return Object.freeze([...byKey.values()].toSorted((left, right) => compareText2(left.code, right.code) || compareText2(left.message, right.message)));
}
function quotaEntry(id, label, rule, target, actual) {
  return Object.freeze({
    id,
    label,
    rule,
    target,
    actual,
    delta: actual - target,
    met: rule === "exact" ? actual === target : actual >= target
  });
}
function promotionCorpusQuotaLedgerV2(questions) {
  const development = questions.filter(({ split }) => split === "development");
  const test = questions.filter(({ split }) => split === "test");
  const rows = [
    quotaEntry("all-caller-seeded", "All caller-seeded questions", "exact", PROMOTION_COHORT_COUNT_V2, questions.filter(({ cohort }) => cohort === "caller-seeded").length),
    quotaEntry("all-questions", "All questions", "exact", PROMOTION_EVALUATION_QUERY_COUNT_V2, questions.length),
    quotaEntry("all-text-only", "All text-only questions", "exact", PROMOTION_COHORT_COUNT_V2, questions.filter(({ cohort }) => cohort === "text-only").length),
    quotaEntry("development-caller-seeded", "Development caller-seeded questions", "exact", 24, development.filter(({ cohort }) => cohort === "caller-seeded").length),
    quotaEntry("development-questions", "Development questions", "exact", PROMOTION_DEVELOPMENT_QUERY_COUNT_V2, development.length),
    quotaEntry("development-text-only", "Development text-only questions", "exact", 24, development.filter(({ cohort }) => cohort === "text-only").length),
    quotaEntry("dual-assessment", "Independently dual-assessed questions", "at-least", PROMOTION_DUAL_ASSESSMENT_MINIMUM_V2, questions.filter(({ rawAssessments }) => rawAssessments.length >= 2).length),
    quotaEntry("test-caller-seeded", "Test caller-seeded questions", "exact", PROMOTION_TEST_COHORT_COUNT_V2, test.filter(({ cohort }) => cohort === "caller-seeded").length),
    quotaEntry("test-insufficient", "Test insufficient questions", "exact", PROMOTION_TEST_INSUFFICIENT_COUNT_V2, test.filter(({ expectedSupport }) => expectedSupport === "insufficient").length),
    quotaEntry("test-questions", "Test questions", "exact", PROMOTION_TEST_QUERY_COUNT_V2, test.length),
    quotaEntry("test-supported", "Test supported questions", "exact", PROMOTION_TEST_SUPPORTED_COUNT_V2, test.filter(({ expectedSupport }) => expectedSupport === "supported").length),
    quotaEntry("test-text-only", "Test text-only questions", "exact", PROMOTION_TEST_COHORT_COUNT_V2, test.filter(({ cohort }) => cohort === "text-only").length),
    quotaEntry("test-support-stratum-consistency", "Test support and no-answer stratum consistency", "exact", PROMOTION_TEST_QUERY_COUNT_V2, test.filter((question) => question.expectedSupport === "insufficient" === question.strata.includes("no-answer-near-miss")).length)
  ];
  for (const cohort of ["caller-seeded", "text-only"]) {
    for (const expectedSupport of ["supported", "insufficient"]) {
      rows.push(quotaEntry(`development-${cohort}-${expectedSupport}`, `Development ${cohort} ${expectedSupport} questions`, "exact", 12, development.filter((question) => question.cohort === cohort && question.expectedSupport === expectedSupport).length));
    }
  }
  for (const cohort of ["caller-seeded", "text-only"]) {
    rows.push(quotaEntry(`test-${cohort}-supported`, `Test ${cohort} supported questions`, "exact", 40, test.filter((question) => question.cohort === cohort && question.expectedSupport === "supported").length));
    rows.push(quotaEntry(`test-${cohort}-insufficient`, `Test ${cohort} insufficient questions`, "exact", 20, test.filter((question) => question.cohort === cohort && question.expectedSupport === "insufficient").length));
  }
  for (const [stratum, minimum] of Object.entries(PROMOTION_CRITICAL_STRATUM_MINIMA_V2)) {
    rows.push(quotaEntry(`test-stratum-${stratum}`, `Test ${stratum} stratum`, "at-least", minimum, test.filter((question) => question.strata.includes(stratum)).length));
    rows.push(quotaEntry(`dual-stratum-${stratum}`, `Dual assessment covering ${stratum}`, "at-least", 1, questions.filter((question) => question.rawAssessments.length >= 2 && question.strata.includes(stratum)).length));
  }
  for (const [lane, minimum] of Object.entries(PROMOTION_CRITICAL_INPUT_MINIMA_V2)) {
    rows.push(quotaEntry(`test-input-${lane}`, `Test executable ${lane} inputs`, "at-least", minimum, test.filter((question) => question.inputs[lane] !== undefined).length));
  }
  for (const [stratum, minimum] of Object.entries(PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2)) {
    rows.push(quotaEntry(`test-primary-${stratum}`, `Test primary ${stratum} questions`, "at-least", minimum, test.filter((question) => question.primaryStratum === stratum).length));
    for (const cohort of ["caller-seeded", "text-only"]) {
      const cohortMinimum = PROMOTION_ACCEPTANCE_STRATUM_COHORT_MINIMA_V2[stratum];
      const cell = test.filter((question) => question.cohort === cohort && question.primaryStratum === stratum);
      rows.push(quotaEntry(`test-${cohort}-primary-${stratum}`, `Test ${cohort} primary ${stratum} questions`, "at-least", cohortMinimum, cell.length));
      const requiredDual = Math.max(PROMOTION_STRATUM_COHORT_DUAL_MINIMUM_V2, Math.ceil(cell.length * PROMOTION_STRATUM_COHORT_DUAL_FRACTION_V2));
      rows.push(quotaEntry(`dual-test-${cohort}-${stratum}`, `Dual assessment in test ${cohort} ${stratum} cell`, "at-least", requiredDual, cell.filter(({ rawAssessments }) => rawAssessments.length >= 2).length));
    }
  }
  for (const cohort of ["caller-seeded", "text-only"]) {
    const cell = test.filter((question) => question.cohort === cohort && question.strata.includes("no-answer-near-miss"));
    const requiredDual = Math.max(PROMOTION_STRATUM_COHORT_DUAL_MINIMUM_V2, Math.ceil(cell.length * PROMOTION_STRATUM_COHORT_DUAL_FRACTION_V2));
    rows.push(quotaEntry(`dual-test-${cohort}-no-answer-near-miss`, `Dual assessment in test ${cohort} no-answer near-miss cell`, "at-least", requiredDual, cell.filter(({ rawAssessments }) => rawAssessments.length >= 2).length));
  }
  return Object.freeze(rows.toSorted((left, right) => compareText2(left.id, right.id)));
}
function rounded(value) {
  return Number(value.toFixed(6));
}
function granularityRow(id, queryCount) {
  const fivePercentagePointEventCount = Math.max(1, Math.round(queryCount * 0.05));
  return Object.freeze({
    id,
    queryCount,
    oneOutcomeStep: Object.freeze({
      numerator: 1,
      denominator: queryCount,
      percentagePoints: rounded(100 / queryCount)
    }),
    fivePercentagePointEventCount,
    nearestObservableFivePointDelta: rounded(100 * fivePercentagePointEventCount / queryCount),
    representsFivePointsExactly: queryCount % 20 === 0
  });
}
function promotionCorpusPowerGranularityV2(questions) {
  const test = questions.filter(({ split }) => split === "test");
  const groups = new Map([
    ["development", questions.filter(({ split }) => split === "development").length],
    ["test", test.length],
    ["test-caller-seeded", test.filter(({ cohort }) => cohort === "caller-seeded").length],
    ["test-insufficient", test.filter(({ expectedSupport }) => expectedSupport === "insufficient").length],
    ["test-supported", test.filter(({ expectedSupport }) => expectedSupport === "supported").length],
    ["test-text-only", test.filter(({ cohort }) => cohort === "text-only").length]
  ]);
  for (const stratum of Object.keys(PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2)) {
    groups.set(`test-stratum-${stratum}`, test.filter((question) => question.primaryStratum === stratum).length);
  }
  groups.set("test-stratum-no-answer-near-miss", test.filter((question) => question.strata.includes("no-answer-near-miss")).length);
  const rows = [...groups.entries()].filter((entry) => entry[1] > 0).map(([id, count]) => granularityRow(id, count)).toSorted((left, right) => compareText2(left.id, right.id));
  return Object.freeze({
    status: "descriptive-only",
    note: "Outcome granularity is descriptive only. Promotion readiness comes from the sealed prospective paired-power design.",
    rows: Object.freeze(rows)
  });
}
function normalizedPrompt(text) {
  return text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
}
function ngrams(text, size) {
  const tokens = normalizedPrompt(text).split(" ").filter((token) => token !== "");
  if (tokens.length === 0)
    return new Set;
  if (tokens.length < size)
    return new Set([tokens.join(" ")]);
  const result = new Set;
  for (let index = 0;index <= tokens.length - size; index += 1) {
    result.add(tokens.slice(index, index + size).join(" "));
  }
  return result;
}
function jaccard(left, right) {
  if (left.size === 0 || right.size === 0)
    return 0;
  let intersection = 0;
  for (const gram of left)
    if (right.has(gram))
      intersection += 1;
  return intersection / (left.size + right.size - intersection);
}
function promptTokens(text) {
  return new Set(normalizedPrompt(text).split(" ").filter((token) => token !== ""));
}
function balancedAccuracy(questions, label) {
  const classes = uniqueSorted(questions.map(label));
  if (classes.length < 2 || questions.length < 3)
    return;
  const tokenSets = questions.map(({ text }) => promptTokens(text));
  const correctByClass = new Map(classes.map((class_) => [class_, 0]));
  const countByClass = new Map(classes.map((class_) => [class_, 0]));
  for (const [index, question] of questions.entries()) {
    const actual = label(question);
    countByClass.set(actual, (countByClass.get(actual) ?? 0) + 1);
    let nearestIndex;
    let nearestSimilarity = -1;
    for (const [candidateIndex, candidate] of questions.entries()) {
      if (candidateIndex === index)
        continue;
      const similarity = jaccard(tokenSets[index] ?? new Set, tokenSets[candidateIndex] ?? new Set);
      const nearest = nearestIndex === undefined ? undefined : questions[nearestIndex];
      if (similarity > nearestSimilarity || similarity === nearestSimilarity && nearest !== undefined && compareText2(candidate.key, nearest.key) < 0) {
        nearestIndex = candidateIndex;
        nearestSimilarity = similarity;
      }
    }
    if (nearestIndex !== undefined && label(questions[nearestIndex]) === actual) {
      correctByClass.set(actual, (correctByClass.get(actual) ?? 0) + 1);
    }
  }
  const recalls = classes.map((class_) => {
    const count = countByClass.get(class_) ?? 0;
    return count === 0 ? 0 : (correctByClass.get(class_) ?? 0) / count;
  });
  return Object.freeze({ classes, value: rounded(recalls.reduce((sum, value) => sum + value, 0) / recalls.length) });
}
function promotionCorpusLabelPredictabilityV2(questions, policy) {
  const ceiling = policy?.labelPredictabilityCeiling ?? DEFAULT_LABEL_PREDICTABILITY_CEILING;
  if (typeof ceiling !== "number" || !Number.isFinite(ceiling) || ceiling <= 0 || ceiling > DEFAULT_LABEL_PREDICTABILITY_CEILING) {
    throw new AuthoringFailure("invalid-review-policy", `reviewPolicy.labelPredictabilityCeiling cannot weaken the fixed ${DEFAULT_LABEL_PREDICTABILITY_CEILING} balanced-accuracy ceiling and must be positive.`);
  }
  const definitions = [
    ["cohort", (question) => question.cohort],
    ["expected-support", (question) => question.expectedSupport],
    ["split", (question) => question.split]
  ];
  const rows = definitions.flatMap(([labelName, value]) => {
    const result = balancedAccuracy(questions, value);
    if (result === undefined)
      return [];
    return [Object.freeze({
      label: labelName,
      classes: result.classes,
      balancedAccuracy: result.value,
      evaluatedQuestions: questions.length,
      ceiling,
      met: result.value <= ceiling
    })];
  });
  return Object.freeze({
    classifier: LABEL_PREDICTABILITY_CLASSIFIER,
    rows: Object.freeze(rows),
    met: rows.every(({ met }) => met)
  });
}
function promotionCorpusDiagnosticsV2(questions, experiment, policy, independentSourceFamilyClusters) {
  const quotaLedger = promotionCorpusQuotaLedgerV2(questions);
  const labelPredictability = promotionCorpusLabelPredictabilityV2(questions, policy);
  const eligibleCallerSeededSupportedTestPairs = questions.filter((question) => question.split === "test" && question.cohort === "caller-seeded" && question.expectedSupport === "supported").length;
  const pairedPower = Object.freeze({
    eligibleCallerSeededSupportedTestPairs,
    independentSourceFamilyClusters: independentSourceFamilyClusters ?? null,
    requiredPairs: experiment.protocol.pairedPower.requiredPairs,
    met: eligibleCallerSeededSupportedTestPairs >= experiment.protocol.pairedPower.requiredPairs && independentSourceFamilyClusters !== undefined && independentSourceFamilyClusters >= experiment.protocol.pairedPower.requiredPairs
  });
  return Object.freeze({
    quotaLedger,
    promotionLayoutReady: quotaLedger.every(({ met }) => met) && labelPredictability.met && pairedPower.met,
    labelPredictability,
    pairedPower,
    powerGranularity: promotionCorpusPowerGranularityV2(questions)
  });
}
function promptReviewIssues(questions, policy, enforceLabelPredictability) {
  const size = policy?.ngramSize ?? DEFAULT_NGRAM_SIZE;
  const threshold = policy?.crossSplitNgramThreshold ?? DEFAULT_CROSS_SPLIT_NGRAM_THRESHOLD;
  if (size !== DEFAULT_NGRAM_SIZE) {
    throw new AuthoringFailure("invalid-review-policy", `reviewPolicy.ngramSize cannot weaken the fixed ${DEFAULT_NGRAM_SIZE}-gram leakage review.`);
  }
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0 || threshold > DEFAULT_CROSS_SPLIT_NGRAM_THRESHOLD) {
    throw new AuthoringFailure("invalid-review-policy", `reviewPolicy.crossSplitNgramThreshold must be in (0, ${DEFAULT_CROSS_SPLIT_NGRAM_THRESHOLD}].`);
  }
  const issues = [];
  const normalizedGroups = new Map;
  for (const question of questions) {
    const normalized = normalizedPrompt(question.text);
    const group = normalizedGroups.get(normalized) ?? [];
    group.push(question);
    normalizedGroups.set(normalized, group);
  }
  for (const [normalized, group] of normalizedGroups) {
    if (normalized === "" || group.length < 2)
      continue;
    const spansEvaluationSplits = new Set(group.map(({ split }) => split)).size > 1;
    issues.push(Object.freeze({
      severity: spansEvaluationSplits ? "error" : "warning",
      code: spansEvaluationSplits ? "exact-cross-split-prompt-duplicate" : "duplicate-normalized-prompt",
      message: `Questions ${group.map(({ key }) => key).toSorted(compareText2).join(", ")} share the same normalized prompt${spansEvaluationSplits ? " across evaluation splits" : ""}.`,
      queryKeys: uniqueSorted(group.map(({ key }) => key))
    }));
  }
  const development = questions.filter(({ split }) => split === "development");
  const test = questions.filter(({ split }) => split === "test");
  const gramCache = new Map;
  for (const question of questions)
    gramCache.set(question, ngrams(question.text, size));
  for (const left of development) {
    for (const right of test) {
      if (normalizedPrompt(left.text) === normalizedPrompt(right.text))
        continue;
      const overlap = jaccard(gramCache.get(left) ?? new Set, gramCache.get(right) ?? new Set);
      if (overlap < threshold)
        continue;
      issues.push(Object.freeze({
        severity: "error",
        code: "high-cross-split-ngram-overlap",
        message: `Development question ${left.key} and test question ${right.key} have ${rounded(overlap)} ${size}-gram Jaccard overlap.`,
        queryKeys: uniqueSorted([left.key, right.key]),
        overlap: rounded(overlap)
      }));
    }
  }
  if (enforceLabelPredictability) {
    for (const row of promotionCorpusLabelPredictabilityV2(questions, policy).rows) {
      if (row.met)
        continue;
      issues.push(Object.freeze({
        severity: "error",
        code: "prompt-label-predictability-ceiling",
        message: `${row.label} is predictable from prompt text at balanced accuracy ${row.balancedAccuracy}, above the sealed ceiling ${row.ceiling} under ${LABEL_PREDICTABILITY_CLASSIFIER}.`
      }));
    }
  }
  return canonicalIssues(issues);
}
function familyReview(sourceDocuments, registry, queries, resolvedEvidence) {
  const errors = [];
  const warnings = [];
  const sourceByDocumentId = new Map(sourceDocuments.map((document) => [document.documentId, document]));
  const documentByEvidenceId = new Map(resolvedEvidence.map((unit) => [
    unit.corpusEvidenceUnitId,
    unit.documentId
  ]));
  const familySplits = new Map;
  const pathSplits = new Map;
  for (const query of queries) {
    const documentIds = new Set([
      ...query.gold.documents.map(({ documentId }) => documentId),
      ...query.gold.evidenceUnits.map(({ evidenceUnitId: evidenceUnitId2 }) => documentByEvidenceId.get(evidenceUnitId2) ?? "")
    ]);
    for (const documentId of documentIds) {
      const source = sourceByDocumentId.get(documentId);
      if (source === undefined)
        continue;
      const familyClusterId = source.familyAssignmentSha256 === undefined ? source.sourceFamilyId : `family-assignment:${source.familyAssignmentSha256}`;
      const splits = familySplits.get(familyClusterId) ?? new Set;
      splits.add(query.split);
      familySplits.set(familyClusterId, splits);
      const sourceSplits = pathSplits.get(source.sourcePath) ?? new Set;
      sourceSplits.add(query.split);
      pathSplits.set(source.sourcePath, sourceSplits);
    }
  }
  const familyKeyById = new Map(sourceDocuments.map((source) => [
    source.familyAssignmentSha256 === undefined ? source.sourceFamilyId : `family-assignment:${source.familyAssignmentSha256}`,
    source.sourceFamilyKey
  ]));
  for (const [familyId, splits] of familySplits) {
    if (splits.size < 2)
      continue;
    const familyKey = familyKeyById.get(familyId) ?? familyId;
    errors.push(Object.freeze({
      severity: "error",
      code: "source-family-split-leakage",
      message: `Source family ${familyKey} is judged in both development and test splits.`,
      sourceFamilyKeys: Object.freeze([familyKey])
    }));
  }
  for (const [sourcePath, splits] of pathSplits) {
    if (splits.size < 2)
      continue;
    errors.push(Object.freeze({
      severity: "error",
      code: "source-path-split-leakage",
      message: `Source path ${sourcePath} is judged in both development and test splits.`,
      sourcePaths: Object.freeze([sourcePath])
    }));
  }
  const snapshotByPath = new Map(registry.documents.map((document) => [document.sourcePath, document]));
  const documentsByFamily = new Map;
  for (const document of sourceDocuments) {
    const familyClusterId = document.familyAssignmentSha256 === undefined ? document.sourceFamilyId : `family-assignment:${document.familyAssignmentSha256}`;
    const group = documentsByFamily.get(familyClusterId) ?? [];
    group.push(document);
    documentsByFamily.set(familyClusterId, group);
  }
  const familiesByFingerprint = new Map;
  for (const [familyId, documents] of documentsByFamily) {
    const hashes = documents.map((document) => snapshotByPath.get(document.sourcePath)?.sourceSha256 ?? "").toSorted(compareText2);
    const fingerprint = framedDigest("promotion-corpus-source-family-copy-v1", hashes);
    const familyIds = familiesByFingerprint.get(fingerprint) ?? [];
    familyIds.push(familyId);
    familiesByFingerprint.set(fingerprint, familyIds);
  }
  for (const familyIds of familiesByFingerprint.values()) {
    if (familyIds.length < 2)
      continue;
    const familyKeys = uniqueSorted(familyIds.map((id) => familyKeyById.get(id) ?? id));
    const splits = new Set(familyIds.flatMap((id) => [...familySplits.get(id) ?? []]));
    const issue = Object.freeze({
      severity: splits.size > 1 ? "error" : "warning",
      code: splits.size > 1 ? "copied-source-family-cross-split" : "copied-source-family",
      message: `Distinct source-family keys ${familyKeys.join(", ")} contain byte-identical frozen document sets${splits.size > 1 ? " across evaluation splits" : ""}.`,
      sourceFamilyKeys: familyKeys
    });
    if (issue.severity === "error")
      errors.push(issue);
    else
      warnings.push(issue);
  }
  return Object.freeze({ errors: canonicalIssues(errors), warnings: canonicalIssues(warnings) });
}
function evidenceUnitForCorpus(unit, source) {
  return Object.freeze({
    id: unit.id,
    documentId: unit.documentId,
    sourceFamilyId: source.sourceFamilyId,
    trustClass: source.trustClass,
    sourcePath: unit.sourcePath,
    lineRange: Object.freeze({ ...unit.lineRange }),
    headingPath: Object.freeze([...unit.headingAncestry]),
    ...unit.pdfPage === undefined ? {} : { sourcePage: unit.pdfPage }
  });
}
function sealRetrievalEvaluationCorpusV2(input) {
  const buildContractSha256 = canonicalSha256(input.buildContractSha256, "buildContractSha256");
  const retrievers = [...input.retrievers].toSorted((left, right) => compareText2(left.id, right.id));
  const candidateLock = Object.freeze({
    baselineRetrieverId: input.baselineRetrieverId,
    candidateRetrieverIds: Object.freeze(retrievers.filter(({ role }) => role === "candidate").map(({ id }) => id).toSorted(compareText2)),
    descriptorDigests: Object.freeze(retrievers.map((descriptor) => Object.freeze({
      retrieverId: descriptor.id,
      sha256: evaluationRetrieverDescriptorDigestV2(descriptor)
    })))
  });
  const candidateLockSha256 = evaluationCandidateLockDigestV2(candidateLock);
  const draft = {
    schemaVersion: input.schemaVersion,
    id: input.id,
    description: input.description,
    manifest: {
      protocol: RETRIEVAL_EVALUATION_V2_PROTOCOL,
      sealedAt: input.sealedAt,
      corpusSha256: ZERO_SHA256,
      candidateLockSha256,
      buildContractSha256
    },
    frozen: input.frozen,
    assessment: input.assessment,
    experiment: input.experiment,
    sourceFamilies: input.sourceFamilies,
    documents: input.documents,
    evidenceUnits: input.evidenceUnits,
    measurementProfiles: input.measurementProfiles,
    retrievers,
    candidateLock,
    queries: input.queries
  };
  const sealed = {
    ...draft,
    manifest: {
      ...draft.manifest,
      corpusSha256: evaluationCorpusDigestV2(draft)
    }
  };
  const corpus = parseRetrievalEvaluationCorpusV2(sealed, { claimPromotion: false });
  return Object.freeze({
    corpus,
    externalSeal: Object.freeze({ expectedCorpusSha256: corpus.manifest.corpusSha256 })
  });
}
function canonicalSourceDocuments(documents, reviewPolicy) {
  const protocolInput = reviewPolicy?.sourceFamilyAssignment;
  const protocol = protocolInput === undefined ? undefined : Object.freeze({
    protocolId: authoredKey(protocolInput.protocolId, "reviewPolicy.sourceFamilyAssignment.protocolId"),
    protocolSha256: canonicalSha256(protocolInput.protocolSha256, "reviewPolicy.sourceFamilyAssignment.protocolSha256"),
    reviewerIds: canonicalReviewerIds(protocolInput.reviewerIds, "reviewPolicy.sourceFamilyAssignment.reviewerIds")
  });
  const families = new Map;
  const sourceBindings = new Map;
  const documentBindings = new Map;
  const result = documents.map((document, index) => {
    const sourcePath = confinedPath2(document.sourcePath, `documents[${index}].sourcePath`);
    const documentId = document.documentId === undefined ? sourcePath : confinedPath2(document.documentId, `documents[${index}].documentId`);
    const sourceFamilyKey = authoredKey(document.sourceFamilyKey, `documents[${index}].sourceFamilyKey`);
    const review = canonicalSourceFamilyReview(document, index, protocol?.reviewerIds);
    if (!EVALUATION_SOURCE_TRUST_COMPATIBILITY_V2[document.sourceClass]?.some((trustClass) => trustClass === document.trustClass)) {
      throw new AuthoringFailure("incompatible-source-trust", `Source ${sourcePath} cannot combine source class ${document.sourceClass} with trust class ${document.trustClass}.`, { sourcePaths: [sourcePath] });
    }
    const sourceBinding = sourceBindings.get(sourcePath);
    if (sourceBinding !== undefined) {
      throw new AuthoringFailure("duplicate-source-path-binding", `Source path ${sourcePath} is bound more than once; every path must name exactly one document and family.`, { sourcePaths: [sourcePath] });
    }
    const boundPath = documentBindings.get(documentId);
    if (boundPath !== undefined) {
      throw new AuthoringFailure("duplicate-document-binding", `Document ${documentId} is bound to both ${boundPath} and ${sourcePath}.`, { sourcePaths: uniqueSorted([boundPath, sourcePath]) });
    }
    sourceBindings.set(sourcePath, { documentId, sourceFamilyKey });
    documentBindings.set(documentId, sourcePath);
    const previous = families.get(sourceFamilyKey);
    if (previous !== undefined && (previous.review?.rationale !== review?.rationale || !sameStrings(previous.review?.reviewerIds ?? [], review?.reviewerIds ?? []))) {
      throw new AuthoringFailure("conflicting-source-family-review", `Source family ${sourceFamilyKey} has inconsistent rationales or reviewer assignments.`);
    }
    const family = previous ?? { review, members: [] };
    family.members.push({
      sourcePath,
      sourceClass: document.sourceClass,
      trustClass: document.trustClass
    });
    families.set(sourceFamilyKey, family);
    return Object.freeze({
      documentId,
      sourcePath,
      markdown: document.markdown,
      sourceFamilyKey,
      sourceFamilyId: opaqueId("sf", [sourceFamilyKey, document.sourceClass, document.trustClass]),
      sourceClass: document.sourceClass,
      trustClass: document.trustClass
    });
  });
  const reviewOwnerByFingerprint = new Map;
  const assignmentByFamilyKey = new Map;
  for (const [sourceFamilyKey, family] of families) {
    if (family.review === undefined)
      continue;
    if (protocol === undefined)
      throw new Error("Reviewed source family lost its assignment protocol.");
    const reviewFingerprint = canonicalJson2(family.review);
    const previousFamilyKey = reviewOwnerByFingerprint.get(reviewFingerprint);
    if (previousFamilyKey !== undefined && previousFamilyKey !== sourceFamilyKey) {
      throw new AuthoringFailure("opaque-source-family-splitting", `Distinct source-family keys ${previousFamilyKey} and ${sourceFamilyKey} reuse the same review rationale and reviewers; independently justify each causal family instead of splitting by note.`);
    }
    reviewOwnerByFingerprint.set(reviewFingerprint, sourceFamilyKey);
    assignmentByFamilyKey.set(sourceFamilyKey, framedDigest("promotion-corpus-source-family-assignment-v1", [canonicalJson2({
      protocol,
      sourceFamilyKey,
      rationale: family.review.rationale,
      reviewerIds: family.review.reviewerIds,
      members: family.members.toSorted((left, right) => {
        const pathOrder = compareText2(left.sourcePath, right.sourcePath);
        if (pathOrder !== 0)
          return pathOrder;
        const sourceClassOrder = compareText2(left.sourceClass, right.sourceClass);
        return sourceClassOrder !== 0 ? sourceClassOrder : compareText2(left.trustClass, right.trustClass);
      })
    })]));
  }
  return Object.freeze(result.map((document) => {
    const familyAssignmentSha256 = assignmentByFamilyKey.get(document.sourceFamilyKey);
    return Object.freeze({
      ...document,
      ...familyAssignmentSha256 === undefined ? {} : { familyAssignmentSha256 }
    });
  }).toSorted((left, right) => compareText2(left.documentId, right.documentId)));
}
function failedResult(diagnostics, errors, warnings, registry, resolvedEvidence = []) {
  const canonicalErrors = canonicalIssues(errors);
  const canonicalWarnings = canonicalIssues(warnings);
  const reviewIssues = canonicalIssues([...canonicalErrors, ...canonicalWarnings].filter(({ code }) => code.includes("prompt") || code.includes("ngram") || code.includes("source-family") || code.includes("split-leakage")));
  return Object.freeze({
    ok: false,
    ...registry === undefined ? {} : { evidenceRegistry: registry },
    resolvedEvidence: Object.freeze([...resolvedEvidence]),
    diagnostics,
    errors: canonicalErrors,
    warnings: canonicalWarnings,
    reviewIssues
  });
}
function compileRetrievalEvaluationCorpusAuthoringV2(input, options = {}) {
  const questions = input.questions;
  let diagnostics = promotionCorpusDiagnosticsV2(questions, input.experiment, input.reviewPolicy);
  const errors = [];
  const warnings = [];
  try {
    for (const issue of promptReviewIssues(questions, input.reviewPolicy, options.expectedPromotionSeal !== undefined)) {
      if (issue.severity === "error")
        errors.push(issue);
      else
        warnings.push(issue);
    }
  } catch (error) {
    errors.push(issueFromFailure(error));
  }
  let sourceDocuments;
  let registry;
  try {
    sourceDocuments = canonicalSourceDocuments(input.documents, input.reviewPolicy);
    registry = buildEvaluationEvidenceRegistry({
      documents: sourceDocuments.map((document) => ({
        documentId: document.documentId,
        sourcePath: document.sourcePath,
        markdown: document.markdown,
        trustClass: document.trustClass
      })),
      parserVersion: input.evidenceParserVersion ?? EVALUATION_EVIDENCE_PARSER_VERSION
    });
  } catch (error) {
    errors.push(issueFromFailure(error));
    return failedResult(diagnostics, errors, warnings);
  }
  const corpusDocumentsByPath = new Map(sourceDocuments.map((document) => [document.sourcePath, document]));
  const context = {
    registry,
    registryDocumentsByPath: new Map(registry.documents.map((document) => [document.sourcePath, document])),
    corpusDocumentsByPath,
    resolvedByRegistryId: new Map
  };
  const queryKeys = new Set;
  const queryIds = new Set;
  const queries = [];
  for (const question of questions) {
    let key;
    try {
      key = authoredKey(question.key, "question.key");
      if (queryKeys.has(key)) {
        throw new AuthoringFailure("duplicate-question-key", `Question key ${key} is duplicated.`, {
          queryKeys: [key]
        });
      }
      queryKeys.add(key);
      const compiled = compileQuestion(question, context);
      if (queryIds.has(compiled.id)) {
        throw new AuthoringFailure("opaque-id-collision", `Question ${key} collides with another opaque query ID.`, {
          queryKeys: [key]
        });
      }
      queryIds.add(compiled.id);
      queries.push(compiled);
    } catch (error) {
      const issue = issueFromFailure(error);
      errors.push(issue.queryKeys === undefined && typeof question.key === "string" ? Object.freeze({ ...issue, queryKeys: Object.freeze([question.key]) }) : issue);
    }
  }
  queries.sort((left, right) => compareText2(left.id, right.id));
  const resolvedEvidence = [...context.resolvedByRegistryId.values()].toSorted((left, right) => compareText2(left.corpusEvidenceUnitId, right.corpusEvidenceUnitId));
  const familyCheck = familyReview(sourceDocuments, registry, queries, resolvedEvidence);
  errors.push(...familyCheck.errors);
  warnings.push(...familyCheck.warnings);
  if (errors.length > 0) {
    return failedResult(diagnostics, errors, warnings, registry, resolvedEvidence);
  }
  try {
    const sourceFamiliesById = new Map;
    for (const document of sourceDocuments) {
      sourceFamiliesById.set(document.sourceFamilyId, Object.freeze({
        id: document.sourceFamilyId,
        sourceClass: document.sourceClass,
        trustClass: document.trustClass,
        ...document.familyAssignmentSha256 === undefined ? {} : { familyAssignmentSha256: document.familyAssignmentSha256 }
      }));
    }
    const documents = Object.freeze(sourceDocuments.map((document) => Object.freeze({
      id: document.documentId,
      sourceFamilyId: document.sourceFamilyId,
      trustClass: document.trustClass,
      sourcePath: document.sourcePath
    })).toSorted((left, right) => compareText2(left.id, right.id)));
    const evidenceUnits = Object.freeze(registry.units.map((unit) => {
      const source = corpusDocumentsByPath.get(unit.sourcePath);
      if (source === undefined)
        throw new Error(`Registry evidence lost source ${unit.sourcePath}.`);
      return evidenceUnitForCorpus(unit, source);
    }).toSorted((left, right) => compareText2(left.id, right.id)));
    const testQueries = queries.filter(({ split }) => split === "test");
    const sourceFamilies = Object.freeze([...sourceFamiliesById.values()].toSorted((left, right) => compareText2(left.id, right.id)));
    const clusterIdByQuery = evaluationSourceFamilyClusterIdsV2(testQueries, documents, evidenceUnits, sourceFamilies);
    const independentSourceFamilyClusters = new Set(testQueries.filter((query) => query.cohort === "caller-seeded" && query.expectedSupport === "supported").map((query) => clusterIdByQuery.get(query.id))).size;
    diagnostics = promotionCorpusDiagnosticsV2(questions, input.experiment, input.reviewPolicy, independentSourceFamilyClusters);
    if (!diagnostics.promotionLayoutReady && !warnings.some(({ code }) => code === "promotion-layout-not-ready")) {
      warnings.push(Object.freeze({
        severity: "warning",
        code: "promotion-layout-not-ready",
        message: "The authored questions do not yet satisfy every exact promotion quota and independent-pair minimum."
      }));
    }
    const sealed = sealRetrievalEvaluationCorpusV2({
      schemaVersion: RETRIEVAL_EVALUATION_V2_SCHEMA_VERSION,
      id: input.id,
      description: input.description,
      sealedAt: input.sealedAt,
      baselineRetrieverId: input.baselineRetrieverId,
      buildContractSha256: input.buildContractSha256,
      frozen: Object.freeze({
        repositoryCommit: input.frozen.repositoryCommit,
        vaultTree: input.frozen.vaultTree,
        vaultRoot: input.frozen.vaultRoot
      }),
      assessment: Object.freeze({
        rubricVersion: input.assessment.rubricVersion,
        assessors: cloneAssessors(input.assessment.assessors)
      }),
      experiment: cloneExperiment(input.experiment),
      sourceFamilies,
      documents,
      evidenceUnits,
      measurementProfiles: cloneMeasurementProfiles(input.measurementProfiles),
      retrievers: cloneRetrievers(input.retrievers),
      queries: Object.freeze(queries)
    });
    const finalCorpus = options.expectedPromotionSeal === undefined ? sealed.corpus : validatePromotionCorpusV2(sealed.corpus, options.expectedPromotionSeal);
    const canonicalWarnings = canonicalIssues(warnings);
    return Object.freeze({
      ok: true,
      corpus: finalCorpus,
      externalSeal: sealed.externalSeal,
      evidenceRegistry: registry,
      resolvedEvidence: Object.freeze(resolvedEvidence),
      diagnostics,
      errors: Object.freeze([]),
      warnings: canonicalWarnings,
      reviewIssues: Object.freeze(canonicalWarnings.filter(({ code }) => code.includes("prompt") || code.includes("ngram") || code.includes("source-family")))
    });
  } catch (error) {
    errors.push(Object.freeze({
      ...issueFromFailure(error),
      code: options.expectedPromotionSeal === undefined ? "invalid-compiled-corpus" : "invalid-promotion-corpus"
    }));
    return failedResult(diagnostics, errors, warnings, registry, resolvedEvidence);
  }
}
function compilePromotionCorpusAuthoringV2(input, expectedSeal) {
  return compileRetrievalEvaluationCorpusAuthoringV2(input, { expectedPromotionSeal: expectedSeal });
}

// src/evaluation-implementation.ts
import { createHash as createHash4 } from "crypto";
var MAX_IMPLEMENTATION_SOURCES = 32;
var MAX_IMPLEMENTATION_SOURCE_BYTES = 4 * 1024 * 1024;
var MAX_IMPLEMENTATION_TOTAL_BYTES = 16 * 1024 * 1024;
var GIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
var artifactBrand = Symbol("verified-evaluation-implementation-v2");
function confinedPath3(value, label) {
  if (value === "" || value.normalize("NFC") !== value || /[\0\r\n\\]/u.test(value) || value.startsWith("/") || value.startsWith("./") || /^[a-z]:[\\/]/iu.test(value) || value.split("/").some((part) => part === "" || part === "." || part === ".."))
    throw new TypeError(`${label} must be a canonical confined repository-relative path.`);
  return value;
}
function canonicalJson3(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON cannot contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map(canonicalJson3).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const input = value;
    return `{${Object.keys(input).toSorted().map((key) => `${JSON.stringify(key)}:${canonicalJson3(input[key])}`).join(",")}}`;
  }
  throw new TypeError("Canonical JSON accepts only JSON values.");
}
function sha2563(bytes) {
  return createHash4("sha256").update(bytes).digest("hex");
}
function evaluationImplementationArtifactSha256V2(sources) {
  if (sources.length < 1 || sources.length > MAX_IMPLEMENTATION_SOURCES) {
    throw new TypeError(`Implementation sources must contain from 1 through ${MAX_IMPLEMENTATION_SOURCES} files.`);
  }
  let totalBytes = 0;
  const seen = new Set;
  const manifest = sources.map(({ sourcePath: rawSourcePath, bytes }, index) => {
    const sourcePath = confinedPath3(rawSourcePath, `implementation sources[${index}].sourcePath`);
    if (seen.has(sourcePath))
      throw new TypeError(`Implementation source path ${sourcePath} is repeated.`);
    seen.add(sourcePath);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMPLEMENTATION_SOURCE_BYTES) {
      throw new TypeError(`Implementation source ${sourcePath} must contain at most ${MAX_IMPLEMENTATION_SOURCE_BYTES} bytes.`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_IMPLEMENTATION_TOTAL_BYTES) {
      throw new TypeError(`Implementation sources exceed ${MAX_IMPLEMENTATION_TOTAL_BYTES} aggregate bytes.`);
    }
    return Object.freeze({ sourcePath, sha256: sha2563(bytes) });
  }).toSorted((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  return sha2563(Buffer.from(`${canonicalJson3(manifest)}
`, "utf8"));
}
function verifyEvaluationImplementationArtifactV2(options) {
  if (!GIT_OBJECT.test(options.loadedRepositoryCommit)) {
    throw new TypeError("Loaded implementation repository commit must be a lowercase Git object ID.");
  }
  if (options.loadedRepositoryCommit !== options.corpus.frozen.repositoryCommit) {
    throw new TypeError("Loaded implementation is not from the corpus's frozen repository commit.");
  }
  assertEvaluationRetrieverLockedV2(options.corpus, options.descriptor);
  const implementationSha256 = evaluationImplementationArtifactSha256V2(options.sources);
  if (implementationSha256 !== options.descriptor.implementationSha256) {
    throw new TypeError(`Retriever ${options.descriptor.id} implementation bytes do not match its candidate lock.`);
  }
  return Object.freeze({
    retrieverId: options.descriptor.id,
    repositoryCommit: options.loadedRepositoryCommit,
    implementationSha256,
    sourcePaths: Object.freeze(options.sources.map(({ sourcePath }, index) => confinedPath3(sourcePath, `implementation sources[${index}].sourcePath`)).toSorted()),
    [artifactBrand]: true
  });
}
function assertEvaluationImplementationArtifactV2(artifact, corpus, descriptor) {
  if (artifact?.[artifactBrand] !== true || artifact.retrieverId !== descriptor.id || artifact.repositoryCommit !== corpus.frozen.repositoryCommit || artifact.implementationSha256 !== descriptor.implementationSha256)
    throw new TypeError(`Retriever ${descriptor.id} lacks a verified frozen implementation artifact.`);
  assertEvaluationRetrieverLockedV2(corpus, descriptor);
}

// src/evaluation-analysis-v2.ts
import { createHash as createHash5 } from "crypto";
var DEFAULT_EVALUATION_ANALYSIS_CUTOFF_V2 = 10;
var DEFAULT_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2 = 2000;
var MAX_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2 = 1e4;
var MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2 = 50000000;
var QUALITY_METRICS = Object.freeze([
  "document-recall-at-k",
  "evidence-recall-at-k",
  "nugget-coverage",
  "context-precision",
  "no-answer-accuracy",
  "false-abstention-rate",
  "provenance-coverage",
  "decision-accuracy"
]);
var COHORTS = Object.freeze(["caller-seeded", "text-only"]);
var ACCURACY_STRATUM_BY_METRIC = Object.freeze({
  "active-current-state-accuracy": "active-current-state",
  "code-path-context-accuracy": "code-path-context",
  "conceptual-recall-accuracy": "conceptual-recall",
  "exact-identity-accuracy": "exact-identity",
  "local-context-accuracy": "local-context",
  "metadata-constraint-accuracy": "metadata-constraint",
  "multi-note-relational-accuracy": "multi-note-relational",
  "source-provenance-accuracy": "source-provenance",
  "temporal-stale-current-accuracy": "temporal-stale-current"
});
var LATENCY_OPERATION_BY_METRIC = Object.freeze({
  "four-reader-query-p95-ms": "four-reader-query",
  "packing-p95-ms": "packing",
  "warm-query-p95-ms": "warm-query"
});
var QUALITY_NONINFERIORITY_METRICS = new Set([
  "document-recall-at-k",
  "evidence-recall-at-k"
]);
function average(values) {
  if (values.length === 0)
    return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function percentile(values, proportion) {
  if (values.length === 0)
    return null;
  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.max(0, Math.ceil(proportion * sorted.length) - 1);
  return sorted[index] ?? null;
}
function meanRequired(values, label) {
  const result = average(values);
  if (result === null)
    throw new TypeError(`${label} requires at least one finite value.`);
  return result;
}
function sampleGroupKey(retrieverId, profileId, queryId) {
  return `${retrieverId}\x00${profileId}\x00${queryId ?? ""}`;
}
function metricEligible(query, metric) {
  if (metric === "document-recall-at-k" || metric === "evidence-recall-at-k" || metric === "nugget-coverage" || metric === "false-abstention-rate")
    return query.expectedSupport === "supported";
  if (metric === "no-answer-accuracy")
    return query.expectedSupport === "insufficient";
  return true;
}
function queryInSlice(query, slice) {
  if (slice.kind === "overall")
    return true;
  if (slice.kind === "cohort")
    return query.cohort === slice.cohort;
  if (slice.kind === "primary-stratum")
    return query.primaryStratum === slice.primaryStratum;
  return query.cohort === slice.cohort && query.primaryStratum === slice.primaryStratum;
}
function analysisSlices(queries) {
  const primaryStrata = [...new Set(queries.map(({ primaryStratum }) => primaryStratum))].toSorted();
  return Object.freeze([
    Object.freeze({ id: "overall", kind: "overall" }),
    ...COHORTS.map((cohort) => Object.freeze({
      id: `cohort:${cohort}`,
      kind: "cohort",
      cohort
    })),
    ...primaryStrata.map((primaryStratum) => Object.freeze({
      id: `primary-stratum:${primaryStratum}`,
      kind: "primary-stratum",
      primaryStratum
    })),
    ...COHORTS.flatMap((cohort) => primaryStrata.map((primaryStratum) => Object.freeze({
      id: `cohort:${cohort}:primary-stratum:${primaryStratum}`,
      kind: "cohort-primary-stratum",
      cohort,
      primaryStratum
    })))
  ]);
}
function acceptedDecisions(sample) {
  return sample.trace.candidateDecisions.filter(({ disposition }) => disposition === "accepted").toSorted((left, right) => (left.outputRank ?? Number.MAX_SAFE_INTEGER) - (right.outputRank ?? Number.MAX_SAFE_INTEGER));
}
function countPackedContextProvenanceV2(sample) {
  const packedEvidenceUnitIds = new Set(sample.packedContextTrace?.evidenceUnitIds ?? []);
  const provenancedEvidenceUnitIds = new Set;
  for (const decision of sample.trace.candidateDecisions) {
    for (const locator of decision.provenance) {
      provenancedEvidenceUnitIds.add(locator.evidenceUnitId);
    }
  }
  return Object.freeze({
    packed: packedEvidenceUnitIds.size,
    covered: [...packedEvidenceUnitIds].filter((evidenceUnitId2) => provenancedEvidenceUnitIds.has(evidenceUnitId2)).length
  });
}
function scoreSample(query, sample, cutoff, evidenceById) {
  const packedEvidenceIds = sample.packedContextTrace?.evidenceUnitIds;
  if (packedEvidenceIds === undefined) {
    throw new TypeError(`Quality sample ${sample.retrieverId}/${sample.queryId ?? ""} lacks packed context.`);
  }
  const packedEvidence = new Set(packedEvidenceIds);
  for (const evidenceUnitId2 of packedEvidence) {
    if (!evidenceById.has(evidenceUnitId2)) {
      throw new TypeError(`Packed evidence unit ${evidenceUnitId2} is missing from the catalog.`);
    }
  }
  const topKAccepted = acceptedDecisions(sample).filter(({ outputRank }) => outputRank !== undefined && outputRank <= cutoff);
  const relevantDocuments = new Set(query.gold.documents.filter(({ relevance }) => relevance > 0).map(({ documentId }) => documentId));
  const relevantEvidence = new Set(query.gold.evidenceUnits.filter(({ relevance }) => relevance > 0).map(({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2));
  const topKDocuments = new Set(topKAccepted.filter(({ evidenceUnitIds }) => evidenceUnitIds.some((evidenceUnitId2) => packedEvidence.has(evidenceUnitId2))).map(({ documentId }) => documentId));
  const topKEvidence = new Set(sample.trace.candidateDecisions.filter(({ documentId }) => topKDocuments.has(documentId)).flatMap(({ evidenceUnitIds }) => evidenceUnitIds).filter((evidenceUnitId2) => packedEvidence.has(evidenceUnitId2)));
  const evidenceRelevance = new Map(query.gold.evidenceUnits.map(({ evidenceUnitId: evidenceUnitId2, relevance }) => [
    evidenceUnitId2,
    relevance
  ]));
  const requiredNuggets = query.gold.nuggets.filter(({ required }) => required);
  if (query.expectedSupport === "supported" && requiredNuggets.length === 0) {
    throw new TypeError(`Supported query ${query.id} has no required nugget.`);
  }
  const coveredRequiredNuggets = requiredNuggets.filter((nugget) => nugget.acceptableSupportSets.some((supportSet) => supportSet.evidenceUnitIds.every((evidenceUnitId2) => packedEvidence.has(evidenceUnitId2))));
  const provenance = countPackedContextProvenanceV2(sample);
  const hasUnjudgedPackedEvidence = [...packedEvidence].some((evidenceUnitId2) => !evidenceRelevance.has(evidenceUnitId2));
  const contextPrecision = packedEvidence.size === 0 ? 1 : hasUnjudgedPackedEvidence ? null : [...packedEvidence].filter((evidenceUnitId2) => (evidenceRelevance.get(evidenceUnitId2) ?? 0) > 0).length / packedEvidence.size;
  const nuggetCoverage = query.expectedSupport === "supported" ? coveredRequiredNuggets.length / requiredNuggets.length : null;
  const noAnswerAccuracy = query.expectedSupport === "insufficient" ? packedEvidence.size === 0 ? 1 : 0 : null;
  const falseAbstentionRate = query.expectedSupport === "supported" ? packedEvidence.size === 0 ? 1 : 0 : null;
  return Object.freeze({
    "document-recall-at-k": query.expectedSupport === "supported" && relevantDocuments.size > 0 ? [...relevantDocuments].filter((documentId) => topKDocuments.has(documentId)).length / relevantDocuments.size : null,
    "evidence-recall-at-k": query.expectedSupport === "supported" && relevantEvidence.size > 0 ? [...relevantEvidence].filter((evidenceUnitId2) => topKEvidence.has(evidenceUnitId2)).length / relevantEvidence.size : null,
    "nugget-coverage": nuggetCoverage,
    "context-precision": contextPrecision,
    "no-answer-accuracy": noAnswerAccuracy,
    "false-abstention-rate": falseAbstentionRate,
    "provenance-coverage": provenance.packed === 0 ? 1 : provenance.covered / provenance.packed,
    "decision-accuracy": query.expectedSupport === "supported" ? nuggetCoverage === 1 ? 1 : 0 : noAnswerAccuracy ?? 0
  });
}
function aggregateRepetitions(query, samples, cutoff, evidenceById, sourceFamilyClusterId) {
  const perSample = samples.map((sample) => scoreSample(query, sample, cutoff, evidenceById));
  const metrics = Object.fromEntries(QUALITY_METRICS.map((metric) => {
    const repetitionValues = perSample.map((row) => row[metric]);
    const values = repetitionValues.flatMap((value) => value === null ? [] : [value]);
    return [
      metric,
      metric === "context-precision" && repetitionValues.some((value) => value === null) ? null : average(values)
    ];
  }));
  return Object.freeze({ queryId: query.id, sourceFamilyClusterId, metrics: Object.freeze(metrics) });
}
function sliceSummary(slice, queries, scores) {
  const slicedQueries = queries.filter((query) => queryInSlice(query, slice));
  const metrics = QUALITY_METRICS.map((metric) => {
    const eligible = slicedQueries.filter((query) => metricEligible(query, metric));
    const values = eligible.flatMap((query) => {
      const value = scores.get(query.id)?.metrics[metric];
      return value === null || value === undefined ? [] : [value];
    });
    return Object.freeze({
      metric,
      eligibleQueries: eligible.length,
      observedQueries: values.length,
      value: average(values)
    });
  });
  return Object.freeze({
    slice,
    queryCount: slicedQueries.length,
    metrics: Object.freeze(metrics)
  });
}
function operationDuration(sample, operation) {
  if (operation === "cold-index")
    return sample.timings.indexMs;
  if (operation === "incremental-update")
    return sample.timings.updateMs;
  if (operation === "packing")
    return sample.timings.packingMs;
  return sample.timings.queryMs;
}
function promotionOperationDuration(sample, operation) {
  if (operation === "packing")
    return sample.timings.elapsedMs;
  return operationDuration(sample, operation);
}
function expectedProfileObservations(profile, queryCount) {
  return profile.repetitions * (profile.scope === "query" ? queryCount : 1);
}
function evaluationAnalysisBootstrapSeedV2(suiteSha256, candidateRetrieverId, metric, sliceId = "overall") {
  const digest = createHash5("sha256").update(suiteSha256, "utf8").update("\x00", "utf8").update(candidateRetrieverId, "utf8").update("\x00", "utf8").update(metric, "utf8").update("\x00", "utf8").update(sliceId, "utf8").digest();
  return digest.readUInt32BE(0);
}
function favorablePairs(metric, pairs) {
  if (metric !== "false-abstention-rate")
    return pairs;
  return pairs.map(({ baseline, candidate, clusterId }) => ({
    baseline: -baseline,
    candidate: -candidate,
    clusterId
  }));
}
function observedNoRegressionGuard(options) {
  const eligibleQueries = options.queries.filter((query) => queryInSlice(query, options.slice) && metricEligible(query, options.metric));
  const favorableDifferences = eligibleQueries.flatMap((query) => {
    const baseline = options.baselineScores.get(query.id)?.metrics[options.metric];
    const candidate = options.candidateScores.get(query.id)?.metrics[options.metric];
    if (baseline === null || baseline === undefined || candidate === null || candidate === undefined)
      return [];
    return [options.metric === "false-abstention-rate" ? baseline - candidate : candidate - baseline];
  });
  return Object.freeze({
    eligibleQueries: eligibleQueries.length,
    observedPairs: favorableDifferences.length,
    regressedPairs: favorableDifferences.filter((difference) => difference < 0).length,
    observedEffect: average(favorableDifferences)
  });
}
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function clusteredPairedBootstrapConfidenceInterval(pairs, options) {
  if (pairs.length < 1)
    throw new RangeError("Clustered bootstrap requires at least one pair.");
  const groups = new Map;
  for (const pair of pairs) {
    const group = groups.get(pair.clusterId) ?? [];
    group.push(pair);
    groups.set(pair.clusterId, group);
  }
  const clusters = [...groups.keys()].toSorted();
  const observedDifference = pairs.reduce((sum, pair) => sum + pair.candidate - pair.baseline, 0) / pairs.length;
  if (clusters.length < 2) {
    return Object.freeze({
      pairs: pairs.length,
      seed: options.seed,
      resamples: options.resamples,
      confidence: 0.95,
      observedDifference,
      lower: -1,
      upper: 1,
      oneSidedLower: -1
    });
  }
  const random = seededRandom(options.seed);
  const draws = [];
  for (let drawIndex = 0;drawIndex < options.resamples; drawIndex += 1) {
    let difference = 0;
    let observations = 0;
    for (let clusterIndex = 0;clusterIndex < clusters.length; clusterIndex += 1) {
      const clusterId = clusters[Math.floor(random() * clusters.length)];
      const group = clusterId === undefined ? undefined : groups.get(clusterId);
      if (group === undefined)
        throw new Error("Cluster bootstrap selected a missing source family.");
      for (const pair of group)
        difference += pair.candidate - pair.baseline;
      observations += group.length;
    }
    draws.push(difference / observations);
  }
  draws.sort((left, right) => left - right);
  return Object.freeze({
    pairs: pairs.length,
    seed: options.seed,
    resamples: options.resamples,
    confidence: 0.95,
    observedDifference,
    lower: draws[Math.floor(0.025 * options.resamples)] ?? -1,
    upper: draws[Math.min(options.resamples - 1, Math.ceil(0.975 * options.resamples) - 1)] ?? 1,
    oneSidedLower: draws[Math.floor(0.05 * options.resamples)] ?? -1
  });
}
function comparisonKey(candidateRetrieverId, metric, sliceId) {
  return `${candidateRetrieverId}\x00${metric}\x00${sliceId}`;
}
function pairedEffect(options) {
  const eligibleQueries = options.queries.filter((query) => queryInSlice(query, options.slice) && metricEligible(query, options.metric));
  const pairs = eligibleQueries.flatMap((query) => {
    const baselineScore = options.baselineScores.get(query.id);
    const candidateScore = options.candidateScores.get(query.id);
    const baseline = baselineScore?.metrics[options.metric];
    const candidate = candidateScore?.metrics[options.metric];
    return baselineScore === undefined || baseline === null || baseline === undefined || candidate === null || candidate === undefined ? [] : [{ baseline, candidate, clusterId: baselineScore.sourceFamilyClusterId }];
  });
  if (pairs.length === 0)
    return;
  const favorable = favorablePairs(options.metric, pairs);
  const sourceFamilyClusters = new Set(pairs.map(({ clusterId }) => clusterId)).size;
  const interval = clusteredPairedBootstrapConfidenceInterval(favorable, {
    seed: evaluationAnalysisBootstrapSeedV2(options.suiteSha256, `${options.baselineRetrieverId}->${options.candidateRetrieverId}`, options.metric, options.slice.id),
    resamples: options.bootstrapResamples
  });
  return Object.freeze({
    baselineRetrieverId: options.baselineRetrieverId,
    candidateRetrieverId: options.candidateRetrieverId,
    metric: options.metric,
    slice: options.slice,
    direction: options.metric === "false-abstention-rate" ? "lower-is-better" : "higher-is-better",
    eligibleQueries: eligibleQueries.length,
    observedPairs: pairs.length,
    sourceFamilyClusters,
    inferenceStatus: sourceFamilyClusters >= 2 ? "estimable" : "insufficient-clusters",
    baselineMean: meanRequired(pairs.map(({ baseline }) => baseline), "Baseline paired mean"),
    candidateMean: meanRequired(pairs.map(({ candidate }) => candidate), "Candidate paired mean"),
    favorableInterval: Object.freeze({
      pairs: interval.pairs,
      seed: interval.seed,
      resamples: interval.resamples,
      confidence: interval.confidence,
      observedDifference: interval.observedDifference,
      lower: interval.lower,
      upper: interval.upper
    }),
    favorableOneSidedLower: interval.oneSidedLower
  });
}
function reasonKey(reason) {
  return [
    reason.code,
    reason.retrieverId ?? "",
    reason.metric ?? "",
    reason.sliceId ?? "",
    reason.profileId ?? ""
  ].join("\x00");
}
function canonicalReasons(reasons) {
  const byKey = new Map;
  for (const reason of reasons)
    byKey.set(reasonKey(reason), reason);
  return Object.freeze([...byKey.values()].toSorted((left, right) => reasonKey(left).localeCompare(reasonKey(right))));
}
function variantComplexity(descriptor) {
  const activeConfigurationEntries = Object.values(descriptor.configuration).filter((value) => value !== null && value !== false && value !== 0 && value !== "none").length;
  return Object.freeze({ laneCount: descriptor.lanes.length, activeConfigurationEntries });
}
function compareVariantComplexity(left, right) {
  return compareVariantComplexityScore(left.score, right.score) || left.retrieverId.localeCompare(right.retrieverId);
}
function compareVariantComplexityScore(left, right) {
  return left.laneCount - right.laneCount || left.activeConfigurationEntries - right.activeConfigurationEntries;
}
function isStrictlySimplerVariant(baseline, candidate) {
  return compareVariantComplexityScore(baseline.score, candidate.score) < 0;
}
function validateOptions(options) {
  const cutoff = options.cutoff ?? DEFAULT_EVALUATION_ANALYSIS_CUTOFF_V2;
  if (!Number.isSafeInteger(cutoff) || cutoff < 1 || cutoff > MAX_EVALUATION_V2_RESULTS_PER_LANE) {
    throw new RangeError(`Analysis cutoff must be from 1 through ${MAX_EVALUATION_V2_RESULTS_PER_LANE}.`);
  }
  const bootstrapResamples = options.bootstrapResamples ?? DEFAULT_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2;
  if (!Number.isSafeInteger(bootstrapResamples) || bootstrapResamples < 100 || bootstrapResamples > MAX_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2) {
    throw new RangeError(`Analysis bootstrap resamples must be from 100 through ${MAX_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2}.`);
  }
  return Object.freeze({ cutoff, bootstrapResamples });
}
function analyzeRetrievalEvaluationV2(corpus, report, options = {}) {
  const parsedCorpus = parseRetrievalEvaluationCorpusV2(corpus, { claimPromotion: false });
  const parsedReport = parseRetrievalEvaluationReportV2(report, parsedCorpus);
  return analyzeParsedRetrievalEvaluationV2(parsedCorpus, parsedReport, options);
}
function analyzeParsedRetrievalEvaluationV2(corpus, report, options) {
  const { cutoff, bootstrapResamples } = validateOptions(options);
  if (report.schemaVersion !== 2 || corpus.schemaVersion !== 2) {
    throw new TypeError("Analysis requires strict v2 corpus and report inputs.");
  }
  if (report.suiteSha256 !== corpus.manifest.corpusSha256 || report.candidateLockSha256 !== corpus.manifest.candidateLockSha256)
    throw new TypeError("Analysis report commitments do not match the sealed corpus.");
  if (corpus.queries.length > MAX_EVALUATION_V2_QUERIES || report.samples.length > MAX_EVALUATION_V2_SAMPLES) {
    throw new RangeError("Analysis input exceeds the v2 corpus or report work bound.");
  }
  const queries = corpus.queries.filter((query) => report.split === "all" || query.split === report.split);
  if (queries.length === 0)
    throw new TypeError("Analysis report split contains no queries.");
  const descriptorIds = new Set(corpus.retrievers.map(({ id }) => id));
  const profileById = new Map(corpus.measurementProfiles.map((profile) => [profile.id, profile]));
  for (const sample of report.samples) {
    if (!descriptorIds.has(sample.retrieverId)) {
      throw new TypeError(`Analysis sample names unknown retriever ${sample.retrieverId}.`);
    }
    if (!profileById.has(sample.profileId)) {
      throw new TypeError(`Analysis sample names unknown profile ${sample.profileId}.`);
    }
  }
  const baselineRetrieverId = corpus.candidateLock.baselineRetrieverId;
  if (!descriptorIds.has(baselineRetrieverId))
    throw new TypeError("Sealed baseline retriever is missing.");
  const alternativeRetrieverIds = corpus.retrievers.filter(({ id }) => id !== baselineRetrieverId).map(({ id }) => id);
  for (const candidateRetrieverId of alternativeRetrieverIds) {
    if (!descriptorIds.has(candidateRetrieverId)) {
      throw new TypeError(`Sealed candidate retriever ${candidateRetrieverId} is missing.`);
    }
  }
  const warmProfiles = corpus.measurementProfiles.filter(({ operation }) => operation === "warm-query");
  const warmProfile = warmProfiles.length === 1 ? warmProfiles[0] : undefined;
  const qualityProfiles = corpus.measurementProfiles.filter(({ operation }) => operation === "packing");
  const qualityProfile = qualityProfiles.length === 1 ? qualityProfiles[0] : undefined;
  const evidenceById = new Map(corpus.evidenceUnits.map((evidence) => [evidence.id, evidence]));
  const clusterIdByQuery = evaluationSourceFamilyClusterIdsV2(queries, corpus.documents, corpus.evidenceUnits, corpus.sourceFamilies);
  const groupedSamples = new Map;
  const profileSamples = new Map;
  const faultsByRetriever = new Map;
  for (const { id } of corpus.retrievers) {
    faultsByRetriever.set(id, {
      failedSamples: 0,
      unavailableWarmQuerySamples: 0,
      unavailableQualitySamples: 0,
      missingQualityObservations: 0,
      nonzeroLlmAccountingSamples: 0,
      acceptedEvidenceUnits: 0,
      provenanceCoveredEvidenceUnits: 0
    });
  }
  for (const sample of report.samples) {
    const key = sampleGroupKey(sample.retrieverId, sample.profileId, sample.queryId);
    const group = groupedSamples.get(key) ?? [];
    group.push(sample);
    groupedSamples.set(key, group);
    const profileKey = `${sample.retrieverId}\x00${sample.profileId}`;
    const profileGroup = profileSamples.get(profileKey) ?? [];
    profileGroup.push(sample);
    profileSamples.set(profileKey, profileGroup);
    const faults = faultsByRetriever.get(sample.retrieverId);
    if (faults === undefined)
      continue;
    if (sample.status === "failed")
      faults.failedSamples += 1;
    if (warmProfile !== undefined && sample.profileId === warmProfile.id && sample.status === "unavailable") {
      faults.unavailableWarmQuerySamples += 1;
    }
    if (qualityProfile !== undefined && sample.profileId === qualityProfile.id && sample.status === "unavailable") {
      faults.unavailableQualitySamples += 1;
    }
    const llm = sample.resources.llm;
    if (llm.calls !== 0 || llm.inputTokens !== 0 || llm.outputTokens !== 0) {
      faults.nonzeroLlmAccountingSamples += 1;
    }
    if (qualityProfile !== undefined && sample.profileId === qualityProfile.id) {
      const provenance = countPackedContextProvenanceV2(sample);
      faults.acceptedEvidenceUnits += provenance.packed;
      faults.provenanceCoveredEvidenceUnits += provenance.covered;
    }
  }
  for (const group of groupedSamples.values())
    group.sort((left, right) => left.repetition - right.repetition);
  const scoresByRetriever = new Map;
  for (const { id: retrieverId } of corpus.retrievers) {
    const scores = new Map;
    if (qualityProfile !== undefined) {
      for (const query of queries) {
        const samples = groupedSamples.get(sampleGroupKey(retrieverId, qualityProfile.id, query.id)) ?? [];
        const completeRepetitions = samples.length === qualityProfile.repetitions && samples.every((sample, index) => sample.repetition === index + 1);
        const faults = faultsByRetriever.get(retrieverId);
        if (!completeRepetitions) {
          if (faults !== undefined)
            faults.missingQualityObservations += 1;
          continue;
        }
        if (samples.some(({ status }) => status === "failed" || status === "unavailable"))
          continue;
        const sourceFamilyClusterId = clusterIdByQuery.get(query.id);
        if (sourceFamilyClusterId === undefined) {
          throw new TypeError(`Analysis lost source-family cluster for query ${query.id}.`);
        }
        scores.set(query.id, aggregateRepetitions(query, samples, cutoff, evidenceById, sourceFamilyClusterId));
      }
    }
    scoresByRetriever.set(retrieverId, scores);
  }
  const slices = analysisSlices(queries);
  const retrievers = corpus.retrievers.map(({ id: retrieverId }) => {
    const faults = faultsByRetriever.get(retrieverId);
    if (faults === undefined)
      throw new TypeError(`Analysis lost retriever ${retrieverId}.`);
    return Object.freeze({
      retrieverId,
      queryCount: queries.length,
      slices: Object.freeze(slices.map((slice) => sliceSummary(slice, queries, scoresByRetriever.get(retrieverId) ?? new Map))),
      acceptedEvidenceUnits: faults.acceptedEvidenceUnits,
      provenanceCoveredEvidenceUnits: faults.provenanceCoveredEvidenceUnits,
      provenanceCoverage: faults.acceptedEvidenceUnits === 0 ? 1 : faults.provenanceCoveredEvidenceUnits / faults.acceptedEvidenceUnits,
      failedSamples: faults.failedSamples,
      unavailableWarmQuerySamples: faults.unavailableWarmQuerySamples,
      unavailableQualitySamples: faults.unavailableQualitySamples,
      missingQualityObservations: faults.missingQualityObservations,
      nonzeroLlmAccountingSamples: faults.nonzeroLlmAccountingSamples
    });
  });
  let bootstrapDraws = 0;
  const pairedEffects = [];
  const comparisonByKey = new Map;
  const baselineScores = scoresByRetriever.get(baselineRetrieverId) ?? new Map;
  const officialCandidateIds = new Set(corpus.candidateLock.candidateRetrieverIds);
  for (const candidateRetrieverId of alternativeRetrieverIds) {
    const candidateScores = scoresByRetriever.get(candidateRetrieverId) ?? new Map;
    for (const slice of slices) {
      const slicedQueries = queries.filter((query) => queryInSlice(query, slice));
      for (const metric of QUALITY_METRICS) {
        const officialCandidate = officialCandidateIds.has(candidateRetrieverId);
        const neededForAblationGate = slice.kind === "cohort" && corpus.experiment.protocol.minimumUsefulEffects.some((effect) => effect.metric === metric && effect.cohort === slice.cohort) || slice.kind === "cohort-primary-stratum" && (metric === "decision-accuracy" || metric === "context-precision" || metric === "document-recall-at-k" || metric === "evidence-recall-at-k");
        if (!officialCandidate && !neededForAblationGate)
          continue;
        const comparison = pairedEffect({
          baselineRetrieverId,
          candidateRetrieverId,
          metric,
          slice,
          queries: slicedQueries,
          baselineScores,
          candidateScores,
          suiteSha256: report.suiteSha256,
          bootstrapResamples
        });
        if (comparison === undefined)
          continue;
        bootstrapDraws += comparison.observedPairs * bootstrapResamples;
        if (bootstrapDraws > MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2) {
          throw new RangeError(`Analysis bootstrap would exceed ${MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2} paired draws.`);
        }
        pairedEffects.push(comparison);
        comparisonByKey.set(comparisonKey(candidateRetrieverId, metric, slice.id), comparison);
      }
    }
  }
  const latencyProfiles = [];
  const promotionLatencyByKey = new Map;
  for (const { id: retrieverId } of corpus.retrievers) {
    for (const profile of corpus.measurementProfiles) {
      const samples = profileSamples.get(`${retrieverId}\x00${profile.id}`) ?? [];
      const observedSamples = samples.filter(({ status }) => status === "ready" || status === "degraded");
      const values = observedSamples.map((sample) => operationDuration(sample, profile.operation));
      const summary = Object.freeze({
        retrieverId,
        profileId: profile.id,
        operation: profile.operation,
        cacheState: profile.cacheState,
        expectedObservations: expectedProfileObservations(profile, queries.length),
        observedObservations: values.length,
        p95Ms: percentile(values, 0.95)
      });
      latencyProfiles.push(summary);
      promotionLatencyByKey.set(`${retrieverId}\x00${profile.id}`, Object.freeze({
        ...summary,
        p95Ms: percentile(observedSamples.map((sample) => promotionOperationDuration(sample, profile.operation)), 0.95)
      }));
    }
  }
  const retrieverSummaryById = new Map(retrievers.map((summary) => [summary.retrieverId, summary]));
  const retrieverGates = alternativeRetrieverIds.map((candidateRetrieverId) => {
    const reasons = [];
    const checks = [];
    const candidateScores = scoresByRetriever.get(candidateRetrieverId) ?? new Map;
    if (qualityProfiles.length === 0) {
      reasons.push(Object.freeze({
        code: "missing-quality-profile",
        message: "The sealed corpus has no packing profile for packed-context quality inference."
      }));
    } else if (qualityProfiles.length > 1) {
      reasons.push(Object.freeze({
        code: "missing-quality-profile",
        message: "The sealed corpus has more than one packing profile and analysis will not mix them.",
        count: qualityProfiles.length
      }));
    }
    for (const retrieverId of [baselineRetrieverId, candidateRetrieverId]) {
      const summary = retrieverSummaryById.get(retrieverId);
      if (summary === undefined)
        continue;
      if (summary.failedSamples > 0) {
        reasons.push(Object.freeze({
          code: "failed-sample",
          message: `Retriever ${retrieverId} has failed samples.`,
          retrieverId,
          count: summary.failedSamples
        }));
      }
      if (summary.unavailableWarmQuerySamples > 0) {
        reasons.push(Object.freeze({
          code: "unavailable-warm-query-sample",
          message: `Retriever ${retrieverId} has unavailable warm-query samples.`,
          retrieverId,
          count: summary.unavailableWarmQuerySamples
        }));
      }
      if (summary.unavailableQualitySamples > 0) {
        reasons.push(Object.freeze({
          code: "unavailable-quality-sample",
          message: `Retriever ${retrieverId} has unavailable packed-context quality samples.`,
          retrieverId,
          count: summary.unavailableQualitySamples
        }));
      }
      if (summary.missingQualityObservations > 0) {
        reasons.push(Object.freeze({
          code: "missing-eligible-observations",
          message: `Retriever ${retrieverId} is missing complete packing repetition clusters.`,
          retrieverId,
          count: summary.missingQualityObservations
        }));
      }
      if (summary.nonzeroLlmAccountingSamples > 0) {
        reasons.push(Object.freeze({
          code: "nonzero-llm-accounting",
          message: `Retriever ${retrieverId} reports nonzero LLM accounting.`,
          retrieverId,
          count: summary.nonzeroLlmAccountingSamples
        }));
      }
      if (summary.provenanceCoverage !== 1) {
        reasons.push(Object.freeze({
          code: "provenance-below-100-percent",
          message: `Retriever ${retrieverId} has provenance coverage below 100 percent.`,
          retrieverId
        }));
      }
    }
    for (const effect of corpus.experiment.protocol.minimumUsefulEffects) {
      const sliceId = `cohort:${effect.cohort}`;
      const comparison = comparisonByKey.get(comparisonKey(candidateRetrieverId, effect.metric, sliceId));
      const insufficientIndependentPairs = comparison !== undefined && comparison.observedPairs === comparison.eligibleQueries && comparison.sourceFamilyClusters < corpus.experiment.protocol.pairedPower.requiredPairs;
      if (comparison === undefined || comparison.eligibleQueries === 0 || comparison.observedPairs !== comparison.eligibleQueries || insufficientIndependentPairs || comparison.inferenceStatus !== "estimable") {
        checks.push(Object.freeze({
          kind: "minimum-useful-effect",
          metric: effect.metric,
          status: "not-evaluable",
          sliceId,
          ...comparison === undefined ? {} : {
            eligibleQueries: comparison.eligibleQueries,
            observedPairs: comparison.observedPairs,
            sourceFamilyClusters: comparison.sourceFamilyClusters
          },
          requiredImprovement: effect.minimumAbsoluteDifference
        }));
        reasons.push(insufficientIndependentPairs ? Object.freeze({
          code: "insufficient-independent-pairs",
          message: `Metric ${effect.metric} has ${comparison.sourceFamilyClusters} independent source-family pairs but requires ${corpus.experiment.protocol.pairedPower.requiredPairs} for ${sliceId}.`,
          metric: effect.metric,
          sliceId,
          count: comparison.sourceFamilyClusters
        }) : Object.freeze({
          code: "missing-eligible-observations",
          message: `Metric ${effect.metric} lacks complete clustered pairs for ${sliceId}.`,
          metric: effect.metric,
          sliceId
        }));
        continue;
      }
      const passed = comparison.favorableOneSidedLower >= effect.minimumAbsoluteDifference;
      checks.push(Object.freeze({
        kind: "minimum-useful-effect",
        metric: effect.metric,
        status: passed ? "passed" : "failed",
        sliceId,
        eligibleQueries: comparison.eligibleQueries,
        observedPairs: comparison.observedPairs,
        sourceFamilyClusters: comparison.sourceFamilyClusters,
        observedEffect: comparison.favorableInterval.observedDifference,
        confidenceLower: comparison.favorableOneSidedLower,
        confidenceUpper: comparison.favorableInterval.upper,
        requiredImprovement: effect.minimumAbsoluteDifference
      }));
      if (!passed) {
        reasons.push(Object.freeze({
          code: "minimum-useful-effect-not-met",
          message: `Metric ${effect.metric} does not clear its minimum useful effect for ${sliceId}.`,
          metric: effect.metric,
          sliceId
        }));
      }
    }
    for (const margin of corpus.experiment.protocol.nonInferiorityMargins) {
      const stratum = ACCURACY_STRATUM_BY_METRIC[margin.metric];
      const qualityMetric = stratum === undefined && QUALITY_NONINFERIORITY_METRICS.has(margin.metric) ? margin.metric : stratum === undefined ? undefined : "decision-accuracy";
      if (qualityMetric !== undefined) {
        const targetSlices = stratum === undefined ? slices.filter((slice) => slice.kind === "cohort-primary-stratum") : COHORTS.map((cohort) => Object.freeze({
          id: `cohort:${cohort}:primary-stratum:${stratum}`,
          kind: "cohort-primary-stratum",
          cohort,
          primaryStratum: stratum
        }));
        for (const targetSlice of targetSlices) {
          const sliceId = targetSlice.id;
          const guard = observedNoRegressionGuard({
            metric: qualityMetric,
            slice: targetSlice,
            queries,
            baselineScores,
            candidateScores
          });
          if (guard.eligibleQueries === 0)
            continue;
          if (guard.observedPairs !== guard.eligibleQueries) {
            checks.push(Object.freeze({
              kind: "observed-no-regression",
              metric: margin.metric,
              status: "not-evaluable",
              sliceId,
              eligibleQueries: guard.eligibleQueries,
              observedPairs: guard.observedPairs,
              regressedPairs: guard.regressedPairs
            }));
            reasons.push(Object.freeze({
              code: "missing-eligible-observations",
              message: `Metric ${margin.metric} lacks complete paired observations for the observed zero-regression guard in ${sliceId}.`,
              metric: margin.metric,
              sliceId
            }));
            continue;
          }
          const passed = guard.regressedPairs === 0;
          checks.push(Object.freeze({
            kind: "observed-no-regression",
            metric: margin.metric,
            status: passed ? "passed" : "failed",
            sliceId,
            ...guard.observedEffect === null ? {} : { observedEffect: guard.observedEffect },
            eligibleQueries: guard.eligibleQueries,
            observedPairs: guard.observedPairs,
            regressedPairs: guard.regressedPairs
          }));
          if (!passed) {
            reasons.push(Object.freeze({
              code: "observed-query-regression",
              message: `Metric ${margin.metric} has ${guard.regressedPairs} observed paired-query regressions for ${sliceId}.`,
              metric: margin.metric,
              sliceId,
              count: guard.regressedPairs
            }));
          }
        }
        continue;
      }
      const operation = LATENCY_OPERATION_BY_METRIC[margin.metric];
      if (operation === undefined)
        continue;
      const profiles = corpus.measurementProfiles.filter((profile) => profile.operation === operation);
      if (profiles.length === 0) {
        checks.push(Object.freeze({
          kind: "noninferiority-latency",
          metric: margin.metric,
          status: "not-evaluable"
        }));
        reasons.push(Object.freeze({
          code: "missing-eligible-observations",
          message: `Metric ${margin.metric} has no matching sealed operation profile.`,
          metric: margin.metric
        }));
        continue;
      }
      for (const profile of profiles) {
        const baseline = promotionLatencyByKey.get(`${baselineRetrieverId}\x00${profile.id}`);
        const candidate = promotionLatencyByKey.get(`${candidateRetrieverId}\x00${profile.id}`);
        if (baseline?.p95Ms === null || baseline?.p95Ms === undefined || candidate?.p95Ms === null || candidate?.p95Ms === undefined || baseline.observedObservations !== baseline.expectedObservations || candidate.observedObservations !== candidate.expectedObservations) {
          checks.push(Object.freeze({
            kind: "noninferiority-latency",
            metric: margin.metric,
            status: "not-evaluable",
            profileId: profile.id
          }));
          reasons.push(Object.freeze({
            code: "missing-eligible-observations",
            message: `Metric ${margin.metric} lacks complete observations for profile ${profile.id}.`,
            metric: margin.metric,
            profileId: profile.id
          }));
          continue;
        }
        const allowedRegression = Math.max(margin.maximumAbsoluteRegression, baseline.p95Ms * margin.maximumRelativeRegression);
        const observedEffect = candidate.p95Ms - baseline.p95Ms;
        const passed = observedEffect <= allowedRegression;
        checks.push(Object.freeze({
          kind: "noninferiority-latency",
          metric: margin.metric,
          status: passed ? "passed" : "failed",
          profileId: profile.id,
          baselineObserved: baseline.p95Ms,
          candidateObserved: candidate.p95Ms,
          observedEffect,
          allowedRegression,
          durationScope: operation === "packing" ? "context-ready-elapsed" : "query-operation"
        }));
        if (!passed) {
          reasons.push(Object.freeze({
            code: "noninferiority-margin-exceeded",
            message: `Metric ${margin.metric} exceeds its noninferiority allowance for profile ${profile.id}.`,
            metric: margin.metric,
            profileId: profile.id
          }));
        }
      }
    }
    const canonical = canonicalReasons(reasons);
    return Object.freeze({
      baselineRetrieverId,
      candidateRetrieverId,
      passed: canonical.length === 0 && checks.every(({ status }) => status === "passed"),
      checks: Object.freeze(checks),
      reasons: canonical
    });
  });
  const candidateGates = retrieverGates.filter(({ candidateRetrieverId }) => officialCandidateIds.has(candidateRetrieverId));
  const gateByRetrieverId = new Map(retrieverGates.map((gate) => [gate.candidateRetrieverId, gate]));
  const complexity = corpus.retrievers.filter((descriptor) => descriptor.role === "ablation" || descriptor.role === "candidate").map((descriptor) => Object.freeze({
    retrieverId: descriptor.id,
    role: descriptor.role,
    score: variantComplexity(descriptor)
  })).toSorted(compareVariantComplexity);
  const passingRetrieverIds = complexity.filter(({ retrieverId }) => gateByRetrieverId.get(retrieverId)?.passed === true).map(({ retrieverId }) => retrieverId);
  const passingComplexity = complexity.filter(({ retrieverId }) => gateByRetrieverId.get(retrieverId)?.passed === true);
  const incrementalChecks = [];
  let selectedRetrieverId = null;
  for (const candidate of passingComplexity) {
    if (candidate.role !== "candidate" || !officialCandidateIds.has(candidate.retrieverId))
      continue;
    const simpler = passingComplexity.filter((baseline) => isStrictlySimplerVariant(baseline, candidate));
    if (simpler.length === 0) {
      selectedRetrieverId = candidate.retrieverId;
      continue;
    }
    let clearsEverySimplerVariant = true;
    for (const baseline of simpler) {
      for (const effect of corpus.experiment.protocol.minimumUsefulEffects) {
        const sliceId = `cohort:${effect.cohort}`;
        const slice = slices.find((entry) => entry.id === sliceId);
        if (slice === undefined)
          throw new Error(`Analysis lost incremental slice ${sliceId}.`);
        const comparison = pairedEffect({
          baselineRetrieverId: baseline.retrieverId,
          candidateRetrieverId: candidate.retrieverId,
          metric: effect.metric,
          slice,
          queries,
          baselineScores: scoresByRetriever.get(baseline.retrieverId) ?? new Map,
          candidateScores: scoresByRetriever.get(candidate.retrieverId) ?? new Map,
          suiteSha256: report.suiteSha256,
          bootstrapResamples
        });
        if (comparison !== undefined) {
          bootstrapDraws += comparison.observedPairs * bootstrapResamples;
          if (bootstrapDraws > MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2) {
            throw new RangeError(`Analysis bootstrap would exceed ${MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2} paired draws.`);
          }
          pairedEffects.push(comparison);
        }
        const completeAndPowered = comparison !== undefined && comparison.eligibleQueries > 0 && comparison.observedPairs === comparison.eligibleQueries && comparison.sourceFamilyClusters >= corpus.experiment.protocol.pairedPower.requiredPairs && comparison.inferenceStatus === "estimable";
        const passed = completeAndPowered && comparison.favorableOneSidedLower >= effect.minimumAbsoluteDifference;
        const status = !completeAndPowered ? "not-evaluable" : passed ? "passed" : "failed";
        incrementalChecks.push(Object.freeze({
          baselineRetrieverId: baseline.retrieverId,
          candidateRetrieverId: candidate.retrieverId,
          metric: effect.metric,
          sliceId,
          status,
          eligibleQueries: comparison?.eligibleQueries ?? queries.filter((query) => queryInSlice(query, slice) && metricEligible(query, effect.metric)).length,
          observedPairs: comparison?.observedPairs ?? 0,
          sourceFamilyClusters: comparison?.sourceFamilyClusters ?? 0,
          requiredImprovement: effect.minimumAbsoluteDifference,
          ...comparison === undefined ? {} : {
            observedEffect: comparison.favorableInterval.observedDifference,
            confidenceLower: comparison.favorableOneSidedLower,
            confidenceUpper: comparison.favorableInterval.upper
          }
        }));
        if (!passed)
          clearsEverySimplerVariant = false;
      }
    }
    if (clearsEverySimplerVariant)
      selectedRetrieverId = candidate.retrieverId;
  }
  const variantSelection = Object.freeze({
    baselineRetrieverId,
    orderedRetrieverIds: Object.freeze(complexity.map(({ retrieverId }) => retrieverId)),
    passingRetrieverIds: Object.freeze(passingRetrieverIds),
    selectedRetrieverId,
    incrementalChecks: Object.freeze(incrementalChecks),
    complexity: Object.freeze(complexity)
  });
  return Object.freeze({
    schemaVersion: 2,
    suiteSha256: report.suiteSha256,
    candidateLockSha256: report.candidateLockSha256,
    split: report.split,
    cutoff,
    bootstrap: Object.freeze({
      confidence: 0.95,
      resamples: bootstrapResamples,
      draws: bootstrapDraws
    }),
    warmQueryProfileId: warmProfile?.id ?? null,
    qualityProfileId: qualityProfile?.id ?? null,
    slices,
    retrievers: Object.freeze(retrievers),
    pairedEffects: Object.freeze(pairedEffects),
    latencyProfiles: Object.freeze(latencyProfiles),
    candidateGates: Object.freeze(candidateGates),
    retrieverGates: Object.freeze(retrieverGates),
    variantSelection
  });
}
// src/evaluation-execution-v2.ts
import { createHash as createHash7 } from "crypto";

// src/evaluation-kb-closure.ts
var MAX_EXISTING_LANE_CLOSURE_RESULTS = 1000;
var MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES = 4096;
var MAX_EXISTING_LANE_CLOSURE_EVIDENCE_UNITS = 100;
var MAX_EXISTING_LANE_CLOSURE_TOTAL_EVIDENCE_UNITS = 512;
var MAX_EXISTING_LANE_CLOSURE_PROVENANCE_BYTES = 256 * 1024;
var MAX_EXISTING_LANE_CLOSURE_EVIDENCE_BYTES = 8 * 1024 * 1024;
var MAX_EXISTING_LANE_CLOSURE_DIAGNOSTICS = 100;
var EXISTING_LANE_CLOSURE_FUSION = "primary-prefix-then-round-robin-v1";
var existingLaneClosureStructuralLaneIds = Object.freeze([
  "metadata",
  "graph",
  "path-context"
]);
var structuralLaneIds = new Set(existingLaneClosureStructuralLaneIds);
var sourceClasses = new Set([
  "authored-note",
  "captured-source",
  "git-history",
  "repository-file"
]);
var trustClasses2 = new Set([
  "authoritative-current",
  "authoritative-historical",
  "captured-primary",
  "captured-secondary",
  "maintained-synthesis",
  "untrusted-capture"
]);
var sourceTrustCompatibility = Object.freeze({
  "authored-note": new Set([
    "authoritative-current",
    "authoritative-historical",
    "maintained-synthesis"
  ]),
  "captured-source": new Set([
    "captured-primary",
    "captured-secondary",
    "untrusted-capture"
  ]),
  "git-history": new Set(["authoritative-historical"]),
  "repository-file": new Set(["authoritative-current"])
});
var metricKeyPattern = /^[a-z][a-z0-9_.-]{0,127}$/iu;
var windowsAbsolutePattern2 = /^[a-z]:[\\/]/iu;
var MAX_DESCRIPTOR_TEXT_BYTES = 16 * 1024;
var MAX_METRICS_PER_LANE = 32;
var MAX_JSON_DEPTH = 16;
var MAX_JSON_ARRAY_ITEMS = 1e4;
var MAX_JSON_OBJECT_FIELDS = 1000;
var MAX_JSON_STRING_BYTES = 1 * 1024 * 1024;
function hasUnpairedSurrogate3(value) {
  for (let index = 0;index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (next < 56320 || next > 57343)
        return true;
      index += 1;
    } else if (code >= 56320 && code <= 57343)
      return true;
  }
  return false;
}
function boundedString2(value, label, maximumBytes = MAX_DESCRIPTOR_TEXT_BYTES) {
  if (typeof value !== "string" || value.trim() === "" || /[\0\r\n]/u.test(value) || hasUnpairedSurrogate3(value) || value.normalize("NFC") !== value || Buffer.byteLength(value, "utf8") > maximumBytes)
    throw new TypeError(`${label} must be a non-empty NFC single-line bounded string.`);
  return value;
}
function plainRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must not inherit prototype capabilities.`);
  }
  return value;
}
function dataRecord(value, required, optional, label) {
  const input = plainRecord(value, label);
  const allowed = new Set([...required, ...optional]);
  const seen = new Set;
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key === "symbol")
      throw new TypeError(`${label} must not contain symbol fields.`);
    if (!allowed.has(key))
      throw new TypeError(`${label} has unknown field ${key}.`);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable data property.`);
    }
    seen.add(key);
  }
  for (const key of required) {
    if (!seen.has(key))
      throw new TypeError(`${label}.${key} is required.`);
  }
  return input;
}
function dynamicDataEntries(value, label) {
  const input = plainRecord(value, label);
  const output = [];
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key === "symbol")
      throw new TypeError(`${label} must not contain symbol fields.`);
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable data property.`);
    }
    output.push(Object.freeze([key, descriptor.value]));
  }
  return Object.freeze(output);
}
function ownData(value, key, label) {
  const input = plainRecord(value, label);
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined)
    return;
  if (!descriptor.enumerable || !("value" in descriptor)) {
    throw new TypeError(`${label}.${key} must be an enumerable data property.`);
  }
  return descriptor.value;
}
function dataArray(value, label, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a plain array.`);
  }
  if (value.length > maximum)
    throw new TypeError(`${label} may have at most ${maximum} entries.`);
  const allowed = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol")
      throw new TypeError(`${label} must not contain symbol fields.`);
    if (!allowed.has(key))
      throw new TypeError(`${label} has an unexpected array field ${key}.`);
  }
  const output = [];
  for (let index = 0;index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}[${index}] must be an enumerable data property.`);
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}
function positiveLimit(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EXISTING_LANE_CLOSURE_RESULTS)
    throw new TypeError(`${label} must be an integer from 1 through ${MAX_EXISTING_LANE_CLOSURE_RESULTS}.`);
  return value;
}
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}
function nonnegativeNumber2(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}
function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}
function boundedPositiveInteger(value, label, maximum = 1e6) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return value;
}
function confinedPath4(value, label, allowRoot = false) {
  const path = boundedString2(value, label, 4096);
  if (allowRoot && path === ".")
    return path;
  if (path.startsWith("/") || windowsAbsolutePattern2.test(path) || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === ".."))
    throw new TypeError(`${label} must be a confined repository-relative path.`);
  return path;
}
function checkedSum(values, label) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total))
    throw new TypeError(`${label} exceeds the safe integer bound.`);
  return total;
}
function freezeExistingLaneClosureVariant(value) {
  const input = dataRecord(value, ["primary", "structuralLanes", "git", "outputLimit"], [], "existing-lane closure variant");
  let primary;
  if (input.primary === null)
    primary = null;
  else {
    const descriptor = dataRecord(input.primary, ["lane", "retrieveLimit", "retainLimit"], [], "existing-lane closure variant primary");
    if (descriptor.lane !== "hybrid")
      throw new TypeError("Closure primary.lane must be hybrid.");
    const retrieveLimit = positiveLimit(descriptor.retrieveLimit, "closure primary.retrieveLimit");
    const retainLimit = positiveLimit(descriptor.retainLimit, "closure primary.retainLimit");
    if (retainLimit > retrieveLimit)
      throw new TypeError("Closure primary.retainLimit may not exceed retrieveLimit.");
    primary = Object.freeze({ lane: "hybrid", retrieveLimit, retainLimit });
  }
  const rawStructural = dataArray(input.structuralLanes, "closure structuralLanes", 3);
  const seen = new Set;
  const structuralLanes = rawStructural.map((value2, index) => {
    const descriptor = dataRecord(value2, ["lane", "limit"], [], `closure structuralLanes[${index}]`);
    if (typeof descriptor.lane !== "string" || !structuralLaneIds.has(descriptor.lane)) {
      throw new TypeError(`closure structuralLanes[${index}].lane must be metadata, graph, or path-context.`);
    }
    if (seen.has(descriptor.lane))
      throw new TypeError("Closure structuralLanes must be unique.");
    seen.add(descriptor.lane);
    return Object.freeze({
      lane: descriptor.lane,
      limit: positiveLimit(descriptor.limit, `closure structuralLanes[${index}].limit`)
    });
  });
  const rawGit = plainRecord(input.git, "closure git");
  const mode = ownData(rawGit, "mode", "closure git");
  let git;
  if (mode === "off") {
    dataRecord(rawGit, ["mode"], [], "closure git");
    git = Object.freeze({ mode: "off" });
  } else if (mode === "explicit-input") {
    const descriptor = dataRecord(rawGit, ["mode", "limit"], [], "closure git");
    git = Object.freeze({
      mode: "explicit-input",
      limit: positiveLimit(descriptor.limit, "closure git.limit")
    });
  } else
    throw new TypeError("Closure git.mode must be off or explicit-input.");
  const outputLimit = positiveLimit(input.outputLimit, "closure outputLimit");
  const candidateCapacity = checkedSum([
    primary?.retrieveLimit ?? 0,
    ...structuralLanes.map(({ limit }) => limit),
    git.mode === "explicit-input" ? git.limit : 0
  ], "Closure candidate capacity");
  if (candidateCapacity > MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES) {
    throw new TypeError(`Closure candidate capacity exceeds ${MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES}.`);
  }
  return Object.freeze({
    primary,
    structuralLanes: Object.freeze(structuralLanes),
    git,
    outputLimit
  });
}
function parseStringArray(value, label, maximum, options = {}) {
  const entries = dataArray(value, label, maximum);
  if (options.allowEmpty !== true && entries.length === 0)
    throw new TypeError(`${label} must not be empty.`);
  const output = entries.map((entry, index) => options.confined === true ? confinedPath4(entry, `${label}[${index}]`) : boundedString2(entry, `${label}[${index}]`));
  if (new Set(output).size !== output.length)
    throw new TypeError(`${label} must not repeat entries.`);
  return Object.freeze(output);
}
function copyHybridInput(value) {
  const input = dataRecord(value, ["text"], [], "closure hybrid input");
  return Object.freeze({ text: boundedString2(input.text, "closure hybrid input.text") });
}
function copyMetadataInput(value) {
  const input = dataRecord(value, ["filters", "tags"], [], "closure metadata input");
  const rawFilters = dataArray(input.filters, "closure metadata input.filters", 32);
  const filters = rawFilters.map((value2, index) => {
    const label = `closure metadata input.filters[${index}]`;
    const candidate = plainRecord(value2, label);
    const kind = ownData(candidate, "kind", label);
    if (kind === "exists") {
      const filter = dataRecord(candidate, ["kind", "path"], [], label);
      return Object.freeze({ kind, path: boundedString2(filter.path, `${label}.path`) });
    }
    if (kind === "equals") {
      const filter = dataRecord(candidate, ["kind", "path", "value"], [], label);
      const scalar = filter.value;
      if (scalar !== null && typeof scalar !== "string" && typeof scalar !== "boolean" && (typeof scalar !== "number" || !Number.isFinite(scalar)))
        throw new TypeError(`${label}.value must be a finite scalar or null.`);
      return Object.freeze({
        kind,
        path: boundedString2(filter.path, `${label}.path`),
        value: scalar
      });
    }
    throw new TypeError(`${label}.kind must be exists or equals.`);
  });
  const tags = parseStringArray(input.tags, "closure metadata input.tags", 32, { allowEmpty: true });
  if (filters.length === 0 && tags.length === 0) {
    throw new TypeError("Closure metadata input must contain a filter or tag.");
  }
  return Object.freeze({ filters: Object.freeze(filters), tags });
}
function copyGraphInput(value) {
  const input = dataRecord(value, ["seeds", "depth"], [], "closure graph input");
  if (input.depth !== 1 && input.depth !== 2)
    throw new TypeError("Closure graph input.depth must be 1 or 2.");
  return Object.freeze({
    seeds: parseStringArray(input.seeds, "closure graph input.seeds", 10, { confined: true }),
    depth: input.depth
  });
}
function copyPathContextInput(value) {
  const input = dataRecord(value, ["repositoryPath"], [], "closure path-context input");
  return Object.freeze({
    repositoryPath: confinedPath4(input.repositoryPath, "closure path-context input.repositoryPath", true)
  });
}
function copyGitInput(value) {
  const input = dataRecord(value, ["query", "noteIds"], [], "closure Git input");
  return Object.freeze({
    query: boundedString2(input.query, "closure Git input.query"),
    noteIds: parseStringArray(input.noteIds, "closure Git input.noteIds", 100, {
      confined: true,
      allowEmpty: true
    })
  });
}
function parseLocator(value, label) {
  const input = dataRecord(value, [
    "evidenceUnitId",
    "documentId",
    "sourceFamilyId",
    "sourceClass",
    "trustClass",
    "sourcePath",
    "lineRange",
    "headingPath"
  ], ["sourcePage"], label);
  if (typeof input.sourceClass !== "string" || !sourceClasses.has(input.sourceClass)) {
    throw new TypeError(`${label}.sourceClass is invalid.`);
  }
  if (typeof input.trustClass !== "string" || !trustClasses2.has(input.trustClass)) {
    throw new TypeError(`${label}.trustClass is invalid.`);
  }
  const sourceClass = input.sourceClass;
  const trustClass = input.trustClass;
  if (!sourceTrustCompatibility[sourceClass].has(trustClass)) {
    throw new TypeError(`${label} sourceClass and trustClass are incompatible.`);
  }
  const rawRange = dataRecord(input.lineRange, ["start", "end"], [], `${label}.lineRange`);
  const start = boundedPositiveInteger(rawRange.start, `${label}.lineRange.start`);
  const end = boundedPositiveInteger(rawRange.end, `${label}.lineRange.end`);
  if (end < start)
    throw new TypeError(`${label}.lineRange.end may not precede start.`);
  const sourcePage = input.sourcePage === undefined ? undefined : boundedPositiveInteger(input.sourcePage, `${label}.sourcePage`);
  return Object.freeze({
    evidenceUnitId: boundedString2(input.evidenceUnitId, `${label}.evidenceUnitId`, 512),
    documentId: confinedPath4(input.documentId, `${label}.documentId`),
    sourceFamilyId: boundedString2(input.sourceFamilyId, `${label}.sourceFamilyId`, 512),
    sourceClass,
    trustClass,
    sourcePath: confinedPath4(input.sourcePath, `${label}.sourcePath`),
    lineRange: Object.freeze({ start, end }),
    headingPath: parseStringArray(input.headingPath, `${label}.headingPath`, 32, { allowEmpty: true }),
    ...sourcePage === undefined ? {} : { sourcePage }
  });
}
function locatorKey(locator) {
  return JSON.stringify([
    locator.evidenceUnitId,
    locator.documentId,
    locator.sourceFamilyId,
    locator.sourceClass,
    locator.trustClass,
    locator.sourcePath,
    locator.lineRange.start,
    locator.lineRange.end,
    locator.headingPath,
    locator.sourcePage ?? null
  ]);
}
function freezeExistingLaneClosureEvidenceRegistry(value) {
  const input = dataRecord(value, ["units"], [], "existing-lane closure evidence registry");
  const rawUnits = dataArray(input.units, "existing-lane closure evidence registry.units", MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES * MAX_EXISTING_LANE_CLOSURE_EVIDENCE_UNITS);
  const ids = new Set;
  const units = rawUnits.map((unit, index) => {
    const parsed = parseLocator(unit, `existing-lane closure evidence registry.units[${index}]`);
    if (ids.has(parsed.evidenceUnitId)) {
      throw new TypeError(`Closure evidence registry repeats unit ${parsed.evidenceUnitId}.`);
    }
    ids.add(parsed.evidenceUnitId);
    return parsed;
  });
  return Object.freeze({ units: Object.freeze(units) });
}
function parseBackend(value, lane) {
  const input = dataRecord(value, ["retrieve"], [], `closure ${lane} backend`);
  if (typeof input.retrieve !== "function")
    throw new TypeError(`Closure ${lane} backend.retrieve must be a function.`);
  return Object.freeze({
    retrieve: input.retrieve
  });
}
function invokedLane(options) {
  const laneRequest = Object.freeze({ input: options.input, limit: options.limit, signal: options.signal });
  return Object.freeze({
    kind: "invoke",
    lane: options.lane,
    limit: options.limit,
    ...options.retainLimit === undefined ? {} : { retainLimit: options.retainLimit },
    invoke: () => options.backend.retrieve(laneRequest)
  });
}
function prepareLanes(variant, query, backends, signal) {
  const rawInputs = ownData(query, "inputs", "existing-lane closure query");
  const inputs = plainRecord(rawInputs, "existing-lane closure query.inputs");
  const lanes2 = [];
  const prepare = (options) => {
    const rawInput = ownData(inputs, options.inputKey, "existing-lane closure query.inputs");
    if (rawInput === undefined) {
      lanes2.push(Object.freeze({ kind: "missing", lane: options.lane, limit: options.limit }));
      return;
    }
    const input = options.copy(rawInput);
    const rawBackend = ownData(backends, options.backendKey, "existing-lane closure backends");
    lanes2.push(invokedLane({
      lane: options.lane,
      limit: options.limit,
      ...options.retainLimit === undefined ? {} : { retainLimit: options.retainLimit },
      input,
      backend: parseBackend(rawBackend, options.lane),
      signal
    }));
  };
  if (variant.primary === null)
    lanes2.push(Object.freeze({ kind: "disabled", lane: "hybrid" }));
  else
    prepare({
      lane: "hybrid",
      inputKey: "hybrid",
      backendKey: "hybrid",
      limit: variant.primary.retrieveLimit,
      retainLimit: variant.primary.retainLimit,
      copy: copyHybridInput
    });
  for (const descriptor of variant.structuralLanes) {
    if (descriptor.lane === "metadata")
      prepare({
        lane: "metadata",
        inputKey: "metadata",
        backendKey: "metadata",
        limit: descriptor.limit,
        copy: copyMetadataInput
      });
    else if (descriptor.lane === "graph")
      prepare({
        lane: "graph",
        inputKey: "graph",
        backendKey: "graph",
        limit: descriptor.limit,
        copy: copyGraphInput
      });
    else
      prepare({
        lane: "path-context",
        inputKey: "pathContext",
        backendKey: "pathContext",
        limit: descriptor.limit,
        copy: copyPathContextInput
      });
  }
  if (variant.git.mode === "off")
    lanes2.push(Object.freeze({ kind: "disabled", lane: "git" }));
  else
    prepare({
      lane: "git",
      inputKey: "history",
      backendKey: "git",
      limit: variant.git.limit,
      copy: copyGitInput
    });
  return Object.freeze(lanes2);
}
function copyJsonValue(value, label, depth = 0, ancestors = new WeakSet) {
  if (value === null || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError(`${label} numbers must be finite.`);
    return value;
  }
  if (typeof value === "string") {
    if (hasUnpairedSurrogate3(value) || Buffer.byteLength(value, "utf8") > MAX_JSON_STRING_BYTES) {
      throw new TypeError(`${label} strings must be bounded valid Unicode.`);
    }
    return value;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`${label} must contain only JSON values.`);
  }
  if (depth >= MAX_JSON_DEPTH)
    throw new TypeError(`${label} exceeds the JSON depth bound.`);
  if (ancestors.has(value))
    throw new TypeError(`${label} must not contain cycles.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const entries2 = dataArray(value, label, MAX_JSON_ARRAY_ITEMS);
      return Object.freeze(entries2.map((entry, index) => copyJsonValue(entry, `${label}[${index}]`, depth + 1, ancestors)));
    }
    const entries = dynamicDataEntries(value, label);
    if (entries.length > MAX_JSON_OBJECT_FIELDS) {
      throw new TypeError(`${label} exceeds the JSON object-field bound.`);
    }
    const output = Object.create(null);
    for (const [key, entry] of entries.toSorted(([left], [right]) => left.localeCompare(right))) {
      if (hasUnpairedSurrogate3(key) || Buffer.byteLength(key, "utf8") > MAX_DESCRIPTOR_TEXT_BYTES) {
        throw new TypeError(`${label} has an invalid JSON field name.`);
      }
      output[key] = copyJsonValue(entry, `${label}.${key}`, depth + 1, ancestors);
    }
    return Object.freeze(output);
  } finally {
    ancestors.delete(value);
  }
}
function parseMetricMap(value, label) {
  if (value === undefined)
    return Object.freeze({});
  const entries = dynamicDataEntries(value, label);
  if (entries.length > MAX_METRICS_PER_LANE)
    throw new TypeError(`${label} has too many entries.`);
  const output = {};
  for (const [key, candidate] of entries.toSorted(([left], [right]) => left.localeCompare(right))) {
    if (!metricKeyPattern.test(key))
      throw new TypeError(`${label} has invalid key ${JSON.stringify(key)}.`);
    output[key] = nonnegativeNumber2(candidate, `${label}.${key}`);
  }
  return Object.freeze(output);
}
function parseAccounting(value, label) {
  const input = dataRecord(value, ["llm", "embedding", "packedContext", "peakRssBytes", "cacheBytes"], [], label);
  const llm = dataRecord(input.llm, ["calls", "inputTokens", "outputTokens"], [], `${label}.llm`);
  if (llm.calls !== 0 || llm.inputTokens !== 0 || llm.outputTokens !== 0) {
    throw new TypeError(`${label}.llm requires literal-zero calls, inputTokens, and outputTokens.`);
  }
  const embedding = dataRecord(input.embedding, ["calls", "inputTokens", "durationMs"], ["inputTokensMeasured", "durationScope"], `${label}.embedding`);
  const packedContext = dataRecord(input.packedContext, ["utf8Bytes", "readerTokens"], [], `${label}.packedContext`);
  const embeddingCalls = nonnegativeInteger(embedding.calls, `${label}.embedding.calls`);
  const embeddingInputTokens = nonnegativeInteger(embedding.inputTokens, `${label}.embedding.inputTokens`);
  const embeddingDurationMs = nonnegativeNumber2(embedding.durationMs, `${label}.embedding.durationMs`);
  if (Object.hasOwn(embedding, "inputTokensMeasured") && embedding.inputTokensMeasured !== false) {
    throw new TypeError(`${label}.embedding.inputTokensMeasured must be literal false when present.`);
  }
  const durationScopeValue = embedding.durationScope;
  if (Object.hasOwn(embedding, "durationScope") && durationScopeValue !== "embedding-backed-search-upper-bound") {
    throw new TypeError(`${label}.embedding.durationScope must be embedding-backed-search-upper-bound when present.`);
  }
  const durationScope = durationScopeValue === "embedding-backed-search-upper-bound" ? durationScopeValue : undefined;
  if (embeddingCalls === 0) {
    if (embeddingInputTokens !== 0 || embeddingDurationMs !== 0 || embedding.inputTokensMeasured !== undefined || durationScope !== undefined)
      throw new TypeError(`${label}.embedding zero-call accounting must be the exact unannotated zero record.`);
  } else if (embedding.inputTokensMeasured === false && embeddingInputTokens !== 0) {
    throw new TypeError(`${label}.embedding unmeasured input tokens must use zero only as an explicit placeholder.`);
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: embeddingCalls,
      inputTokens: embeddingInputTokens,
      ...embedding.inputTokensMeasured === false ? { inputTokensMeasured: false } : {},
      durationMs: embeddingDurationMs,
      ...durationScope === undefined ? {} : { durationScope }
    }),
    packedContext: Object.freeze({
      utf8Bytes: nonnegativeInteger(packedContext.utf8Bytes, `${label}.packedContext.utf8Bytes`),
      readerTokens: nonnegativeInteger(packedContext.readerTokens, `${label}.packedContext.readerTokens`)
    }),
    peakRssBytes: nonnegativeInteger(input.peakRssBytes, `${label}.peakRssBytes`),
    cacheBytes: nonnegativeInteger(input.cacheBytes, `${label}.cacheBytes`)
  });
}
function copyDiagnostic(value, label) {
  const input = dataRecord(value, ["code", "status"], ["message", "details"], label);
  if (input.status !== "ready" && input.status !== "degraded" && input.status !== "unavailable") {
    throw new TypeError(`${label}.status is invalid.`);
  }
  let details;
  if (input.details !== undefined) {
    const entries = dynamicDataEntries(input.details, `${label}.details`);
    if (entries.length > 32)
      throw new TypeError(`${label}.details has too many entries.`);
    const output = {};
    for (const [key, candidate] of entries.toSorted(([left], [right]) => left.localeCompare(right))) {
      boundedString2(key, `${label}.details key`, 256);
      if (candidate !== null && typeof candidate !== "string" && typeof candidate !== "boolean" && (typeof candidate !== "number" || !Number.isFinite(candidate)))
        throw new TypeError(`${label}.details.${key} must be a finite scalar or null.`);
      output[key] = candidate;
    }
    details = Object.freeze(output);
  }
  return Object.freeze({
    code: boundedString2(input.code, `${label}.code`, 256),
    status: input.status,
    ...input.message === undefined ? {} : {
      message: boundedString2(input.message, `${label}.message`)
    },
    ...details === undefined ? {} : { details }
  });
}
function copyHit(value, label, registry, lane) {
  const input = dataRecord(value, ["documentId", "canonicalDocumentId", "rank"], ["score", "evidenceUnits", "evidence"], label);
  const documentId = confinedPath4(input.documentId, `${label}.documentId`);
  const canonicalDocumentId = confinedPath4(input.canonicalDocumentId, `${label}.canonicalDocumentId`);
  const rank = positiveLimit(input.rank, `${label}.rank`);
  const score = input.score === undefined ? undefined : finiteNumber(input.score, `${label}.score`);
  let evidenceUnits;
  let provenanceBytes = 0;
  if (input.evidenceUnits !== undefined) {
    const rawUnits = dataArray(input.evidenceUnits, `${label}.evidenceUnits`, MAX_EXISTING_LANE_CLOSURE_EVIDENCE_UNITS);
    const ids = new Set;
    evidenceUnits = Object.freeze(rawUnits.map((value2, index) => {
      const unitLabel = `${label}.evidenceUnits[${index}]`;
      const rawUnit = dataRecord(value2, ["id", "locator"], [], unitLabel);
      const id = boundedString2(rawUnit.id, `${unitLabel}.id`, 512);
      if (ids.has(id))
        throw new TypeError(`${label}.evidenceUnits must not repeat IDs.`);
      ids.add(id);
      const parsedLocator = parseLocator(rawUnit.locator, `${unitLabel}.locator`);
      if (parsedLocator.evidenceUnitId !== id) {
        throw new TypeError(`${unitLabel} must pair its ID with the same locator evidenceUnitId.`);
      }
      const bound = registry.get(id);
      if (bound === undefined || locatorKey(bound) !== locatorKey(parsedLocator)) {
        throw new TypeError(`${unitLabel}.locator does not exactly match the frozen registry binding.`);
      }
      if (bound.documentId !== canonicalDocumentId && lane !== "graph") {
        throw new TypeError(`${unitLabel}.locator belongs to a different canonical document.`);
      }
      provenanceBytes += Buffer.byteLength(locatorKey(bound), "utf8");
      return Object.freeze({ id, locator: bound });
    }));
  }
  const evidence = input.evidence === undefined ? undefined : copyJsonValue(input.evidence, `${label}.evidence`);
  const evidenceBytes = evidence === undefined ? 0 : Buffer.byteLength(JSON.stringify(evidence), "utf8");
  const hit = Object.freeze({
    documentId,
    canonicalDocumentId,
    rank,
    ...score === undefined ? {} : { score },
    ...evidenceUnits === undefined ? {} : { evidenceUnits },
    ...evidence === undefined ? {} : { evidence }
  });
  return Object.freeze({
    hit,
    evidenceUnitCount: evidenceUnits?.length ?? 0,
    provenanceBytes,
    evidenceBytes
  });
}
function validateLaneResult(value, lane, limit, registry) {
  const input = dataRecord(value, ["status", "hits", "accounting"], ["diagnostics", "timings", "resources"], `closure ${lane} result`);
  if (input.status !== "ready" && input.status !== "degraded" && input.status !== "unavailable") {
    throw new TypeError(`Closure ${lane} result.status is invalid.`);
  }
  const rawHits = dataArray(input.hits, `closure ${lane} result.hits`, limit);
  const copied = rawHits.map((hit, index) => copyHit(hit, `closure ${lane} result.hits[${index}]`, registry, lane));
  const ranks = copied.map(({ hit }) => hit.rank);
  if (new Set(ranks).size !== ranks.length)
    throw new TypeError(`Closure ${lane} result ranks must be unique.`);
  if (input.status === "unavailable" && copied.length > 0) {
    throw new TypeError(`Closure ${lane} unavailable results may not contain hits.`);
  }
  const rawDiagnostics = input.diagnostics === undefined ? Object.freeze([]) : dataArray(input.diagnostics, `closure ${lane} result.diagnostics`, MAX_EXISTING_LANE_CLOSURE_DIAGNOSTICS);
  return Object.freeze({
    status: input.status,
    hits: Object.freeze(copied.map(({ hit }) => hit).toSorted((left, right) => left.rank - right.rank)),
    diagnostics: Object.freeze(rawDiagnostics.map((diagnostic, index) => copyDiagnostic(diagnostic, `closure ${lane} result.diagnostics[${index}]`))),
    timings: parseMetricMap(input.timings, `closure ${lane} result.timings`),
    resources: parseMetricMap(input.resources, `closure ${lane} result.resources`),
    accounting: parseAccounting(input.accounting, `closure ${lane} result.accounting`),
    evidenceUnitCount: copied.reduce((total, candidate) => total + candidate.evidenceUnitCount, 0),
    provenanceBytes: copied.reduce((total, candidate) => total + candidate.provenanceBytes, 0),
    evidenceBytes: copied.reduce((total, candidate) => total + candidate.evidenceBytes, 0)
  });
}
function aggregateAccounting(values) {
  const durationMs = values.reduce((total, value) => total + value.embedding.durationMs, 0);
  if (!Number.isFinite(durationMs))
    throw new TypeError("Closure embedding duration exceeds its finite bound.");
  const inputTokensMeasured = values.some(({ embedding }) => embedding.inputTokensMeasured === false) ? false : undefined;
  const durationScope = values.some(({ embedding }) => embedding.durationScope === "embedding-backed-search-upper-bound") ? "embedding-backed-search-upper-bound" : undefined;
  const cacheValues = new Set(values.map(({ cacheBytes }) => cacheBytes));
  if (cacheValues.size > 1) {
    throw new TypeError("Closure lanes must report one identical shared-cache byte count.");
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: checkedSum(values.map(({ embedding }) => embedding.calls), "Closure embedding calls"),
      inputTokens: inputTokensMeasured === false ? 0 : checkedSum(values.map(({ embedding }) => embedding.inputTokens), "Closure embedding input tokens"),
      ...inputTokensMeasured === false ? { inputTokensMeasured } : {},
      durationMs,
      ...durationScope === undefined ? {} : { durationScope }
    }),
    packedContext: Object.freeze({
      utf8Bytes: checkedSum(values.map(({ packedContext }) => packedContext.utf8Bytes), "Closure packed-context bytes"),
      readerTokens: checkedSum(values.map(({ packedContext }) => packedContext.readerTokens), "Closure packed-context reader tokens")
    }),
    peakRssBytes: Math.max(0, ...values.map(({ peakRssBytes }) => peakRssBytes)),
    cacheBytes: values[0]?.cacheBytes ?? 0
  });
}
function throwIfAborted(signal) {
  if (!signal.aborted)
    return;
  if (signal.reason instanceof Error)
    throw signal.reason;
  throw new Error("Existing-lane closure was aborted.");
}
function evidenceTrace(hit) {
  const evidenceUnits = hit.evidenceUnits ?? Object.freeze([]);
  return Object.freeze({
    evidenceUnits,
    evidenceUnitIds: Object.freeze(evidenceUnits.map(({ id }) => id)),
    provenance: Object.freeze(evidenceUnits.map(({ locator }) => locator)),
    ...hit.evidence === undefined ? {} : { evidence: hit.evidence }
  });
}
function sourceTrace(lane, hit, evidence) {
  return Object.freeze({ lane, sourceRank: hit.rank, ...evidence });
}
async function runExistingLaneClosure(request) {
  const variant = freezeExistingLaneClosureVariant(request.variant);
  const evidenceRegistry = freezeExistingLaneClosureEvidenceRegistry(request.evidenceRegistry);
  const registryById = new Map(evidenceRegistry.units.map((unit) => [unit.evidenceUnitId, unit]));
  const lanes2 = prepareLanes(variant, request.query, request.backends, request.signal);
  throwIfAborted(request.signal);
  const completed = [];
  const timings = {};
  const resources = {};
  const invokedAccounting = [];
  let totalCandidates = 0;
  let totalEvidenceUnits = 0;
  let totalProvenanceBytes = 0;
  let totalEvidenceBytes = 0;
  for (const lane of lanes2) {
    throwIfAborted(request.signal);
    if (lane.kind !== "invoke") {
      completed.push(lane);
      continue;
    }
    const result = validateLaneResult(await lane.invoke(), lane.lane, lane.limit, registryById);
    throwIfAborted(request.signal);
    totalCandidates += result.hits.length;
    totalEvidenceUnits += result.evidenceUnitCount;
    totalProvenanceBytes += result.provenanceBytes;
    totalEvidenceBytes += result.evidenceBytes;
    if (totalCandidates > MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES) {
      throw new TypeError("Closure results exceed the aggregate candidate bound.");
    }
    if (totalEvidenceUnits > MAX_EXISTING_LANE_CLOSURE_TOTAL_EVIDENCE_UNITS) {
      throw new TypeError("Closure results exceed the aggregate evidence-unit bound.");
    }
    if (totalProvenanceBytes > MAX_EXISTING_LANE_CLOSURE_PROVENANCE_BYTES) {
      throw new TypeError("Closure results exceed the aggregate provenance-byte bound.");
    }
    if (totalEvidenceBytes > MAX_EXISTING_LANE_CLOSURE_EVIDENCE_BYTES) {
      throw new TypeError("Closure results exceed the aggregate opaque-evidence byte bound.");
    }
    for (const [key, value] of Object.entries(result.timings))
      timings[`${lane.lane}.${key}`] = value;
    for (const [key, value] of Object.entries(result.resources))
      resources[`${lane.lane}.${key}`] = value;
    invokedAccounting.push(result.accounting);
    completed.push(Object.freeze({
      kind: "complete",
      lane: lane.lane,
      limit: lane.limit,
      ...lane.retainLimit === undefined ? {} : { retainLimit: lane.retainLimit },
      result
    }));
  }
  const outputHits = [];
  const laneOutcomes = [];
  const documentOrder = [];
  const documentsById = new Map;
  const invokedStatuses = [];
  let missingProvenance = false;
  const mergeStates = new Map;
  for (const lane of completed) {
    if (lane.kind !== "complete")
      continue;
    invokedStatuses.push(lane.result.status);
    mergeStates.set(lane.lane, { lane, candidateTraces: [], accepted: 0 });
  }
  const mergeCandidate = (state, sourceIndex) => {
    const { lane } = state;
    const hit = lane.result.hits[sourceIndex];
    if (hit === undefined)
      return;
    const evidence = evidenceTrace(hit);
    const existing = documentsById.get(hit.canonicalDocumentId);
    let reasonCode;
    let outputRank;
    let decision;
    if (evidence.evidenceUnits.length === 0) {
      reasonCode = "missing-provenance";
      decision = "excluded";
      missingProvenance = true;
    } else if (lane.lane === "hybrid" && lane.retainLimit !== undefined && sourceIndex >= lane.retainLimit) {
      reasonCode = "primary-retain-limit";
      decision = "excluded";
    } else if (existing !== undefined) {
      reasonCode = "deduplicated";
      decision = "excluded";
      outputRank = existing.outputRank;
      existing.sources.push(sourceTrace(lane.lane, hit, evidence));
    } else if (outputHits.length >= variant.outputLimit) {
      reasonCode = "output-limit";
      decision = "excluded";
    } else {
      reasonCode = lane.lane === "hybrid" ? "primary" : "appended";
      decision = "accepted";
      outputHits.push(hit);
      outputRank = outputHits.length;
      state.accepted += 1;
      const document = {
        documentId: hit.documentId,
        canonicalDocumentId: hit.canonicalDocumentId,
        outputRank,
        sources: [sourceTrace(lane.lane, hit, evidence)]
      };
      documentOrder.push(document);
      documentsById.set(hit.canonicalDocumentId, document);
    }
    state.candidateTraces.push(Object.freeze({
      lane: lane.lane,
      decision,
      reasonCode,
      documentId: hit.documentId,
      canonicalDocumentId: hit.canonicalDocumentId,
      sourceRank: hit.rank,
      ...evidence,
      ...outputRank === undefined ? {} : { outputRank }
    }));
  };
  const primary = mergeStates.get("hybrid");
  if (primary !== undefined) {
    for (const sourceIndex of primary.lane.result.hits.keys()) {
      mergeCandidate(primary, sourceIndex);
    }
  }
  const appended = completed.filter((lane) => lane.kind === "complete" && lane.lane !== "hybrid").map((lane) => mergeStates.get(lane.lane)).filter((state) => state !== undefined);
  for (let sourceIndex = 0;; sourceIndex += 1) {
    let visited = false;
    for (const state of appended) {
      if (state.lane.result.hits[sourceIndex] === undefined)
        continue;
      visited = true;
      mergeCandidate(state, sourceIndex);
    }
    if (!visited)
      break;
  }
  for (const lane of completed) {
    if (lane.kind === "disabled") {
      laneOutcomes.push(Object.freeze({
        lane: lane.lane,
        invocation: "disabled",
        status: "skipped",
        diagnostics: Object.freeze([]),
        returned: 0,
        accepted: 0,
        excluded: 0,
        candidates: Object.freeze([])
      }));
      continue;
    }
    if (lane.kind === "missing") {
      laneOutcomes.push(Object.freeze({
        lane: lane.lane,
        invocation: "skipped-missing-input",
        status: "skipped",
        limit: lane.limit,
        diagnostics: Object.freeze([]),
        returned: 0,
        accepted: 0,
        excluded: 0,
        candidates: Object.freeze([])
      }));
      continue;
    }
    const state = mergeStates.get(lane.lane);
    if (state === undefined)
      throw new Error(`Closure merge state for ${lane.lane} is missing.`);
    laneOutcomes.push(Object.freeze({
      lane: lane.lane,
      invocation: "invoked",
      status: lane.result.status,
      limit: lane.limit,
      diagnostics: lane.result.diagnostics,
      returned: lane.result.hits.length,
      accepted: state.accepted,
      excluded: lane.result.hits.length - state.accepted,
      candidates: Object.freeze(state.candidateTraces)
    }));
  }
  const status = invokedStatuses.length === 0 ? "unavailable" : invokedStatuses.every((candidate) => candidate === "unavailable") ? "unavailable" : missingProvenance || invokedStatuses.some((candidate) => candidate !== "ready") ? "degraded" : "ready";
  const documents = Object.freeze(documentOrder.map((document) => Object.freeze({
    documentId: document.documentId,
    canonicalDocumentId: document.canonicalDocumentId,
    outputRank: document.outputRank,
    sources: Object.freeze([...document.sources])
  })));
  return Object.freeze({
    status,
    hits: Object.freeze(outputHits),
    trace: Object.freeze({
      variant,
      fusion: Object.freeze({
        id: EXISTING_LANE_CLOSURE_FUSION,
        primaryLane: variant.primary === null ? null : "hybrid",
        appendedLaneOrder: Object.freeze(completed.filter(({ kind, lane }) => kind !== "disabled" && lane !== "hybrid").map(({ lane }) => lane))
      }),
      lanes: Object.freeze(laneOutcomes),
      documents
    }),
    timings: Object.freeze(timings),
    resources: Object.freeze(resources),
    accounting: aggregateAccounting(invokedAccounting)
  });
}

// src/evaluation-kb-v2.ts
var SHA256 = /^[0-9a-f]{64}$/u;
var CANONICAL_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
var WINDOWS_ABSOLUTE_PATH2 = /^[a-z]:[\\/]/iu;
var MAX_DESCRIPTOR_TEXT_BYTES2 = 16 * 1024;
var MAX_DIAGNOSTIC_MESSAGE_BYTES = 16 * 1024;
var KNOWLEDGE_BASE_EVALUATION_ADAPTER_V2 = "evaluation-kb-v2";
var KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 = 10;
var KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2 = 5;
var KNOWLEDGE_BASE_EVALUATION_EMBEDDING_NOT_INVOKED_V2 = Object.freeze({
  calls: 0,
  inputTokens: 0,
  durationMs: 0
});
var verifiedKnowledgeBaseEvaluationsV2 = new WeakMap;
function assertVerifiedKnowledgeBaseEvaluationV2(evaluation, corpus) {
  const binding = verifiedKnowledgeBaseEvaluationsV2.get(evaluation);
  if (binding === undefined || binding.suiteSha256 !== corpus.manifest.corpusSha256 || binding.candidateLockSha256 !== corpus.manifest.candidateLockSha256 || binding.buildContractSha256 !== corpus.manifest.buildContractSha256 || binding.repositoryCommit !== corpus.frozen.repositoryCommit || binding.vaultTree !== corpus.frozen.vaultTree) {
    throw new TypeError("Evaluation runtime is not the implementation-bound adapter for this sealed corpus.");
  }
}
var knowledgeBaseExistingLaneClosureVariantsV2 = Object.freeze({
  "primary-only": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
    },
    structuralLanes: [],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
  }),
  "metadata-closure": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2
    },
    structuralLanes: [{
      lane: "metadata",
      limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
    }],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
  }),
  "graph-closure": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2
    },
    structuralLanes: [{
      lane: "graph",
      limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
    }],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
  }),
  "path-context-closure": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2
    },
    structuralLanes: [{
      lane: "path-context",
      limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
    }],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
  }),
  "structural-closure": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2
    },
    structuralLanes: [
      { lane: "metadata", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "graph", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "path-context", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 }
    ],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
  }),
  "structural-git-closure": freezeExistingLaneClosureVariant({
    primary: {
      lane: "hybrid",
      retrieveLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
      retainLimit: KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2
    },
    structuralLanes: [
      { lane: "metadata", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "graph", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "path-context", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 }
    ],
    git: {
      mode: "explicit-input",
      limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
    },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
  }),
  "structural-only": freezeExistingLaneClosureVariant({
    primary: null,
    structuralLanes: [
      { lane: "metadata", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "graph", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 },
      { lane: "path-context", limit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2 }
    ],
    git: { mode: "off" },
    outputLimit: KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2
  })
});
var laneInput = Object.freeze({
  exact: "text",
  keyword: "text",
  semantic: "text",
  hybrid: "text",
  metadata: "metadata",
  graph: "graph",
  "path-context": "context",
  git: "history"
});
function record2(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}
function ownData2(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined)
    return;
  if (!("value" in descriptor))
    throw new TypeError(`${label}.${key} must be a data property.`);
  return descriptor.value;
}
function boundedText(value, label, maximumBytes = MAX_DESCRIPTOR_TEXT_BYTES2) {
  if (typeof value !== "string" || value.trim() === "" || /[\0\r\n]/u.test(value) || value.normalize("NFC") !== value || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new TypeError(`${label} must be a non-empty NFC single-line bounded string.`);
  }
  return value;
}
function canonicalId2(value, label) {
  const id = boundedText(value, label, 256);
  if (!CANONICAL_ID.test(id))
    throw new TypeError(`${label} must be a canonical lowercase ID.`);
  return id;
}
function positiveLimit2(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EVALUATION_V2_RESULTS_PER_LANE)
    throw new TypeError(`${label} must be an integer from 1 through ${MAX_EVALUATION_V2_RESULTS_PER_LANE}.`);
  return value;
}
function definition(value, lane) {
  const input = record2(value, `descriptor definition ${lane}`);
  const keys = Object.keys(input).toSorted();
  const expected = ["id", "implementationSha256", "retrieveLimit", "role", "version"];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new TypeError(`descriptor definition ${lane} must declare exactly ${expected.join(", ")}.`);
  }
  if (input.role !== "ablation" && input.role !== "baseline" && input.role !== "candidate") {
    throw new TypeError(`descriptor definition ${lane}.role is invalid.`);
  }
  const implementationSha256 = boundedText(input.implementationSha256, `descriptor definition ${lane}.implementationSha256`, 64);
  if (!SHA256.test(implementationSha256)) {
    throw new TypeError(`descriptor definition ${lane}.implementationSha256 must be lowercase SHA-256.`);
  }
  return Object.freeze({
    id: canonicalId2(input.id, `descriptor definition ${lane}.id`),
    role: input.role,
    version: boundedText(input.version, `descriptor definition ${lane}.version`, 512),
    implementationSha256,
    retrieveLimit: positiveLimit2(input.retrieveLimit, `descriptor definition ${lane}.retrieveLimit`)
  });
}
function laneConfiguration(lane, retrieveLimit) {
  return Object.freeze({
    "adapter-schema": KNOWLEDGE_BASE_EVALUATION_ADAPTER_V2,
    "execution-input": laneInput[lane],
    "generative-llm-call-limit": 0,
    "generative-llm-input-token-limit": 0,
    "generative-llm-output-token-limit": 0,
    "lane-order": knowledgeBaseEvaluationRetrieverIds.indexOf(lane) + 1,
    "provenance-source": "live-lane-evidence",
    "result-order": "raw-rank-ascending",
    "retrieve-limit": retrieveLimit
  });
}
function createKnowledgeBaseEvaluationLaneDescriptorsV2(definitions) {
  const output = new Map;
  const ids = new Set;
  for (const lane of knowledgeBaseEvaluationRetrieverIds) {
    const parsed = definition(definitions[lane], lane);
    if (ids.has(parsed.id))
      throw new TypeError(`Retriever descriptor ID ${parsed.id} is repeated.`);
    ids.add(parsed.id);
    output.set(lane, Object.freeze({
      id: parsed.id,
      role: parsed.role,
      version: parsed.version,
      implementationSha256: parsed.implementationSha256,
      lanes: Object.freeze([lane]),
      configuration: laneConfiguration(lane, parsed.retrieveLimit)
    }));
  }
  const required = (lane) => {
    const descriptor = output.get(lane);
    if (descriptor === undefined)
      throw new Error(`Missing authored descriptor for ${lane}.`);
    return descriptor;
  };
  return Object.freeze({
    exact: required("exact"),
    keyword: required("keyword"),
    semantic: required("semantic"),
    hybrid: required("hybrid"),
    metadata: required("metadata"),
    graph: required("graph"),
    "path-context": required("path-context"),
    git: required("git")
  });
}
function closureConfiguration(variant) {
  const structural = new Map(variant.structuralLanes.map(({ lane, limit }, index) => [lane, { limit, order: index + 1 }]));
  const executionOrder = [
    ...variant.primary === null ? [] : ["hybrid"],
    ...variant.structuralLanes.map(({ lane }) => lane),
    ...variant.git.mode === "explicit-input" ? ["git"] : []
  ].join(",") || "none";
  return Object.freeze({
    "adapter-schema": KNOWLEDGE_BASE_EVALUATION_ADAPTER_V2,
    "execution-order": executionOrder,
    "fusion-rule": EXISTING_LANE_CLOSURE_FUSION,
    "generative-llm-call-limit": 0,
    "generative-llm-input-token-limit": 0,
    "generative-llm-output-token-limit": 0,
    "git-limit": variant.git.mode === "explicit-input" ? variant.git.limit : null,
    "git-mode": variant.git.mode,
    "graph-limit": structural.get("graph")?.limit ?? null,
    "graph-order": structural.get("graph")?.order ?? null,
    "metadata-limit": structural.get("metadata")?.limit ?? null,
    "metadata-order": structural.get("metadata")?.order ?? null,
    "output-limit": variant.outputLimit,
    "path-context-limit": structural.get("path-context")?.limit ?? null,
    "path-context-order": structural.get("path-context")?.order ?? null,
    "primary-lane": variant.primary?.lane ?? null,
    "primary-retain-limit": variant.primary?.retainLimit ?? null,
    "primary-retrieve-limit": variant.primary?.retrieveLimit ?? null,
    "provenance-source": "live-lane-evidence",
    "result-order": "primary-prefix-then-declared-lane-round-robin-by-source-rank"
  });
}
function closureDescriptorLanes(variant) {
  return Object.freeze([
    ...variant.primary === null ? [] : ["hybrid"],
    ...variant.structuralLanes.map(({ lane }) => lane),
    ...variant.git.mode === "explicit-input" ? ["git"] : []
  ].toSorted());
}
function createKnowledgeBaseExistingLaneClosureDescriptorV2(options) {
  const variant = freezeExistingLaneClosureVariant(options.variant);
  const parsed = definition({
    id: options.id,
    role: options.role,
    version: options.version,
    implementationSha256: options.implementationSha256,
    retrieveLimit: variant.outputLimit
  }, "hybrid");
  return Object.freeze({
    descriptor: Object.freeze({
      id: parsed.id,
      role: parsed.role,
      version: parsed.version,
      implementationSha256: parsed.implementationSha256,
      lanes: closureDescriptorLanes(variant),
      configuration: closureConfiguration(variant)
    }),
    variant
  });
}
function assertFrozenSnapshot(expected, actual) {
  if (actual.repositoryCommit !== expected.repositoryCommit || actual.vaultTree !== expected.vaultTree || actual.vaultRoot !== expected.vaultRoot)
    throw new TypeError("Evaluation request does not name the adapter's locked frozen snapshot.");
}
function assertRequestLimit(descriptor, requestLimit) {
  const configured = descriptor.configuration["retrieve-limit"] ?? descriptor.configuration["output-limit"];
  if (requestLimit !== configured) {
    throw new TypeError(`Retriever ${descriptor.id} requires locked limit ${String(configured)}, received ${requestLimit}.`);
  }
}
var forbiddenLegacyQueryFields = Object.freeze([
  "adjudication",
  "answer",
  "assessments",
  "assessorIds",
  "class",
  "cohort",
  "expectedSupport",
  "gold",
  "id",
  "inputOrigins",
  "labels",
  "negativeSubtype",
  "nuggets",
  "primaryLane",
  "qrels",
  "rawAssessments",
  "split",
  "strata",
  "supportState",
  "text",
  "trust"
]);
function legacyQueryBridge(inputs) {
  const target = {};
  Object.defineProperty(target, "inputs", {
    configurable: false,
    enumerable: true,
    value: Object.freeze(inputs),
    writable: false
  });
  for (const field of forbiddenLegacyQueryFields) {
    Object.defineProperty(target, field, {
      configurable: false,
      enumerable: false,
      get() {
        throw new Error(`Legacy evaluation lane attempted to read forbidden query field ${field}.`);
      }
    });
  }
  Object.preventExtensions(target);
  return new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === "symbol" || property === "inputs" || forbiddenLegacyQueryFields.includes(property))
        return Reflect.get(object, property, receiver);
      throw new Error(`Legacy evaluation lane attempted to read forbidden query field ${property}.`);
    }
  });
}
function legacyCorpusBridge(frozen) {
  const target = {};
  Object.defineProperty(target, "frozen", {
    configurable: false,
    enumerable: true,
    value: frozen,
    writable: false
  });
  for (const field of ["assessment", "description", "id", "queries", "schemaVersion"]) {
    Object.defineProperty(target, field, {
      configurable: false,
      enumerable: false,
      get() {
        throw new Error(`Legacy evaluation opener attempted to read forbidden corpus field ${field}.`);
      }
    });
  }
  Object.preventExtensions(target);
  return new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === "symbol" || property === "frozen") {
        return Reflect.get(object, property, receiver);
      }
      if (typeof property === "string" && Object.hasOwn(object, property)) {
        return Reflect.get(object, property, receiver);
      }
      throw new Error(`Legacy evaluation opener attempted to read forbidden corpus field ${String(property)}.`);
    }
  });
}
function executionInputs(request) {
  const query = record2(request.query, "evaluation v2 execution query");
  const keys = Object.keys(query);
  if (keys.length !== 1 || keys[0] !== "inputs") {
    throw new TypeError("Evaluation v2 execution query may expose only inputs.");
  }
  return record2(ownData2(query, "inputs", "evaluation v2 execution query"), "evaluation v2 execution query.inputs");
}
function inputForLegacyLane(lane, inputs) {
  if (lane === "exact" || lane === "keyword" || lane === "semantic" || lane === "hybrid") {
    return Object.freeze({ text: inputs.text });
  }
  if (lane === "metadata") {
    return Object.freeze(inputs.metadata === undefined ? {} : { metadata: inputs.metadata });
  }
  if (lane === "graph") {
    return Object.freeze(inputs.graph === undefined ? {} : { graph: inputs.graph });
  }
  if (lane === "path-context") {
    return Object.freeze(inputs.context === undefined ? {} : { context: inputs.context });
  }
  return Object.freeze(inputs.history === undefined ? {} : { history: inputs.history });
}
function laneIsApplicable(lane, inputs) {
  if (lane === "exact" || lane === "keyword" || lane === "semantic" || lane === "hybrid")
    return true;
  if (lane === "metadata")
    return inputs.metadata !== undefined;
  if (lane === "graph")
    return inputs.graph !== undefined;
  if (lane === "path-context")
    return inputs.context !== undefined;
  return inputs.history !== undefined;
}
function finiteMetricMap(value, label) {
  if (value === undefined)
    return Object.freeze({});
  const input = record2(value, label);
  if (Object.keys(input).length > 32)
    throw new TypeError(`${label} may have at most 32 entries.`);
  const output = {};
  for (const key of Object.keys(input).toSorted()) {
    const candidate = ownData2(input, key, label);
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
      throw new TypeError(`${label}.${key} must be a non-negative finite number.`);
    }
    output[boundedText(key, `${label} key`, 128)] = candidate;
  }
  return Object.freeze(output);
}
function diagnosticCode(lane, status) {
  const normalized = `${lane}-${status}`.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 120);
  return CANONICAL_ID.test(normalized) ? normalized : `diagnostic-${status}`;
}
function copyDiagnostics(value, label) {
  if (value === undefined)
    return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_EVALUATION_DIAGNOSTICS) {
    throw new TypeError(`${label} must contain at most ${MAX_EVALUATION_DIAGNOSTICS} entries.`);
  }
  return Object.freeze(value.map((candidate, index) => {
    const input = record2(candidate, `${label}[${index}]`);
    const lane = boundedText(ownData2(input, "lane", `${label}[${index}]`), `${label}[${index}].lane`, 256);
    const status = ownData2(input, "status", `${label}[${index}]`);
    if (status !== "ready" && status !== "degraded" && status !== "unavailable") {
      throw new TypeError(`${label}[${index}].status is invalid.`);
    }
    const rawMessage = ownData2(input, "message", `${label}[${index}]`);
    const message = rawMessage === undefined ? undefined : boundedText(rawMessage, `${label}[${index}].message`, MAX_DIAGNOSTIC_MESSAGE_BYTES);
    return Object.freeze({
      code: diagnosticCode(lane, status),
      lane,
      status,
      ...message === undefined ? {} : { message }
    });
  }));
}
function immutableEvidenceCopy(value) {
  let nodes = 0;
  const seen = new Set;
  const copy = (candidate, depth) => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") {
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate))
        throw new TypeError("legacy lane evidence numbers must be finite.");
      return candidate;
    }
    if (candidate === undefined)
      return;
    if (typeof candidate !== "object") {
      throw new TypeError("legacy lane evidence must contain only JSON-compatible values.");
    }
    if (depth > 32 || (nodes += 1) > 1e4) {
      throw new TypeError("legacy lane evidence exceeds its structural bound.");
    }
    if (seen.has(candidate))
      throw new TypeError("legacy lane evidence must not contain cycles.");
    seen.add(candidate);
    let output;
    if (Array.isArray(candidate)) {
      if (candidate.length > 1e4)
        throw new TypeError("legacy lane evidence array is too large.");
      output = Object.freeze(candidate.map((entry) => {
        const copied2 = copy(entry, depth + 1);
        return copied2 === undefined ? null : copied2;
      }));
    } else {
      const input = candidate;
      if (Object.keys(input).length > 1e4)
        throw new TypeError("legacy lane evidence object is too large.");
      const object = {};
      for (const key of Object.keys(input).toSorted()) {
        const copied2 = copy(ownData2(input, key, "legacy lane evidence"), depth + 1);
        if (copied2 !== undefined)
          object[key] = copied2;
      }
      output = Object.freeze(object);
    }
    seen.delete(candidate);
    return output;
  };
  const copied = copy(value, 0);
  const serialized = JSON.stringify(copied);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_EVALUATION_EVIDENCE_BYTES) {
    throw new TypeError("legacy lane evidence exceeds its serialized byte bound.");
  }
  return copied;
}
function confinedPath5(value, label) {
  const path = boundedText(value, label, 4096);
  if (path.startsWith("/") || path.startsWith("./") || path.includes("\\") || WINDOWS_ABSOLUTE_PATH2.test(path) || path.split("/").some((part) => part === "" || part === "." || part === ".."))
    throw new TypeError(`${label} must be a canonical confined path.`);
  return path;
}
function validateLegacyResult(value, lane, limit) {
  const input = record2(value, `legacy ${lane} result`);
  const status = ownData2(input, "status", `legacy ${lane} result`);
  if (status !== "ready" && status !== "degraded" && status !== "unavailable") {
    throw new TypeError(`legacy ${lane} result.status is invalid.`);
  }
  const rawHits = ownData2(input, "hits", `legacy ${lane} result`);
  if (!Array.isArray(rawHits) || rawHits.length > limit || rawHits.length > MAX_EVALUATION_RESULTS_PER_QUERY) {
    throw new TypeError(`legacy ${lane} result.hits exceeds its locked result bound.`);
  }
  const hits = rawHits.map((candidate, index) => {
    const hit = record2(candidate, `legacy ${lane} result.hits[${index}]`);
    const rank = ownData2(hit, "rank", `legacy ${lane} result.hits[${index}]`);
    if (!Number.isSafeInteger(rank) || rank !== index + 1) {
      throw new TypeError(`legacy ${lane} hit ranks must be contiguous source ranks.`);
    }
    const score = ownData2(hit, "score", `legacy ${lane} result.hits[${index}]`);
    if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score))) {
      throw new TypeError(`legacy ${lane} result.hits[${index}].score must be finite.`);
    }
    const rawEvidence = ownData2(hit, "evidence", `legacy ${lane} result.hits[${index}]`);
    const evidence = rawEvidence === undefined ? undefined : immutableEvidenceCopy(rawEvidence);
    return Object.freeze({
      documentId: confinedPath5(ownData2(hit, "documentId", `legacy ${lane} result.hits[${index}]`), `legacy ${lane} result.hits[${index}].documentId`),
      rank,
      ...score === undefined ? {} : { score },
      ...evidence === undefined ? {} : { evidence }
    });
  });
  if (new Set(hits.map(({ documentId }) => documentId)).size !== hits.length) {
    throw new TypeError(`legacy ${lane} result.hits must not repeat a document.`);
  }
  if (status === "unavailable" && hits.length > 0) {
    throw new TypeError(`legacy ${lane} unavailable result may not contain hits.`);
  }
  return Object.freeze({
    status,
    hits: Object.freeze(hits),
    diagnostics: copyDiagnostics(ownData2(input, "diagnostics", `legacy ${lane} result`), `legacy ${lane} result.diagnostics`),
    timings: finiteMetricMap(ownData2(input, "timings", `legacy ${lane} result`), `legacy ${lane} result.timings`),
    resources: finiteMetricMap(ownData2(input, "resources", `legacy ${lane} result`), `legacy ${lane} result.resources`)
  });
}
function copyRetrieverDescriptor(descriptor) {
  const configuration = Object.freeze(Object.fromEntries(Object.entries(descriptor.configuration).toSorted(([left], [right]) => left.localeCompare(right))));
  return Object.freeze({
    id: descriptor.id,
    role: descriptor.role,
    version: descriptor.version,
    implementationSha256: descriptor.implementationSha256,
    lanes: Object.freeze([...descriptor.lanes]),
    configuration
  });
}
function copyCandidateLock(candidateLock) {
  return Object.freeze({
    baselineRetrieverId: candidateLock.baselineRetrieverId,
    candidateRetrieverIds: Object.freeze([...candidateLock.candidateRetrieverIds]),
    descriptorDigests: Object.freeze(candidateLock.descriptorDigests.map((binding) => Object.freeze({
      retrieverId: binding.retrieverId,
      sha256: binding.sha256
    })))
  });
}
function bindLegacyRetrievers(evaluation) {
  const byId = Object.create(null);
  for (const retriever of evaluation.retrievers) {
    if (!knowledgeBaseEvaluationRetrieverIds.includes(retriever.id)) {
      throw new TypeError(`Verified evaluation exposed unknown lane ${retriever.id}.`);
    }
    const lane = retriever.id;
    if (byId[lane] !== undefined)
      throw new TypeError(`Verified evaluation repeats ${lane} lane.`);
    byId[lane] = Object.freeze({ id: retriever.id, retrieve: retriever.retrieve });
  }
  if (knowledgeBaseEvaluationRetrieverIds.some((lane) => byId[lane] === undefined)) {
    throw new TypeError("Verified evaluation must expose all eight immutable built-in lanes.");
  }
  return Object.freeze(byId);
}
function createExecutionContract(options) {
  const frozen = Object.freeze({
    repositoryCommit: options.corpus.frozen.repositoryCommit,
    vaultTree: options.corpus.frozen.vaultTree,
    vaultRoot: options.corpus.frozen.vaultRoot
  });
  const descriptors = Object.freeze(options.descriptors.map(copyRetrieverDescriptor));
  const descriptorsById = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(descriptors.map((descriptor) => [descriptor.id, descriptor]))));
  const candidateLock = copyCandidateLock(options.corpus.candidateLock);
  for (const descriptor of descriptors) {
    const lock = candidateLock.descriptorDigests.find(({ retrieverId }) => retrieverId === descriptor.id);
    if (lock?.sha256 !== evaluationRetrieverDescriptorDigestV2(descriptor)) {
      throw new TypeError(`Retriever descriptor ${descriptor.id} drifted while deriving its execution contract.`);
    }
  }
  const closureRegistry = closureEvidenceRegistry(options.evidenceBindings);
  return Object.freeze({
    frozen,
    manifest: Object.freeze({
      corpusSha256: options.corpus.manifest.corpusSha256,
      candidateLockSha256: options.corpus.manifest.candidateLockSha256,
      buildContractSha256: options.corpus.manifest.buildContractSha256
    }),
    candidateLock,
    descriptors,
    descriptorsById,
    evidenceBindings: options.evidenceBindings,
    closureEvidenceRegistry: closureRegistry,
    legacyRetrievers: options.legacyRetrievers
  });
}
function evidenceBindingKey(value) {
  return JSON.stringify([
    value.documentId,
    value.sourcePath,
    value.lineRange.start,
    value.lineRange.end,
    value.headingPath,
    value.sourcePage ?? null,
    value.trustClass
  ]);
}
function buildEvidenceBindings(registry, corpus) {
  validateEvaluationEvidenceRegistry(registry);
  const familyById = new Map(corpus.sourceFamilies.map((family) => [family.id, family]));
  const documentById = new Map(corpus.documents.map((document) => [document.id, document]));
  const registryById = new Map;
  for (const unit of registry.units) {
    if (registryById.has(unit.id)) {
      throw new TypeError(`Live registry unit ${unit.id} is duplicated.`);
    }
    registryById.set(unit.id, unit);
  }
  const byCorpusUnitId = new Map;
  const byRegistryUnitId = new Map;
  const mutableByDocumentId = new Map;
  for (const corpusUnit of corpus.evidenceUnits) {
    const document = documentById.get(corpusUnit.documentId);
    const family = familyById.get(corpusUnit.sourceFamilyId);
    if (document === undefined || family === undefined) {
      throw new TypeError(`Corpus evidence unit ${corpusUnit.id} has an unresolved document or source family.`);
    }
    const key = evidenceBindingKey({
      documentId: corpusUnit.documentId,
      sourcePath: corpusUnit.sourcePath,
      lineRange: corpusUnit.lineRange,
      headingPath: corpusUnit.headingPath,
      ...corpusUnit.sourcePage === undefined ? {} : { sourcePage: corpusUnit.sourcePage },
      trustClass: corpusUnit.trustClass
    });
    const registryUnit = registryById.get(corpusUnit.id);
    if (registryUnit === undefined) {
      throw new TypeError(`Corpus evidence unit ${corpusUnit.id} does not preserve an exact live registry unit identity.`);
    }
    const registryKey = evidenceBindingKey({
      documentId: registryUnit.documentId,
      sourcePath: registryUnit.sourcePath,
      lineRange: registryUnit.lineRange,
      headingPath: registryUnit.headingAncestry,
      ...registryUnit.pdfPage === undefined ? {} : { sourcePage: registryUnit.pdfPage },
      trustClass: registryUnit.trustClass
    });
    if (key !== registryKey) {
      throw new TypeError(`Corpus evidence unit ${corpusUnit.id} metadata does not match its exact live registry unit.`);
    }
    if (byRegistryUnitId.has(registryUnit.id)) {
      throw new TypeError(`Live registry unit ${registryUnit.id} is bound to more than one corpus unit.`);
    }
    const bound = Object.freeze({
      evidenceUnitId: corpusUnit.id,
      registryUnitId: registryUnit.id,
      documentId: corpusUnit.documentId,
      sourceFamilyId: corpusUnit.sourceFamilyId,
      sourceClass: family.sourceClass,
      trustClass: corpusUnit.trustClass,
      locator: Object.freeze({
        evidenceUnitId: corpusUnit.id,
        sourceFamilyId: corpusUnit.sourceFamilyId,
        sourceClass: family.sourceClass,
        trustClass: corpusUnit.trustClass,
        sourcePath: corpusUnit.sourcePath,
        lineRange: Object.freeze({
          start: corpusUnit.lineRange.start,
          end: corpusUnit.lineRange.end
        }),
        headingPath: Object.freeze([...corpusUnit.headingPath]),
        ...corpusUnit.sourcePage === undefined ? {} : { sourcePage: corpusUnit.sourcePage }
      }),
      kind: registryUnit.kind,
      ...registryUnit.frontmatterField === undefined ? {} : { frontmatterField: registryUnit.frontmatterField },
      text: registryUnit.text
    });
    byCorpusUnitId.set(bound.evidenceUnitId, bound);
    byRegistryUnitId.set(bound.registryUnitId, bound);
    const documentUnits = mutableByDocumentId.get(bound.documentId) ?? [];
    documentUnits.push(bound);
    mutableByDocumentId.set(bound.documentId, documentUnits);
  }
  const kindOrder = Object.freeze({
    heading: 0,
    paragraph: 1,
    list: 2,
    table: 3,
    "code-block": 4,
    "pdf-page-span": 5,
    "frontmatter-field": 6
  });
  const byDocumentId = new Map;
  for (const [documentId, units] of mutableByDocumentId) {
    byDocumentId.set(documentId, Object.freeze(units.toSorted((left, right) => left.locator.lineRange.start - right.locator.lineRange.start || kindOrder[left.kind] - kindOrder[right.kind] || left.locator.lineRange.end - right.locator.lineRange.end || left.evidenceUnitId.localeCompare(right.evidenceUnitId))));
  }
  const allUnits = Object.freeze([...byCorpusUnitId.values()].toSorted((left, right) => left.evidenceUnitId.localeCompare(right.evidenceUnitId)));
  return Object.freeze({
    byCorpusUnitId: Object.freeze(Object.assign(Object.create(null), Object.fromEntries(byCorpusUnitId))),
    byRegistryUnitId: Object.freeze(Object.assign(Object.create(null), Object.fromEntries(byRegistryUnitId))),
    byDocumentId: Object.freeze(Object.assign(Object.create(null), Object.fromEntries(byDocumentId))),
    units: allUnits
  });
}
function positiveSourcePosition(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1e7;
}
function hitEvidenceProvenance(hit) {
  if (hit.evidence === null || typeof hit.evidence !== "object" || Array.isArray(hit.evidence)) {
    return;
  }
  const evidence = hit.evidence;
  if (!Object.prototype.hasOwnProperty.call(evidence, "provenance"))
    return;
  try {
    const rawProvenance = ownData2(evidence, "provenance", "lane evidence");
    if (!Array.isArray(rawProvenance) || rawProvenance.length === 0 || rawProvenance.length > 64) {
      return;
    }
    const parseText = (value) => {
      if (typeof value !== "string" || value === "" || /[\0\r\n]/u.test(value))
        return;
      if (value.normalize("NFC") !== value || Buffer.byteLength(value, "utf8") > 4096)
        return;
      return value;
    };
    const parsed = rawProvenance.map((candidate, index) => {
      const provenance2 = record2(candidate, `lane evidence.provenance[${index}]`);
      if (Object.keys(provenance2).toSorted().join("\x00") !== "evidenceDocumentId\x00locator\x00sourcePath\x00targetDocumentId") {
        return;
      }
      const targetDocumentId = confinedPath5(ownData2(provenance2, "targetDocumentId", "lane evidence.provenance"), "lane evidence.provenance.targetDocumentId");
      if (targetDocumentId !== hit.documentId)
        return;
      const evidenceDocumentId = confinedPath5(ownData2(provenance2, "evidenceDocumentId", "lane evidence.provenance"), "lane evidence.provenance.evidenceDocumentId");
      const sourcePath = confinedPath5(ownData2(provenance2, "sourcePath", "lane evidence.provenance"), "lane evidence.provenance.sourcePath");
      const locator = record2(ownData2(provenance2, "locator", "lane evidence.provenance"), "lane evidence.provenance.locator");
      const kind = ownData2(locator, "kind", "lane evidence.provenance.locator");
      if (kind === "evidence-unit") {
        if (Object.keys(locator).toSorted().join("\x00") !== "evidenceUnitId\x00kind")
          return;
        const evidenceUnitId2 = ownData2(locator, "evidenceUnitId", "lane evidence.provenance.locator");
        if (typeof evidenceUnitId2 !== "string")
          return;
        return Object.freeze({
          targetDocumentId,
          evidenceDocumentId,
          sourcePath,
          locator: Object.freeze({ kind, evidenceUnitId: evidenceUnitId2 })
        });
      }
      if (kind === "frontmatter-field") {
        if (Object.keys(locator).toSorted().join("\x00") !== "field\x00kind")
          return;
        const field = ownData2(locator, "field", "lane evidence.provenance.locator");
        const parsedField = parseText(field);
        if (parsedField === undefined)
          return;
        return Object.freeze({
          targetDocumentId,
          evidenceDocumentId,
          sourcePath,
          locator: Object.freeze({ kind, field: parsedField })
        });
      }
      if (kind === "frontmatter-field-any") {
        if (Object.keys(locator).toSorted().join("\x00") !== "fields\x00kind")
          return;
        const fields = ownData2(locator, "fields", "lane evidence.provenance.locator");
        if (!Array.isArray(fields) || fields.length === 0 || fields.length > 32)
          return;
        const parsedFields = fields.map(parseText);
        if (parsedFields.some((field) => field === undefined))
          return;
        const canonicalFields = [...new Set(parsedFields)].toSorted();
        if (canonicalFields.length !== fields.length)
          return;
        return Object.freeze({
          targetDocumentId,
          evidenceDocumentId,
          sourcePath,
          locator: Object.freeze({ kind, fields: Object.freeze(canonicalFields) })
        });
      }
      if (kind === "frontmatter-value") {
        if (Object.keys(locator).toSorted().join("\x00") !== "kind\x00value")
          return;
        const value = parseText(ownData2(locator, "value", "lane evidence.provenance.locator"));
        if (value === undefined)
          return;
        return Object.freeze({
          targetDocumentId,
          evidenceDocumentId,
          sourcePath,
          locator: Object.freeze({ kind, value })
        });
      }
      if (kind === "line") {
        if (Object.keys(locator).toSorted().join("\x00") !== "kind\x00line")
          return;
        const line = ownData2(locator, "line", "lane evidence.provenance.locator");
        if (!positiveSourcePosition(line))
          return;
        return Object.freeze({
          targetDocumentId,
          evidenceDocumentId,
          sourcePath,
          locator: Object.freeze({ kind, line })
        });
      }
      if (kind === "line-range") {
        if (Object.keys(locator).toSorted().join("\x00") !== "end\x00kind\x00start")
          return;
        const start = ownData2(locator, "start", "lane evidence.provenance.locator");
        const end = ownData2(locator, "end", "lane evidence.provenance.locator");
        if (!positiveSourcePosition(start) || !positiveSourcePosition(end) || end < start)
          return;
        return Object.freeze({
          targetDocumentId,
          evidenceDocumentId,
          sourcePath,
          locator: Object.freeze({ kind, start, end })
        });
      }
      if (kind === "source-page") {
        if (Object.keys(locator).toSorted().join("\x00") !== "kind\x00sourcePage")
          return;
        const sourcePage = ownData2(locator, "sourcePage", "lane evidence.provenance.locator");
        if (!Number.isSafeInteger(sourcePage) || sourcePage < 1 || sourcePage > 1e6) {
          return;
        }
        return Object.freeze({
          targetDocumentId,
          evidenceDocumentId,
          sourcePath,
          locator: Object.freeze({ kind, sourcePage })
        });
      }
      if (kind === "source-path") {
        if (Object.keys(locator).toSorted().join("\x00") !== "kind\x00sourcePath")
          return;
        const locatorSourcePath = confinedPath5(ownData2(locator, "sourcePath", "lane evidence.provenance.locator"), "lane evidence.provenance.locator.sourcePath");
        if (locatorSourcePath !== sourcePath)
          return;
        return Object.freeze({
          targetDocumentId,
          evidenceDocumentId,
          sourcePath,
          locator: Object.freeze({ kind, sourcePath: locatorSourcePath })
        });
      }
      if (kind === "title") {
        if (Object.keys(locator).toSorted().join("\x00") !== "kind\x00title")
          return;
        const title = parseText(ownData2(locator, "title", "lane evidence.provenance.locator"));
        if (title === undefined)
          return;
        return Object.freeze({
          targetDocumentId,
          evidenceDocumentId,
          sourcePath,
          locator: Object.freeze({ kind, title })
        });
      }
      return;
    });
    if (parsed.some((candidate) => candidate === undefined))
      return;
    const provenance = parsed;
    if (new Set(provenance.map((candidate) => JSON.stringify(candidate))).size !== provenance.length) {
      return;
    }
    return Object.freeze(provenance);
  } catch {
    return;
  }
}
function normalizeEvidenceText(value) {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}
function resolveEvidenceContribution(provenance, bindings) {
  if (provenance.locator.kind === "evidence-unit") {
    const binding = bindings.byCorpusUnitId[provenance.locator.evidenceUnitId] ?? bindings.byRegistryUnitId[provenance.locator.evidenceUnitId];
    return binding?.documentId === provenance.evidenceDocumentId && binding.locator.sourcePath === provenance.sourcePath ? Object.freeze([binding]) : Object.freeze([]);
  }
  let candidates = [...bindings.byDocumentId[provenance.evidenceDocumentId] ?? []].filter((candidate) => candidate.locator.sourcePath === provenance.sourcePath);
  if (candidates.length === 0)
    return Object.freeze([]);
  if (provenance.locator.kind === "frontmatter-field") {
    const field = provenance.locator.field;
    candidates = candidates.filter(({ kind, frontmatterField: frontmatterField2 }) => kind === "frontmatter-field" && frontmatterField2 === field);
  } else if (provenance.locator.kind === "frontmatter-field-any") {
    const fields = provenance.locator.fields;
    candidates = candidates.filter(({ kind, frontmatterField: frontmatterField2 }) => kind === "frontmatter-field" && frontmatterField2 !== undefined && fields.includes(frontmatterField2));
  } else if (provenance.locator.kind === "frontmatter-value") {
    const value = normalizeEvidenceText(provenance.locator.value);
    candidates = candidates.filter(({ kind, text }) => kind === "frontmatter-field" && normalizeEvidenceText(text).includes(value));
  } else if (provenance.locator.kind === "title") {
    const title = provenance.locator.title;
    const frontmatter = candidates.filter(({ kind, frontmatterField: frontmatterField2 }) => kind === "frontmatter-field" && frontmatterField2 === "title");
    candidates = frontmatter.length > 0 ? frontmatter : candidates.filter(({ kind, locator }) => kind === "heading" && normalizeEvidenceText(locator.headingPath.at(-1) ?? "") === normalizeEvidenceText(title));
  } else if (provenance.locator.kind === "line" || provenance.locator.kind === "line-range") {
    const lineRange = provenance.locator.kind === "line" ? Object.freeze({ start: provenance.locator.line, end: provenance.locator.line }) : Object.freeze({ start: provenance.locator.start, end: provenance.locator.end });
    const containing = candidates.filter(({ locator }) => locator.lineRange.start <= lineRange.start && locator.lineRange.end >= lineRange.end);
    if (containing.length === 0)
      return Object.freeze([]);
    const nonPage = containing.filter(({ kind }) => kind !== "pdf-page-span");
    candidates = nonPage.length > 0 ? nonPage : containing;
    const narrowestSpan = Math.min(...candidates.map(({ locator }) => locator.lineRange.end - locator.lineRange.start));
    candidates = candidates.filter(({ locator }) => locator.lineRange.end - locator.lineRange.start === narrowestSpan);
  } else if (provenance.locator.kind === "source-path") {
    return Object.freeze([]);
  } else {
    const sourcePage = provenance.locator.sourcePage;
    candidates = candidates.filter(({ kind, locator }) => kind === "pdf-page-span" && locator.sourcePage === sourcePage);
  }
  return Object.freeze(candidates);
}
function resolveHitEvidence(hit, bindings, lane) {
  const provenance = hitEvidenceProvenance(hit);
  if (provenance === undefined)
    return;
  const resolved = provenance.map((candidate) => resolveEvidenceContribution(candidate, bindings));
  const requiresEveryContribution = lane === "metadata" || lane === "graph" || lane === "path-context";
  if (requiresEveryContribution && resolved.some((candidates) => candidates.length === 0)) {
    return;
  }
  const unique = [...new Map(resolved.flat().map((candidate) => [candidate.evidenceUnitId, candidate])).values()].toSorted((left, right) => left.evidenceUnitId.localeCompare(right.evidenceUnitId));
  return unique.length === 0 ? undefined : Object.freeze(unique);
}
function publicEvidenceUnit(unit) {
  return Object.freeze({
    evidenceUnitId: unit.evidenceUnitId,
    registryUnitId: unit.registryUnitId,
    documentId: unit.documentId,
    sourceFamilyId: unit.sourceFamilyId,
    sourceClass: unit.sourceClass,
    trustClass: unit.trustClass,
    locator: unit.locator
  });
}
function closureEvidenceLocator(unit) {
  return Object.freeze({
    evidenceUnitId: unit.evidenceUnitId,
    documentId: unit.documentId,
    sourceFamilyId: unit.sourceFamilyId,
    sourceClass: unit.sourceClass,
    trustClass: unit.trustClass,
    sourcePath: unit.locator.sourcePath,
    lineRange: Object.freeze({
      start: unit.locator.lineRange.start,
      end: unit.locator.lineRange.end
    }),
    headingPath: Object.freeze([...unit.locator.headingPath]),
    ...unit.locator.sourcePage === undefined ? {} : { sourcePage: unit.locator.sourcePage }
  });
}
function closureEvidenceRegistry(bindings) {
  return Object.freeze({
    units: Object.freeze(bindings.units.map(closureEvidenceLocator))
  });
}
function closureLocatorKey(locator) {
  return JSON.stringify([
    locator.evidenceUnitId,
    locator.documentId,
    locator.sourceFamilyId,
    locator.sourceClass,
    locator.trustClass,
    locator.sourcePath,
    locator.lineRange.start,
    locator.lineRange.end,
    locator.headingPath,
    locator.sourcePage ?? null
  ]);
}
function bindingFromClosureLocator(locator, bindings) {
  const binding = bindings.byCorpusUnitId[locator.evidenceUnitId];
  if (binding === undefined || closureLocatorKey(closureEvidenceLocator(binding)) !== closureLocatorKey(locator)) {
    throw new TypeError(`Closure provenance ${locator.evidenceUnitId} does not match the adapter evidence binding.`);
  }
  return binding;
}
function bindingsFromClosureProvenance(provenance, bindings) {
  return Object.freeze(provenance.map((locator) => bindingFromClosureLocator(locator, bindings)));
}
function uniqueBindingsFromClosureProvenance(provenance, bindings) {
  return Object.freeze([...new Map(bindingsFromClosureProvenance(provenance, bindings).map((binding) => [binding.evidenceUnitId, binding])).values()]);
}
function reasonCodes(diagnostics, applicable, status) {
  return Object.freeze([
    ...new Set([
      ...diagnostics.map(({ code }) => code),
      ...!applicable ? ["missing-input"] : [],
      ...applicable && status === "degraded" && diagnostics.length === 0 ? ["degraded"] : [],
      ...applicable && status === "unavailable" && diagnostics.length === 0 ? ["unavailable"] : []
    ])
  ].toSorted());
}
function exactKeys(input, expected, label) {
  const actual = Object.keys(input).toSorted();
  const canonical = [...expected].toSorted();
  if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
    throw new TypeError(`${label} must declare exactly ${canonical.join(", ")}.`);
  }
}
function accountingInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}
function accountingDuration(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}
function copyEmbeddingAccounting(value, label) {
  const input = record2(value, label);
  const optionalKeys = ["inputTokensMeasured", "durationScope"].filter((key) => Object.hasOwn(input, key));
  exactKeys(input, ["calls", "durationMs", "inputTokens", ...optionalKeys], label);
  const calls = accountingInteger(ownData2(input, "calls", label), `${label}.calls`);
  const inputTokens = accountingInteger(ownData2(input, "inputTokens", label), `${label}.inputTokens`);
  const durationMs = accountingDuration(ownData2(input, "durationMs", label), `${label}.durationMs`);
  const inputTokensMeasured = ownData2(input, "inputTokensMeasured", label);
  if (Object.hasOwn(input, "inputTokensMeasured") && inputTokensMeasured !== false) {
    throw new TypeError(`${label}.inputTokensMeasured must be literal false when present.`);
  }
  const durationScopeValue = ownData2(input, "durationScope", label);
  if (Object.hasOwn(input, "durationScope") && durationScopeValue !== "embedding-backed-search-upper-bound") {
    throw new TypeError(`${label}.durationScope must be embedding-backed-search-upper-bound when present.`);
  }
  const durationScope = durationScopeValue === "embedding-backed-search-upper-bound" ? durationScopeValue : undefined;
  if (calls === 0) {
    if (inputTokens !== 0 || durationMs !== 0 || inputTokensMeasured !== undefined || durationScope !== undefined)
      throw new TypeError(`${label} zero-call accounting must be the exact unannotated zero record.`);
  } else if (inputTokensMeasured === false && inputTokens !== 0) {
    throw new TypeError(`${label} unmeasured input tokens must use zero only as an explicit placeholder.`);
  }
  return Object.freeze({
    calls,
    inputTokens,
    ...inputTokensMeasured === false ? { inputTokensMeasured: false } : {},
    durationMs,
    ...durationScope === undefined ? {} : { durationScope }
  });
}
function parseChildAccounting(value, lane) {
  const input = record2(value, `${lane} child accounting`);
  exactKeys(input, ["cacheBytes", "embedding", "llm", "packedContext", "peakRssBytes"], `${lane} child accounting`);
  const llm = record2(ownData2(input, "llm", `${lane} child accounting`), `${lane} child accounting.llm`);
  exactKeys(llm, ["calls", "inputTokens", "outputTokens"], `${lane} child accounting.llm`);
  if (ownData2(llm, "calls", `${lane} child accounting.llm`) !== 0 || ownData2(llm, "inputTokens", `${lane} child accounting.llm`) !== 0 || ownData2(llm, "outputTokens", `${lane} child accounting.llm`) !== 0)
    throw new TypeError(`${lane} child accounting requires literal-zero generative LLM counters.`);
  const embeddingCopy = copyEmbeddingAccounting(ownData2(input, "embedding", `${lane} child accounting`), `${lane} child accounting.embedding`);
  if (lane !== "semantic" && lane !== "hybrid" && (embeddingCopy.calls !== KNOWLEDGE_BASE_EVALUATION_EMBEDDING_NOT_INVOKED_V2.calls || embeddingCopy.inputTokens !== KNOWLEDGE_BASE_EVALUATION_EMBEDDING_NOT_INVOKED_V2.inputTokens || embeddingCopy.durationMs !== KNOWLEDGE_BASE_EVALUATION_EMBEDDING_NOT_INVOKED_V2.durationMs))
    throw new TypeError(`${lane} must use the fixed not-invoked embedding accounting record.`);
  const packedContext = record2(ownData2(input, "packedContext", `${lane} child accounting`), `${lane} child accounting.packedContext`);
  exactKeys(packedContext, ["readerTokens", "utf8Bytes"], `${lane} child accounting.packedContext`);
  const packedContextCopy = Object.freeze({
    utf8Bytes: accountingInteger(ownData2(packedContext, "utf8Bytes", `${lane} child accounting.packedContext`), `${lane} child accounting.packedContext.utf8Bytes`),
    readerTokens: accountingInteger(ownData2(packedContext, "readerTokens", `${lane} child accounting.packedContext`), `${lane} child accounting.packedContext.readerTokens`)
  });
  if (packedContextCopy.utf8Bytes !== 0 || packedContextCopy.readerTokens !== 0) {
    throw new TypeError(`${lane} child retrieval may not include packed-context accounting.`);
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: embeddingCopy,
    packedContext: packedContextCopy,
    peakRssBytes: accountingInteger(ownData2(input, "peakRssBytes", `${lane} child accounting`), `${lane} child accounting.peakRssBytes`),
    cacheBytes: accountingInteger(ownData2(input, "cacheBytes", `${lane} child accounting`), `${lane} child accounting.cacheBytes`)
  });
}
async function childAccounting(provider, lane, result) {
  if (typeof provider !== "function") {
    throw new TypeError("Knowledge-base evaluation v2 requires a per-lane accounting provider.");
  }
  return parseChildAccounting(await provider(Object.freeze({
    lane,
    status: result.status,
    timings: result.timings,
    resources: result.resources
  })), lane);
}
function aggregateChildAccounting(values) {
  const safeSum = (numbers, label) => {
    const value = numbers.reduce((total, candidate) => total + candidate, 0);
    if (!Number.isSafeInteger(value))
      throw new TypeError(`${label} exceeds the safe integer bound.`);
    return value;
  };
  const inputTokensMeasured = values.some(({ embedding }) => embedding.inputTokensMeasured === false) ? false : undefined;
  const durationScope = values.some(({ embedding }) => embedding.durationScope === "embedding-backed-search-upper-bound") ? "embedding-backed-search-upper-bound" : undefined;
  const durationMs = values.reduce((total, { embedding }) => total + embedding.durationMs, 0);
  if (!Number.isFinite(durationMs))
    throw new TypeError("embedding duration exceeds the finite bound.");
  const cacheValues = new Set(values.map(({ cacheBytes }) => cacheBytes));
  if (cacheValues.size > 1) {
    throw new TypeError("Closure lanes must report one identical shared-cache byte count.");
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: safeSum(values.map(({ embedding }) => embedding.calls), "embedding calls"),
      inputTokens: inputTokensMeasured === false ? 0 : safeSum(values.map(({ embedding }) => embedding.inputTokens), "embedding input tokens"),
      ...inputTokensMeasured === false ? { inputTokensMeasured } : {},
      durationMs,
      ...durationScope === undefined ? {} : { durationScope }
    }),
    packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
    peakRssBytes: Math.max(0, ...values.map(({ peakRssBytes }) => peakRssBytes)),
    cacheBytes: values[0]?.cacheBytes ?? 0
  });
}
function evaluationAccountingFromClosure(value) {
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: value.embedding.calls,
      inputTokens: value.embedding.inputTokens,
      ...value.embedding.inputTokensMeasured === false ? { inputTokensMeasured: false } : {},
      durationMs: value.embedding.durationMs,
      ...value.embedding.durationScope === undefined ? {} : { durationScope: value.embedding.durationScope }
    }),
    packedContext: Object.freeze({
      utf8Bytes: value.packedContext.utf8Bytes,
      readerTokens: value.packedContext.readerTokens
    }),
    peakRssBytes: value.peakRssBytes,
    cacheBytes: value.cacheBytes
  });
}
function accountingKey(value) {
  return JSON.stringify([
    value.llm.calls,
    value.llm.inputTokens,
    value.llm.outputTokens,
    value.embedding.calls,
    value.embedding.inputTokens,
    value.embedding.inputTokensMeasured,
    value.embedding.durationMs,
    value.embedding.durationScope,
    value.packedContext.utf8Bytes,
    value.packedContext.readerTokens,
    value.peakRssBytes,
    value.cacheBytes
  ]);
}
function assertClosureAccountingMatchesInvocations(closure, invoked) {
  if (accountingKey(closure) !== accountingKey(invoked)) {
    throw new TypeError("Closure aggregate accounting does not match its invoked lane accounting.");
  }
}
function singleLaneResult(options) {
  const rows = options.legacy.hits.map((hit) => Object.freeze({
    hit,
    evidence: resolveHitEvidence(hit, options.bindings, options.lane)
  }));
  const resolved = rows.filter((row) => row.evidence !== undefined);
  const missingProvenanceCount = rows.length - resolved.length;
  const status = missingProvenanceCount > 0 && options.legacy.status === "ready" ? "degraded" : options.legacy.status;
  const diagnostics = Object.freeze([
    ...options.legacy.diagnostics,
    ...missingProvenanceCount === 0 ? [] : [Object.freeze({
      code: "missing-provenance",
      lane: options.lane,
      status: "degraded",
      message: `${missingProvenanceCount} ${options.lane} hit(s) lacked a lane-associated frozen source slice.`
    })]
  ]);
  const candidates = Object.freeze(resolved.map(({ hit, evidence }, index) => Object.freeze({
    documentId: hit.documentId,
    evidenceUnitIds: Object.freeze(evidence.map(({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2)),
    rank: index + 1,
    ...hit.score === undefined ? {} : { score: hit.score },
    provenance: Object.freeze(evidence.map(({ locator }) => locator))
  })));
  const laneOutcome = Object.freeze({
    laneId: options.lane,
    applicability: options.applicable ? "applied" : "skipped",
    status,
    reasonCodes: reasonCodes(diagnostics, options.applicable, status),
    rawRanking: options.applicable ? Object.freeze(rows.map(({ hit, evidence }) => Object.freeze({
      documentId: hit.documentId,
      evidenceUnitIds: Object.freeze(evidence?.map(({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2) ?? []),
      rank: hit.rank,
      ...hit.score === undefined ? {} : { score: hit.score },
      provenance: Object.freeze(evidence?.map(({ locator }) => locator) ?? [])
    }))) : Object.freeze([])
  });
  if (!options.applicable && options.legacy.hits.length > 0) {
    throw new TypeError(`Legacy ${options.lane} lane returned hits without executable input.`);
  }
  const trace = Object.freeze({
    laneOutcomes: Object.freeze([laneOutcome]),
    candidateDecisions: Object.freeze(rows.map(({ hit, evidence }) => Object.freeze({
      documentId: hit.documentId,
      evidenceUnitIds: Object.freeze(evidence?.map(({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2) ?? []),
      laneId: options.lane,
      sourceRank: hit.rank,
      disposition: evidence === undefined ? "excluded" : "accepted",
      reasonCodes: Object.freeze([
        evidence === undefined ? "missing-provenance" : "primary"
      ]),
      provenance: Object.freeze(evidence?.map(({ locator }) => locator) ?? []),
      ...evidence === undefined ? {} : { outputRank: resolved.findIndex((candidate) => candidate.hit === hit) + 1 }
    })))
  });
  const evidenceUnits = Object.freeze([...new Map(resolved.flatMap(({ evidence }) => evidence.map((candidate) => [candidate.evidenceUnitId, candidate]))).values()].map(publicEvidenceUnit));
  return Object.freeze({
    retrieverId: options.descriptor.id,
    status,
    candidates,
    trace,
    diagnostics,
    rawEvidence: Object.freeze(rows.map(({ hit, evidence }) => Object.freeze({
      laneId: options.lane,
      documentId: hit.documentId,
      rank: hit.rank,
      ...hit.evidence === undefined ? {} : { evidence: hit.evidence },
      ...evidence === undefined ? {} : { provenance: Object.freeze(evidence.map(publicEvidenceUnit)) }
    }))),
    evidenceUnits,
    timings: options.legacy.timings,
    rawResources: options.legacy.resources,
    resources: options.accounting,
    elapsedMs: options.elapsedMs
  });
}
function closureHit(hit, bindings, lane) {
  const evidence = resolveHitEvidence(hit, bindings, lane);
  return Object.freeze({
    documentId: hit.documentId,
    canonicalDocumentId: hit.documentId.normalize("NFC"),
    rank: hit.rank,
    ...hit.score === undefined ? {} : { score: hit.score },
    evidenceUnits: Object.freeze(evidence === undefined ? [] : evidence.map((candidate) => Object.freeze({
      id: candidate.evidenceUnitId,
      locator: closureEvidenceLocator(candidate)
    }))),
    ...hit.evidence === undefined ? {} : { evidence: hit.evidence }
  });
}
function closureDiagnostic(diagnostic) {
  return Object.freeze({
    code: diagnostic.code,
    status: diagnostic.status,
    ...diagnostic.message === undefined ? {} : { message: diagnostic.message },
    details: Object.freeze({ lane: diagnostic.lane })
  });
}
function closureBackend(options) {
  return Object.freeze({
    retrieve: async ({ input, limit, signal }) => {
      throwIfAborted2(signal);
      const raw = await options.retriever.retrieve({
        corpus: options.corpus,
        query: legacyQueryBridge(options.toInputs(input)),
        limit,
        signal
      });
      throwIfAborted2(signal);
      const result = validateLegacyResult(raw, options.lane, limit);
      const accounting = await childAccounting(options.accounting, options.lane, result);
      options.recordAccounting(options.lane, accounting);
      return Object.freeze({
        status: result.status,
        hits: Object.freeze(result.hits.map((hit) => closureHit(hit, options.bindings, options.lane))),
        diagnostics: Object.freeze(result.diagnostics.map(closureDiagnostic)),
        timings: result.timings,
        resources: result.resources,
        accounting
      });
    }
  });
}
function closureBackends(retrievers, corpus, bindings, accounting, recordAccounting) {
  return Object.freeze({
    hybrid: closureBackend({
      lane: "hybrid",
      retriever: retrievers.hybrid,
      corpus,
      bindings,
      accounting,
      recordAccounting,
      toInputs: (input) => Object.freeze({ text: input.text })
    }),
    metadata: closureBackend({
      lane: "metadata",
      retriever: retrievers.metadata,
      corpus,
      bindings,
      accounting,
      recordAccounting,
      toInputs: (input) => Object.freeze({ metadata: input })
    }),
    graph: closureBackend({
      lane: "graph",
      retriever: retrievers.graph,
      corpus,
      bindings,
      accounting,
      recordAccounting,
      toInputs: (input) => Object.freeze({ graph: input })
    }),
    pathContext: closureBackend({
      lane: "path-context",
      retriever: retrievers["path-context"],
      corpus,
      bindings,
      accounting,
      recordAccounting,
      toInputs: (input) => Object.freeze({ context: input })
    }),
    git: closureBackend({
      lane: "git",
      retriever: retrievers.git,
      corpus,
      bindings,
      accounting,
      recordAccounting,
      toInputs: (input) => Object.freeze({ history: input })
    })
  });
}
function closureInputs(inputs) {
  return Object.freeze({
    hybrid: Object.freeze({ text: inputs.text }),
    ...inputs.metadata === undefined ? {} : { metadata: inputs.metadata },
    ...inputs.graph === undefined ? {} : { graph: inputs.graph },
    ...inputs.context === undefined ? {} : { pathContext: inputs.context },
    ...inputs.history === undefined ? {} : { history: inputs.history }
  });
}
function mapClosureLaneOutcome(lane, bindings) {
  const rawRanking = Object.freeze(lane.candidates.map((candidate) => {
    const provenance = bindingsFromClosureProvenance(candidate.provenance, bindings);
    return Object.freeze({
      documentId: candidate.canonicalDocumentId,
      evidenceUnitIds: Object.freeze(provenance.map(({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2)),
      rank: candidate.sourceRank,
      provenance: Object.freeze(provenance.map(({ locator }) => locator))
    });
  }));
  if (lane.invocation === "invoked") {
    if (rawRanking.some(({ rank }, index) => rank !== index + 1)) {
      throw new TypeError(`Closure ${lane.lane} did not preserve contiguous source ranks.`);
    }
    if (new Set(rawRanking.map(({ documentId }) => documentId)).size !== rawRanking.length) {
      throw new TypeError(`Closure ${lane.lane} raw ranking repeats a canonical document.`);
    }
  }
  const status = lane.invocation === "disabled" ? "ready" : lane.invocation === "skipped-missing-input" ? "unavailable" : lane.status;
  const codes = [
    ...lane.diagnostics.map(({ code }) => canonicalId2(code, `closure ${lane.lane} diagnostic code`)),
    ...lane.invocation === "disabled" ? ["disabled"] : [],
    ...lane.invocation === "skipped-missing-input" ? ["missing-input"] : []
  ];
  return Object.freeze({
    laneId: lane.lane,
    applicability: lane.invocation === "invoked" ? "applied" : "skipped",
    status,
    reasonCodes: Object.freeze([...new Set(codes)].toSorted()),
    rawRanking: lane.invocation === "invoked" && status !== "unavailable" ? rawRanking : Object.freeze([])
  });
}
function mapClosureResult(options) {
  const laneOrder = new Map(options.descriptor.lanes.map((lane, index) => [lane, index]));
  const outcomesByLane = new Map(options.result.trace.lanes.map((lane) => [lane.lane, lane]));
  const laneOutcomes = Object.freeze(options.descriptor.lanes.map((lane) => {
    const outcome = outcomesByLane.get(lane);
    if (outcome === undefined)
      throw new TypeError(`Closure trace is missing locked lane ${lane}.`);
    return mapClosureLaneOutcome(outcome, options.bindings);
  }));
  const candidateDecisions = Object.freeze(options.result.trace.lanes.flatMap((lane) => lane.candidates.map((candidate) => {
    const provenance = bindingsFromClosureProvenance(candidate.provenance, options.bindings);
    return Object.freeze({
      documentId: candidate.canonicalDocumentId,
      evidenceUnitIds: Object.freeze(provenance.map(({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2)),
      laneId: candidate.lane,
      sourceRank: candidate.sourceRank,
      disposition: candidate.decision,
      reasonCodes: Object.freeze([candidate.reasonCode]),
      ...candidate.decision === "accepted" && candidate.outputRank !== undefined ? { outputRank: candidate.outputRank } : {},
      provenance: Object.freeze(provenance.map(({ locator }) => locator))
    });
  })).toSorted((left, right) => (laneOrder.get(left.laneId) ?? Number.MAX_SAFE_INTEGER) - (laneOrder.get(right.laneId) ?? Number.MAX_SAFE_INTEGER) || left.sourceRank - right.sourceRank || left.documentId.localeCompare(right.documentId)));
  const candidates = Object.freeze(options.result.hits.map((hit, index) => {
    const document = options.result.trace.documents[index];
    const provenance = document === undefined ? Object.freeze([]) : uniqueBindingsFromClosureProvenance(document.sources.flatMap(({ provenance: provenance2 }) => provenance2), options.bindings);
    if (provenance.length === 0) {
      throw new TypeError(`Accepted closure candidate ${hit.canonicalDocumentId} lacks exact unit provenance.`);
    }
    return Object.freeze({
      documentId: hit.canonicalDocumentId,
      evidenceUnitIds: Object.freeze(provenance.map(({ evidenceUnitId: evidenceUnitId2 }) => evidenceUnitId2)),
      rank: index + 1,
      ...hit.score === undefined ? {} : { score: hit.score },
      provenance: Object.freeze(provenance.map(({ locator }) => locator))
    });
  }));
  const diagnostics = Object.freeze(options.result.trace.lanes.flatMap((lane) => lane.diagnostics.map((diagnostic) => Object.freeze({
    code: diagnostic.code,
    lane: lane.lane,
    status: diagnostic.status,
    ...diagnostic.message === undefined ? {} : { message: diagnostic.message }
  }))));
  const evidenceUnits = Object.freeze([...new Map(options.result.trace.lanes.flatMap((lane) => lane.candidates.flatMap((candidate) => bindingsFromClosureProvenance(candidate.provenance, options.bindings).map((evidence) => [evidence.evidenceUnitId, evidence])))).values()].map(publicEvidenceUnit));
  const rawEvidence = Object.freeze(laneOutcomes.flatMap((outcome) => {
    const lane = outcomesByLane.get(outcome.laneId);
    if (lane === undefined) {
      throw new TypeError(`Closure trace is missing locked lane ${outcome.laneId}.`);
    }
    return outcome.rawRanking.map((ranking) => {
      const matching = lane.candidates.filter((candidate2) => candidate2.canonicalDocumentId === ranking.documentId && candidate2.sourceRank === ranking.rank);
      if (matching.length !== 1) {
        throw new TypeError(`Closure raw evidence cannot join ${outcome.laneId} rank ${ranking.rank} exactly once.`);
      }
      const candidate = matching[0];
      const evidence = bindingsFromClosureProvenance(candidate.provenance, options.bindings);
      return Object.freeze({
        laneId: outcome.laneId,
        documentId: ranking.documentId,
        rank: ranking.rank,
        ...candidate.evidence === undefined ? {} : { evidence: candidate.evidence },
        ...evidence.length === 0 ? {} : { provenance: Object.freeze(evidence.map(publicEvidenceUnit)) }
      });
    });
  }));
  return Object.freeze({
    retrieverId: options.descriptor.id,
    status: options.result.status,
    candidates,
    trace: Object.freeze({ laneOutcomes, candidateDecisions }),
    diagnostics,
    rawEvidence,
    evidenceUnits,
    timings: options.result.timings,
    rawResources: options.result.resources,
    resources: options.accounting,
    elapsedMs: options.elapsedMs
  });
}
function throwIfAborted2(signal) {
  if (!signal.aborted)
    return;
  if (signal.reason instanceof Error)
    throw signal.reason;
  throw new Error("Knowledge-base evaluation v2 retrieval was aborted.");
}
function elapsed(startedAt, now) {
  const duration = now() - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}
function validateLaneDescriptor(lane, descriptor) {
  if (descriptor.lanes.length !== 1 || descriptor.lanes[0] !== lane) {
    throw new TypeError(`Descriptor ${descriptor.id} must expose only ${lane} lane.`);
  }
  const retrieveLimit = positiveLimit2(descriptor.configuration["retrieve-limit"], `descriptor ${descriptor.id} retrieve-limit`);
  const expected = laneConfiguration(lane, retrieveLimit);
  if (JSON.stringify(descriptor.configuration) !== JSON.stringify(expected)) {
    throw new TypeError(`Descriptor ${descriptor.id} configuration does not match the executable lane contract.`);
  }
  return retrieveLimit;
}
function validateClosureDescriptor(pair) {
  const frozen = freezeExistingLaneClosureVariant(pair.variant);
  if (JSON.stringify(pair.descriptor.configuration) !== JSON.stringify(closureConfiguration(frozen))) {
    throw new TypeError(`Closure descriptor ${pair.descriptor.id} does not bind its complete variant.`);
  }
  if (JSON.stringify(pair.descriptor.lanes) !== JSON.stringify(closureDescriptorLanes(frozen))) {
    throw new TypeError(`Closure descriptor ${pair.descriptor.id} lanes do not match its variant.`);
  }
}
function implementationArtifactsByRetrieverId(artifacts, descriptors) {
  const artifactArrayIsValid = Array.isArray(artifacts);
  if (!artifactArrayIsValid) {
    throw new TypeError("implementationArtifacts must be an exact one-per-descriptor array.");
  }
  const expectedIds = new Set(descriptors.map(({ id }) => id));
  const byRetrieverId = new Map;
  for (const artifact of artifacts) {
    const retrieverId = artifact?.retrieverId;
    if (typeof retrieverId !== "string") {
      throw new TypeError("implementationArtifacts contains an invalid artifact entry.");
    }
    if (byRetrieverId.has(retrieverId)) {
      throw new TypeError(`Implementation artifact for retriever ${retrieverId} is duplicated.`);
    }
    if (!expectedIds.has(retrieverId)) {
      throw new TypeError(`Implementation artifact for retriever ${retrieverId} is extra.`);
    }
    byRetrieverId.set(retrieverId, artifact);
  }
  for (const descriptor of descriptors) {
    if (!byRetrieverId.has(descriptor.id)) {
      throw new TypeError(`Implementation artifact for retriever ${descriptor.id} is missing.`);
    }
  }
  return byRetrieverId;
}
function createSingleLaneExecutionRetriever(options) {
  const descriptor = options.contract.descriptorsById[options.descriptorId];
  if (descriptor === undefined) {
    throw new TypeError(`Execution contract is missing descriptor ${options.descriptorId}.`);
  }
  const legacy = options.contract.legacyRetrievers[options.lane];
  return Object.freeze({
    descriptor,
    retrieve: async (request) => {
      assertFrozenSnapshot(options.contract.frozen, request.corpus);
      assertRequestLimit(descriptor, request.limit);
      throwIfAborted2(request.signal);
      const inputs = executionInputs(request);
      const applicable = laneIsApplicable(options.lane, inputs);
      if (!applicable) {
        return singleLaneResult({
          descriptor,
          lane: options.lane,
          applicable: false,
          legacy: Object.freeze({
            status: "unavailable",
            hits: Object.freeze([]),
            diagnostics: Object.freeze([]),
            timings: Object.freeze({}),
            resources: Object.freeze({})
          }),
          bindings: options.contract.evidenceBindings,
          accounting: aggregateChildAccounting([]),
          elapsedMs: 0
        });
      }
      const startedAt = options.now();
      const raw = await legacy.retrieve({
        corpus: options.contract.frozen,
        query: legacyQueryBridge(inputForLegacyLane(options.lane, inputs)),
        limit: request.limit,
        signal: request.signal
      });
      throwIfAborted2(request.signal);
      const legacyResult = validateLegacyResult(raw, options.lane, request.limit);
      const accounting = await childAccounting(options.accounting, options.lane, legacyResult);
      throwIfAborted2(request.signal);
      return singleLaneResult({
        descriptor,
        lane: options.lane,
        applicable,
        legacy: legacyResult,
        bindings: options.contract.evidenceBindings,
        accounting,
        elapsedMs: elapsed(startedAt, options.now)
      });
    }
  });
}
function createClosureExecutionRetriever(options) {
  const descriptor = options.contract.descriptorsById[options.descriptorId];
  if (descriptor === undefined) {
    throw new TypeError(`Execution contract is missing descriptor ${options.descriptorId}.`);
  }
  const variant = freezeExistingLaneClosureVariant(options.variant);
  return Object.freeze({
    descriptor,
    retrieve: async (request) => {
      assertFrozenSnapshot(options.contract.frozen, request.corpus);
      assertRequestLimit(descriptor, request.limit);
      throwIfAborted2(request.signal);
      const inputs = executionInputs(request);
      const startedAt = options.now();
      const childAccountingByLane = new Map;
      const backends = closureBackends(options.contract.legacyRetrievers, options.contract.frozen, options.contract.evidenceBindings, options.accounting, (lane, accounting) => {
        if (childAccountingByLane.has(lane)) {
          throw new TypeError(`Closure invoked ${lane} accounting more than once.`);
        }
        childAccountingByLane.set(lane, accounting);
      });
      const result = await runExistingLaneClosure({
        variant,
        query: Object.freeze({ inputs: closureInputs(inputs) }),
        backends,
        evidenceRegistry: options.contract.closureEvidenceRegistry,
        signal: request.signal
      });
      throwIfAborted2(request.signal);
      const invokedAccounting = aggregateChildAccounting([...childAccountingByLane.values()]);
      const closureAccounting = evaluationAccountingFromClosure(result.accounting);
      assertClosureAccountingMatchesInvocations(closureAccounting, invokedAccounting);
      return mapClosureResult({
        descriptor,
        result,
        bindings: options.contract.evidenceBindings,
        accounting: closureAccounting,
        elapsedMs: elapsed(startedAt, options.now)
      });
    }
  });
}
function adaptVerifiedKnowledgeBaseEvaluationV2(options) {
  const clock = options.now ?? performance.now.bind(performance);
  const accounting = options.accounting;
  const close = options.evaluation.close;
  if (typeof accounting !== "function") {
    throw new TypeError("Knowledge-base evaluation v2 requires a per-lane accounting provider.");
  }
  const closureDescriptors = options.closureDescriptors ?? Object.freeze([]);
  const descriptors = [];
  const laneDescriptorIds = new Map;
  for (const lane of knowledgeBaseEvaluationRetrieverIds) {
    const descriptor = options.laneDescriptors[lane];
    validateLaneDescriptor(lane, descriptor);
    descriptors.push(descriptor);
    laneDescriptorIds.set(lane, descriptor.id);
  }
  const closureIds = new Set;
  const lockedClosures = [];
  for (const pair of closureDescriptors) {
    validateClosureDescriptor(pair);
    if (closureIds.has(pair.descriptor.id)) {
      throw new TypeError(`Closure descriptor ID ${pair.descriptor.id} is repeated.`);
    }
    closureIds.add(pair.descriptor.id);
    descriptors.push(pair.descriptor);
    lockedClosures.push(Object.freeze({
      descriptorId: pair.descriptor.id,
      variant: freezeExistingLaneClosureVariant(pair.variant)
    }));
  }
  if (new Set(descriptors.map(({ id }) => id)).size !== descriptors.length) {
    throw new TypeError("Knowledge-base evaluation v2 descriptor IDs must be unique.");
  }
  const implementationArtifacts = implementationArtifactsByRetrieverId(options.implementationArtifacts, descriptors);
  for (const descriptor of descriptors) {
    const artifact = implementationArtifacts.get(descriptor.id);
    if (artifact === undefined) {
      throw new TypeError(`Implementation artifact for retriever ${descriptor.id} is missing.`);
    }
    assertEvaluationImplementationArtifactV2(artifact, options.corpus, descriptor);
  }
  const evidenceBindings = buildEvidenceBindings(options.evidenceRegistry, options.corpus);
  const legacyRetrievers = bindLegacyRetrievers(options.evaluation);
  const contract = createExecutionContract({
    corpus: options.corpus,
    descriptors,
    evidenceBindings,
    legacyRetrievers
  });
  const retrievers = [];
  for (const lane of knowledgeBaseEvaluationRetrieverIds) {
    const descriptorId = laneDescriptorIds.get(lane);
    if (descriptorId === undefined)
      throw new TypeError(`Execution contract is missing ${lane} lane.`);
    retrievers.push(createSingleLaneExecutionRetriever({
      contract,
      descriptorId,
      lane,
      accounting,
      now: clock
    }));
  }
  for (const closure of lockedClosures) {
    retrievers.push(createClosureExecutionRetriever({
      contract,
      descriptorId: closure.descriptorId,
      variant: closure.variant,
      accounting,
      now: clock
    }));
  }
  if (new Set(retrievers.map(({ descriptor }) => descriptor.id)).size !== retrievers.length) {
    throw new TypeError("Knowledge-base evaluation v2 descriptor IDs must be unique.");
  }
  const evaluationV2 = Object.freeze({
    retrievers: Object.freeze(retrievers),
    close
  });
  verifiedKnowledgeBaseEvaluationsV2.set(evaluationV2, Object.freeze({
    suiteSha256: contract.manifest.corpusSha256,
    candidateLockSha256: contract.manifest.candidateLockSha256,
    buildContractSha256: contract.manifest.buildContractSha256,
    repositoryCommit: contract.frozen.repositoryCommit,
    vaultTree: contract.frozen.vaultTree
  }));
  return evaluationV2;
}
async function openKnowledgeBaseEvaluationV2(options) {
  const {
    corpus,
    evidenceRegistry,
    accounting,
    laneDescriptors,
    closureDescriptors,
    implementationArtifacts,
    now,
    openEvaluation = openKnowledgeBaseEvaluation,
    ...legacyOptions
  } = options;
  const evaluation = await openEvaluation({
    ...legacyOptions,
    corpus: legacyCorpusBridge(corpus.frozen),
    ...now === undefined ? {} : { now }
  });
  try {
    return adaptVerifiedKnowledgeBaseEvaluationV2({
      corpus,
      evidenceRegistry,
      accounting,
      evaluation,
      laneDescriptors,
      implementationArtifacts,
      ...closureDescriptors === undefined ? {} : { closureDescriptors },
      ...now === undefined ? {} : { now }
    });
  } catch (error) {
    await evaluation.close();
    throw error;
  }
}
function createKnowledgeBaseEvaluationRepeatedSampleV2(options) {
  const finite = (value, label) => {
    if (!Number.isFinite(value) || value < 0)
      throw new TypeError(`${label} must be non-negative and finite.`);
    return value;
  };
  const integer = (value, label) => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError(`${label} must be a non-negative integer.`);
    return value;
  };
  if (!Number.isSafeInteger(options.repetition) || options.repetition < 1) {
    throw new TypeError("sample repetition must be a positive integer.");
  }
  const concurrencyBatchIdentity = options.concurrencyBatchIdentity === undefined ? undefined : boundedText(options.concurrencyBatchIdentity, "sample concurrencyBatchIdentity", 512);
  const timings = Object.freeze({
    elapsedMs: finite(options.timings?.elapsedMs ?? options.result.elapsedMs, "sample elapsedMs"),
    indexMs: finite(options.timings?.indexMs ?? 0, "sample indexMs"),
    updateMs: finite(options.timings?.updateMs ?? 0, "sample updateMs"),
    queryMs: finite(options.timings?.queryMs ?? options.result.elapsedMs, "sample queryMs"),
    packingMs: finite(options.timings?.packingMs ?? 0, "sample packingMs")
  });
  const embedding = copyEmbeddingAccounting(options.embedding ?? options.result.resources.embedding, "sample embedding");
  const packedContext = options.packedContext ?? options.result.resources.packedContext;
  const packedContextTrace = options.packedContextTrace === undefined ? undefined : Object.freeze({
    evidenceUnitIds: Object.freeze(options.packedContextTrace.evidenceUnitIds.map((id, index) => boundedText(id, `sample packedContextTrace.evidenceUnitIds[${index}]`, 512))),
    truncated: options.packedContextTrace.truncated,
    packedBytesSha256: boundedText(options.packedContextTrace.packedBytesSha256, "sample packedContextTrace.packedBytesSha256", 64)
  });
  return Object.freeze({
    retrieverId: options.result.retrieverId,
    profileId: canonicalId2(options.profileId, "sample profileId"),
    ...options.queryId === undefined ? {} : { queryId: boundedText(options.queryId, "sample queryId", 256) },
    repetition: options.repetition,
    ...concurrencyBatchIdentity === undefined ? {} : { concurrencyBatchIdentity },
    status: options.result.status,
    timings,
    resources: Object.freeze({
      llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
      embedding: Object.freeze({
        calls: embedding.calls,
        inputTokens: embedding.inputTokens,
        ...embedding.inputTokensMeasured === false ? { inputTokensMeasured: false } : {},
        durationMs: embedding.durationMs,
        ...embedding.durationScope === undefined ? {} : { durationScope: embedding.durationScope }
      }),
      packedContext: Object.freeze({
        utf8Bytes: integer(packedContext.utf8Bytes, "sample packedContext.utf8Bytes"),
        readerTokens: integer(packedContext.readerTokens, "sample packedContext.readerTokens")
      }),
      peakRssBytes: integer(options.peakRssBytes ?? options.result.resources.peakRssBytes, "sample peakRssBytes"),
      cacheBytes: integer(options.cacheBytes ?? options.result.resources.cacheBytes, "sample cacheBytes")
    }),
    trace: options.result.trace,
    rawEvidence: Object.freeze(options.result.rawEvidence.map((row) => Object.freeze({
      laneId: row.laneId,
      documentId: row.documentId,
      rank: row.rank,
      ...row.evidence === undefined ? {} : { evidence: immutableEvidenceCopy(row.evidence) }
    }))),
    ...packedContextTrace === undefined ? {} : { packedContextTrace }
  });
}

// src/evaluation-packing-v2.ts
import { createHash as createHash6 } from "crypto";
var UTF8_BYTE_TOKENIZER_DEFINITION = `hraness/kb evaluation reader tokenizer: one token per UTF-8 byte; v1
`;
var MAX_TOKENIZER_DEFINITION_BYTES = 1 * 1024 * 1024;
var MAX_TOKENIZER_ID_BYTES = 512;
var tokenizerBrand = Symbol("registered-evaluation-reader-tokenizer-v2");
var registeredTokenizers = new WeakSet;
var registeredTokenizerById = new Map;
function createEvaluationReaderTokenizerV2(options) {
  if (typeof options.id !== "string" || options.id.length === 0 || /[\0\r\n]/u.test(options.id) || Buffer.byteLength(options.id, "utf8") > MAX_TOKENIZER_ID_BYTES)
    throw new TypeError("Evaluation reader tokenizer id must be a non-empty bounded single line.");
  if (typeof options.definition !== "string" || options.definition.length === 0 || Buffer.byteLength(options.definition, "utf8") > MAX_TOKENIZER_DEFINITION_BYTES)
    throw new TypeError("Evaluation reader tokenizer definition must be non-empty and bounded.");
  if (typeof options.count !== "function") {
    throw new TypeError("Evaluation reader tokenizer count must be a function.");
  }
  if (registeredTokenizerById.has(options.id)) {
    throw new TypeError(`Evaluation reader tokenizer id ${options.id} is already registered.`);
  }
  const tokenizer = {
    id: options.id,
    sha256: createHash6("sha256").update(options.definition, "utf8").digest("hex"),
    count: options.count,
    [tokenizerBrand]: true
  };
  Object.defineProperty(tokenizer, tokenizerBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
  Object.freeze(tokenizer);
  registeredTokenizers.add(tokenizer);
  registeredTokenizerById.set(tokenizer.id, tokenizer);
  return tokenizer;
}
var utf8ByteEvaluationReaderTokenizerV2 = createEvaluationReaderTokenizerV2({
  id: "utf8-byte-tokenizer-v1",
  definition: UTF8_BYTE_TOKENIZER_DEFINITION,
  count: (text) => Buffer.byteLength(text, "utf8")
});
function equalStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function verifyBinding(binding, corpusUnit, live, family, document) {
  const locator = binding.locator;
  if (binding.evidenceUnitId !== corpusUnit.id || binding.registryUnitId !== live.id || corpusUnit.id !== live.id || binding.documentId !== corpusUnit.documentId || corpusUnit.documentId !== document.id || document.id !== live.documentId || binding.sourceFamilyId !== corpusUnit.sourceFamilyId || corpusUnit.sourceFamilyId !== family.id || document.sourceFamilyId !== family.id || binding.sourceClass !== family.sourceClass || binding.trustClass !== corpusUnit.trustClass || corpusUnit.trustClass !== document.trustClass || document.trustClass !== family.trustClass || family.trustClass !== live.trustClass || binding.trustClass !== live.trustClass || locator.evidenceUnitId !== binding.evidenceUnitId || locator.sourceFamilyId !== family.id || locator.sourceClass !== family.sourceClass || locator.trustClass !== live.trustClass || corpusUnit.sourcePath !== live.sourcePath || locator.sourcePath !== live.sourcePath || corpusUnit.lineRange.start !== live.lineRange.start || corpusUnit.lineRange.end !== live.lineRange.end || locator.lineRange.start !== live.lineRange.start || locator.lineRange.end !== live.lineRange.end || !equalStrings(corpusUnit.headingPath, live.headingAncestry) || !equalStrings(locator.headingPath, live.headingAncestry) || corpusUnit.sourcePage !== live.pdfPage || locator.sourcePage !== live.pdfPage) {
    throw new TypeError(`Packed evidence binding ${binding.evidenceUnitId} does not exactly match its live registry metadata.`);
  }
  return Object.freeze({
    evidenceUnitId: live.id,
    documentId: live.documentId,
    sourceFamilyId: family.id,
    sourceClass: family.sourceClass,
    trustClass: live.trustClass,
    sourcePath: live.sourcePath,
    lineRange: Object.freeze({ start: live.lineRange.start, end: live.lineRange.end }),
    headingPath: Object.freeze([...live.headingAncestry]),
    ...live.pdfPage === undefined ? {} : { sourcePage: live.pdfPage },
    text: live.text
  });
}
function assertDecisionProvenance(decision, verifiedById) {
  if (new Set(decision.evidenceUnitIds).size !== decision.evidenceUnitIds.length) {
    throw new TypeError("Evaluation candidate decision repeats an evidence-unit binding.");
  }
  if (decision.provenance.length !== decision.evidenceUnitIds.length) {
    throw new TypeError("Evaluation candidate decision provenance does not exactly cover its evidence units.");
  }
  for (const [index, evidenceUnitId2] of decision.evidenceUnitIds.entries()) {
    const verified = verifiedById.get(evidenceUnitId2);
    if (verified === undefined) {
      throw new TypeError(`Evaluation candidate decision names unbound evidence unit ${evidenceUnitId2}.`);
    }
    const locator = decision.provenance[index];
    if (locator === undefined || decision.documentId !== verified.documentId && decision.laneId !== "graph" || locator.evidenceUnitId !== verified.evidenceUnitId || locator.sourceFamilyId !== verified.sourceFamilyId || locator.sourceClass !== verified.sourceClass || locator.trustClass !== verified.trustClass || locator.sourcePath !== verified.sourcePath || locator.lineRange.start !== verified.lineRange.start || locator.lineRange.end !== verified.lineRange.end || !equalStrings(locator.headingPath, verified.headingPath) || locator.sourcePage !== verified.sourcePage) {
      throw new TypeError(`Evaluation candidate decision provenance for ${evidenceUnitId2} does not match verified live evidence.`);
    }
  }
}
function locatorMatchesVerified(locator, verified) {
  return locator.evidenceUnitId === verified.evidenceUnitId && locator.sourceFamilyId === verified.sourceFamilyId && locator.sourceClass === verified.sourceClass && locator.trustClass === verified.trustClass && locator.sourcePath === verified.sourcePath && locator.lineRange.start === verified.lineRange.start && locator.lineRange.end === verified.lineRange.end && equalStrings(locator.headingPath, verified.headingPath) && locator.sourcePage === verified.sourcePage;
}
function assertRankedCandidateProvenance(candidate, decisions, verifiedById) {
  if (new Set(candidate.evidenceUnitIds).size !== candidate.evidenceUnitIds.length || candidate.provenance.length !== candidate.evidenceUnitIds.length)
    throw new TypeError("Ranked evaluation candidate provenance must uniquely cover its evidence units.");
  const candidateDecisionEvidence = new Set(decisions.filter(({ documentId }) => documentId === candidate.documentId).flatMap(({ evidenceUnitIds }) => evidenceUnitIds));
  if (candidateDecisionEvidence.size !== candidate.evidenceUnitIds.length || candidate.evidenceUnitIds.some((id) => !candidateDecisionEvidence.has(id))) {
    throw new TypeError(`Ranked evaluation candidate ${candidate.documentId} must aggregate exactly its lane-decision evidence.`);
  }
  for (const [index, evidenceUnitId2] of candidate.evidenceUnitIds.entries()) {
    const verified = verifiedById.get(evidenceUnitId2);
    const locator = candidate.provenance[index];
    if (verified === undefined || locator === undefined || !locatorMatchesVerified(locator, verified)) {
      throw new TypeError(`Ranked evaluation candidate provenance for ${evidenceUnitId2} does not match verified live evidence.`);
    }
    if (candidate.documentId !== verified.documentId) {
      const graphDecision = decisions.some((decision) => decision.documentId === candidate.documentId && decision.laneId === "graph" && decision.evidenceUnitIds.some((id, evidenceIndex) => id === evidenceUnitId2 && decision.provenance[evidenceIndex] !== undefined && locatorMatchesVerified(decision.provenance[evidenceIndex], verified)));
      if (!graphDecision) {
        throw new TypeError(`Ranked evaluation candidate ${candidate.documentId} has cross-document evidence without a graph decision.`);
      }
    }
  }
}
function safeTokenCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} returned an invalid token count.`);
  return value;
}
function block(options) {
  const page = options.sourcePage === undefined ? "" : ` page=${options.sourcePage}`;
  return [
    `[${options.sourcePath}:${options.lineStart}-${options.lineEnd}${page} evidence=${options.evidenceUnitId} source=${options.sourceClass} trust=${options.trustClass}]`,
    options.text,
    ""
  ].join(`
`);
}
async function packKnowledgeBaseEvaluationContextV2(options) {
  if (options.tokenizer === null || typeof options.tokenizer !== "object" || !registeredTokenizers.has(options.tokenizer) || registeredTokenizerById.get(options.tokenizer.id) !== options.tokenizer || options.tokenizer[tokenizerBrand] !== true)
    throw new TypeError("Packed-context tokenizer is not a registered tokenizer capability.");
  if (options.tokenizer.id !== options.corpus.experiment.environment.tokenizer.id || options.tokenizer.sha256 !== options.corpus.experiment.environment.tokenizer.sha256)
    throw new TypeError("Packed-context tokenizer does not match the sealed evaluation environment.");
  const registry = options.evidenceRegistry;
  const registryIds = new Set;
  for (const unit of registry.units) {
    if (registryIds.has(unit.id))
      throw new TypeError(`Live evidence registry repeats unit ${unit.id}.`);
    registryIds.add(unit.id);
  }
  validateEvaluationEvidenceRegistry(registry);
  const registryById = new Map(registry.units.map((unit) => [unit.id, unit]));
  const familyById = new Map;
  for (const family of options.corpus.sourceFamilies) {
    if (familyById.has(family.id))
      throw new TypeError(`Evaluation corpus repeats source family ${family.id}.`);
    familyById.set(family.id, family);
  }
  const documentById = new Map;
  for (const document of options.corpus.documents) {
    if (documentById.has(document.id))
      throw new TypeError(`Evaluation corpus repeats document ${document.id}.`);
    documentById.set(document.id, document);
  }
  const corpusUnitById = new Map;
  for (const unit of options.corpus.evidenceUnits) {
    if (corpusUnitById.has(unit.id))
      throw new TypeError(`Evaluation corpus repeats evidence unit ${unit.id}.`);
    corpusUnitById.set(unit.id, unit);
  }
  const verifiedByCorpusId = new Map;
  const boundRegistryIds = new Set;
  for (const binding of options.result.evidenceUnits) {
    if (verifiedByCorpusId.has(binding.evidenceUnitId)) {
      throw new TypeError(`Result evidence repeats corpus unit ${binding.evidenceUnitId}.`);
    }
    if (boundRegistryIds.has(binding.registryUnitId)) {
      throw new TypeError(`Result evidence repeats live registry binding ${binding.registryUnitId}.`);
    }
    const live = registryById.get(binding.registryUnitId);
    if (live === undefined) {
      throw new TypeError(`Packed evidence unit ${binding.evidenceUnitId} names a missing live registry unit.`);
    }
    const corpusUnit = corpusUnitById.get(binding.evidenceUnitId);
    if (corpusUnit === undefined) {
      throw new TypeError(`Packed evidence unit ${binding.evidenceUnitId} names a missing corpus evidence unit.`);
    }
    const family = familyById.get(corpusUnit.sourceFamilyId);
    const document = documentById.get(corpusUnit.documentId);
    if (family === undefined || document === undefined) {
      throw new TypeError(`Packed evidence unit ${binding.evidenceUnitId} has an unresolved corpus provenance chain.`);
    }
    verifiedByCorpusId.set(binding.evidenceUnitId, verifyBinding(binding, corpusUnit, live, family, document));
    boundRegistryIds.add(binding.registryUnitId);
  }
  for (const decision of options.result.trace.candidateDecisions) {
    assertDecisionProvenance(decision, verifiedByCorpusId);
  }
  const accepted = options.result.trace.candidateDecisions.filter(({ disposition }) => disposition === "accepted").toSorted((left, right) => (left.outputRank ?? Number.MAX_SAFE_INTEGER) - (right.outputRank ?? Number.MAX_SAFE_INTEGER));
  const outputRanks = accepted.map(({ outputRank }) => outputRank);
  if (new Set(outputRanks).size !== outputRanks.length || outputRanks.some((rank, index) => rank !== index + 1))
    throw new TypeError("Accepted evaluation candidates must use unique contiguous output ranks.");
  if (options.result.candidates.length !== accepted.length || options.result.candidates.some((candidate, index) => candidate.rank !== index + 1 || candidate.documentId !== accepted[index]?.documentId || accepted[index]?.outputRank !== candidate.rank)) {
    throw new TypeError("Ranked evaluation candidates must match accepted output decisions exactly.");
  }
  const orderedIds = [];
  const seen = new Set;
  for (const candidate of options.result.candidates) {
    assertRankedCandidateProvenance(candidate, options.result.trace.candidateDecisions, verifiedByCorpusId);
    if (candidate.evidenceUnitIds.length === 0) {
      throw new TypeError("Accepted evaluation candidates must carry ranked evidence provenance before packing.");
    }
    for (const evidenceUnitId2 of candidate.evidenceUnitIds) {
      if (!seen.has(evidenceUnitId2))
        orderedIds.push(evidenceUnitId2);
      seen.add(evidenceUnitId2);
    }
  }
  const byteCeiling = options.corpus.experiment.protocol.contextCeilings.utf8Bytes;
  const tokenCeiling = options.corpus.experiment.protocol.contextCeilings.readerTokens;
  if (!Number.isSafeInteger(byteCeiling) || byteCeiling < 1) {
    throw new TypeError("Packed-context UTF-8 byte ceiling must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(tokenCeiling) || tokenCeiling < 1) {
    throw new TypeError("Packed-context reader-token ceiling must be a positive safe integer.");
  }
  let text = "";
  const includedEvidenceUnitIds = [];
  let utf8Bytes = 0;
  let readerTokens = safeTokenCount(await options.tokenizer.count(""), "Packed-context tokenizer");
  if (readerTokens !== 0) {
    throw new TypeError("Packed-context tokenizer must count an empty context as zero tokens.");
  }
  let truncated = false;
  for (const evidenceUnitId2 of orderedIds) {
    const verified = verifiedByCorpusId.get(evidenceUnitId2);
    if (verified === undefined)
      throw new TypeError(`Packed evidence unit ${evidenceUnitId2} lacks a live registry binding.`);
    const content = block({
      evidenceUnitId: verified.evidenceUnitId,
      sourcePath: verified.sourcePath,
      lineStart: verified.lineRange.start,
      lineEnd: verified.lineRange.end,
      ...verified.sourcePage === undefined ? {} : { sourcePage: verified.sourcePage },
      sourceClass: verified.sourceClass,
      trustClass: verified.trustClass,
      text: verified.text
    });
    const prospectiveText = `${text}${content}`;
    const prospectiveBytes = Buffer.byteLength(prospectiveText, "utf8");
    const prospectiveTokens = safeTokenCount(await options.tokenizer.count(prospectiveText), "Packed-context tokenizer");
    if (prospectiveBytes > byteCeiling || prospectiveTokens > tokenCeiling) {
      truncated = true;
      break;
    }
    text = prospectiveText;
    includedEvidenceUnitIds.push(evidenceUnitId2);
    utf8Bytes = prospectiveBytes;
    readerTokens = prospectiveTokens;
  }
  const finalReaderTokens = safeTokenCount(await options.tokenizer.count(text), "Packed-context tokenizer");
  if (finalReaderTokens !== readerTokens) {
    throw new TypeError("Packed-context tokenizer returned a nondeterministic final count.");
  }
  const packedBytes = Buffer.from(text, "utf8");
  if (packedBytes.byteLength !== utf8Bytes) {
    throw new TypeError("Packed-context UTF-8 byte accounting drifted from the exact final bytes.");
  }
  return Object.freeze({
    text,
    utf8Bytes,
    readerTokens,
    includedEvidenceUnitIds: Object.freeze(includedEvidenceUnitIds),
    truncated,
    packedBytesSha256: createHash6("sha256").update(packedBytes).digest("hex")
  });
}

// src/evaluation-execution-v2.ts
var MAX_CACHE_PREPARATION_BYTES = 64 * 1024;
var MAX_CACHE_DEFINITION_BYTES = 1 * 1024 * 1024;
var cacheVerifierBrand = Symbol("knowledge-base-evaluation-cache-verifier-v2");
var cacheVerifierRegistration = new WeakMap;
var fourReaderOpenerBrand = Symbol("knowledge-base-evaluation-four-reader-opener-v2");
var fourReaderOpenerRegistration = new WeakMap;
function sha2564(text) {
  return createHash7("sha256").update(text, "utf8").digest("hex");
}
function cacheRegistrationKey(preparation, definitionSha256) {
  return JSON.stringify([preparation, definitionSha256]);
}
function fourReaderOpenerRegistrationKey(id, definitionSha256) {
  return JSON.stringify([id, definitionSha256]);
}
function boundedDefinition(value, label, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\x00") || Buffer.byteLength(value, "utf8") > maximumBytes)
    throw new TypeError(`${label} must be non-empty, NUL-free, and bounded.`);
  return value;
}
function createKnowledgeBaseEvaluationCacheVerifierV2(options) {
  const preparation = boundedDefinition(options.preparation, "Cache verifier preparation", MAX_CACHE_PREPARATION_BYTES);
  const definition2 = boundedDefinition(options.definition, "Cache verifier definition", MAX_CACHE_DEFINITION_BYTES);
  if (typeof options.verify !== "function") {
    throw new TypeError("Cache verifier verify must be a function.");
  }
  const verifier = {
    preparation,
    definitionSha256: sha2564(definition2),
    verify: options.verify,
    [cacheVerifierBrand]: true
  };
  Object.defineProperty(verifier, cacheVerifierBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
  Object.freeze(verifier);
  cacheVerifierRegistration.set(verifier, cacheRegistrationKey(verifier.preparation, verifier.definitionSha256));
  return verifier;
}
function createKnowledgeBaseEvaluationFourReaderOpenerV2(options) {
  const id = boundedDefinition(options.id, "Four-reader opener id", 512);
  if (/\r|\n/u.test(id) || id.normalize("NFC") !== id || id.trim() !== id) {
    throw new TypeError("Four-reader opener id must be a trimmed NFC single line.");
  }
  const definition2 = boundedDefinition(options.definition, "Four-reader opener definition", MAX_CACHE_DEFINITION_BYTES);
  if (typeof options.open !== "function") {
    throw new TypeError("Four-reader opener open must be a function.");
  }
  const opener = {
    id,
    definitionSha256: sha2564(definition2),
    open: options.open,
    [fourReaderOpenerBrand]: true
  };
  Object.defineProperty(opener, fourReaderOpenerBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
  Object.freeze(opener);
  fourReaderOpenerRegistration.set(opener, fourReaderOpenerRegistrationKey(opener.id, opener.definitionSha256));
  return opener;
}
function assertRegisteredCacheVerifier(verifier, corpus) {
  if (verifier === null || typeof verifier !== "object" || verifier[cacheVerifierBrand] !== true || cacheVerifierRegistration.get(verifier) !== cacheRegistrationKey(verifier.preparation, verifier.definitionSha256))
    throw new TypeError("Evaluation cache verifier is not a registered capability.");
  const sealed = corpus.experiment.environment.cache;
  if (verifier.preparation !== sealed.preparation || verifier.definitionSha256 !== sealed.fingerprintSha256) {
    throw new TypeError("Evaluation cache verifier does not match the sealed preparation and definition digest.");
  }
}
function assertRegisteredFourReaderOpener(opener, corpus) {
  if (opener === null || typeof opener !== "object" || opener[fourReaderOpenerBrand] !== true || fourReaderOpenerRegistration.get(opener) !== fourReaderOpenerRegistrationKey(opener.id, opener.definitionSha256))
    throw new TypeError("Evaluation four-reader opener is not a registered capability.");
  const sealed = corpus.experiment.environment.fourReaderBatch;
  if (opener.id !== sealed.id || opener.definitionSha256 !== sealed.sha256) {
    throw new TypeError("Evaluation four-reader opener does not match the sealed batch identity and definition digest.");
  }
}
function throwIfAborted3(signal) {
  if (signal.aborted)
    throw signal.reason ?? new Error("Evaluation execution was aborted.");
}
function finiteDuration(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("Evaluation packing duration must be non-negative and finite.");
  }
  return value;
}
function profileFor(corpus, profileId) {
  const profile = corpus.measurementProfiles.find(({ id }) => id === profileId);
  if (profile === undefined)
    throw new TypeError(`Evaluation profile ${profileId} is not sealed by the corpus.`);
  return profile;
}
function assertRepetition(profile, repetition) {
  if (!Number.isSafeInteger(repetition) || repetition < 1 || repetition > profile.repetitions) {
    throw new TypeError(`Evaluation repetition is outside profile ${profile.id}.`);
  }
}
function assertPackingContract(contract, corpus) {
  const sealed = corpus.experiment;
  if (contract.suiteSha256 !== corpus.manifest.corpusSha256 || contract.tokenizer.id !== sealed.environment.tokenizer.id || contract.tokenizer.sha256 !== sealed.environment.tokenizer.sha256 || contract.contextCeilings.utf8Bytes !== sealed.protocol.contextCeilings.utf8Bytes || contract.contextCeilings.readerTokens !== sealed.protocol.contextCeilings.readerTokens)
    throw new TypeError("Packing request does not match the sealed corpus contract.");
}
async function closePartialEvaluations(evaluations, openingFailure) {
  const settlements = await Promise.allSettled(evaluations.map((evaluation) => Promise.resolve().then(() => Reflect.apply(evaluation.close, evaluation, []))));
  const closeFailures = [];
  for (const result of settlements) {
    if (result.status === "rejected")
      closeFailures.push(result.reason);
  }
  if (closeFailures.length > 0) {
    throw new AggregateError([openingFailure, ...closeFailures], "Four-reader evaluation opening failed and partial sessions did not close cleanly.", { cause: openingFailure });
  }
  throw openingFailure;
}
function createKnowledgeBaseEvaluationRunnerV2Dependencies(options) {
  const corpus = parseRetrievalEvaluationCorpusV2(options.corpus, { claimPromotion: false });
  validateEvaluationEvidenceRegistry(options.evidenceRegistry);
  if (typeof options.measureRetrieverOperation !== "function") {
    throw new TypeError("Evaluation retriever operation measurer must be a function.");
  }
  if (options.tokenizer === null || typeof options.tokenizer !== "object" || options.tokenizer.id !== corpus.experiment.environment.tokenizer.id || options.tokenizer.sha256 !== corpus.experiment.environment.tokenizer.sha256)
    throw new TypeError("Evaluation tokenizer does not match the sealed corpus.");
  assertRegisteredCacheVerifier(options.cacheVerifier, corpus);
  assertRegisteredFourReaderOpener(options.fourReaderOpener, corpus);
  const now = options.now ?? performance.now.bind(performance);
  if (typeof now !== "function")
    throw new TypeError("Evaluation clock must be a function.");
  const openedEvaluationSessions = new WeakSet;
  const verifyCapability = options.cacheVerifier.verify;
  const fourReaderOpenCapability = options.fourReaderOpener.open;
  const sealedCacheDigest = corpus.experiment.environment.cache.fingerprintSha256;
  const verifyCacheFingerprint = async (signal) => {
    throwIfAborted3(signal);
    assertRegisteredCacheVerifier(options.cacheVerifier, corpus);
    const observed = await verifyCapability(signal);
    throwIfAborted3(signal);
    if (observed !== sealedCacheDigest) {
      throw new TypeError("Live evaluation cache fingerprint drifted from the sealed definition digest.");
    }
    return observed;
  };
  const measureRetrieverOperation = async (input) => {
    throwIfAborted3(input.signal);
    if (input.corpus.manifest.corpusSha256 !== corpus.manifest.corpusSha256) {
      throw new TypeError("Retriever operation measurement does not match the bound sealed corpus.");
    }
    assertEvaluationRetrieverLockedV2(corpus, input.descriptor);
    const profile = profileFor(corpus, input.profile.id);
    if (profile.operation !== input.operation || JSON.stringify(profile) !== JSON.stringify(input.profile))
      throw new TypeError("Retriever operation measurement profile does not match the sealed corpus.");
    assertRepetition(profile, input.repetition);
    return options.measureRetrieverOperation(Object.freeze({
      ...input,
      corpus,
      profile
    }));
  };
  const pack = async (input) => {
    throwIfAborted3(input.signal);
    assertPackingContract(input.contract, corpus);
    assertEvaluationRetrieverLockedV2(corpus, input.descriptor);
    if (input.result.retrieverId !== input.descriptor.id) {
      throw new TypeError("Packing result does not match its sealed retriever descriptor.");
    }
    const profile = profileFor(corpus, input.profileId);
    if (profile.operation !== "packing") {
      throw new TypeError(`Evaluation profile ${profile.id} is not a packing profile.`);
    }
    assertRepetition(profile, input.repetition);
    if (!corpus.queries.some(({ id }) => id === input.queryId)) {
      throw new TypeError(`Evaluation query ${input.queryId} is not sealed by the corpus.`);
    }
    const startedAt = now();
    const packed = await packKnowledgeBaseEvaluationContextV2({
      corpus,
      result: input.result,
      evidenceRegistry: options.evidenceRegistry,
      tokenizer: options.tokenizer
    });
    throwIfAborted3(input.signal);
    const packedBytes = Buffer.from(packed.text, "utf8");
    if (packedBytes.byteLength !== packed.utf8Bytes || createHash7("sha256").update(packedBytes).digest("hex") !== packed.packedBytesSha256)
      throw new TypeError("Packed-context accounting does not match its exact returned bytes.");
    return Object.freeze({
      durationMs: finiteDuration(now() - startedAt),
      packedContext: Object.freeze({
        utf8Bytes: packed.utf8Bytes,
        readerTokens: packed.readerTokens
      }),
      includedEvidenceUnitIds: packed.includedEvidenceUnitIds,
      truncated: packed.truncated,
      packedBytesSha256: packed.packedBytesSha256
    });
  };
  const openFourReaderBatch = async (input) => {
    throwIfAborted3(input.signal);
    const profile = profileFor(corpus, input.profileId);
    if (profile.operation !== "four-reader-query" || profile.concurrency !== 4) {
      throw new TypeError(`Evaluation profile ${profile.id} is not a four-reader profile.`);
    }
    assertRepetition(profile, input.repetition);
    const evaluations = [];
    const currentSessions = new Set;
    try {
      for (let readerIndex = 0;readerIndex < 4; readerIndex += 1) {
        throwIfAborted3(input.signal);
        assertRegisteredFourReaderOpener(options.fourReaderOpener, corpus);
        const evaluation = await fourReaderOpenCapability(Object.freeze({
          suiteSha256: corpus.manifest.corpusSha256,
          batchIdentity: corpus.experiment.environment.fourReaderBatch,
          profileId: profile.id,
          repetition: input.repetition,
          readerIndex,
          signal: input.signal
        }));
        if (currentSessions.has(evaluation) || openedEvaluationSessions.has(evaluation)) {
          throw new TypeError("Four-reader evaluation opener returned a duplicate or reused session.");
        }
        evaluations.push(evaluation);
        currentSessions.add(evaluation);
        openedEvaluationSessions.add(evaluation);
        assertVerifiedKnowledgeBaseEvaluationV2(evaluation, corpus);
      }
      throwIfAborted3(input.signal);
    } catch (error) {
      return closePartialEvaluations(evaluations, error);
    }
    return Object.freeze({
      id: options.fourReaderOpener.id,
      sha256: options.fourReaderOpener.definitionSha256,
      evaluations: Object.freeze(evaluations),
      verifyCacheFingerprint
    });
  };
  const verifyWarmCacheFingerprint = async (input) => {
    const profile = profileFor(corpus, input.profileId);
    if (profile.operation !== input.operation) {
      throw new TypeError("Warm cache verification profile does not match the sealed operation.");
    }
    assertRepetition(profile, input.repetition);
    if (input.phase !== "before" && input.phase !== "after") {
      throw new TypeError("Warm cache verification phase is invalid.");
    }
    return verifyCacheFingerprint(input.signal);
  };
  return Object.freeze({
    measureRetrieverOperation,
    pack,
    openFourReaderBatch,
    verifyWarmCacheFingerprint,
    ...options.now === undefined ? {} : { now }
  });
}
// src/evaluation-kb-runner-v2.ts
var KNOWLEDGE_BASE_EVALUATION_MAX_SAMPLE_TIMEOUT_MS = 5 * 60000;
var MAX_ABORT_SETTLEMENT_MS = 5000;
var EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
function nonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError(`${label} must be non-negative and finite.`);
  return value;
}
function timeout(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > KNOWLEDGE_BASE_EVALUATION_MAX_SAMPLE_TIMEOUT_MS) {
    throw new TypeError(`timeoutMs must be an integer from 1 through ${KNOWLEDGE_BASE_EVALUATION_MAX_SAMPLE_TIMEOUT_MS}.`);
  }
  return value;
}
function message(error) {
  const source = error instanceof Error ? error.message : String(error);
  const normalized = source.replace(/[\0\r\n]+/gu, " ").trim() || "Unknown evaluation failure.";
  return Buffer.from(normalized, "utf8").subarray(0, 2000).toString("utf8");
}
function limit(descriptor) {
  const value = descriptor.configuration["retrieve-limit"] ?? descriptor.configuration["output-limit"] ?? descriptor.configuration.limit;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new TypeError(`Retriever ${descriptor.id} must declare a bounded retrieval limit.`);
  }
  return value;
}
function emptyTrace(descriptor) {
  return Object.freeze({
    laneOutcomes: Object.freeze(descriptor.lanes.toSorted().map((laneId) => Object.freeze({
      laneId,
      applicability: "skipped",
      status: "unavailable",
      reasonCodes: Object.freeze(["measurement-failed"]),
      rawRanking: Object.freeze([])
    }))),
    candidateDecisions: Object.freeze([])
  });
}
function zeroResources() {
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({ calls: 0, inputTokens: 0, durationMs: 0 }),
    packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
    peakRssBytes: 0,
    cacheBytes: 0
  });
}
async function bounded(options) {
  const controller = new AbortController;
  const startedAt = options.now();
  let timer;
  let timedOut = false;
  const running = Promise.resolve().then(() => options.operation(controller.signal));
  running.catch(() => {
    return;
  });
  const timeoutFailure = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      const timeoutError = new Error(`Evaluation sample exceeded ${options.timeoutMs} ms.`);
      controller.abort(timeoutError);
      reject(timeoutError);
    }, options.timeoutMs);
  });
  try {
    const value = await Promise.race([running, timeoutFailure]);
    return Object.freeze({
      status: "ok",
      value,
      elapsedMs: nonnegative(options.now() - startedAt, "elapsedMs")
    });
  } catch (error) {
    if (timedOut) {
      let settlementTimer;
      const settled = await Promise.race([
        running.then(async (value) => {
          await options.disposeTimedOutValue?.(value);
          return true;
        }, () => true),
        new Promise((resolve) => {
          settlementTimer = setTimeout(() => resolve(false), MAX_ABORT_SETTLEMENT_MS);
        })
      ]);
      if (settlementTimer !== undefined)
        clearTimeout(settlementTimer);
      if (!settled) {
        throw new Error(`Evaluation operation did not settle within ${MAX_ABORT_SETTLEMENT_MS} ms after abort.`, { cause: error });
      }
    }
    return Object.freeze({
      status: "failed",
      failure: Object.freeze({
        kind: timedOut ? "timeout" : "exception",
        message: message(error)
      }),
      elapsedMs: nonnegative(options.now() - startedAt, "elapsedMs")
    });
  } finally {
    if (timer !== undefined)
      clearTimeout(timer);
  }
}
function failedSample(options) {
  return Object.freeze({
    retrieverId: options.descriptor.id,
    profileId: options.profile.id,
    ...options.queryId === undefined ? {} : { queryId: options.queryId },
    repetition: options.repetition,
    ...options.concurrencyBatchIdentity === undefined ? {} : { concurrencyBatchIdentity: options.concurrencyBatchIdentity },
    status: "failed",
    timings: Object.freeze({
      elapsedMs: options.elapsedMs,
      indexMs: 0,
      updateMs: 0,
      queryMs: options.profile.scope === "query" ? options.elapsedMs : 0,
      packingMs: 0
    }),
    resources: zeroResources(),
    trace: emptyTrace(options.descriptor),
    rawEvidence: Object.freeze([]),
    failure: options.failure
  });
}
function validateProfiles(corpus) {
  for (const profile of corpus.measurementProfiles) {
    const retrieverScope = profile.operation === "cold-index" || profile.operation === "incremental-update";
    if (profile.scope === "retriever" !== retrieverScope) {
      throw new TypeError(`Profile ${profile.id} has the wrong scope for ${profile.operation}.`);
    }
    const expectedConcurrency = profile.operation === "four-reader-query" ? 4 : 1;
    if (profile.concurrency !== expectedConcurrency) {
      throw new TypeError(`Profile ${profile.id} must declare concurrency ${expectedConcurrency}.`);
    }
  }
}
function packingContract(corpus) {
  return Object.freeze({
    suiteSha256: corpus.manifest.corpusSha256,
    tokenizer: corpus.experiment.environment.tokenizer,
    contextCeilings: corpus.experiment.protocol.contextCeilings
  });
}
function compareSamples2(left, right) {
  return left.retrieverId.localeCompare(right.retrieverId) || left.profileId.localeCompare(right.profileId) || (left.queryId ?? "").localeCompare(right.queryId ?? "") || left.repetition - right.repetition;
}
function retrieversById(evaluation, corpus) {
  assertVerifiedKnowledgeBaseEvaluationV2(evaluation, corpus);
  const output = new Map(evaluation.retrievers.map((retriever) => [
    retriever.descriptor.id,
    retriever
  ]));
  if (output.size !== evaluation.retrievers.length || output.size !== corpus.retrievers.length || corpus.retrievers.some(({ id }) => !output.has(id)))
    throw new TypeError("Evaluation retrievers must match the sealed descriptor set exactly.");
  return output;
}
async function assertWarmCacheFingerprint(options) {
  if (options.profile.operation !== "packing" && options.profile.operation !== "warm-query") {
    throw new TypeError(`Profile ${options.profile.id} is not a primary warm-cache operation.`);
  }
  const measured = await bounded({
    timeoutMs: options.timeoutMs,
    now: options.dependencies.now ?? performance.now.bind(performance),
    operation: (signal) => options.dependencies.verifyWarmCacheFingerprint({
      profileId: options.profile.id,
      operation: options.profile.operation,
      repetition: options.repetition,
      phase: options.phase,
      signal
    })
  });
  if (measured.status === "failed") {
    throw new Error(`Warm cache fingerprint verification failed ${options.phase} ${options.profile.id}: ${measured.failure.message}`);
  }
  if (measured.value !== options.corpus.experiment.environment.cache.fingerprintSha256) {
    throw new TypeError(`Warm cache fingerprint drifted ${options.phase} profile ${options.profile.id}.`);
  }
}
function validateFourReaderBatch(batch, corpus) {
  const sealed = corpus.experiment.environment.fourReaderBatch;
  const candidateEvaluations = batch.evaluations;
  if (batch.id !== sealed.id || batch.sha256 !== sealed.sha256) {
    throw new TypeError("Four-reader batch implementation does not match the sealed identity.");
  }
  if (!Array.isArray(candidateEvaluations) || batch.evaluations.length !== 4 || new Set(batch.evaluations).size !== 4)
    throw new TypeError("Four-reader measurement requires four distinct verified evaluations.");
  if (typeof batch.verifyCacheFingerprint !== "function") {
    throw new TypeError("Four-reader batch must expose cache fingerprint verification.");
  }
  return Object.freeze(batch.evaluations.map((evaluation) => retrieversById(evaluation, corpus)));
}
async function assertFourReaderCacheFingerprint(options) {
  const measured = await bounded({
    timeoutMs: options.timeoutMs,
    now: options.now,
    operation: options.batch.verifyCacheFingerprint
  });
  if (measured.status === "failed") {
    throw new Error(`Four-reader cache verification failed ${options.phase}: ${measured.failure.message}`);
  }
  if (measured.value !== options.corpus.experiment.environment.cache.fingerprintSha256) {
    throw new TypeError(`Four-reader cache fingerprint drifted ${options.phase} measurement.`);
  }
}
async function closeFourReaderBatch(batch) {
  const evaluations = Array.isArray(batch?.evaluations) ? batch.evaluations : [];
  const closers = evaluations.flatMap((evaluation) => {
    if (evaluation === null || typeof evaluation !== "object")
      return [];
    const candidate = evaluation;
    if (typeof candidate.close !== "function")
      return [];
    const closeable = candidate;
    return [async () => {
      await closeable.close();
    }];
  });
  const settlements = await Promise.allSettled(closers.map((close) => Promise.resolve().then(close)));
  const failures = settlements.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(failures.map((failure) => {
      const reason = failure.reason;
      return reason;
    }), "Four-reader evaluation sessions did not close cleanly.");
  }
}
async function simultaneousQuerySamples(options) {
  if (options.queries.length !== 4 || options.retrievers.length !== 4) {
    throw new TypeError("Four-reader query batches must contain exactly four queries and readers.");
  }
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const pending = options.queries.map(async (query, index) => {
    await barrier;
    const retriever = options.retrievers[index];
    if (retriever === undefined)
      throw new TypeError("Four-reader batch lost a reader.");
    return querySample({
      corpus: options.corpus,
      descriptor: options.descriptor,
      profile: options.profile,
      query,
      repetition: options.repetition,
      retriever,
      timeoutMs: options.timeoutMs,
      dependencies: options.dependencies
    });
  });
  release?.();
  return Object.freeze(await Promise.all(pending));
}
async function querySample(options) {
  const concurrencyBatchIdentity = options.profile.operation === "four-reader-query" ? options.corpus.experiment.environment.fourReaderBatch.id : undefined;
  const measured = await bounded({
    timeoutMs: options.timeoutMs,
    now: options.dependencies.now ?? performance.now.bind(performance),
    operation: async (signal) => {
      const now = options.dependencies.now ?? performance.now.bind(performance);
      const queryStartedAt = now();
      const result2 = await options.retriever.retrieve(createEvaluationExecutionRequestV2({
        corpus: options.corpus,
        query: options.query,
        descriptor: options.descriptor,
        limit: limit(options.descriptor),
        signal
      }));
      const queryElapsedMs2 = nonnegative(now() - queryStartedAt, "query elapsedMs");
      if (options.profile.operation !== "packing") {
        return { result: result2, queryElapsedMs: queryElapsedMs2, packingElapsedMs: 0 };
      }
      if (result2.status === "unavailable") {
        return {
          result: result2,
          queryElapsedMs: queryElapsedMs2,
          packingElapsedMs: 0,
          packing: Object.freeze({
            durationMs: 0,
            packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
            includedEvidenceUnitIds: Object.freeze([]),
            truncated: false,
            packedBytesSha256: EMPTY_SHA256
          })
        };
      }
      const packingStartedAt = now();
      const packing2 = await options.dependencies.pack({
        contract: packingContract(options.corpus),
        descriptor: options.descriptor,
        profileId: options.profile.id,
        queryId: options.query.id,
        result: result2,
        repetition: options.repetition,
        signal
      });
      const packingElapsedMs2 = nonnegative(now() - packingStartedAt, "packing elapsedMs");
      return { result: result2, packing: packing2, queryElapsedMs: queryElapsedMs2, packingElapsedMs: packingElapsedMs2 };
    }
  });
  if (measured.status === "failed") {
    return failedSample({
      descriptor: options.descriptor,
      profile: options.profile,
      queryId: options.query.id,
      repetition: options.repetition,
      elapsedMs: measured.elapsedMs,
      failure: measured.failure,
      ...concurrencyBatchIdentity === undefined ? {} : { concurrencyBatchIdentity }
    });
  }
  const { result, packing, queryElapsedMs, packingElapsedMs } = measured.value;
  return createKnowledgeBaseEvaluationRepeatedSampleV2({
    result,
    profileId: options.profile.id,
    queryId: options.query.id,
    repetition: options.repetition,
    timings: {
      elapsedMs: measured.elapsedMs,
      queryMs: queryElapsedMs,
      packingMs: packingElapsedMs
    },
    ...concurrencyBatchIdentity === undefined ? {} : { concurrencyBatchIdentity },
    ...packing === undefined ? {} : {
      packedContext: packing.packedContext,
      packedContextTrace: {
        evidenceUnitIds: packing.includedEvidenceUnitIds,
        truncated: packing.truncated,
        packedBytesSha256: packing.packedBytesSha256
      }
    }
  });
}
async function retrieverSample(options) {
  if (options.profile.operation !== "cold-index" && options.profile.operation !== "incremental-update") {
    throw new TypeError(`Retriever-scope profile ${options.profile.id} has an unsupported operation.`);
  }
  const measured = await bounded({
    timeoutMs: options.timeoutMs,
    now: options.dependencies.now ?? performance.now.bind(performance),
    operation: (signal) => options.dependencies.measureRetrieverOperation({
      operation: options.profile.operation,
      corpus: options.corpus,
      descriptor: options.descriptor,
      profile: options.profile,
      repetition: options.repetition,
      signal
    })
  });
  if (measured.status === "failed") {
    return failedSample({
      descriptor: options.descriptor,
      profile: options.profile,
      repetition: options.repetition,
      elapsedMs: measured.elapsedMs,
      failure: measured.failure
    });
  }
  const sample = measured.value;
  return Object.freeze({
    retrieverId: options.descriptor.id,
    profileId: options.profile.id,
    repetition: options.repetition,
    status: sample.status,
    timings: sample.timings,
    resources: sample.resources,
    trace: sample.trace,
    rawEvidence: Object.freeze([]),
    ...sample.failure === undefined ? {} : { failure: sample.failure }
  });
}
async function runKnowledgeBaseEvaluationV2(options) {
  const timeoutMs = timeout(options.timeoutMs);
  const corpus = options.split === "development" ? parseRetrievalEvaluationCorpusV2(options.corpus, { claimPromotion: false }) : options.promotionSeal === undefined ? (() => {
    throw new TypeError("Held-out or all-split evaluation requires the independent promotion seal.");
  })() : validatePromotionCorpusV2(options.corpus, options.promotionSeal);
  const now = options.dependencies.now ?? performance.now.bind(performance);
  validateProfiles(corpus);
  const queries = corpus.queries.filter(({ split }) => options.split === "all" || split === options.split).toSorted((left, right) => left.id.localeCompare(right.id));
  const retrieverById = retrieversById(options.evaluation, corpus);
  const descriptors = corpus.retrievers.toSorted((left, right) => left.id.localeCompare(right.id));
  const samples = [];
  for (const profile of corpus.measurementProfiles.toSorted((left, right) => left.id.localeCompare(right.id))) {
    if (profile.scope === "retriever") {
      for (let repetition = 1;repetition <= profile.repetitions; repetition += 1) {
        for (const descriptor of descriptors) {
          samples.push(await retrieverSample({
            corpus,
            descriptor,
            profile,
            repetition,
            timeoutMs,
            dependencies: options.dependencies
          }));
        }
      }
      continue;
    }
    if (profile.operation === "four-reader-query") {
      if (queries.length % profile.concurrency !== 0) {
        throw new TypeError(`Four-reader profile ${profile.id} requires complete batches of ${profile.concurrency}.`);
      }
      for (let repetition = 1;repetition <= profile.repetitions; repetition += 1) {
        const opened = await bounded({
          timeoutMs,
          now,
          disposeTimedOutValue: closeFourReaderBatch,
          operation: (signal) => options.dependencies.openFourReaderBatch({
            profileId: profile.id,
            repetition,
            signal
          })
        });
        if (opened.status === "failed") {
          for (const descriptor of descriptors) {
            for (const query of queries) {
              samples.push(failedSample({
                descriptor,
                profile,
                queryId: query.id,
                repetition,
                elapsedMs: opened.elapsedMs,
                failure: opened.failure,
                concurrencyBatchIdentity: corpus.experiment.environment.fourReaderBatch.id
              }));
            }
          }
          continue;
        }
        const batch = opened.value;
        try {
          const readerMaps = validateFourReaderBatch(batch, corpus);
          await assertFourReaderCacheFingerprint({
            batch,
            corpus,
            timeoutMs,
            now,
            phase: "before"
          });
          for (const descriptor of descriptors) {
            const readers = readerMaps.map((map) => {
              const retriever = map.get(descriptor.id);
              if (retriever === undefined) {
                throw new TypeError(`Four-reader evaluation is missing ${descriptor.id}.`);
              }
              return retriever;
            });
            for (let index = 0;index < queries.length; index += profile.concurrency) {
              samples.push(...await simultaneousQuerySamples({
                corpus,
                descriptor,
                profile,
                queries: queries.slice(index, index + profile.concurrency),
                retrievers: readers,
                repetition,
                timeoutMs,
                dependencies: options.dependencies
              }));
            }
          }
          await assertFourReaderCacheFingerprint({
            batch,
            corpus,
            timeoutMs,
            now,
            phase: "after"
          });
        } finally {
          await closeFourReaderBatch(batch);
        }
      }
      continue;
    }
    if (profile.operation !== "packing" && profile.operation !== "warm-query") {
      throw new TypeError(`Query profile ${profile.id} has an unsupported operation.`);
    }
    for (let repetition = 1;repetition <= profile.repetitions; repetition += 1) {
      await assertWarmCacheFingerprint({
        corpus,
        dependencies: options.dependencies,
        profile,
        repetition,
        phase: "before",
        timeoutMs
      });
      for (const descriptor of descriptors) {
        const retriever = retrieverById.get(descriptor.id);
        if (retriever === undefined)
          throw new TypeError(`Evaluation retriever ${descriptor.id} is missing.`);
        for (const query of queries) {
          samples.push(await querySample({
            corpus,
            descriptor,
            profile,
            query,
            repetition,
            retriever,
            timeoutMs,
            dependencies: options.dependencies
          }));
        }
      }
      await assertWarmCacheFingerprint({
        corpus,
        dependencies: options.dependencies,
        profile,
        repetition,
        phase: "after",
        timeoutMs
      });
    }
  }
  const report = Object.freeze({
    schemaVersion: 2,
    suiteSha256: corpus.manifest.corpusSha256,
    candidateLockSha256: corpus.manifest.candidateLockSha256,
    split: options.split,
    samples: Object.freeze(samples.toSorted(compareSamples2))
  });
  return parseRetrievalEvaluationReportV2(report, corpus);
}
// src/evaluation-measurement-v2.ts
import { createHash as createHash8, randomUUID } from "crypto";
import { spawn } from "child_process";
import { constants } from "fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";
var CHILD_ARGUMENT = "--kb-evaluation-measurement-child-v2";
var PROTOCOL = "kb-evaluation-measurement-child-v2";
var PROTOCOL_VERSION = 1;
var WORK_DIRECTORY_PREFIX = "hraness-kb-evaluation-measurement-";
var PREPARATION_MARKER = ".incremental-prepared-v2.json";
var DEFAULT_TIMEOUT_MS = 10 * 60000;
var MAX_TIMEOUT_MS = 30 * 60000;
var MAX_PROTOCOL_BYTES = 64 * 1024;
var MAX_STDERR_BYTES = 256 * 1024;
var MAX_CACHE_ENTRIES = 1e5;
var MAX_MUTATION_BYTES = 64 * 1024;
var MAX_PATH_BYTES = 4 * 1024;
var qmdLanes = new Set(["hybrid", "keyword", "semantic"]);
var sha256Pattern2 = /^[0-9a-f]{64}$/u;
var objectIdPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
var requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function record3(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}
function exactKeys2(value, required, optional, label) {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  const missing = required.filter((key) => !(key in value));
  const extra = actual.filter((key) => !allowed.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new TypeError(`${label} has an invalid field set.`);
  }
}
function boundedString3(value, label, maximumBytes = MAX_PATH_BYTES) {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/u.test(value) || Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new TypeError(`${label} must be a bounded non-empty string.`);
  }
  return value;
}
function absolutePath(value, label) {
  const path = boundedString3(value, label);
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new TypeError(`${label} must be an absolute normalized path.`);
  }
  return path;
}
function nonnegativeInteger2(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}
function positiveInteger(value, label) {
  const parsed = nonnegativeInteger2(value, label);
  if (parsed === 0)
    throw new TypeError(`${label} must be positive.`);
  return parsed;
}
function nonnegativeNumber3(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be non-negative and finite.`);
  }
  return value;
}
function confinedPath6(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}
function notePath(value, label) {
  const path = boundedString3(value, label);
  if (path !== path.normalize("NFC") || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..") || !path.endsWith(".md")) {
    throw new TypeError(`${label} must be a confined NFC Markdown path.`);
  }
  return path;
}
function evaluationIncrementalMutationSha256V2(mutation) {
  return createHash8("sha256").update("kb-evaluation-incremental-mutation-v2\x00").update(mutation.sourcePath).update("\x00").update(mutation.appendText).update("\x00").update(mutation.expectedPostMutationSha256).digest("hex");
}
function parseMutation(value, label) {
  const input = record3(value, label);
  exactKeys2(input, ["appendText", "expectedPostMutationSha256", "sha256", "sourcePath"], [], label);
  const sourcePath = notePath(input.sourcePath, `${label}.sourcePath`);
  if (sourcePath === "index.md" || basename(sourcePath) === "AGENTS.md") {
    throw new TypeError(`${label}.sourcePath must identify an indexed content note.`);
  }
  if (typeof input.appendText !== "string" || !input.appendText.startsWith(`
`) || !input.appendText.endsWith(`
`) || input.appendText.includes("\x00") || input.appendText.includes("\r") || Buffer.byteLength(input.appendText, "utf8") > MAX_MUTATION_BYTES) {
    throw new TypeError(`${label}.appendText must be bounded LF-delimited UTF-8 text.`);
  }
  if (typeof input.sha256 !== "string" || !sha256Pattern2.test(input.sha256)) {
    throw new TypeError(`${label}.sha256 must be a lowercase SHA-256 digest.`);
  }
  if (typeof input.expectedPostMutationSha256 !== "string" || !sha256Pattern2.test(input.expectedPostMutationSha256)) {
    throw new TypeError(`${label}.expectedPostMutationSha256 must be a lowercase SHA-256 digest.`);
  }
  const parsed = Object.freeze({
    sourcePath,
    appendText: input.appendText,
    expectedPostMutationSha256: input.expectedPostMutationSha256,
    sha256: input.sha256
  });
  if (evaluationIncrementalMutationSha256V2(parsed) !== parsed.sha256) {
    throw new TypeError(`${label}.sha256 does not bind the declared mutation.`);
  }
  return parsed;
}
function parseFrozen(value, label) {
  const input = record3(value, label);
  exactKeys2(input, ["repositoryCommit", "vaultRoot", "vaultTree"], [], label);
  if (typeof input.repositoryCommit !== "string" || !objectIdPattern.test(input.repositoryCommit)) {
    throw new TypeError(`${label}.repositoryCommit is invalid.`);
  }
  if (typeof input.vaultTree !== "string" || !objectIdPattern.test(input.vaultTree)) {
    throw new TypeError(`${label}.vaultTree is invalid.`);
  }
  if (typeof input.vaultRoot !== "string" || input.vaultRoot.length === 0 || /[\0\r\n]/u.test(input.vaultRoot) || input.vaultRoot !== input.vaultRoot.normalize("NFC") || input.vaultRoot.startsWith("/") || input.vaultRoot.includes("\\") || input.vaultRoot !== "." && input.vaultRoot.split("/").some((part) => part === "" || part === "." || part === "..") || Buffer.byteLength(input.vaultRoot, "utf8") > MAX_PATH_BYTES) {
    throw new TypeError(`${label}.vaultRoot must be a confined NFC path.`);
  }
  const vaultRoot = input.vaultRoot;
  return Object.freeze({
    repositoryCommit: input.repositoryCommit,
    vaultTree: input.vaultTree,
    vaultRoot
  });
}
function parsePhase(value) {
  if (value !== "cold-index" && value !== "incremental-prepare" && value !== "incremental-update") {
    throw new TypeError("measurement child phase is invalid.");
  }
  return value;
}
function parseChildRequest(value) {
  const input = record3(value, "measurement child request");
  exactKeys2(input, [
    "embeddingModelFile",
    "frozen",
    "kind",
    "phase",
    "protocol",
    "repository",
    "requestId",
    "root",
    "version",
    "workRoot"
  ], ["mutation"], "measurement child request");
  if (input.protocol !== PROTOCOL || input.version !== PROTOCOL_VERSION || input.kind !== "request") {
    throw new TypeError("measurement child protocol identity is invalid.");
  }
  if (typeof input.requestId !== "string" || !requestIdPattern.test(input.requestId)) {
    throw new TypeError("measurement child requestId is invalid.");
  }
  const phase = parsePhase(input.phase);
  const mutation = input.mutation === undefined ? undefined : parseMutation(input.mutation, "mutation");
  if (phase === "cold-index" !== (mutation === undefined)) {
    throw new TypeError("measurement child mutation presence does not match its phase.");
  }
  return Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "request",
    requestId: input.requestId,
    phase,
    repository: absolutePath(input.repository, "repository"),
    root: absolutePath(input.root, "root"),
    frozen: parseFrozen(input.frozen, "frozen"),
    embeddingModelFile: absolutePath(input.embeddingModelFile, "embeddingModelFile"),
    workRoot: absolutePath(input.workRoot, "workRoot"),
    ...mutation === undefined ? {} : { mutation }
  });
}
function workIdentities(workRoot) {
  return Object.freeze({
    workRoot,
    vault: join(workRoot, "vault"),
    cache: join(workRoot, "cache"),
    database: join(workRoot, "cache", "qmd.sqlite"),
    xdgCache: join(workRoot, "cache", "xdg"),
    marker: join(workRoot, PREPARATION_MARKER),
    forbiddenGenerateModel: join(workRoot, ".generative-llm-forbidden.gguf"),
    forbiddenRerankModel: join(workRoot, ".reranker-llm-forbidden.gguf")
  });
}
async function validatedWorkIdentities(workRoot) {
  const metadata = await lstat(workRoot);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new TypeError("measurement work root must be a real directory.");
  }
  const canonical = await realpath(workRoot);
  if (canonical !== workRoot || !basename(workRoot).startsWith(WORK_DIRECTORY_PREFIX)) {
    throw new TypeError("measurement work root identity is invalid.");
  }
  return workIdentities(workRoot);
}
async function validateIsolatedDirectory(path, label) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || await realpath(path) !== path) {
    throw new TypeError(`${label} must be a canonical non-symlink directory.`);
  }
}
async function validateWorkLayout(identities, phase) {
  const names = (await readdir(identities.workRoot)).toSorted();
  if (phase === "cold-index" || phase === "incremental-prepare") {
    if (names.length !== 0) {
      throw new TypeError("cold measurement work root must be empty.");
    }
    return;
  }
  const expected = [PREPARATION_MARKER, "cache", "vault"].toSorted();
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    throw new TypeError("incremental measurement work root has an invalid layout.");
  }
}
function fileErrorCode(error) {
  if (error === null || typeof error !== "object" || !("code" in error))
    return;
  return typeof error.code === "string" ? error.code : undefined;
}
async function requireAbsent(path, label) {
  try {
    await lstat(path);
  } catch (error) {
    if (fileErrorCode(error) === "ENOENT")
      return;
    throw error;
  }
  throw new TypeError(`${label} must remain absent.`);
}
function snapshotSha256(frozen) {
  return createHash8("sha256").update(`${frozen.repositoryCommit}\x00${frozen.vaultTree}\x00${frozen.vaultRoot}`).digest("hex");
}
function vaultManifestSha256(notes) {
  const hash = createHash8("sha256").update("kb-evaluation-materialized-vault-v2\x00");
  for (const note of notes.toSorted((left, right) => left.path.localeCompare(right.path))) {
    hash.update(note.path).update("\x00");
    hash.update(createHash8("sha256").update(note.content).digest("hex")).update("\x00");
  }
  return hash.digest("hex");
}
function indexedDocumentCount(notes) {
  return notes.filter(({ path }) => path !== "index.md" && basename(path) !== "AGENTS.md").length;
}
async function materializeVault(root, notes) {
  await mkdir(root, { mode: 448 });
  const seen = new Set;
  for (const note of notes.toSorted((left, right) => left.path.localeCompare(right.path))) {
    const path = notePath(note.path, "snapshot note path");
    if (seen.has(path))
      throw new TypeError("snapshot note paths must be unique.");
    seen.add(path);
    const destination = resolve(root, path);
    if (!confinedPath6(root, destination) || destination === root) {
      throw new TypeError("snapshot note escaped the materialized vault.");
    }
    await mkdir(dirname(destination), { recursive: true, mode: 448 });
    await writeFile(destination, note.content, { encoding: "utf8", flag: "wx", mode: 384 });
  }
}
function validateIndexResult(result, phase, documentCount) {
  if (result.model !== recommendedEmbeddingModel) {
    throw new TypeError("semantic indexing returned the wrong model identity.");
  }
  const update = result.update;
  for (const [key, value] of Object.entries(update))
    nonnegativeInteger2(value, `semantic update.${key}`);
  if (update.collections !== 1 || update.removed !== 0 || result.embedding === null) {
    throw new TypeError("semantic indexing did not satisfy the measured generation invariant.");
  }
  const embedding = result.embedding;
  nonnegativeInteger2(embedding.docsProcessed, "semantic embedding.docsProcessed");
  nonnegativeInteger2(embedding.chunksEmbedded, "semantic embedding.chunksEmbedded");
  nonnegativeInteger2(embedding.errors, "semantic embedding.errors");
  nonnegativeNumber3(embedding.durationMs, "semantic embedding.durationMs");
  if (embedding.errors !== 0 || (embedding.failures?.length ?? 0) !== 0 || embedding.chunksEmbedded < embedding.docsProcessed) {
    throw new TypeError("semantic embedding did not complete cleanly.");
  }
  if (phase === "cold-index" || phase === "incremental-prepare") {
    if (documentCount < 1 || update.indexed !== documentCount || update.updated !== 0 || update.unchanged !== 0 || update.needsEmbedding !== documentCount || embedding.docsProcessed !== documentCount) {
      throw new TypeError("cold semantic indexing counts violate the exact corpus invariant.");
    }
    return;
  }
  if (update.indexed !== 0 || update.updated !== 1 || update.unchanged !== documentCount - 1 || update.needsEmbedding !== 1 || embedding.docsProcessed !== 1) {
    throw new TypeError("incremental semantic indexing counts violate the exact one-note invariant.");
  }
}
function defaultPeakRssBytes() {
  const current = process.memoryUsage().rss;
  const reported = process.resourceUsage().maxRSS;
  if (!Number.isSafeInteger(current) || current < 1 || !Number.isSafeInteger(reported) || reported < 1) {
    throw new TypeError("runtime peak RSS accounting is unavailable.");
  }
  const normalized = reported >= current ? reported : reported * 1024;
  if (!Number.isSafeInteger(normalized) || normalized < current) {
    throw new TypeError("runtime peak RSS accounting is invalid.");
  }
  return normalized;
}
async function digestEvaluationCacheFile(path) {
  const pathBefore = await lstat(path);
  if (pathBefore.isSymbolicLink() || !pathBefore.isFile() || pathBefore.nlink !== 1) {
    throw new TypeError("evaluation cache files must be regular and singly linked.");
  }
  if (!Number.isSafeInteger(pathBefore.size) || pathBefore.size < 0) {
    throw new RangeError("evaluation cache file size is invalid.");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.dev !== pathBefore.dev || before.ino !== pathBefore.ino || before.size !== pathBefore.size) {
      throw new TypeError("evaluation cache file identity changed before it was read.");
    }
    const hash = createHash8("sha256");
    const buffer = new Uint8Array(1024 * 1024);
    let observed = 0;
    for (;; ) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0)
        break;
      observed += bytesRead;
      if (!Number.isSafeInteger(observed)) {
        throw new RangeError("evaluation cache file byte count overflowed.");
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const pathAfter = await lstat(path);
    if (!after.isFile() || after.nlink !== 1 || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || observed !== before.size || pathAfter.isSymbolicLink() || !pathAfter.isFile() || pathAfter.nlink !== 1 || pathAfter.dev !== before.dev || pathAfter.ino !== before.ino || pathAfter.size !== before.size) {
      throw new Error("evaluation cache file changed while it was measured.");
    }
    return Object.freeze({ bytes: observed, sha256: hash.digest("hex") });
  } finally {
    await handle.close();
  }
}
async function measureEvaluationCacheManifestV2(root) {
  const requestedRoot = resolve(root);
  const rootMetadata = await lstat(requestedRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new TypeError("evaluation cache root must be a non-symlink directory.");
  }
  const canonicalRoot = await realpath(requestedRoot);
  const entries = [];
  let bytes = 0;
  const pending = [canonicalRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined)
      break;
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entries.length >= MAX_CACHE_ENTRIES)
        throw new RangeError("evaluation cache has too many entries.");
      const path = join(directory, child.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink())
        throw new TypeError("evaluation cache must not contain symbolic links.");
      if (metadata.isDirectory()) {
        entries.push({ kind: "directory", path });
        pending.push(path);
        continue;
      }
      if (!metadata.isFile())
        throw new TypeError("evaluation cache must contain only regular files.");
      if (metadata.nlink !== 1)
        throw new TypeError("evaluation cache files must be singly linked.");
      entries.push({ kind: "file", path });
    }
  }
  const hash = createHash8("sha256").update("kb-evaluation-cache-manifest-v2\x00");
  for (const entry of entries.toSorted((left, right) => left.path.localeCompare(right.path))) {
    const relativePath = relative(canonicalRoot, entry.path).split(sep).join("/");
    hash.update(entry.kind).update("\x00").update(relativePath).update("\x00");
    if (entry.kind === "directory")
      continue;
    const file = await digestEvaluationCacheFile(entry.path);
    bytes += file.bytes;
    if (!Number.isSafeInteger(bytes))
      throw new RangeError("evaluation cache byte count overflowed.");
    hash.update(String(file.bytes)).update("\x00").update(file.sha256).update("\x00");
  }
  return Object.freeze({ bytes, sha256: hash.digest("hex") });
}
async function measureEvaluationCacheBytesV2(root) {
  return (await measureEvaluationCacheManifestV2(root)).bytes;
}
async function defaultVerifyFrozenSnapshot(request) {
  const corpus = { frozen: request.frozen };
  await verifyFrozenEvaluationSnapshot({
    repository: request.repository,
    root: request.root,
    corpus
  });
}
async function scan(root, dependencies) {
  return await (dependencies.scanVault ?? ((path) => scanVault(path, { mentionScope: false })))(root);
}
async function readPreparationMarker(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1 || metadata.size > MAX_PROTOCOL_BYTES) {
    throw new TypeError("incremental preparation marker is invalid.");
  }
  const input = record3(JSON.parse(await readFile(path, "utf8")), "incremental preparation marker");
  exactKeys2(input, [
    "cacheManifestSha256",
    "documentCount",
    "kind",
    "mutationSha256",
    "protocol",
    "requestId",
    "snapshotSha256",
    "sourcePath",
    "vaultManifestSha256",
    "version"
  ], [], "incremental preparation marker");
  if (input.protocol !== PROTOCOL || input.version !== PROTOCOL_VERSION || input.kind !== "incremental-prepared" || typeof input.requestId !== "string" || !requestIdPattern.test(input.requestId) || typeof input.snapshotSha256 !== "string" || !sha256Pattern2.test(input.snapshotSha256) || typeof input.mutationSha256 !== "string" || !sha256Pattern2.test(input.mutationSha256) || typeof input.cacheManifestSha256 !== "string" || !sha256Pattern2.test(input.cacheManifestSha256) || typeof input.vaultManifestSha256 !== "string" || !sha256Pattern2.test(input.vaultManifestSha256)) {
    throw new TypeError("incremental preparation marker identity is invalid.");
  }
  return Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "incremental-prepared",
    requestId: input.requestId,
    snapshotSha256: input.snapshotSha256,
    mutationSha256: input.mutationSha256,
    sourcePath: notePath(input.sourcePath, "incremental preparation marker.sourcePath"),
    documentCount: positiveInteger(input.documentCount, "incremental preparation marker.documentCount"),
    cacheManifestSha256: input.cacheManifestSha256,
    vaultManifestSha256: input.vaultManifestSha256
  });
}
async function prepareIncrementalMutation(request, identities, notes, documentCount, dependencies) {
  const mutation = request.mutation;
  if (mutation === undefined)
    throw new TypeError("incremental preparation requires a mutation.");
  const source = notes.find(({ path }) => path === mutation.sourcePath);
  if (source === undefined)
    throw new TypeError("incremental mutation source is absent from the frozen vault.");
  const sourceFile = resolve(identities.vault, mutation.sourcePath);
  if (!confinedPath6(identities.vault, sourceFile))
    throw new TypeError("incremental mutation escaped the vault.");
  const metadata = await lstat(sourceFile);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    throw new TypeError("incremental mutation source must be a regular singly linked file.");
  }
  const changedContent = `${source.content}${mutation.appendText}`;
  if (createHash8("sha256").update(changedContent, "utf8").digest("hex") !== mutation.expectedPostMutationSha256) {
    throw new TypeError("incremental mutation does not produce its sealed post-mutation digest.");
  }
  await writeFile(sourceFile, changedContent, { encoding: "utf8", flag: "w" });
  const changed = await scan(identities.vault, dependencies);
  if (indexedDocumentCount(changed.notes) !== documentCount) {
    throw new TypeError("incremental mutation changed the indexed document set.");
  }
  const cacheManifest = await measureEvaluationCacheManifestV2(identities.cache);
  const marker = Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "incremental-prepared",
    requestId: request.requestId,
    snapshotSha256: snapshotSha256(request.frozen),
    mutationSha256: mutation.sha256,
    sourcePath: mutation.sourcePath,
    documentCount,
    cacheManifestSha256: cacheManifest.sha256,
    vaultManifestSha256: vaultManifestSha256(changed.notes)
  });
  await writeFile(identities.marker, JSON.stringify(marker), { encoding: "utf8", flag: "wx", mode: 384 });
}
function resourcesFor(result, peakRssBytes, cacheBytes) {
  const embedding = result.embedding;
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: embedding === null ? 0 : 1,
      inputTokens: 0,
      ...embedding === null ? {} : { inputTokensMeasured: false },
      durationMs: embedding?.durationMs ?? 0
    }),
    packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
    peakRssBytes,
    cacheBytes
  });
}
async function executeKnowledgeBaseEvaluationMeasurementChildV2(value, dependencies = {}) {
  const request = parseChildRequest(value);
  const identities = await validatedWorkIdentities(request.workRoot);
  const environment = dependencies.environment ?? process.env;
  if (environment.XDG_CACHE_HOME !== identities.xdgCache || environment.HF_HUB_OFFLINE !== "1" || environment.TRANSFORMERS_OFFLINE !== "1" || environment.GGML_METAL_NO_RESIDENCY !== "1" || environment.QMD_EMBED_PARALLELISM !== "1" || environment.QMD_LLAMA_GPU !== "auto" || environment.QMD_GENERATE_MODEL !== identities.forbiddenGenerateModel || environment.QMD_RERANK_MODEL !== identities.forbiddenRerankModel || environment.TMPDIR !== identities.workRoot || environment.TMP !== identities.workRoot || environment.TEMP !== identities.workRoot || environment.NODE_OPTIONS !== undefined || environment.BUN_OPTIONS !== undefined || environment.CI !== undefined || environment.QMD_FORCE_CPU !== undefined) {
    throw new TypeError("measurement child execution environment is not isolated and pinned.");
  }
  await requireAbsent(identities.forbiddenGenerateModel, "generative model guard");
  await requireAbsent(identities.forbiddenRerankModel, "reranker model guard");
  await validateWorkLayout(identities, request.phase);
  if (confinedPath6(identities.cache, request.embeddingModelFile)) {
    throw new TypeError("the pinned model file must be independent of the measured cache.");
  }
  const verify = dependencies.verifyFrozenSnapshot ?? defaultVerifyFrozenSnapshot;
  const index = dependencies.indexSemanticVault ?? indexSemanticVault;
  const now = dependencies.now ?? (() => performance.now());
  const cacheBytes = dependencies.measureCacheBytes ?? measureEvaluationCacheBytesV2;
  const peakRss = dependencies.peakRssBytes ?? defaultPeakRssBytes;
  let snapshot;
  let documentCount;
  if (request.phase === "cold-index" || request.phase === "incremental-prepare") {
    await verify({ repository: request.repository, root: request.root, frozen: request.frozen });
    snapshot = await scan(request.root, dependencies);
    documentCount = indexedDocumentCount(snapshot.notes);
    if (documentCount < 1)
      throw new TypeError("measurement vault must contain an indexed content note.");
    await materializeVault(identities.vault, snapshot.notes);
    await mkdir(identities.xdgCache, { recursive: true, mode: 448 });
  } else {
    await validateIsolatedDirectory(identities.vault, "incremental prepared vault");
    await validateIsolatedDirectory(identities.cache, "incremental prepared cache");
    await validateIsolatedDirectory(identities.xdgCache, "incremental prepared XDG cache");
    const marker = await readPreparationMarker(identities.marker);
    const mutation = request.mutation;
    if (mutation === undefined || marker.requestId !== request.requestId || marker.snapshotSha256 !== snapshotSha256(request.frozen) || marker.mutationSha256 !== mutation.sha256 || marker.sourcePath !== mutation.sourcePath) {
      throw new TypeError("incremental update does not match its prepared generation.");
    }
    snapshot = await scan(identities.vault, dependencies);
    documentCount = indexedDocumentCount(snapshot.notes);
    if (documentCount !== marker.documentCount || vaultManifestSha256(snapshot.notes) !== marker.vaultManifestSha256) {
      throw new TypeError("incremental prepared vault changed before measurement.");
    }
    const databaseMetadata = await lstat(identities.database);
    if (databaseMetadata.isSymbolicLink() || !databaseMetadata.isFile() || databaseMetadata.nlink !== 1) {
      throw new TypeError("incremental prepared database is absent or aliased.");
    }
    if ((await measureEvaluationCacheManifestV2(identities.cache)).sha256 !== marker.cacheManifestSha256) {
      throw new TypeError("incremental prepared cache changed before measurement.");
    }
  }
  const startedAt = now();
  const indexed = await index({
    root: identities.vault,
    database: identities.database,
    embeddingModelFile: request.embeddingModelFile
  });
  const elapsedMs = nonnegativeNumber3(now() - startedAt, "measurement elapsedMs");
  if (resolve(indexed.root) !== identities.vault || resolve(indexed.database) !== identities.database) {
    throw new TypeError("semantic indexing escaped the isolated measurement identities.");
  }
  validateIndexResult(indexed, request.phase, documentCount);
  const resources = resourcesFor(indexed, positiveInteger(peakRss(), "measurement peakRssBytes"), positiveInteger(await cacheBytes(identities.cache), "measurement cacheBytes"));
  if (request.phase === "incremental-prepare") {
    await prepareIncrementalMutation(request, identities, snapshot.notes, documentCount, dependencies);
  }
  return Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "response",
    requestId: request.requestId,
    phase: request.phase,
    elapsedMs,
    index: Object.freeze({
      model: indexed.model,
      documentCount,
      update: Object.freeze({ ...indexed.update }),
      embedding: indexed.embedding === null ? null : Object.freeze({ ...indexed.embedding })
    }),
    resources
  });
}
function parseUpdate(value, label) {
  const input = record3(value, label);
  exactKeys2(input, ["collections", "indexed", "needsEmbedding", "removed", "unchanged", "updated"], [], label);
  return Object.freeze({
    collections: nonnegativeInteger2(input.collections, `${label}.collections`),
    indexed: nonnegativeInteger2(input.indexed, `${label}.indexed`),
    updated: nonnegativeInteger2(input.updated, `${label}.updated`),
    unchanged: nonnegativeInteger2(input.unchanged, `${label}.unchanged`),
    removed: nonnegativeInteger2(input.removed, `${label}.removed`),
    needsEmbedding: nonnegativeInteger2(input.needsEmbedding, `${label}.needsEmbedding`)
  });
}
function parseEmbedding(value, label) {
  if (value === null)
    return null;
  const input = record3(value, label);
  exactKeys2(input, ["chunksEmbedded", "docsProcessed", "durationMs", "errors"], ["failures"], label);
  if (input.failures !== undefined && (!Array.isArray(input.failures) || input.failures.length !== 0)) {
    throw new TypeError(`${label}.failures must be absent or empty.`);
  }
  return Object.freeze({
    docsProcessed: nonnegativeInteger2(input.docsProcessed, `${label}.docsProcessed`),
    chunksEmbedded: nonnegativeInteger2(input.chunksEmbedded, `${label}.chunksEmbedded`),
    errors: nonnegativeInteger2(input.errors, `${label}.errors`),
    ...input.failures === undefined ? {} : { failures: Object.freeze([]) },
    durationMs: nonnegativeNumber3(input.durationMs, `${label}.durationMs`)
  });
}
function parseResources2(value) {
  const input = record3(value, "measurement child response.resources");
  exactKeys2(input, ["cacheBytes", "embedding", "llm", "packedContext", "peakRssBytes"], [], "measurement child response.resources");
  const llm = record3(input.llm, "measurement child response.resources.llm");
  exactKeys2(llm, ["calls", "inputTokens", "outputTokens"], [], "measurement child response.resources.llm");
  if (llm.calls !== 0 || llm.inputTokens !== 0 || llm.outputTokens !== 0) {
    throw new TypeError("measurement child reported nonzero generative LLM work.");
  }
  const embedding = record3(input.embedding, "measurement child response.resources.embedding");
  exactKeys2(embedding, ["calls", "durationMs", "inputTokens"], ["inputTokensMeasured"], "measurement child response.resources.embedding");
  const packed = record3(input.packedContext, "measurement child response.resources.packedContext");
  exactKeys2(packed, ["readerTokens", "utf8Bytes"], [], "measurement child response.resources.packedContext");
  if (packed.readerTokens !== 0 || packed.utf8Bytes !== 0) {
    throw new TypeError("index measurement child reported packed-context work.");
  }
  const embeddingCalls = nonnegativeInteger2(embedding.calls, "measurement embedding.calls");
  const embeddingInputTokens = nonnegativeInteger2(embedding.inputTokens, "measurement embedding.inputTokens");
  if (embeddingCalls === 0 && embedding.inputTokensMeasured !== undefined || embeddingCalls > 0 && embedding.inputTokensMeasured !== false || embedding.inputTokensMeasured === false && embeddingInputTokens !== 0) {
    throw new TypeError("measurement embedding input-token accounting must explicitly mark unavailable counts.");
  }
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({
      calls: embeddingCalls,
      inputTokens: embeddingInputTokens,
      ...embedding.inputTokensMeasured === false ? { inputTokensMeasured: false } : {},
      durationMs: nonnegativeNumber3(embedding.durationMs, "measurement embedding.durationMs")
    }),
    packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
    peakRssBytes: positiveInteger(input.peakRssBytes, "measurement peakRssBytes"),
    cacheBytes: positiveInteger(input.cacheBytes, "measurement cacheBytes")
  });
}
function parseChildResponse(bytes, request) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROTOCOL_BYTES) {
    throw new TypeError("measurement child response has an invalid byte length.");
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.trim() !== text)
    throw new TypeError("measurement child response framing is invalid.");
  const input = record3(JSON.parse(text), "measurement child response");
  exactKeys2(input, ["elapsedMs", "index", "kind", "phase", "protocol", "requestId", "resources", "version"], [], "measurement child response");
  if (input.protocol !== PROTOCOL || input.version !== PROTOCOL_VERSION || input.kind !== "response" || input.requestId !== request.requestId || input.phase !== request.phase) {
    throw new TypeError("measurement child response does not match its request.");
  }
  const indexInput = record3(input.index, "measurement child response.index");
  exactKeys2(indexInput, ["documentCount", "embedding", "model", "update"], [], "measurement child response.index");
  if (indexInput.model !== recommendedEmbeddingModel) {
    throw new TypeError("measurement child response has the wrong model identity.");
  }
  const index = Object.freeze({
    model: recommendedEmbeddingModel,
    documentCount: positiveInteger(indexInput.documentCount, "measurement documentCount"),
    update: parseUpdate(indexInput.update, "measurement child response.index.update"),
    embedding: parseEmbedding(indexInput.embedding, "measurement child response.index.embedding")
  });
  const elapsedMs = nonnegativeNumber3(input.elapsedMs, "measurement child response.elapsedMs");
  const resources = parseResources2(input.resources);
  validateIndexResult({ root: "", database: "", ...index }, request.phase, index.documentCount);
  if (resources.embedding.calls !== 1 || resources.embedding.durationMs !== index.embedding?.durationMs || resources.embedding.inputTokens !== 0) {
    throw new TypeError("measurement child response accounting contradicts its semantic result.");
  }
  return Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "response",
    requestId: request.requestId,
    phase: request.phase,
    elapsedMs,
    index,
    resources
  });
}
function timeoutMs(value) {
  const parsed = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_MS) {
    throw new TypeError(`measurement timeoutMs must be from 1 through ${MAX_TIMEOUT_MS}.`);
  }
  return parsed;
}
function childCommand(value) {
  const command = value ?? Object.freeze([process.execPath, fileURLToPath(import.meta.url), CHILD_ARGUMENT]);
  if (command.length < 1 || command.length > 16 || command.some((part) => typeof part !== "string" || part.length === 0 || /[\0\r\n]/u.test(part))) {
    throw new TypeError("measurement child command is invalid.");
  }
  return Object.freeze([...command]);
}
function environmentFor(identities) {
  const environment = {
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin"
  };
  environment.XDG_CACHE_HOME = identities.xdgCache;
  environment.HF_HUB_OFFLINE = "1";
  environment.TRANSFORMERS_OFFLINE = "1";
  environment.GGML_METAL_NO_RESIDENCY = "1";
  environment.QMD_EMBED_PARALLELISM = "1";
  environment.QMD_LLAMA_GPU = "auto";
  environment.TMPDIR = identities.workRoot;
  environment.TMP = identities.workRoot;
  environment.TEMP = identities.workRoot;
  environment.QMD_GENERATE_MODEL = identities.forbiddenGenerateModel;
  environment.QMD_RERANK_MODEL = identities.forbiddenRerankModel;
  return Object.freeze(environment);
}
var spawnEvaluationMeasurementChildV2 = async (request) => await new Promise((resolvePromise, rejectPromise) => {
  const [executable, ...arguments_] = request.command;
  if (executable === undefined) {
    rejectPromise(new TypeError("measurement child executable is missing."));
    return;
  }
  const child = spawn(executable, arguments_, {
    cwd: request.cwd,
    env: {
      ...request.environment,
      NODE_ENV: "production"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let termination = "exit";
  let settled = false;
  let outputFailure;
  const abort = () => {
    if (termination === "exit")
      termination = "aborted";
    child.kill("SIGKILL");
  };
  const timer = setTimeout(() => {
    if (termination === "exit")
      termination = "timeout";
    child.kill("SIGKILL");
  }, request.timeoutMs);
  request.signal.addEventListener("abort", abort, { once: true });
  child.stdout.on("data", (chunk) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > request.maxStdoutBytes) {
      outputFailure = new RangeError("measurement child stdout exceeded its bound.");
      child.kill("SIGKILL");
      return;
    }
    stdout.push(Buffer.from(chunk));
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes > request.maxStderrBytes) {
      outputFailure = new RangeError("measurement child stderr exceeded its bound.");
      child.kill("SIGKILL");
      return;
    }
    stderr.push(Buffer.from(chunk));
  });
  const streamError = () => {
    outputFailure = new Error("measurement child process stream failed.");
    child.kill("SIGKILL");
  };
  child.stdin.once("error", streamError);
  child.stdout.once("error", streamError);
  child.stderr.once("error", streamError);
  child.once("error", (error) => {
    if (settled)
      return;
    settled = true;
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    rejectPromise(error);
  });
  child.once("close", (exitCode) => {
    if (settled)
      return;
    settled = true;
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    if (outputFailure !== undefined) {
      rejectPromise(outputFailure);
      return;
    }
    resolvePromise(Object.freeze({
      termination,
      exitCode,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr)
    }));
  });
  if (request.signal.aborted)
    abort();
  child.stdin.end(request.stdin);
});
function traceFor(descriptor, measured) {
  return Object.freeze({
    laneOutcomes: Object.freeze(descriptor.lanes.map((laneId) => {
      const applicable = qmdLanes.has(laneId);
      return Object.freeze({
        laneId,
        applicability: measured && applicable ? "applied" : "skipped",
        status: measured ? "ready" : "unavailable",
        reasonCodes: Object.freeze(measured && applicable ? [] : ["operation-not-applicable"]),
        rawRanking: Object.freeze([])
      });
    })),
    candidateDecisions: Object.freeze([])
  });
}
function zeroResources2() {
  return Object.freeze({
    llm: Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0 }),
    embedding: Object.freeze({ calls: 0, inputTokens: 0, durationMs: 0 }),
    packedContext: Object.freeze({ utf8Bytes: 0, readerTokens: 0 }),
    peakRssBytes: 0,
    cacheBytes: 0
  });
}
function validateMeasurementInput(input) {
  if (input.profile.operation !== input.operation || input.profile.scope !== "retriever" || input.profile.concurrency !== 1 || input.profile.cacheState !== (input.operation === "cold-index" ? "cold" : "changed-generation") || !Number.isSafeInteger(input.repetition) || input.repetition < 1 || input.repetition > input.profile.repetitions) {
    throw new TypeError("retriever measurement input does not match its locked profile.");
  }
  const localModel = input.corpus.experiment.environment.localModel;
  if (localModel.kind !== "model" || localModel.id !== recommendedEmbeddingModel || localModel.sha256 !== recommendedEmbeddingModelSha256) {
    throw new TypeError("QMD measurement requires the pinned local embedding model identity.");
  }
  const lockedDescriptor = input.corpus.retrievers.find(({ id }) => id === input.descriptor.id);
  if (lockedDescriptor === undefined || evaluationRetrieverDescriptorDigestV2(lockedDescriptor) !== evaluationRetrieverDescriptorDigestV2(input.descriptor)) {
    throw new TypeError("retriever measurement descriptor is absent from the sealed corpus.");
  }
  const lockedProfile = input.corpus.measurementProfiles.find(({ id }) => id === input.profile.id);
  if (lockedProfile === undefined || lockedProfile.operation !== input.profile.operation || lockedProfile.scope !== input.profile.scope || lockedProfile.cacheState !== input.profile.cacheState || lockedProfile.concurrency !== input.profile.concurrency || lockedProfile.repetitions !== input.profile.repetitions) {
    throw new TypeError("retriever measurement profile is absent from the sealed corpus.");
  }
}
function assertMutationMatchesSealedExperiment(corpus, mutation) {
  const sealed = corpus.experiment.environment.incrementalMutation;
  const appendUtf8Sha256 = createHash8("sha256").update(mutation.appendText, "utf8").digest("hex");
  if (mutation.sourcePath !== sealed.sourcePath || appendUtf8Sha256 !== sealed.appendUtf8Sha256 || mutation.expectedPostMutationSha256 !== sealed.expectedPostMutationSha256) {
    throw new TypeError("incremental measurement mutation does not match the sealed experiment identity.");
  }
}
async function runChildPhase(options) {
  if (options.signal.aborted) {
    throw options.signal.reason ?? new Error("measurement child request was aborted.");
  }
  const request = Object.freeze({
    protocol: PROTOCOL,
    version: PROTOCOL_VERSION,
    kind: "request",
    requestId: options.requestId,
    phase: options.phase,
    repository: options.repository,
    root: options.root,
    frozen: options.frozen,
    embeddingModelFile: options.embeddingModelFile,
    workRoot: options.workRoot,
    ...options.phase === "cold-index" ? {} : { mutation: options.mutation }
  });
  const serialized = Buffer.from(JSON.stringify(request), "utf8");
  if (serialized.byteLength > MAX_PROTOCOL_BYTES)
    throw new RangeError("measurement child request is too large.");
  const identities = workIdentities(options.workRoot);
  const result = await options.childProcessFactory({
    command: options.command,
    cwd: options.repository,
    environment: environmentFor(identities),
    stdin: serialized,
    timeoutMs: options.timeoutMs,
    maxStdoutBytes: MAX_PROTOCOL_BYTES,
    maxStderrBytes: MAX_STDERR_BYTES,
    signal: options.signal
  });
  if (result.stdout.byteLength > MAX_PROTOCOL_BYTES || result.stderr.byteLength > MAX_STDERR_BYTES) {
    throw new RangeError("measurement child output exceeded its bound.");
  }
  if (result.termination !== "exit") {
    throw new Error(`measurement child ${result.termination}.`);
  }
  if (result.exitCode !== 0)
    throw new Error("measurement child exited unsuccessfully.");
  return parseChildResponse(result.stdout, request);
}
function createKnowledgeBaseEvaluationRetrieverOperationMeasurerV2(options) {
  const repository = resolve(options.repository);
  const root = resolve(options.root);
  const embeddingModelFile = resolve(options.embeddingModelFile);
  const mutation = parseMutation(options.mutation, "mutation");
  const timeout2 = timeoutMs(options.timeoutMs);
  const command = childCommand(options.childCommand);
  const temporaryDirectory = resolve(options.temporaryDirectory ?? tmpdir());
  const childProcessFactory = options.childProcessFactory ?? spawnEvaluationMeasurementChildV2;
  const sharedSubstrateMeasurements = new Map;
  const measureSharedSubstrate = async (input) => {
    const canonicalTemporaryDirectory = await realpath(temporaryDirectory);
    const temporaryMetadata = await stat(canonicalTemporaryDirectory);
    if (!temporaryMetadata.isDirectory()) {
      throw new TypeError("measurement temporaryDirectory must be a directory.");
    }
    const workRoot = await mkdtemp(join(canonicalTemporaryDirectory, WORK_DIRECTORY_PREFIX));
    const requestId = randomUUID();
    try {
      const common = {
        requestId,
        workRoot,
        repository,
        root,
        frozen: input.corpus.frozen,
        embeddingModelFile,
        mutation,
        command,
        timeoutMs: timeout2,
        signal: input.signal,
        childProcessFactory
      };
      if (input.operation === "cold-index") {
        return await runChildPhase({ ...common, phase: "cold-index" });
      }
      await runChildPhase({ ...common, phase: "incremental-prepare" });
      return await runChildPhase({ ...common, phase: "incremental-update" });
    } finally {
      await rm(workRoot, { recursive: true, force: true });
    }
  };
  return async (input) => {
    validateMeasurementInput(input);
    assertMutationMatchesSealedExperiment(input.corpus, mutation);
    if (!input.descriptor.lanes.some((lane) => qmdLanes.has(lane))) {
      return Object.freeze({
        status: "unavailable",
        timings: Object.freeze({ elapsedMs: 0, indexMs: 0, updateMs: 0, queryMs: 0, packingMs: 0 }),
        resources: zeroResources2(),
        trace: traceFor(input.descriptor, false)
      });
    }
    if (input.signal.aborted)
      throw input.signal.reason ?? new Error("retriever measurement was aborted.");
    const measurementIdentity = JSON.stringify([
      input.corpus.frozen.repositoryCommit,
      input.corpus.frozen.vaultTree,
      input.corpus.experiment.environment.localModel,
      input.operation,
      input.profile,
      input.repetition,
      mutation.sha256
    ]);
    let pending = sharedSubstrateMeasurements.get(measurementIdentity);
    if (pending === undefined) {
      pending = measureSharedSubstrate(input);
      sharedSubstrateMeasurements.set(measurementIdentity, pending);
      pending.catch(() => {
        if (sharedSubstrateMeasurements.get(measurementIdentity) === pending) {
          sharedSubstrateMeasurements.delete(measurementIdentity);
        }
      });
    }
    const measured = await pending;
    if (input.signal.aborted)
      throw input.signal.reason ?? new Error("retriever measurement was aborted.");
    return Object.freeze({
      status: "ready",
      timings: Object.freeze({
        elapsedMs: measured.elapsedMs,
        indexMs: input.operation === "cold-index" ? measured.elapsedMs : 0,
        updateMs: input.operation === "incremental-update" ? measured.elapsedMs : 0,
        queryMs: 0,
        packingMs: 0
      }),
      resources: measured.resources,
      trace: traceFor(input.descriptor, true)
    });
  };
}
if (false)
  ;

// src/evaluation-builder.ts
var AUTHORING_DIRECTORY = "kb/evaluations/kb-evidence-routing-v2";
var MAX_CONFIG_BYTES = 1 * 1024 * 1024;
var MAX_SHARDS = 64;
var MAX_SHARD_BYTES = 16 * 1024 * 1024;
var MAX_TOTAL_SHARD_BYTES = 64 * 1024 * 1024;
var MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
var MAX_IMPLEMENTATION_SOURCE_BYTES2 = 4 * 1024 * 1024;
var MAX_IMPLEMENTATION_SOURCES_PER_RETRIEVER = 32;
var MAX_IMPLEMENTATION_SOURCE_BINDINGS = 64;
var FROZEN_GIT_TIMEOUT_MS = 30000;
var FROZEN_GIT_METADATA_BYTES = 64 * 1024;
var MAX_VAULT_LIST_BYTES = 4 * 1024 * 1024;
var MAX_JSON_STRING_BYTES2 = 1 * 1024 * 1024;
var MAX_SOURCE_FAMILY_RATIONALE_BYTES2 = 2048;
var MAX_SOURCE_FAMILY_REVIEWERS2 = 32;
var MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES2 = 256;
var SHA256_PATTERN2 = /^[0-9a-f]{64}$/u;
var GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
var sourceClassSchema = z.enum([
  "authored-note",
  "captured-source",
  "git-history",
  "repository-file"
]);
var trustClassSchema = z.enum([
  "authoritative-current",
  "authoritative-historical",
  "captured-primary",
  "captured-secondary",
  "maintained-synthesis",
  "untrusted-capture"
]);
var evidenceKindSchema = z.enum([
  "frontmatter-field",
  "heading",
  "paragraph",
  "list",
  "table",
  "code-block",
  "pdf-page-span"
]);
var splitSchema = z.enum(["development", "test"]);
var cohortSchema = z.enum(["caller-seeded", "text-only"]);
var supportSchema = z.enum(["insufficient", "supported"]);
var negativeSubtypeSchema = z.enum([
  "boundary-near-miss",
  "conflicting-evidence",
  "missing-required-support",
  "stale-only",
  "topical-near-miss",
  "unknown-entity"
]);
var stratumSchema = z.enum([
  "active-current-state",
  "code-path-context",
  "conceptual-recall",
  "exact-identity",
  "local-context",
  "metadata-constraint",
  "multi-note-relational",
  "no-answer-near-miss",
  "source-provenance",
  "temporal-stale-current"
]);
var laneSchema = z.enum([
  "exact",
  "git",
  "graph",
  "hybrid",
  "keyword",
  "metadata",
  "note",
  "path-context",
  "semantic"
]);
var inputLaneSchema = z.enum(["context", "graph", "history", "metadata", "noteId", "text"]);
var boundedStringSchema = z.string().refine((value) => Buffer.byteLength(value, "utf8") <= MAX_JSON_STRING_BYTES2, "string exceeds the authoring byte bound");
var nonEmptyStringSchema = boundedStringSchema.min(1);
var sourceFamilyReviewerIdSchema = nonEmptyStringSchema.refine((value) => Buffer.byteLength(value, "utf8") <= MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES2, `reviewer ID exceeds ${MAX_SOURCE_FAMILY_REVIEWER_ID_BYTES2} UTF-8 bytes`);
var sourceFamilyReviewerIdsSchema = z.array(sourceFamilyReviewerIdSchema).min(2).max(MAX_SOURCE_FAMILY_REVIEWERS2).refine((values) => new Set(values).size === values.length, "reviewer IDs must be distinct").refine((values) => values.every((value, index) => value === values.toSorted()[index]), "reviewer IDs must be in canonical order");
var sourceFamilyRationaleSchema = z.string().refine((value) => value.normalize("NFC") === value && value.trim() === value && !value.includes("\x00") && Buffer.byteLength(value, "utf8") >= 24 && Buffer.byteLength(value, "utf8") <= MAX_SOURCE_FAMILY_RATIONALE_BYTES2, `rationale must be trimmed NFC text from 24 through ${MAX_SOURCE_FAMILY_RATIONALE_BYTES2} UTF-8 bytes`);
var sha256Schema = z.string().regex(SHA256_PATTERN2);
var gitObjectSchema = z.string().regex(GIT_OBJECT_PATTERN);
var relevanceSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
var positiveIntegerSchema = z.number().int().positive().safe();
var nonNegativeIntegerSchema = z.number().int().nonnegative().safe();
var lineRangeSchema = z.strictObject({
  start: positiveIntegerSchema,
  end: positiveIntegerSchema
});
var byteRangeSchema = z.strictObject({
  start: nonNegativeIntegerSchema,
  end: nonNegativeIntegerSchema
});
var evidenceSelectorSchema = z.strictObject({
  sourcePath: nonEmptyStringSchema,
  kind: evidenceKindSchema.optional(),
  headingPath: z.array(boundedStringSchema).max(64).optional(),
  heading: boundedStringSchema.optional(),
  exactText: boundedStringSchema.optional(),
  lineRange: lineRangeSchema.optional(),
  expectedUnitId: nonEmptyStringSchema.optional(),
  expectedUnitSha256: sha256Schema.optional(),
  expectedSourceSha256: sha256Schema.optional(),
  expectedByteRange: byteRangeSchema.optional()
});
var documentJudgmentSchema = z.strictObject({
  sourcePath: nonEmptyStringSchema,
  relevance: relevanceSchema
});
var evidenceJudgmentSchema = z.strictObject({
  selector: evidenceSelectorSchema,
  relevance: relevanceSchema
});
var supportSetSchema = z.strictObject({
  key: nonEmptyStringSchema,
  evidence: z.array(evidenceSelectorSchema).max(2000)
});
var nuggetSchema = z.strictObject({
  key: nonEmptyStringSchema,
  text: boundedStringSchema,
  required: z.boolean(),
  acceptableSupportSets: z.array(supportSetSchema).max(100)
});
var goldSchema = z.strictObject({
  documents: z.array(documentJudgmentSchema).max(2000),
  evidenceUnits: z.array(evidenceJudgmentSchema).max(2000),
  nuggets: z.array(nuggetSchema).max(100)
});
var assessorNuggetSchema = z.strictObject({
  nuggetKey: nonEmptyStringSchema,
  required: z.boolean().optional(),
  acceptableSupportSetKeys: z.array(nonEmptyStringSchema).max(100)
});
var rawAssessmentSchema = z.strictObject({
  assessorId: nonEmptyStringSchema,
  expectedSupport: supportSchema,
  documents: z.array(documentJudgmentSchema).max(2000),
  evidenceUnits: z.array(evidenceJudgmentSchema).max(2000),
  nuggets: z.array(assessorNuggetSchema).max(100)
});
var adjudicationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("single-assessor") }),
  z.strictObject({ status: z.literal("agreed") }),
  z.strictObject({
    status: z.literal("resolved"),
    adjudicatorId: nonEmptyStringSchema,
    rationale: nonEmptyStringSchema
  })
]);
var metadataFilterSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("exists"), path: nonEmptyStringSchema }),
  z.strictObject({
    kind: z.literal("equals"),
    path: nonEmptyStringSchema,
    value: z.union([boundedStringSchema, z.number().finite(), z.boolean(), z.null()])
  })
]);
var retrievalInputsSchema = z.strictObject({
  text: boundedStringSchema,
  noteId: nonEmptyStringSchema.optional(),
  metadata: z.strictObject({
    filters: z.array(metadataFilterSchema).max(2000),
    tags: z.array(nonEmptyStringSchema).max(2000)
  }).optional(),
  graph: z.strictObject({
    seeds: z.array(nonEmptyStringSchema).max(2000),
    depth: z.union([z.literal(1), z.literal(2)])
  }).optional(),
  context: z.strictObject({ repositoryPath: nonEmptyStringSchema }).optional(),
  history: z.strictObject({
    query: boundedStringSchema,
    noteIds: z.array(nonEmptyStringSchema).max(2000)
  }).optional()
});
var inputOriginSchema = z.strictObject({
  lane: inputLaneSchema,
  origin: z.enum(["caller", "query-text"])
});
var humanAuthoredEvaluationQuestionV2Schema = z.strictObject({
  key: nonEmptyStringSchema,
  text: boundedStringSchema,
  split: splitSchema,
  cohort: cohortSchema,
  strata: z.array(stratumSchema).min(1).max(10),
  primaryStratum: stratumSchema,
  expectedSupport: supportSchema,
  primaryLane: laneSchema,
  negativeSubtype: negativeSubtypeSchema.optional(),
  inputs: retrievalInputsSchema,
  inputOrigins: z.array(inputOriginSchema).min(1).max(6),
  gold: goldSchema,
  rawAssessments: z.array(rawAssessmentSchema).min(1).max(32),
  adjudication: adjudicationSchema
});
var authoringDocumentSchema = z.strictObject({
  documentId: nonEmptyStringSchema.optional(),
  sourcePath: nonEmptyStringSchema,
  sourceFamilyKey: nonEmptyStringSchema,
  sourceClass: sourceClassSchema,
  trustClass: trustClassSchema,
  sourceFamilyRationale: sourceFamilyRationaleSchema.optional(),
  sourceFamilyReviewerIds: sourceFamilyReviewerIdsSchema.optional()
});
var reviewedAuthoringDocumentSchema = authoringDocumentSchema.extend({
  sourceFamilyRationale: sourceFamilyRationaleSchema,
  sourceFamilyReviewerIds: sourceFamilyReviewerIdsSchema
});
var kbEvidenceRoutingAuthoringShardSchema = z.strictObject({
  documents: z.array(authoringDocumentSchema).max(MAX_EVALUATION_EVIDENCE_DOCUMENTS),
  questions: z.array(humanAuthoredEvaluationQuestionV2Schema).min(1).max(MAX_EVALUATION_V2_QUERIES)
});
var kbEvidenceRoutingPrivateQuestionSpecSchema = z.strictObject({
  key: nonEmptyStringSchema,
  text: boundedStringSchema,
  split: z.literal("test"),
  cohort: cohortSchema,
  strata: z.array(stratumSchema).min(1).max(10),
  primaryStratum: stratumSchema,
  primaryLane: laneSchema,
  negativeSubtype: negativeSubtypeSchema.optional(),
  inputs: retrievalInputsSchema,
  inputOrigins: z.array(inputOriginSchema).min(1).max(6),
  assignedAssessorIds: z.array(nonEmptyStringSchema).min(1).max(32)
});
var privateAssessorJudgmentSchema = z.strictObject({
  questionKey: nonEmptyStringSchema,
  questionSpecSha256: sha256Schema,
  questionSpecShardSha256: sha256Schema,
  expectedSupport: supportSchema,
  documents: z.array(documentJudgmentSchema).max(2000),
  evidenceUnits: z.array(evidenceJudgmentSchema).max(2000),
  nuggets: z.array(assessorNuggetSchema).max(100)
});
var privateAdjudicationSchema = z.strictObject({
  questionKey: nonEmptyStringSchema,
  questionSpecSha256: sha256Schema,
  questionSpecShardSha256: sha256Schema,
  expectedSupport: supportSchema,
  gold: goldSchema,
  adjudication: adjudicationSchema
});
var kbEvidenceRoutingPrivateQuestionSpecShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("question-specs"),
  buildContractSha256: sha256Schema,
  documents: z.array(reviewedAuthoringDocumentSchema).max(MAX_EVALUATION_EVIDENCE_DOCUMENTS),
  questions: z.array(kbEvidenceRoutingPrivateQuestionSpecSchema).min(1).max(MAX_EVALUATION_V2_QUERIES)
});
var kbEvidenceRoutingPrivateAssessorJudgmentShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("assessor-judgments"),
  buildContractSha256: sha256Schema,
  assessorId: nonEmptyStringSchema,
  judgments: z.array(privateAssessorJudgmentSchema).min(1).max(MAX_EVALUATION_V2_QUERIES)
});
var kbEvidenceRoutingPrivateAdjudicationShardSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("adjudications"),
  buildContractSha256: sha256Schema,
  adjudications: z.array(privateAdjudicationSchema).min(1).max(MAX_EVALUATION_V2_QUERIES)
});
var kbEvidenceRoutingPrivateAuthoringShardSchema = z.discriminatedUnion("kind", [
  kbEvidenceRoutingPrivateQuestionSpecShardSchema,
  kbEvidenceRoutingPrivateAssessorJudgmentShardSchema,
  kbEvidenceRoutingPrivateAdjudicationShardSchema
]);
var assessorSchema = z.strictObject({
  id: nonEmptyStringSchema,
  displayName: nonEmptyStringSchema.optional(),
  affiliation: nonEmptyStringSchema.optional()
});
var minimumUsefulEffectSchema = z.strictObject({
  metric: z.enum([
    "document-recall-at-k",
    "evidence-recall-at-k",
    "false-abstention-rate",
    "no-answer-accuracy",
    "nugget-coverage"
  ]),
  cohort: z.enum(["caller-seeded", "text-only"]),
  minimumAbsoluteDifference: z.number().finite().nonnegative()
});
var nonInferiorityMarginSchema = z.strictObject({
  metric: z.enum([
    "active-current-state-accuracy",
    "code-path-context-accuracy",
    "context-precision",
    "conceptual-recall-accuracy",
    "document-recall-at-k",
    "evidence-recall-at-k",
    "exact-identity-accuracy",
    "local-context-accuracy",
    "metadata-constraint-accuracy",
    "multi-note-relational-accuracy",
    "source-provenance-accuracy",
    "temporal-stale-current-accuracy",
    "four-reader-query-p95-ms",
    "packing-p95-ms",
    "warm-query-p95-ms"
  ]),
  maximumAbsoluteRegression: z.number().finite().nonnegative(),
  maximumRelativeRegression: z.number().finite().nonnegative()
});
var localModelSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("model"), id: nonEmptyStringSchema, sha256: sha256Schema })
]);
var experimentSchema = z.strictObject({
  protocol: z.strictObject({
    minimumUsefulEffects: z.array(minimumUsefulEffectSchema).min(1).max(10),
    nonInferiorityMargins: z.array(nonInferiorityMarginSchema).min(1).max(32),
    contextCeilings: z.strictObject({
      utf8Bytes: positiveIntegerSchema,
      readerTokens: positiveIntegerSchema
    }),
    pairedPower: z.strictObject({
      alpha: z.number().finite().positive().max(1),
      targetPower: z.number().finite().positive().max(1),
      assumedDiscordantRate: z.number().finite().positive().max(1),
      assumedEffect: z.number().finite().positive().max(1),
      minimumUsefulEffect: z.number().finite().positive().max(1),
      requiredPairs: positiveIntegerSchema
    })
  }),
  environment: z.strictObject({
    tokenizer: z.strictObject({ id: nonEmptyStringSchema, sha256: sha256Schema }),
    runtime: z.strictObject({ id: nonEmptyStringSchema, sha256: sha256Schema }),
    hardware: z.strictObject({ id: nonEmptyStringSchema }),
    localModel: localModelSchema,
    cache: z.strictObject({
      preparation: nonEmptyStringSchema,
      fingerprintSha256: sha256Schema
    }),
    fourReaderBatch: z.strictObject({ id: nonEmptyStringSchema, sha256: sha256Schema }),
    incrementalMutation: z.strictObject({
      sourcePath: nonEmptyStringSchema,
      appendUtf8Sha256: sha256Schema,
      expectedPostMutationSha256: sha256Schema
    })
  })
});
var measurementProfileSchema = z.strictObject({
  id: nonEmptyStringSchema,
  operation: z.enum(["cold-index", "four-reader-query", "incremental-update", "packing", "warm-query"]),
  scope: z.enum(["query", "retriever"]),
  cacheState: z.enum(["changed-generation", "cold", "not-applicable", "warm"]),
  concurrency: positiveIntegerSchema,
  repetitions: positiveIntegerSchema
});
var retrieverConfigurationValueSchema = z.union([
  boundedStringSchema,
  z.number().finite(),
  z.boolean(),
  z.null()
]);
var retrieverSchema = z.strictObject({
  id: nonEmptyStringSchema,
  role: z.enum(["ablation", "baseline", "candidate"]),
  version: nonEmptyStringSchema,
  implementationSha256: sha256Schema,
  lanes: z.array(laneSchema).min(1).max(9),
  configuration: z.record(z.string(), retrieverConfigurationValueSchema)
});
var implementationSourceBindingSchema = z.strictObject({
  retrieverId: nonEmptyStringSchema,
  sourcePaths: z.array(nonEmptyStringSchema).min(1).max(MAX_IMPLEMENTATION_SOURCES_PER_RETRIEVER)
});
var kbEvidenceRoutingEvaluationBuildConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  repositoryRoot: nonEmptyStringSchema,
  id: nonEmptyStringSchema,
  description: nonEmptyStringSchema,
  sealedAt: nonEmptyStringSchema,
  frozen: z.strictObject({
    repositoryCommit: gitObjectSchema,
    vaultTree: gitObjectSchema,
    vaultRoot: nonEmptyStringSchema
  }),
  assessment: z.strictObject({
    rubricVersion: nonEmptyStringSchema,
    assessors: z.array(assessorSchema).min(1).max(64)
  }),
  experiment: experimentSchema,
  measurementProfiles: z.array(measurementProfileSchema).min(1).max(32),
  retrievers: z.array(retrieverSchema).min(1).max(64),
  implementationSources: z.array(implementationSourceBindingSchema).min(1).max(MAX_IMPLEMENTATION_SOURCE_BINDINGS),
  baselineRetrieverId: nonEmptyStringSchema,
  evidenceParserVersion: nonEmptyStringSchema,
  reviewPolicy: z.strictObject({
    ngramSize: z.literal(3).optional(),
    crossSplitNgramThreshold: z.number().finite().positive().max(0.8).optional(),
    labelPredictabilityCeiling: z.number().finite().positive().max(0.65).optional(),
    sourceFamilyAssignment: z.strictObject({
      protocolId: nonEmptyStringSchema,
      protocolSha256: sha256Schema,
      reviewerIds: sourceFamilyReviewerIdsSchema
    })
  }),
  shards: z.strictObject({
    development: z.array(nonEmptyStringSchema).min(1).max(MAX_SHARDS),
    qa: z.array(nonEmptyStringSchema).max(MAX_SHARDS),
    heldOut: z.array(nonEmptyStringSchema).max(MAX_SHARDS)
  }),
  outputs: z.strictObject({
    corpus: nonEmptyStringSchema,
    externalSeal: nonEmptyStringSchema,
    summary: nonEmptyStringSchema
  })
});
var kbEvidenceRoutingEvaluationShaSummarySchema = z.strictObject({
  schemaVersion: z.literal(1),
  corpus: z.strictObject({
    path: nonEmptyStringSchema,
    byteLength: positiveIntegerSchema,
    outputSha256: sha256Schema,
    committedCorpusSha256: sha256Schema
  }),
  externalSeal: z.strictObject({
    path: nonEmptyStringSchema,
    byteLength: positiveIntegerSchema,
    outputSha256: sha256Schema
  }),
  authoring: z.strictObject({
    configSha256: sha256Schema,
    shards: z.array(z.strictObject({
      path: nonEmptyStringSchema,
      byteLength: positiveIntegerSchema,
      sha256: sha256Schema
    })).max(MAX_SHARDS * 2),
    qaShards: z.array(z.strictObject({
      path: nonEmptyStringSchema,
      byteLength: positiveIntegerSchema,
      sha256: sha256Schema
    })).max(MAX_SHARDS),
    sources: z.array(z.strictObject({
      sourcePath: nonEmptyStringSchema,
      byteLength: positiveIntegerSchema,
      sha256: sha256Schema
    })).max(MAX_EVALUATION_EVIDENCE_DOCUMENTS)
  }),
  counts: z.strictObject({
    documents: positiveIntegerSchema,
    evidenceUnits: positiveIntegerSchema,
    questions: positiveIntegerSchema
  }),
  visibleReview: z.strictObject({
    questions: positiveIntegerSchema,
    exactQuotaAndBalanceMet: z.boolean(),
    labelPredictabilityMet: z.boolean(),
    pairedPowerMet: z.boolean(),
    diagnosticsSha256: sha256Schema
  })
});
function formatZodError(error, label) {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length === 0 ? label : `${label}.${issue.path.join(".")}`;
    return `${path}: ${issue.message}`;
  });
  return new Error(issues.join(`
`));
}
function parseSchema(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw formatZodError(result.error, label);
  return result.data;
}
function parseJson(bytes, label) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8 JSON.`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function canonicalJson4(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON cannot contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map(canonicalJson4).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const input = value;
    return `{${Object.keys(input).toSorted().map((key) => `${JSON.stringify(key)}:${canonicalJson4(input[key])}`).join(",")}}`;
  }
  throw new TypeError("Canonical JSON accepts only JSON values.");
}
function canonicalJsonBytes(value) {
  return Buffer.from(`${canonicalJson4(value)}
`, "utf8");
}
function sha2565(bytes) {
  return createHash9("sha256").update(bytes).digest("hex");
}
function kbEvidenceRoutingBuildContractSha256(configBytes) {
  return sha2565(configBytes);
}
function kbEvidenceRoutingPrivateQuestionSpecSha256(spec) {
  const checked = parseSchema(kbEvidenceRoutingPrivateQuestionSpecSchema, spec, "private question specification");
  return sha2565(canonicalJsonBytes(checked));
}
function kbEvidenceRoutingPrivateQuestionSpecShardSha256(shard) {
  const checked = parseSchema(kbEvidenceRoutingPrivateQuestionSpecShardSchema, shard, "private question-spec shard");
  return sha2565(canonicalJsonBytes(checked));
}
function kbEvidenceRoutingImplementationSha256(sources) {
  return evaluationImplementationArtifactSha256V2(sources);
}
function gitResultBytes(result) {
  return typeof result.stdout === "string" ? Buffer.from(result.stdout, "utf8") : Buffer.from(result.stdout);
}
async function requiredGitOutput(runGit, repositoryRoot, arguments_, maximumBytes, label) {
  const result = await runGit({
    arguments: arguments_,
    cwd: repositoryRoot,
    timeoutMs: FROZEN_GIT_TIMEOUT_MS,
    maxOutputBytes: maximumBytes
  });
  if (result.status !== "ok") {
    throw new Error(`${label} could not be verified: ${result.message}`);
  }
  return gitResultBytes(result);
}
async function verifyKbEvidenceRoutingFrozenSources(loaded, dependencies = {}) {
  const runGit = dependencies.runGit ?? runGitCommand;
  const { frozen } = loaded.config;
  const resolvedCommit = (await requiredGitOutput(runGit, loaded.repositoryRoot, ["rev-parse", "--verify", `${frozen.repositoryCommit}^{commit}`], FROZEN_GIT_METADATA_BYTES, "Frozen repository commit")).toString("utf8").trim();
  if (resolvedCommit !== frozen.repositoryCommit) {
    throw new Error(`Frozen repository commit resolved to ${resolvedCommit || "an empty value"}, expected ${frozen.repositoryCommit}.`);
  }
  const vaultRevision = frozen.vaultRoot === "." ? `${frozen.repositoryCommit}^{tree}` : `${frozen.repositoryCommit}:${frozen.vaultRoot}`;
  const resolvedTree = (await requiredGitOutput(runGit, loaded.repositoryRoot, ["rev-parse", "--verify", vaultRevision], FROZEN_GIT_METADATA_BYTES, "Frozen vault tree")).toString("utf8").trim();
  if (resolvedTree !== frozen.vaultTree) {
    throw new Error(`Frozen vault tree resolved to ${resolvedTree || "an empty value"}, expected ${frozen.vaultTree}.`);
  }
  const objectType = (await requiredGitOutput(runGit, loaded.repositoryRoot, ["cat-file", "-t", vaultRevision], FROZEN_GIT_METADATA_BYTES, "Frozen vault object type")).toString("utf8").trim();
  if (objectType !== "tree")
    throw new Error(`Frozen vault object must be a tree, received ${JSON.stringify(objectType)}.`);
  for (const source of loaded.sourceFiles) {
    const repositoryPath = frozen.vaultRoot === "." ? source.sourcePath : `${frozen.vaultRoot}/${source.sourcePath}`;
    const frozenBytes = await requiredGitOutput(runGit, loaded.repositoryRoot, ["show", `${frozen.repositoryCommit}:${repositoryPath}`], Math.min(MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES + 1, Math.max(source.bytes.byteLength + 1, 1)), `Frozen Markdown ${source.sourcePath}`);
    if (!frozenBytes.equals(source.bytes)) {
      throw new Error(`Frozen Markdown ${source.sourcePath} differs from the declared Git snapshot.`);
    }
  }
  const descriptorById = new Map(loaded.config.retrievers.map((descriptor) => [descriptor.id, descriptor]));
  const bindingsByRetriever = new Map;
  for (const [bindingIndex, binding] of loaded.config.implementationSources.entries()) {
    if (!descriptorById.has(binding.retrieverId)) {
      throw new Error(`implementationSources[${bindingIndex}] names unknown retriever ${binding.retrieverId}.`);
    }
    if (bindingsByRetriever.has(binding.retrieverId)) {
      throw new Error(`implementationSources repeats retriever ${binding.retrieverId}.`);
    }
    const sourcePaths = binding.sourcePaths.map((sourcePath, sourceIndex) => confinedRelativePath(sourcePath, `implementationSources[${bindingIndex}].sourcePaths[${sourceIndex}]`));
    const sortedPaths = sourcePaths.toSorted();
    if (sourcePaths.some((sourcePath, sourceIndex) => sourcePath !== sortedPaths[sourceIndex])) {
      throw new Error(`implementationSources[${bindingIndex}].sourcePaths must be in canonical order.`);
    }
    assertNoDuplicates(sourcePaths, `implementationSources[${bindingIndex}].sourcePaths`);
    bindingsByRetriever.set(binding.retrieverId, binding);
  }
  const missingBindings = [...descriptorById.keys()].filter((retrieverId) => !bindingsByRetriever.has(retrieverId)).toSorted();
  if (missingBindings.length > 0) {
    throw new Error(`Implementation sources are missing for retrievers: ${missingBindings.join(", ")}.`);
  }
  for (const retrieverId of [...descriptorById.keys()].toSorted()) {
    const descriptor = descriptorById.get(retrieverId);
    const binding = bindingsByRetriever.get(retrieverId);
    if (descriptor === undefined || binding === undefined)
      throw new Error(`Lost retriever binding ${retrieverId}.`);
    const sources = [];
    for (const sourcePath of binding.sourcePaths) {
      const bytes = await requiredGitOutput(runGit, loaded.repositoryRoot, ["show", `${frozen.repositoryCommit}:${sourcePath}`], MAX_IMPLEMENTATION_SOURCE_BYTES2, `Frozen implementation source ${sourcePath}`);
      sources.push({ sourcePath, bytes });
    }
    const actual = kbEvidenceRoutingImplementationSha256(sources);
    if (actual !== descriptor.implementationSha256) {
      throw new Error(`Retriever ${retrieverId} implementation digest ${descriptor.implementationSha256} does not match frozen source digest ${actual}.`);
    }
  }
}
function confinedRelativePath(value, label) {
  if (value === "" || value.normalize("NFC") !== value || /[\0\r\n\\]/u.test(value) || value.startsWith("/") || value.startsWith("./") || /^[a-z]:[\\/]/iu.test(value) || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${label} must be a canonical confined repository-relative path.`);
  }
  return value;
}
function identity(stat2) {
  return {
    dev: stat2.dev,
    ino: stat2.ino,
    size: stat2.size,
    mtimeMs: stat2.mtimeMs,
    ctimeMs: stat2.ctimeMs,
    nlink: stat2.nlink
  };
}
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.nlink === right.nlink;
}
async function readBounded(handle, maximumBytes, label) {
  const chunks = [];
  let total = 0;
  while (true) {
    const remaining = maximumBytes + 1 - total;
    if (remaining <= 0)
      throw new Error(`${label} exceeds ${maximumBytes} bytes.`);
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
    if (bytesRead === 0)
      break;
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }
  return Buffer.concat(chunks, total);
}
async function assertRepositoryComponents(root, relativePath, finalKind) {
  const parts = relativePath.split("/");
  let current = root;
  for (let index = 0;index < parts.length; index += 1) {
    current = resolve2(current, parts[index] ?? "");
    const final = index === parts.length - 1;
    let stat2;
    try {
      stat2 = await lstat2(current);
    } catch (error) {
      if (final && finalKind === "optional-file" && typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    }
    if (stat2.isSymbolicLink())
      throw new Error(`Path ${relativePath} traverses symbolic link ${current}.`);
    if (!final && !stat2.isDirectory()) {
      throw new Error(`Path ${relativePath} traverses non-directory ${current}.`);
    }
    if (final && finalKind === "directory" && !stat2.isDirectory()) {
      throw new Error(`Path ${relativePath} must resolve to a directory.`);
    }
    if (final && finalKind !== "directory" && !stat2.isFile()) {
      throw new Error(`Path ${relativePath} must resolve to a regular file.`);
    }
    if (final && finalKind !== "directory" && stat2.nlink !== 1) {
      throw new Error(`Path ${relativePath} must not be hard-linked (nlink=${stat2.nlink}).`);
    }
  }
}
async function canonicalRepositoryRoot(input, configPath) {
  if (input.trim() === "" || /[\0\r\n]/u.test(input)) {
    throw new Error("repositoryRoot must be a non-empty local path.");
  }
  const lexical = isAbsolute2(input) ? resolve2(input) : resolve2(dirname2(configPath), input);
  const stat2 = await lstat2(lexical);
  if (stat2.isSymbolicLink() || !stat2.isDirectory()) {
    throw new Error("repositoryRoot must name a real directory, not a symbolic link.");
  }
  return realpath2(lexical);
}
function pathContains(parent, child) {
  const path = relative2(parent, child);
  return path === "" || !path.startsWith(`..${sep2}`) && path !== ".." && !isAbsolute2(path);
}
async function canonicalArtifactRoot(input, repositoryRoot) {
  if (input === undefined || input.trim() === "" || /[\0\r\n]/u.test(input)) {
    throw new Error("A separate artifact-B root is required.");
  }
  const lexical = resolve2(input);
  const stat2 = await lstat2(lexical);
  if (stat2.isSymbolicLink() || !stat2.isDirectory()) {
    throw new Error("artifact-B root must name a real directory, not a symbolic link.");
  }
  const canonical = await realpath2(lexical);
  if (pathContains(repositoryRoot, canonical) || pathContains(canonical, repositoryRoot)) {
    throw new Error("artifact-B root must be disjoint from runtime repository A.");
  }
  return canonical;
}
async function secureReadAbsoluteFile(absolutePath2, maximumBytes, label, options = {}) {
  const before = await lstat2(absolutePath2);
  if (before.isSymbolicLink() || !before.isFile())
    throw new Error(`${label} must be a regular non-symlink file.`);
  if (before.nlink !== 1)
    throw new Error(`${label} must not be hard-linked (nlink=${before.nlink}).`);
  if (options.requireReadOnly === true && (before.mode & 146) !== 0) {
    throw new Error(`${label} must be read-only before it is accepted.`);
  }
  if (before.size > maximumBytes)
    throw new Error(`${label} exceeds ${maximumBytes} bytes.`);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open2(absolutePath2, flags);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1)
      throw new Error(`${label} changed before it was opened safely.`);
    if (options.requireReadOnly === true && (opened.mode & 146) !== 0) {
      throw new Error(`${label} became writable while it was opened.`);
    }
    const beforeIdentity = identity(opened);
    if (!sameIdentity(identity(before), beforeIdentity))
      throw new Error(`${label} changed while it was opened.`);
    const bytes = await readBounded(handle, maximumBytes, label);
    const after = await handle.stat();
    if (!sameIdentity(beforeIdentity, identity(after)) || after.size !== bytes.byteLength) {
      throw new Error(`${label} changed while it was read.`);
    }
    if (options.requireReadOnly === true && (after.mode & 146) !== 0) {
      throw new Error(`${label} became writable while it was read.`);
    }
    return { absolutePath: absolutePath2, bytes, sha256: sha2565(bytes) };
  } finally {
    await handle.close();
  }
}
async function secureReadRepositoryFile(root, relativePathInput, maximumBytes, label) {
  const relativePath = confinedRelativePath(relativePathInput, label);
  await assertRepositoryComponents(root, relativePath, "file");
  const absolutePath2 = resolve2(root, ...relativePath.split("/"));
  const canonical = await realpath2(absolutePath2);
  if (canonical !== absolutePath2)
    throw new Error(`${label} resolves through a symbolic link.`);
  return {
    ...await secureReadAbsoluteFile(absolutePath2, maximumBytes, label),
    relativePath
  };
}
async function validateOutputPath(root, input, label) {
  const relativePath = confinedRelativePath(input, label);
  const parentRelative = dirname2(relativePath).split(sep2).join("/");
  if (parentRelative === ".") {} else {
    await assertRepositoryComponents(root, parentRelative, "directory");
  }
  await assertRepositoryComponents(root, relativePath, "optional-file");
  return resolve2(root, ...relativePath.split("/"));
}
function requireAuthoringPath(path, label) {
  const canonical = confinedRelativePath(path, label);
  if (!canonical.startsWith(`${AUTHORING_DIRECTORY}/`) || !canonical.endsWith(".json")) {
    throw new Error(`${label} must be a JSON file under ${AUTHORING_DIRECTORY}/.`);
  }
  return canonical;
}
function requireHeldOutPath(path, label) {
  const canonical = confinedRelativePath(path, label);
  if (!canonical.startsWith("held-out/") || !canonical.endsWith(".json")) {
    throw new Error(`${label} must be a JSON file under artifact-B held-out/.`);
  }
  return canonical;
}
function duplicates(values) {
  const seen = new Set;
  const repeated = new Set;
  for (const value of values) {
    if (seen.has(value))
      repeated.add(value);
    seen.add(value);
  }
  return [...repeated].toSorted();
}
function assertNoDuplicates(values, label) {
  const repeated = duplicates(values);
  if (repeated.length > 0)
    throw new Error(`${label} contains duplicates: ${repeated.join(", ")}.`);
}
function normalizedPrompt2(text) {
  return text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
}
function promptNgrams(text, size) {
  const tokens = normalizedPrompt2(text).split(" ").filter((token) => token !== "");
  if (tokens.length === 0)
    return new Set;
  if (tokens.length < size)
    return new Set([tokens.join(" ")]);
  const grams = new Set;
  for (let index = 0;index <= tokens.length - size; index += 1) {
    grams.add(tokens.slice(index, index + size).join(" "));
  }
  return grams;
}
function jaccard2(left, right) {
  if (left.size === 0 || right.size === 0)
    return 0;
  let intersection = 0;
  for (const item of left)
    if (right.has(item))
      intersection += 1;
  return intersection / (left.size + right.size - intersection);
}
function questionSourcePaths(question) {
  return [...new Set([
    ...question.gold.documents.map(({ sourcePath }) => sourcePath),
    ...question.gold.evidenceUnits.map(({ selector }) => selector.sourcePath),
    ...question.gold.nuggets.flatMap(({ acceptableSupportSets }) => acceptableSupportSets.flatMap(({ evidence }) => evidence.map(({ sourcePath }) => sourcePath))),
    ...question.rawAssessments.flatMap(({ documents }) => documents.map(({ sourcePath }) => sourcePath)),
    ...question.rawAssessments.flatMap(({ evidenceUnits }) => evidenceUnits.map(({ selector }) => selector.sourcePath))
  ])].toSorted();
}
function promotionQuestion(question) {
  const { negativeSubtype, ...required } = question;
  const inputs = {
    ...question.inputs.text === undefined ? {} : { text: question.inputs.text },
    ...question.inputs.noteId === undefined ? {} : { noteId: question.inputs.noteId },
    ...question.inputs.metadata === undefined ? {} : { metadata: question.inputs.metadata },
    ...question.inputs.graph === undefined ? {} : { graph: question.inputs.graph },
    ...question.inputs.context === undefined ? {} : { context: question.inputs.context },
    ...question.inputs.history === undefined ? {} : { history: question.inputs.history }
  };
  const normalized = { ...required, inputs };
  const result = negativeSubtype === undefined ? normalized : { ...normalized, negativeSubtype };
  return result;
}
function privateJoinKey(questionKey, assessorId) {
  return canonicalJson4([questionKey, assessorId]);
}
function joinPrivateAuthoringShards(shards, expectedBuildContractSha256, declaredAssessorIds, declaredSourceFamilyReviewerIds) {
  if (shards.length === 0)
    return Object.freeze([]);
  const errors = [];
  const declaredAssessors = new Set(declaredAssessorIds);
  const declaredSourceFamilyReviewers = new Set(declaredSourceFamilyReviewerIds);
  const documents = [];
  const specifications = new Map;
  const specificationShardSha256ByQuestionKey = new Map;
  const questionSpecShardSha256ByFamilyKey = new Map;
  const questionSpecShardSha256BySourcePath = new Map;
  const judgments = new Map;
  const adjudications = new Map;
  for (const [shardIndex, shard] of shards.entries()) {
    if (shard.buildContractSha256 !== expectedBuildContractSha256) {
      errors.push(`Private shard ${shardIndex} (${shard.kind}) buildContractSha256 ${shard.buildContractSha256} does not match exact build config ${expectedBuildContractSha256}.`);
    }
    if (shard.kind === "question-specs") {
      const questionSpecShardSha256 = kbEvidenceRoutingPrivateQuestionSpecShardSha256(shard);
      documents.push(...shard.documents);
      for (const document of shard.documents) {
        const familyOwner = questionSpecShardSha256ByFamilyKey.get(document.sourceFamilyKey);
        if (familyOwner !== undefined && familyOwner !== questionSpecShardSha256) {
          errors.push(`Private source family ${document.sourceFamilyKey} spans more than one question-spec shard.`);
        } else {
          questionSpecShardSha256ByFamilyKey.set(document.sourceFamilyKey, questionSpecShardSha256);
        }
        const sourceOwner = questionSpecShardSha256BySourcePath.get(document.sourcePath);
        if (sourceOwner !== undefined && sourceOwner !== questionSpecShardSha256) {
          errors.push(`Private source path ${document.sourcePath} spans more than one question-spec shard.`);
        } else {
          questionSpecShardSha256BySourcePath.set(document.sourcePath, questionSpecShardSha256);
        }
        const undeclaredReviewers = document.sourceFamilyReviewerIds.filter((reviewerId) => !declaredSourceFamilyReviewers.has(reviewerId));
        if (undeclaredReviewers.length > 0) {
          errors.push(`Private source family ${document.sourceFamilyKey} names undeclared assignment reviewers: ${undeclaredReviewers.toSorted().join(", ")}.`);
        }
      }
      for (const specification of shard.questions) {
        if (specifications.has(specification.key)) {
          errors.push(`Private question specification ${specification.key} is ambiguous because it appears more than once.`);
          continue;
        }
        specifications.set(specification.key, specification);
        specificationShardSha256ByQuestionKey.set(specification.key, questionSpecShardSha256);
        const duplicateAssessorIds = duplicates(specification.assignedAssessorIds);
        if (duplicateAssessorIds.length > 0) {
          errors.push(`Private question ${specification.key} repeats assigned assessors: ${duplicateAssessorIds.join(", ")}.`);
        }
        const canonicalAssessorIds = specification.assignedAssessorIds.toSorted();
        if (specification.assignedAssessorIds.some((assessorId, index) => assessorId !== canonicalAssessorIds[index])) {
          errors.push(`Private question ${specification.key} assignedAssessorIds must be in canonical order.`);
        }
        const undeclared = specification.assignedAssessorIds.filter((assessorId) => !declaredAssessors.has(assessorId)).toSorted();
        if (undeclared.length > 0) {
          errors.push(`Private question ${specification.key} assigns undeclared assessors: ${undeclared.join(", ")}.`);
        }
      }
      continue;
    }
    if (shard.kind === "assessor-judgments") {
      if (!declaredAssessors.has(shard.assessorId)) {
        errors.push(`Private assessor-judgment shard names undeclared assessor ${shard.assessorId}.`);
      }
      for (const judgment of shard.judgments) {
        const key = privateJoinKey(judgment.questionKey, shard.assessorId);
        if (judgments.has(key)) {
          errors.push(`Private judgment (${judgment.questionKey}, ${shard.assessorId}) appears more than once.`);
          continue;
        }
        judgments.set(key, Object.freeze({ assessorId: shard.assessorId, judgment }));
      }
      continue;
    }
    for (const adjudication of shard.adjudications) {
      if (adjudications.has(adjudication.questionKey)) {
        errors.push(`Private question ${adjudication.questionKey} has more than one adjudication.`);
        continue;
      }
      adjudications.set(adjudication.questionKey, adjudication);
    }
  }
  for (const { assessorId, judgment } of judgments.values()) {
    const { questionKey } = judgment;
    const specification = specifications.get(questionKey);
    if (specification === undefined) {
      errors.push(`Private judgment (${questionKey}, ${assessorId}) has no shared question specification.`);
      continue;
    }
    if (!specification.assignedAssessorIds.includes(assessorId)) {
      errors.push(`Private judgment (${questionKey}, ${assessorId}) is extra; that assessor is not assigned.`);
    }
    const expectedSpecSha256 = kbEvidenceRoutingPrivateQuestionSpecSha256(specification);
    if (judgment.questionSpecSha256 !== expectedSpecSha256) {
      errors.push(`Private judgment (${questionKey}, ${assessorId}) questionSpecSha256 does not match the shared specification.`);
    }
    const expectedShardSha256 = specificationShardSha256ByQuestionKey.get(questionKey);
    if (judgment.questionSpecShardSha256 !== expectedShardSha256) {
      errors.push(`Private judgment (${questionKey}, ${assessorId}) questionSpecShardSha256 does not match the shared question-spec shard.`);
    }
  }
  for (const [questionKey, adjudication] of adjudications) {
    const specification = specifications.get(questionKey);
    if (specification === undefined) {
      errors.push(`Private adjudication ${questionKey} has no shared question specification.`);
      continue;
    }
    const expectedSpecSha256 = kbEvidenceRoutingPrivateQuestionSpecSha256(specification);
    if (adjudication.questionSpecSha256 !== expectedSpecSha256) {
      errors.push(`Private adjudication ${questionKey} questionSpecSha256 does not match the shared specification.`);
    }
    const expectedShardSha256 = specificationShardSha256ByQuestionKey.get(questionKey);
    if (adjudication.questionSpecShardSha256 !== expectedShardSha256) {
      errors.push(`Private adjudication ${questionKey} questionSpecShardSha256 does not match the shared question-spec shard.`);
    }
  }
  for (const [questionKey, specification] of specifications) {
    for (const assessorId of specification.assignedAssessorIds) {
      if (!judgments.has(privateJoinKey(questionKey, assessorId))) {
        errors.push(`Private question ${questionKey} is missing judgment from assigned assessor ${assessorId}.`);
      }
    }
    if (!adjudications.has(questionKey)) {
      errors.push(`Private question ${questionKey} is missing its adjudication.`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Private held-out join failed:
${[...new Set(errors)].toSorted().join(`
`)}`);
  }
  const questions = [...specifications.values()].toSorted((left, right) => left.key.localeCompare(right.key)).map((specification) => {
    const { assignedAssessorIds, ...shared } = specification;
    const finalJudgment = adjudications.get(specification.key);
    if (finalJudgment === undefined)
      throw new Error(`Lost private adjudication ${specification.key}.`);
    const rawAssessments = assignedAssessorIds.map((assessorId) => {
      const binding = judgments.get(privateJoinKey(specification.key, assessorId));
      if (binding === undefined) {
        throw new Error(`Lost private judgment (${specification.key}, ${assessorId}).`);
      }
      const { judgment } = binding;
      return {
        assessorId,
        expectedSupport: judgment.expectedSupport,
        documents: judgment.documents,
        evidenceUnits: judgment.evidenceUnits,
        nuggets: judgment.nuggets
      };
    });
    return {
      ...shared,
      expectedSupport: finalJudgment.expectedSupport,
      gold: finalJudgment.gold,
      rawAssessments,
      adjudication: finalJudgment.adjudication
    };
  });
  for (const question of questions) {
    const questionShardSha256 = specificationShardSha256ByQuestionKey.get(question.key);
    if (questionShardSha256 === undefined)
      continue;
    for (const sourcePath of questionSourcePaths(question)) {
      const sourceShardSha256 = questionSpecShardSha256BySourcePath.get(sourcePath);
      if (sourceShardSha256 !== undefined && sourceShardSha256 !== questionShardSha256) {
        errors.push(`Private question ${question.key} references source ${sourcePath} owned by a different question-spec shard.`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Private held-out join failed:
${[...new Set(errors)].toSorted().join(`
`)}`);
  }
  return Object.freeze([{
    documents: documents.toSorted((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
    questions
  }]);
}
function assertExplicitPromotionQuestionDocuments(questions, metadataByPath) {
  const questionKeysByPath = new Map;
  for (const question of questions) {
    for (const sourcePathInput of questionSourcePaths(question)) {
      const sourcePath = confinedRelativePath(sourcePathInput, `promotion question ${question.key} source path`);
      const questionKeys = questionKeysByPath.get(sourcePath) ?? new Set;
      questionKeys.add(question.key);
      questionKeysByPath.set(sourcePath, questionKeys);
    }
  }
  const missing = [...questionKeysByPath].filter(([sourcePath]) => !metadataByPath.has(sourcePath)).map(([sourcePath, questionKeys]) => `${sourcePath} (${[...questionKeys].toSorted().join(", ")})`).toSorted();
  const reserved = [...questionKeysByPath.keys()].filter((sourcePath) => metadataByPath.get(sourcePath)?.sourceFamilyKey.startsWith("catalog:")).toSorted();
  if (missing.length === 0 && reserved.length === 0)
    return;
  throw new Error([
    "Promotion question sources require explicit reviewed document metadata and sourceFamilyKey; inferred catalog metadata is catalog-only.",
    ...missing.length === 0 ? [] : [`Missing reviewed documents: ${missing.join("; ")}.`],
    ...reserved.length === 0 ? [] : [`Reviewed promotion sources must not use the reserved catalog: family prefix: ${reserved.join(", ")}.`]
  ].join(`
`));
}
function isolationPartition(shards, label) {
  const questions = shards.flatMap(({ questions: shardQuestions }) => shardQuestions);
  const familyByPath = new Map;
  for (const [documentIndex, document] of shards.flatMap(({ documents }) => documents).entries()) {
    const sourcePath = confinedRelativePath(document.sourcePath, `${label}.documents[${documentIndex}].sourcePath`);
    const previous = familyByPath.get(sourcePath);
    if (previous !== undefined && previous !== document.sourceFamilyKey) {
      throw new Error(`${label} assigns source path ${sourcePath} to conflicting source families ${previous} and ${document.sourceFamilyKey}.`);
    }
    familyByPath.set(sourcePath, document.sourceFamilyKey);
  }
  const sourcePaths = new Set(familyByPath.keys());
  for (const question of questions) {
    for (const sourcePathInput of questionSourcePaths(question)) {
      sourcePaths.add(confinedRelativePath(sourcePathInput, `${label} question ${question.key} source path`));
    }
  }
  const sourceFamilies = new Set([...sourcePaths].map((sourcePath) => familyByPath.get(sourcePath) ?? `catalog:${sourcePath}`));
  return Object.freeze({
    questions: Object.freeze(questions),
    sourcePaths,
    sourceFamilies
  });
}
function intersections(left, right) {
  return [...left].filter((value) => right.has(value)).toSorted();
}
function assertVisibleHeldOutIsolation(options) {
  const visible = isolationPartition([...options.development, ...options.qa], "visible authoring");
  const heldOut = isolationPartition(options.heldOut, "private held-out authoring");
  const errors = [];
  const heldOutKeys = new Set(heldOut.questions.map(({ key }) => key));
  const repeatedKeys = [...new Set(visible.questions.map(({ key }) => key).filter((key) => heldOutKeys.has(key)))].toSorted();
  if (repeatedKeys.length > 0) {
    errors.push(`Visible and private held-out question keys overlap: ${repeatedKeys.join(", ")}.`);
  }
  const visibleNormalized = new Map;
  for (const question of visible.questions) {
    const normalized = normalizedPrompt2(question.text);
    const keys = visibleNormalized.get(normalized) ?? [];
    keys.push(question.key);
    visibleNormalized.set(normalized, keys);
  }
  const heldOutNormalized = new Map;
  for (const question of heldOut.questions) {
    const normalized = normalizedPrompt2(question.text);
    const keys = heldOutNormalized.get(normalized) ?? [];
    keys.push(question.key);
    heldOutNormalized.set(normalized, keys);
  }
  for (const normalized of [...visibleNormalized.keys()].filter((value) => value !== "" && heldOutNormalized.has(value)).toSorted()) {
    errors.push(`Visible questions ${(visibleNormalized.get(normalized) ?? []).toSorted().join(", ")} and private held-out questions ${(heldOutNormalized.get(normalized) ?? []).toSorted().join(", ")} share one normalized prompt.`);
  }
  const visibleGrams = new Map(visible.questions.map((question) => [
    question,
    promptNgrams(question.text, options.ngramSize)
  ]));
  const heldOutGrams = new Map(heldOut.questions.map((question) => [
    question,
    promptNgrams(question.text, options.ngramSize)
  ]));
  for (const visibleQuestion of visible.questions) {
    for (const heldOutQuestion of heldOut.questions) {
      if (normalizedPrompt2(visibleQuestion.text) === normalizedPrompt2(heldOutQuestion.text))
        continue;
      const overlap = jaccard2(visibleGrams.get(visibleQuestion) ?? new Set, heldOutGrams.get(heldOutQuestion) ?? new Set);
      if (overlap < options.crossSplitNgramThreshold)
        continue;
      errors.push(`Visible question ${visibleQuestion.key} and private held-out question ${heldOutQuestion.key} have ${overlap.toFixed(6)} ${options.ngramSize}-gram Jaccard overlap.`);
    }
  }
  const repeatedPaths = intersections(visible.sourcePaths, heldOut.sourcePaths);
  if (repeatedPaths.length > 0) {
    errors.push(`Visible and private held-out source paths overlap: ${repeatedPaths.join(", ")}.`);
  }
  const repeatedFamilies = intersections(visible.sourceFamilies, heldOut.sourceFamilies);
  if (repeatedFamilies.length > 0) {
    errors.push(`Visible and private held-out source families overlap: ${repeatedFamilies.join(", ")}.`);
  }
  const visiblePathsBySha = new Map;
  for (const sourcePath of visible.sourcePaths) {
    const digest = options.sourceSha256ByPath.get(sourcePath);
    if (digest === undefined) {
      errors.push(`Visible source path ${sourcePath} is absent from the frozen Markdown catalog.`);
      continue;
    }
    const paths = visiblePathsBySha.get(digest) ?? [];
    paths.push(sourcePath);
    visiblePathsBySha.set(digest, paths);
  }
  const heldOutPathsBySha = new Map;
  for (const sourcePath of heldOut.sourcePaths) {
    const digest = options.sourceSha256ByPath.get(sourcePath);
    if (digest === undefined) {
      errors.push(`Private held-out source path ${sourcePath} is absent from the frozen Markdown catalog.`);
      continue;
    }
    const paths = heldOutPathsBySha.get(digest) ?? [];
    paths.push(sourcePath);
    heldOutPathsBySha.set(digest, paths);
  }
  for (const digest of [...visiblePathsBySha.keys()].filter((value) => heldOutPathsBySha.has(value)).toSorted()) {
    errors.push(`Visible sources ${(visiblePathsBySha.get(digest) ?? []).toSorted().join(", ")} and private held-out sources ${(heldOutPathsBySha.get(digest) ?? []).toSorted().join(", ")} contain byte-identical frozen content (${digest}).`);
  }
  if (errors.length > 0) {
    throw new Error(`Visible/private held-out isolation failed:
${errors.toSorted().join(`
`)}`);
  }
}
function compileOrThrow(input) {
  const compilation = compileRetrievalEvaluationCorpusAuthoringV2(input);
  if (!compilation.ok) {
    throw new Error(compilation.errors.map(({ code, message: message2 }) => `${code}: ${message2}`).join(`
`));
  }
  return compilation;
}
function assertKbEvidenceRoutingVisibleReviewReady(diagnostics) {
  const failedQuotas = diagnostics.quotaLedger.filter(({ met }) => !met).map(({ id }) => id).toSorted();
  if (failedQuotas.length > 0 || !diagnostics.labelPredictability.met) {
    throw new Error([
      "Visible development and QA review is not ready.",
      ...failedQuotas.length === 0 ? [] : [`Failed exact quota or balance rows: ${failedQuotas.join(", ")}.`],
      ...diagnostics.labelPredictability.met ? [] : ["Prompt labels exceed the sealed text-only predictability ceiling."],
      "Visible QA paired-power diagnostics remain review-only and are not promotion evidence."
    ].join(`
`));
  }
}
function parseExternalSeal(input) {
  return parseSchema(z.strictObject({ expectedCorpusSha256: sha256Schema }), input, "external seal");
}
async function loadConfig(configPathInput) {
  if (configPathInput.trim() === "")
    throw new Error("An explicit config path is required.");
  const configPath = resolve2(configPathInput);
  if (await realpath2(configPath) !== configPath) {
    throw new Error("build config path must be canonical and must not traverse a symbolic link.");
  }
  const file = await secureReadAbsoluteFile(configPath, MAX_CONFIG_BYTES, "build config", { requireReadOnly: true });
  if (await realpath2(configPath) !== configPath) {
    throw new Error("build config path changed or began traversing a symbolic link while it was read.");
  }
  const config = parseSchema(kbEvidenceRoutingEvaluationBuildConfigSchema, parseJson(file.bytes, "build config"), "build config");
  if (!file.bytes.equals(canonicalJsonBytes(config))) {
    throw new Error("build config must contain the exact canonical JSON bytes for its parsed value.");
  }
  return { configPath, file, config };
}
async function frozenMarkdownPaths(config, repositoryRoot, runGit) {
  const revision = config.frozen.vaultRoot === "." ? `${config.frozen.repositoryCommit}^{tree}` : `${config.frozen.repositoryCommit}:${config.frozen.vaultRoot}`;
  const bytes = await requiredGitOutput(runGit, repositoryRoot, ["ls-tree", "-r", "-z", "--name-only", revision], MAX_VAULT_LIST_BYTES, "Frozen vault Markdown catalog");
  if (bytes.byteLength === 0 || bytes.at(-1) !== 0) {
    throw new Error("Frozen vault file catalog must be non-empty NUL-delimited Git output.");
  }
  const paths = bytes.subarray(0, -1).toString("utf8").split("\x00").map((path, index) => confinedRelativePath(path, `frozen vault entry ${index}`)).filter((path) => path.endsWith(".md"));
  assertNoDuplicates(paths, "Frozen vault Markdown paths");
  if (paths.length === 0 || paths.length > MAX_EVALUATION_EVIDENCE_DOCUMENTS) {
    throw new Error(`Frozen vault must contain from 1 through ${MAX_EVALUATION_EVIDENCE_DOCUMENTS} Markdown documents.`);
  }
  return Object.freeze(paths.toSorted());
}
function derivedDocumentMetadata(sourcePath) {
  const capture = sourcePath.startsWith("sources/");
  return Object.freeze({
    sourcePath,
    sourceFamilyKey: `catalog:${sourcePath}`,
    sourceClass: capture ? "captured-source" : "authored-note",
    trustClass: capture ? "untrusted-capture" : "maintained-synthesis"
  });
}
function partitionDocumentMetadata(shards, label) {
  const byPath = new Map;
  for (const [index, metadata] of shards.flatMap(({ documents }) => documents).entries()) {
    const sourcePath = confinedRelativePath(metadata.sourcePath, `${label}.documents[${index}].sourcePath`);
    const previous = byPath.get(sourcePath);
    if (previous !== undefined && !canonicalJsonBytes(previous).equals(canonicalJsonBytes(metadata)))
      throw new Error(`${label} gives source path ${sourcePath} conflicting document metadata.`);
    byPath.set(sourcePath, metadata);
  }
  return byPath;
}
async function readAuthoringShards(root, paths, label) {
  let aggregateBytes = 0;
  const files = [];
  const shards = [];
  for (const path of paths) {
    const file = await secureReadRepositoryFile(root, path, Math.min(MAX_SHARD_BYTES, MAX_TOTAL_SHARD_BYTES - aggregateBytes), `${label} ${path}`);
    aggregateBytes += file.bytes.byteLength;
    if (aggregateBytes > MAX_TOTAL_SHARD_BYTES) {
      throw new Error(`${label} shards exceed ${MAX_TOTAL_SHARD_BYTES} aggregate bytes.`);
    }
    files.push(file);
    shards.push(parseSchema(kbEvidenceRoutingAuthoringShardSchema, parseJson(file.bytes, `${label} ${path}`), `${label} ${path}`));
  }
  return Object.freeze({ files: Object.freeze(files), shards: Object.freeze(shards) });
}
async function readPrivateAuthoringShards(root, paths, label) {
  let aggregateBytes = 0;
  const files = [];
  const shards = [];
  for (const path of paths) {
    const file = await secureReadRepositoryFile(root, path, Math.min(MAX_SHARD_BYTES, MAX_TOTAL_SHARD_BYTES - aggregateBytes), `${label} ${path}`);
    aggregateBytes += file.bytes.byteLength;
    if (aggregateBytes > MAX_TOTAL_SHARD_BYTES) {
      throw new Error(`${label} shards exceed ${MAX_TOTAL_SHARD_BYTES} aggregate bytes.`);
    }
    files.push(file);
    shards.push(parseSchema(kbEvidenceRoutingPrivateAuthoringShardSchema, parseJson(file.bytes, `${label} ${path}`), `${label} ${path}`));
  }
  return Object.freeze({ files: Object.freeze(files), shards: Object.freeze(shards) });
}
async function loadKbEvidenceRoutingEvaluationAuthoring(configPathInput, dependencies = {}) {
  const loadedConfig = await loadConfig(configPathInput);
  const { config } = loadedConfig;
  const repositoryRoot = await canonicalRepositoryRoot(config.repositoryRoot, loadedConfig.configPath);
  const artifactRoot = await canonicalArtifactRoot(dependencies.artifactRoot, repositoryRoot);
  const runGit = dependencies.runGit ?? runGitCommand;
  const vaultRoot = confinedRelativePath(config.frozen.vaultRoot, "frozen.vaultRoot");
  await assertRepositoryComponents(repositoryRoot, vaultRoot, "directory");
  const developmentPaths = config.shards.development.map((path, index) => requireAuthoringPath(path, `shards.development[${index}]`));
  const qaPaths = config.shards.qa.map((path, index) => requireAuthoringPath(path, `shards.qa[${index}]`));
  const heldOutPaths = config.shards.heldOut.map((path, index) => requireHeldOutPath(path, `shards.heldOut[${index}]`));
  assertNoDuplicates(developmentPaths, "shards.development");
  assertNoDuplicates(qaPaths, "shards.qa");
  assertNoDuplicates(heldOutPaths, "shards.heldOut");
  assertNoDuplicates([...developmentPaths, ...qaPaths], "Visible development and QA shard paths");
  const [development, qa, heldOut] = await Promise.all([
    readAuthoringShards(repositoryRoot, developmentPaths, "development authoring shard"),
    readAuthoringShards(repositoryRoot, qaPaths, "QA authoring shard"),
    readPrivateAuthoringShards(artifactRoot, heldOutPaths, "held-out artifact-B shard")
  ]);
  const totalShardBytes = [...development.files, ...qa.files, ...heldOut.files].reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (totalShardBytes > MAX_TOTAL_SHARD_BYTES) {
    throw new Error(`All development, QA, and held-out shards exceed ${MAX_TOTAL_SHARD_BYTES} aggregate bytes.`);
  }
  const joinedHeldOutShards = joinPrivateAuthoringShards(heldOut.shards, kbEvidenceRoutingBuildContractSha256(loadedConfig.file.bytes), config.assessment.assessors.map(({ id }) => id), config.reviewPolicy.sourceFamilyAssignment.reviewerIds);
  const shardFiles = Object.freeze([...development.files, ...heldOut.files]);
  const shards = Object.freeze([...development.shards, ...joinedHeldOutShards]);
  const shardPayloadFingerprints = [
    ...development.shards,
    ...qa.shards,
    ...heldOut.shards
  ].map((shard) => sha2565(canonicalJsonBytes(shard)));
  assertNoDuplicates(shardPayloadFingerprints, "Authoring shard payloads");
  const documentMetadata = shards.flatMap(({ documents: documents2 }) => documents2);
  const questions = shards.flatMap(({ questions: questions2 }) => questions2);
  if (questions.length === 0 || questions.length > MAX_EVALUATION_V2_QUERIES) {
    throw new Error(`Authoring shards must declare from 1 through ${MAX_EVALUATION_V2_QUERIES} questions.`);
  }
  assertNoDuplicates(documentMetadata.map(({ sourcePath }) => sourcePath), "Document source paths");
  for (const [index, metadata] of documentMetadata.entries()) {
    const sourcePath = confinedRelativePath(metadata.sourcePath, `documents[${index}].sourcePath`);
    if (!sourcePath.endsWith(".md")) {
      throw new Error(`documents[${index}].sourcePath must name a Markdown file.`);
    }
  }
  assertNoDuplicates(documentMetadata.flatMap(({ documentId }) => documentId === undefined ? [] : [documentId]), "Explicit document IDs");
  assertNoDuplicates(questions.map(({ key }) => key), "Question keys");
  const metadataByPath = new Map(documentMetadata.map((metadata) => [metadata.sourcePath, metadata]));
  assertExplicitPromotionQuestionDocuments(questions, metadataByPath);
  const catalogPaths = await frozenMarkdownPaths(config, repositoryRoot, runGit);
  const missingDeclared = [...metadataByPath.keys()].filter((path) => !catalogPaths.includes(path)).toSorted();
  if (missingDeclared.length > 0) {
    throw new Error(`Authoring metadata names Markdown absent from the frozen vault: ${missingDeclared.join(", ")}.`);
  }
  let aggregateSourceBytes = 0;
  const sourceFiles = [];
  const documents = [];
  for (const sourcePath of catalogPaths) {
    const metadata = metadataByPath.get(sourcePath) ?? derivedDocumentMetadata(sourcePath);
    const repositoryPath = vaultRoot === "." ? sourcePath : `${vaultRoot}/${sourcePath}`;
    const bytes = await requiredGitOutput(runGit, repositoryRoot, ["show", `${config.frozen.repositoryCommit}:${repositoryPath}`], Math.min(MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES, MAX_EVALUATION_EVIDENCE_TOTAL_BYTES - aggregateSourceBytes), `frozen Markdown ${sourcePath}`);
    const sourceFile = {
      absolutePath: `${config.frozen.repositoryCommit}:${repositoryPath}`,
      relativePath: repositoryPath,
      bytes,
      sha256: sha2565(bytes)
    };
    aggregateSourceBytes += sourceFile.bytes.byteLength;
    if (aggregateSourceBytes > MAX_EVALUATION_EVIDENCE_TOTAL_BYTES) {
      throw new Error(`Frozen Markdown exceeds ${MAX_EVALUATION_EVIDENCE_TOTAL_BYTES} aggregate bytes.`);
    }
    let markdown;
    try {
      markdown = new TextDecoder("utf-8", { fatal: true }).decode(sourceFile.bytes);
    } catch {
      throw new Error(`Frozen Markdown ${sourcePath} is not valid UTF-8.`);
    }
    sourceFiles.push({ ...sourceFile, sourcePath, markdown });
    documents.push({
      ...metadata.documentId === undefined ? {} : { documentId: metadata.documentId },
      sourcePath,
      markdown,
      sourceFamilyKey: metadata.sourceFamilyKey,
      sourceClass: metadata.sourceClass,
      trustClass: metadata.trustClass,
      ...metadata.sourceFamilyRationale === undefined ? {} : { sourceFamilyRationale: metadata.sourceFamilyRationale },
      ...metadata.sourceFamilyReviewerIds === undefined ? {} : { sourceFamilyReviewerIds: metadata.sourceFamilyReviewerIds }
    });
  }
  assertVisibleHeldOutIsolation({
    development: development.shards,
    qa: qa.shards,
    heldOut: joinedHeldOutShards,
    sourceSha256ByPath: new Map(sourceFiles.map(({ sourcePath, sha256: digest }) => [
      sourcePath,
      digest
    ])),
    ngramSize: config.reviewPolicy.ngramSize ?? 3,
    crossSplitNgramThreshold: config.reviewPolicy.crossSplitNgramThreshold ?? 0.8
  });
  const outputRelativePaths = [
    config.outputs.corpus,
    config.outputs.externalSeal,
    config.outputs.summary
  ].map((path, index) => confinedRelativePath(path, `outputs[${index}]`));
  assertNoDuplicates(outputRelativePaths, "Output paths");
  const occupiedInputs = new Set(heldOutPaths);
  for (const outputPath of outputRelativePaths) {
    if (occupiedInputs.has(outputPath)) {
      throw new Error(`Output path ${outputPath} collides with an authoring input.`);
    }
  }
  const [corpusOutput, sealOutput, summaryOutput] = await Promise.all(outputRelativePaths.map((path, index) => validateOutputPath(artifactRoot, path, `outputs[${index}]`)));
  if (corpusOutput === undefined || sealOutput === undefined || summaryOutput === undefined) {
    throw new Error("All three output paths are required.");
  }
  const configCanonicalPath = await realpath2(loadedConfig.configPath);
  if ([corpusOutput, sealOutput, summaryOutput].includes(configCanonicalPath)) {
    throw new Error("An output path must not replace the checked build config.");
  }
  const reviewPolicy = {
    ...config.reviewPolicy.ngramSize === undefined ? {} : { ngramSize: config.reviewPolicy.ngramSize },
    ...config.reviewPolicy.crossSplitNgramThreshold === undefined ? {} : { crossSplitNgramThreshold: config.reviewPolicy.crossSplitNgramThreshold },
    ...config.reviewPolicy.labelPredictabilityCeiling === undefined ? {} : { labelPredictabilityCeiling: config.reviewPolicy.labelPredictabilityCeiling },
    sourceFamilyAssignment: config.reviewPolicy.sourceFamilyAssignment
  };
  const input = {
    id: config.id,
    description: config.description,
    sealedAt: config.sealedAt,
    buildContractSha256: kbEvidenceRoutingBuildContractSha256(loadedConfig.file.bytes),
    frozen: config.frozen,
    assessment: {
      rubricVersion: config.assessment.rubricVersion,
      assessors: config.assessment.assessors.map((assessor) => ({
        id: assessor.id,
        ...assessor.displayName === undefined ? {} : { displayName: assessor.displayName },
        ...assessor.affiliation === undefined ? {} : { affiliation: assessor.affiliation }
      }))
    },
    experiment: config.experiment,
    documents,
    questions: questions.map(promotionQuestion),
    measurementProfiles: config.measurementProfiles,
    retrievers: config.retrievers,
    baselineRetrieverId: config.baselineRetrieverId,
    evidenceParserVersion: config.evidenceParserVersion,
    reviewPolicy
  };
  const visibleMetadataByPath = partitionDocumentMetadata([...development.shards, ...qa.shards], "visible development and QA authoring");
  const visibleDocuments = sourceFiles.map((source) => {
    const metadata = visibleMetadataByPath.get(source.sourcePath) ?? derivedDocumentMetadata(source.sourcePath);
    return {
      ...metadata.documentId === undefined ? {} : { documentId: metadata.documentId },
      sourcePath: source.sourcePath,
      markdown: source.markdown,
      sourceFamilyKey: metadata.sourceFamilyKey,
      sourceClass: metadata.sourceClass,
      trustClass: metadata.trustClass,
      ...metadata.sourceFamilyRationale === undefined ? {} : { sourceFamilyRationale: metadata.sourceFamilyRationale },
      ...metadata.sourceFamilyReviewerIds === undefined ? {} : { sourceFamilyReviewerIds: metadata.sourceFamilyReviewerIds }
    };
  });
  const visibleReview = compileOrThrow({
    ...input,
    documents: visibleDocuments,
    questions: [...development.shards, ...qa.shards].flatMap(({ questions: visibleQuestions }) => visibleQuestions).map(promotionQuestion)
  });
  return {
    configPath: loadedConfig.configPath,
    configBytes: loadedConfig.file.bytes,
    config,
    repositoryRoot,
    input,
    visibleReview,
    shardFiles,
    qaShardFiles: qa.files,
    sourceFiles,
    artifactRoot,
    outputPaths: {
      corpus: corpusOutput,
      externalSeal: sealOutput,
      summary: summaryOutput
    }
  };
}
async function compileKbEvidenceRoutingEvaluationAuthoring(configPath, dependencies = {}) {
  const loaded = await loadKbEvidenceRoutingEvaluationAuthoring(configPath, dependencies);
  return { loaded, compilation: compileOrThrow(loaded.input) };
}
async function existingOutputBytes(path, maximumBytes) {
  try {
    return (await secureReadAbsoluteFile(path, maximumBytes, `existing output ${path}`)).bytes;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
}
async function assertInstallable(path, bytes) {
  const existing = await existingOutputBytes(path, Math.max(MAX_OUTPUT_BYTES, bytes.byteLength));
  if (existing === undefined)
    return "missing";
  if (!existing.equals(bytes)) {
    throw new Error(`Refusing to overwrite non-identical output ${path}. Version the corpus or choose a new path.`);
  }
  return "unchanged";
}
async function writeTemporary(path, bytes) {
  if (bytes.byteLength > MAX_OUTPUT_BYTES)
    throw new Error(`Output ${path} exceeds ${MAX_OUTPUT_BYTES} bytes.`);
  const temporaryPath = resolve2(dirname2(path), `.${basename2(path)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`);
  const handle = await open2(temporaryPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 384);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.chmod(420);
  } catch (error) {
    await handle.close();
    await unlink(temporaryPath).catch(() => {
      return;
    });
    throw error;
  }
  await handle.close();
  return temporaryPath;
}
async function installNoReplace(path, bytes) {
  const disposition = await assertInstallable(path, bytes);
  if (disposition === "unchanged")
    return disposition;
  const temporaryPath = await writeTemporary(path, bytes);
  try {
    try {
      await link(temporaryPath, path);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
        const existing = await secureReadAbsoluteFile(path, MAX_OUTPUT_BYTES, `racing output ${path}`);
        if (!existing.bytes.equals(bytes)) {
          throw new Error(`Refusing to replace concurrently written non-identical output ${path}.`);
        }
        return "unchanged";
      }
      throw error;
    }
    return "installed";
  } finally {
    await unlink(temporaryPath).catch(() => {
      return;
    });
  }
}
async function readCanonicalCorpus(path) {
  const file = await secureReadAbsoluteFile(path, MAX_OUTPUT_BYTES, "persisted corpus");
  const corpus = parseRetrievalEvaluationCorpusV2(parseJson(file.bytes, "persisted corpus"), {
    claimPromotion: false
  });
  const expected = canonicalJsonBytes(corpus);
  if (!file.bytes.equals(expected)) {
    throw new Error("Persisted corpus is not canonical JSON with one final newline.");
  }
  return { corpus, bytes: file.bytes };
}
async function readCanonicalSeal(path) {
  const file = await secureReadAbsoluteFile(path, MAX_OUTPUT_BYTES, "persisted external seal");
  const seal = parseExternalSeal(parseJson(file.bytes, "persisted external seal"));
  const expected = canonicalJsonBytes(seal);
  if (!file.bytes.equals(expected)) {
    throw new Error("Persisted external seal is not canonical JSON with one final newline.");
  }
  return { seal, bytes: file.bytes };
}
async function readCanonicalSummary(path) {
  const file = await secureReadAbsoluteFile(path, MAX_OUTPUT_BYTES, "persisted SHA summary");
  const summary = parseSchema(kbEvidenceRoutingEvaluationShaSummarySchema, parseJson(file.bytes, "persisted SHA summary"), "persisted SHA summary");
  const expected = canonicalJsonBytes(summary);
  if (!file.bytes.equals(expected)) {
    throw new Error("Persisted SHA summary is not canonical JSON with one final newline.");
  }
  return { summary, bytes: file.bytes };
}
function shaSummary(loaded, corpus, corpusBytes, sealBytes) {
  return {
    schemaVersion: 1,
    corpus: {
      path: loaded.config.outputs.corpus,
      byteLength: corpusBytes.byteLength,
      outputSha256: sha2565(corpusBytes),
      committedCorpusSha256: corpus.manifest.corpusSha256
    },
    externalSeal: {
      path: loaded.config.outputs.externalSeal,
      byteLength: sealBytes.byteLength,
      outputSha256: sha2565(sealBytes)
    },
    authoring: {
      configSha256: kbEvidenceRoutingBuildContractSha256(loaded.configBytes),
      shards: loaded.shardFiles.map((file) => ({
        path: file.relativePath ?? file.absolutePath,
        byteLength: file.bytes.byteLength,
        sha256: file.sha256
      })),
      qaShards: loaded.qaShardFiles.map((file) => ({
        path: file.relativePath ?? file.absolutePath,
        byteLength: file.bytes.byteLength,
        sha256: file.sha256
      })),
      sources: loaded.sourceFiles.map((file) => ({
        sourcePath: file.sourcePath,
        byteLength: file.bytes.byteLength,
        sha256: file.sha256
      })).toSorted((left, right) => left.sourcePath.localeCompare(right.sourcePath))
    },
    counts: {
      documents: corpus.documents.length,
      evidenceUnits: corpus.evidenceUnits.length,
      questions: corpus.queries.length
    },
    visibleReview: {
      questions: loaded.visibleReview.corpus.queries.length,
      exactQuotaAndBalanceMet: loaded.visibleReview.diagnostics.quotaLedger.every(({ met }) => met),
      labelPredictabilityMet: loaded.visibleReview.diagnostics.labelPredictability.met,
      pairedPowerMet: loaded.visibleReview.diagnostics.pairedPower.met,
      diagnosticsSha256: sha2565(canonicalJsonBytes(loaded.visibleReview.diagnostics))
    }
  };
}
async function validatePersistedPromotion(configPath, expected, dependencies = {}) {
  const loaded = await loadKbEvidenceRoutingEvaluationAuthoring(configPath, dependencies);
  if (loaded.config.shards.qa.length > 0) {
    assertKbEvidenceRoutingVisibleReviewReady(loaded.visibleReview.diagnostics);
  }
  if (loaded.config.shards.heldOut.length === 0) {
    throw new Error("Promotion build requires held-out shards supplied only by artifact B.");
  }
  await verifyKbEvidenceRoutingFrozenSources(loaded, dependencies);
  if (expected !== undefined && !loaded.configBytes.equals(expected.configBytes)) {
    throw new Error("Build config changed after the corpus seal was persisted.");
  }
  if (expected !== undefined && (loaded.outputPaths.corpus !== expected.outputPaths.corpus || loaded.outputPaths.externalSeal !== expected.outputPaths.externalSeal || loaded.outputPaths.summary !== expected.outputPaths.summary))
    throw new Error("Output paths changed after the corpus seal was persisted.");
  const [persistedCorpus, persistedSeal] = await Promise.all([
    readCanonicalCorpus(loaded.outputPaths.corpus),
    readCanonicalSeal(loaded.outputPaths.externalSeal)
  ]);
  if (persistedSeal.seal.expectedCorpusSha256 !== persistedCorpus.corpus.manifest.corpusSha256) {
    throw new Error("Persisted external seal does not commit the persisted corpus.");
  }
  const promotion = compilePromotionCorpusAuthoringV2(loaded.input, persistedSeal.seal);
  if (!promotion.ok) {
    throw new Error(promotion.errors.map(({ code, message: message2 }) => `${code}: ${message2}`).join(`
`));
  }
  const promotedBytes = canonicalJsonBytes(promotion.corpus);
  if (!promotedBytes.equals(persistedCorpus.bytes)) {
    throw new Error("Persisted corpus bytes differ from the independently validated promotion corpus.");
  }
  return {
    loaded,
    corpus: promotion.corpus,
    externalSeal: persistedSeal.seal,
    corpusBytes: persistedCorpus.bytes,
    sealBytes: persistedSeal.bytes
  };
}
async function validatePersistedKbEvidenceRoutingPromotion(configPath, dependencies = {}) {
  const validation = await validatePersistedPromotion(configPath, undefined, dependencies);
  return { corpus: validation.corpus, externalSeal: validation.externalSeal };
}
async function validatePersistedKbEvidenceRoutingBuild(configPath, dependencies = {}) {
  const validation = await validatePersistedPromotion(configPath, undefined, dependencies);
  const persistedSummary = await readCanonicalSummary(validation.loaded.outputPaths.summary);
  const expectedSummary = shaSummary(validation.loaded, validation.corpus, validation.corpusBytes, validation.sealBytes);
  const expectedBytes = canonicalJsonBytes(expectedSummary);
  if (!persistedSummary.bytes.equals(expectedBytes)) {
    throw new Error("Persisted SHA summary differs from the freshly validated immutable build inputs.");
  }
  return Object.freeze({
    corpus: validation.corpus,
    externalSeal: validation.externalSeal,
    summary: persistedSummary.summary,
    summaryOutputSha256: sha2565(persistedSummary.bytes)
  });
}
async function anchorKbEvidenceRoutingEvaluationSeal(configPath, dependencies = {}) {
  const loaded = await loadKbEvidenceRoutingEvaluationAuthoring(configPath, dependencies);
  if (loaded.config.shards.qa.length > 0) {
    assertKbEvidenceRoutingVisibleReviewReady(loaded.visibleReview.diagnostics);
  }
  if (loaded.config.shards.heldOut.length === 0) {
    throw new Error("Seal anchoring requires held-out shards supplied only by artifact B.");
  }
  await verifyKbEvidenceRoutingFrozenSources(loaded, dependencies);
  const compilation = compileOrThrow(loaded.input);
  if (!compilation.diagnostics.promotionLayoutReady) {
    throw new Error("Seal anchoring requires a promotion-ready quota, label-predictability, and paired-power design.");
  }
  validatePromotionCorpusDesignV2(compilation.corpus);
  const promotion = compilePromotionCorpusAuthoringV2(loaded.input, compilation.externalSeal);
  if (!promotion.ok) {
    throw new Error(promotion.errors.map(({ code, message: message2 }) => `${code}: ${message2}`).join(`
`));
  }
  if (!canonicalJsonBytes(promotion.corpus).equals(canonicalJsonBytes(compilation.corpus))) {
    throw new Error("Promotion validation changed the corpus before seal anchoring.");
  }
  const sealBytes = canonicalJsonBytes(compilation.externalSeal);
  if (await existingOutputBytes(loaded.outputPaths.corpus, MAX_OUTPUT_BYTES) !== undefined) {
    throw new Error("Refusing to anchor a corpus seal after corpus output already exists.");
  }
  if (await existingOutputBytes(loaded.outputPaths.summary, MAX_OUTPUT_BYTES) !== undefined) {
    throw new Error("Refusing to anchor a corpus seal after summary output already exists.");
  }
  const install = await installNoReplace(loaded.outputPaths.externalSeal, sealBytes);
  const persisted = await readCanonicalSeal(loaded.outputPaths.externalSeal);
  if (!persisted.bytes.equals(sealBytes)) {
    throw new Error("Persisted external seal differs from the independently anchored canonical bytes.");
  }
  return Object.freeze({
    externalSeal: persisted.seal,
    outputPath: loaded.config.outputs.externalSeal,
    outputSha256: sha2565(persisted.bytes),
    install
  });
}
async function buildKbEvidenceRoutingEvaluation(configPath, dependencies = {}) {
  const loaded = await loadKbEvidenceRoutingEvaluationAuthoring(configPath, dependencies);
  if (loaded.config.shards.qa.length > 0) {
    assertKbEvidenceRoutingVisibleReviewReady(loaded.visibleReview.diagnostics);
  }
  if (loaded.config.shards.heldOut.length === 0) {
    throw new Error("Promotion build requires held-out shards supplied only by artifact B.");
  }
  await verifyKbEvidenceRoutingFrozenSources(loaded, dependencies);
  const first = { loaded, compilation: compileOrThrow(loaded.input) };
  const corpusBytes = canonicalJsonBytes(first.compilation.corpus);
  let persistedSeal;
  try {
    persistedSeal = await readCanonicalSeal(first.loaded.outputPaths.externalSeal);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new Error("External corpus seal is absent. Run the independent --anchor-seal step first.");
    }
    throw error;
  }
  const promotion = compilePromotionCorpusAuthoringV2(first.loaded.input, persistedSeal.seal);
  if (!promotion.ok) {
    throw new Error(promotion.errors.map(({ code, message: message2 }) => `${code}: ${message2}`).join(`
`));
  }
  const promotedBytes = canonicalJsonBytes(promotion.corpus);
  if (!promotedBytes.equals(corpusBytes)) {
    throw new Error("Promotion validation changed the compiled corpus bytes.");
  }
  await assertInstallable(first.loaded.outputPaths.corpus, corpusBytes);
  const corpusInstall = await installNoReplace(first.loaded.outputPaths.corpus, corpusBytes);
  const validation = await validatePersistedPromotion(configPath, first.loaded, dependencies);
  const summary = shaSummary(validation.loaded, validation.corpus, validation.corpusBytes, validation.sealBytes);
  const summaryBytes = canonicalJsonBytes(summary);
  const summaryInstall = await installNoReplace(validation.loaded.outputPaths.summary, summaryBytes);
  const rereadSummary = await secureReadAbsoluteFile(validation.loaded.outputPaths.summary, MAX_OUTPUT_BYTES, "persisted SHA summary");
  if (!rereadSummary.bytes.equals(summaryBytes)) {
    throw new Error("Persisted SHA summary changed after atomic installation.");
  }
  return {
    corpus: validation.corpus,
    externalSeal: validation.externalSeal,
    summary,
    summaryOutputSha256: sha2565(summaryBytes),
    installs: {
      corpus: corpusInstall,
      externalSeal: "preexisting",
      summary: summaryInstall
    }
  };
}
var kbEvidenceRoutingBuildUsage = "Usage: kb-evaluation-builder <--anchor-seal|--build> --config <checked-config.json> --artifact-root <artifact-B>";
function parseKbEvidenceRoutingBuildCliArguments(arguments_) {
  const mode = arguments_[0];
  const configPath = arguments_[2];
  const artifactRoot = arguments_[4];
  if (arguments_.length !== 5 || mode !== "--anchor-seal" && mode !== "--build" || arguments_[1] !== "--config" || arguments_[3] !== "--artifact-root" || configPath === undefined || configPath.trim() === "" || artifactRoot === undefined || artifactRoot.trim() === "") {
    throw new Error(kbEvidenceRoutingBuildUsage);
  }
  return Object.freeze({ mode: mode.slice(2), configPath, artifactRoot });
}
async function runKbEvidenceRoutingBuildCli(arguments_, dependencies = {}) {
  const options = parseKbEvidenceRoutingBuildCliArguments(arguments_);
  if (options.mode === "anchor-seal") {
    const anchored = await anchorKbEvidenceRoutingEvaluationSeal(options.configPath, {
      artifactRoot: options.artifactRoot,
      ...dependencies
    });
    console.log([
      `External seal ${anchored.install}: ${anchored.outputPath}`,
      `external-seal-output-sha256=${anchored.outputSha256}`,
      `committed-corpus-sha256=${anchored.externalSeal.expectedCorpusSha256}`
    ].join(`
`));
    return anchored;
  }
  const result = await buildKbEvidenceRoutingEvaluation(options.configPath, {
    artifactRoot: options.artifactRoot,
    ...dependencies
  });
  console.log([
    `Corpus ${result.installs.corpus}: ${result.summary.corpus.path}`,
    `corpus-output-sha256=${result.summary.corpus.outputSha256}`,
    `committed-corpus-sha256=${result.summary.corpus.committedCorpusSha256}`,
    `external-seal-output-sha256=${result.summary.externalSeal.outputSha256}`,
    `summary-output-sha256=${result.summaryOutputSha256}`
  ].join(`
`));
  return result;
}
if (import.meta.main) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 1 && (arguments_[0] === "--help" || arguments_[0] === "-h")) {
    console.log(kbEvidenceRoutingBuildUsage);
  } else {
    await runKbEvidenceRoutingBuildCli(arguments_);
  }
}
export {
  verifyKbEvidenceRoutingFrozenSources,
  verifyEvaluationImplementationArtifactV2,
  validatePromotionCorpusV2,
  validatePromotionCorpusDesignV2,
  validatePersistedKbEvidenceRoutingPromotion,
  validatePersistedKbEvidenceRoutingBuild,
  validateEvaluationEvidenceRegistry,
  utf8ByteEvaluationReaderTokenizerV2,
  spawnEvaluationMeasurementChildV2,
  sealRetrievalEvaluationCorpusV2,
  runKnowledgeBaseEvaluationV2,
  runKbEvidenceRoutingBuildCli,
  runExistingLaneClosure,
  resolveEvaluationEvidenceNeighborhood,
  requiredPairedObservationsV2,
  promotionCorpusQuotaLedgerV2,
  promotionCorpusPowerGranularityV2,
  promotionCorpusLabelPredictabilityV2,
  promotionCorpusDiagnosticsV2,
  projectEvaluationExecutionQueryV2,
  parseRetrievalEvaluationReportV2,
  parseRetrievalEvaluationCorpusV2,
  parseKbEvidenceRoutingBuildCliArguments,
  packKnowledgeBaseEvaluationContextV2,
  openKnowledgeBaseEvaluationV2,
  measureEvaluationCacheManifestV2,
  measureEvaluationCacheBytesV2,
  loadKbEvidenceRoutingEvaluationAuthoring,
  knowledgeBaseExistingLaneClosureVariantsV2,
  kbEvidenceRoutingPrivateQuestionSpecShardSha256,
  kbEvidenceRoutingPrivateQuestionSpecShardSchema,
  kbEvidenceRoutingPrivateQuestionSpecSha256,
  kbEvidenceRoutingPrivateQuestionSpecSchema,
  kbEvidenceRoutingPrivateAuthoringShardSchema,
  kbEvidenceRoutingPrivateAssessorJudgmentShardSchema,
  kbEvidenceRoutingPrivateAdjudicationShardSchema,
  kbEvidenceRoutingImplementationSha256,
  kbEvidenceRoutingEvaluationShaSummarySchema,
  kbEvidenceRoutingEvaluationBuildConfigSchema,
  kbEvidenceRoutingBuildUsage,
  kbEvidenceRoutingBuildContractSha256,
  kbEvidenceRoutingAuthoringShardSchema,
  humanAuthoredEvaluationQuestionV2Schema,
  freezeExistingLaneClosureVariant,
  freezeExistingLaneClosureEvidenceRegistry,
  existingLaneClosureStructuralLaneIds,
  executeKnowledgeBaseEvaluationMeasurementChildV2,
  evaluationSourceFamilyClusterIdsV2,
  evaluationRetrieverDescriptorDigestV2,
  evaluationIncrementalMutationSha256V2,
  evaluationImplementationArtifactSha256V2,
  evaluationCorpusGitBlobCommitmentV2,
  evaluationCorpusDigestV2,
  evaluationCandidateLockDigestV2,
  evaluationAnalysisBootstrapSeedV2,
  createKnowledgeBaseExistingLaneClosureDescriptorV2,
  createKnowledgeBaseEvaluationRunnerV2Dependencies,
  createKnowledgeBaseEvaluationRetrieverOperationMeasurerV2,
  createKnowledgeBaseEvaluationRepeatedSampleV2,
  createKnowledgeBaseEvaluationLaneDescriptorsV2,
  createKnowledgeBaseEvaluationFourReaderOpenerV2,
  createKnowledgeBaseEvaluationCacheVerifierV2,
  createEvaluationReaderTokenizerV2,
  createEvaluationExecutionRequestV2,
  countPackedContextProvenanceV2,
  compileRetrievalEvaluationCorpusAuthoringV2,
  compilePromotionCorpusAuthoringV2,
  compileKbEvidenceRoutingEvaluationAuthoring,
  canonicalJsonBytes,
  buildKbEvidenceRoutingEvaluation,
  buildEvaluationEvidenceRegistry,
  assertVerifiedKnowledgeBaseEvaluationV2,
  assertKbEvidenceRoutingVisibleReviewReady,
  assertEvaluationRetrieverLockedV2,
  assertEvaluationImplementationArtifactV2,
  anchorKbEvidenceRoutingEvaluationSeal,
  analyzeRetrievalEvaluationV2,
  adaptVerifiedKnowledgeBaseEvaluationV2,
  RETRIEVAL_EVALUATION_V2_SCHEMA_VERSION,
  RETRIEVAL_EVALUATION_V2_PROTOCOL,
  PROMOTION_TEST_SUPPORTED_COUNT_V2,
  PROMOTION_TEST_QUERY_COUNT_V2,
  PROMOTION_TEST_INSUFFICIENT_COUNT_V2,
  PROMOTION_TEST_COHORT_COUNT_V2,
  PROMOTION_STRATUM_COHORT_DUAL_MINIMUM_V2,
  PROMOTION_STRATUM_COHORT_DUAL_FRACTION_V2,
  PROMOTION_EVALUATION_QUERY_COUNT_V2,
  PROMOTION_DUAL_ASSESSMENT_MINIMUM_V2,
  PROMOTION_DEVELOPMENT_QUERY_COUNT_V2,
  PROMOTION_CRITICAL_STRATUM_MINIMA_V2,
  PROMOTION_CRITICAL_INPUT_MINIMA_V2,
  PROMOTION_COHORT_COUNT_V2,
  PROMOTION_ACCEPTANCE_STRATUM_MINIMA_V2,
  PROMOTION_ACCEPTANCE_STRATUM_COHORT_MINIMA_V2,
  MAX_EXISTING_LANE_CLOSURE_TOTAL_EVIDENCE_UNITS,
  MAX_EXISTING_LANE_CLOSURE_TOTAL_CANDIDATES,
  MAX_EXISTING_LANE_CLOSURE_RESULTS,
  MAX_EXISTING_LANE_CLOSURE_PROVENANCE_BYTES,
  MAX_EXISTING_LANE_CLOSURE_EVIDENCE_UNITS,
  MAX_EXISTING_LANE_CLOSURE_EVIDENCE_BYTES,
  MAX_EXISTING_LANE_CLOSURE_DIAGNOSTICS,
  MAX_EVALUATION_V2_TRACE_DECISIONS,
  MAX_EVALUATION_V2_TEXT_BYTES,
  MAX_EVALUATION_V2_SUPPORT_SETS_PER_NUGGET,
  MAX_EVALUATION_V2_SAMPLES,
  MAX_EVALUATION_V2_RESULTS_PER_LANE,
  MAX_EVALUATION_V2_REPORT_TRACE_ITEMS,
  MAX_EVALUATION_V2_REPORT_TRACE_BYTES,
  MAX_EVALUATION_V2_REPORT_RAW_EVIDENCE_ITEMS,
  MAX_EVALUATION_V2_REPORT_RAW_EVIDENCE_BYTES,
  MAX_EVALUATION_V2_REPORT_PROVENANCE_ITEMS,
  MAX_EVALUATION_V2_REPORT_PROVENANCE_BYTES,
  MAX_EVALUATION_V2_QUERIES,
  MAX_EVALUATION_V2_NUGGETS_PER_QUERY,
  MAX_EVALUATION_V2_JUDGMENTS_PER_QUERY,
  MAX_EVALUATION_V2_EVIDENCE_UNITS,
  MAX_EVALUATION_V2_DOCUMENTS,
  MAX_EVALUATION_EVIDENCE_UNIT_BYTES,
  MAX_EVALUATION_EVIDENCE_UNITS_PER_DOCUMENT,
  MAX_EVALUATION_EVIDENCE_TOTAL_UNITS,
  MAX_EVALUATION_EVIDENCE_TOTAL_BYTES,
  MAX_EVALUATION_EVIDENCE_TABLE_LINES_PER_UNIT,
  MAX_EVALUATION_EVIDENCE_NEIGHBORS,
  MAX_EVALUATION_EVIDENCE_NEIGHBORHOOD_BYTES,
  MAX_EVALUATION_EVIDENCE_LIST_ITEMS_PER_UNIT,
  MAX_EVALUATION_EVIDENCE_LINE_BYTES,
  MAX_EVALUATION_EVIDENCE_LINES_PER_DOCUMENT,
  MAX_EVALUATION_EVIDENCE_DOCUMENT_BYTES,
  MAX_EVALUATION_EVIDENCE_DOCUMENTS,
  MAX_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2,
  MAX_EVALUATION_ANALYSIS_BOOTSTRAP_DRAWS_V2,
  KNOWLEDGE_BASE_EXISTING_LANE_PRIMARY_RETAIN_V2,
  KNOWLEDGE_BASE_EXISTING_LANE_CLOSURE_BUDGET_V2,
  KNOWLEDGE_BASE_EVALUATION_MAX_SAMPLE_TIMEOUT_MS,
  KNOWLEDGE_BASE_EVALUATION_EMBEDDING_NOT_INVOKED_V2,
  KNOWLEDGE_BASE_EVALUATION_ADAPTER_V2,
  EXISTING_LANE_CLOSURE_FUSION,
  EVALUATION_SOURCE_TRUST_COMPATIBILITY_V2,
  EVALUATION_EVIDENCE_SCHEMA_VERSION,
  EVALUATION_EVIDENCE_PARSER_VERSION,
  DEFAULT_EVALUATION_ANALYSIS_CUTOFF_V2,
  DEFAULT_EVALUATION_ANALYSIS_BOOTSTRAP_RESAMPLES_V2
};
