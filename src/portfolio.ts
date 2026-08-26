import { createHash } from "node:crypto";

import {
  indexGitHistory,
  type GitHistoryDependencies,
} from "./git.js";
import type { QueryRow } from "./query.js";
import { validateQueryOptions } from "./query.js";
import {
  DEFAULT_SEARCH_RESULTS,
  MAX_SEARCH_CANDIDATES,
  MAX_SEARCH_RESULTS,
  openKnowledgeBase,
  validateKnowledgeBaseSearchHistory,
  type KnowledgeBaseDependencies,
  type KnowledgeBaseGraphOptions,
  type KnowledgeBaseHistoryOptions,
  type KnowledgeBaseReadResult,
  type KnowledgeBaseSearchDiagnostic,
  type KnowledgeBaseSearchEvidence,
  type KnowledgeBaseSearchHit,
  type KnowledgeBaseSearchMode,
  type KnowledgeBaseSearchOptions,
  type KnowledgeBaseSearchRuleApplication,
  type KnowledgeBaseSession,
  type OpenKnowledgeBaseOptions,
} from "./sdk.js";
import { validateSearchQuery } from "./search.js";
import {
  expandSearchRequest,
  parseSearchRules,
} from "./search-rules.js";
import {
  parseQualifiedDocumentUri,
  portfolioDocumentIdentity,
  type PortfolioDocumentIdentity,
  type QualifiedDocumentUri,
  type StablePortfolioDocumentIdentity,
  type VaultKey,
} from "./portfolio-identity.js";
import {
  loadPortfolioRegistry,
  snapshotPortfolioRegistry,
  resolvePortfolioVault,
  selectAuthorizedVaults,
  validateResolvedPortfolioVaults,
  type PortfolioPathDependencies,
  type PortfolioRegistryFileDependencies,
  type PortfolioRegistryV1,
  type PortfolioVaultEntry,
  type ResolvedPortfolioVault,
} from "./portfolio-registry.js";

export const MAX_PORTFOLIO_SEARCH_CONCURRENCY = 8;
export const MAX_PORTFOLIO_REVISION_BYTES = 64 * 1_024;

export type PortfolioFailurePolicy = "partial" | "required";

export type PortfolioKnowledgeBaseOptions = Omit<
  OpenKnowledgeBaseOptions,
  "database" | "repository" | "root"
>;

export type OpenKnowledgePortfolioOptions = {
  readonly registryPath: string;
  /**
   * An already loaded registry snapshot. Callers that derive authorization from
   * registry contents must pass that same snapshot to prevent a reload race.
   */
  readonly registry?: PortfolioRegistryV1;
  readonly workspaceRoot: string;
  /** Registry discovery never grants access; every usable vault must be named here. */
  readonly authorizedVaults: readonly VaultKey[];
  readonly failurePolicy?: PortfolioFailurePolicy;
  readonly searchConcurrency?: number;
  readonly knowledgeBase?: PortfolioKnowledgeBaseOptions;
};

export type PortfolioDependencies = PortfolioRegistryFileDependencies & PortfolioPathDependencies & {
  readonly loadPortfolioRegistry?: typeof loadPortfolioRegistry;
  readonly resolvePortfolioVault?: typeof resolvePortfolioVault;
  readonly openKnowledgeBase?: typeof openKnowledgeBase;
  readonly knowledgeBase?: KnowledgeBaseDependencies;
  readonly indexGitHistory?: typeof indexGitHistory;
  readonly git?: GitHistoryDependencies;
  readonly sha256?: (content: string) => string;
};

export type PortfolioVaultDescriptor = {
  readonly owner: string;
  readonly id: string;
  readonly key: VaultKey;
  readonly role: PortfolioVaultEntry["role"];
  readonly visibility: PortfolioVaultEntry["visibility"];
};

export type PortfolioRepositoryProvenance = {
  readonly id: VaultKey;
  readonly defaultRef?: string;
  readonly head: string | null;
};

export type PortfolioContentRevision =
  | { readonly complete: true; readonly sha256: string }
  | { readonly complete: false; readonly sha256: null };

export type PortfolioOpenDiagnostic = {
  readonly vault: PortfolioVaultDescriptor;
  readonly lane: "git" | "open" | "resolve";
  readonly status: "unavailable";
  readonly message: string;
};

export type PortfolioSearchOptions = Omit<
  KnowledgeBaseSearchOptions,
  "candidateLimit" | "graph" | "limit"
> & {
  readonly limit?: number;
  readonly candidateLimit?: number;
  /** Graph seeds are vault-local; unqualified cross-vault graph requests are rejected. */
  readonly graph?: false;
};

export type PortfolioSearchHit = {
  readonly identity: PortfolioDocumentIdentity;
  readonly vault: PortfolioVaultDescriptor;
  readonly repository: PortfolioRepositoryProvenance;
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly rank: number;
  /** Reciprocal local-rank score used only for deterministic federation. */
  readonly score: number;
  readonly exactIdentity: boolean;
  readonly localRank: number;
  readonly revision: PortfolioContentRevision;
  readonly snippet: string;
  readonly line?: number;
  readonly tags: readonly string[];
  readonly metadata: KnowledgeBaseSearchHit["metadata"];
  readonly evidence: readonly KnowledgeBaseSearchEvidence[];
  readonly local: KnowledgeBaseSearchHit;
};

export type PortfolioVaultSearchDiagnostic = {
  readonly vault: PortfolioVaultDescriptor;
  readonly status: "partial" | "ready" | "unavailable";
  readonly results: number;
  readonly message?: string;
  readonly lanes?: readonly KnowledgeBaseSearchDiagnostic[];
  readonly rules?: KnowledgeBaseSearchRuleApplication;
};

export type PortfolioSearchResult = {
  readonly query: string;
  readonly mode: KnowledgeBaseSearchMode;
  readonly results: readonly PortfolioSearchHit[];
  readonly partial: boolean;
  readonly diagnostics: {
    readonly selectedVaults: number;
    readonly availableVaults: number;
    readonly notes: number;
    readonly open: readonly PortfolioOpenDiagnostic[];
    readonly vaults: readonly PortfolioVaultSearchDiagnostic[];
  };
};

export type PortfolioReadResult = KnowledgeBaseReadResult & {
  readonly identity: StablePortfolioDocumentIdentity;
  readonly vault: PortfolioVaultDescriptor;
  readonly repository: PortfolioRepositoryProvenance;
  readonly revision: PortfolioContentRevision;
};

export type KnowledgePortfolioSession = {
  readonly selectedVaultCount: number;
  readonly availableVaultCount: number;
  readonly noteCount: number;
  readonly openDiagnostics: readonly PortfolioOpenDiagnostic[];
  readonly search: (options: PortfolioSearchOptions) => Promise<PortfolioSearchResult>;
  readonly read: (
    uri: QualifiedDocumentUri | string,
    options?: { readonly maxBytes?: number },
  ) => PortfolioReadResult;
  readonly close: () => Promise<void>;
};

export class PortfolioOpenError extends Error {
  readonly diagnostics: readonly PortfolioOpenDiagnostic[];

  constructor(message: string, diagnostics: readonly PortfolioOpenDiagnostic[], options?: ErrorOptions) {
    super(message, options);
    this.name = "PortfolioOpenError";
    this.diagnostics = Object.freeze([...diagnostics]);
  }
}

export class PortfolioSearchError extends Error {
  readonly vault: PortfolioVaultDescriptor;

  constructor(vault: PortfolioVaultDescriptor, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PortfolioSearchError";
    this.vault = vault;
  }
}

type RepositoryProbe = {
  readonly provenance: PortfolioRepositoryProvenance;
  readonly diagnostic?: PortfolioOpenDiagnostic;
};

type OpenedVault = {
  readonly resolved: ResolvedPortfolioVault;
  readonly descriptor: PortfolioVaultDescriptor;
  readonly repository: PortfolioRepositoryProvenance;
  readonly session: KnowledgeBaseSession;
  readonly rowsById: ReadonlyMap<string, QueryRow>;
  readonly idsByDocumentId: ReadonlyMap<string, readonly string[]>;
};

type LocalSearchSuccess = {
  readonly kind: "success";
  readonly opened: OpenedVault;
  readonly result: Awaited<ReturnType<KnowledgeBaseSession["search"]>>;
};

type LocalSearchFailure = {
  readonly kind: "failure";
  readonly opened: OpenedVault;
  readonly error: unknown;
};

type LocalSearchOutcome = LocalSearchFailure | LocalSearchSuccess;

function checkedInteger(
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

function descriptor(entry: PortfolioVaultEntry): PortfolioVaultDescriptor {
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

function contentRevision(
  session: KnowledgeBaseSession,
  noteId: string,
  sha256: (content: string) => string,
): PortfolioContentRevision {
  try {
    const read = session.read(noteId, { maxBytes: MAX_PORTFOLIO_REVISION_BYTES });
    return read.truncated
      ? Object.freeze({ complete: false, sha256: null })
      : Object.freeze({ complete: true, sha256: sha256(read.content) });
  } catch {
    return Object.freeze({ complete: false, sha256: null });
  }
}

function indexedRows(session: KnowledgeBaseSession): {
  readonly rowsById: ReadonlyMap<string, QueryRow>;
  readonly idsByDocumentId: ReadonlyMap<string, readonly string[]>;
} {
  const rows = session.list();
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const mutableIds = new Map<string, string[]>();
  for (const row of rows) {
    const identity = portfolioDocumentIdentity({ owner: "index", id: "index" }, row.path, row.metadata);
    if (identity.kind !== "stable") continue;
    const ids = mutableIds.get(identity.documentId) ?? [];
    ids.push(row.id);
    mutableIds.set(identity.documentId, ids);
  }
  return {
    rowsById,
    idsByDocumentId: new Map([...mutableIds].map(([documentId, ids]) => [
      documentId,
      Object.freeze(ids.toSorted()),
    ])),
  };
}

async function repositoryProbe(
  resolved: ResolvedPortfolioVault,
  dependencies: PortfolioDependencies,
): Promise<RepositoryProbe> {
  const vault = descriptor(resolved.entry);
  const unavailable = (message: string): RepositoryProbe => ({
    provenance: Object.freeze({
      id: resolved.entry.repository,
      ...(resolved.entry.defaultRef === undefined ? {} : { defaultRef: resolved.entry.defaultRef }),
      head: null,
    }),
    diagnostic: Object.freeze({ vault, lane: "git", status: "unavailable", message }),
  });
  try {
    const indexed = await (dependencies.indexGitHistory ?? indexGitHistory)(
      {
        repository: resolved.repositoryRoot,
        root: resolved.root,
        notes: [],
        maxCommits: 1,
      },
      dependencies.git,
    );
    if (indexed.status === "unavailable") return unavailable(indexed.reason);
    return {
      provenance: Object.freeze({
        id: resolved.entry.repository,
        ...(resolved.entry.defaultRef === undefined ? {} : { defaultRef: resolved.entry.defaultRef }),
        head: indexed.head,
      }),
    };
  } catch (error) {
    return unavailable(errorMessage(error));
  }
}

async function closeOpened(vaults: readonly OpenedVault[]): Promise<void> {
  await Promise.all(vaults.map(({ session }) => session.close().catch(() => undefined)));
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      const value = values[index];
      if (value !== undefined) results[index] = await operation(value);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  return results;
}

function maybeQualifiedIdentity(query: string): StablePortfolioDocumentIdentity | null {
  try {
    return parseQualifiedDocumentUri(query);
  } catch {
    return null;
  }
}

function identitySortKey(identity: PortfolioDocumentIdentity): string {
  return identity.kind === "stable" ? identity.uri : identity.path;
}

/** Open selected local vault sessions. No unselected registry entry is resolved, scanned, or reported. */
export async function openKnowledgePortfolio(
  options: OpenKnowledgePortfolioOptions,
  dependencies: PortfolioDependencies = {},
): Promise<KnowledgePortfolioSession> {
  const failurePolicy = options.failurePolicy ?? "partial";
  if (failurePolicy !== "partial" && failurePolicy !== "required") {
    throw new TypeError('Portfolio failurePolicy must be "partial" or "required".');
  }
  const searchConcurrency = checkedInteger(
    options.searchConcurrency,
    4,
    MAX_PORTFOLIO_SEARCH_CONCURRENCY,
    "Portfolio search concurrency",
  );
  const configuredSearchRules = options.knowledgeBase?.searchRules === undefined
    ? null
    : parseSearchRules(options.knowledgeBase.searchRules);
  const registry = snapshotPortfolioRegistry(options.registry ?? await (
    dependencies.loadPortfolioRegistry ?? loadPortfolioRegistry
  )(options.registryPath, dependencies));
  const selected = selectAuthorizedVaults(registry, options.authorizedVaults);
  const diagnostics: PortfolioOpenDiagnostic[] = [];
  const resolved: ResolvedPortfolioVault[] = [];
  for (const entry of selected) {
    try {
      resolved.push(await (dependencies.resolvePortfolioVault ?? resolvePortfolioVault)(
        entry,
        options.workspaceRoot,
        dependencies,
      ));
    } catch (error) {
      diagnostics.push(Object.freeze({
        vault: descriptor(entry),
        lane: "resolve",
        status: "unavailable",
        message: errorMessage(error),
      }));
      if (failurePolicy === "required") {
        throw new PortfolioOpenError("A required portfolio vault could not be resolved.", diagnostics, {
          cause: error,
        });
      }
    }
  }
  validateResolvedPortfolioVaults(resolved);

  const opened: OpenedVault[] = [];
  for (const vault of resolved) {
    const vaultDescriptor = descriptor(vault.entry);
    const probe = await repositoryProbe(vault, dependencies);
    if (probe.diagnostic !== undefined) diagnostics.push(probe.diagnostic);
    let session: KnowledgeBaseSession | undefined;
    try {
      const knowledgeBase = options.knowledgeBase ?? {};
      session = await (dependencies.openKnowledgeBase ?? openKnowledgeBase)(
        {
          ...knowledgeBase,
          ...(configuredSearchRules === null ? {} : { searchRules: configuredSearchRules }),
          vaultId: vaultDescriptor.key,
          root: vault.root,
          repository: vault.repositoryRoot,
          scan: {
            ...(knowledgeBase.scan ?? {}),
            catalogMode: "authored",
          },
        },
        dependencies.knowledgeBase,
      );
      const indexed = indexedRows(session);
      opened.push({
        resolved: vault,
        descriptor: vaultDescriptor,
        repository: probe.provenance,
        session,
        ...indexed,
      });
    } catch (error) {
      await session?.close().catch(() => undefined);
      diagnostics.push(Object.freeze({
        vault: vaultDescriptor,
        lane: "open",
        status: "unavailable",
        message: errorMessage(error),
      }));
      if (failurePolicy === "required") {
        await closeOpened(opened);
        throw new PortfolioOpenError("A required portfolio vault could not be opened.", diagnostics, {
          cause: error,
        });
      }
    }
  }

  const openedByKey = new Map(opened.map((vault) => [vault.descriptor.key, vault]));
  const hash = dependencies.sha256 ?? defaultSha256;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  const assertOpen = (): void => {
    if (closed) throw new Error("Knowledge-portfolio session is closed.");
  };

  const search = async (searchOptions: PortfolioSearchOptions): Promise<PortfolioSearchResult> => {
    assertOpen();
    const { query } = validateSearchQuery(searchOptions.query);
    if (searchOptions.graph !== undefined && searchOptions.graph !== false) {
      throw new TypeError("Portfolio graph requests must be false; graph seeds require a qualified vault route.");
    }
    const limit = checkedInteger(
      searchOptions.limit,
      DEFAULT_SEARCH_RESULTS,
      MAX_SEARCH_RESULTS,
      "Portfolio search limit",
    );
    const candidateLimit = checkedInteger(
      searchOptions.candidateLimit,
      Math.max(40, limit * 4),
      MAX_SEARCH_CANDIDATES,
      "Portfolio candidate limit",
    );
    if (candidateLimit < limit) {
      throw new RangeError("Portfolio candidate limit must be at least the result limit.");
    }
    const validationRequest: PortfolioSearchOptions = configuredSearchRules === null
      ? searchOptions
      : {
          ...searchOptions,
          ...expandSearchRequest({
            query: searchOptions.query,
            ...(searchOptions.mode === undefined ? {} : { mode: searchOptions.mode }),
            ...(searchOptions.filters === undefined ? {} : { filters: searchOptions.filters }),
            ...(searchOptions.tags === undefined ? {} : { tags: searchOptions.tags }),
            ...(searchOptions.repositoryScopes === undefined
              ? {}
              : { repositoryScopes: searchOptions.repositoryScopes }),
          }, configuredSearchRules).request,
        };
    validateSearchQuery(validationRequest.query);
    validateQueryOptions({
      ...(validationRequest.filters === undefined ? {} : { filters: validationRequest.filters }),
      ...(validationRequest.tags === undefined ? {} : { tags: validationRequest.tags }),
      ...(validationRequest.repositoryScopes === undefined
        ? {}
        : { repositoryScopes: validationRequest.repositoryScopes }),
    });
    const validatedMode = validationRequest.mode ?? "hybrid";
    if (
      validatedMode !== "exact"
      && validatedMode !== "hybrid"
      && validatedMode !== "keyword"
      && validatedMode !== "semantic"
    ) {
      throw new TypeError("Portfolio search mode must be exact, hybrid, keyword, or semantic.");
    }
    const validatedOrdering = validationRequest.ordering ?? "relevance";
    if (validatedOrdering !== "relevance" && validatedOrdering !== "priority-then-relevance") {
      throw new TypeError('Portfolio search ordering must be "relevance" or "priority-then-relevance".');
    }
    if (
      validationRequest.minScore !== undefined
      && (
        !Number.isFinite(validationRequest.minScore)
        || validationRequest.minScore < 0
        || validationRequest.minScore > 1
      )
    ) {
      throw new RangeError("Portfolio search minimum score must be a number from 0 through 1.");
    }
    if (validatedMode === "exact" && validationRequest.minScore !== undefined) {
      throw new Error("Portfolio search minimum score applies only to hybrid, keyword, or semantic mode.");
    }
    validateKnowledgeBaseSearchHistory(validationRequest.history);
    const routed = maybeQualifiedIdentity(query);
    const searchedVaults = routed === null
      ? opened
      : opened.filter(({ descriptor: selectedVault }) => selectedVault.key === routed.vault.key);
    const routedLocalIds = routed === null || searchedVaults[0] === undefined
      ? undefined
      : searchedVaults[0].idsByDocumentId.get(routed.documentId);
    if (routedLocalIds !== undefined && routedLocalIds.length > 1) {
      throw new Error("Qualified document identity is ambiguous in its selected vault.");
    }
    const localOptions: Omit<KnowledgeBaseSearchOptions, "query"> = {
      ...(searchOptions.mode === undefined ? {} : { mode: searchOptions.mode }),
      ...(searchOptions.ordering === undefined ? {} : { ordering: searchOptions.ordering }),
      ...(searchOptions.filters === undefined ? {} : { filters: searchOptions.filters }),
      ...(searchOptions.tags === undefined ? {} : { tags: searchOptions.tags }),
      ...(searchOptions.repositoryScopes === undefined
        ? {}
        : { repositoryScopes: searchOptions.repositoryScopes }),
      limit,
      candidateLimit,
      ...(searchOptions.minScore === undefined ? {} : { minScore: searchOptions.minScore }),
      graph: false,
      ...(searchOptions.history === undefined ? {} : { history: searchOptions.history }),
    };
    const outcomes = await mapConcurrent(searchedVaults, searchConcurrency, async (vault): Promise<LocalSearchOutcome> => {
      try {
        const routedLocalId = routed === null ? undefined : routedLocalIds?.[0];
        const result = await vault.session.search({
          ...localOptions,
          query: routedLocalId ?? routed?.documentId ?? query,
          ...(routed === null
            ? {}
            : {
                mode: "exact",
                filters: Object.freeze([
                  ...(localOptions.filters ?? []),
                  { kind: "equals" as const, path: "document_id", value: routed.documentId },
                ]),
              }),
        });
        return { kind: "success", opened: vault, result };
      } catch (error) {
        return { kind: "failure", opened: vault, error };
      }
    });
    const vaultDiagnostics: PortfolioVaultSearchDiagnostic[] = diagnostics
      .filter(({ lane }) => lane !== "git")
      .map((diagnostic) => Object.freeze({
        vault: diagnostic.vault,
        status: "unavailable" as const,
        results: 0,
        message: diagnostic.message,
      }));
    const candidates: Array<{
      readonly opened: OpenedVault;
      readonly hit: KnowledgeBaseSearchHit;
      readonly identity: PortfolioDocumentIdentity;
      readonly exactIdentity: boolean;
      readonly localRank: number;
      readonly score: number;
    }> = [];
    for (const outcome of outcomes) {
      if (outcome.kind === "failure") {
        if (failurePolicy === "required") {
          throw new PortfolioSearchError(
            outcome.opened.descriptor,
            "A required portfolio vault search failed.",
            { cause: outcome.error },
          );
        }
        vaultDiagnostics.push(Object.freeze({
          vault: outcome.opened.descriptor,
          status: "unavailable",
          results: 0,
          message: errorMessage(outcome.error),
        }));
        continue;
      }
      vaultDiagnostics.push(Object.freeze({
        vault: outcome.opened.descriptor,
        status: outcome.result.partial ? "partial" : "ready",
        results: outcome.result.results.length,
        lanes: outcome.result.diagnostics.lanes,
        ...(outcome.result.rules === undefined ? {} : { rules: outcome.result.rules }),
      }));
      for (const hit of outcome.result.results) {
        const identity = portfolioDocumentIdentity(
          outcome.opened.descriptor,
          hit.path,
          hit.metadata,
        );
        if (
          routed !== null
          && (identity.kind !== "stable" || identity.documentId !== routed.documentId)
        ) {
          continue;
        }
        const localRank = hit.rank;
        candidates.push({
          opened: outcome.opened,
          hit,
          identity,
          exactIdentity: routed !== null || hit.identity,
          localRank,
          score: 1 / (60 + localRank),
        });
      }
    }
    const ordered = candidates.toSorted((left, right) =>
      Number(right.exactIdentity) - Number(left.exactIdentity)
      || right.score - left.score
      || left.opened.descriptor.key.localeCompare(right.opened.descriptor.key)
      || identitySortKey(left.identity).localeCompare(identitySortKey(right.identity))
      || left.hit.path.localeCompare(right.hit.path));
    const results = ordered.slice(0, limit).map((candidate, index): PortfolioSearchHit => Object.freeze({
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
      ...(candidate.hit.line === undefined ? {} : { line: candidate.hit.line }),
      tags: candidate.hit.tags,
      metadata: candidate.hit.metadata,
      evidence: candidate.hit.evidence,
      local: candidate.hit,
    }));
    const partial = diagnostics.length > 0
      || vaultDiagnostics.some(({ status }) => status !== "ready");
    const successfulModes = new Set(outcomes.flatMap((outcome) =>
      outcome.kind === "success" ? [outcome.result.mode] : []));
    if (successfulModes.size > 1) {
      throw new Error("Selected vaults produced inconsistent effective search modes.");
    }
    const effectiveMode = routed === null
      ? successfulModes.values().next().value ?? validatedMode
      : "exact";
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
        vaults: Object.freeze(vaultDiagnostics),
      }),
    });
  };

  const read = (
    value: QualifiedDocumentUri | string,
    readOptions: { readonly maxBytes?: number } = {},
  ): PortfolioReadResult => {
    assertOpen();
    const identity = parseQualifiedDocumentUri(value);
    const vault = openedByKey.get(identity.vault.key);
    if (vault === undefined) throw new Error("Qualified document is not available in this portfolio session.");
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
      revision: result.truncated
        ? Object.freeze({ complete: false, sha256: null })
        : Object.freeze({ complete: true, sha256: hash(result.content) }),
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
      if (closePromise !== undefined) return closePromise;
      closed = true;
      closePromise = Promise.allSettled(opened.map(({ session }) => session.close())).then((settled) => {
        const errors = settled
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map(({ reason }) => reason as unknown);
        if (errors.length > 0) throw new AggregateError(errors, "One or more portfolio vault sessions failed to close.");
      });
      return closePromise;
    },
  });
}

export type { KnowledgeBaseGraphOptions, KnowledgeBaseHistoryOptions };
export * from "./portfolio-audit.js";
export * from "./portfolio-identity.js";
export * from "./portfolio-registry.js";
