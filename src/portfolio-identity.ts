import type { MetadataObject, MetadataValue } from "./graph.js";

export const MAX_PORTFOLIO_NAME_BYTES = 64;
export const MAX_DOCUMENT_ID_BYTES = 128;

const namePattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const documentIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const qualifiedUriPattern = /^kb:\/\/([a-z0-9][a-z0-9._-]{0,63})\/([a-z0-9][a-z0-9._-]{0,63})\/([a-z0-9][a-z0-9._-]{0,127})$/u;

export type VaultKey = `${string}/${string}`;
export type QualifiedDocumentUri = `kb://${string}/${string}/${string}`;

export type PortfolioVaultIdentity = {
  readonly owner: string;
  readonly id: string;
  readonly key: VaultKey;
};

export type StablePortfolioDocumentIdentity = {
  readonly kind: "stable";
  readonly stable: true;
  readonly vault: PortfolioVaultIdentity;
  readonly documentId: string;
  readonly uri: QualifiedDocumentUri;
};

export type LegacyPathPortfolioDocumentIdentity = {
  readonly kind: "legacy-path";
  readonly stable: false;
  readonly vault: PortfolioVaultIdentity;
  readonly path: string;
};

export type PortfolioDocumentIdentity =
  | StablePortfolioDocumentIdentity
  | LegacyPathPortfolioDocumentIdentity;

export type DocumentIdState =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly value: MetadataValue }
  | { readonly kind: "valid"; readonly documentId: string };

function boundedAsciiName(value: unknown, label: string): string {
  if (typeof value !== "string" || !namePattern.test(value)) {
    throw new TypeError(
      `${label} must be a canonical lowercase ASCII name using letters, digits, dots, underscores, or hyphens.`,
    );
  }
  if (Buffer.byteLength(value, "utf8") > MAX_PORTFOLIO_NAME_BYTES) {
    throw new RangeError(`${label} must be at most ${MAX_PORTFOLIO_NAME_BYTES} UTF-8 bytes.`);
  }
  return value;
}

/** Parse an explicit logical vault identity. It is never derived from a path or Git remote. */
export function portfolioVaultIdentity(owner: unknown, id: unknown): PortfolioVaultIdentity {
  const checkedOwner = boundedAsciiName(owner, "Portfolio vault owner");
  const checkedId = boundedAsciiName(id, "Portfolio vault ID");
  return Object.freeze({
    owner: checkedOwner,
    id: checkedId,
    key: `${checkedOwner}/${checkedId}` as VaultKey,
  });
}

export function parseVaultKey(value: unknown): PortfolioVaultIdentity {
  if (typeof value !== "string") throw new TypeError("Portfolio vault key must be a string.");
  const separator = value.indexOf("/");
  if (separator < 1 || separator !== value.lastIndexOf("/")) {
    throw new TypeError("Portfolio vault key must have the canonical owner/id form.");
  }
  const identity = portfolioVaultIdentity(value.slice(0, separator), value.slice(separator + 1));
  if (identity.key !== value) {
    throw new TypeError("Portfolio vault key must have the canonical owner/id form.");
  }
  return identity;
}

export function parseDocumentId(value: unknown): string {
  if (typeof value !== "string" || !documentIdPattern.test(value)) {
    throw new TypeError(
      "document_id must be a canonical lowercase ASCII ID using letters, digits, dots, underscores, or hyphens.",
    );
  }
  if (Buffer.byteLength(value, "utf8") > MAX_DOCUMENT_ID_BYTES) {
    throw new RangeError(`document_id must be at most ${MAX_DOCUMENT_ID_BYTES} UTF-8 bytes.`);
  }
  return value;
}

function metadataValues(
  metadata: MetadataObject,
  normalizedName: string,
): readonly MetadataValue[] {
  return Object.entries(metadata)
    .filter(([name]) => name.normalize("NFC").toLocaleLowerCase("en-US") === normalizedName)
    .map(([, value]) => value);
}

/** Inspect authored metadata without converting an invalid or absent ID into a stable identity. */
export function documentIdState(metadata: MetadataObject): DocumentIdState {
  const values = metadataValues(metadata, "document_id");
  if (values.length === 0) return Object.freeze({ kind: "missing" });
  if (values.length !== 1) {
    return Object.freeze({ kind: "invalid", value: Object.freeze([...values]) });
  }
  const value = values[0]!;
  try {
    return Object.freeze({ kind: "valid", documentId: parseDocumentId(value) });
  } catch {
    return Object.freeze({ kind: "invalid", value });
  }
}

export function formatQualifiedDocumentUri(
  vault: Pick<PortfolioVaultIdentity, "owner" | "id">,
  documentId: unknown,
): QualifiedDocumentUri {
  const checkedVault = portfolioVaultIdentity(vault.owner, vault.id);
  const checkedDocumentId = parseDocumentId(documentId);
  return `kb://${checkedVault.owner}/${checkedVault.id}/${checkedDocumentId}` as QualifiedDocumentUri;
}

/** Parse only byte-canonical qualified identities; URL normalization and percent encoding are rejected. */
export function parseQualifiedDocumentUri(value: unknown): StablePortfolioDocumentIdentity {
  if (typeof value !== "string") throw new TypeError("Qualified document URI must be a string.");
  const match = qualifiedUriPattern.exec(value);
  if (match === null) {
    throw new TypeError("Qualified document URI must have canonical kb://owner/vault/document_id form.");
  }
  const vault = portfolioVaultIdentity(match[1], match[2]);
  const documentId = parseDocumentId(match[3]);
  const uri = formatQualifiedDocumentUri(vault, documentId);
  if (uri !== value) {
    throw new TypeError("Qualified document URI must be byte-canonical.");
  }
  return Object.freeze({ kind: "stable", stable: true, vault, documentId, uri });
}

export function portfolioDocumentIdentity(
  vault: Pick<PortfolioVaultIdentity, "owner" | "id">,
  path: string,
  metadata: MetadataObject,
): PortfolioDocumentIdentity {
  const checkedVault = portfolioVaultIdentity(vault.owner, vault.id);
  const state = documentIdState(metadata);
  if (state.kind === "valid") {
    return Object.freeze({
      kind: "stable",
      stable: true,
      vault: checkedVault,
      documentId: state.documentId,
      uri: formatQualifiedDocumentUri(checkedVault, state.documentId),
    });
  }
  return Object.freeze({
    kind: "legacy-path",
    stable: false,
    vault: checkedVault,
    path,
  });
}
