import type {
  MetadataObject,
  MetadataScalar,
  MetadataValue,
} from "./graph.js";
import {
  metadataAtPath,
  validateQueryOptions,
  type MetadataFilter,
  type MetadataPath,
} from "./query.js";
import {
  analyzeAuthoredRepositoryScopes,
  validateRepositoryScopeSelection,
} from "./repository-memory.js";

export const SEARCH_RULES_SCHEMA_VERSION = 1;
export const MAX_SEARCH_RULE_ALIASES = 64;
export const MAX_SEARCH_PRIORITY_RULES = 128;
export const MAX_SEARCH_RULE_FILTERS = 64;
export const MAX_SEARCH_RULE_TAGS = 64;
export const MAX_SEARCH_RULE_SCOPES = 64;
export const MAX_SEARCH_RULE_TEXT_BYTES = 16 * 1_024;
export const MAX_SEARCH_RULE_CONFIG_BYTES = 128 * 1_024;
export const MAX_SEARCH_RULE_TIER = 32;

const MAX_SEARCH_RULE_NODES = 2_048;
const MAX_METADATA_PATH_SEGMENTS = 32;
const aliasNamePattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const ruleIdPattern = aliasNamePattern;
const vaultIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)?$/u;

export type SearchRuleMode = "exact" | "hybrid" | "keyword" | "semantic";

export type SearchAliasRule = {
  readonly query?: string;
  readonly mode?: SearchRuleMode;
  readonly filters: readonly MetadataFilter[];
  readonly tags: readonly string[];
  readonly repositoryScopes: readonly string[];
};

export type SearchPriorityRule = {
  readonly id: string;
  /** Smaller positive tiers are preferred. */
  readonly tier: number;
  readonly pathPrefix?: string;
  readonly tagsAll?: readonly string[];
  readonly repositoryScope?: string;
  readonly metadata?: readonly MetadataFilter[];
  readonly vaultId?: string;
};

export type SearchRulesV1 = {
  readonly schemaVersion: typeof SEARCH_RULES_SCHEMA_VERSION;
  readonly aliases: Readonly<Record<string, SearchAliasRule>>;
  readonly priorityRules: readonly SearchPriorityRule[];
};

export type SearchRuleRequest = {
  readonly query: string;
  readonly mode?: SearchRuleMode;
  readonly filters?: readonly MetadataFilter[];
  readonly tags?: readonly string[];
  readonly repositoryScopes?: readonly string[];
};

type ReplacedSearchRuleRequestFields =
  | "filters"
  | "mode"
  | "query"
  | "repositoryScopes"
  | "tags";

export type ExpandedSearchRuleRequest<T extends SearchRuleRequest> =
  Omit<T, ReplacedSearchRuleRequestFields> & SearchRuleRequest;

export type SearchAliasExpansion<T extends SearchRuleRequest> = {
  readonly request: ExpandedSearchRuleRequest<T>;
  readonly alias: string | null;
};

export type SearchRuleHit = {
  readonly id: string;
  readonly path: string;
  readonly identity: boolean;
  readonly tags: readonly string[];
  readonly metadata: MetadataObject;
  /** Federated callers may attach the stable logical vault ID to each hit. */
  readonly vaultId?: string;
  /** Optional precomputed exact authored scopes; metadata remains the fallback. */
  readonly repositoryScopes?: readonly string[];
};

export type SearchPriorityContext = {
  /** Single-vault callers can supply the logical vault ID once. */
  readonly vaultId?: string;
};

export type SearchPriorityTrace = {
  readonly id: string;
  /** One-based position in the caller-supplied relevance ordering. */
  readonly relevanceRank: number;
  readonly matchedRuleIds: readonly string[];
  readonly tier: number | null;
};

export type PrioritizedSearchHits<T extends SearchRuleHit> = {
  /** The original hit objects, reordered but never added, removed, or mutated. */
  readonly hits: readonly T[];
  /** Trace rows follow the returned hit order. */
  readonly trace: readonly SearchPriorityTrace[];
};

type ParseBudget = {
  bytes: number;
  nodes: number;
};

export const EMPTY_SEARCH_RULES: SearchRulesV1 = Object.freeze({
  schemaVersion: SEARCH_RULES_SCHEMA_VERSION,
  aliases: Object.freeze({}),
  priorityRules: Object.freeze([]),
});

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function strictKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new TypeError(`${label} contains unsupported key ${String(key)}.`);
    }
  }
}

function countNode(budget: ParseBudget, count = 1): void {
  budget.nodes += count;
  if (budget.nodes > MAX_SEARCH_RULE_NODES) {
    throw new RangeError(
      `Search rules may contain at most ${MAX_SEARCH_RULE_NODES} structured entries.`,
    );
  }
}

function countText(budget: ParseBudget, value: string, label: string): void {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_SEARCH_RULE_TEXT_BYTES) {
    throw new RangeError(
      `${label} must be at most ${MAX_SEARCH_RULE_TEXT_BYTES.toLocaleString("en-US")} UTF-8 bytes.`,
    );
  }
  budget.bytes += bytes;
  if (budget.bytes > MAX_SEARCH_RULE_CONFIG_BYTES) {
    throw new RangeError(
      `Search rules may contain at most ${MAX_SEARCH_RULE_CONFIG_BYTES.toLocaleString("en-US")} UTF-8 bytes of text.`,
    );
  }
}

function boundedString(
  value: unknown,
  label: string,
  budget: ParseBudget,
  options: { readonly trim?: boolean; readonly pattern?: RegExp } = {},
): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const checked = options.trim === true ? value.trim() : value;
  if (checked === "") throw new TypeError(`${label} must not be empty.`);
  if (options.trim === true && checked !== value) {
    throw new TypeError(`${label} must not contain surrounding whitespace.`);
  }
  if (options.pattern !== undefined && !options.pattern.test(checked)) {
    throw new TypeError(`${label} is not canonical.`);
  }
  countText(budget, checked, label);
  return checked;
}

function metadataScalar(
  value: unknown,
  label: string,
  budget: ParseBudget,
): MetadataScalar {
  if (
    value !== null
    && typeof value !== "string"
    && typeof value !== "number"
    && typeof value !== "boolean"
  ) {
    throw new TypeError(`${label} must be a metadata scalar.`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite metadata number.`);
  }
  if (typeof value === "string") countText(budget, value, label);
  countNode(budget);
  return value;
}

function metadataPath(
  value: unknown,
  label: string,
  budget: ParseBudget,
): MetadataPath {
  if (typeof value === "string") {
    countText(budget, value, label);
    return value;
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be a string or an array of path segments.`);
  }
  if (value.length === 0 || value.length > MAX_METADATA_PATH_SEGMENTS) {
    throw new RangeError(
      `${label} must contain from 1 through ${MAX_METADATA_PATH_SEGMENTS} segments.`,
    );
  }
  countNode(budget, value.length);
  return Object.freeze(value.map((segment, index) => {
    if (typeof segment !== "string") {
      throw new TypeError(`${label} segment ${index + 1} must be a string.`);
    }
    countText(budget, segment, `${label} segment ${index + 1}`);
    return segment;
  }));
}

function parseFilter(
  value: unknown,
  label: string,
  budget: ParseBudget,
): MetadataFilter {
  const input = record(value, label);
  countNode(budget);
  if (input.kind === "exists") {
    strictKeys(input, ["kind", "path"], label);
    return Object.freeze({
      kind: "exists",
      path: metadataPath(input.path, `${label} path`, budget),
    });
  }
  if (input.kind === "equals") {
    strictKeys(input, ["kind", "path", "value"], label);
    return Object.freeze({
      kind: "equals",
      path: metadataPath(input.path, `${label} path`, budget),
      value: metadataScalar(input.value, `${label} value`, budget),
    });
  }
  if (input.kind === "one-of") {
    strictKeys(input, ["kind", "path", "values"], label);
    if (!Array.isArray(input.values)) {
      throw new TypeError(`${label} values must be an array.`);
    }
    if (input.values.length === 0 || input.values.length > MAX_SEARCH_RULE_FILTERS) {
      throw new RangeError(
        `${label} values must contain from 1 through ${MAX_SEARCH_RULE_FILTERS} entries.`,
      );
    }
    countNode(budget, input.values.length);
    return Object.freeze({
      kind: "one-of",
      path: metadataPath(input.path, `${label} path`, budget),
      values: Object.freeze(input.values.map((candidate, index) =>
        metadataScalar(candidate, `${label} value ${index + 1}`, budget))),
    });
  }
  throw new TypeError(`${label} must be an equals, exists, or one-of filter.`);
}

function parseFilters(
  value: unknown,
  label: string,
  budget: ParseBudget,
): readonly MetadataFilter[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > MAX_SEARCH_RULE_FILTERS) {
    throw new RangeError(`${label} may contain at most ${MAX_SEARCH_RULE_FILTERS} entries.`);
  }
  const filters = Object.freeze(value.map((filter, index) =>
    parseFilter(filter, `${label} ${index + 1}`, budget)));
  validateQueryOptions({ filters });
  return filters;
}

function normalizedTag(value: string): string {
  return value.trim().replace(/^#+/u, "").normalize("NFC").toLocaleLowerCase("en-US");
}

function parseTags(
  value: unknown,
  label: string,
  budget: ParseBudget,
  requireNonempty = false,
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > MAX_SEARCH_RULE_TAGS || (requireNonempty && value.length === 0)) {
    const minimum = requireNonempty ? "from 1 through" : "at most";
    throw new RangeError(`${label} may contain ${minimum} ${MAX_SEARCH_RULE_TAGS} entries.`);
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== "string") {
      throw new TypeError(`${label} ${index + 1} must be a string.`);
    }
    countText(budget, candidate, `${label} ${index + 1}`);
    countNode(budget);
    const tag = normalizedTag(candidate);
    if (tag === "") throw new TypeError(`${label} ${index + 1} must not be empty.`);
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return Object.freeze(tags);
}

function parseScopes(
  value: unknown,
  label: string,
  budget: ParseBudget,
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > MAX_SEARCH_RULE_SCOPES) {
    throw new RangeError(`${label} may contain at most ${MAX_SEARCH_RULE_SCOPES} entries.`);
  }
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== "string") {
      throw new TypeError(`${label} ${index + 1} must be a string.`);
    }
    countText(budget, candidate, `${label} ${index + 1}`);
    countNode(budget);
  }
  return Object.freeze([...validateRepositoryScopeSelection(value)]);
}

function parseMode(value: unknown, label: string): SearchRuleMode | undefined {
  if (value === undefined) return undefined;
  if (value !== "exact" && value !== "hybrid" && value !== "keyword" && value !== "semantic") {
    throw new TypeError(`${label} must be exact, hybrid, keyword, or semantic.`);
  }
  return value;
}

function parseAlias(
  value: unknown,
  name: string,
  budget: ParseBudget,
): SearchAliasRule {
  const input = record(value, `Search alias @${name}`);
  strictKeys(input, ["filters", "mode", "query", "repositoryScopes", "tags"], `Search alias @${name}`);
  countNode(budget);
  const query = input.query === undefined
    ? undefined
    : boundedString(input.query, `Search alias @${name} query`, budget, { trim: true });
  const mode = parseMode(input.mode, `Search alias @${name} mode`);
  const filters = parseFilters(input.filters, `Search alias @${name} filters`, budget);
  const tags = parseTags(input.tags, `Search alias @${name} tags`, budget);
  const repositoryScopes = parseScopes(
    input.repositoryScopes,
    `Search alias @${name} repository scopes`,
    budget,
  );
  return Object.freeze({
    ...(query === undefined ? {} : { query }),
    ...(mode === undefined ? {} : { mode }),
    filters,
    tags,
    repositoryScopes,
  });
}

function pathPrefix(value: unknown, label: string, budget: ParseBudget): string {
  const prefix = boundedString(value, label, budget, { trim: true });
  if (
    prefix.startsWith("/")
    || prefix.includes("\\")
    || prefix.includes("\0")
    || prefix.includes("//")
    || prefix.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError(`${label} must be a canonical repository-relative prefix.`);
  }
  return prefix;
}

function vaultId(value: unknown, label: string, budget: ParseBudget): string {
  return boundedString(value, label, budget, { trim: true, pattern: vaultIdPattern });
}

function parsePriorityRule(
  value: unknown,
  index: number,
  budget: ParseBudget,
): SearchPriorityRule {
  const label = `Search priority rule ${index + 1}`;
  const input = record(value, label);
  strictKeys(input, [
    "id",
    "metadata",
    "pathPrefix",
    "repositoryScope",
    "tagsAll",
    "tier",
    "vaultId",
  ], label);
  countNode(budget);
  const id = boundedString(input.id, `${label} ID`, budget, {
    trim: true,
    pattern: ruleIdPattern,
  });
  if (!Number.isSafeInteger(input.tier) || (input.tier as number) < 1 || (input.tier as number) > MAX_SEARCH_RULE_TIER) {
    throw new RangeError(`${label} tier must be an integer from 1 through ${MAX_SEARCH_RULE_TIER}.`);
  }
  const checkedPathPrefix = input.pathPrefix === undefined
    ? undefined
    : pathPrefix(input.pathPrefix, `${label} path prefix`, budget);
  const tagsAll = input.tagsAll === undefined
    ? undefined
    : parseTags(input.tagsAll, `${label} required tags`, budget, true);
  let repositoryScope: string | undefined;
  if (input.repositoryScope !== undefined) {
    if (typeof input.repositoryScope !== "string") {
      throw new TypeError(`${label} repository scope must be a string.`);
    }
    countText(budget, input.repositoryScope, `${label} repository scope`);
    repositoryScope = validateRepositoryScopeSelection([input.repositoryScope])[0];
  }
  const metadata = input.metadata === undefined
    ? undefined
    : parseFilters(input.metadata, `${label} metadata filters`, budget);
  if (metadata !== undefined && metadata.length === 0) {
    throw new RangeError(`${label} metadata filters must not be empty when provided.`);
  }
  const checkedVaultId = input.vaultId === undefined
    ? undefined
    : vaultId(input.vaultId, `${label} vault ID`, budget);
  if (
    checkedPathPrefix === undefined
    && tagsAll === undefined
    && repositoryScope === undefined
    && metadata === undefined
    && checkedVaultId === undefined
  ) {
    throw new TypeError(`${label} must contain at least one match condition.`);
  }
  return Object.freeze({
    id,
    tier: input.tier as number,
    ...(checkedPathPrefix === undefined ? {} : { pathPrefix: checkedPathPrefix }),
    ...(tagsAll === undefined ? {} : { tagsAll }),
    ...(repositoryScope === undefined ? {} : { repositoryScope }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(checkedVaultId === undefined ? {} : { vaultId: checkedVaultId }),
  });
}

/** Parse a bounded, strict JSON-compatible search-rules document. */
export function parseSearchRules(value: unknown): SearchRulesV1 {
  const input = record(value, "Search rules");
  strictKeys(input, ["aliases", "priorityRules", "schemaVersion"], "Search rules");
  if (input.schemaVersion !== SEARCH_RULES_SCHEMA_VERSION) {
    throw new TypeError(`Search rules schemaVersion must be ${SEARCH_RULES_SCHEMA_VERSION}.`);
  }
  const budget: ParseBudget = { bytes: 0, nodes: 1 };
  const aliasInput = input.aliases === undefined
    ? Object.freeze({})
    : record(input.aliases, "Search rule aliases");
  if (Reflect.ownKeys(aliasInput).some((key) => typeof key !== "string")) {
    throw new TypeError("Search rule aliases may contain only string alias names.");
  }
  const aliasEntries = Object.entries(aliasInput);
  if (aliasEntries.length > MAX_SEARCH_RULE_ALIASES) {
    throw new RangeError(`Search rules may define at most ${MAX_SEARCH_RULE_ALIASES} aliases.`);
  }
  const aliases: Array<readonly [string, SearchAliasRule]> = [];
  for (const [rawName, definition] of aliasEntries) {
    const name = boundedString(rawName, "Search alias name", budget, {
      trim: true,
      pattern: aliasNamePattern,
    });
    aliases.push([name, parseAlias(definition, name, budget)]);
  }
  const rawPriorityRules = input.priorityRules ?? [];
  if (!Array.isArray(rawPriorityRules)) {
    throw new TypeError("Search priorityRules must be an array.");
  }
  if (rawPriorityRules.length > MAX_SEARCH_PRIORITY_RULES) {
    throw new RangeError(
      `Search rules may define at most ${MAX_SEARCH_PRIORITY_RULES} priority rules.`,
    );
  }
  const priorityRules = Object.freeze(rawPriorityRules.map((rule, index) =>
    parsePriorityRule(rule, index, budget)));
  const ids = new Set<string>();
  for (const rule of priorityRules) {
    if (ids.has(rule.id)) throw new TypeError(`Search priority rule ID ${rule.id} is duplicated.`);
    ids.add(rule.id);
  }
  return Object.freeze({
    schemaVersion: SEARCH_RULES_SCHEMA_VERSION,
    aliases: Object.freeze(Object.fromEntries(aliases)),
    priorityRules,
  });
}

function leadingAlias(query: string): { readonly name: string; readonly rest: string } | null {
  const leading = query.trimStart();
  if (!leading.startsWith("@")) return null;
  const whitespace = leading.search(/\s/u);
  const token = whitespace < 0 ? leading : leading.slice(0, whitespace);
  const name = token.slice(1);
  if (!aliasNamePattern.test(name)) {
    throw new TypeError("A leading search alias must use canonical @alias syntax.");
  }
  const rest = leading.slice(token.length).trim();
  if (rest.startsWith("@")) {
    throw new TypeError("A search query may contain only one leading @alias.");
  }
  return { name, rest };
}

function callerArray<T>(value: readonly T[] | undefined, label: string): readonly T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

/** Expand one configured leading alias without replacing any caller-authored constraint. */
export function expandSearchRequest<T extends SearchRuleRequest>(
  request: T,
  rules: SearchRulesV1,
): SearchAliasExpansion<T> {
  if (typeof request.query !== "string") throw new TypeError("Search query must be a string.");
  if (Object.keys(rules.aliases).length === 0) {
    return Object.freeze({
      request: request as ExpandedSearchRuleRequest<T>,
      alias: null,
    });
  }
  const parsed = leadingAlias(request.query);
  if (parsed === null) {
    return Object.freeze({
      request: request as ExpandedSearchRuleRequest<T>,
      alias: null,
    });
  }
  if (!Object.hasOwn(rules.aliases, parsed.name)) {
    throw new TypeError(`Unknown search alias @${parsed.name}.`);
  }
  const alias = rules.aliases[parsed.name];
  if (alias === undefined) throw new TypeError(`Unknown search alias @${parsed.name}.`);
  const query = [alias.query, parsed.rest].filter((part): part is string =>
    part !== undefined && part !== "").join(" ");
  if (query === "") throw new TypeError(`Search alias @${parsed.name} must produce a nonempty query.`);
  if (Buffer.byteLength(query, "utf8") > MAX_SEARCH_RULE_TEXT_BYTES) {
    throw new RangeError(
      `Expanded search query must be at most ${MAX_SEARCH_RULE_TEXT_BYTES.toLocaleString("en-US")} UTF-8 bytes.`,
    );
  }
  const callerFilters = callerArray(request.filters, "Search request filters");
  const callerTags = callerArray(request.tags, "Search request tags");
  const callerScopes = callerArray(request.repositoryScopes, "Search request repository scopes");
  // Repository-scope selections are OR groups in the existing search API. When
  // both the caller and alias supply a group, preserve the caller group and add
  // the alias group as an ANDed metadata filter instead of broadening either one.
  const aliasScopeFilters: readonly MetadataFilter[] =
    callerScopes.length > 0 && alias.repositoryScopes.length > 0
      ? [Object.freeze({
          kind: "one-of",
          path: "repository_scopes",
          values: alias.repositoryScopes,
        })]
      : [];
  const expandedScopes = callerScopes.length > 0
    ? callerScopes
    : alias.repositoryScopes;
  const mode = request.mode ?? alias.mode;
  if (request.mode !== undefined) parseMode(request.mode, "Search request mode");
  const expanded = Object.freeze({
    ...request,
    query,
    ...(mode === undefined ? {} : { mode }),
    ...(callerFilters.length === 0 && alias.filters.length === 0 && aliasScopeFilters.length === 0
      ? {}
      : { filters: Object.freeze([...callerFilters, ...alias.filters, ...aliasScopeFilters]) }),
    ...(callerTags.length === 0 && alias.tags.length === 0
      ? {}
      : { tags: Object.freeze([...callerTags, ...alias.tags]) }),
    ...(expandedScopes.length === 0
      ? {}
      : { repositoryScopes: Object.freeze([...expandedScopes]) }),
  }) as ExpandedSearchRuleRequest<T>;
  return Object.freeze({ request: expanded, alias: parsed.name });
}

function isMetadataObject(value: MetadataValue): value is MetadataObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedString(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function scalarMatches(value: MetadataValue, expected: MetadataScalar): boolean {
  if (Array.isArray(value)) return value.some((candidate) => scalarMatches(candidate, expected));
  if (isMetadataObject(value)) return false;
  if (typeof value === "string" && typeof expected === "string") {
    return normalizedString(value) === normalizedString(expected);
  }
  return Object.is(value, expected);
}

function metadataMatches(metadata: MetadataObject, filter: MetadataFilter): boolean {
  const lookup = metadataAtPath(metadata, filter.path);
  if (filter.kind === "exists") return lookup.found;
  if (!lookup.found) return false;
  if (filter.kind === "one-of") {
    return filter.values.some((expected) => scalarMatches(lookup.value, expected));
  }
  return scalarMatches(lookup.value, filter.value);
}

function scopeMatches(hit: SearchRuleHit, expected: string): boolean {
  if (hit.repositoryScopes !== undefined) return hit.repositoryScopes.includes(expected);
  const authored = analyzeAuthoredRepositoryScopes(hit.metadata);
  return authored.present && authored.valid && authored.scopes.includes(expected);
}

function ruleMatches(
  hit: SearchRuleHit,
  rule: SearchPriorityRule,
  inheritedVaultId: string | undefined,
): boolean {
  if (rule.pathPrefix !== undefined && !hit.path.startsWith(rule.pathPrefix)) return false;
  if (rule.tagsAll !== undefined) {
    const tags = new Set(hit.tags.map(normalizedTag));
    if (!rule.tagsAll.every((tag) => tags.has(tag))) return false;
  }
  if (rule.repositoryScope !== undefined && !scopeMatches(hit, rule.repositoryScope)) return false;
  if (rule.metadata !== undefined && !rule.metadata.every((filter) =>
    metadataMatches(hit.metadata, filter))) return false;
  if (rule.vaultId !== undefined && (hit.vaultId ?? inheritedVaultId) !== rule.vaultId) return false;
  return true;
}

/**
 * Stably apply configured priority tiers after relevance retrieval.
 * Exact identity remains ahead of every priority tier; ties retain relevance order.
 */
export function prioritizeSearchHits<T extends SearchRuleHit>(
  hits: readonly T[],
  rules: SearchRulesV1,
  context: SearchPriorityContext = {},
): PrioritizedSearchHits<T> {
  if (rules.priorityRules.length === 0) {
    return Object.freeze({
      hits,
      trace: Object.freeze(hits.map((hit, index) => Object.freeze({
        id: hit.id,
        relevanceRank: index + 1,
        matchedRuleIds: Object.freeze([]),
        tier: null,
      }))),
    });
  }
  const inheritedVaultId = context.vaultId === undefined
    ? undefined
    : vaultId(context.vaultId, "Search priority context vault ID", { bytes: 0, nodes: 0 });
  const candidates = hits.map((hit, index) => {
    const matched = rules.priorityRules.filter((rule) => ruleMatches(hit, rule, inheritedVaultId));
    const tier = matched.length === 0
      ? null
      : Math.min(...matched.map((rule) => rule.tier));
    return {
      hit,
      trace: Object.freeze({
        id: hit.id,
        relevanceRank: index + 1,
        matchedRuleIds: Object.freeze(matched.map(({ id }) => id)),
        tier,
      }) satisfies SearchPriorityTrace,
    };
  });
  const ordered = candidates.toSorted((left, right) =>
    Number(right.hit.identity) - Number(left.hit.identity)
    || (left.trace.tier ?? Number.POSITIVE_INFINITY)
      - (right.trace.tier ?? Number.POSITIVE_INFINITY)
    || left.trace.relevanceRank - right.trace.relevanceRank);
  const unchanged = ordered.every((candidate, index) => candidate === candidates[index]);
  return Object.freeze({
    hits: unchanged ? hits : Object.freeze(ordered.map(({ hit }) => hit)),
    trace: Object.freeze(ordered.map(({ trace }) => trace)),
  });
}
