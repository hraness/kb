// @bun
import {
  MAX_ANALYZED_NOTES,
  MAX_MENTIONS,
  isCanonicalNoteId,
  isCanonicalRelationPredicate,
  lookupNote
} from "./index-ekpwvbra.js";

// src/percolate.ts
import { createHash } from "crypto";
import { posix } from "path";
var DEFAULT_PERCOLATION_LIMIT = 100;
var MAX_PERCOLATION_LIMIT = 1000;
var DEFAULT_PERCOLATION_MIN_SUPPORT = 2;
var MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE = 100;
var MAX_PERCOLATION_NOTES = MAX_ANALYZED_NOTES;
var MAX_PERCOLATION_MENTION_PAIRS = 250000;
var MAX_PERCOLATION_MENTIONS = MAX_MENTIONS;
var MAX_SCOPED_PERCOLATION_MENTION_PAIRS = MAX_PERCOLATION_NOTES * 2;
var PERCOLATION_RESULT_SCHEMA_VERSION = 2;
var MAX_PERCOLATION_RESULT_NODES = 250000;
var MAX_PERCOLATION_RESULT_UTF8_BYTES = 16 * 1024 * 1024;
var MAX_PERCOLATION_TEXT_UTF8_BYTES = 64 * 1024;
var MAX_PERCOLATION_EVIDENCE = 250000;
var MAX_PERCOLATION_PAIR_OBSERVATIONS = MAX_PERCOLATION_MENTION_PAIRS;
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function pairKey(left, right) {
  return compareText(left, right) <= 0 ? `${left}\x00${right}` : `${right}\x00${left}`;
}
function directedKey(source, target) {
  return `${source}\x00${target}`;
}
function relationKey(source, predicate, target) {
  return `${source}\x00${predicate}\x00${target}`;
}
function checkedLine(line, context) {
  if (!Number.isSafeInteger(line) || line < 1) {
    throw new TypeError(`${context} has an invalid evidence line.`);
  }
  return line;
}
function checkedOptions(options) {
  const limit = options.limit ?? DEFAULT_PERCOLATION_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_PERCOLATION_LIMIT) {
    throw new RangeError(`Percolation limit must be a safe integer from 0 to ${MAX_PERCOLATION_LIMIT}.`);
  }
  const minSupport = options.minSupport ?? DEFAULT_PERCOLATION_MIN_SUPPORT;
  if (!Number.isSafeInteger(minSupport) || minSupport < 1 || minSupport > MAX_PERCOLATION_EVIDENCE) {
    throw new RangeError(`Percolation minimum support must be a safe integer from 1 to ${MAX_PERCOLATION_EVIDENCE}.`);
  }
  return { limit, minSupport };
}
function indexedContentNotes(notes, analysis) {
  if (analysis.noteConnections.length > MAX_PERCOLATION_NOTES) {
    throw new RangeError(`Percolation exceeds the ${MAX_PERCOLATION_NOTES} note limit.`);
  }
  const allById = new Map;
  for (const note of notes) {
    if (allById.has(note.id)) {
      throw new Error(`Duplicate note identity in percolation: ${note.id}.`);
    }
    allById.set(note.id, note);
  }
  const byId = new Map;
  const byPath = new Map;
  for (const connection of analysis.noteConnections) {
    if (byId.has(connection.id)) {
      throw new Error(`Duplicate analyzed note identity: ${connection.id}.`);
    }
    const note = allById.get(connection.id);
    if (note === undefined) {
      throw new Error(`Analysis references missing note identity: ${connection.id}.`);
    }
    if (byPath.has(note.path)) {
      throw new Error(`Duplicate note path in percolation: ${note.path}.`);
    }
    byId.set(note.id, note);
    byPath.set(note.path, note);
  }
  return {
    notes: [...byId.values()].toSorted((left, right) => compareText(left.id, right.id)),
    byId,
    byPath
  };
}
function conceptKey(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/^#+/u, "").replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/gu, "");
}
function isConcept(note) {
  return note.properties.type?.normalize("NFC").toLocaleLowerCase("en-US") === "concept";
}
function conceptLabels(note) {
  return [
    note.title,
    ...note.aliases,
    posix.basename(note.id)
  ].map(conceptKey).filter((value) => value !== "");
}
function naturalConceptId(tag) {
  const slug = conceptKey(tag);
  const digest = createHash("sha256").update(tag.normalize("NFC")).digest("hex");
  if (slug === "")
    return `notes/concept-${digest.slice(0, 16)}`;
  if (slug.length <= 160)
    return `notes/${slug}`;
  let prefix = "";
  let count = 0;
  for (const character of slug) {
    if (count >= 144)
      break;
    prefix += character;
    count += 1;
  }
  return `notes/${prefix.replace(/-+$/u, "")}-${digest.slice(0, 12)}`;
}
function suggestedConceptId(tag, occupiedIds, reservedIds, nextSuffixByNaturalId) {
  const natural = naturalConceptId(tag);
  const foldedNatural = natural.toLocaleLowerCase("en-US");
  const collidesWith = occupiedIds.get(foldedNatural) ?? null;
  if (collidesWith === null && !reservedIds.has(foldedNatural)) {
    reservedIds.add(foldedNatural);
    return { id: natural, collidesWith: null };
  }
  const suffixed = `${natural}-concept`;
  const foldedSuffixed = suffixed.toLocaleLowerCase("en-US");
  if (!occupiedIds.has(foldedSuffixed) && !reservedIds.has(foldedSuffixed)) {
    reservedIds.add(foldedSuffixed);
    nextSuffixByNaturalId.set(foldedNatural, 2);
    return { id: suffixed, collidesWith };
  }
  const nextSuffix = nextSuffixByNaturalId.get(foldedNatural) ?? 2;
  for (let suffix = nextSuffix;suffix <= MAX_PERCOLATION_EVIDENCE + 2; suffix += 1) {
    const candidate = `${suffixed}-${suffix}`;
    const foldedCandidate = candidate.toLocaleLowerCase("en-US");
    if (!occupiedIds.has(foldedCandidate) && !reservedIds.has(foldedCandidate)) {
      reservedIds.add(foldedCandidate);
      nextSuffixByNaturalId.set(foldedNatural, suffix + 1);
      return { id: candidate, collidesWith };
    }
  }
  throw new RangeError("Percolation could not choose an unoccupied concept ID.");
}
function resolvedNoteFilter(notes, query) {
  if (query === undefined)
    return null;
  const result = lookupNote(notes, query);
  if (result.kind === "found")
    return result.note.id;
  if (result.kind === "ambiguous") {
    throw new Error(`Percolation note is ambiguous: ${result.candidates.map((note) => note.id).join(", ")}.`);
  }
  throw new Error(`Percolation note does not exist: ${query}.`);
}
function candidateInvolvesNote(candidate, note) {
  if (note === null)
    return true;
  if (candidate.kind === "missing-concept") {
    return candidate.evidence.some((evidence) => evidence.note === note);
  }
  return candidate.source === note || candidate.target === note;
}
function compareSharedEvidence(left, right) {
  return compareText(left.kind, right.kind) || compareText(left.kind === "shared-tag" ? left.tag : left.concept, right.kind === "shared-tag" ? right.tag : right.concept) || compareText(left.note, right.note);
}
function candidateIdentity(candidate) {
  switch (candidate.kind) {
    case "missing-concept":
      return candidate.tag;
    case "missing-relation":
      return `${candidate.source}\x00${candidate.target}`;
    case "unlinked-mention":
      return `${candidate.source}\x00${candidate.target}`;
    case "relation-hygiene":
      return [
        candidate.problem,
        candidate.source,
        candidate.predicate ?? "",
        candidate.target ?? "",
        candidate.message,
        String(candidate.evidence[0]?.line ?? 0)
      ].join("\x00");
  }
}
function historicalCandidateIdentity(candidate) {
  switch (candidate.kind) {
    case "missing-concept":
      return candidate.tag;
    case "missing-relation":
    case "unlinked-mention":
      return `${candidate.source}\x00${candidate.target}`;
    case "relation-hygiene":
      return [
        candidate.problem,
        candidate.source,
        candidate.predicate ?? "",
        candidate.target ?? ""
      ].join("\x00");
  }
}
var candidateKindRank = {
  "relation-hygiene": 0,
  "unlinked-mention": 1,
  "missing-relation": 2,
  "missing-concept": 3
};
function compareCandidates(left, right) {
  return right.support - left.support || candidateKindRank[left.kind] - candidateKindRank[right.kind] || compareText(candidateIdentity(left), candidateIdentity(right));
}
function compareHistoricalCandidates(left, right) {
  return right.support - left.support || candidateKindRank[left.kind] - candidateKindRank[right.kind] || compareText(historicalCandidateIdentity(left), historicalCandidateIdentity(right));
}
function relationEvidence(relation) {
  return {
    kind: "relation",
    source: relation.source,
    target: relation.target,
    predicate: relation.predicate,
    line: checkedLine(relation.provenance.line, `Authored relation ${relation.source} -> ${relation.target}`),
    authoredTarget: relation.provenance.authoredTarget
  };
}
function issueEvidence(issue, source) {
  const line = checkedLine(issue.line, `Relation issue in ${issue.source}`);
  if (issue.kind === "malformed") {
    return {
      kind: "relation-issue",
      issue: issue.kind,
      source,
      line,
      predicate: issue.predicate ?? null,
      target: issue.target ?? null,
      candidates: [],
      candidatesTruncated: false,
      message: issue.message
    };
  }
  if (issue.kind === "broken") {
    return {
      kind: "relation-issue",
      issue: issue.kind,
      source,
      line,
      predicate: issue.predicate,
      target: issue.target,
      candidates: [],
      candidatesTruncated: false,
      message: `Relationship target does not exist: ${issue.target}.`
    };
  }
  return {
    kind: "relation-issue",
    issue: issue.kind,
    source,
    line,
    predicate: issue.predicate,
    target: issue.target,
    candidates: [...issue.candidates].toSorted(compareText).slice(0, MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE),
    candidatesTruncated: issue.candidates.length > MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE,
    message: `Relationship target is ambiguous: ${issue.target}.`
  };
}
function percolateVault(notes, analysis, options = {}) {
  const { limit, minSupport } = checkedOptions(options);
  const indexed = indexedContentNotes(notes, analysis);
  const noteFilter = resolvedNoteFilter(indexed.notes, options.note);
  const relations = analysis.authoredRelations ?? [];
  const relationIssues = analysis.relationIssues ?? [];
  let evidenceObservations = analysis.mentions.length + relations.length + relationIssues.length;
  for (const issue of relationIssues) {
    if (issue.kind !== "ambiguous")
      continue;
    evidenceObservations += issue.candidates.length;
    if (evidenceObservations > MAX_PERCOLATION_EVIDENCE)
      break;
  }
  if (evidenceObservations > MAX_PERCOLATION_EVIDENCE) {
    throw new RangeError(`Percolation exceeds the ${MAX_PERCOLATION_EVIDENCE} evidence limit.`);
  }
  const conceptIds = new Set(indexed.notes.filter(isConcept).map((note) => note.id));
  const occupiedIds = new Map(indexed.notes.map((note) => [
    note.id.toLocaleLowerCase("en-US"),
    note.id
  ]));
  const reservedConceptIds = new Set;
  const nextConceptSuffixByNaturalId = new Map;
  const nonConceptNotes = indexed.notes.filter((note) => !conceptIds.has(note.id));
  const conceptLabelKeys = new Set(indexed.notes.filter((note) => conceptIds.has(note.id)).flatMap(conceptLabels));
  const candidates = [];
  const notesByTag = new Map;
  let tagEvidenceCount = 0;
  for (const note of nonConceptNotes) {
    for (const tag of new Set(note.tags)) {
      tagEvidenceCount += 1;
      if (tagEvidenceCount > MAX_PERCOLATION_EVIDENCE) {
        throw new RangeError(`Percolation exceeds the ${MAX_PERCOLATION_EVIDENCE} tag evidence limit.`);
      }
      const matches = notesByTag.get(tag) ?? [];
      matches.push(note);
      notesByTag.set(tag, matches);
    }
  }
  for (const [tag, matchingNotes] of [...notesByTag].toSorted(([left], [right]) => compareText(left, right))) {
    const sortedMatches = matchingNotes.toSorted((left, right) => (left.id === noteFilter ? -1 : 0) - (right.id === noteFilter ? -1 : 0) || compareText(left.id, right.id));
    const evidence = sortedMatches.slice(0, MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE).map((note) => ({
      kind: "tag",
      note: note.id,
      path: note.path,
      tag
    }));
    if (matchingNotes.length >= Math.max(2, minSupport) && !conceptLabelKeys.has(conceptKey(tag)) && (noteFilter === null || matchingNotes.some((note) => note.id === noteFilter))) {
      const suggestion = suggestedConceptId(tag, occupiedIds, reservedConceptIds, nextConceptSuffixByNaturalId);
      candidates.push({
        kind: "missing-concept",
        tag,
        suggestedId: suggestion.id,
        collidesWith: suggestion.collidesWith,
        support: matchingNotes.length,
        evidenceTruncated: matchingNotes.length > MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE,
        evidence
      });
    }
  }
  const explicitPairs = new Set;
  const noteConcepts = new Map;
  const addConceptConnection = (noteId, conceptId) => {
    if (conceptIds.has(noteId) || !conceptIds.has(conceptId))
      return;
    const concepts = noteConcepts.get(noteId) ?? new Set;
    concepts.add(conceptId);
    noteConcepts.set(noteId, concepts);
  };
  for (const link of analysis.contextualLinks) {
    const source = indexed.byPath.get(link.source);
    const target = indexed.byPath.get(link.target);
    if (source === undefined || target === undefined) {
      throw new Error(`Contextual link references an unknown percolation note: ${link.source} -> ${link.target}.`);
    }
    explicitPairs.add(pairKey(source.id, target.id));
    addConceptConnection(source.id, target.id);
    addConceptConnection(target.id, source.id);
  }
  for (const relation of relations) {
    if (!indexed.byId.has(relation.source) || !indexed.byId.has(relation.target)) {
      throw new Error(`Authored relation references an unknown percolation note: ${relation.source} -> ${relation.target}.`);
    }
    explicitPairs.add(pairKey(relation.source, relation.target));
    addConceptConnection(relation.source, relation.target);
    addConceptConnection(relation.target, relation.source);
  }
  const pairEvidence = new Map;
  let pairObservations = 0;
  const addPairEvidence = (left, right, evidence) => {
    pairObservations += 1;
    if (pairObservations > MAX_PERCOLATION_PAIR_OBSERVATIONS) {
      throw new RangeError(`Percolation exceeds the ${MAX_PERCOLATION_PAIR_OBSERVATIONS} pair observation limit.`);
    }
    const key = pairKey(left.id, right.id);
    if (explicitPairs.has(key))
      return;
    const accumulated = pairEvidence.get(key) ?? {
      support: 0,
      evidenceCount: 0,
      evidence: []
    };
    accumulated.support += 1;
    accumulated.evidenceCount += evidence.length;
    for (const item of evidence) {
      if (accumulated.evidence.length < MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE) {
        accumulated.evidence.push(item);
      }
    }
    pairEvidence.set(key, accumulated);
  };
  const addPairsForGroup = (matchingNotes, evidenceFor) => {
    const sortedNotes = matchingNotes.toSorted((left, right) => compareText(left.id, right.id));
    if (noteFilter !== null) {
      const scoped = sortedNotes.find((note) => note.id === noteFilter);
      if (scoped === undefined)
        return;
      for (const other of sortedNotes) {
        if (other.id === scoped.id)
          continue;
        const [left, right] = compareText(scoped.id, other.id) < 0 ? [scoped, other] : [other, scoped];
        addPairEvidence(left, right, evidenceFor(left, right));
      }
      return;
    }
    for (let leftIndex = 0;leftIndex < sortedNotes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1;rightIndex < sortedNotes.length; rightIndex += 1) {
        const left = sortedNotes[leftIndex];
        const right = sortedNotes[rightIndex];
        if (left === undefined || right === undefined)
          continue;
        addPairEvidence(left, right, evidenceFor(left, right));
      }
    }
  };
  for (const [tag, matchingNotes] of [...notesByTag].toSorted(([left], [right]) => compareText(left, right))) {
    addPairsForGroup(matchingNotes, (left, right) => [
      { kind: "shared-tag", note: left.id, path: left.path, tag },
      { kind: "shared-tag", note: right.id, path: right.path, tag }
    ]);
  }
  const notesByConcept = new Map;
  for (const [noteId, connectedConcepts] of noteConcepts) {
    const note = indexed.byId.get(noteId);
    if (note === undefined)
      continue;
    for (const concept of connectedConcepts) {
      const matches = notesByConcept.get(concept) ?? [];
      matches.push(note);
      notesByConcept.set(concept, matches);
    }
  }
  for (const [concept, matchingNotes] of [...notesByConcept].toSorted(([left], [right]) => compareText(left, right))) {
    const conceptNote = indexed.byId.get(concept);
    if (conceptNote === undefined)
      continue;
    addPairsForGroup(matchingNotes, (left, right) => [
      {
        kind: "shared-concept",
        note: left.id,
        path: left.path,
        concept,
        conceptPath: conceptNote.path
      },
      {
        kind: "shared-concept",
        note: right.id,
        path: right.path,
        concept,
        conceptPath: conceptNote.path
      }
    ]);
  }
  for (const [key, accumulated] of pairEvidence) {
    const separator = key.indexOf("\x00");
    const source = key.slice(0, separator);
    const target = key.slice(separator + 1);
    const evidence = accumulated.evidence.toSorted(compareSharedEvidence);
    if (accumulated.support < minSupport)
      continue;
    candidates.push({
      kind: "missing-relation",
      source,
      target,
      predicate: { kind: "required" },
      support: accumulated.support,
      evidenceTruncated: accumulated.evidenceCount > MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE,
      evidence
    });
  }
  const mentionEvidenceByPair = new Map;
  for (const mention of analysis.mentions) {
    const source = indexed.byPath.get(mention.source);
    const target = indexed.byPath.get(mention.target);
    if (source === undefined || target === undefined) {
      throw new Error(`Mention references an unknown percolation note: ${mention.source} -> ${mention.target}.`);
    }
    if (noteFilter !== null && source.id !== noteFilter && target.id !== noteFilter)
      continue;
    if (explicitPairs.has(pairKey(source.id, target.id)))
      continue;
    const key = directedKey(source.id, target.id);
    const accumulated = mentionEvidenceByPair.get(key) ?? {
      support: 0,
      evidence: []
    };
    accumulated.support += 1;
    if (accumulated.evidence.length < MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE)
      accumulated.evidence.push({
        kind: "mention",
        source: source.id,
        target: target.id,
        line: checkedLine(mention.line, `Mention ${mention.source} -> ${mention.target}`),
        phrase: mention.phrase
      });
    mentionEvidenceByPair.set(key, accumulated);
  }
  for (const [key, accumulated] of mentionEvidenceByPair) {
    const separator = key.indexOf("\x00");
    const source = key.slice(0, separator);
    const target = key.slice(separator + 1);
    const sortedEvidence = accumulated.evidence.toSorted((left, right) => left.line - right.line || compareText(left.phrase, right.phrase));
    candidates.push({
      kind: "unlinked-mention",
      source,
      target,
      support: accumulated.support,
      evidenceTruncated: accumulated.support > MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE,
      evidence: sortedEvidence
    });
  }
  const relationsByKey = new Map(relations.map((relation) => [
    relationKey(relation.source, relation.predicate, relation.target),
    relation
  ]));
  for (const relation of relations) {
    if (noteFilter !== null && relation.source !== noteFilter && relation.target !== noteFilter)
      continue;
    if (relation.source === relation.target) {
      candidates.push({
        kind: "relation-hygiene",
        problem: "self-relation",
        source: relation.source,
        target: relation.target,
        predicate: relation.predicate,
        message: "Review an authored relationship whose source and target are the same note.",
        support: 1,
        evidenceTruncated: false,
        evidence: [relationEvidence(relation)]
      });
      continue;
    }
    if (compareText(relation.source, relation.target) >= 0)
      continue;
    const reciprocal = relationsByKey.get(relationKey(relation.target, relation.predicate, relation.source));
    if (reciprocal === undefined)
      continue;
    const evidence = [
      relationEvidence(relation),
      relationEvidence(reciprocal)
    ].toSorted((left, right) => compareText(left.source, right.source) || compareText(left.target, right.target));
    candidates.push({
      kind: "relation-hygiene",
      problem: "reciprocal-relation",
      source: relation.source,
      target: relation.target,
      predicate: relation.predicate,
      message: "Review reciprocal assertions of the same directional predicate.",
      support: evidence.length,
      evidenceTruncated: false,
      evidence
    });
  }
  for (const issue of relationIssues) {
    const sourceNote = indexed.byPath.get(issue.source);
    if (sourceNote === undefined)
      continue;
    if (noteFilter !== null && sourceNote.id !== noteFilter)
      continue;
    const evidence = issueEvidence(issue, sourceNote.id);
    const problem = issue.kind === "malformed" ? "malformed-relation" : issue.kind === "broken" ? "broken-relation" : "ambiguous-relation";
    candidates.push({
      kind: "relation-hygiene",
      problem,
      source: sourceNote.id,
      target: evidence.target,
      predicate: evidence.predicate,
      message: evidence.message,
      support: 1,
      evidenceTruncated: evidence.candidatesTruncated,
      evidence: [evidence]
    });
  }
  if (candidates.length > MAX_PERCOLATION_EVIDENCE) {
    throw new RangeError(`Percolation exceeds the ${MAX_PERCOLATION_EVIDENCE} candidate limit.`);
  }
  const uniqueCandidates = new Map;
  for (const candidate of candidates) {
    const identity = `${candidate.kind}\x00${candidateIdentity(candidate)}`;
    if (!uniqueCandidates.has(identity))
      uniqueCandidates.set(identity, candidate);
  }
  const sorted = [...uniqueCandidates.values()].filter((candidate) => candidateInvolvesNote(candidate, noteFilter)).toSorted(compareCandidates);
  return parsePercolationResultV2({
    schemaVersion: PERCOLATION_RESULT_SCHEMA_VERSION,
    candidates: sorted.slice(0, limit),
    truncated: sorted.length > limit
  });
}
function countParseNode(budget, label) {
  budget.nodes += 1;
  if (budget.nodes > MAX_PERCOLATION_RESULT_NODES) {
    throw new RangeError(`${label} exceeds the ${MAX_PERCOLATION_RESULT_NODES.toLocaleString("en-US")}-node percolation result limit.`);
  }
}
function dataRecord(value, label, budget) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain data object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain data object.`);
  }
  countParseNode(budget, label);
  const output = Object.create(null);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} must not contain symbol fields.`);
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${key} must be an enumerable data property.`);
    }
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false
    });
  }
  return Object.freeze(output);
}
function exactKeys(record, keys, label) {
  const actual = Reflect.ownKeys(record);
  const expected = new Set(keys);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== "string" || !expected.has(key))) {
    throw new TypeError(`${label} must contain exactly: ${keys.join(", ")}.`);
  }
}
function dataArray(value, label, maximum, budget) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be an ordinary array.`);
  }
  if (value.length > maximum) {
    throw new RangeError(`${label} exceeds its ${maximum.toLocaleString("en-US")}-entry limit.`);
  }
  countParseNode(budget, label);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} must not contain symbol fields.`);
    }
    if (key === "length")
      continue;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      throw new TypeError(`${label} contains a non-index property.`);
    }
  }
  const output = [];
  for (let index = 0;index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label} must be a dense array of data properties.`);
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
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
function parsedText(value, label, budget, options = {}) {
  if (typeof value !== "string" || options.empty !== true && value === "" || hasUnpairedSurrogate(value)) {
    throw new TypeError(`${label} must be a bounded Unicode string.`);
  }
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > MAX_PERCOLATION_TEXT_UTF8_BYTES) {
    throw new RangeError(`${label} exceeds its ${MAX_PERCOLATION_TEXT_UTF8_BYTES.toLocaleString("en-US")}-byte limit.`);
  }
  budget.utf8Bytes += bytes;
  if (budget.utf8Bytes > MAX_PERCOLATION_RESULT_UTF8_BYTES) {
    throw new RangeError(`Percolation result text exceeds ${MAX_PERCOLATION_RESULT_UTF8_BYTES.toLocaleString("en-US")} UTF-8 bytes.`);
  }
  return value;
}
function canonicalNote(value, label, budget) {
  const parsed = parsedText(value, label, budget);
  if (!isCanonicalNoteId(parsed)) {
    throw new TypeError(`${label} must be a canonical note ID.`);
  }
  return parsed;
}
function canonicalMarkdownPath(value, label, budget) {
  const parsed = parsedText(value, label, budget);
  if (!parsed.endsWith(".md") || !isCanonicalNoteId(parsed.slice(0, -3))) {
    throw new TypeError(`${label} must be a canonical vault Markdown path.`);
  }
  return parsed;
}
function canonicalPredicate(value, label, budget) {
  const parsed = parsedText(value, label, budget);
  if (!isCanonicalRelationPredicate(parsed)) {
    throw new TypeError(`${label} must be a canonical relation predicate.`);
  }
  return parsed;
}
function nullableText(value, label, budget) {
  return value === null ? null : parsedText(value, label, budget, { empty: true });
}
function parsedBoolean(value, label) {
  if (typeof value !== "boolean")
    throw new TypeError(`${label} must be a boolean.`);
  return value;
}
function positiveSafeInteger(value, label, maximum = MAX_PERCOLATION_EVIDENCE) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} must be a positive bounded safe integer.`);
  }
  return value;
}
function parsedMinSupport(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < DEFAULT_PERCOLATION_MIN_SUPPORT || value > MAX_PERCOLATION_LIMIT) {
    throw new TypeError(`${label} must be an integer from ${DEFAULT_PERCOLATION_MIN_SUPPORT} through ${MAX_PERCOLATION_LIMIT}.`);
  }
  return value;
}
function predicateDisposition(value, label, budget) {
  const record = dataRecord(value, label, budget);
  const kind = parsedText(record.kind, `${label}.kind`, budget);
  if (kind === "required") {
    exactKeys(record, ["kind"], label);
    return Object.freeze({ kind: "required" });
  }
  throw new TypeError(`${label}.kind must be required.`);
}
function parsedMissingConceptEvidence(value, label, budget) {
  const record = dataRecord(value, label, budget);
  exactKeys(record, ["kind", "note", "path", "tag"], label);
  if (parsedText(record.kind, `${label}.kind`, budget) !== "tag") {
    throw new TypeError(`${label}.kind must be tag.`);
  }
  const note = canonicalNote(record.note, `${label}.note`, budget);
  const path = canonicalMarkdownPath(record.path, `${label}.path`, budget);
  if (path !== `${note}.md`)
    throw new TypeError(`${label}.path must identify its note.`);
  return Object.freeze({
    kind: "tag",
    note,
    path,
    tag: parsedText(record.tag, `${label}.tag`, budget)
  });
}
function parsedSharedEvidence(value, label, budget) {
  const record = dataRecord(value, label, budget);
  const kind = parsedText(record.kind, `${label}.kind`, budget);
  if (kind === "shared-tag") {
    exactKeys(record, ["kind", "note", "path", "tag"], label);
    const note = canonicalNote(record.note, `${label}.note`, budget);
    const path = canonicalMarkdownPath(record.path, `${label}.path`, budget);
    if (path !== `${note}.md`)
      throw new TypeError(`${label}.path must identify its note.`);
    return Object.freeze({
      kind: "shared-tag",
      note,
      path,
      tag: parsedText(record.tag, `${label}.tag`, budget)
    });
  }
  if (kind === "shared-concept") {
    exactKeys(record, ["kind", "note", "path", "concept", "conceptPath"], label);
    const note = canonicalNote(record.note, `${label}.note`, budget);
    const path = canonicalMarkdownPath(record.path, `${label}.path`, budget);
    const concept = canonicalNote(record.concept, `${label}.concept`, budget);
    const conceptPath = canonicalMarkdownPath(record.conceptPath, `${label}.conceptPath`, budget);
    if (path !== `${note}.md`)
      throw new TypeError(`${label}.path must identify its note.`);
    if (conceptPath !== `${concept}.md`) {
      throw new TypeError(`${label}.conceptPath must identify its concept.`);
    }
    return Object.freeze({
      kind: "shared-concept",
      note,
      path,
      concept,
      conceptPath
    });
  }
  throw new TypeError(`${label}.kind must be shared-tag or shared-concept.`);
}
function parsedMentionEvidence(value, label, budget) {
  const record = dataRecord(value, label, budget);
  exactKeys(record, ["kind", "source", "target", "line", "phrase"], label);
  if (parsedText(record.kind, `${label}.kind`, budget) !== "mention") {
    throw new TypeError(`${label}.kind must be mention.`);
  }
  return Object.freeze({
    kind: "mention",
    source: canonicalNote(record.source, `${label}.source`, budget),
    target: canonicalNote(record.target, `${label}.target`, budget),
    line: positiveSafeInteger(record.line, `${label}.line`),
    phrase: parsedText(record.phrase, `${label}.phrase`, budget)
  });
}
function parsedRelationEvidence(value, label, budget) {
  const record = dataRecord(value, label, budget);
  exactKeys(record, ["kind", "source", "target", "predicate", "line", "authoredTarget"], label);
  if (parsedText(record.kind, `${label}.kind`, budget) !== "relation") {
    throw new TypeError(`${label}.kind must be relation.`);
  }
  return Object.freeze({
    kind: "relation",
    source: canonicalNote(record.source, `${label}.source`, budget),
    target: canonicalNote(record.target, `${label}.target`, budget),
    predicate: canonicalPredicate(record.predicate, `${label}.predicate`, budget),
    line: positiveSafeInteger(record.line, `${label}.line`),
    authoredTarget: parsedText(record.authoredTarget, `${label}.authoredTarget`, budget)
  });
}
function parsedRelationIssueEvidence(value, label, budget) {
  const record = dataRecord(value, label, budget);
  exactKeys(record, [
    "kind",
    "issue",
    "source",
    "line",
    "predicate",
    "target",
    "candidates",
    "candidatesTruncated",
    "message"
  ], label);
  if (parsedText(record.kind, `${label}.kind`, budget) !== "relation-issue") {
    throw new TypeError(`${label}.kind must be relation-issue.`);
  }
  if (record.issue !== "malformed" && record.issue !== "broken" && record.issue !== "ambiguous") {
    throw new TypeError(`${label}.issue is unsupported.`);
  }
  const issue = parsedText(record.issue, `${label}.issue`, budget);
  const candidates = dataArray(record.candidates, `${label}.candidates`, MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE, budget).map((candidate, index) => canonicalNote(candidate, `${label}.candidates[${index}]`, budget));
  for (let index = 0;index < candidates.length; index += 1) {
    const previous = candidates[index - 1];
    const candidate = candidates[index];
    if (candidate === undefined)
      continue;
    if (previous !== undefined && compareText(previous, candidate) >= 0) {
      throw new TypeError(`${label}.candidates must be sorted and unique.`);
    }
  }
  if (issue !== "ambiguous" && candidates.length !== 0) {
    throw new TypeError(`${label}.candidates are only valid for ambiguous issues.`);
  }
  if (issue === "ambiguous" && candidates.length < 2) {
    throw new TypeError(`${label}.candidates must identify at least two ambiguous notes.`);
  }
  const candidatesTruncated = parsedBoolean(record.candidatesTruncated, `${label}.candidatesTruncated`);
  if (issue !== "ambiguous" && candidatesTruncated || candidatesTruncated && candidates.length !== MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE) {
    throw new TypeError(`${label}.candidatesTruncated is inconsistent.`);
  }
  const predicate = issue === "malformed" ? nullableText(record.predicate, `${label}.predicate`, budget) : canonicalPredicate(record.predicate, `${label}.predicate`, budget);
  const target = issue === "malformed" ? nullableText(record.target, `${label}.target`, budget) : canonicalNote(record.target, `${label}.target`, budget);
  return Object.freeze({
    kind: "relation-issue",
    issue,
    source: canonicalNote(record.source, `${label}.source`, budget),
    line: positiveSafeInteger(record.line, `${label}.line`),
    predicate,
    target,
    candidates: Object.freeze(candidates),
    candidatesTruncated,
    message: parsedText(record.message, `${label}.message`, budget)
  });
}
function evidenceArray(value, label, budget, parse) {
  const input = dataArray(value, label, MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE, budget);
  if (input.length === 0)
    throw new TypeError(`${label} must not be empty.`);
  const output = input.map((entry, index) => parse(entry, `${label}[${index}]`, budget));
  const identities = new Set;
  for (const entry of output) {
    const identity = JSON.stringify(entry);
    if (identities.has(identity))
      throw new TypeError(`${label} must be unique.`);
    identities.add(identity);
  }
  return Object.freeze(output);
}
function parsedRelationProblem(value, label, budget) {
  const parsed = parsedText(value, label, budget);
  if (parsed !== "self-relation" && parsed !== "reciprocal-relation" && parsed !== "malformed-relation" && parsed !== "broken-relation" && parsed !== "ambiguous-relation")
    throw new TypeError(`${label} is unsupported.`);
  return parsed;
}
function parsedCommonCandidate(record, label) {
  return {
    support: positiveSafeInteger(record.support, `${label}.support`),
    evidenceTruncated: parsedBoolean(record.evidenceTruncated, `${label}.evidenceTruncated`)
  };
}
function parseCandidate(value, label, budget, version) {
  const record = dataRecord(value, label, budget);
  const kind = parsedText(record.kind, `${label}.kind`, budget);
  if (kind === "missing-concept") {
    exactKeys(record, [
      "kind",
      "tag",
      "suggestedId",
      "collidesWith",
      "support",
      "evidenceTruncated",
      "evidence"
    ], label);
    const common = parsedCommonCandidate(record, label);
    const tag = parsedText(record.tag, `${label}.tag`, budget);
    const evidence = evidenceArray(record.evidence, `${label}.evidence`, budget, parsedMissingConceptEvidence);
    if (evidence.some((entry) => entry.tag !== tag)) {
      throw new TypeError(`${label}.evidence must support the candidate tag.`);
    }
    if (!common.evidenceTruncated && common.support !== evidence.length || common.evidenceTruncated && common.support <= evidence.length) {
      throw new TypeError(`${label}.support does not match its bounded evidence.`);
    }
    return Object.freeze({
      kind: "missing-concept",
      tag,
      suggestedId: canonicalNote(record.suggestedId, `${label}.suggestedId`, budget),
      collidesWith: record.collidesWith === null ? null : canonicalNote(record.collidesWith, `${label}.collidesWith`, budget),
      ...common,
      evidence
    });
  }
  if (kind === "missing-relation") {
    exactKeys(record, version === 1 ? [
      "kind",
      "source",
      "target",
      "suggestedPredicate",
      "support",
      "evidenceTruncated",
      "evidence"
    ] : [
      "kind",
      "source",
      "target",
      "predicate",
      "support",
      "evidenceTruncated",
      "evidence"
    ], label);
    const source = canonicalNote(record.source, `${label}.source`, budget);
    const target = canonicalNote(record.target, `${label}.target`, budget);
    if (compareText(source, target) >= 0) {
      throw new TypeError(`${label} endpoints must be an ordered, distinct pair.`);
    }
    const common = parsedCommonCandidate(record, label);
    const evidence = evidenceArray(record.evidence, `${label}.evidence`, budget, parsedSharedEvidence);
    if (evidence.some((entry) => entry.note !== source && entry.note !== target)) {
      throw new TypeError(`${label}.evidence must belong to one of the unordered endpoints.`);
    }
    const signalEndpoints = new Map;
    for (const entry of evidence) {
      const signal = entry.kind === "shared-tag" ? `tag\x00${entry.tag}` : `concept\x00${entry.concept}`;
      const endpoints = signalEndpoints.get(signal) ?? new Set;
      endpoints.add(entry.note);
      signalEndpoints.set(signal, endpoints);
    }
    if ([...signalEndpoints.values()].some((endpoints) => endpoints.size !== 2 || !endpoints.has(source) || !endpoints.has(target))) {
      throw new TypeError(`${label}.evidence must pair both unordered endpoints per signal.`);
    }
    if (!common.evidenceTruncated && common.support !== signalEndpoints.size || common.evidenceTruncated && (evidence.length !== MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE || common.support <= signalEndpoints.size)) {
      throw new TypeError(`${label}.support does not match its bounded shared signals.`);
    }
    if (version === 1) {
      if (parsedText(record.suggestedPredicate, `${label}.suggestedPredicate`, budget) !== "related-to") {
        throw new TypeError(`${label}.suggestedPredicate must be related-to.`);
      }
      return Object.freeze({
        kind: "missing-relation",
        source,
        target,
        suggestedPredicate: "related-to",
        ...common,
        evidence
      });
    }
    return Object.freeze({
      kind: "missing-relation",
      source,
      target,
      predicate: predicateDisposition(record.predicate, `${label}.predicate`, budget),
      ...common,
      evidence
    });
  }
  if (kind === "unlinked-mention") {
    exactKeys(record, ["kind", "source", "target", "support", "evidenceTruncated", "evidence"], label);
    const source = canonicalNote(record.source, `${label}.source`, budget);
    const target = canonicalNote(record.target, `${label}.target`, budget);
    const common = parsedCommonCandidate(record, label);
    const evidence = evidenceArray(record.evidence, `${label}.evidence`, budget, parsedMentionEvidence);
    if (evidence.some((entry) => entry.source !== source || entry.target !== target)) {
      throw new TypeError(`${label}.evidence must identify the candidate endpoints.`);
    }
    if (!common.evidenceTruncated && common.support !== evidence.length || common.evidenceTruncated && common.support <= evidence.length) {
      throw new TypeError(`${label}.support does not match its bounded evidence.`);
    }
    return Object.freeze({
      kind: "unlinked-mention",
      source,
      target,
      ...common,
      evidence
    });
  }
  if (kind === "relation-hygiene") {
    exactKeys(record, [
      "kind",
      "problem",
      "source",
      "target",
      "predicate",
      "message",
      "support",
      "evidenceTruncated",
      "evidence"
    ], label);
    const problem = parsedRelationProblem(record.problem, `${label}.problem`, budget);
    const source = canonicalNote(record.source, `${label}.source`, budget);
    const target = problem === "malformed-relation" ? nullableText(record.target, `${label}.target`, budget) : record.target === null ? null : canonicalNote(record.target, `${label}.target`, budget);
    const predicate = problem === "malformed-relation" ? nullableText(record.predicate, `${label}.predicate`, budget) : record.predicate === null ? null : canonicalPredicate(record.predicate, `${label}.predicate`, budget);
    const common = parsedCommonCandidate(record, label);
    const relationProblem = problem === "self-relation" || problem === "reciprocal-relation";
    const evidence = relationProblem ? evidenceArray(record.evidence, `${label}.evidence`, budget, parsedRelationEvidence) : evidenceArray(record.evidence, `${label}.evidence`, budget, parsedRelationIssueEvidence);
    if (common.support !== evidence.length) {
      throw new TypeError(`${label}.support must equal its hygiene evidence count.`);
    }
    if (relationProblem) {
      const relations = evidence;
      if (target === null || predicate === null || common.evidenceTruncated || problem === "self-relation" && target !== source || problem === "reciprocal-relation" && (compareText(source, target) >= 0 || relations.length !== 2) || relations.some((entry) => entry.predicate !== predicate || (problem === "self-relation" ? entry.source !== source || entry.target !== target : !(entry.source === source && entry.target === target || entry.source === target && entry.target === source))))
        throw new TypeError(`${label}.evidence must identify the hygiene relation.`);
    } else {
      const issues = evidence;
      const expectedIssue = problem.slice(0, -"-relation".length);
      if (issues.some((entry) => entry.source !== source || entry.issue !== expectedIssue || entry.predicate !== predicate || entry.target !== target || entry.message !== record.message) || common.evidenceTruncated !== issues.some((entry) => entry.candidatesTruncated)) {
        throw new TypeError(`${label}.evidence must identify the hygiene issue.`);
      }
    }
    return Object.freeze({
      kind: "relation-hygiene",
      problem,
      source,
      target,
      predicate,
      message: parsedText(record.message, `${label}.message`, budget),
      ...common,
      evidence
    });
  }
  throw new TypeError(`${label}.kind is unsupported.`);
}
function parsedCandidates(value, label, budget, version) {
  const input = dataArray(value, label, MAX_PERCOLATION_LIMIT, budget);
  const output = input.map((entry, index) => parseCandidate(entry, `${label}[${index}]`, budget, version));
  if (version === 1) {
    const historical = output;
    for (let index = 1;index < historical.length; index += 1) {
      const previous = historical[index - 1];
      const candidate = historical[index];
      if (previous !== undefined && candidate !== undefined && compareHistoricalCandidates(previous, candidate) > 0) {
        throw new TypeError(`${label} must use historical percolation ordering.`);
      }
    }
    return Object.freeze([...historical]);
  }
  const identities = new Set;
  const suggestedConceptIds = new Set;
  for (let index = 0;index < output.length; index += 1) {
    const candidate = output[index];
    if (candidate === undefined)
      continue;
    const identity = `${candidate.kind}\x00${candidateIdentity(candidate)}`;
    if (identities.has(identity))
      throw new TypeError(`${label} must be unique.`);
    identities.add(identity);
    if (candidate.kind === "missing-concept") {
      if (suggestedConceptIds.has(candidate.suggestedId)) {
        throw new TypeError(`${label} must use unique suggested concept IDs.`);
      }
      suggestedConceptIds.add(candidate.suggestedId);
    }
    const previous = output[index - 1];
    if (previous !== undefined && compareCandidates(previous, candidate) > 0) {
      throw new TypeError(`${label} must use canonical percolation ordering.`);
    }
  }
  return Object.freeze(output);
}
function parseResultFields(record, label, budget, version) {
  return {
    candidates: parsedCandidates(record.candidates, `${label}.candidates`, budget, version),
    truncated: parsedBoolean(record.truncated, `${label}.truncated`)
  };
}
function parsePercolationResultV1(value) {
  const budget = { nodes: 0, utf8Bytes: 0 };
  const record = dataRecord(value, "percolation result v1", budget);
  exactKeys(record, ["candidates", "truncated"], "percolation result v1");
  const fields = parseResultFields(record, "percolation result v1", budget, 1);
  return Object.freeze({
    candidates: fields.candidates,
    truncated: fields.truncated
  });
}
function parsePercolationResultV2(value) {
  const budget = { nodes: 0, utf8Bytes: 0 };
  const record = dataRecord(value, "percolation result v2", budget);
  exactKeys(record, ["schemaVersion", "candidates", "truncated"], "percolation result v2");
  if (record.schemaVersion !== PERCOLATION_RESULT_SCHEMA_VERSION) {
    throw new TypeError("percolation result v2.schemaVersion must be 2.");
  }
  const fields = parseResultFields(record, "percolation result v2", budget, 2);
  return Object.freeze({
    schemaVersion: PERCOLATION_RESULT_SCHEMA_VERSION,
    candidates: fields.candidates,
    truncated: fields.truncated
  });
}
var parsePercolationResult = parsePercolationResultV2;
function parsePercolationCliOutputV1(value) {
  const budget = { nodes: 0, utf8Bytes: 0 };
  const label = "percolation CLI output v1";
  const record = dataRecord(value, label, budget);
  exactKeys(record, ["root", "note", "minSupport", "candidates", "truncated"], label);
  const fields = parseResultFields(record, label, budget, 1);
  return Object.freeze({
    root: parsedText(record.root, `${label}.root`, budget),
    note: nullableText(record.note, `${label}.note`, budget),
    minSupport: parsedMinSupport(record.minSupport, `${label}.minSupport`),
    candidates: fields.candidates,
    truncated: fields.truncated
  });
}
function parsePercolationCliOutputV2(value) {
  const budget = { nodes: 0, utf8Bytes: 0 };
  const label = "percolation CLI output v2";
  const record = dataRecord(value, label, budget);
  exactKeys(record, [
    "root",
    "note",
    "minSupport",
    "limit",
    "schemaVersion",
    "candidates",
    "truncated"
  ], label);
  if (record.schemaVersion !== PERCOLATION_RESULT_SCHEMA_VERSION) {
    throw new TypeError(`${label}.schemaVersion must be 2.`);
  }
  const fields = parseResultFields(record, label, budget, 2);
  const limit = positiveSafeInteger(record.limit, `${label}.limit`, MAX_PERCOLATION_LIMIT);
  if (fields.candidates.length > limit || fields.truncated && fields.candidates.length !== limit) {
    throw new TypeError(`${label}.limit is inconsistent with its candidates.`);
  }
  return Object.freeze({
    root: parsedText(record.root, `${label}.root`, budget),
    note: nullableText(record.note, `${label}.note`, budget),
    minSupport: parsedMinSupport(record.minSupport, `${label}.minSupport`),
    limit,
    schemaVersion: PERCOLATION_RESULT_SCHEMA_VERSION,
    candidates: fields.candidates,
    truncated: fields.truncated
  });
}
var parsePercolationCliOutput = parsePercolationCliOutputV2;

export { DEFAULT_PERCOLATION_LIMIT, MAX_PERCOLATION_LIMIT, DEFAULT_PERCOLATION_MIN_SUPPORT, MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE, MAX_PERCOLATION_NOTES, MAX_PERCOLATION_MENTION_PAIRS, MAX_PERCOLATION_MENTIONS, MAX_SCOPED_PERCOLATION_MENTION_PAIRS, PERCOLATION_RESULT_SCHEMA_VERSION, MAX_PERCOLATION_RESULT_NODES, MAX_PERCOLATION_RESULT_UTF8_BYTES, MAX_PERCOLATION_TEXT_UTF8_BYTES, percolateVault, parsePercolationResultV1, parsePercolationResultV2, parsePercolationResult, parsePercolationCliOutputV1, parsePercolationCliOutputV2, parsePercolationCliOutput };
