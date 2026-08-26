import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { QueryRow } from "./query.js";
import type {
  KnowledgeBaseSearchHit,
  KnowledgeBaseSearchOptions,
  KnowledgeBaseSearchResult,
  KnowledgeBaseSearchRuleApplication,
  KnowledgeBaseSession,
  OpenKnowledgeBaseOptions,
} from "./sdk.js";
import {
  openKnowledgePortfolio,
  PortfolioOpenError,
  PortfolioSearchError,
  type PortfolioDependencies,
} from "./portfolio.js";
import { parsePortfolioRegistry, type PortfolioRegistryV1 } from "./portfolio-registry.js";
import { parseSearchRules } from "./search-rules.js";

type FakeSessionOptions = {
  readonly documentId?: string;
  readonly localScore?: number;
  readonly path?: string;
  readonly searchError?: Error;
  readonly truncated?: boolean;
  readonly resultMode?: KnowledgeBaseSearchResult["mode"];
  readonly rules?: KnowledgeBaseSearchRuleApplication;
  readonly onSearch?: (query: string, mode: string | undefined) => void;
  readonly onSearchOptions?: (options: KnowledgeBaseSearchOptions) => void;
  readonly onClose?: () => void;
};

function registry(): PortfolioRegistryV1 {
  return parsePortfolioRegistry({
    contract: "hraness.kb-portfolio/v1",
    schemaVersion: 1,
    vaults: [
      {
        owner: "hraness",
        id: "alpha",
        repository: "hraness/alpha",
        checkout: "alpha-checkout",
        root: "kb",
        role: "repository",
        visibility: "organization",
        defaultRef: "main",
        parserVersion: 1,
      },
      {
        owner: "hraness",
        id: "beta",
        repository: "hraness/beta",
        checkout: "beta-checkout",
        root: "kb",
        role: "repository",
        visibility: "public",
        parserVersion: 1,
      },
      {
        owner: "personal",
        id: "tiff",
        repository: "personal/tiff",
        checkout: "private-tiff",
        root: "kb",
        role: "portfolio",
        visibility: "personal",
        parserVersion: 1,
      },
    ],
  });
}

function queryRow(path: string, documentId: string | undefined): QueryRow {
  return {
    id: path.slice(0, -3),
    path,
    title: "Shared title",
    aliases: [],
    tags: ["portfolio"],
    properties: {},
    metadata: documentId === undefined ? {} : { document_id: documentId },
    summary: "A portfolio result.",
    inboundContextualCount: 0,
    outboundContextualCount: 0,
    backlinks: [],
  };
}

function searchHit(row: QueryRow, score: number): KnowledgeBaseSearchHit {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    rank: 1,
    score,
    identity: false,
    snippet: row.summary,
    tags: row.tags,
    metadata: row.metadata,
    evidence: [{
      kind: "exact",
      rank: 1,
      identity: false,
      matches: [{ kind: "term", field: "content", value: "portfolio" }],
    }],
    contributions: [{ lane: "exact", rank: 1, weight: 1, value: score }],
  };
}

function fakeSession(root: string, options: FakeSessionOptions = {}): KnowledgeBaseSession {
  const path = options.path ?? "notes/shared.md";
  const row = queryRow(path, options.documentId);
  const hit = searchHit(row, options.localScore ?? 0.5);
  let closed = false;
  return {
    root,
    repository: root.slice(0, -3),
    noteCount: 1,
    grep: () => [],
    list: () => [row],
    read: () => ({
      id: row.id,
      path: row.path,
      title: row.title,
      content: `# ${row.title}\n\nPortfolio bytes.\n`,
      truncated: options.truncated ?? false,
    }),
    links: () => {
      throw new Error("not used");
    },
    backlinks: () => {
      throw new Error("not used");
    },
    search: (searchOptions: KnowledgeBaseSearchOptions): Promise<KnowledgeBaseSearchResult> => {
      const { query, mode } = searchOptions;
      options.onSearch?.(query, mode);
      options.onSearchOptions?.(searchOptions);
      if (options.searchError !== undefined) return Promise.reject(options.searchError);
      return Promise.resolve({
        query,
        mode: options.resultMode ?? mode ?? "hybrid",
        results: [hit],
        graph: null,
        history: null,
        partial: false,
        ...(options.rules === undefined ? {} : { rules: options.rules }),
        diagnostics: {
          notes: 1,
          model: mode === "exact" ? null : "fixture-model",
          elapsedMs: 1,
          lanes: [{ lane: "exact", status: "ready", results: 1 }],
        },
      });
    },
    history: () => Promise.resolve({ status: "ready", notes: [], limitedCommits: [] }),
    searchHistory: () => Promise.resolve({ status: "ready", query: "", results: [] }),
    close: () => {
      if (!closed) options.onClose?.();
      closed = true;
      return Promise.resolve();
    },
  } as unknown as KnowledgeBaseSession;
}

function dependencies(
  sessions: Readonly<Record<string, KnowledgeBaseSession | Error>>,
  observed: string[] = [],
): PortfolioDependencies {
  const parsed = registry();
  return {
    loadPortfolioRegistry: () => Promise.resolve(parsed),
    resolvePortfolioVault: (entry) => {
      observed.push(`resolve:${entry.key}`);
      return Promise.resolve({
        entry,
        repositoryRoot: `/workspace/${entry.checkout}`,
        root: `/workspace/${entry.checkout}/${entry.root}`,
      });
    },
    indexGitHistory: (options) => Promise.resolve({
      status: "ready",
      repository: options.repository,
      root: options.root,
      vaultPrefix: "kb",
      head: "a".repeat(40),
      scannedCommits: 0,
      notes: [],
    }),
    openKnowledgeBase: (options: OpenKnowledgeBaseOptions) => {
      observed.push(`open:${options.root}`);
      const session = sessions[options.root];
      return session instanceof Error
        ? Promise.reject(session)
        : session === undefined
          ? Promise.reject(new Error("Unexpected vault root."))
          : Promise.resolve(session);
    },
  };
}

describe("knowledge portfolio", () => {
  test("federates real read-only knowledge-base sessions through the registry boundary", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-portfolio-e2e-"));
    const registryPath = join(temporary, "kb-portfolio.json");
    for (const id of ["alpha", "beta"]) {
      const root = join(temporary, `${id}-checkout`, "kb");
      await mkdir(join(root, "notes"), { recursive: true });
      await writeFile(join(root, "index.md"), "# Knowledge base\n", "utf8");
      await writeFile(join(root, "notes", `${id}.md`), [
        "---",
        `document_id: ${id}-document`,
        "---",
        `# ${id}`,
        "",
        `${id} has the ${id}-only-signal-8421 federation phrase.`,
      ].join("\n"), "utf8");
    }
    await writeFile(registryPath, JSON.stringify({
      contract: "hraness.kb-portfolio/v1",
      schemaVersion: 1,
      vaults: [
        {
          owner: "hraness",
          id: "alpha",
          repository: "hraness/alpha",
          checkout: "alpha-checkout",
          root: "kb",
          role: "repository",
          visibility: "organization",
          parserVersion: 1,
        },
        {
          owner: "hraness",
          id: "beta",
          repository: "hraness/beta",
          checkout: "beta-checkout",
          root: "kb",
          role: "repository",
          visibility: "public",
          parserVersion: 1,
        },
      ],
    }), "utf8");
    try {
      const portfolio = await openKnowledgePortfolio({
        registryPath,
        workspaceRoot: temporary,
        authorizedVaults: ["hraness/alpha", "hraness/beta"],
      }, {
        indexGitHistory: (options) => Promise.resolve({
          status: "ready",
          repository: options.repository,
          root: options.root,
          vaultPrefix: "kb",
          head: "c".repeat(40),
          scannedCommits: 0,
          notes: [],
        }),
      });
      try {
        const result = await portfolio.search({ query: "beta-only-signal-8421", mode: "exact" });
        expect(result.results.map(({ vault }) => vault.key)).toEqual(["hraness/beta"]);
        expect(portfolio.read("kb://hraness/beta/beta-document").content).toContain(
          "beta-only-signal-8421 federation phrase",
        );
      } finally {
        await portfolio.close();
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("keeps identical local paths distinct and merges by local rank, not backend score", async () => {
    const alpha = fakeSession("/workspace/alpha-checkout/kb", {
      documentId: "alpha-document",
      localScore: 0.01,
    });
    const beta = fakeSession("/workspace/beta-checkout/kb", {
      documentId: "beta-document",
      localScore: 0.99,
    });
    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha", "hraness/beta"],
    }, dependencies({
      "/workspace/alpha-checkout/kb": alpha,
      "/workspace/beta-checkout/kb": beta,
    }));
    try {
      const result = await portfolio.search({ query: "portfolio", mode: "hybrid" });
      expect(result.results.map(({ identity }) =>
        identity.kind === "stable" ? identity.uri : identity.path)).toEqual([
        "kb://hraness/alpha/alpha-document",
        "kb://hraness/beta/beta-document",
      ]);
      expect(result.results.map(({ score }) => score)).toEqual([1 / 61, 1 / 61]);
      expect(result.results[0]?.repository).toEqual({
        id: "hraness/alpha",
        defaultRef: "main",
        head: "a".repeat(40),
      });
      expect(result.results[0]?.revision).toEqual({
        complete: true,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      });
    } finally {
      await portfolio.close();
    }
  });

  test("routes a qualified identity to exactly one vault and uses exact retrieval", async () => {
    const searches: string[] = [];
    const alpha = fakeSession("/workspace/alpha-checkout/kb", {
      documentId: "alpha-document",
      onSearch: (query, mode) => searches.push(`alpha:${query}:${mode}`),
    });
    const beta = fakeSession("/workspace/beta-checkout/kb", {
      documentId: "beta-document",
      onSearch: (query, mode) => searches.push(`beta:${query}:${mode}`),
    });
    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha", "hraness/beta"],
    }, dependencies({
      "/workspace/alpha-checkout/kb": alpha,
      "/workspace/beta-checkout/kb": beta,
    }));
    try {
      const result = await portfolio.search({
        query: "kb://hraness/beta/beta-document",
        mode: "hybrid",
      });
      expect(searches).toEqual(["beta:notes/shared:exact"]);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.exactIdentity).toBe(true);
      expect(result.mode).toBe("exact");
    } finally {
      await portfolio.close();
    }
  });

  test("constrains qualified lookup by stable ID and rejects local ID collisions", async () => {
    const observed: KnowledgeBaseSearchOptions[] = [];
    const selected = fakeSession("/workspace/alpha-checkout/kb", {
      documentId: "human-slug",
      onSearchOptions: (options) => observed.push(options),
    });
    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
    }, dependencies({ "/workspace/alpha-checkout/kb": selected }));
    try {
      const result = await portfolio.search({
        query: "kb://hraness/alpha/human-slug",
        mode: "hybrid",
        filters: [{ kind: "equals", path: "status", value: "active" }],
      });
      expect(result.results).toHaveLength(1);
      expect(observed).toEqual([expect.objectContaining({
        query: "notes/shared",
        mode: "exact",
        filters: [
          { kind: "equals", path: "status", value: "active" },
          { kind: "equals", path: "document_id", value: "human-slug" },
        ],
      })]);
    } finally {
      await portfolio.close();
    }

    const first = queryRow("notes/first.md", "collision");
    const second = queryRow("notes/second.md", "collision");
    const base = fakeSession("/workspace/alpha-checkout/kb", { documentId: "collision" });
    const colliding = { ...base, list: () => [first, second] } as KnowledgeBaseSession;
    const ambiguous = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
    }, dependencies({ "/workspace/alpha-checkout/kb": colliding }));
    try {
      await expect(ambiguous.search({ query: "kb://hraness/alpha/collision" }))
        .rejects.toThrow("ambiguous");
    } finally {
      await ambiguous.close();
    }
  });

  test("reports alias-selected effective mode and preserves per-vault rule traces", async () => {
    const rules: KnowledgeBaseSearchRuleApplication = {
      alias: "active",
      effectiveQuery: "active plan",
    };
    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
    }, dependencies({
      "/workspace/alpha-checkout/kb": fakeSession("/workspace/alpha-checkout/kb", {
        resultMode: "exact",
        rules,
      }),
    }));
    try {
      const result = await portfolio.search({ query: "@active" });
      expect(result.mode).toBe("exact");
      expect(result.diagnostics.vaults[0]?.rules).toEqual(rules);
    } finally {
      await portfolio.close();
    }
  });

  test("does not resolve, open, report, or search an unauthorized personal vault", async () => {
    const observed: string[] = [];
    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
    }, dependencies({
      "/workspace/alpha-checkout/kb": fakeSession("/workspace/alpha-checkout/kb"),
    }, observed));
    try {
      const result = await portfolio.search({ query: "portfolio", mode: "exact" });
      expect(observed.join("\n")).not.toContain("tiff");
      expect(JSON.stringify(result)).not.toContain("tiff");
      expect(portfolio.selectedVaultCount).toBe(1);
    } finally {
      await portfolio.close();
    }
  });

  test("uses a caller-selected registry snapshot without reloading or remapping authorization", async () => {
    let reloads = 0;
    const observed: string[] = [];
    const selectedRegistry = registry();
    const deps: PortfolioDependencies = {
      ...dependencies({
        "/workspace/alpha-checkout/kb": fakeSession("/workspace/alpha-checkout/kb"),
      }, observed),
      loadPortfolioRegistry: () => {
        reloads += 1;
        return Promise.reject(new Error("registry must not be reloaded"));
      },
    };
    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      registry: selectedRegistry,
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
    }, deps);
    await portfolio.close();

    expect(reloads).toBe(0);
    expect(observed).toContain("resolve:hraness/alpha");
    expect(observed).toContain("open:/workspace/alpha-checkout/kb");
    expect(observed.join("\n")).not.toContain("private-tiff");
  });

  test("returns successful results with selected-vault diagnostics under partial policy", async () => {
    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha", "hraness/beta"],
      failurePolicy: "partial",
    }, dependencies({
      "/workspace/alpha-checkout/kb": fakeSession("/workspace/alpha-checkout/kb", {
        documentId: "alpha-document",
      }),
      "/workspace/beta-checkout/kb": fakeSession("/workspace/beta-checkout/kb", {
        searchError: new Error("beta search unavailable"),
      }),
    }));
    try {
      const result = await portfolio.search({ query: "portfolio", mode: "exact" });
      expect(result.results).toHaveLength(1);
      expect(result.partial).toBe(true);
      expect(result.diagnostics.vaults).toContainEqual(expect.objectContaining({
        vault: expect.objectContaining({ key: "hraness/beta" }),
        status: "unavailable",
        message: "beta search unavailable",
      }));
    } finally {
      await portfolio.close();
    }
  });

  test("rejects common caller and alias errors even when no vault is available", async () => {
    const configured = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
      knowledgeBase: {
        searchRules: parseSearchRules({
          schemaVersion: 1,
          aliases: { exact: { query: "identity", mode: "exact" } },
          priorityRules: [],
        }),
      },
    }, {
      ...dependencies({}),
      resolvePortfolioVault: () => Promise.reject(new Error("offline")),
    });
    try {
      await expect(configured.search({ query: "@missing" })).rejects.toThrow("Unknown search alias");
      await expect(configured.search({ query: "@exact", minScore: 0.5 })).rejects.toThrow(
        "minimum score applies only",
      );
      await expect(configured.search({
        query: "valid",
        mode: "invalid" as unknown as NonNullable<KnowledgeBaseSearchOptions["mode"]>,
      })).rejects.toThrow("mode must be");
      await expect(configured.search({
        query: "valid",
        history: { policy: "invalid" } as unknown as NonNullable<KnowledgeBaseSearchOptions["history"]>,
      })).rejects.toThrow('Search history policy must be "auto" or "required"');
    } finally {
      await configured.close();
    }
  });

  test("rejects invalid history before a live partial-policy vault search", async () => {
    let searches = 0;
    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
      failurePolicy: "partial",
    }, dependencies({
      "/workspace/alpha-checkout/kb": fakeSession("/workspace/alpha-checkout/kb", {
        onSearch: () => {
          searches += 1;
        },
      }),
    }));
    try {
      await expect(portfolio.search({
        query: "valid",
        history: { policy: "invalid" } as unknown as NonNullable<KnowledgeBaseSearchOptions["history"]>,
      })).rejects.toThrow('Search history policy must be "auto" or "required"');
      expect(searches).toBe(0);
    } finally {
      await portfolio.close();
    }
  });

  test("fails a search when a required selected vault fails", async () => {
    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha", "hraness/beta"],
      failurePolicy: "required",
    }, dependencies({
      "/workspace/alpha-checkout/kb": fakeSession("/workspace/alpha-checkout/kb"),
      "/workspace/beta-checkout/kb": fakeSession("/workspace/beta-checkout/kb", {
        searchError: new Error("offline"),
      }),
    }));
    try {
      await expect(portfolio.search({ query: "portfolio", mode: "exact" })).rejects.toBeInstanceOf(
        PortfolioSearchError,
      );
    } finally {
      await portfolio.close();
    }
  });

  test("closes earlier sessions when required open fails and keeps close idempotent", async () => {
    let closes = 0;
    const deps = dependencies({
      "/workspace/alpha-checkout/kb": fakeSession("/workspace/alpha-checkout/kb", {
        onClose: () => {
          closes += 1;
        },
      }),
      "/workspace/beta-checkout/kb": new Error("open failed"),
    });
    await expect(openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha", "hraness/beta"],
      failurePolicy: "required",
    }, deps)).rejects.toBeInstanceOf(PortfolioOpenError);
    expect(closes).toBe(1);

    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
    }, dependencies({
      "/workspace/alpha-checkout/kb": fakeSession("/workspace/alpha-checkout/kb", {
        onClose: () => {
          closes += 1;
        },
      }),
    }));
    await Promise.all([portfolio.close(), portfolio.close()]);
    expect(closes).toBe(2);
    expect(() => portfolio.read("kb://hraness/alpha/alpha-document")).toThrow("closed");
  });

  test("reads stable qualified IDs and rejects legacy-only or ambiguous IDs", async () => {
    const portfolio = await openKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
    }, dependencies({
      "/workspace/alpha-checkout/kb": fakeSession("/workspace/alpha-checkout/kb", {
        documentId: "alpha-document",
      }),
    }));
    try {
      const result = portfolio.read("kb://hraness/alpha/alpha-document");
      expect(result.identity.stable).toBe(true);
      expect(result.content).toContain("Portfolio bytes");
      expect(() => portfolio.read("kb://hraness/alpha/missing-document")).toThrow(
        "not available",
      );
      expect(() => portfolio.read("kb://personal/tiff/secret-document")).toThrow(
        "not available",
      );
    } finally {
      await portfolio.close();
    }
  });
});
