import { describe, expect, test } from "bun:test";

import {
  documentIdState,
  formatQualifiedDocumentUri,
  parseDocumentId,
  parseQualifiedDocumentUri,
  parseVaultKey,
  portfolioDocumentIdentity,
  portfolioVaultIdentity,
} from "./portfolio-identity.js";

describe("portfolio document identity", () => {
  test("keeps logical vault identity independent from physical checkout names", () => {
    const vault = portfolioVaultIdentity("example", "product-history");
    expect(vault).toEqual({
      owner: "example",
      id: "product-history",
      key: "example/product-history",
    });
    expect(parseVaultKey("example/product-history")).toEqual(vault);
  });

  test("round-trips canonical stable URIs", () => {
    const uri = formatQualifiedDocumentUri(
      portfolioVaultIdentity("hraness", "kb"),
      "018f4b20-7c95-7af2-a11f-89011baf1137",
    );
    expect(uri).toBe("kb://hraness/kb/018f4b20-7c95-7af2-a11f-89011baf1137");
    expect(parseQualifiedDocumentUri(uri)).toEqual({
      kind: "stable",
      stable: true,
      vault: { owner: "hraness", id: "kb", key: "hraness/kb" },
      documentId: "018f4b20-7c95-7af2-a11f-89011baf1137",
      uri,
    });
  });

  test("rejects normalized, escaped, non-ASCII, and path-derived spellings", () => {
    for (const value of [
      "kb://Hraness/kb/alpha",
      "kb://hraness/kb/alpha%2Fbeta",
      "kb://hraness/kb/alpha/../beta",
      "kb://hraness/kb/é",
      "kb://hraness/kb/-alpha",
      "kb://hraness/kb/alpha-",
    ]) {
      expect(() => parseQualifiedDocumentUri(value)).toThrow();
    }
    expect(() => parseDocumentId("notes/alpha")).toThrow();
    expect(() => parseVaultKey("example/history-vault/extra")).toThrow();
  });

  test("uses a clearly tagged fallback when document_id is absent or invalid", () => {
    const vault = portfolioVaultIdentity("hraness", "kb");
    expect(documentIdState({})).toEqual({ kind: "missing" });
    expect(documentIdState({ document_id: "UPPER" })).toEqual({
      kind: "invalid",
      value: "UPPER",
    });
    expect(documentIdState({ document_id: "alpha", DOCUMENT_ID: "beta" })).toEqual({
      kind: "invalid",
      value: ["alpha", "beta"],
    });
    expect(portfolioDocumentIdentity(vault, "notes/legacy.md", {})).toEqual({
      kind: "legacy-path",
      stable: false,
      vault,
      path: "notes/legacy.md",
    });
  });

  test("stable identity survives a path rename", () => {
    const vault = portfolioVaultIdentity("hraness", "kb");
    const metadata = { document_id: "note-17" } as const;
    expect(portfolioDocumentIdentity(vault, "old/path.md", metadata)).toEqual(
      portfolioDocumentIdentity(vault, "new/path.md", metadata),
    );
  });
});
