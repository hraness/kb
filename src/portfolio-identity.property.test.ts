import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import {
  formatQualifiedDocumentUri,
  parseQualifiedDocumentUri,
  portfolioVaultIdentity,
} from "./portfolio-identity.js";

const component = fc.stringMatching(/^[a-z0-9](?:[a-z0-9._-]{0,20}[a-z0-9])?$/u);

describe("portfolio identity properties", () => {
  test("canonical qualified URI formatting and parsing are inverses", () => {
    fc.assert(fc.property(component, component, component, (owner, vaultId, documentId) => {
      const vault = portfolioVaultIdentity(owner, vaultId);
      const uri = formatQualifiedDocumentUri(vault, documentId);
      expect(parseQualifiedDocumentUri(uri)).toEqual({
        kind: "stable",
        stable: true,
        vault,
        documentId,
        uri,
      });
    }));
  });

  test("case changes never alias a canonical identity", () => {
    fc.assert(fc.property(component, component, component, (owner, vaultId, documentId) => {
      const uri = formatQualifiedDocumentUri(
        portfolioVaultIdentity(owner, vaultId),
        documentId,
      );
      const changed = uri.replace(/[a-z]/u, (character) => character.toUpperCase());
      if (changed !== uri) expect(() => parseQualifiedDocumentUri(changed)).toThrow();
    }));
  });
});
