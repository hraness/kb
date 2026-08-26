import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  EMPTY_SEARCH_RULES,
  expandSearchRequest,
  parseSearchRules,
  prioritizeSearchHits,
  type SearchRuleHit,
} from "./search-rules.js";

const configuredRules = () => parseSearchRules({
  schemaVersion: 1,
  aliases: {
    plans: {
      query: "implementation plan",
      mode: "keyword",
      filters: [{ kind: "equals", path: "status", value: "in-progress" }],
      tags: ["planning"],
      repositoryScopes: ["packages/kb"],
    },
  },
  priorityRules: [
    {
      id: "active-hra-plan",
      tier: 1,
      pathPrefix: "plans/",
      tagsAll: ["priority", "HRA"],
      repositoryScope: "projects/hra",
      metadata: [{ kind: "equals", path: "status", value: "active" }],
      vaultId: "hraness/jungle",
    },
    {
      id: "maintained-note",
      tier: 2,
      pathPrefix: "notes/",
      metadata: [{ kind: "one-of", path: ["record", "role"], values: ["canonical", "maintained"] }],
    },
  ],
});

describe("search rules schema", () => {
  test("parses and freezes one bounded v1 document", () => {
    const rules = configuredRules();
    expect(rules.schemaVersion).toBe(1);
    expect(rules.aliases.plans).toEqual({
      query: "implementation plan",
      mode: "keyword",
      filters: [{ kind: "equals", path: "status", value: "in-progress" }],
      tags: ["planning"],
      repositoryScopes: ["packages/kb"],
    });
    expect(rules.priorityRules.map(({ id, tier }) => ({ id, tier }))).toEqual([
      { id: "active-hra-plan", tier: 1 },
      { id: "maintained-note", tier: 2 },
    ]);
    expect(Object.isFrozen(rules)).toBe(true);
    expect(Object.isFrozen(rules.priorityRules[0]?.metadata)).toBe(true);
  });

  test("rejects unknown keys, malformed predicates, duplicates, and unbounded input", () => {
    for (const input of [
      { schemaVersion: 2 },
      { schemaVersion: 1, surprise: true },
      { schemaVersion: 1, aliases: { Upper: {} } },
      { schemaVersion: 1, aliases: { plans: { extra: true } } },
      { schemaVersion: 1, aliases: { plans: { filters: [{ kind: "exists", path: "status", extra: true }] } } },
      { schemaVersion: 1, priorityRules: [{ id: "empty", tier: 1 }] },
      { schemaVersion: 1, priorityRules: [{ id: "bad-path", tier: 1, pathPrefix: "../plans" }] },
      { schemaVersion: 1, priorityRules: [{ id: "bad-tier", tier: 0, pathPrefix: "plans/" }] },
      {
        schemaVersion: 1,
        priorityRules: [
          { id: "same", tier: 1, pathPrefix: "plans/" },
          { id: "same", tier: 2, pathPrefix: "notes/" },
        ],
      },
      { schemaVersion: 1, aliases: { huge: { query: "x".repeat(16 * 1_024 + 1) } } },
    ]) {
      expect(() => parseSearchRules(input)).toThrow();
    }
  });
});

describe("search alias expansion", () => {
  test("adds constraints conjunctively while preserving an explicit caller mode", () => {
    const callerFilter = { kind: "exists", path: "owner" } as const;
    const expanded = expandSearchRequest({
      query: "@plans migration",
      mode: "semantic",
      filters: [callerFilter],
      tags: ["caller"],
      repositoryScopes: ["apps/web"],
      limit: 7,
    }, configuredRules());

    expect(expanded.alias).toBe("plans");
    expect(expanded.request).toEqual({
      query: "implementation plan migration",
      mode: "semantic",
      filters: [
        callerFilter,
        { kind: "equals", path: "status", value: "in-progress" },
        { kind: "one-of", path: "repository_scopes", values: ["packages/kb"] },
      ],
      tags: ["caller", "planning"],
      repositoryScopes: ["apps/web"],
      limit: 7,
    });
  });

  test("uses alias mode only by default and interprets at most one leading alias", () => {
    expect(expandSearchRequest({ query: "@plans roadmap" }, configuredRules()).request.mode)
      .toBe("keyword");
    expect(() => expandSearchRequest({ query: "@missing roadmap" }, configuredRules()))
      .toThrow("Unknown search alias");
    expect(() => expandSearchRequest({ query: "@plans @other roadmap" }, configuredRules()))
      .toThrow("only one leading");
  });

  test("leaves default and non-aliased requests byte-for-byte and reference unchanged", () => {
    const request = { query: "@literal remains text", tags: ["caller"] } as const;
    expect(expandSearchRequest(request, EMPTY_SEARCH_RULES)).toEqual({ request, alias: null });
    expect(expandSearchRequest(request, EMPTY_SEARCH_RULES).request).toBe(request);

    const ordinary = { query: "ordinary query", mode: "exact" as const };
    expect(expandSearchRequest(ordinary, configuredRules()).request).toBe(ordinary);
  });

  test("never removes caller-authored constraints", () => {
    fc.assert(fc.property(
      fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/u), { maxLength: 20 }),
      fc.array(fc.stringMatching(/^apps\/[a-z][a-z0-9-]{0,12}$/u), { maxLength: 20 }),
      fc.constantFrom("exact", "hybrid", "keyword", "semantic"),
      (tags, scopes, mode) => {
        const filters = tags.map((tag) => ({ kind: "equals" as const, path: "owner", value: tag }));
        const expanded = expandSearchRequest({
          query: "@plans evidence",
          mode,
          filters,
          tags,
          repositoryScopes: scopes,
        }, configuredRules()).request;

        expect(expanded.mode).toBe(mode);
        expect(expanded.filters?.slice(0, filters.length)).toEqual(filters);
        expect(expanded.tags?.slice(0, tags.length)).toEqual(tags);
        expect(expanded.repositoryScopes?.slice(0, scopes.length)).toEqual(scopes);
      },
    ));
  });
});

describe("search priority rules", () => {
  const hit = (
    id: string,
    path: string,
    options: Partial<SearchRuleHit> = {},
  ): SearchRuleHit => ({
    id,
    path,
    identity: false,
    tags: [],
    metadata: {},
    ...options,
  });

  test("keeps exact identity first and reorders only supplied hits by tier", () => {
    const first = hit("first", "notes/first.md", {
      metadata: { record: { role: "maintained" } },
    });
    const promoted = hit("promoted", "plans/hra.md", {
      tags: ["Priority", "hra"],
      metadata: { status: "ACTIVE", repository_scopes: ["projects/hra"] },
    });
    const ordinary = hit("ordinary", "notes/ordinary.md");
    const identity = hit("identity", "plans/exact.md", { identity: true });
    const supplied = [first, promoted, ordinary, identity] as const;
    const result = prioritizeSearchHits(supplied, configuredRules(), {
      vaultId: "hraness/jungle",
    });

    expect(result.hits).toEqual([identity, promoted, first, ordinary]);
    expect(new Set(result.hits)).toEqual(new Set(supplied));
    expect(result.trace).toEqual([
      { id: "identity", relevanceRank: 4, matchedRuleIds: [], tier: null },
      { id: "promoted", relevanceRank: 2, matchedRuleIds: ["active-hra-plan"], tier: 1 },
      { id: "first", relevanceRank: 1, matchedRuleIds: ["maintained-note"], tier: 2 },
      { id: "ordinary", relevanceRank: 3, matchedRuleIds: [], tier: null },
    ]);
    expect(result.hits[1]).toBe(promoted);
  });

  test("leaves no-rule and no-match ordering unchanged", () => {
    const supplied = [hit("one", "one.md"), hit("two", "two.md")] as const;
    expect(prioritizeSearchHits(supplied, EMPTY_SEARCH_RULES).hits).toBe(supplied);
    expect(prioritizeSearchHits(supplied, configuredRules()).hits).toBe(supplied);
  });

  test("is deterministic, preserves the supplied multiset, and never demotes identity", () => {
    fc.assert(fc.property(
      fc.uniqueArray(fc.record({
        id: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/u),
        tier: fc.option(fc.integer({ min: 1, max: 4 }), { nil: null }),
        identity: fc.boolean(),
      }), { selector: ({ id }) => id, maxLength: 60 }),
      (rows) => {
        const rules = parseSearchRules({
          schemaVersion: 1,
          priorityRules: [1, 2, 3, 4].map((tier) => ({
            id: `tier-${tier}`,
            tier,
            metadata: [{ kind: "equals", path: "tier", value: tier }],
          })),
        });
        const supplied = rows.map(({ id, tier, identity }) => hit(id, `notes/${id}.md`, {
          identity,
          metadata: tier === null ? {} : { tier },
        }));
        const first = prioritizeSearchHits(supplied, rules);
        const second = prioritizeSearchHits(supplied, rules);

        expect(first).toEqual(second);
        expect(first.hits.map(({ id }) => id).toSorted()).toEqual(
          supplied.map(({ id }) => id).toSorted(),
        );
        const firstNonIdentity = first.hits.findIndex(({ identity }) => !identity);
        if (firstNonIdentity >= 0) {
          expect(first.hits.slice(firstNonIdentity).some(({ identity }) => identity)).toBe(false);
        }
        for (let index = 1; index < first.trace.length; index += 1) {
          const previous = first.trace[index - 1];
          const current = first.trace[index];
          if (previous === undefined || current === undefined) continue;
          const previousHit = first.hits[index - 1];
          const currentHit = first.hits[index];
          if (previousHit?.identity !== currentHit?.identity) continue;
          const previousTier = previous.tier ?? Number.POSITIVE_INFINITY;
          const currentTier = current.tier ?? Number.POSITIVE_INFINITY;
          expect(
            previousTier < currentTier
              || (previousTier === currentTier
                && previous.relevanceRank <= current.relevanceRank),
          ).toBe(true);
        }
      },
    ));
  });
});
