// @bun
import {
  metadataAtPath,
  validateQueryOptions
} from "./index-48pz4jpc.js";
import {
  analyzeAuthoredRepositoryScopes,
  validateRepositoryScopeSelection
} from "./index-06c9ctr6.js";

// src/search-rules.ts
var SEARCH_RULES_SCHEMA_VERSION = 1;
var MAX_SEARCH_RULE_ALIASES = 64;
var MAX_SEARCH_PRIORITY_RULES = 128;
var MAX_SEARCH_RULE_FILTERS = 64;
var MAX_SEARCH_RULE_TAGS = 64;
var MAX_SEARCH_RULE_SCOPES = 64;
var MAX_SEARCH_RULE_TEXT_BYTES = 16 * 1024;
var MAX_SEARCH_RULE_CONFIG_BYTES = 128 * 1024;
var MAX_SEARCH_RULE_TIER = 32;
var MAX_SEARCH_RULE_NODES = 2048;
var MAX_METADATA_PATH_SEGMENTS = 32;
var aliasNamePattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
var ruleIdPattern = aliasNamePattern;
var vaultIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)?$/u;
var EMPTY_SEARCH_RULES = Object.freeze({
  schemaVersion: SEARCH_RULES_SCHEMA_VERSION,
  aliases: Object.freeze({}),
  priorityRules: Object.freeze([])
});
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}
function strictKeys(value, allowed, label) {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new TypeError(`${label} contains unsupported key ${String(key)}.`);
    }
  }
}
function countNode(budget, count = 1) {
  budget.nodes += count;
  if (budget.nodes > MAX_SEARCH_RULE_NODES) {
    throw new RangeError(`Search rules may contain at most ${MAX_SEARCH_RULE_NODES} structured entries.`);
  }
}
function countText(budget, value, label) {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_SEARCH_RULE_TEXT_BYTES) {
    throw new RangeError(`${label} must be at most ${MAX_SEARCH_RULE_TEXT_BYTES.toLocaleString("en-US")} UTF-8 bytes.`);
  }
  budget.bytes += bytes;
  if (budget.bytes > MAX_SEARCH_RULE_CONFIG_BYTES) {
    throw new RangeError(`Search rules may contain at most ${MAX_SEARCH_RULE_CONFIG_BYTES.toLocaleString("en-US")} UTF-8 bytes of text.`);
  }
}
function boundedString(value, label, budget, options = {}) {
  if (typeof value !== "string")
    throw new TypeError(`${label} must be a string.`);
  const checked = options.trim === true ? value.trim() : value;
  if (checked === "")
    throw new TypeError(`${label} must not be empty.`);
  if (options.trim === true && checked !== value) {
    throw new TypeError(`${label} must not contain surrounding whitespace.`);
  }
  if (options.pattern !== undefined && !options.pattern.test(checked)) {
    throw new TypeError(`${label} is not canonical.`);
  }
  countText(budget, checked, label);
  return checked;
}
function metadataScalar(value, label, budget) {
  if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new TypeError(`${label} must be a metadata scalar.`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite metadata number.`);
  }
  if (typeof value === "string")
    countText(budget, value, label);
  countNode(budget);
  return value;
}
function metadataPath(value, label, budget) {
  if (typeof value === "string") {
    countText(budget, value, label);
    return value;
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be a string or an array of path segments.`);
  }
  if (value.length === 0 || value.length > MAX_METADATA_PATH_SEGMENTS) {
    throw new RangeError(`${label} must contain from 1 through ${MAX_METADATA_PATH_SEGMENTS} segments.`);
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
function parseFilter(value, label, budget) {
  const input = record(value, label);
  countNode(budget);
  if (input.kind === "exists") {
    strictKeys(input, ["kind", "path"], label);
    return Object.freeze({
      kind: "exists",
      path: metadataPath(input.path, `${label} path`, budget)
    });
  }
  if (input.kind === "equals") {
    strictKeys(input, ["kind", "path", "value"], label);
    return Object.freeze({
      kind: "equals",
      path: metadataPath(input.path, `${label} path`, budget),
      value: metadataScalar(input.value, `${label} value`, budget)
    });
  }
  if (input.kind === "one-of") {
    strictKeys(input, ["kind", "path", "values"], label);
    if (!Array.isArray(input.values)) {
      throw new TypeError(`${label} values must be an array.`);
    }
    if (input.values.length === 0 || input.values.length > MAX_SEARCH_RULE_FILTERS) {
      throw new RangeError(`${label} values must contain from 1 through ${MAX_SEARCH_RULE_FILTERS} entries.`);
    }
    countNode(budget, input.values.length);
    return Object.freeze({
      kind: "one-of",
      path: metadataPath(input.path, `${label} path`, budget),
      values: Object.freeze(input.values.map((candidate, index) => metadataScalar(candidate, `${label} value ${index + 1}`, budget)))
    });
  }
  throw new TypeError(`${label} must be an equals, exists, or one-of filter.`);
}
function parseFilters(value, label, budget) {
  if (value === undefined)
    return Object.freeze([]);
  if (!Array.isArray(value))
    throw new TypeError(`${label} must be an array.`);
  if (value.length > MAX_SEARCH_RULE_FILTERS) {
    throw new RangeError(`${label} may contain at most ${MAX_SEARCH_RULE_FILTERS} entries.`);
  }
  const filters = Object.freeze(value.map((filter, index) => parseFilter(filter, `${label} ${index + 1}`, budget)));
  validateQueryOptions({ filters });
  return filters;
}
function normalizedTag(value) {
  return value.trim().replace(/^#+/u, "").normalize("NFC").toLocaleLowerCase("en-US");
}
function parseTags(value, label, budget, requireNonempty = false) {
  if (value === undefined)
    return Object.freeze([]);
  if (!Array.isArray(value))
    throw new TypeError(`${label} must be an array.`);
  if (value.length > MAX_SEARCH_RULE_TAGS || requireNonempty && value.length === 0) {
    const minimum = requireNonempty ? "from 1 through" : "at most";
    throw new RangeError(`${label} may contain ${minimum} ${MAX_SEARCH_RULE_TAGS} entries.`);
  }
  const seen = new Set;
  const tags = [];
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== "string") {
      throw new TypeError(`${label} ${index + 1} must be a string.`);
    }
    countText(budget, candidate, `${label} ${index + 1}`);
    countNode(budget);
    const tag = normalizedTag(candidate);
    if (tag === "")
      throw new TypeError(`${label} ${index + 1} must not be empty.`);
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return Object.freeze(tags);
}
function parseScopes(value, label, budget) {
  if (value === undefined)
    return Object.freeze([]);
  if (!Array.isArray(value))
    throw new TypeError(`${label} must be an array.`);
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
function parseMode(value, label) {
  if (value === undefined)
    return;
  if (value !== "exact" && value !== "hybrid" && value !== "keyword" && value !== "semantic") {
    throw new TypeError(`${label} must be exact, hybrid, keyword, or semantic.`);
  }
  return value;
}
function parseAlias(value, name, budget) {
  const input = record(value, `Search alias @${name}`);
  strictKeys(input, ["filters", "mode", "query", "repositoryScopes", "tags"], `Search alias @${name}`);
  countNode(budget);
  const query = input.query === undefined ? undefined : boundedString(input.query, `Search alias @${name} query`, budget, { trim: true });
  const mode = parseMode(input.mode, `Search alias @${name} mode`);
  const filters = parseFilters(input.filters, `Search alias @${name} filters`, budget);
  const tags = parseTags(input.tags, `Search alias @${name} tags`, budget);
  const repositoryScopes = parseScopes(input.repositoryScopes, `Search alias @${name} repository scopes`, budget);
  return Object.freeze({
    ...query === undefined ? {} : { query },
    ...mode === undefined ? {} : { mode },
    filters,
    tags,
    repositoryScopes
  });
}
function pathPrefix(value, label, budget) {
  const prefix = boundedString(value, label, budget, { trim: true });
  if (prefix.startsWith("/") || prefix.includes("\\") || prefix.includes("\x00") || prefix.includes("//") || prefix.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new TypeError(`${label} must be a canonical repository-relative prefix.`);
  }
  return prefix;
}
function vaultId(value, label, budget) {
  return boundedString(value, label, budget, { trim: true, pattern: vaultIdPattern });
}
function parsePriorityRule(value, index, budget) {
  const label = `Search priority rule ${index + 1}`;
  const input = record(value, label);
  strictKeys(input, [
    "id",
    "metadata",
    "pathPrefix",
    "repositoryScope",
    "tagsAll",
    "tier",
    "vaultId"
  ], label);
  countNode(budget);
  const id = boundedString(input.id, `${label} ID`, budget, {
    trim: true,
    pattern: ruleIdPattern
  });
  if (!Number.isSafeInteger(input.tier) || input.tier < 1 || input.tier > MAX_SEARCH_RULE_TIER) {
    throw new RangeError(`${label} tier must be an integer from 1 through ${MAX_SEARCH_RULE_TIER}.`);
  }
  const checkedPathPrefix = input.pathPrefix === undefined ? undefined : pathPrefix(input.pathPrefix, `${label} path prefix`, budget);
  const tagsAll = input.tagsAll === undefined ? undefined : parseTags(input.tagsAll, `${label} required tags`, budget, true);
  let repositoryScope;
  if (input.repositoryScope !== undefined) {
    if (typeof input.repositoryScope !== "string") {
      throw new TypeError(`${label} repository scope must be a string.`);
    }
    countText(budget, input.repositoryScope, `${label} repository scope`);
    repositoryScope = validateRepositoryScopeSelection([input.repositoryScope])[0];
  }
  const metadata = input.metadata === undefined ? undefined : parseFilters(input.metadata, `${label} metadata filters`, budget);
  if (metadata !== undefined && metadata.length === 0) {
    throw new RangeError(`${label} metadata filters must not be empty when provided.`);
  }
  const checkedVaultId = input.vaultId === undefined ? undefined : vaultId(input.vaultId, `${label} vault ID`, budget);
  if (checkedPathPrefix === undefined && tagsAll === undefined && repositoryScope === undefined && metadata === undefined && checkedVaultId === undefined) {
    throw new TypeError(`${label} must contain at least one match condition.`);
  }
  return Object.freeze({
    id,
    tier: input.tier,
    ...checkedPathPrefix === undefined ? {} : { pathPrefix: checkedPathPrefix },
    ...tagsAll === undefined ? {} : { tagsAll },
    ...repositoryScope === undefined ? {} : { repositoryScope },
    ...metadata === undefined ? {} : { metadata },
    ...checkedVaultId === undefined ? {} : { vaultId: checkedVaultId }
  });
}
function parseSearchRules(value) {
  const input = record(value, "Search rules");
  strictKeys(input, ["aliases", "priorityRules", "schemaVersion"], "Search rules");
  if (input.schemaVersion !== SEARCH_RULES_SCHEMA_VERSION) {
    throw new TypeError(`Search rules schemaVersion must be ${SEARCH_RULES_SCHEMA_VERSION}.`);
  }
  const budget = { bytes: 0, nodes: 1 };
  const aliasInput = input.aliases === undefined ? Object.freeze({}) : record(input.aliases, "Search rule aliases");
  if (Reflect.ownKeys(aliasInput).some((key) => typeof key !== "string")) {
    throw new TypeError("Search rule aliases may contain only string alias names.");
  }
  const aliasEntries = Object.entries(aliasInput);
  if (aliasEntries.length > MAX_SEARCH_RULE_ALIASES) {
    throw new RangeError(`Search rules may define at most ${MAX_SEARCH_RULE_ALIASES} aliases.`);
  }
  const aliases = [];
  for (const [rawName, definition] of aliasEntries) {
    const name = boundedString(rawName, "Search alias name", budget, {
      trim: true,
      pattern: aliasNamePattern
    });
    aliases.push([name, parseAlias(definition, name, budget)]);
  }
  const rawPriorityRules = input.priorityRules ?? [];
  if (!Array.isArray(rawPriorityRules)) {
    throw new TypeError("Search priorityRules must be an array.");
  }
  if (rawPriorityRules.length > MAX_SEARCH_PRIORITY_RULES) {
    throw new RangeError(`Search rules may define at most ${MAX_SEARCH_PRIORITY_RULES} priority rules.`);
  }
  const priorityRules = Object.freeze(rawPriorityRules.map((rule, index) => parsePriorityRule(rule, index, budget)));
  const ids = new Set;
  for (const rule of priorityRules) {
    if (ids.has(rule.id))
      throw new TypeError(`Search priority rule ID ${rule.id} is duplicated.`);
    ids.add(rule.id);
  }
  return Object.freeze({
    schemaVersion: SEARCH_RULES_SCHEMA_VERSION,
    aliases: Object.freeze(Object.fromEntries(aliases)),
    priorityRules
  });
}
function leadingAlias(query) {
  const leading = query.trimStart();
  if (!leading.startsWith("@"))
    return null;
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
function callerArray(value, label) {
  if (value === undefined)
    return [];
  if (!Array.isArray(value))
    throw new TypeError(`${label} must be an array.`);
  return value;
}
function expandSearchRequest(request, rules) {
  if (typeof request.query !== "string")
    throw new TypeError("Search query must be a string.");
  if (Object.keys(rules.aliases).length === 0) {
    return Object.freeze({
      request,
      alias: null
    });
  }
  const parsed = leadingAlias(request.query);
  if (parsed === null) {
    return Object.freeze({
      request,
      alias: null
    });
  }
  if (!Object.hasOwn(rules.aliases, parsed.name)) {
    throw new TypeError(`Unknown search alias @${parsed.name}.`);
  }
  const alias = rules.aliases[parsed.name];
  if (alias === undefined)
    throw new TypeError(`Unknown search alias @${parsed.name}.`);
  const query = [alias.query, parsed.rest].filter((part) => part !== undefined && part !== "").join(" ");
  if (query === "")
    throw new TypeError(`Search alias @${parsed.name} must produce a nonempty query.`);
  if (Buffer.byteLength(query, "utf8") > MAX_SEARCH_RULE_TEXT_BYTES) {
    throw new RangeError(`Expanded search query must be at most ${MAX_SEARCH_RULE_TEXT_BYTES.toLocaleString("en-US")} UTF-8 bytes.`);
  }
  const callerFilters = callerArray(request.filters, "Search request filters");
  const callerTags = callerArray(request.tags, "Search request tags");
  const callerScopes = callerArray(request.repositoryScopes, "Search request repository scopes");
  const aliasScopeFilters = callerScopes.length > 0 && alias.repositoryScopes.length > 0 ? [Object.freeze({
    kind: "one-of",
    path: "repository_scopes",
    values: alias.repositoryScopes
  })] : [];
  const expandedScopes = callerScopes.length > 0 ? callerScopes : alias.repositoryScopes;
  const mode = request.mode ?? alias.mode;
  if (request.mode !== undefined)
    parseMode(request.mode, "Search request mode");
  const expanded = Object.freeze({
    ...request,
    query,
    ...mode === undefined ? {} : { mode },
    ...callerFilters.length === 0 && alias.filters.length === 0 && aliasScopeFilters.length === 0 ? {} : { filters: Object.freeze([...callerFilters, ...alias.filters, ...aliasScopeFilters]) },
    ...callerTags.length === 0 && alias.tags.length === 0 ? {} : { tags: Object.freeze([...callerTags, ...alias.tags]) },
    ...expandedScopes.length === 0 ? {} : { repositoryScopes: Object.freeze([...expandedScopes]) }
  });
  return Object.freeze({ request: expanded, alias: parsed.name });
}
function isMetadataObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function normalizedString(value) {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}
function scalarMatches(value, expected) {
  if (Array.isArray(value))
    return value.some((candidate) => scalarMatches(candidate, expected));
  if (isMetadataObject(value))
    return false;
  if (typeof value === "string" && typeof expected === "string") {
    return normalizedString(value) === normalizedString(expected);
  }
  return Object.is(value, expected);
}
function metadataMatches(metadata, filter) {
  const lookup = metadataAtPath(metadata, filter.path);
  if (filter.kind === "exists")
    return lookup.found;
  if (!lookup.found)
    return false;
  if (filter.kind === "one-of") {
    return filter.values.some((expected) => scalarMatches(lookup.value, expected));
  }
  return scalarMatches(lookup.value, filter.value);
}
function scopeMatches(hit, expected) {
  if (hit.repositoryScopes !== undefined)
    return hit.repositoryScopes.includes(expected);
  const authored = analyzeAuthoredRepositoryScopes(hit.metadata);
  return authored.present && authored.valid && authored.scopes.includes(expected);
}
function ruleMatches(hit, rule, inheritedVaultId) {
  if (rule.pathPrefix !== undefined && !hit.path.startsWith(rule.pathPrefix))
    return false;
  if (rule.tagsAll !== undefined) {
    const tags = new Set(hit.tags.map(normalizedTag));
    if (!rule.tagsAll.every((tag) => tags.has(tag)))
      return false;
  }
  if (rule.repositoryScope !== undefined && !scopeMatches(hit, rule.repositoryScope))
    return false;
  if (rule.metadata !== undefined && !rule.metadata.every((filter) => metadataMatches(hit.metadata, filter)))
    return false;
  if (rule.vaultId !== undefined && (hit.vaultId ?? inheritedVaultId) !== rule.vaultId)
    return false;
  return true;
}
function prioritizeSearchHits(hits, rules, context = {}) {
  if (rules.priorityRules.length === 0) {
    return Object.freeze({
      hits,
      trace: Object.freeze(hits.map((hit, index) => Object.freeze({
        id: hit.id,
        relevanceRank: index + 1,
        matchedRuleIds: Object.freeze([]),
        tier: null
      })))
    });
  }
  const inheritedVaultId = context.vaultId === undefined ? undefined : vaultId(context.vaultId, "Search priority context vault ID", { bytes: 0, nodes: 0 });
  const candidates = hits.map((hit, index) => {
    const matched = rules.priorityRules.filter((rule) => ruleMatches(hit, rule, inheritedVaultId));
    const tier = matched.length === 0 ? null : Math.min(...matched.map((rule) => rule.tier));
    return {
      hit,
      trace: Object.freeze({
        id: hit.id,
        relevanceRank: index + 1,
        matchedRuleIds: Object.freeze(matched.map(({ id }) => id)),
        tier
      })
    };
  });
  const ordered = candidates.toSorted((left, right) => Number(right.hit.identity) - Number(left.hit.identity) || (left.trace.tier ?? Number.POSITIVE_INFINITY) - (right.trace.tier ?? Number.POSITIVE_INFINITY) || left.trace.relevanceRank - right.trace.relevanceRank);
  const unchanged = ordered.every((candidate, index) => candidate === candidates[index]);
  return Object.freeze({
    hits: unchanged ? hits : Object.freeze(ordered.map(({ hit }) => hit)),
    trace: Object.freeze(ordered.map(({ trace }) => trace))
  });
}

export { SEARCH_RULES_SCHEMA_VERSION, MAX_SEARCH_RULE_ALIASES, MAX_SEARCH_PRIORITY_RULES, MAX_SEARCH_RULE_FILTERS, MAX_SEARCH_RULE_TAGS, MAX_SEARCH_RULE_SCOPES, MAX_SEARCH_RULE_TEXT_BYTES, MAX_SEARCH_RULE_CONFIG_BYTES, MAX_SEARCH_RULE_TIER, EMPTY_SEARCH_RULES, parseSearchRules, expandSearchRequest, prioritizeSearchHits };
