import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type DependencyScope = "development" | "optional" | "peer" | "runtime";

type DependencyRecord = {
  from: string;
  scope: DependencyScope;
  specifier: string;
  to: string;
  sourceRepository?: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`package.json ${key} must be a non-empty string`);
  }
  return field;
}

function repositorySlug(value: unknown): string {
  const repository = record(value, "package.json repository");
  const url = stringField(repository, "url");
  const match = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/u.exec(url);
  if (match?.[1] === undefined) {
    throw new Error("package.json repository.url must identify a GitHub repository");
  }
  return match[1];
}

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function hranessSourceRepository(specifier: string): string | undefined {
  const match = /^git\+https:\/\/github\.com\/(hraness\/[A-Za-z0-9._-]+)\.git#[0-9a-f]{40}$/u.exec(specifier);
  return match?.[1];
}

export function canonicalPortfolioInventory(value: unknown): Record<string, unknown> {
  const packageManifest = record(value, "package.json");
  const packageName = stringField(packageManifest, "name");
  const version = stringField(packageManifest, "version");
  const repository = repositorySlug(packageManifest.repository);
  const dependencySections = [
    ["devDependencies", "development"],
    ["optionalDependencies", "optional"],
    ["peerDependencies", "peer"],
    ["dependencies", "runtime"],
  ] as const satisfies readonly (readonly [string, DependencyScope])[];
  const dependencies = dependencySections.flatMap(([section, scope]) => {
    const dependencySection = packageManifest[section];
    if (dependencySection === undefined) return [];
    const entries = record(dependencySection, `package.json ${section}`);
    return Object.entries(entries).flatMap(([name, rawSpecifier]): DependencyRecord[] => {
      if (typeof rawSpecifier !== "string" || rawSpecifier.length === 0) {
        throw new Error(`package.json ${section}.${name} must be a non-empty string`);
      }
      const sourceRepository = hranessSourceRepository(rawSpecifier);
      if (!name.startsWith("@hraness/") && sourceRepository === undefined) return [];
      return [{
        from: packageName,
        scope,
        specifier: rawSpecifier,
        to: name,
        ...(sourceRepository === undefined ? {} : { sourceRepository }),
      }];
    });
  }).toSorted((left, right) =>
    asciiCompare(left.from, right.from)
    || asciiCompare(left.to, right.to)
    || asciiCompare(left.scope, right.scope)
    || asciiCompare(left.specifier, right.specifier)
    || asciiCompare(left.sourceRepository ?? "", right.sourceRepository ?? ""));
  return {
    contract: "hraness.portfolio-inventory/v1",
    formatVersion: 1,
    repository,
    components: [{
      kind: "package",
      name: packageName,
      path: ".",
      visibility: "public",
      version,
    }],
    dependencies,
    deployments: [],
    brands: [],
    publications: [{
      component: packageName,
      packageName,
      repository,
    }],
  };
}

export function canonicalPortfolioInventoryBytes(value: unknown): string {
  return `${JSON.stringify(canonicalPortfolioInventory(value), null, 2)}\n`;
}

const repositoryRoot = resolve(import.meta.dir, "..");
if (import.meta.main) {
  const packageManifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
  ) as unknown;
  const expectedBytes = canonicalPortfolioInventoryBytes(packageManifest);
  const actualBytes = await readFile(
    resolve(repositoryRoot, "portfolio-inventory.json"),
    "utf8",
  );
  if (actualBytes !== expectedBytes) {
    throw new Error("portfolio-inventory.json does not match the canonical package inventory");
  }
}
