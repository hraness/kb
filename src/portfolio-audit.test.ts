import { describe, expect, test } from "bun:test";

import type { AttachmentValidationReport } from "./attachments.js";
import { analyzeVault, parseNote, type Note } from "./graph.js";
import {
  auditKnowledgePortfolio,
  type PortfolioAuditDependencies,
} from "./portfolio-audit.js";
import {
  parsePortfolioRegistry,
  type PortfolioRegistryV1,
  type PortfolioVaultEntry,
} from "./portfolio-registry.js";
import type { VaultSnapshot } from "./vault.js";

function vaultEntry(
  owner: string,
  id: string,
  role: "archive" | "portfolio" | "repository" = "repository",
  visibility: "organization" | "personal" | "public" = "organization",
): Readonly<Record<string, unknown>> {
  return {
    owner,
    id,
    repository: `${owner}/${id}`,
    checkout: `${owner}-${id}`,
    root: "kb",
    role,
    visibility,
    parserVersion: 1,
  };
}

function registry(): PortfolioRegistryV1 {
  return parsePortfolioRegistry({
    contract: "hraness.kb-portfolio/v1",
    schemaVersion: 1,
    vaults: [
      vaultEntry("hraness", "alpha"),
      vaultEntry("hraness", "beta"),
      vaultEntry("personal", "tiff", "portfolio", "personal"),
    ],
    authorityGroups: [{
      id: "vision-authority",
      members: ["hraness/alpha", "hraness/beta"],
      state: "unresolved",
      protected: true,
      reason: "Protected sources require an owner decision.",
    }],
  });
}

function snapshot(root: string, notes: readonly Note[], index: VaultSnapshot["index"] = "current"): VaultSnapshot {
  return {
    root,
    indexPath: `${root}/index.md`,
    catalogMode: "managed",
    index,
    notes,
    analysis: analyzeVault(notes, { mentionScope: () => false }),
  };
}

const sharedLegacySource = "# Protected Vision\n\nExact protected source bytes.\n";

function alphaSnapshot(root: string): VaultSnapshot {
  return snapshot(root, [
    parseNote("notes/first.md", [
      "---",
      "document_id: duplicate-id",
      "relations:",
      "  depends-on: notes/missing",
      "---",
      "# First",
      "",
      "[[notes/missing]]",
    ].join("\n")),
    parseNote("notes/second.md", [
      "---",
      "document_id: duplicate-id",
      "---",
      "# Second",
      "",
      "Different content.",
    ].join("\n")),
    parseNote("notes/invalid.md", [
      "---",
      "document_id: UPPERCASE",
      "---",
      "# Invalid",
    ].join("\n")),
    parseNote("vision/protected.md", sharedLegacySource),
  ], "stale");
}

function betaSnapshot(root: string): VaultSnapshot {
  return snapshot(root, [parseNote("vision/protected-copy.md", sharedLegacySource)]);
}

function emptyAttachments(root: string): AttachmentValidationReport {
  return {
    root,
    references: [],
    attachments: [],
    issues: [],
    truncated: false,
  };
}

function dependencies(
  parsed: PortfolioRegistryV1,
  scans: Readonly<Record<string, VaultSnapshot | Error>>,
  observed: string[] = [],
): PortfolioAuditDependencies {
  return {
    loadPortfolioRegistry: () => Promise.resolve(parsed),
    resolvePortfolioVault: (entry: PortfolioVaultEntry) => {
      observed.push(`resolve:${entry.key}`);
      return Promise.resolve({
        entry,
        repositoryRoot: `/workspace/${entry.checkout}`,
        root: `/workspace/${entry.checkout}/kb`,
      });
    },
    scanVault: (root?: string) => {
      const requestedRoot = root ?? ".";
      observed.push(`scan:${requestedRoot}`);
      const result = scans[requestedRoot];
      return result instanceof Error
        ? Promise.reject(result)
        : result === undefined
          ? Promise.reject(new Error("Unexpected root."))
          : Promise.resolve(result);
    },
    validateMarkdownAttachments: ({ root }) => Promise.resolve(emptyAttachments(root)),
    indexGitHistory: (options) => Promise.resolve({
      status: "ready",
      repository: options.repository,
      root: options.root,
      vaultPrefix: "kb",
      head: "b".repeat(40),
      scannedCommits: 0,
      notes: [],
    }),
  };
}

describe("portfolio audit", () => {
  test("reports stable-ID, graph, duplicate-content, catalog, and unresolved-authority issues without repair", async () => {
    const parsed = registry();
    const alphaRoot = "/workspace/hraness-alpha/kb";
    const betaRoot = "/workspace/hraness-beta/kb";
    const report = await auditKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha", "hraness/beta"],
    }, dependencies(parsed, {
      [alphaRoot]: alphaSnapshot(alphaRoot),
      [betaRoot]: betaSnapshot(betaRoot),
    }));

    expect(report.partial).toBe(false);
    expect(report.notes).toBe(5);
    expect(report.stableDocuments).toBe(2);
    expect(report.legacyDocuments).toBe(3);
    expect(report.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "authority-unresolved",
      "catalog-stale",
      "missing-document-id",
      "invalid-document-id",
      "duplicate-document-id",
      "broken-link",
      "relation",
      "duplicate-content",
    ]));
    expect(report.issues.find(({ code }) => code === "duplicate-content")).toEqual(
      expect.objectContaining({
        severity: "warning",
        protected: true,
        message: expect.stringContaining("no authority was inferred"),
        related: expect.arrayContaining([
          expect.objectContaining({ path: "vision/protected.md" }),
          expect.objectContaining({ path: "vision/protected-copy.md" }),
        ]),
      }),
    );
    expect(report.authority).toEqual([{
      id: "vision-authority",
      state: "unresolved",
      protected: true,
    }]);
    expect(report.vaults.every(({ head }) => head === "b".repeat(40))).toBe(true);
  });

  test("does not resolve, scan, count, or report an unauthorized personal vault", async () => {
    const observed: string[] = [];
    const parsed = registry();
    const alphaRoot = "/workspace/hraness-alpha/kb";
    const report = await auditKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
    }, dependencies(parsed, { [alphaRoot]: alphaSnapshot(alphaRoot) }, observed));
    expect(observed.join("\n")).not.toContain("tiff");
    expect(JSON.stringify(report)).not.toContain("tiff");
    expect(report.selectedVaults).toBe(1);
    expect(report.authority).toEqual([]);
  });

  test("audits the same registry snapshot that produced authorization", async () => {
    const observed: string[] = [];
    let reloads = 0;
    const parsed = registry();
    const alphaRoot = "/workspace/hraness-alpha/kb";
    const deps: PortfolioAuditDependencies = {
      ...dependencies(parsed, { [alphaRoot]: alphaSnapshot(alphaRoot) }, observed),
      loadPortfolioRegistry: () => {
        reloads += 1;
        return Promise.reject(new Error("registry must not be reloaded"));
      },
    };
    const report = await auditKnowledgePortfolio({
      registryPath: "registry.json",
      registry: parsed,
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
    }, deps);

    expect(reloads).toBe(0);
    expect(report.selectedVaults).toBe(1);
    expect(observed.join("\n")).not.toContain("tiff");
  });

  test("resolves canonical cross-vault relations only within the selected audited portfolio", async () => {
    const parsed = registry();
    const alphaRoot = "/workspace/hraness-alpha/kb";
    const betaRoot = "/workspace/hraness-beta/kb";
    const alpha = snapshot(alphaRoot, [parseNote("source.md", [
      "---",
      "document_id: alpha-source",
      "relations:",
      "  supports: kb://hraness/beta/beta-target",
      "---",
      "# Source",
    ].join("\n"))]);
    const beta = snapshot(betaRoot, [parseNote("target.md", [
      "---",
      "document_id: beta-target",
      "---",
      "# Target",
    ].join("\n"))]);

    const resolved = await auditKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha", "hraness/beta"],
    }, dependencies(parsed, { [alphaRoot]: alpha, [betaRoot]: beta }));
    expect(resolved.issues).not.toContainEqual(expect.objectContaining({
      code: "external-relation-unavailable",
    }));

    const observed: string[] = [];
    const unavailable = await auditKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
    }, dependencies(parsed, { [alphaRoot]: alpha }, observed));
    expect(observed.join("\n")).not.toContain("hraness-beta");
    expect(unavailable.issues).toContainEqual(expect.objectContaining({
      code: "external-relation-unavailable",
      vault: expect.objectContaining({ key: "hraness/alpha" }),
      path: "source.md",
      line: 4,
    }));
  });

  test("continues across selected scan failures and marks the bounded report partial", async () => {
    const parsed = registry();
    const alphaRoot = "/workspace/hraness-alpha/kb";
    const betaRoot = "/workspace/hraness-beta/kb";
    const report = await auditKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha", "hraness/beta"],
    }, dependencies(parsed, {
      [alphaRoot]: alphaSnapshot(alphaRoot),
      [betaRoot]: new Error("beta scan failed"),
    }));
    expect(report.partial).toBe(true);
    expect(report.auditedVaults).toBe(1);
    expect(report.unavailableVaults).toBe(1);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "scan-unavailable",
      vault: expect.objectContaining({ key: "hraness/beta" }),
      message: "beta scan failed",
    }));
  });

  test("treats missing stable IDs in archives as advisory and bounds issue materialization", async () => {
    const parsed = parsePortfolioRegistry({
      contract: "hraness.kb-portfolio/v1",
      schemaVersion: 1,
      vaults: [vaultEntry("hraness", "archive", "archive")],
    });
    const root = "/workspace/hraness-archive/kb";
    const report = await auditKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/archive"],
      maxIssues: 1,
    }, dependencies(parsed, {
      [root]: snapshot(root, [
        parseNote("one.md", "# One\n"),
        parseNote("two.md", "# Two\n"),
      ]),
    }));
    expect(report.truncated).toBe(true);
    expect(report.partial).toBe(true);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toEqual(expect.objectContaining({
      code: "missing-document-id",
      severity: "advisory",
    }));
    expect(report.counts.advisory).toBe(2);
  });

  test("counts errors discovered after the materialized issue limit", async () => {
    const parsed = parsePortfolioRegistry({
      contract: "hraness.kb-portfolio/v1",
      schemaVersion: 1,
      vaults: [vaultEntry("hraness", "alpha")],
    });
    const root = "/workspace/hraness-alpha/kb";
    const report = await auditKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha"],
      maxIssues: 1,
    }, dependencies(parsed, {
      [root]: snapshot(root, [parseNote("source.md", "# Source\n\n[[missing]]\n")]),
    }));

    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toEqual(expect.objectContaining({
      code: "broken-link",
      severity: "error",
    }));
    expect(report.truncated).toBe(true);
    expect(report.counts.warning).toBe(1);
    expect(report.counts.error).toBe(1);
  });

  test("fails closed on overlapping selected roots instead of double-auditing content", async () => {
    const parsed = registry();
    const deps = dependencies(parsed, {});
    const overlapDependencies: PortfolioAuditDependencies = {
      ...deps,
      resolvePortfolioVault: (entry) => Promise.resolve({
        entry,
        repositoryRoot: "/workspace/shared",
        root: "/workspace/shared/kb",
      }),
    };
    const report = await auditKnowledgePortfolio({
      registryPath: "registry.json",
      workspaceRoot: "/workspace",
      authorizedVaults: ["hraness/alpha", "hraness/beta"],
    }, overlapDependencies);
    expect(report.auditedVaults).toBe(0);
    expect(report.unavailableVaults).toBe(2);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "root-overlap",
      severity: "error",
    }));
  });
});
