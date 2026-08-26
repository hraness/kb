import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_AUTHORIZED_VAULTS,
  MAX_PORTFOLIO_REGISTRY_BYTES,
  loadPortfolioRegistry,
  parsePortfolioRegistry,
  resolveAuthorizedVaults,
  resolvePortfolioVault,
  selectAuthorizedVaults,
} from "./portfolio-registry.js";

function entry(
  id: string,
  checkout = id,
  root = "kb",
): Readonly<Record<string, unknown>> {
  return {
    owner: "hraness",
    id,
    repository: `hraness/${id}`,
    checkout,
    root,
    role: "repository",
    visibility: "organization",
    defaultRef: "main",
    parserVersion: 1,
  };
}

function registry(vaults: readonly unknown[]): Readonly<Record<string, unknown>> {
  return {
    contract: "hraness.kb-portfolio/v1",
    schemaVersion: 1,
    vaults,
  };
}

describe("portfolio registry", () => {
  test("parses explicit logical IDs without deriving them from checkout paths", () => {
    const parsed = parsePortfolioRegistry(registry([
      {
        ...entry("stripedex", "stripe-history"),
        repository: "hraness/stripedex",
      },
    ]));
    expect(parsed.vaults[0]).toEqual(expect.objectContaining({
      key: "hraness/stripedex",
      repository: "hraness/stripedex",
      checkout: "stripe-history",
    }));
  });

  test("rejects unknown fields, unsupported parsers, unsafe paths, and duplicate keys", () => {
    expect(() => parsePortfolioRegistry({ ...registry([]), secret: "no" })).toThrow("unknown property");
    expect(() => parsePortfolioRegistry(registry([{ ...entry("alpha"), parserVersion: 2 }]))).toThrow(
      "parserVersion",
    );
    expect(() => parsePortfolioRegistry(registry([entry("alpha", "../alpha")]))).toThrow(
      "parent segments",
    );
    expect(() => parsePortfolioRegistry(registry([entry("alpha"), entry("alpha", "other")]))).toThrow(
      "unique",
    );
  });

  test("validates explicit authority state instead of inferring a canonical vault", () => {
    const parsed = parsePortfolioRegistry({
      ...registry([entry("hra"), entry("hra-v0"), entry("oprte")]),
      authorityGroups: [{
        id: "hra-oprte",
        members: ["hraness/hra", "hraness/hra-v0", "hraness/oprte"],
        state: "unresolved",
        protected: true,
        reason: "Owner decision is still required.",
      }],
    });
    expect(parsed.authorityGroups[0]).toEqual(expect.objectContaining({
      state: "unresolved",
      protected: true,
    }));
    expect(() => parsePortfolioRegistry({
      ...registry([entry("hra"), entry("oprte")]),
      authorityGroups: [{
        id: "hra-oprte",
        members: ["hraness/hra", "hraness/oprte"],
        state: "unresolved",
        canonical: "hraness/hra",
      }],
    })).toThrow("must not declare");
  });

  test("requires a bounded, unique, explicit authorization set without listing alternatives", () => {
    const parsed = parsePortfolioRegistry(registry([entry("alpha"), entry("tiff")]));
    expect(selectAuthorizedVaults(parsed, ["hraness/alpha"])).toHaveLength(1);
    expect(() => selectAuthorizedVaults(parsed, [])).toThrow("1 through");
    expect(() => selectAuthorizedVaults(parsed, ["hraness/alpha", "hraness/alpha"])).toThrow(
      "duplicates",
    );
    expect(() => selectAuthorizedVaults(parsed, ["hraness/missing"])).toThrow(
      '"hraness/missing" is not available',
    );
    expect(() => selectAuthorizedVaults(
      parsed,
      Array.from({ length: MAX_AUTHORIZED_VAULTS + 1 }, (_, index) =>
        `hraness/vault-${index}` as `hraness/${string}`),
    )).toThrow("1 through");
  });

  test("resolves only authorized roots and never touches a denied personal checkout", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-registry-"));
    try {
      await mkdir(join(temporary, "alpha", "kb"), { recursive: true });
      const parsed = parsePortfolioRegistry(registry([
        entry("alpha"),
        { ...entry("tiff", "missing-personal"), visibility: "personal" },
      ]));
      const resolved = await resolveAuthorizedVaults(
        parsed,
        temporary,
        ["hraness/alpha"],
      );
      expect(resolved).toHaveLength(1);
      expect(resolved[0]?.entry.key).toBe("hraness/alpha");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("rejects symlinked and overlapping selected roots", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-registry-"));
    try {
      await mkdir(join(temporary, "repository", "kb", "nested"), { recursive: true });
      await symlink(join(temporary, "repository"), join(temporary, "linked"));
      const linked = parsePortfolioRegistry(registry([entry("linked", "linked")]));
      await expect(resolvePortfolioVault(linked.vaults[0]!, temporary)).rejects.toThrow("symbolic link");

      const overlapping = parsePortfolioRegistry(registry([
        entry("outer", "repository", "kb"),
        entry("inner", "repository", "kb/nested"),
      ]));
      await expect(resolveAuthorizedVaults(
        overlapping,
        temporary,
        ["hraness/outer", "hraness/inner"],
      )).rejects.toThrow("overlap");
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test("loads only bounded JSON bytes through the injectable file boundary", async () => {
    let observedLimit = 0;
    const parsed = await loadPortfolioRegistry("registry.json", {
      readRegistryFile: (_path, maximumBytes) => {
        observedLimit = maximumBytes;
        return Promise.resolve(JSON.stringify(registry([])));
      },
    });
    expect(parsed.vaults).toEqual([]);
    expect(observedLimit).toBe(MAX_PORTFOLIO_REGISTRY_BYTES);
    await expect(loadPortfolioRegistry("registry.json", {
      readRegistryFile: () => Promise.resolve("x".repeat(MAX_PORTFOLIO_REGISTRY_BYTES + 1)),
    })).rejects.toThrow("at most");
  });

  test("rejects symlinked registry files at the default read boundary", async () => {
    const temporary = await mkdtemp(join(tmpdir(), "hraness-kb-registry-file-"));
    try {
      const target = join(temporary, "registry.json");
      const linked = join(temporary, "linked.json");
      await writeFile(target, JSON.stringify(registry([])), "utf8");
      await symlink(target, linked);
      await expect(loadPortfolioRegistry(linked)).rejects.toThrow();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
