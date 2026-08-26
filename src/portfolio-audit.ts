import { createHash } from "node:crypto";

import {
  MAX_ATTACHMENT_REFERENCES,
  validateMarkdownAttachments,
  type AttachmentIssue,
} from "./attachments.js";
import {
  indexGitHistory,
  type GitHistoryDependencies,
} from "./git.js";
import {
  documentIdState,
  portfolioDocumentIdentity,
  type PortfolioDocumentIdentity,
  type VaultKey,
} from "./portfolio-identity.js";
import {
  loadPortfolioRegistry,
  snapshotPortfolioRegistry,
  resolvePortfolioVault,
  selectAuthorizedVaults,
  validateResolvedPortfolioVaults,
  type PortfolioAuthorityGroup,
  type PortfolioPathDependencies,
  type PortfolioRegistryFileDependencies,
  type PortfolioRegistryV1,
  type PortfolioVaultEntry,
  type ResolvedPortfolioVault,
} from "./portfolio-registry.js";
import {
  scanVault,
  type ScanVaultOptions,
  type VaultSnapshot,
} from "./vault.js";

export const DEFAULT_PORTFOLIO_AUDIT_ISSUES = 500;
export const MAX_PORTFOLIO_AUDIT_ISSUES = 5_000;

export type PortfolioAuditSeverity = "advisory" | "error" | "warning";

export type PortfolioAuditIssueCode =
  | "ambiguous-link"
  | "attachment"
  | "authority-unresolved"
  | "broken-link"
  | "catalog-stale"
  | "duplicate-content"
  | "duplicate-document-id"
  | "external-relation-unavailable"
  | "git-unavailable"
  | "invalid-document-id"
  | "missing-document-id"
  | "relation"
  | "root-overlap"
  | "scan-unavailable"
  | "vault-unavailable";

export type PortfolioAuditVault = {
  readonly owner: string;
  readonly id: string;
  readonly key: VaultKey;
  readonly role: PortfolioVaultEntry["role"];
  readonly visibility: PortfolioVaultEntry["visibility"];
};

export type PortfolioAuditReference = {
  readonly vault: PortfolioAuditVault;
  readonly path: string;
  readonly identity: PortfolioDocumentIdentity;
};

export type PortfolioAuditIssue = {
  readonly code: PortfolioAuditIssueCode;
  readonly severity: PortfolioAuditSeverity;
  readonly message: string;
  readonly vault?: PortfolioAuditVault;
  readonly path?: string;
  readonly line?: number;
  readonly protected?: boolean;
  readonly related?: readonly PortfolioAuditReference[];
};

export type PortfolioVaultAuditSummary = {
  readonly vault: PortfolioAuditVault;
  readonly status: "audited" | "unavailable";
  readonly notes: number;
  readonly stableDocuments: number;
  readonly legacyDocuments: number;
  readonly index: VaultSnapshot["index"] | null;
  readonly head: string | null;
};

export type PortfolioAuthorityAuditState = {
  readonly id: string;
  readonly state: PortfolioAuthorityGroup["state"];
  readonly protected: boolean;
};

export type PortfolioAuditReport = {
  readonly partial: boolean;
  readonly truncated: boolean;
  readonly selectedVaults: number;
  readonly auditedVaults: number;
  readonly unavailableVaults: number;
  readonly notes: number;
  readonly stableDocuments: number;
  readonly legacyDocuments: number;
  readonly counts: Readonly<Record<PortfolioAuditSeverity, number>>;
  readonly vaults: readonly PortfolioVaultAuditSummary[];
  readonly authority: readonly PortfolioAuthorityAuditState[];
  readonly issues: readonly PortfolioAuditIssue[];
};

export type AuditKnowledgePortfolioOptions = {
  readonly registryPath: string;
  /** Same immutable snapshot used to derive authorizedVaults, when applicable. */
  readonly registry?: PortfolioRegistryV1;
  readonly workspaceRoot: string;
  readonly authorizedVaults: readonly VaultKey[];
  readonly maxIssues?: number;
  readonly maxAttachmentReferences?: number;
  readonly scan?: Omit<ScanVaultOptions, "catalogMode" | "mentionScope">;
};

export type PortfolioAuditDependencies = PortfolioRegistryFileDependencies & PortfolioPathDependencies & {
  readonly loadPortfolioRegistry?: typeof loadPortfolioRegistry;
  readonly resolvePortfolioVault?: typeof resolvePortfolioVault;
  readonly scanVault?: typeof scanVault;
  readonly validateMarkdownAttachments?: typeof validateMarkdownAttachments;
  readonly indexGitHistory?: typeof indexGitHistory;
  readonly git?: GitHistoryDependencies;
  readonly sha256?: (content: string) => string;
};

type DuplicateCandidate = PortfolioAuditReference & {
  readonly hash: string;
};

type ExternalRelationCandidate = {
  readonly vault: PortfolioAuditVault;
  readonly path: string;
  readonly line: number;
  readonly predicate: string;
  readonly target: string;
};

function checkedLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const checked = value ?? fallback;
  if (!Number.isSafeInteger(checked) || checked < 1 || checked > maximum) {
    throw new RangeError(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return checked;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function descriptor(entry: PortfolioVaultEntry): PortfolioAuditVault {
  return Object.freeze({
    owner: entry.owner,
    id: entry.id,
    key: entry.key,
    role: entry.role,
    visibility: entry.visibility,
  });
}

function defaultSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function attachmentMessage(issue: AttachmentIssue): string {
  return `${issue.kind}: ${issue.message}`;
}

function activeRole(role: PortfolioVaultEntry["role"]): boolean {
  return role === "portfolio" || role === "repository";
}

function protectedDuplicate(
  references: readonly PortfolioAuditReference[],
  groups: readonly PortfolioAuthorityGroup[],
): boolean {
  const keys = new Set(references.map(({ vault }) => vault.key));
  return groups.some((group) =>
    group.protected === true
    && keys.size > 1
    && [...keys].every((key) => group.members.includes(key)));
}

/** Audit selected authored vaults without repairing, deduplicating, or choosing an authority. */
export async function auditKnowledgePortfolio(
  options: AuditKnowledgePortfolioOptions,
  dependencies: PortfolioAuditDependencies = {},
): Promise<PortfolioAuditReport> {
  const maximumIssues = checkedLimit(
    options.maxIssues,
    DEFAULT_PORTFOLIO_AUDIT_ISSUES,
    MAX_PORTFOLIO_AUDIT_ISSUES,
    "Portfolio audit issue limit",
  );
  const maximumAttachments = checkedLimit(
    options.maxAttachmentReferences,
    MAX_ATTACHMENT_REFERENCES,
    MAX_ATTACHMENT_REFERENCES,
    "Portfolio attachment reference limit",
  );
  const registry = snapshotPortfolioRegistry(options.registry ?? await (
    dependencies.loadPortfolioRegistry ?? loadPortfolioRegistry
  )(options.registryPath, dependencies));
  const selected = selectAuthorizedVaults(registry, options.authorizedVaults);
  const selectedKeys = new Set(selected.map(({ key }) => key));
  const selectedAuthority = registry.authorityGroups.filter(({ members }) =>
    members.every((member) => selectedKeys.has(member)));
  const issues: PortfolioAuditIssue[] = [];
  const counts: Record<PortfolioAuditSeverity, number> = {
    advisory: 0,
    error: 0,
    warning: 0,
  };
  const severityRank: Readonly<Record<PortfolioAuditSeverity, number>> = {
    advisory: 0,
    warning: 1,
    error: 2,
  };
  let truncated = false;
  const addIssue = (issue: PortfolioAuditIssue): void => {
    counts[issue.severity] += 1;
    if (issues.length >= maximumIssues) {
      truncated = true;
      let weakestIndex = 0;
      for (let index = 1; index < issues.length; index += 1) {
        const candidate = issues[index];
        const weakest = issues[weakestIndex];
        if (
          candidate !== undefined
          && weakest !== undefined
          && severityRank[candidate.severity] < severityRank[weakest.severity]
        ) {
          weakestIndex = index;
        }
      }
      const weakest = issues[weakestIndex];
      if (weakest !== undefined && severityRank[issue.severity] > severityRank[weakest.severity]) {
        issues[weakestIndex] = Object.freeze({
          ...issue,
          ...(issue.related === undefined ? {} : { related: Object.freeze([...issue.related]) }),
        });
      }
      return;
    }
    issues.push(Object.freeze({
      ...issue,
      ...(issue.related === undefined ? {} : { related: Object.freeze([...issue.related]) }),
    }));
  };

  for (const group of selectedAuthority) {
    if (group.state !== "unresolved") continue;
    addIssue({
      code: "authority-unresolved",
      severity: "warning",
      message: `Authority group ${JSON.stringify(group.id)} remains unresolved across explicitly selected members.`,
      ...(group.protected === undefined ? {} : { protected: group.protected }),
    });
  }

  const resolved: ResolvedPortfolioVault[] = [];
  const summaries: PortfolioVaultAuditSummary[] = [];
  for (const entry of selected) {
    try {
      resolved.push(await (dependencies.resolvePortfolioVault ?? resolvePortfolioVault)(
        entry,
        options.workspaceRoot,
        dependencies,
      ));
    } catch (error) {
      const vault = descriptor(entry);
      addIssue({
        code: "vault-unavailable",
        severity: "error",
        vault,
        message: errorMessage(error),
      });
      summaries.push(Object.freeze({
        vault,
        status: "unavailable",
        notes: 0,
        stableDocuments: 0,
        legacyDocuments: 0,
        index: null,
        head: null,
      }));
    }
  }
  let auditable: readonly ResolvedPortfolioVault[] = resolved;
  try {
    auditable = validateResolvedPortfolioVaults(resolved);
  } catch (error) {
    addIssue({
      code: "root-overlap",
      severity: "error",
      message: errorMessage(error),
    });
    for (const resolvedVault of resolved) {
      summaries.push(Object.freeze({
        vault: descriptor(resolvedVault.entry),
        status: "unavailable",
        notes: 0,
        stableDocuments: 0,
        legacyDocuments: 0,
        index: null,
        head: null,
      }));
    }
    auditable = [];
  }

  const duplicateCandidates: DuplicateCandidate[] = [];
  const availableStableUris = new Set<string>();
  const externalRelationCandidates: ExternalRelationCandidate[] = [];
  for (const resolvedVault of auditable) {
    const vault = descriptor(resolvedVault.entry);
    let snapshot: VaultSnapshot;
    try {
      snapshot = await (dependencies.scanVault ?? scanVault)(resolvedVault.root, {
        ...(options.scan ?? {}),
        mentionScope: false,
      });
    } catch (error) {
      addIssue({
        code: "scan-unavailable",
        severity: "error",
        vault,
        message: errorMessage(error),
      });
      summaries.push(Object.freeze({
        vault,
        status: "unavailable",
        notes: 0,
        stableDocuments: 0,
        legacyDocuments: 0,
        index: null,
        head: null,
      }));
      continue;
    }
    if (snapshot.index === "stale") {
      addIssue({
        code: "catalog-stale",
        severity: "warning",
        vault,
        message: "The managed vault catalog is stale.",
      });
    }

    let stableDocuments = 0;
    let legacyDocuments = 0;
    const pathsByDocumentId = new Map<string, string[]>();
    const hash = dependencies.sha256 ?? defaultSha256;
    for (const note of snapshot.notes) {
      const state = documentIdState(note.metadata);
      const identity = portfolioDocumentIdentity(vault, note.path, note.metadata);
      if (state.kind === "valid") {
        stableDocuments += 1;
        if (identity.kind === "stable") availableStableUris.add(identity.uri);
        const paths = pathsByDocumentId.get(state.documentId) ?? [];
        paths.push(note.path);
        pathsByDocumentId.set(state.documentId, paths);
      } else {
        legacyDocuments += 1;
        addIssue(state.kind === "missing"
          ? {
              code: "missing-document-id",
              severity: activeRole(resolvedVault.entry.role) ? "warning" : "advisory",
              vault,
              path: note.path,
              message: "Authored note has no stable document_id and is available only by legacy path.",
            }
          : {
              code: "invalid-document-id",
              severity: "error",
              vault,
              path: note.path,
              message: "Authored note has an invalid document_id and is available only by legacy path.",
            });
      }
      duplicateCandidates.push(Object.freeze({
        vault,
        path: note.path,
        identity,
        hash: hash(note.content),
      }));
    }
    for (const [documentId, paths] of pathsByDocumentId) {
      if (paths.length < 2) continue;
      addIssue({
        code: "duplicate-document-id",
        severity: "error",
        vault,
        message: `document_id ${JSON.stringify(documentId)} is authored by multiple notes in this vault.`,
        related: paths.toSorted().map((path) => ({
          vault,
          path,
          identity: portfolioDocumentIdentity(
            vault,
            path,
            { document_id: documentId },
          ),
        })),
      });
    }
    for (const issue of snapshot.analysis.issues) {
      addIssue({
        code: issue.kind === "broken" ? "broken-link" : "ambiguous-link",
        severity: issue.kind === "broken" ? "error" : "warning",
        vault,
        path: issue.source,
        line: issue.line,
        message: issue.kind === "broken"
          ? `Broken link target ${JSON.stringify(issue.target)}.`
          : `Ambiguous link target ${JSON.stringify(issue.target)}.`,
      });
    }
    for (const issue of snapshot.analysis.relationIssues) {
      addIssue({
        code: "relation",
        severity: "error",
        vault,
        path: issue.source,
        line: issue.line,
        message: issue.kind === "malformed"
          ? issue.message
          : `${issue.kind} relation target ${JSON.stringify(issue.target)} for ${JSON.stringify(issue.predicate)}.`,
      });
    }
    for (const relation of snapshot.analysis.externalAuthoredRelations) {
      externalRelationCandidates.push(Object.freeze({
        vault,
        path: relation.provenance.source,
        line: relation.provenance.line,
        predicate: relation.predicate,
        target: relation.target,
      }));
    }
    try {
      const attachmentReport = await (
        dependencies.validateMarkdownAttachments ?? validateMarkdownAttachments
      )({
        root: snapshot.root,
        documents: snapshot.notes.map(({ path, content }) => ({ path, content })),
        maxReferences: maximumAttachments,
      });
      for (const issue of attachmentReport.issues) {
        addIssue({
          code: "attachment",
          severity: "error",
          vault,
          path: issue.source,
          line: issue.line,
          message: attachmentMessage(issue),
        });
      }
      if (attachmentReport.truncated) truncated = true;
    } catch (error) {
      addIssue({
        code: "attachment",
        severity: "error",
        vault,
        message: `Attachment audit failed: ${errorMessage(error)}`,
      });
    }

    let head: string | null = null;
    try {
      const indexed = await (dependencies.indexGitHistory ?? indexGitHistory)(
        {
          repository: resolvedVault.repositoryRoot,
          root: resolvedVault.root,
          notes: [],
          maxCommits: 1,
        },
        dependencies.git,
      );
      if (indexed.status === "ready") head = indexed.head;
      else {
        addIssue({
          code: "git-unavailable",
          severity: "warning",
          vault,
          message: indexed.reason,
        });
      }
    } catch (error) {
      addIssue({
        code: "git-unavailable",
        severity: "warning",
        vault,
        message: errorMessage(error),
      });
    }
    summaries.push(Object.freeze({
      vault,
      status: "audited",
      notes: snapshot.notes.length,
      stableDocuments,
      legacyDocuments,
      index: snapshot.index,
      head,
    }));
  }

  for (const relation of externalRelationCandidates) {
    if (availableStableUris.has(relation.target)) continue;
    addIssue({
      code: "external-relation-unavailable",
      severity: "error",
      vault: relation.vault,
      path: relation.path,
      line: relation.line,
      message: `Cross-vault relation target ${JSON.stringify(relation.target)} for ${JSON.stringify(relation.predicate)} is not available among the explicitly selected, successfully audited vaults.`,
    });
  }

  const candidatesByHash = new Map<string, PortfolioAuditReference[]>();
  for (const candidate of duplicateCandidates) {
    const group = candidatesByHash.get(candidate.hash) ?? [];
    group.push({ vault: candidate.vault, path: candidate.path, identity: candidate.identity });
    candidatesByHash.set(candidate.hash, group);
  }
  for (const [hash, references] of candidatesByHash) {
    if (references.length < 2) continue;
    const related = references.toSorted((left, right) =>
      left.vault.key.localeCompare(right.vault.key) || left.path.localeCompare(right.path));
    const isProtected = protectedDuplicate(related, selectedAuthority);
    addIssue({
      code: "duplicate-content",
      severity: related.some(({ vault }) => activeRole(vault.role)) ? "warning" : "advisory",
      message: `Exact authored content SHA-256 ${hash} occurs in multiple selected notes; no authority was inferred.`,
      ...(isProtected ? { protected: true } : {}),
      related,
    });
  }

  const orderedSummaries = summaries.toSorted((left, right) =>
    left.vault.key.localeCompare(right.vault.key));
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
      protected: group.protected ?? false,
    }))),
    issues: Object.freeze(issues),
  });
}
