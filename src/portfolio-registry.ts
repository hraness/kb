import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import {
  parseVaultKey,
  portfolioVaultIdentity,
  type PortfolioVaultIdentity,
  type VaultKey,
} from "./portfolio-identity.js";

export const PORTFOLIO_REGISTRY_CONTRACT = "hraness.kb-portfolio/v1";
export const MAX_PORTFOLIO_REGISTRY_BYTES = 1_024 * 1_024;
export const MAX_PORTFOLIO_VAULTS = 128;
export const MAX_AUTHORIZED_VAULTS = 32;
export const MAX_AUTHORITY_GROUPS = 64;
const MAX_PATH_BYTES = 2_048;
const MAX_TEXT_BYTES = 1_024;

export type PortfolioVaultRole =
  | "archive"
  | "portfolio"
  | "repository"
  | "sample"
  | "template";

export type PortfolioVaultVisibility =
  | "organization"
  | "personal"
  | "private"
  | "public";

export type PortfolioVaultEntry = PortfolioVaultIdentity & {
  /** Logical repository identity; it need not equal the checkout directory. */
  readonly repository: VaultKey;
  /** Workspace-relative repository checkout. */
  readonly checkout: string;
  /** Repository-relative vault root. */
  readonly root: string;
  readonly role: PortfolioVaultRole;
  readonly visibility: PortfolioVaultVisibility;
  readonly defaultRef?: string;
  readonly parserVersion: 1;
};

export type PortfolioAuthorityGroup = {
  readonly id: string;
  readonly members: readonly VaultKey[];
  readonly state: "resolved" | "unresolved";
  readonly canonical?: VaultKey;
  readonly protected?: boolean;
  readonly reason?: string;
};

export type PortfolioRegistryV1 = {
  readonly contract: typeof PORTFOLIO_REGISTRY_CONTRACT;
  readonly schemaVersion: 1;
  readonly schema?: string;
  readonly vaults: readonly PortfolioVaultEntry[];
  readonly authorityGroups: readonly PortfolioAuthorityGroup[];
};

export type ResolvedPortfolioVault = {
  readonly entry: PortfolioVaultEntry;
  readonly repositoryRoot: string;
  readonly root: string;
};

type PathMetadata = {
  readonly size: number | bigint;
  readonly nlink: number | bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
};

export type PortfolioRegistryFileDependencies = {
  readonly readRegistryFile?: (path: string, maximumBytes: number) => Promise<string>;
};

export type PortfolioPathDependencies = {
  readonly lstat?: (path: string) => Promise<PathMetadata>;
  readonly realpath?: (path: string) => Promise<string>;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} has unknown property ${JSON.stringify(key)}.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing property ${JSON.stringify(key)}.`);
  }
}

function boundedString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  if (value.normalize("NFC") !== value) throw new TypeError(`${label} must use NFC-normalized text.`);
  if ([...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  })) {
    throw new TypeError(`${label} must not contain control characters.`);
  }
  if (Buffer.byteLength(value, "utf8") > maximum) {
    throw new RangeError(`${label} must be at most ${maximum} UTF-8 bytes.`);
  }
  return value;
}

function registryPath(value: unknown, label: string, allowDot: boolean): string {
  const path = boundedString(value, MAX_PATH_BYTES, label);
  if (path === "." && allowDot) return path;
  if (
    path === ""
    || path === "."
    || path.startsWith("/")
    || path.endsWith("/")
    || path.includes("\\")
  ) {
    throw new TypeError(`${label} must be a canonical relative POSIX path.`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new TypeError(`${label} must not contain empty, dot, or parent segments.`);
  }
  return path;
}

function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new TypeError(`${label} must be one of ${values.map((item) => JSON.stringify(item)).join(", ")}.`);
  }
  return value as T;
}

function parseVaultEntry(value: unknown, index: number): PortfolioVaultEntry {
  const label = `Portfolio vault ${index + 1}`;
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  assertKeys(
    value,
    new Set([
      "owner", "id", "repository", "checkout", "root", "role", "visibility",
      "defaultRef", "parserVersion",
    ]),
    new Set([
      "owner", "id", "repository", "checkout", "root", "role", "visibility",
      "parserVersion",
    ]),
    label,
  );
  const identity = portfolioVaultIdentity(value.owner, value.id);
  const repository = parseVaultKey(value.repository).key;
  if (value.parserVersion !== 1) throw new TypeError(`${label} parserVersion must be exactly 1.`);
  const defaultRef = value.defaultRef === undefined
    ? undefined
    : boundedString(value.defaultRef, MAX_TEXT_BYTES, `${label} defaultRef`);
  if (defaultRef === "") throw new TypeError(`${label} defaultRef must not be empty.`);
  return Object.freeze({
    ...identity,
    repository,
    checkout: registryPath(value.checkout, `${label} checkout`, false),
    root: registryPath(value.root, `${label} root`, true),
    role: enumValue(
      value.role,
      ["archive", "portfolio", "repository", "sample", "template"],
      `${label} role`,
    ),
    visibility: enumValue(
      value.visibility,
      ["organization", "personal", "private", "public"],
      `${label} visibility`,
    ),
    ...(defaultRef === undefined ? {} : { defaultRef }),
    parserVersion: 1,
  });
}

function parseAuthorityGroup(
  value: unknown,
  index: number,
  vaultKeys: ReadonlySet<VaultKey>,
): PortfolioAuthorityGroup {
  const label = `Portfolio authority group ${index + 1}`;
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  assertKeys(
    value,
    new Set(["id", "members", "state", "canonical", "protected", "reason"]),
    new Set(["id", "members", "state"]),
    label,
  );
  const id = portfolioVaultIdentity("authority", value.id).id;
  if (!Array.isArray(value.members) || value.members.length < 2 || value.members.length > MAX_AUTHORIZED_VAULTS) {
    throw new RangeError(`${label} members must contain 2 through ${MAX_AUTHORIZED_VAULTS} vault keys.`);
  }
  const members = value.members.map((member) => parseVaultKey(member).key);
  if (new Set(members).size !== members.length) throw new TypeError(`${label} members must be unique.`);
  for (const member of members) {
    if (!vaultKeys.has(member)) throw new TypeError(`${label} references unknown vault ${JSON.stringify(member)}.`);
  }
  const state = enumValue(value.state, ["resolved", "unresolved"], `${label} state`);
  const canonical = value.canonical === undefined ? undefined : parseVaultKey(value.canonical).key;
  if (state === "resolved") {
    if (canonical === undefined || !members.includes(canonical)) {
      throw new TypeError(`${label} resolved state requires a canonical member.`);
    }
  } else if (canonical !== undefined) {
    throw new TypeError(`${label} unresolved state must not declare a canonical member.`);
  }
  if (value.protected !== undefined && typeof value.protected !== "boolean") {
    throw new TypeError(`${label} protected must be a boolean.`);
  }
  const reason = value.reason === undefined
    ? undefined
    : boundedString(value.reason, MAX_TEXT_BYTES, `${label} reason`);
  if (reason === "") throw new TypeError(`${label} reason must not be empty.`);
  return Object.freeze({
    id,
    members: Object.freeze(members),
    state,
    ...(canonical === undefined ? {} : { canonical }),
    ...(value.protected === undefined ? {} : { protected: value.protected }),
    ...(reason === undefined ? {} : { reason }),
  });
}

/** Parse a foreign JSON value into the strict, bounded v1 portfolio registry contract. */
export function parsePortfolioRegistry(value: unknown): PortfolioRegistryV1 {
  if (!isRecord(value)) throw new TypeError("Portfolio registry must be an object.");
  assertKeys(
    value,
    new Set(["$schema", "contract", "schemaVersion", "vaults", "authorityGroups"]),
    new Set(["contract", "schemaVersion", "vaults"]),
    "Portfolio registry",
  );
  if (value.contract !== PORTFOLIO_REGISTRY_CONTRACT) {
    throw new TypeError(`Portfolio registry contract must be ${JSON.stringify(PORTFOLIO_REGISTRY_CONTRACT)}.`);
  }
  if (value.schemaVersion !== 1) throw new TypeError("Portfolio registry schemaVersion must be exactly 1.");
  if (!Array.isArray(value.vaults) || value.vaults.length > MAX_PORTFOLIO_VAULTS) {
    throw new RangeError(`Portfolio registry vaults must contain at most ${MAX_PORTFOLIO_VAULTS} entries.`);
  }
  const vaults = value.vaults.map(parseVaultEntry);
  const vaultKeys = new Set(vaults.map(({ key }) => key));
  if (vaultKeys.size !== vaults.length) throw new TypeError("Portfolio registry vault keys must be unique.");
  const rawGroups = value.authorityGroups ?? [];
  if (!Array.isArray(rawGroups) || rawGroups.length > MAX_AUTHORITY_GROUPS) {
    throw new RangeError(`Portfolio authorityGroups must contain at most ${MAX_AUTHORITY_GROUPS} entries.`);
  }
  const authorityGroups = rawGroups.map((group, index) =>
    parseAuthorityGroup(group, index, vaultKeys));
  if (new Set(authorityGroups.map(({ id }) => id)).size !== authorityGroups.length) {
    throw new TypeError("Portfolio authority group IDs must be unique.");
  }
  const schema = value.$schema === undefined
    ? undefined
    : boundedString(value.$schema, MAX_TEXT_BYTES, "Portfolio registry $schema");
  return Object.freeze({
    contract: PORTFOLIO_REGISTRY_CONTRACT,
    schemaVersion: 1,
    ...(schema === undefined ? {} : { schema }),
    vaults: Object.freeze(vaults),
    authorityGroups: Object.freeze(authorityGroups),
  });
}

/** Revalidate and detach an already parsed registry before crossing an authorization boundary. */
export function snapshotPortfolioRegistry(registry: PortfolioRegistryV1): PortfolioRegistryV1 {
  if (!isRecord(registry)) throw new TypeError("Portfolio registry snapshot must be an object.");
  return parsePortfolioRegistry({
    contract: registry.contract,
    schemaVersion: registry.schemaVersion,
    ...(registry.schema === undefined ? {} : { $schema: registry.schema }),
    vaults: Array.isArray(registry.vaults)
      ? registry.vaults.map((entry) => ({
          owner: entry.owner,
          id: entry.id,
          repository: entry.repository,
          checkout: entry.checkout,
          root: entry.root,
          role: entry.role,
          visibility: entry.visibility,
          ...(entry.defaultRef === undefined ? {} : { defaultRef: entry.defaultRef }),
          parserVersion: entry.parserVersion,
        }))
      : registry.vaults,
    authorityGroups: Array.isArray(registry.authorityGroups)
      ? registry.authorityGroups.map((group) => ({
          id: group.id,
          members: group.members,
          state: group.state,
          ...(group.canonical === undefined ? {} : { canonical: group.canonical }),
          ...(group.protected === undefined ? {} : { protected: group.protected }),
          ...(group.reason === undefined ? {} : { reason: group.reason }),
        }))
      : registry.authorityGroups,
  });
}

async function defaultReadRegistryFile(path: string, maximumBytes: number): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error("Portfolio registry must be a regular file.");
    if (before.nlink !== 1n) throw new Error("Portfolio registry must not be hard-linked.");
    if (before.size > BigInt(maximumBytes)) {
      throw new RangeError(`Portfolio registry must be at most ${maximumBytes} UTF-8 bytes.`);
    }
    const chunks: Uint8Array[] = [];
    let observedBytes = 0;
    for (;;) {
      const buffer = new Uint8Array(Math.min(64 * 1_024, maximumBytes - observedBytes + 1));
      const read = await handle.read(buffer, 0, buffer.byteLength, null);
      if (read.bytesRead === 0) break;
      observedBytes += read.bytesRead;
      if (observedBytes > maximumBytes) {
        throw new RangeError(`Portfolio registry must be at most ${maximumBytes} UTF-8 bytes.`);
      }
      chunks.push(buffer.slice(0, read.bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs
      || after.size !== BigInt(observedBytes)
    ) {
      throw new Error("Portfolio registry changed while it was being read; retry.");
    }
    const bytes = new Uint8Array(observedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await handle.close();
  }
}

export async function loadPortfolioRegistry(
  path: string,
  dependencies: PortfolioRegistryFileDependencies = {},
): Promise<PortfolioRegistryV1> {
  const source = await (dependencies.readRegistryFile ?? defaultReadRegistryFile)(
    resolve(path),
    MAX_PORTFOLIO_REGISTRY_BYTES,
  );
  if (Buffer.byteLength(source, "utf8") > MAX_PORTFOLIO_REGISTRY_BYTES) {
    throw new RangeError(`Portfolio registry must be at most ${MAX_PORTFOLIO_REGISTRY_BYTES} UTF-8 bytes.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new SyntaxError("Portfolio registry must be valid JSON.", { cause: error });
  }
  return parsePortfolioRegistry(value);
}

/** Select only explicitly authorized keys without listing or otherwise exposing available entries. */
export function selectAuthorizedVaults(
  registry: PortfolioRegistryV1,
  authorizedVaults: readonly VaultKey[],
): readonly PortfolioVaultEntry[] {
  if (!Array.isArray(authorizedVaults) || authorizedVaults.length < 1 || authorizedVaults.length > MAX_AUTHORIZED_VAULTS) {
    throw new RangeError(`authorizedVaults must contain 1 through ${MAX_AUTHORIZED_VAULTS} explicit vault keys.`);
  }
  const checked = authorizedVaults.map((key) => parseVaultKey(key).key);
  if (new Set(checked).size !== checked.length) throw new TypeError("authorizedVaults must not contain duplicates.");
  const byKey = new Map(registry.vaults.map((entry) => [entry.key, entry]));
  for (const key of checked) {
    if (!byKey.has(key)) {
      throw new Error(`Authorized portfolio vault ${JSON.stringify(key)} is not available.`);
    }
  }
  const selected = new Set(checked);
  return Object.freeze(registry.vaults.filter(({ key }) => selected.has(key)));
}

function insideOrSame(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return fromParent === "" || (fromParent !== ".." && !fromParent.startsWith(`..${sep}`));
}

async function assertDirectoryChain(
  base: string,
  path: string,
  metadata: (path: string) => Promise<PathMetadata>,
  label: string,
): Promise<void> {
  const segments = path === "." ? [] : path.split("/");
  let current = base;
  for (const segment of segments) {
    current = join(current, segment);
    const entry = await metadata(current);
    if (entry.isSymbolicLink()) throw new Error(`${label} must not traverse a symbolic link.`);
    if (!entry.isDirectory()) throw new Error(`${label} must contain directories only.`);
  }
}

/** Resolve one already-authorized registry entry through a caller-owned workspace. */
export async function resolvePortfolioVault(
  entry: PortfolioVaultEntry,
  workspaceRoot: string,
  dependencies: PortfolioPathDependencies = {},
): Promise<ResolvedPortfolioVault> {
  const metadata = dependencies.lstat ?? ((path: string) => lstat(path));
  const canonical = dependencies.realpath ?? ((path: string) => realpath(path));
  const requestedWorkspace = resolve(workspaceRoot);
  const workspaceMetadata = await metadata(requestedWorkspace);
  if (workspaceMetadata.isSymbolicLink()) throw new Error("Portfolio workspace root must not be a symbolic link.");
  if (!workspaceMetadata.isDirectory()) throw new Error("Portfolio workspace root must be a directory.");
  const workspace = await canonical(requestedWorkspace);
  await assertDirectoryChain(workspace, entry.checkout, metadata, "Portfolio checkout");
  const repositoryRoot = await canonical(join(workspace, ...entry.checkout.split("/")));
  if (!insideOrSame(workspace, repositoryRoot)) throw new Error("Portfolio checkout resolves outside the workspace root.");
  await assertDirectoryChain(repositoryRoot, entry.root, metadata, "Portfolio vault root");
  const root = entry.root === "."
    ? repositoryRoot
    : await canonical(join(repositoryRoot, ...entry.root.split("/")));
  if (!insideOrSame(repositoryRoot, root)) throw new Error("Portfolio vault resolves outside its repository checkout.");
  return Object.freeze({ entry, repositoryRoot, root });
}

function rootsOverlap(left: string, right: string): boolean {
  return insideOrSame(left, right) || insideOrSame(right, left);
}

export function validateResolvedPortfolioVaults(
  vaults: readonly ResolvedPortfolioVault[],
): readonly ResolvedPortfolioVault[] {
  for (let left = 0; left < vaults.length; left += 1) {
    for (let right = left + 1; right < vaults.length; right += 1) {
      const first = vaults[left];
      const second = vaults[right];
      if (first !== undefined && second !== undefined && rootsOverlap(first.root, second.root)) {
        throw new Error(
          `Authorized portfolio vault roots overlap: ${JSON.stringify(first.entry.key)} and ${JSON.stringify(second.entry.key)}.`,
        );
      }
    }
  }
  return Object.freeze([...vaults]);
}

export async function resolveAuthorizedVaults(
  registry: PortfolioRegistryV1,
  workspaceRoot: string,
  authorizedVaults: readonly VaultKey[],
  dependencies: PortfolioPathDependencies = {},
): Promise<readonly ResolvedPortfolioVault[]> {
  const selected = selectAuthorizedVaults(registry, authorizedVaults);
  const resolved: ResolvedPortfolioVault[] = [];
  for (const entry of selected) {
    resolved.push(await resolvePortfolioVault(entry, workspaceRoot, dependencies));
  }
  return validateResolvedPortfolioVaults(resolved);
}
