import { createHash } from "node:crypto";

import {
  validateEvaluationEvidenceRegistry,
  type EvaluationEvidenceUnit,
  type EvaluationEvidenceRegistry,
} from "./evaluation-evidence.js";
import type { KnowledgeBaseEvaluationRetrieverResultV2 } from "./evaluation-kb-v2.js";
import type { RetrievalEvaluationCorpusV2 } from "./evaluation-v2.js";

const UTF8_BYTE_TOKENIZER_DEFINITION = "hraness/kb evaluation reader tokenizer: one token per UTF-8 byte; v1\n";
const MAX_TOKENIZER_DEFINITION_BYTES = 1 * 1_024 * 1_024;
const MAX_TOKENIZER_ID_BYTES = 512;
const tokenizerBrand: unique symbol = Symbol("registered-evaluation-reader-tokenizer-v2");
const registeredTokenizers = new WeakSet<object>();
const registeredTokenizerById = new Map<string, EvaluationReaderTokenizerV2>();

export type EvaluationReaderTokenizerV2 = Readonly<{
  readonly id: string;
  readonly sha256: string;
  readonly count: (text: string) => number | Promise<number>;
  readonly [tokenizerBrand]: true;
}>;

/** Register one immutable tokenizer capability under an exact definition digest. */
export function createEvaluationReaderTokenizerV2(options: Readonly<{
  readonly id: string;
  readonly definition: string;
  readonly count: EvaluationReaderTokenizerV2["count"];
}>): EvaluationReaderTokenizerV2 {
  if (
    typeof options.id !== "string"
    || options.id.length === 0
    || /[\0\r\n]/u.test(options.id)
    || Buffer.byteLength(options.id, "utf8") > MAX_TOKENIZER_ID_BYTES
  ) throw new TypeError("Evaluation reader tokenizer id must be a non-empty bounded single line.");
  if (
    typeof options.definition !== "string"
    || options.definition.length === 0
    || Buffer.byteLength(options.definition, "utf8") > MAX_TOKENIZER_DEFINITION_BYTES
  ) throw new TypeError("Evaluation reader tokenizer definition must be non-empty and bounded.");
  if (typeof options.count !== "function") {
    throw new TypeError("Evaluation reader tokenizer count must be a function.");
  }
  if (registeredTokenizerById.has(options.id)) {
    throw new TypeError(`Evaluation reader tokenizer id ${options.id} is already registered.`);
  }
  const tokenizer: EvaluationReaderTokenizerV2 = {
    id: options.id,
    sha256: createHash("sha256").update(options.definition, "utf8").digest("hex"),
    count: options.count,
    [tokenizerBrand]: true,
  };
  Object.defineProperty(tokenizer, tokenizerBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  Object.freeze(tokenizer);
  registeredTokenizers.add(tokenizer);
  registeredTokenizerById.set(tokenizer.id, tokenizer);
  return tokenizer;
}

export const utf8ByteEvaluationReaderTokenizerV2 = createEvaluationReaderTokenizerV2({
  id: "utf8-byte-tokenizer-v1",
  definition: UTF8_BYTE_TOKENIZER_DEFINITION,
  count: (text: string) => Buffer.byteLength(text, "utf8"),
});

export type PackedKnowledgeBaseEvaluationContextV2 = Readonly<{
  readonly text: string;
  readonly utf8Bytes: number;
  readonly readerTokens: number;
  readonly includedEvidenceUnitIds: readonly string[];
  readonly truncated: boolean;
  readonly packedBytesSha256: string;
}>;

type VerifiedPackingEvidenceV2 = Readonly<{
  readonly evidenceUnitId: string;
  readonly documentId: string;
  readonly sourceFamilyId: string;
  readonly sourceClass: string;
  readonly trustClass: string;
  readonly sourcePath: string;
  readonly lineRange: Readonly<{ readonly start: number; readonly end: number }>;
  readonly headingPath: readonly string[];
  readonly sourcePage?: number;
  readonly text: string;
}>;

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function verifyBinding(
  binding: KnowledgeBaseEvaluationRetrieverResultV2["evidenceUnits"][number],
  corpusUnit: RetrievalEvaluationCorpusV2["evidenceUnits"][number],
  live: EvaluationEvidenceUnit,
  family: RetrievalEvaluationCorpusV2["sourceFamilies"][number],
  document: RetrievalEvaluationCorpusV2["documents"][number],
): VerifiedPackingEvidenceV2 {
  const locator = binding.locator;
  if (
    binding.evidenceUnitId !== corpusUnit.id
    || binding.registryUnitId !== live.id
    || corpusUnit.id !== live.id
    || binding.documentId !== corpusUnit.documentId
    || corpusUnit.documentId !== document.id
    || document.id !== live.documentId
    || binding.sourceFamilyId !== corpusUnit.sourceFamilyId
    || corpusUnit.sourceFamilyId !== family.id
    || document.sourceFamilyId !== family.id
    || binding.sourceClass !== family.sourceClass
    || binding.trustClass !== corpusUnit.trustClass
    || corpusUnit.trustClass !== document.trustClass
    || document.trustClass !== family.trustClass
    || family.trustClass !== live.trustClass
    || binding.trustClass !== live.trustClass
    || locator.evidenceUnitId !== binding.evidenceUnitId
    || locator.sourceFamilyId !== family.id
    || locator.sourceClass !== family.sourceClass
    || locator.trustClass !== live.trustClass
    || corpusUnit.sourcePath !== live.sourcePath
    || locator.sourcePath !== live.sourcePath
    || corpusUnit.lineRange.start !== live.lineRange.start
    || corpusUnit.lineRange.end !== live.lineRange.end
    || locator.lineRange.start !== live.lineRange.start
    || locator.lineRange.end !== live.lineRange.end
    || !equalStrings(corpusUnit.headingPath, live.headingAncestry)
    || !equalStrings(locator.headingPath, live.headingAncestry)
    || corpusUnit.sourcePage !== live.pdfPage
    || locator.sourcePage !== live.pdfPage
  ) {
    throw new TypeError(
      `Packed evidence binding ${binding.evidenceUnitId} does not exactly match its live registry metadata.`,
    );
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
    ...(live.pdfPage === undefined ? {} : { sourcePage: live.pdfPage }),
    text: live.text,
  });
}

function assertDecisionProvenance(
  decision: KnowledgeBaseEvaluationRetrieverResultV2["trace"]["candidateDecisions"][number],
  verifiedById: ReadonlyMap<string, VerifiedPackingEvidenceV2>,
): void {
  if (new Set(decision.evidenceUnitIds).size !== decision.evidenceUnitIds.length) {
    throw new TypeError("Evaluation candidate decision repeats an evidence-unit binding.");
  }
  if (decision.provenance.length !== decision.evidenceUnitIds.length) {
    throw new TypeError("Evaluation candidate decision provenance does not exactly cover its evidence units.");
  }
  for (const [index, evidenceUnitId] of decision.evidenceUnitIds.entries()) {
    const verified = verifiedById.get(evidenceUnitId);
    if (verified === undefined) {
      throw new TypeError(`Evaluation candidate decision names unbound evidence unit ${evidenceUnitId}.`);
    }
    const locator = decision.provenance[index];
    if (
      locator === undefined
      || (decision.documentId !== verified.documentId && decision.laneId !== "graph")
      || locator.evidenceUnitId !== verified.evidenceUnitId
      || locator.sourceFamilyId !== verified.sourceFamilyId
      || locator.sourceClass !== verified.sourceClass
      || locator.trustClass !== verified.trustClass
      || locator.sourcePath !== verified.sourcePath
      || locator.lineRange.start !== verified.lineRange.start
      || locator.lineRange.end !== verified.lineRange.end
      || !equalStrings(locator.headingPath, verified.headingPath)
      || locator.sourcePage !== verified.sourcePage
    ) {
      throw new TypeError(
        `Evaluation candidate decision provenance for ${evidenceUnitId} does not match verified live evidence.`,
      );
    }
  }
}

function locatorMatchesVerified(
  locator: KnowledgeBaseEvaluationRetrieverResultV2["trace"]["candidateDecisions"][number]["provenance"][number],
  verified: VerifiedPackingEvidenceV2,
): boolean {
  return locator.evidenceUnitId === verified.evidenceUnitId
    && locator.sourceFamilyId === verified.sourceFamilyId
    && locator.sourceClass === verified.sourceClass
    && locator.trustClass === verified.trustClass
    && locator.sourcePath === verified.sourcePath
    && locator.lineRange.start === verified.lineRange.start
    && locator.lineRange.end === verified.lineRange.end
    && equalStrings(locator.headingPath, verified.headingPath)
    && locator.sourcePage === verified.sourcePage;
}

function assertRankedCandidateProvenance(
  candidate: KnowledgeBaseEvaluationRetrieverResultV2["candidates"][number],
  decisions: KnowledgeBaseEvaluationRetrieverResultV2["trace"]["candidateDecisions"],
  verifiedById: ReadonlyMap<string, VerifiedPackingEvidenceV2>,
): void {
  if (
    new Set(candidate.evidenceUnitIds).size !== candidate.evidenceUnitIds.length
    || candidate.provenance.length !== candidate.evidenceUnitIds.length
  ) throw new TypeError("Ranked evaluation candidate provenance must uniquely cover its evidence units.");
  const candidateDecisionEvidence = new Set(decisions
    .filter(({ documentId }) => documentId === candidate.documentId)
    .flatMap(({ evidenceUnitIds }) => evidenceUnitIds));
  if (
    candidateDecisionEvidence.size !== candidate.evidenceUnitIds.length
    || candidate.evidenceUnitIds.some((id) => !candidateDecisionEvidence.has(id))
  ) {
    throw new TypeError(
      `Ranked evaluation candidate ${candidate.documentId} must aggregate exactly its lane-decision evidence.`,
    );
  }
  for (const [index, evidenceUnitId] of candidate.evidenceUnitIds.entries()) {
    const verified = verifiedById.get(evidenceUnitId);
    const locator = candidate.provenance[index];
    if (verified === undefined || locator === undefined || !locatorMatchesVerified(locator, verified)) {
      throw new TypeError(
        `Ranked evaluation candidate provenance for ${evidenceUnitId} does not match verified live evidence.`,
      );
    }
    if (candidate.documentId !== verified.documentId) {
      const graphDecision = decisions.some((decision) =>
        decision.documentId === candidate.documentId
        && decision.laneId === "graph"
        && decision.evidenceUnitIds.some((id, evidenceIndex) =>
          id === evidenceUnitId
          && decision.provenance[evidenceIndex] !== undefined
          && locatorMatchesVerified(decision.provenance[evidenceIndex], verified)));
      if (!graphDecision) {
        throw new TypeError(
          `Ranked evaluation candidate ${candidate.documentId} has cross-document evidence without a graph decision.`,
        );
      }
    }
  }
}

function safeTokenCount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} returned an invalid token count.`);
  return value;
}

function block(options: Readonly<{
  readonly evidenceUnitId: string;
  readonly sourcePath: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly sourcePage?: number;
  readonly sourceClass: string;
  readonly trustClass: string;
  readonly text: string;
}>): string {
  const page = options.sourcePage === undefined ? "" : ` page=${options.sourcePage}`;
  return [
    `[${options.sourcePath}:${options.lineStart}-${options.lineEnd}${page} evidence=${options.evidenceUnitId} source=${options.sourceClass} trust=${options.trustClass}]`,
    options.text,
    "",
  ].join("\n");
}

/** Pack only accepted, registry-bound evidence in final output order under both sealed ceilings. */
export async function packKnowledgeBaseEvaluationContextV2(options: Readonly<{
  readonly corpus: Readonly<{
    readonly documents: RetrievalEvaluationCorpusV2["documents"];
    readonly evidenceUnits: RetrievalEvaluationCorpusV2["evidenceUnits"];
    readonly sourceFamilies: RetrievalEvaluationCorpusV2["sourceFamilies"];
    readonly experiment: Readonly<{
      readonly environment: Pick<RetrievalEvaluationCorpusV2["experiment"]["environment"], "tokenizer">;
      readonly protocol: Pick<RetrievalEvaluationCorpusV2["experiment"]["protocol"], "contextCeilings">;
    }>;
  }>;
  readonly result: KnowledgeBaseEvaluationRetrieverResultV2;
  readonly evidenceRegistry: EvaluationEvidenceRegistry;
  readonly tokenizer: EvaluationReaderTokenizerV2;
}>): Promise<PackedKnowledgeBaseEvaluationContextV2> {
  if (
    options.tokenizer === null
    || typeof options.tokenizer !== "object"
    || !registeredTokenizers.has(options.tokenizer)
    || registeredTokenizerById.get(options.tokenizer.id) !== options.tokenizer
    || options.tokenizer[tokenizerBrand] !== true
  ) throw new TypeError("Packed-context tokenizer is not a registered tokenizer capability.");
  if (
    options.tokenizer.id !== options.corpus.experiment.environment.tokenizer.id
    || options.tokenizer.sha256 !== options.corpus.experiment.environment.tokenizer.sha256
  ) throw new TypeError("Packed-context tokenizer does not match the sealed evaluation environment.");
  const registry = options.evidenceRegistry;
  const registryIds = new Set<string>();
  for (const unit of registry.units) {
    if (registryIds.has(unit.id)) throw new TypeError(`Live evidence registry repeats unit ${unit.id}.`);
    registryIds.add(unit.id);
  }
  validateEvaluationEvidenceRegistry(registry);
  const registryById = new Map(registry.units.map((unit) => [unit.id, unit]));
  const familyById = new Map<string, RetrievalEvaluationCorpusV2["sourceFamilies"][number]>();
  for (const family of options.corpus.sourceFamilies) {
    if (familyById.has(family.id)) throw new TypeError(`Evaluation corpus repeats source family ${family.id}.`);
    familyById.set(family.id, family);
  }
  const documentById = new Map<string, RetrievalEvaluationCorpusV2["documents"][number]>();
  for (const document of options.corpus.documents) {
    if (documentById.has(document.id)) throw new TypeError(`Evaluation corpus repeats document ${document.id}.`);
    documentById.set(document.id, document);
  }
  const corpusUnitById = new Map<string, RetrievalEvaluationCorpusV2["evidenceUnits"][number]>();
  for (const unit of options.corpus.evidenceUnits) {
    if (corpusUnitById.has(unit.id)) throw new TypeError(`Evaluation corpus repeats evidence unit ${unit.id}.`);
    corpusUnitById.set(unit.id, unit);
  }
  const verifiedByCorpusId = new Map<string, VerifiedPackingEvidenceV2>();
  const boundRegistryIds = new Set<string>();
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
    verifiedByCorpusId.set(
      binding.evidenceUnitId,
      verifyBinding(binding, corpusUnit, live, family, document),
    );
    boundRegistryIds.add(binding.registryUnitId);
  }
  for (const decision of options.result.trace.candidateDecisions) {
    assertDecisionProvenance(decision, verifiedByCorpusId);
  }
  const accepted = options.result.trace.candidateDecisions
    .filter(({ disposition }) => disposition === "accepted")
    .toSorted((left, right) => (left.outputRank ?? Number.MAX_SAFE_INTEGER)
      - (right.outputRank ?? Number.MAX_SAFE_INTEGER));
  const outputRanks = accepted.map(({ outputRank }) => outputRank);
  if (
    new Set(outputRanks).size !== outputRanks.length
    || outputRanks.some((rank, index) => rank !== index + 1)
  ) throw new TypeError("Accepted evaluation candidates must use unique contiguous output ranks.");
  if (
    options.result.candidates.length !== accepted.length
    || options.result.candidates.some((candidate, index) =>
      candidate.rank !== index + 1
      || candidate.documentId !== accepted[index]?.documentId
      || accepted[index]?.outputRank !== candidate.rank)
  ) {
    throw new TypeError("Ranked evaluation candidates must match accepted output decisions exactly.");
  }
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const candidate of options.result.candidates) {
    assertRankedCandidateProvenance(
      candidate,
      options.result.trace.candidateDecisions,
      verifiedByCorpusId,
    );
    if (candidate.evidenceUnitIds.length === 0) {
      throw new TypeError("Accepted evaluation candidates must carry ranked evidence provenance before packing.");
    }
    for (const evidenceUnitId of candidate.evidenceUnitIds) {
      if (!seen.has(evidenceUnitId)) orderedIds.push(evidenceUnitId);
      seen.add(evidenceUnitId);
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
  const includedEvidenceUnitIds: string[] = [];
  let utf8Bytes = 0;
  let readerTokens = safeTokenCount(await options.tokenizer.count(""), "Packed-context tokenizer");
  if (readerTokens !== 0) {
    throw new TypeError("Packed-context tokenizer must count an empty context as zero tokens.");
  }
  let truncated = false;
  for (const evidenceUnitId of orderedIds) {
    const verified = verifiedByCorpusId.get(evidenceUnitId);
    if (verified === undefined) throw new TypeError(`Packed evidence unit ${evidenceUnitId} lacks a live registry binding.`);
    const content = block({
      evidenceUnitId: verified.evidenceUnitId,
      sourcePath: verified.sourcePath,
      lineStart: verified.lineRange.start,
      lineEnd: verified.lineRange.end,
      ...(verified.sourcePage === undefined ? {} : { sourcePage: verified.sourcePage }),
      sourceClass: verified.sourceClass,
      trustClass: verified.trustClass,
      text: verified.text,
    });
    const prospectiveText = `${text}${content}`;
    const prospectiveBytes = Buffer.byteLength(prospectiveText, "utf8");
    const prospectiveTokens = safeTokenCount(
      await options.tokenizer.count(prospectiveText),
      "Packed-context tokenizer",
    );
    if (prospectiveBytes > byteCeiling || prospectiveTokens > tokenCeiling) {
      truncated = true;
      break;
    }
    text = prospectiveText;
    includedEvidenceUnitIds.push(evidenceUnitId);
    utf8Bytes = prospectiveBytes;
    readerTokens = prospectiveTokens;
  }
  const finalReaderTokens = safeTokenCount(
    await options.tokenizer.count(text),
    "Packed-context tokenizer",
  );
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
    packedBytesSha256: createHash("sha256").update(packedBytes).digest("hex"),
  });
}
