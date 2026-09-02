// @bun
import {
  DEFAULT_SEARCH_RESULTS,
  MAX_SEARCH_CANDIDATES,
  MAX_SEARCH_RESULTS,
  openKnowledgeBase,
  validateKnowledgeBaseSearchHistory
} from "./index-vxmf14m1.js";
import {
  expandSearchRequest,
  parseSearchRules
} from "./index-adx6khj5.js";
import {
  scanVault
} from "./index-5m2ydj5q.js";
import {
  indexGitHistory
} from "./index-1gwbassd.js";
import {
  MAX_ATTACHMENT_REFERENCES,
  validateMarkdownAttachments
} from "./index-x3fthpsc.js";
import {
  validateSearchQuery
} from "./index-gm9t95d9.js";
import {
  validateQueryOptions
} from "./index-48pz4jpc.js";
import {
  documentIdState,
  parseQualifiedDocumentUri,
  parseVaultKey,
  portfolioDocumentIdentity,
  portfolioVaultIdentity
} from "./index-ekpwvbra.js";

// src/portfolio.ts
import { createHash as createHash2 } from "crypto";

// src/portfolio-registry.ts
import { constants } from "fs";
import { lstat, open, realpath } from "fs/promises";
import { join, relative, resolve, sep } from "path";
var PORTFOLIO_REGISTRY_CONTRACT = "hraness.kb-portfolio/v1";
var MAX_PORTFOLIO_REGISTRY_BYTES = 1024 * 1024;
var MAX_PORTFOLIO_VAULTS = 128;
var MAX_AUTHORIZED_VAULTS = 32;
var MAX_AUTHORITY_GROUPS = 64;
var MAX_PATH_BYTES = 2048;
var MAX_TEXT_BYTES = 1024;
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function assertKeys(value, allowed, required, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw new TypeError(`${label} has unknown property ${JSON.stringify(key)}.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key))
      throw new TypeError(`${label} is missing property ${JSON.stringify(key)}.`);
  }
}
function boundedString(value, maximum, label) {
  if (typeof value !== "string")
    throw new TypeError(`${label} must be a string.`);
  if (value.normalize("NFC") !== value)
    throw new TypeError(`${label} must use NFC-normalized text.`);
  if ([...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  })) {
    throw new TypeError(`${label} must not contain control characters.`);
  }
  if (Buffer.byteLength(value, "utf8") > maximum) {
    throw new RangeError(`${label} must be at most ${maximum} UTF-8 bytes.`);
  }
  return value;
}
function registryPath(value, label, allowDot) {
  const path = boundedString(value, MAX_PATH_BYTES, label);
  if (path === "." && allowDot)
    return path;
  if (path === "" || path === "." || path.startsWith("/") || path.endsWith("/") || path.includes("\\")) {
    throw new TypeError(`${label} must be a canonical relative POSIX path.`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new TypeError(`${label} must not contain empty, dot, or parent segments.`);
  }
  return path;
}
function enumValue(value, values, label) {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new TypeError(`${label} must be one of ${values.map((item) => JSON.stringify(item)).join(", ")}.`);
  }
  return value;
}
function parseVaultEntry(value, index) {
  const label = `Portfolio vault ${index + 1}`;
  if (!isRecord(value))
    throw new TypeError(`${label} must be an object.`);
  assertKeys(value, new Set([
    "owner",
    "id",
    "repository",
    "checkout",
    "root",
    "role",
    "visibility",
    "defaultRef",
    "parserVersion"
  ]), new Set([
    "owner",
    "id",
    "repository",
    "checkout",
    "root",
    "role",
    "visibility",
    "parserVersion"
  ]), label);
  const identity = portfolioVaultIdentity(value.owner, value.id);
  const repository = parseVaultKey(value.repository).key;
  if (value.parserVersion !== 1)
    throw new TypeError(`${label} parserVersion must be exactly 1.`);
  const defaultRef = value.defaultRef === undefined ? undefined : boundedString(value.defaultRef, MAX_TEXT_BYTES, `${label} defaultRef`);
  if (defaultRef === "")
    throw new TypeError(`${label} defaultRef must not be empty.`);
  return Object.freeze({
    ...identity,
    repository,
    checkout: registryPath(value.checkout, `${label} checkout`, false),
    root: registryPath(value.root, `${label} root`, true),
    role: enumValue(value.role, ["archive", "portfolio", "repository", "sample", "template"], `${label} role`),
    visibility: enumValue(value.visibility, ["organization", "personal", "private", "public"], `${label} visibility`),
    ...defaultRef === undefined ? {} : { defaultRef },
    parserVersion: 1
  });
}
function parseAuthorityGroup(value, index, vaultKeys) {
  const label = `Portfolio authority group ${index + 1}`;
  if (!isRecord(value))
    throw new TypeError(`${label} must be an object.`);
  assertKeys(value, new Set(["id", "members", "state", "canonical", "protected", "reason"]), new Set(["id", "members", "state"]), label);
  const id = portfolioVaultIdentity("authority", value.id).id;
  if (!Array.isArray(value.members) || value.members.length < 2 || value.members.length > MAX_AUTHORIZED_VAULTS) {
    throw new RangeError(`${label} members must contain 2 through ${MAX_AUTHORIZED_VAULTS} vault keys.`);
  }
  const members = value.members.map((member) => parseVaultKey(member).key);
  if (new Set(members).size !== members.length)
    throw new TypeError(`${label} members must be unique.`);
  for (const member of members) {
    if (!vaultKeys.has(member))
      throw new TypeError(`${label} references unknown vault ${JSON.stringify(member)}.`);
  }
  const state = enumValue(value.state, ["resolved", "unresolved"], `${label} state`);
  const canonical = value.canonical === undefined ? undefined : parseVaultKey(value.canonical).key;
  if (state === "resolved") {
    if (canonical === undefined || !members.includes(canonical)) {
      throw new TypeError(`${label} resolved state requires a canonical member.`);
    }
  } else if (canonical !== undefined) {
    throw new TypeError(`${label} unresolved state must not declare a canonical member.`);
  }
  if (value.protected !== undefined && typeof value.protected !== "boolean") {
    throw new TypeError(`${label} protected must be a boolean.`);
  }
  const reason = value.reason === undefined ? undefined : boundedString(value.reason, MAX_TEXT_BYTES, `${label} reason`);
  if (reason === "")
    throw new TypeError(`${label} reason must not be empty.`);
  return Object.freeze({
    id,
    members: Object.freeze(members),
    state,
    ...canonical === undefined ? {} : { canonical },
    ...value.protected === undefined ? {} : { protected: value.protected },
    ...reason === undefined ? {} : { reason }
  });
}
function parsePortfolioRegistry(value) {
  if (!isRecord(value))
    throw new TypeError("Portfolio registry must be an object.");
  assertKeys(value, new Set(["$schema", "contract", "schemaVersion", "vaults", "authorityGroups"]), new Set(["contract", "schemaVersion", "vaults"]), "Portfolio registry");
  if (value.contract !== PORTFOLIO_REGISTRY_CONTRACT) {
    throw new TypeError(`Portfolio registry contract must be ${JSON.stringify(PORTFOLIO_REGISTRY_CONTRACT)}.`);
  }
  if (value.schemaVersion !== 1)
    throw new TypeError("Portfolio registry schemaVersion must be exactly 1.");
  if (!Array.isArray(value.vaults) || value.vaults.length > MAX_PORTFOLIO_VAULTS) {
    throw new RangeError(`Portfolio registry vaults must contain at most ${MAX_PORTFOLIO_VAULTS} entries.`);
  }
  const vaults = value.vaults.map(parseVaultEntry);
  const vaultKeys = new Set(vaults.map(({ key }) => key));
  if (vaultKeys.size !== vaults.length)
    throw new TypeError("Portfolio registry vault keys must be unique.");
  const rawGroups = value.authorityGroups ?? [];
  if (!Array.isArray(rawGroups) || rawGroups.length > MAX_AUTHORITY_GROUPS) {
    throw new RangeError(`Portfolio authorityGroups must contain at most ${MAX_AUTHORITY_GROUPS} entries.`);
  }
  const authorityGroups = rawGroups.map((group, index) => parseAuthorityGroup(group, index, vaultKeys));
  if (new Set(authorityGroups.map(({ id }) => id)).size !== authorityGroups.length) {
    throw new TypeError("Portfolio authority group IDs must be unique.");
  }
  const schema = value.$schema === undefined ? undefined : boundedString(value.$schema, MAX_TEXT_BYTES, "Portfolio registry $schema");
  return Object.freeze({
    contract: PORTFOLIO_REGISTRY_CONTRACT,
    schemaVersion: 1,
    ...schema === undefined ? {} : { schema },
    vaults: Object.freeze(vaults),
    authorityGroups: Object.freeze(authorityGroups)
  });
}
function snapshotPortfolioRegistry(registry) {
  if (!isRecord(registry))
    throw new TypeError("Portfolio registry snapshot must be an object.");
  return parsePortfolioRegistry({
    contract: registry.contract,
    schemaVersion: registry.schemaVersion,
    ...registry.schema === undefined ? {} : { $schema: registry.schema },
    vaults: Array.isArray(registry.vaults) ? registry.vaults.map((entry) => ({
      owner: entry.owner,
      id: entry.id,
      repository: entry.repository,
      checkout: entry.checkout,
      root: entry.root,
      role: entry.role,
      visibility: entry.visibility,
      ...entry.defaultRef === undefined ? {} : { defaultRef: entry.defaultRef },
      parserVersion: entry.parserVersion
    })) : registry.vaults,
    authorityGroups: Array.isArray(registry.authorityGroups) ? registry.authorityGroups.map((group) => ({
      id: group.id,
      members: group.members,
      state: group.state,
      ...group.canonical === undefined ? {} : { canonical: group.canonical },
      ...group.protected === undefined ? {} : { protected: group.protected },
      ...group.reason === undefined ? {} : { reason: group.reason }
    })) : registry.authorityGroups
  });
}
async function defaultReadRegistryFile(path, maximumBytes) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile())
      throw new Error("Portfolio registry must be a regular file.");
    if (before.nlink !== 1n)
      throw new Error("Portfolio registry must not be hard-linked.");
    if (before.size > BigInt(maximumBytes)) {
      throw new RangeError(`Portfolio registry must be at most ${maximumBytes} UTF-8 bytes.`);
    }
    const chunks = [];
    let observedBytes = 0;
    for (;; ) {
      const buffer = new Uint8Array(Math.min(64 * 1024, maximumBytes - observedBytes + 1));
      const read = await handle.read(buffer, 0, buffer.byteLength, null);
      if (read.bytesRead === 0)
        break;
      observedBytes += read.bytesRead;
      if (observedBytes > maximumBytes) {
        throw new RangeError(`Portfolio registry must be at most ${maximumBytes} UTF-8 bytes.`);
      }
      chunks.push(buffer.slice(0, read.bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.size !== BigInt(observedBytes)) {
      throw new Error("Portfolio registry changed while it was being read; retry.");
    }
    const bytes = new Uint8Array(observedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await handle.close();
  }
}
async function loadPortfolioRegistry(path, dependencies = {}) {
  const source = await (dependencies.readRegistryFile ?? defaultReadRegistryFile)(resolve(path), MAX_PORTFOLIO_REGISTRY_BYTES);
  if (Buffer.byteLength(source, "utf8") > MAX_PORTFOLIO_REGISTRY_BYTES) {
    throw new RangeError(`Portfolio registry must be at most ${MAX_PORTFOLIO_REGISTRY_BYTES} UTF-8 bytes.`);
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new SyntaxError("Portfolio registry must be valid JSON.", { cause: error });
  }
  return parsePortfolioRegistry(value);
}
function selectAuthorizedVaults(registry, authorizedVaults) {
  if (!Array.isArray(authorizedVaults) || authorizedVaults.length < 1 || authorizedVaults.length > MAX_AUTHORIZED_VAULTS) {
    throw new RangeError(`authorizedVaults must contain 1 through ${MAX_AUTHORIZED_VAULTS} explicit vault keys.`);
  }
  const checked = authorizedVaults.map((key) => parseVaultKey(key).key);
  if (new Set(checked).size !== checked.length)
    throw new TypeError("authorizedVaults must not contain duplicates.");
  const byKey = new Map(registry.vaults.map((entry) => [entry.key, entry]));
  for (const key of checked) {
    if (!byKey.has(key)) {
      throw new Error(`Authorized portfolio vault ${JSON.stringify(key)} is not available.`);
    }
  }
  const selected = new Set(checked);
  return Object.freeze(registry.vaults.filter(({ key }) => selected.has(key)));
}
function insideOrSame(parent, child) {
  const fromParent = relative(parent, child);
  return fromParent === "" || fromParent !== ".." && !fromParent.startsWith(`..${sep}`);
}
async function assertDirectoryChain(base, path, metadata, label) {
  const segments = path === "." ? [] : path.split("/");
  let current = base;
  for (const segment of segments) {
    current = join(current, segment);
    const entry = await metadata(current);
    if (entry.isSymbolicLink())
      throw new Error(`${label} must not traverse a symbolic link.`);
    if (!entry.isDirectory())
      throw new Error(`${label} must contain directories only.`);
  }
}
async function resolvePortfolioVault(entry, workspaceRoot, dependencies = {}) {
  const metadata = dependencies.lstat ?? ((path) => lstat(path));
  const canonical = dependencies.realpath ?? ((path) => realpath(path));
  const requestedWorkspace = resolve(workspaceRoot);
  const workspaceMetadata = await metadata(requestedWorkspace);
  if (workspaceMetadata.isSymbolicLink())
    throw new Error("Portfolio workspace root must not be a symbolic link.");
  if (!workspaceMetadata.isDirectory())
    throw new Error("Portfolio workspace root must be a directory.");
  const workspace = await canonical(requestedWorkspace);
  await assertDirectoryChain(workspace, entry.checkout, metadata, "Portfolio checkout");
  const repositoryRoot = await canonical(join(workspace, ...entry.checkout.split("/")));
  if (!insideOrSame(workspace, repositoryRoot))
    throw new Error("Portfolio checkout resolves outside the workspace root.");
  await assertDirectoryChain(repositoryRoot, entry.root, metadata, "Portfolio vault root");
  const root = entry.root === "." ? repositoryRoot : await canonical(join(repositoryRoot, ...entry.root.split("/")));
  if (!insideOrSame(repositoryRoot, root))
    throw new Error("Portfolio vault resolves outside its repository checkout.");
  return Object.freeze({ entry, repositoryRoot, root });
}
function rootsOverlap(left, right) {
  return insideOrSame(left, right) || insideOrSame(right, left);
}
function validateResolvedPortfolioVaults(vaults) {
  for (let left = 0;left < vaults.length; left += 1) {
    for (let right = left + 1;right < vaults.length; right += 1) {
      const first = vaults[left];
      const second = vaults[right];
      if (first !== undefined && second !== undefined && rootsOverlap(first.root, second.root)) {
        throw new Error(`Authorized portfolio vault roots overlap: ${JSON.stringify(first.entry.key)} and ${JSON.stringify(second.entry.key)}.`);
      }
    }
  }
  return Object.freeze([...vaults]);
}
async function resolveAuthorizedVaults(registry, workspaceRoot, authorizedVaults, dependencies = {}) {
  const selected = selectAuthorizedVaults(registry, authorizedVaults);
  const resolved = [];
  for (const entry of selected) {
    resolved.push(await resolvePortfolioVault(entry, workspaceRoot, dependencies));
  }
  return validateResolvedPortfolioVaults(resolved);
}

// src/portfolio-audit.ts
import { createHash } from "crypto";
var DEFAULT_PORTFOLIO_AUDIT_ISSUES = 500;
var MAX_PORTFOLIO_AUDIT_ISSUES = 5000;
function checkedLimit(value, fallback, maximum, label) {
  const checked = value ?? fallback;
  if (!Number.isSafeInteger(checked) || checked < 1 || checked > maximum) {
    throw new RangeError(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return checked;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function descriptor(entry) {
  return Object.freeze({
    owner: entry.owner,
    id: entry.id,
    key: entry.key,
    role: entry.role,
    visibility: entry.visibility
  });
}
function defaultSha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
function attachmentMessage(issue) {
  return `${issue.kind}: ${issue.message}`;
}
function activeRole(role) {
  return role === "portfolio" || role === "repository";
}
function protectedDuplicate(references, groups) {
  const keys = new Set(references.map(({ vault }) => vault.key));
  return groups.some((group) => group.protected === true && keys.size > 1 && [...keys].every((key) => group.members.includes(key)));
}
async function auditKnowledgePortfolio(options, dependencies = {}) {
  const maximumIssues = checkedLimit(options.maxIssues, DEFAULT_PORTFOLIO_AUDIT_ISSUES, MAX_PORTFOLIO_AUDIT_ISSUES, "Portfolio audit issue limit");
  const maximumAttachments = checkedLimit(options.maxAttachmentReferences, MAX_ATTACHMENT_REFERENCES, MAX_ATTACHMENT_REFERENCES, "Portfolio attachment reference limit");
  const registry = snapshotPortfolioRegistry(options.registry ?? await (dependencies.loadPortfolioRegistry ?? loadPortfolioRegistry)(options.registryPath, dependencies));
  const selected = selectAuthorizedVaults(registry, options.authorizedVaults);
  const selectedKeys = new Set(selected.map(({ key }) => key));
  const selectedAuthority = registry.authorityGroups.filter(({ members }) => members.every((member) => selectedKeys.has(member)));
  const issues = [];
  const counts = {
    advisory: 0,
    error: 0,
    warning: 0
  };
  const severityRank = {
    advisory: 0,
    warning: 1,
    error: 2
  };
  let truncated = false;
  const addIssue = (issue) => {
    counts[issue.severity] += 1;
    if (issues.length >= maximumIssues) {
      truncated = true;
      let weakestIndex = 0;
      for (let index = 1;index < issues.length; index += 1) {
        const candidate = issues[index];
        const weakest2 = issues[weakestIndex];
        if (candidate !== undefined && weakest2 !== undefined && severityRank[candidate.severity] < severityRank[weakest2.severity]) {
          weakestIndex = index;
        }
      }
      const weakest = issues[weakestIndex];
      if (weakest !== undefined && severityRank[issue.severity] > severityRank[weakest.severity]) {
        issues[weakestIndex] = Object.freeze({
          ...issue,
          ...issue.related === undefined ? {} : { related: Object.freeze([...issue.related]) }
        });
      }
      return;
    }
    issues.push(Object.freeze({
      ...issue,
      ...issue.related === undefined ? {} : { related: Object.freeze([...issue.related]) }
    }));
  };
  for (const group of selectedAuthority) {
    if (group.state !== "unresolved")
      continue;
    addIssue({
      code: "authority-unresolved",
      severity: "warning",
      message: `Authority group ${JSON.stringify(group.id)} remains unresolved across explicitly selected members.`,
      ...group.protected === undefined ? {} : { protected: group.protected }
    });
  }
  const resolved = [];
  const summaries = [];
  for (const entry of selected) {
    try {
      resolved.push(await (dependencies.resolvePortfolioVault ?? resolvePortfolioVault)(entry, options.workspaceRoot, dependencies));
    } catch (error) {
      const vault = descriptor(entry);
      addIssue({
        code: "vault-unavailable",
        severity: "error",
        vault,
        message: errorMessage(error)
      });
      summaries.push(Object.freeze({
        vault,
        status: "unavailable",
        notes: 0,
        stableDocuments: 0,
        legacyDocuments: 0,
        index: null,
        head: null
      }));
    }
  }
  let auditable = resolved;
  try {
    auditable = validateResolvedPortfolioVaults(resolved);
  } catch (error) {
    addIssue({
      code: "root-overlap",
      severity: "error",
      message: errorMessage(error)
    });
    for (const resolvedVault of resolved) {
      summaries.push(Object.freeze({
        vault: descriptor(resolvedVault.entry),
        status: "unavailable",
        notes: 0,
        stableDocuments: 0,
        legacyDocuments: 0,
        index: null,
        head: null
      }));
    }
    auditable = [];
  }
  const duplicateCandidates = [];
  const availableStableUris = new Set;
  const externalRelationCandidates = [];
  for (const resolvedVault of auditable) {
    const vault = descriptor(resolvedVault.entry);
    let snapshot;
    try {
      snapshot = await (dependencies.scanVault ?? scanVault)(resolvedVault.root, {
        ...options.scan ?? {},
        mentionScope: false
      });
    } catch (error) {
      addIssue({
        code: "scan-unavailable",
        severity: "error",
        vault,
        message: errorMessage(error)
      });
      summaries.push(Object.freeze({
        vault,
        status: "unavailable",
        notes: 0,
        stableDocuments: 0,
        legacyDocuments: 0,
        index: null,
        head: null
      }));
      continue;
    }
    if (snapshot.index === "stale") {
      addIssue({
        code: "catalog-stale",
        severity: "warning",
        vault,
        message: "The managed vault catalog is stale."
      });
    }
    let stableDocuments = 0;
    let legacyDocuments = 0;
    const pathsByDocumentId = new Map;
    const hash = dependencies.sha256 ?? defaultSha256;
    for (const note of snapshot.notes) {
      const state = documentIdState(note.metadata);
      const identity = portfolioDocumentIdentity(vault, note.path, note.metadata);
      if (state.kind === "valid") {
        stableDocuments += 1;
        if (identity.kind === "stable")
          availableStableUris.add(identity.uri);
        const paths = pathsByDocumentId.get(state.documentId) ?? [];
        paths.push(note.path);
        pathsByDocumentId.set(state.documentId, paths);
      } else {
        legacyDocuments += 1;
        addIssue(state.kind === "missing" ? {
          code: "missing-document-id",
          severity: activeRole(resolvedVault.entry.role) ? "warning" : "advisory",
          vault,
          path: note.path,
          message: "Authored note has no stable document_id and is available only by legacy path."
        } : {
          code: "invalid-document-id",
          severity: "error",
          vault,
          path: note.path,
          message: "Authored note has an invalid document_id and is available only by legacy path."
        });
      }
      duplicateCandidates.push(Object.freeze({
        vault,
        path: note.path,
        identity,
        hash: hash(note.content)
      }));
    }
    for (const [documentId, paths] of pathsByDocumentId) {
      if (paths.length < 2)
        continue;
      addIssue({
        code: "duplicate-document-id",
        severity: "error",
        vault,
        message: `document_id ${JSON.stringify(documentId)} is authored by multiple notes in this vault.`,
        related: paths.toSorted().map((path) => ({
          vault,
          path,
          identity: portfolioDocumentIdentity(vault, path, { document_id: documentId })
        }))
      });
    }
    for (const issue of snapshot.analysis.issues) {
      addIssue({
        code: issue.kind === "broken" ? "broken-link" : "ambiguous-link",
        severity: issue.kind === "broken" ? "error" : "warning",
        vault,
        path: issue.source,
        line: issue.line,
        message: issue.kind === "broken" ? `Broken link target ${JSON.stringify(issue.target)}.` : `Ambiguous link target ${JSON.stringify(issue.target)}.`
      });
    }
    for (const issue of snapshot.analysis.relationIssues) {
      addIssue({
        code: "relation",
        severity: "error",
        vault,
        path: issue.source,
        line: issue.line,
        message: issue.kind === "malformed" ? issue.message : `${issue.kind} relation target ${JSON.stringify(issue.target)} for ${JSON.stringify(issue.predicate)}.`
      });
    }
    for (const relation of snapshot.analysis.externalAuthoredRelations) {
      externalRelationCandidates.push(Object.freeze({
        vault,
        path: relation.provenance.source,
        line: relation.provenance.line,
        predicate: relation.predicate,
        target: relation.target
      }));
    }
    try {
      const attachmentReport = await (dependencies.validateMarkdownAttachments ?? validateMarkdownAttachments)({
        root: snapshot.root,
        documents: snapshot.notes.map(({ path, content }) => ({ path, content })),
        maxReferences: maximumAttachments
      });
      for (const issue of attachmentReport.issues) {
        addIssue({
          code: "attachment",
          severity: "error",
          vault,
          path: issue.source,
          line: issue.line,
          message: attachmentMessage(issue)
        });
      }
      if (attachmentReport.truncated)
        truncated = true;
    } catch (error) {
      addIssue({
        code: "attachment",
        severity: "error",
        vault,
        message: `Attachment audit failed: ${errorMessage(error)}`
      });
    }
    let head = null;
    try {
      const indexed = await (dependencies.indexGitHistory ?? indexGitHistory)({
        repository: resolvedVault.repositoryRoot,
        root: resolvedVault.root,
        notes: [],
        maxCommits: 1
      }, dependencies.git);
      if (indexed.status === "ready")
        head = indexed.head;
      else {
        addIssue({
          code: "git-unavailable",
          severity: "warning",
          vault,
          message: indexed.reason
        });
      }
    } catch (error) {
      addIssue({
        code: "git-unavailable",
        severity: "warning",
        vault,
        message: errorMessage(error)
      });
    }
    summaries.push(Object.freeze({
      vault,
      status: "audited",
      notes: snapshot.notes.length,
      stableDocuments,
      legacyDocuments,
      index: snapshot.index,
      head
    }));
  }
  for (const relation of externalRelationCandidates) {
    if (availableStableUris.has(relation.target))
      continue;
    addIssue({
      code: "external-relation-unavailable",
      severity: "error",
      vault: relation.vault,
      path: relation.path,
      line: relation.line,
      message: `Cross-vault relation target ${JSON.stringify(relation.target)} for ${JSON.stringify(relation.predicate)} is not available among the explicitly selected, successfully audited vaults.`
    });
  }
  const candidatesByHash = new Map;
  for (const candidate of duplicateCandidates) {
    const group = candidatesByHash.get(candidate.hash) ?? [];
    group.push({ vault: candidate.vault, path: candidate.path, identity: candidate.identity });
    candidatesByHash.set(candidate.hash, group);
  }
  for (const [hash, references] of candidatesByHash) {
    if (references.length < 2)
      continue;
    const related = references.toSorted((left, right) => left.vault.key.localeCompare(right.vault.key) || left.path.localeCompare(right.path));
    const isProtected = protectedDuplicate(related, selectedAuthority);
    addIssue({
      code: "duplicate-content",
      severity: related.some(({ vault }) => activeRole(vault.role)) ? "warning" : "advisory",
      message: `Exact authored content SHA-256 ${hash} occurs in multiple selected notes; no authority was inferred.`,
      ...isProtected ? { protected: true } : {},
      related
    });
  }
  const orderedSummaries = summaries.toSorted((left, right) => left.vault.key.localeCompare(right.vault.key));
  const audited = orderedSummaries.filter(({ status }) => status === "audited");
  const unavailable = orderedSummaries.filter(({ status }) => status === "unavailable");
  return Object.freeze({
    partial: unavailable.length > 0 || truncated,
    truncated,
    selectedVaults: selected.length,
    auditedVaults: audited.length,
    unavailableVaults: unavailable.length,
    notes: audited.reduce((count, summary) => count + summary.notes, 0),
    stableDocuments: audited.reduce((count, summary) => count + summary.stableDocuments, 0),
    legacyDocuments: audited.reduce((count, summary) => count + summary.legacyDocuments, 0),
    counts: Object.freeze(counts),
    vaults: Object.freeze(orderedSummaries),
    authority: Object.freeze(selectedAuthority.map((group) => Object.freeze({
      id: group.id,
      state: group.state,
      protected: group.protected ?? false
    }))),
    issues: Object.freeze(issues)
  });
}

// src/portfolio.ts
var MAX_PORTFOLIO_SEARCH_CONCURRENCY = 8;
var MAX_PORTFOLIO_REVISION_BYTES = 64 * 1024;

class PortfolioOpenError extends Error {
  diagnostics;
  constructor(message, diagnostics, options) {
    super(message, options);
    this.name = "PortfolioOpenError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

class PortfolioSearchError extends Error {
  vault;
  constructor(vault, message, options) {
    super(message, options);
    this.name = "PortfolioSearchError";
    this.vault = vault;
  }
}
function checkedInteger(value, fallback, maximum, label) {
  const checked = value ?? fallback;
  if (!Number.isSafeInteger(checked) || checked < 1 || checked > maximum) {
    throw new RangeError(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return checked;
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}
function descriptor2(entry) {
  return Object.freeze({
    owner: entry.owner,
    id: entry.id,
    key: entry.key,
    role: entry.role,
    visibility: entry.visibility
  });
}
function defaultSha2562(content) {
  return createHash2("sha256").update(content, "utf8").digest("hex");
}
function contentRevision(session, noteId, sha256) {
  try {
    const read = session.read(noteId, { maxBytes: MAX_PORTFOLIO_REVISION_BYTES });
    return read.truncated ? Object.freeze({ complete: false, sha256: null }) : Object.freeze({ complete: true, sha256: sha256(read.content) });
  } catch {
    return Object.freeze({ complete: false, sha256: null });
  }
}
function indexedRows(session) {
  const rows = session.list();
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const mutableIds = new Map;
  for (const row of rows) {
    const identity = portfolioDocumentIdentity({ owner: "index", id: "index" }, row.path, row.metadata);
    if (identity.kind !== "stable")
      continue;
    const ids = mutableIds.get(identity.documentId) ?? [];
    ids.push(row.id);
    mutableIds.set(identity.documentId, ids);
  }
  return {
    rowsById,
    idsByDocumentId: new Map([...mutableIds].map(([documentId, ids]) => [
      documentId,
      Object.freeze(ids.toSorted())
    ]))
  };
}
async function repositoryProbe(resolved, dependencies) {
  const vault = descriptor2(resolved.entry);
  const unavailable = (message) => ({
    provenance: Object.freeze({
      id: resolved.entry.repository,
      ...resolved.entry.defaultRef === undefined ? {} : { defaultRef: resolved.entry.defaultRef },
      head: null
    }),
    diagnostic: Object.freeze({ vault, lane: "git", status: "unavailable", message })
  });
  try {
    const indexed = await (dependencies.indexGitHistory ?? indexGitHistory)({
      repository: resolved.repositoryRoot,
      root: resolved.root,
      notes: [],
      maxCommits: 1
    }, dependencies.git);
    if (indexed.status === "unavailable")
      return unavailable(indexed.reason);
    return {
      provenance: Object.freeze({
        id: resolved.entry.repository,
        ...resolved.entry.defaultRef === undefined ? {} : { defaultRef: resolved.entry.defaultRef },
        head: indexed.head
      })
    };
  } catch (error) {
    return unavailable(errorMessage2(error));
  }
}
async function closeOpened(vaults) {
  await Promise.all(vaults.map(({ session }) => session.close().catch(() => {
    return;
  })));
}
async function mapConcurrent(values, concurrency, operation) {
  const results = new Array(values.length);
  let cursor = 0;
  const worker = async () => {
    for (;; ) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length)
        return;
      const value = values[index];
      if (value !== undefined)
        results[index] = await operation(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}
function maybeQualifiedIdentity(query) {
  try {
    return parseQualifiedDocumentUri(query);
  } catch {
    return null;
  }
}
function identitySortKey(identity) {
  return identity.kind === "stable" ? identity.uri : identity.path;
}
async function openKnowledgePortfolio(options, dependencies = {}) {
  const failurePolicy = options.failurePolicy ?? "partial";
  if (failurePolicy !== "partial" && failurePolicy !== "required") {
    throw new TypeError('Portfolio failurePolicy must be "partial" or "required".');
  }
  const searchConcurrency = checkedInteger(options.searchConcurrency, 4, MAX_PORTFOLIO_SEARCH_CONCURRENCY, "Portfolio search concurrency");
  const configuredSearchRules = options.knowledgeBase?.searchRules === undefined ? null : parseSearchRules(options.knowledgeBase.searchRules);
  const registry = snapshotPortfolioRegistry(options.registry ?? await (dependencies.loadPortfolioRegistry ?? loadPortfolioRegistry)(options.registryPath, dependencies));
  const selected = selectAuthorizedVaults(registry, options.authorizedVaults);
  const diagnostics = [];
  const resolved = [];
  for (const entry of selected) {
    try {
      resolved.push(await (dependencies.resolvePortfolioVault ?? resolvePortfolioVault)(entry, options.workspaceRoot, dependencies));
    } catch (error) {
      diagnostics.push(Object.freeze({
        vault: descriptor2(entry),
        lane: "resolve",
        status: "unavailable",
        message: errorMessage2(error)
      }));
      if (failurePolicy === "required") {
        throw new PortfolioOpenError("A required portfolio vault could not be resolved.", diagnostics, {
          cause: error
        });
      }
    }
  }
  validateResolvedPortfolioVaults(resolved);
  const opened = [];
  for (const vault of resolved) {
    const vaultDescriptor = descriptor2(vault.entry);
    const probe = await repositoryProbe(vault, dependencies);
    if (probe.diagnostic !== undefined)
      diagnostics.push(probe.diagnostic);
    let session;
    try {
      const knowledgeBase = options.knowledgeBase ?? {};
      session = await (dependencies.openKnowledgeBase ?? openKnowledgeBase)({
        ...knowledgeBase,
        ...configuredSearchRules === null ? {} : { searchRules: configuredSearchRules },
        vaultId: vaultDescriptor.key,
        root: vault.root,
        repository: vault.repositoryRoot,
        scan: {
          ...knowledgeBase.scan ?? {},
          catalogMode: "authored"
        }
      }, dependencies.knowledgeBase);
      const indexed = indexedRows(session);
      opened.push({
        resolved: vault,
        descriptor: vaultDescriptor,
        repository: probe.provenance,
        session,
        ...indexed
      });
    } catch (error) {
      await session?.close().catch(() => {
        return;
      });
      diagnostics.push(Object.freeze({
        vault: vaultDescriptor,
        lane: "open",
        status: "unavailable",
        message: errorMessage2(error)
      }));
      if (failurePolicy === "required") {
        await closeOpened(opened);
        throw new PortfolioOpenError("A required portfolio vault could not be opened.", diagnostics, {
          cause: error
        });
      }
    }
  }
  const openedByKey = new Map(opened.map((vault) => [vault.descriptor.key, vault]));
  const hash = dependencies.sha256 ?? defaultSha2562;
  let closed = false;
  let closePromise;
  const assertOpen = () => {
    if (closed)
      throw new Error("Knowledge-portfolio session is closed.");
  };
  const search = async (searchOptions) => {
    assertOpen();
    const { query } = validateSearchQuery(searchOptions.query);
    if (searchOptions.graph !== undefined && searchOptions.graph !== false) {
      throw new TypeError("Portfolio graph requests must be false; graph seeds require a qualified vault route.");
    }
    const limit = checkedInteger(searchOptions.limit, DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS, "Portfolio search limit");
    const candidateLimit = checkedInteger(searchOptions.candidateLimit, Math.max(40, limit * 4), MAX_SEARCH_CANDIDATES, "Portfolio candidate limit");
    if (candidateLimit < limit) {
      throw new RangeError("Portfolio candidate limit must be at least the result limit.");
    }
    const validationRequest = configuredSearchRules === null ? searchOptions : {
      ...searchOptions,
      ...expandSearchRequest({
        query: searchOptions.query,
        ...searchOptions.mode === undefined ? {} : { mode: searchOptions.mode },
        ...searchOptions.filters === undefined ? {} : { filters: searchOptions.filters },
        ...searchOptions.tags === undefined ? {} : { tags: searchOptions.tags },
        ...searchOptions.repositoryScopes === undefined ? {} : { repositoryScopes: searchOptions.repositoryScopes }
      }, configuredSearchRules).request
    };
    validateSearchQuery(validationRequest.query);
    validateQueryOptions({
      ...validationRequest.filters === undefined ? {} : { filters: validationRequest.filters },
      ...validationRequest.tags === undefined ? {} : { tags: validationRequest.tags },
      ...validationRequest.repositoryScopes === undefined ? {} : { repositoryScopes: validationRequest.repositoryScopes }
    });
    const validatedMode = validationRequest.mode ?? "hybrid";
    if (validatedMode !== "exact" && validatedMode !== "hybrid" && validatedMode !== "keyword" && validatedMode !== "semantic") {
      throw new TypeError("Portfolio search mode must be exact, hybrid, keyword, or semantic.");
    }
    const validatedOrdering = validationRequest.ordering ?? "relevance";
    if (validatedOrdering !== "relevance" && validatedOrdering !== "priority-then-relevance") {
      throw new TypeError('Portfolio search ordering must be "relevance" or "priority-then-relevance".');
    }
    if (validationRequest.minScore !== undefined && (!Number.isFinite(validationRequest.minScore) || validationRequest.minScore < 0 || validationRequest.minScore > 1)) {
      throw new RangeError("Portfolio search minimum score must be a number from 0 through 1.");
    }
    if (validatedMode === "exact" && validationRequest.minScore !== undefined) {
      throw new Error("Portfolio search minimum score applies only to hybrid, keyword, or semantic mode.");
    }
    validateKnowledgeBaseSearchHistory(validationRequest.history);
    const routed = maybeQualifiedIdentity(query);
    const searchedVaults = routed === null ? opened : opened.filter(({ descriptor: selectedVault }) => selectedVault.key === routed.vault.key);
    const routedLocalIds = routed === null || searchedVaults[0] === undefined ? undefined : searchedVaults[0].idsByDocumentId.get(routed.documentId);
    if (routedLocalIds !== undefined && routedLocalIds.length > 1) {
      throw new Error("Qualified document identity is ambiguous in its selected vault.");
    }
    const localOptions = {
      ...searchOptions.mode === undefined ? {} : { mode: searchOptions.mode },
      ...searchOptions.ordering === undefined ? {} : { ordering: searchOptions.ordering },
      ...searchOptions.filters === undefined ? {} : { filters: searchOptions.filters },
      ...searchOptions.tags === undefined ? {} : { tags: searchOptions.tags },
      ...searchOptions.repositoryScopes === undefined ? {} : { repositoryScopes: searchOptions.repositoryScopes },
      limit,
      candidateLimit,
      ...searchOptions.minScore === undefined ? {} : { minScore: searchOptions.minScore },
      graph: false,
      ...searchOptions.history === undefined ? {} : { history: searchOptions.history }
    };
    const outcomes = await mapConcurrent(searchedVaults, searchConcurrency, async (vault) => {
      try {
        const routedLocalId = routed === null ? undefined : routedLocalIds?.[0];
        const result = await vault.session.search({
          ...localOptions,
          query: routedLocalId ?? routed?.documentId ?? query,
          ...routed === null ? {} : {
            mode: "exact",
            filters: Object.freeze([
              ...localOptions.filters ?? [],
              { kind: "equals", path: "document_id", value: routed.documentId }
            ])
          }
        });
        return { kind: "success", opened: vault, result };
      } catch (error) {
        return { kind: "failure", opened: vault, error };
      }
    });
    const vaultDiagnostics = diagnostics.filter(({ lane }) => lane !== "git").map((diagnostic) => Object.freeze({
      vault: diagnostic.vault,
      status: "unavailable",
      results: 0,
      message: diagnostic.message
    }));
    const candidates = [];
    for (const outcome of outcomes) {
      if (outcome.kind === "failure") {
        if (failurePolicy === "required") {
          throw new PortfolioSearchError(outcome.opened.descriptor, "A required portfolio vault search failed.", { cause: outcome.error });
        }
        vaultDiagnostics.push(Object.freeze({
          vault: outcome.opened.descriptor,
          status: "unavailable",
          results: 0,
          message: errorMessage2(outcome.error)
        }));
        continue;
      }
      vaultDiagnostics.push(Object.freeze({
        vault: outcome.opened.descriptor,
        status: outcome.result.partial ? "partial" : "ready",
        results: outcome.result.results.length,
        lanes: outcome.result.diagnostics.lanes,
        ...outcome.result.rules === undefined ? {} : { rules: outcome.result.rules }
      }));
      for (const hit of outcome.result.results) {
        const identity = portfolioDocumentIdentity(outcome.opened.descriptor, hit.path, hit.metadata);
        if (routed !== null && (identity.kind !== "stable" || identity.documentId !== routed.documentId)) {
          continue;
        }
        const localRank = hit.rank;
        candidates.push({
          opened: outcome.opened,
          hit,
          identity,
          exactIdentity: routed !== null || hit.identity,
          localRank,
          score: 1 / (60 + localRank)
        });
      }
    }
    const ordered = candidates.toSorted((left, right) => Number(right.exactIdentity) - Number(left.exactIdentity) || right.score - left.score || left.opened.descriptor.key.localeCompare(right.opened.descriptor.key) || identitySortKey(left.identity).localeCompare(identitySortKey(right.identity)) || left.hit.path.localeCompare(right.hit.path));
    const results = ordered.slice(0, limit).map((candidate, index) => Object.freeze({
      identity: candidate.identity,
      vault: candidate.opened.descriptor,
      repository: candidate.opened.repository,
      id: candidate.hit.id,
      path: candidate.hit.path,
      title: candidate.hit.title,
      rank: index + 1,
      score: candidate.score,
      exactIdentity: candidate.exactIdentity,
      localRank: candidate.localRank,
      revision: contentRevision(candidate.opened.session, candidate.hit.id, hash),
      snippet: candidate.hit.snippet,
      ...candidate.hit.line === undefined ? {} : { line: candidate.hit.line },
      tags: candidate.hit.tags,
      metadata: candidate.hit.metadata,
      evidence: candidate.hit.evidence,
      local: candidate.hit
    }));
    const partial = diagnostics.length > 0 || vaultDiagnostics.some(({ status }) => status !== "ready");
    const successfulModes = new Set(outcomes.flatMap((outcome) => outcome.kind === "success" ? [outcome.result.mode] : []));
    if (successfulModes.size > 1) {
      throw new Error("Selected vaults produced inconsistent effective search modes.");
    }
    const effectiveMode = routed === null ? successfulModes.values().next().value ?? validatedMode : "exact";
    return Object.freeze({
      query,
      mode: effectiveMode,
      results: Object.freeze(results),
      partial,
      diagnostics: Object.freeze({
        selectedVaults: selected.length,
        availableVaults: opened.length,
        notes: opened.reduce((count, vault) => count + vault.session.noteCount, 0),
        open: Object.freeze([...diagnostics]),
        vaults: Object.freeze(vaultDiagnostics)
      })
    });
  };
  const read = (value, readOptions = {}) => {
    assertOpen();
    const identity = parseQualifiedDocumentUri(value);
    const vault = openedByKey.get(identity.vault.key);
    if (vault === undefined)
      throw new Error("Qualified document is not available in this portfolio session.");
    const ids = vault.idsByDocumentId.get(identity.documentId);
    if (ids === undefined || ids.length === 0) {
      throw new Error("Qualified document is not available in this portfolio session.");
    }
    if (ids.length > 1) {
      throw new Error("Qualified document identity is ambiguous within its vault.");
    }
    const noteId = ids[0];
    if (noteId === undefined || !vault.rowsById.has(noteId)) {
      throw new Error("Qualified document is not available in this portfolio session.");
    }
    const result = vault.session.read(noteId, readOptions);
    return Object.freeze({
      ...result,
      identity,
      vault: vault.descriptor,
      repository: vault.repository,
      revision: result.truncated ? Object.freeze({ complete: false, sha256: null }) : Object.freeze({ complete: true, sha256: hash(result.content) })
    });
  };
  return Object.freeze({
    selectedVaultCount: selected.length,
    availableVaultCount: opened.length,
    noteCount: opened.reduce((count, vault) => count + vault.session.noteCount, 0),
    openDiagnostics: Object.freeze([...diagnostics]),
    search,
    read,
    close: () => {
      if (closePromise !== undefined)
        return closePromise;
      closed = true;
      closePromise = Promise.allSettled(opened.map(({ session }) => session.close())).then((settled) => {
        const errors = settled.filter((result) => result.status === "rejected").map(({ reason }) => reason);
        if (errors.length > 0)
          throw new AggregateError(errors, "One or more portfolio vault sessions failed to close.");
      });
      return closePromise;
    }
  });
}

export { PORTFOLIO_REGISTRY_CONTRACT, MAX_PORTFOLIO_REGISTRY_BYTES, MAX_PORTFOLIO_VAULTS, MAX_AUTHORIZED_VAULTS, MAX_AUTHORITY_GROUPS, parsePortfolioRegistry, snapshotPortfolioRegistry, loadPortfolioRegistry, selectAuthorizedVaults, resolvePortfolioVault, validateResolvedPortfolioVaults, resolveAuthorizedVaults, DEFAULT_PORTFOLIO_AUDIT_ISSUES, MAX_PORTFOLIO_AUDIT_ISSUES, auditKnowledgePortfolio, MAX_PORTFOLIO_SEARCH_CONCURRENCY, MAX_PORTFOLIO_REVISION_BYTES, PortfolioOpenError, PortfolioSearchError, openKnowledgePortfolio };
