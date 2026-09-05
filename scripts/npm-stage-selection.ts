import { appendFile, readFile } from "node:fs/promises";

const expectedPackageName = "@hraness/kb";
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const maximumStableVersionPart = BigInt(Number.MAX_SAFE_INTEGER);

type PackageIdentity = Readonly<{
  name: typeof expectedPackageName;
  version: string;
  versionParts: readonly [bigint, bigint, bigint];
}>;

export type NpmStageSelection = Readonly<{
  currentVersion: string;
  previousVersion?: string;
  reason: "manual-recovery" | "stable-version-increase" | "version-unchanged";
  shouldStage: boolean;
}>;

type CliOptions = Readonly<{
  currentManifestPath: string;
  eventName: string;
  githubOutputPath: string;
  previousManifestPath?: string;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function packageIdentity(source: string, label: string): PackageIdentity {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new TypeError(`${label} must be valid JSON`, { cause: error });
  }
  const manifest = record(value, label);
  if (manifest.name !== expectedPackageName) {
    throw new TypeError(`${label} must identify ${expectedPackageName}`);
  }
  if (typeof manifest.version !== "string") {
    throw new TypeError(`${label}.version must be a string`);
  }
  const match = stableVersionPattern.exec(manifest.version);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new TypeError(`${label}.version must be a stable semantic version`);
  }
  const versionParts = [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])] as const;
  if (versionParts.some((part) => part > maximumStableVersionPart)) {
    throw new TypeError(
      `${label}.version components must not exceed Number.MAX_SAFE_INTEGER`,
    );
  }
  return {
    name: expectedPackageName,
    version: manifest.version,
    versionParts,
  };
}

function compareVersions(left: PackageIdentity, right: PackageIdentity): number {
  for (let index = 0; index < left.versionParts.length; index += 1) {
    const leftPart = left.versionParts[index];
    const rightPart = right.versionParts[index];
    if (leftPart === undefined || rightPart === undefined) {
      throw new TypeError("Stable semantic version comparison is incomplete");
    }
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function selectNpmStage(input: Readonly<{
  currentManifest: string;
  eventName: string;
  previousManifest?: string;
}>): NpmStageSelection {
  const current = packageIdentity(input.currentManifest, "current package.json");
  if (input.eventName === "workflow_dispatch") {
    return {
      currentVersion: current.version,
      reason: "manual-recovery",
      shouldStage: true,
    };
  }
  if (input.eventName !== "push") {
    throw new TypeError(`Unsupported npm staging event ${input.eventName}`);
  }
  if (input.previousManifest === undefined) {
    throw new TypeError("A push event must provide the previous package.json");
  }
  const previous = packageIdentity(input.previousManifest, "previous package.json");
  const comparison = compareVersions(current, previous);
  if (comparison < 0) {
    throw new TypeError(
      `Package version must increase from ${previous.version}, received ${current.version}`,
    );
  }
  if (comparison === 0) {
    return {
      currentVersion: current.version,
      previousVersion: previous.version,
      reason: "version-unchanged",
      shouldStage: false,
    };
  }
  return {
    currentVersion: current.version,
    previousVersion: previous.version,
    reason: "stable-version-increase",
    shouldStage: true,
  };
}

function parseCliOptions(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--") || value.length === 0) {
      throw new TypeError("npm stage selection arguments must be non-empty name/value pairs");
    }
    if (values.has(name)) throw new TypeError(`npm stage selection repeats ${name}`);
    values.set(name, value);
  }
  const allowed = new Set([
    "--current-manifest",
    "--event",
    "--github-output",
    "--previous-manifest",
  ]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new TypeError(`Unknown npm stage selection argument ${name}`);
  }
  const currentManifestPath = values.get("--current-manifest");
  const eventName = values.get("--event");
  const githubOutputPath = values.get("--github-output");
  if (currentManifestPath === undefined || eventName === undefined || githubOutputPath === undefined) {
    throw new TypeError("npm stage selection requires --current-manifest, --event, and --github-output");
  }
  const previousManifestPath = values.get("--previous-manifest");
  return {
    currentManifestPath,
    eventName,
    githubOutputPath,
    ...(previousManifestPath === undefined ? {} : { previousManifestPath }),
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const [currentManifest, previousManifest] = await Promise.all([
    readFile(options.currentManifestPath, "utf8"),
    options.previousManifestPath === undefined
      ? undefined
      : readFile(options.previousManifestPath, "utf8"),
  ]);
  const selection = selectNpmStage({
    currentManifest,
    eventName: options.eventName,
    ...(previousManifest === undefined ? {} : { previousManifest }),
  });
  const output = [
    `current_version=${selection.currentVersion}`,
    `reason=${selection.reason}`,
    `should_stage=${selection.shouldStage ? "true" : "false"}`,
    ...(selection.previousVersion === undefined
      ? []
      : [`previous_version=${selection.previousVersion}`]),
  ];
  await appendFile(options.githubOutputPath, `${output.join("\n")}\n`, "utf8");
  if (selection.shouldStage) {
    console.log(`Stage ${expectedPackageName}@${selection.currentVersion}: ${selection.reason}`);
  } else {
    console.log(`Package version remains ${selection.currentVersion}; npm staging is not required`);
  }
}

if (import.meta.main) await main();
