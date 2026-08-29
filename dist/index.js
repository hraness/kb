// @bun
import {
  DEFAULT_WORKFLOW_OUTPUT_BYTES,
  MAX_GIT_WORKFLOW_CONCURRENCY,
  MAX_WORKFLOW_CONCURRENCY,
  MAX_WORKFLOW_NODES,
  MAX_WORKFLOW_OUTPUT_BYTES,
  WorkflowRunError,
  defineWorkflow,
  runWorkflow,
  workflowFromUnknown
} from "./index-3v2z4f0q.js";
import {
  initVault
} from "./index-mqx4nd6v.js";
import {
  MAX_SOURCE_DISPOSITION_EVIDENCE,
  MAX_SOURCE_INBOX_CONNECTIONS,
  MAX_SOURCE_INBOX_NOTES,
  MAX_SOURCE_INBOX_PREFIXES,
  MAX_SOURCE_INBOX_RESULTS,
  sourceInbox
} from "./index-pj501bh1.js";
import {
  DEFAULT_PERCOLATION_LIMIT,
  DEFAULT_PERCOLATION_MIN_SUPPORT,
  MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE,
  MAX_PERCOLATION_LIMIT,
  MAX_PERCOLATION_MENTIONS,
  MAX_PERCOLATION_MENTION_PAIRS,
  MAX_PERCOLATION_NOTES,
  MAX_SCOPED_PERCOLATION_MENTION_PAIRS,
  percolateVault
} from "./index-dyqwejk5.js";
import {
  FrozenEvaluationSnapshotError,
  knowledgeBaseEvaluationRetrieverIds,
  openKnowledgeBaseEvaluation,
  verifyFrozenEvaluationSnapshot
} from "./index-n5dd7r0v.js";
import {
  DEFAULT_SEARCH_RESULTS,
  MAX_SEARCH_CANDIDATES,
  MAX_SEARCH_NOTE_REFERENCE_BYTES,
  MAX_SEARCH_RELATED_SEEDS,
  MAX_SEARCH_RESULTS,
  MIN_UNTRUSTED_CONTEXT_BYTES,
  openKnowledgeBase,
  packSearchContext,
  packUntrustedSearchContext,
  validateKnowledgeBaseSearchHistory
} from "./index-zzhgcwyt.js";
import"./index-adx6khj5.js";
import {
  MAX_EMBEDDING_MODEL_BYTES,
  MAX_NOTE_UTF8_BYTES,
  MAX_SCANNED_NOTES,
  MAX_SEMANTIC_DATABASE_IDENTITY_BYTES,
  MAX_VAULT_UTF8_BYTES,
  VaultScanBudgetError,
  attestSemanticWarmCache,
  checkpointSemanticWarmCache,
  createVerifiedEmbeddingModelLease,
  defaultIgnoredDirectories,
  indexSemanticVault,
  markdownFiles,
  openSemanticSearchSession,
  openSemanticWarmSearchSession,
  qmdIndexerVersion,
  readVaultNotes,
  recommendedEmbeddingModel,
  recommendedEmbeddingModelSha256,
  refreshVault,
  scanVault,
  searchSemanticVault,
  semanticDatabasePath,
  sha256EmbeddingModelFile
} from "./index-zxdy5pby.js";
import"./index-4j3tt0c3.js";
import {
  GitHistoryError,
  MAX_GIT_HISTORY_COMMITS,
  MAX_GIT_HISTORY_NOTES,
  MAX_GIT_HISTORY_OUTPUT_BYTES,
  MAX_GIT_HISTORY_TIMEOUT_MS,
  MAX_GIT_NOTE_IDS_UTF8_BYTES,
  MAX_GIT_NOTE_ID_UTF8_BYTES,
  MAX_GIT_PATHS_PER_COMMIT,
  MAX_GIT_PATH_OBSERVATIONS,
  gitHistoryForNotes,
  indexGitHistory,
  parseGitHistoryOutput,
  runGitCommand,
  searchGitHistory,
  validateGitHistoryForNotesOptions,
  validateGitHistoryForNotesRequest,
  validateSearchGitHistoryOptions
} from "./index-1gwbassd.js";
import {
  MAX_BOOTSTRAP_RESAMPLES,
  MAX_EVALUATION_DIAGNOSTICS,
  MAX_EVALUATION_EVIDENCE_BYTES,
  MAX_EVALUATION_QRELS_PER_QUERY,
  MAX_EVALUATION_QUERIES,
  MAX_EVALUATION_RESULTS_PER_QUERY,
  MAX_EVALUATION_RETRIEVERS,
  MAX_EVALUATION_TEXT_BYTES,
  MAX_EVALUATION_TIMEOUT_MS,
  RETRIEVAL_EVALUATION_REPORT_VERSION,
  RETRIEVAL_EVALUATION_SCHEMA_VERSION,
  buildRetrievalEvaluationReport,
  pairedBootstrapConfidenceInterval,
  parseRetrievalEvaluationCorpus,
  runRetrievalEvaluation
} from "./index-b88v3vtm.js";
import {
  auditAgentGuideRepository,
  auditAgentGuideSource,
  auditAgentGuides,
  compareAgentGuideAudits,
  defaultAgentGuideIgnoredDirectories,
  discoverAgentGuides
} from "./index-hya40gb2.js";
import {
  MAX_ATTACHMENT_PATH_BYTES,
  MAX_ATTACHMENT_REFERENCES,
  MAX_ATTACHMENT_SCAN_ENTRIES,
  MAX_ATTACHMENT_SOURCE_BYTES,
  parseLocalAttachmentReferences,
  validateAttachmentReferences,
  validateMarkdownAttachments
} from "./index-x3fthpsc.js";
import {
  InvalidCanonicalNoteIdError,
  NoteAlreadyExistsError,
  NoteRecoveryRequiredError,
  NoteRevisionConflictError,
  addNoteRelation,
  canonicalNoteId,
  canonicalRelationTarget,
  createConceptNote,
  createNote,
  listNoteRelations,
  normalizeRelationPredicate,
  noteRevision,
  removeNoteRelation
} from "./index-01jj6rbv.js";
import"./index-3rm7cz6h.js";
import {
  createRepresentativeRetrievalFixture,
  createSyntheticRankFusionFixture,
  evaluateRanking,
  evaluateRetrievalBenchmark
} from "./index-s2gw5aw9.js";
import {
  MAX_SEARCH_QUERY_BYTES,
  MAX_SEARCH_QUERY_TERMS,
  buildGraphContext,
  fuseRankedCandidates,
  searchExactVault,
  validateSearchQuery
} from "./index-cv6fh7z5.js";
import {
  MAX_NAVIGATION_INDEXED_CONNECTIONS,
  MAX_NAVIGATION_RETURNED_CONNECTIONS,
  NavigationBudgetError,
  navigateLinks
} from "./index-d13v9ckt.js";
import {
  MAX_QUERY_FILTERS,
  MAX_QUERY_FILTER_VALUES,
  MAX_QUERY_METADATA_PATH_SEGMENTS,
  MAX_QUERY_METADATA_PATH_UTF8_BYTES,
  MAX_QUERY_ONE_OF_VALUES,
  MAX_QUERY_OPTIONS_UTF8_BYTES,
  MAX_QUERY_TAGS,
  MAX_QUERY_TEXT_UTF8_BYTES,
  metadataAtPath,
  queryVault,
  validateQueryOptions
} from "./index-48pz4jpc.js";
import {
  DEFAULT_REPOSITORY_MEMORY_DETAIL_LIMIT,
  DEFAULT_REPOSITORY_MEMORY_GROUP_LIMIT,
  MAX_REPOSITORY_MEMORY_DETAIL_LIMIT,
  MAX_REPOSITORY_MEMORY_GROUP_LIMIT,
  MAX_REPOSITORY_MEMORY_SUMMARY_UTF8_BYTES,
  MAX_REPOSITORY_SCOPES,
  MAX_REPOSITORY_SCOPES_UTF8_BYTES,
  MAX_REPOSITORY_SCOPE_UTF8_BYTES,
  RepositoryScopesError,
  activePlanStatuses,
  analyzeAuthoredRepositoryScopes,
  auditRepositoryMemoryScopes,
  buildRepositoryMemoryContext,
  canonicalRepositoryPath,
  classifyRepositoryMemoryRecord,
  deepestRepositoryScopeMatch,
  inspectRepositoryScopeState,
  isActivePlanStatus,
  isPlanStatus,
  isTerminalPlanStatus,
  metadataMatchesExactRepositoryScopes,
  planStatuses,
  repositoryMemoryGroupKeys,
  repositoryScopeMatchesPath,
  repositoryScopesMetadataKey,
  terminalPlanStatuses,
  validateRepositoryScopeSelection
} from "./index-06c9ctr6.js";
import {
  AgentContextRepositoryPathError,
  RepositoryScopeError,
  agentContextDirectory,
  agentContextGuidePath,
  agentContextHashLength,
  agentContextMarkerForScope,
  agentContextNoteId,
  agentContextNotePath,
  agentContextSlugMaximumLength,
  agentContextType,
  analyzeAgentContexts,
  formatAgentContextMarker,
  inspectAgentContextRepository,
  normalizeRepositoryScope,
  parseAgentContextMarker
} from "./index-5vwpzb5a.js";
import {
  MAX_ANALYZED_NOTES,
  MAX_CONNECTION_OBSERVATIONS,
  MAX_MENTIONS,
  MAX_MENTION_PAIRS,
  VaultAnalysisBudgetError,
  analyzeVault,
  catalogEnd,
  catalogStart,
  isCanonicalNoteId,
  lookupNote,
  metadataValueFromUnknown,
  normalizeVaultPath,
  parseNote,
  renderCatalog,
  replaceCatalog,
  searchableMarkdown,
  wikiLinks
} from "./index-cxfrakt7.js";
import"./index-1xxnjn0d.js";
// src/oh-adoption.ts
import { createHash } from "crypto";
import { posix } from "path";
var SHA256_PATTERN = /^[0-9a-f]{64}$/u;
var CODE_PATTERN = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u;
var RECORD_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u;
var MAX_CAPSULE_BYTES = 16 * 1024 * 1024;
var MAX_RECORDS = 1024;
var MAX_ROOTS = 256;
var MAX_RECORD_BYTES = 1024 * 1024;
var MAX_DEPENDENCIES = 4096;
var MAX_TEXT_BYTES = 4096;
var MAX_STRUCTURAL_NODES = 262144;
var MAX_STRUCTURAL_DEPTH = 128;
var OH_RECORD_KINDS = new Set([
  "activity",
  "assertion",
  "context",
  "dependency-manifest",
  "edition",
  "entity",
  "evidence",
  "identity-operation",
  "inquiry",
  "inquiry-event",
  "review-decision",
  "rights-decision",
  "schema",
  "shape",
  "statement",
  "type-membership",
  "view",
  "vocabulary"
]);
function isRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value, keys) {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => {
    if (typeof key !== "string" || !keys.includes(key))
      return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
  });
}
function validUnicode(value) {
  for (let index = 0;index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (next < 56320 || next > 57343)
        return false;
      index += 1;
    } else if (code >= 56320 && code <= 57343)
      return false;
  }
  return true;
}
function canonicalJson(value, path = "$", ancestors = new Set) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") {
    if (!validUnicode(value))
      throw new TypeError(`${path} contains invalid Unicode.`);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw new TypeError(`${path} is not a canonical number.`);
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || value === null || ancestors.has(value)) {
    throw new TypeError(`${path} is not an acyclic JSON value.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys2 = Reflect.ownKeys(value);
      if (keys2.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length))) {
        throw new TypeError(`${path} has non-index array properties.`);
      }
      const output = [];
      for (let index = 0;index < value.length; index += 1) {
        if (!Object.hasOwn(value, index))
          throw new TypeError(`${path} contains a sparse array.`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError(`${path}[${index}] is not an enumerable data property.`);
        }
        output.push(canonicalJson(descriptor.value, `${path}[${index}]`, ancestors));
      }
      return `[${output.join(",")}]`;
    }
    if (!isRecord(value))
      throw new TypeError(`${path} is not a plain JSON object.`);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string"))
      throw new TypeError(`${path} has symbol properties.`);
    const keys = ownKeys;
    keys.sort();
    return `{${keys.map((key) => {
      if (!validUnicode(key))
        throw new TypeError(`${path} contains an invalid key.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${path}.${key} is not an enumerable data property.`);
      }
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, `${path}.${key}`, ancestors)}`;
    }).join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function structurallyBounded(value) {
  const pending = [[value, 0]];
  const seen = new Set;
  let nodes = 0;
  while (pending.length > 0) {
    const [candidate, depth] = pending.pop();
    nodes += 1;
    if (nodes > MAX_STRUCTURAL_NODES || depth > MAX_STRUCTURAL_DEPTH)
      return false;
    if (typeof candidate === "string" && Buffer.byteLength(candidate, "utf8") > MAX_CAPSULE_BYTES)
      return false;
    if (typeof candidate !== "object" || candidate === null)
      continue;
    if (seen.has(candidate))
      return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      if (candidate.length > MAX_STRUCTURAL_NODES)
        return false;
      const keys = Reflect.ownKeys(candidate);
      if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= candidate.length)))
        return false;
      for (let index = 0;index < candidate.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
          return false;
        pending.push([descriptor.value, depth + 1]);
      }
    } else if (isRecord(candidate)) {
      const keys = Reflect.ownKeys(candidate);
      if (keys.length > MAX_STRUCTURAL_NODES || keys.some((key) => typeof key !== "string"))
        return false;
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor))
          return false;
        pending.push([descriptor.value, depth + 1]);
      }
    } else
      return false;
  }
  return true;
}
function sha(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value) ? value : null;
}
function code(value, maximum = 256) {
  return typeof value === "string" && value.length <= maximum && CODE_PATTERN.test(value) ? value : null;
}
function recordKey(value) {
  return typeof value === "string" && value.length <= 512 && RECORD_KEY_PATTERN.test(value) ? value : null;
}
function orderedUnique(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value);
}
function parseProfile(value) {
  if (!isRecord(value) || !exactKeys(value, [
    "applicationProfileSha256",
    "capabilities",
    "profileId",
    "profileKind",
    "profileSha256",
    "v"
  ]) || value.v !== 1 || value.profileKind !== "working" || !isRecord(value.capabilities) || !exactKeys(value.capabilities, [
    "changesSince",
    "dependencyClosureExport",
    "exactSnapshots",
    "operationReplication",
    "semanticBundleCommit",
    "v",
    "wholeSpacePurge"
  ]))
    return null;
  const capabilities = value.capabilities;
  if (capabilities.changesSince !== true || capabilities.dependencyClosureExport !== true || capabilities.exactSnapshots !== true || capabilities.operationReplication !== false || capabilities.semanticBundleCommit !== true || capabilities.v !== 1 || capabilities.wholeSpacePurge !== true)
    return null;
  const applicationProfileSha256 = value.applicationProfileSha256 === null ? null : sha(value.applicationProfileSha256);
  const profileId = code(value.profileId);
  const profileSha256 = sha(value.profileSha256);
  if (value.applicationProfileSha256 !== null && applicationProfileSha256 === null || profileId === null || profileSha256 === null)
    return null;
  const payload = { applicationProfileSha256, capabilities: {
    changesSince: true,
    dependencyClosureExport: true,
    exactSnapshots: true,
    operationReplication: false,
    semanticBundleCommit: true,
    v: 1,
    wholeSpacePurge: true
  }, profileId, profileKind: "working", v: 1 };
  return digest(payload) === profileSha256 ? { ...payload, profileSha256 } : null;
}
function parseBinding(value) {
  if (!isRecord(value) || !exactKeys(value, [
    "bindingSha256",
    "contractSha256",
    "profile",
    "realmId",
    "spaceId",
    "v"
  ]) || value.v !== 1)
    return null;
  const bindingSha256 = sha(value.bindingSha256);
  const contractSha256 = sha(value.contractSha256);
  const profile = parseProfile(value.profile);
  const realmId = code(value.realmId);
  const spaceId = code(value.spaceId);
  if (bindingSha256 === null || contractSha256 === null || profile === null || realmId === null || spaceId === null) {
    return null;
  }
  const payload = { contractSha256, profile, realmId, spaceId, v: 1 };
  return digest(payload) === bindingSha256 ? { ...payload, bindingSha256 } : null;
}
function parseHead(value) {
  if (!isRecord(value) || !exactKeys(value, [
    "generation",
    "graphRevisionSha256",
    "operationSha256",
    "recordsSha256",
    "sequence",
    "v"
  ]) || value.v !== 1)
    return null;
  const generation = Number.isSafeInteger(value.generation) && value.generation >= 0 ? value.generation : null;
  const sequence = Number.isSafeInteger(value.sequence) && value.sequence >= 0 ? value.sequence : null;
  const graphRevisionSha256 = value.graphRevisionSha256 === null ? null : sha(value.graphRevisionSha256);
  const operationSha256 = value.operationSha256 === null ? null : sha(value.operationSha256);
  const recordsSha256 = sha(value.recordsSha256);
  return generation !== null && generation === sequence && recordsSha256 !== null && (value.graphRevisionSha256 === null || graphRevisionSha256 !== null) && (value.operationSha256 === null || operationSha256 !== null) && sequence === 0 === (operationSha256 === null) && sequence === 0 === (graphRevisionSha256 === null) ? { generation, graphRevisionSha256, operationSha256, recordsSha256, sequence, v: 1 } : null;
}
function parseRecord(value) {
  if (!isRecord(value) || !exactKeys(value, ["dependencies", "key", "kind", "recordSha256", "v", "value"]) || value.v !== 1 || !Array.isArray(value.dependencies) || value.dependencies.length > MAX_DEPENDENCIES || !OH_RECORD_KINDS.has(value.kind) || !structurallyBounded(value.value))
    return null;
  const key = recordKey(value.key);
  const kind = typeof value.kind === "string" ? value.kind : null;
  const recordSha256 = sha(value.recordSha256);
  const dependencies = value.dependencies.map(recordKey);
  if (key === null || kind === null || recordSha256 === null || dependencies.some((item) => item === null) || !orderedUnique(dependencies) || dependencies.includes(key))
    return null;
  const payload = {
    dependencies,
    key,
    kind,
    v: 1,
    value: value.value
  };
  const encoded = canonicalJson(payload.value);
  return Buffer.byteLength(encoded, "utf8") <= MAX_RECORD_BYTES && digest(payload) === recordSha256 ? { ...payload, recordSha256 } : null;
}
function parseExpectedSource(value) {
  if (!isRecord(value) || !exactKeys(value, ["authorityId", "binding", "head", "v"]) || value.v !== 1)
    return null;
  const authorityId = code(value.authorityId);
  const binding = parseBinding(value.binding);
  const head = parseHead(value.head);
  return authorityId !== null && binding !== null && head !== null ? { authorityId, binding, head, v: 1 } : null;
}
function parseOhDependencyClosureCapsuleV1(value, expectedSource) {
  try {
    if (!structurallyBounded(value) || Buffer.byteLength(canonicalJson(value), "utf8") > MAX_CAPSULE_BYTES || !isRecord(value) || !exactKeys(value, ["binding", "closureSha256", "head", "records", "roots", "v"]) || value.v !== 1 || !Array.isArray(value.records) || !Array.isArray(value.roots) || value.records.length < 1 || value.records.length > MAX_RECORDS || value.roots.length < 1 || value.roots.length > MAX_ROOTS)
      return null;
    const expected = parseExpectedSource(expectedSource);
    const binding = parseBinding(value.binding);
    const head = parseHead(value.head);
    const closureSha256 = sha(value.closureSha256);
    const roots = value.roots.map(recordKey);
    const records = value.records.map(parseRecord);
    if (expected === null || binding === null || head === null || closureSha256 === null || roots.some((root) => root === null) || !orderedUnique(roots) || records.some((record) => record === null))
      return null;
    const parsedRecords = records;
    if (!orderedUnique(parsedRecords.map((record) => record.key)))
      return null;
    if (canonicalJson(binding) !== canonicalJson(expected.binding) || canonicalJson(head) !== canonicalJson(expected.head))
      return null;
    const byKey = new Map(parsedRecords.map((record) => [record.key, record]));
    const reachable = new Set;
    const pending = [...roots];
    while (pending.length > 0) {
      const key = pending.pop();
      if (reachable.has(key))
        continue;
      const record = byKey.get(key);
      if (record === undefined)
        return null;
      reachable.add(key);
      pending.push(...record.dependencies);
    }
    if (reachable.size !== parsedRecords.length)
      return null;
    const payload = { binding, head, records: parsedRecords, roots, v: 1 };
    return digest(payload) === closureSha256 ? { ...payload, closureSha256 } : null;
  } catch {
    return null;
  }
}
function singleLine(value) {
  if (typeof value !== "string" || value.length < 1 || value.normalize("NFC") !== value || !validUnicode(value) || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES)
    return null;
  return value;
}
function parseDestination(value) {
  if (!isRecord(value) || !exactKeys(value, ["purpose", "targetPath", "v"]) || value.v !== 1)
    return null;
  const purpose = code(value.purpose);
  if (purpose === null || typeof value.targetPath !== "string" || value.targetPath.length > 512 || value.targetPath.includes("\\") || value.targetPath.startsWith("/") || posix.normalize(value.targetPath) !== value.targetPath || !/^notes\/[a-z0-9][a-z0-9._/-]*\.md$/u.test(value.targetPath) || value.targetPath.split("/").some((segment) => segment === "." || segment === ".." || segment.startsWith("."))) {
    return null;
  }
  return { purpose, targetPath: value.targetPath, v: 1 };
}
function parseRights(value, purpose) {
  if (!isRecord(value) || !exactKeys(value, ["decisionId", "disposition", "purpose", "v"]) || value.v !== 1 || value.disposition !== "cleared-for-purpose" || value.purpose !== purpose)
    return null;
  const decisionId = code(value.decisionId);
  return decisionId === null ? null : { decisionId, disposition: "cleared-for-purpose", purpose, v: 1 };
}
function parseReview(value) {
  if (!isRecord(value) || !exactKeys(value, ["route", "status", "v"]) || value.v !== 1 || value.status !== "required")
    return null;
  const route = code(value.route);
  return route === null ? null : { route, status: "required", v: 1 };
}
function parseConflicts(value) {
  if (!isRecord(value) || !exactKeys(value, ["notes", "status", "v"]) || value.v !== 1 || value.status !== "none-observed" && value.status !== "requires-resolution" || !Array.isArray(value.notes) || value.notes.length < 1 || value.notes.length > 64)
    return null;
  const notes = value.notes.map(singleLine);
  if (notes.some((note) => note === null))
    return null;
  const sorted = [...notes].sort();
  return orderedUnique(sorted) ? { notes: sorted, status: value.status, v: 1 } : null;
}
function parseDisclosures(value, keys) {
  if (!Array.isArray(value) || value.length > 256)
    return null;
  const parsed = [];
  for (const item of value) {
    if (!isRecord(item) || !exactKeys(item, ["id", "recordKey", "summary", "v"]) || item.v !== 1)
      return null;
    const id = code(item.id);
    const key = recordKey(item.recordKey);
    const summary = singleLine(item.summary);
    if (id === null || key === null || summary === null || !keys.has(key))
      return null;
    parsed.push({ id, recordKey: key, summary, v: 1 });
  }
  parsed.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return orderedUnique(parsed.map((item) => item.id)) ? parsed : null;
}
function markdownEscape(value) {
  return value.replace(/[\\`*_{}\[\]<>()#+.!|>-]/gu, "\\$&");
}
function renderMarkdown(manifest, candidateSha256) {
  const lines = [
    "# Oh adoption candidate",
    "",
    `- Status: \`${manifest.status}\``,
    `- Candidate: \`sha256:${candidateSha256}\``,
    `- Destination: \`${manifest.destination.targetPath}\``,
    `- Purpose: \`${manifest.destination.purpose}\``,
    `- Source authority: \`${manifest.source.authorityId}\``,
    `- Source binding: \`${manifest.source.binding.bindingSha256}\``,
    `- Source head sequence: \`${manifest.source.head.sequence}\``,
    `- Source head operation: \`${manifest.source.head.operationSha256 ?? "empty"}\``,
    `- Source graph revision: \`${manifest.source.head.graphRevisionSha256 ?? "empty"}\``,
    `- Source records digest: \`${manifest.source.head.recordsSha256}\``,
    `- Closure: \`${manifest.source.closureSha256}\``,
    "",
    "This is a review candidate, not reviewed knowledge. It does not mutate a vault or adopt the source operation chain, database, projection, or derived tuples.",
    "",
    "## Required decisions",
    "",
    `- Rights: \`${manifest.rights.disposition}\` via \`${manifest.rights.decisionId}\` for \`${manifest.rights.purpose}\``,
    `- Review: \`${manifest.review.status}\` via \`${manifest.review.route}\``,
    `- Conflicts: \`${manifest.conflicts.status}\``,
    ...manifest.conflicts.notes.map((note) => `  - ${markdownEscape(note)}`),
    "",
    "## Selected roots",
    "",
    ...manifest.source.roots.map((root) => `- \`${root}\``),
    "",
    "## Exact source records",
    ""
  ];
  for (const record of manifest.source.records) {
    lines.push(`### \`${record.key}\``, "", `- Kind: \`${record.kind}\``, `- Digest: \`${record.recordSha256}\``, `- Dependencies: ${record.dependencies.length === 0 ? "none" : record.dependencies.map((key) => `\`${key}\``).join(", ")}`, "");
  }
  lines.push("## Transformations", "", ...manifest.transformations.length === 0 ? ["- None declared."] : manifest.transformations.map((item) => `- \`${item.id}\` on \`${item.recordKey}\`: ${markdownEscape(item.summary)}`), "", "## Redactions", "", ...manifest.redactions.length === 0 ? ["- None declared."] : manifest.redactions.map((item) => `- \`${item.id}\` on \`${item.recordKey}\`: ${markdownEscape(item.summary)}`), "");
  return `${lines.join(`
`)}
`;
}
function prepareOhAdoptionCandidateV1(value) {
  if (!isRecord(value) || !exactKeys(value, [
    "capsule",
    "conflicts",
    "destination",
    "expectedSource",
    "redactions",
    "review",
    "rights",
    "transformations",
    "v"
  ]) || value.v !== 1) {
    throw new TypeError("Invalid Oh adoption candidate input.");
  }
  const expectedSource = parseExpectedSource(value.expectedSource);
  const capsule = parseOhDependencyClosureCapsuleV1(value.capsule, value.expectedSource);
  const destination = parseDestination(value.destination);
  if (expectedSource === null || capsule === null || destination === null) {
    throw new TypeError("The source capsule or destination is invalid.");
  }
  const rights = parseRights(value.rights, destination.purpose);
  const review = parseReview(value.review);
  const conflicts = parseConflicts(value.conflicts);
  const recordKeys = new Set(capsule.records.map((record) => record.key));
  const transformations = parseDisclosures(value.transformations, recordKeys);
  const redactions = parseDisclosures(value.redactions, recordKeys);
  const roots = new Set(capsule.roots);
  if (rights === null || review === null || conflicts === null || transformations === null || redactions === null || capsule.records.filter((record) => roots.has(record.key)).every((record) => record.kind === "view")) {
    throw new TypeError("Adoption requires rights, review, conflict, and authoritative-root declarations.");
  }
  const source = {
    authorityId: expectedSource.authorityId,
    binding: capsule.binding,
    closureSha256: capsule.closureSha256,
    head: capsule.head,
    records: capsule.records.map((record) => ({
      dependencies: record.dependencies,
      key: record.key,
      kind: record.kind,
      recordSha256: record.recordSha256,
      v: 1
    })),
    roots: capsule.roots,
    v: 1
  };
  const manifest = {
    conflicts,
    destination,
    format: "hraness.kb.oh-adoption-candidate.v1",
    redactions,
    review,
    rights,
    source,
    status: "prepared",
    transformations,
    v: 1
  };
  const candidateSha256 = digest(manifest);
  const markdown = renderMarkdown(manifest, candidateSha256);
  if (Buffer.byteLength(markdown, "utf8") > MAX_CAPSULE_BYTES) {
    throw new RangeError("The adoption candidate exceeds its Markdown byte limit.");
  }
  return {
    artifactSha256: createHash("sha256").update(markdown).digest("hex"),
    candidateSha256,
    manifest,
    markdown,
    v: 1
  };
}
export {
  workflowFromUnknown,
  wikiLinks,
  verifyFrozenEvaluationSnapshot,
  validateSearchQuery,
  validateSearchGitHistoryOptions,
  validateRepositoryScopeSelection,
  validateQueryOptions,
  validateMarkdownAttachments,
  validateKnowledgeBaseSearchHistory,
  validateGitHistoryForNotesRequest,
  validateGitHistoryForNotesOptions,
  validateAttachmentReferences,
  terminalPlanStatuses,
  sourceInbox,
  sha256EmbeddingModelFile,
  semanticDatabasePath,
  searchableMarkdown,
  searchSemanticVault,
  searchGitHistory,
  searchExactVault,
  scanVault,
  runWorkflow,
  runRetrievalEvaluation,
  runGitCommand,
  repositoryScopesMetadataKey,
  repositoryScopeMatchesPath,
  repositoryMemoryGroupKeys,
  replaceCatalog,
  renderCatalog,
  removeNoteRelation,
  refreshVault,
  recommendedEmbeddingModelSha256,
  recommendedEmbeddingModel,
  readVaultNotes,
  queryVault,
  qmdIndexerVersion,
  prepareOhAdoptionCandidateV1,
  planStatuses,
  percolateVault,
  parseRetrievalEvaluationCorpus,
  parseOhDependencyClosureCapsuleV1,
  parseNote,
  parseLocalAttachmentReferences,
  parseGitHistoryOutput,
  parseAgentContextMarker,
  pairedBootstrapConfidenceInterval,
  packUntrustedSearchContext,
  packSearchContext,
  openSemanticWarmSearchSession,
  openSemanticSearchSession,
  openKnowledgeBaseEvaluation,
  openKnowledgeBase,
  noteRevision,
  normalizeVaultPath,
  normalizeRepositoryScope,
  normalizeRelationPredicate,
  navigateLinks,
  metadataValueFromUnknown,
  metadataMatchesExactRepositoryScopes,
  metadataAtPath,
  markdownFiles,
  lookupNote,
  listNoteRelations,
  knowledgeBaseEvaluationRetrieverIds,
  isTerminalPlanStatus,
  isPlanStatus,
  isCanonicalNoteId,
  isActivePlanStatus,
  inspectRepositoryScopeState,
  inspectAgentContextRepository,
  initVault,
  indexSemanticVault,
  indexGitHistory,
  gitHistoryForNotes,
  fuseRankedCandidates,
  formatAgentContextMarker,
  evaluateRetrievalBenchmark,
  evaluateRanking,
  discoverAgentGuides,
  defineWorkflow,
  defaultIgnoredDirectories,
  defaultAgentGuideIgnoredDirectories,
  deepestRepositoryScopeMatch,
  createVerifiedEmbeddingModelLease,
  createSyntheticRankFusionFixture,
  createRepresentativeRetrievalFixture,
  createNote,
  createConceptNote,
  compareAgentGuideAudits,
  classifyRepositoryMemoryRecord,
  checkpointSemanticWarmCache,
  catalogStart,
  catalogEnd,
  canonicalRepositoryPath,
  canonicalRelationTarget,
  canonicalNoteId,
  buildRetrievalEvaluationReport,
  buildRepositoryMemoryContext,
  buildGraphContext,
  auditRepositoryMemoryScopes,
  auditAgentGuides,
  auditAgentGuideSource,
  auditAgentGuideRepository,
  attestSemanticWarmCache,
  analyzeVault,
  analyzeAuthoredRepositoryScopes,
  analyzeAgentContexts,
  agentContextType,
  agentContextSlugMaximumLength,
  agentContextNotePath,
  agentContextNoteId,
  agentContextMarkerForScope,
  agentContextHashLength,
  agentContextGuidePath,
  agentContextDirectory,
  addNoteRelation,
  activePlanStatuses,
  WorkflowRunError,
  VaultScanBudgetError,
  VaultAnalysisBudgetError,
  RepositoryScopesError,
  RepositoryScopeError,
  RETRIEVAL_EVALUATION_SCHEMA_VERSION,
  RETRIEVAL_EVALUATION_REPORT_VERSION,
  NoteRevisionConflictError,
  NoteRecoveryRequiredError,
  NoteAlreadyExistsError,
  NavigationBudgetError,
  MIN_UNTRUSTED_CONTEXT_BYTES,
  MAX_WORKFLOW_OUTPUT_BYTES,
  MAX_WORKFLOW_NODES,
  MAX_WORKFLOW_CONCURRENCY,
  MAX_VAULT_UTF8_BYTES,
  MAX_SOURCE_INBOX_RESULTS,
  MAX_SOURCE_INBOX_PREFIXES,
  MAX_SOURCE_INBOX_NOTES,
  MAX_SOURCE_INBOX_CONNECTIONS,
  MAX_SOURCE_DISPOSITION_EVIDENCE,
  MAX_SEMANTIC_DATABASE_IDENTITY_BYTES,
  MAX_SEARCH_RESULTS,
  MAX_SEARCH_RELATED_SEEDS,
  MAX_SEARCH_QUERY_TERMS,
  MAX_SEARCH_QUERY_BYTES,
  MAX_SEARCH_NOTE_REFERENCE_BYTES,
  MAX_SEARCH_CANDIDATES,
  MAX_SCOPED_PERCOLATION_MENTION_PAIRS,
  MAX_SCANNED_NOTES,
  MAX_REPOSITORY_SCOPE_UTF8_BYTES,
  MAX_REPOSITORY_SCOPES_UTF8_BYTES,
  MAX_REPOSITORY_SCOPES,
  MAX_REPOSITORY_MEMORY_SUMMARY_UTF8_BYTES,
  MAX_REPOSITORY_MEMORY_GROUP_LIMIT,
  MAX_REPOSITORY_MEMORY_DETAIL_LIMIT,
  MAX_QUERY_TEXT_UTF8_BYTES,
  MAX_QUERY_TAGS,
  MAX_QUERY_OPTIONS_UTF8_BYTES,
  MAX_QUERY_ONE_OF_VALUES,
  MAX_QUERY_METADATA_PATH_UTF8_BYTES,
  MAX_QUERY_METADATA_PATH_SEGMENTS,
  MAX_QUERY_FILTER_VALUES,
  MAX_QUERY_FILTERS,
  MAX_PERCOLATION_NOTES,
  MAX_PERCOLATION_MENTION_PAIRS,
  MAX_PERCOLATION_MENTIONS,
  MAX_PERCOLATION_LIMIT,
  MAX_PERCOLATION_EVIDENCE_PER_CANDIDATE,
  MAX_NOTE_UTF8_BYTES,
  MAX_NAVIGATION_RETURNED_CONNECTIONS,
  MAX_NAVIGATION_INDEXED_CONNECTIONS,
  MAX_MENTION_PAIRS,
  MAX_MENTIONS,
  MAX_GIT_WORKFLOW_CONCURRENCY,
  MAX_GIT_PATH_OBSERVATIONS,
  MAX_GIT_PATHS_PER_COMMIT,
  MAX_GIT_NOTE_ID_UTF8_BYTES,
  MAX_GIT_NOTE_IDS_UTF8_BYTES,
  MAX_GIT_HISTORY_TIMEOUT_MS,
  MAX_GIT_HISTORY_OUTPUT_BYTES,
  MAX_GIT_HISTORY_NOTES,
  MAX_GIT_HISTORY_COMMITS,
  MAX_EVALUATION_TIMEOUT_MS,
  MAX_EVALUATION_TEXT_BYTES,
  MAX_EVALUATION_RETRIEVERS,
  MAX_EVALUATION_RESULTS_PER_QUERY,
  MAX_EVALUATION_QUERIES,
  MAX_EVALUATION_QRELS_PER_QUERY,
  MAX_EVALUATION_EVIDENCE_BYTES,
  MAX_EVALUATION_DIAGNOSTICS,
  MAX_EMBEDDING_MODEL_BYTES,
  MAX_CONNECTION_OBSERVATIONS,
  MAX_BOOTSTRAP_RESAMPLES,
  MAX_ATTACHMENT_SOURCE_BYTES,
  MAX_ATTACHMENT_SCAN_ENTRIES,
  MAX_ATTACHMENT_REFERENCES,
  MAX_ATTACHMENT_PATH_BYTES,
  MAX_ANALYZED_NOTES,
  InvalidCanonicalNoteIdError,
  GitHistoryError,
  FrozenEvaluationSnapshotError,
  DEFAULT_WORKFLOW_OUTPUT_BYTES,
  DEFAULT_SEARCH_RESULTS,
  DEFAULT_REPOSITORY_MEMORY_GROUP_LIMIT,
  DEFAULT_REPOSITORY_MEMORY_DETAIL_LIMIT,
  DEFAULT_PERCOLATION_MIN_SUPPORT,
  DEFAULT_PERCOLATION_LIMIT,
  AgentContextRepositoryPathError
};
