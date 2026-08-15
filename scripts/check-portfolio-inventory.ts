import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type DependencyScope = "development" | "optional" | "peer" | "runtime";

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

const repositoryRoot = resolve(import.meta.dir, "..");
const packageManifest = record(
  JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8")) as unknown,
  "package.json",
);
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
  const value = packageManifest[section];
  if (value === undefined) return [];
  const entries = record(value, `package.json ${section}`);
  return Object.entries(entries)
    .filter(([name]) => name.startsWith("@hraness/"))
    .map(([name, specifier]) => {
      if (typeof specifier !== "string" || specifier.length === 0) {
        throw new Error(`package.json ${section}.${name} must be a non-empty string`);
      }
      return { from: packageName, scope, specifier, to: name };
    });
}).toSorted((left, right) =>
  asciiCompare(left.from, right.from)
  || asciiCompare(left.to, right.to)
  || asciiCompare(left.scope, right.scope)
  || asciiCompare(left.specifier, right.specifier));
const expected = {
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
const expectedBytes = `${JSON.stringify(expected, null, 2)}\n`;
const actualBytes = await readFile(
  resolve(repositoryRoot, "portfolio-inventory.json"),
  "utf8",
);
if (actualBytes !== expectedBytes) {
  throw new Error("portfolio-inventory.json does not match the canonical package inventory");
}
