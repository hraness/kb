import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";

import {
  inspectPackageArtifact,
  type PackageArtifactInventory,
} from "./package-artifact.js";

const packageName = "@hraness/kb";
const maximumPackageFiles = 210;
const maximumPackedBytes = 1_200_000;
const maximumUnpackedBytes = 5_250_000;
const importSpecifiers = [
  "@hraness/kb",
  "@hraness/kb/agent-context",
  "@hraness/kb/agent-guide-audit",
  "@hraness/kb/attachments",
  "@hraness/kb/authoring",
  "@hraness/kb/benchmark",
  "@hraness/kb/browser-profiles",
  "@hraness/kb/capture",
  "@hraness/kb/cli",
  "@hraness/kb/clip/acquire",
  "@hraness/kb/clip/args",
  "@hraness/kb/clip/bounded-byte-buffer",
  "@hraness/kb/clip/bundle-reader",
  "@hraness/kb/clip/cli",
  "@hraness/kb/clip/cookies",
  "@hraness/kb/clip/doctor",
  "@hraness/kb/clip/jobs",
  "@hraness/kb/clip/network",
  "@hraness/kb/clip/network-proxy",
  "@hraness/kb/clip/persist",
  "@hraness/kb/clip/refresh",
  "@hraness/kb/clip/terminal",
  "@hraness/kb/evaluation",
  "@hraness/kb/evaluation-builder",
  "@hraness/kb/evaluation-kb",
  "@hraness/kb/git",
  "@hraness/kb/graph",
  "@hraness/kb/navigation",
  "@hraness/kb/pdf",
  "@hraness/kb/percolate",
  "@hraness/kb/portfolio",
  "@hraness/kb/query",
  "@hraness/kb/repository-memory",
  "@hraness/kb/sdk",
  "@hraness/kb/search",
  "@hraness/kb/search-rules",
  "@hraness/kb/semantic",
  "@hraness/kb/source-inbox",
  "@hraness/kb/untrusted-content",
  "@hraness/kb/url-intelligence",
  "@hraness/kb/workflow",
  "@hraness/kb/workflows",
  "@hraness/kb/workflows/decision-context",
  "@hraness/kb/workflows/explain-change",
  "@hraness/kb/workflows/plan-radar",
];
const requiredNamedExports = {
  "@hraness/kb": ["createOhAdoptionPreparerV1"],
  "@hraness/kb/clip/bundle-reader": ["readCaptureBundle", "verifyCaptureBundle"],
  "@hraness/kb/clip/jobs": ["createCaptureJob", "openCaptureJobStore", "updateCaptureJob"],
  "@hraness/kb/clip/refresh": ["diffCaptureBundle"],
  "@hraness/kb/portfolio": ["openKnowledgePortfolio", "parsePortfolioRegistry", "parseQualifiedDocumentUri"],
  "@hraness/kb/search-rules": ["parseSearchRules", "prioritizeSearchHits"],
  "@hraness/kb/untrusted-content": ["createUntrustedToolResult", "projectUntrustedJson"],
} as const;
const binNames = ["kb", "kb-evaluation-builder"];
const verificationPackages = ["@types/bun@^1.3.14","fast-check@^4.8.0","typescript@^6.0.3"];
const skillNames = ["kb"] as const;
const metadataSearchToolFiles = [
  "src/clip/metadata-search-tool/Cargo.lock",
  "src/clip/metadata-search-tool/Cargo.toml",
  "src/clip/metadata-search-tool/runner.ts",
  "src/clip/metadata-search-tool/src/main.rs",
] as const;
const requiredPackageFiles = [
  "DISCLOSURE",
  "LICENSE",
  "README.md",
  "dist/cli.js",
  "dist/evaluation-builder.js",
  "package.json",
  "skills/kb/AGENTS.md",
  "skills/kb/SKILL.md",
  "skills/kb/agents/openai.yaml",
] as const;

type PackageInput = Readonly<{
  archive?: string;
  packJson?: string;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string, label: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return field;
}

function integerField(value: Record<string, unknown>, key: string, label: string): number {
  const field = value[key];
  if (!Number.isSafeInteger(field) || (field as number) < 0) {
    throw new Error(`${label}.${key} must be a non-negative safe integer`);
  }
  return field as number;
}

function resolveInputPath(repository: string, path: string): string {
  return isAbsolute(path) ? path : resolve(repository, path);
}

function parsePackageInput(args: readonly string[], repository: string): PackageInput {
  if (args.length === 0) return {};
  if (args.length !== 4) {
    throw new Error(
      "usage: bun run scripts/package-smoke.ts [--archive <package.tgz> --pack-json <npm-pack.json>]",
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--archive" && flag !== "--pack-json") || value === undefined || values.has(flag)) {
      throw new Error(
        "usage: bun run scripts/package-smoke.ts [--archive <package.tgz> --pack-json <npm-pack.json>]",
      );
    }
    values.set(flag, resolveInputPath(repository, value));
  }
  const archive = values.get("--archive");
  const packJson = values.get("--pack-json");
  if (archive === undefined || packJson === undefined) {
    throw new Error(
      "usage: bun run scripts/package-smoke.ts [--archive <package.tgz> --pack-json <npm-pack.json>]",
    );
  }
  return { archive, packJson };
}

async function verifyExactNpmPackMetadata(
  archive: string,
  packJson: string,
  packageVersion: string,
  inventory: PackageArtifactInventory,
): Promise<void> {
  const value = JSON.parse(await readFile(packJson, "utf8")) as unknown;
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("npm-pack.json must contain exactly one package");
  }
  const result = record(value[0], "npm pack result");
  const expectedFilename = `hraness-kb-${packageVersion}.tgz`;
  if (
    stringField(result, "id", "npm pack result") !== `${packageName}@${packageVersion}`
    || stringField(result, "name", "npm pack result") !== packageName
    || stringField(result, "version", "npm pack result") !== packageVersion
    || stringField(result, "filename", "npm pack result") !== expectedFilename
    || basename(archive) !== expectedFilename
  ) {
    throw new Error("npm pack identity does not match the exact KB archive");
  }
  const entryCount = integerField(result, "entryCount", "npm pack result");
  const packedBytes = integerField(result, "size", "npm pack result");
  const unpackedBytes = integerField(result, "unpackedSize", "npm pack result");
  if (
    entryCount !== inventory.fileCount
    || packedBytes !== inventory.packedBytes
    || unpackedBytes !== inventory.unpackedBytes
  ) {
    throw new Error("npm pack metrics do not match the exact KB archive");
  }
  if (!Array.isArray(result.bundled) || result.bundled.length !== 0) {
    throw new Error("npm pack unexpectedly bundles dependencies");
  }
  if (!Array.isArray(result.files) || result.files.length !== entryCount) {
    throw new Error("npm pack file inventory does not match entryCount");
  }
  const reportedFiles = new Map<string, Readonly<{ mode: number; size: number }>>();
  for (const [index, value] of result.files.entries()) {
    const file = record(value, `npm pack result file ${String(index + 1)}`);
    const path = stringField(file, "path", `npm pack result file ${String(index + 1)}`);
    const size = integerField(file, "size", `npm pack result file ${String(index + 1)}`);
    const mode = integerField(file, "mode", `npm pack result file ${String(index + 1)}`);
    if (
      Buffer.byteLength(path, "utf8") > 1_024
      || path.includes("\\")
      || path.startsWith("/")
      || path.split("/").some((part) => part === "" || part === "." || part === "..")
      || reportedFiles.has(path)
    ) {
      throw new Error(`npm pack file inventory contains an unsafe or duplicate path: ${path}`);
    }
    if (mode !== 0o644 && mode !== 0o755) {
      throw new Error(`npm pack file inventory contains an unsafe mode for ${path}`);
    }
    reportedFiles.set(path, Object.freeze({ mode, size }));
  }
  for (const file of inventory.files) {
    const reported = reportedFiles.get(file.path);
    if (reported?.size !== file.size || reported.mode !== file.mode) {
      throw new Error(
        `npm pack file inventory differs from the exact archive mode or size for ${file.path}`,
      );
    }
  }
  if (reportedFiles.size !== inventory.files.length) {
    throw new Error("npm pack file inventory contains a path absent from the exact archive");
  }
  const archiveBytes = await readFile(archive);
  const actualIntegrity = `sha512-${createHash("sha512").update(archiveBytes).digest("base64")}`;
  const actualShasum = createHash("sha1").update(archiveBytes).digest("hex");
  if (
    stringField(result, "integrity", "npm pack result") !== actualIntegrity
    || stringField(result, "shasum", "npm pack result") !== actualShasum
  ) {
    throw new Error("npm pack SHA-1 or SHA-512 does not match the exact KB archive");
  }
}

async function run(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, {
    cwd,
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${String(exitCode)}): ${command.join(" ")}`);
}

function resolveGenuineNodeExecutable(): string {
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  const identityProbe = [
    "if (typeof Bun !== 'undefined'",
    "|| process.versions.bun !== undefined",
    "|| !process.versions.node?.startsWith('24.')) process.exit(1)",
  ].join(" ");
  const candidates = [...new Set(
    (process.env.PATH ?? "")
      .split(delimiter)
      .filter((directory) => directory.length > 0)
      .map((directory) => resolve(directory, executableName)),
  )];
  for (const executable of candidates) {
    try {
      const probe = Bun.spawnSync([
        executable,
        "--input-type=commonjs",
        "-e",
        identityProbe,
      ], {
        env: environment,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      if (probe.exitCode === 0) return executable;
    } catch {
      // Continue past absent, inaccessible, or incompatible PATH candidates.
    }
  }
  throw new Error("package smoke requires a genuine Node 24 executable on PATH");
}

function resolveNpmExecutable(): string {
  const executableName = process.platform === "win32" ? "npm.cmd" : "npm";
  const candidates = [...new Set(
    (process.env.PATH ?? "")
      .split(delimiter)
      .filter((directory) => directory.length > 0)
      .map((directory) => resolve(directory, executableName)),
  )];
  for (const executable of candidates) {
    try {
      const probe = Bun.spawnSync([executable, "--version"], {
        env: environment,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      if (probe.exitCode === 0) return executable;
    } catch {
      // Continue past absent or inaccessible PATH candidates.
    }
  }
  throw new Error("package smoke requires npm on PATH");
}

async function regularFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name))) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`package tree contains a symbolic link: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...await regularFiles(join(root, entry.name), relativePath));
      }
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function verifyInstalledSkills(consumer: string): Promise<void> {
  const sourceRoot = join(repository, "skills");
  const installedPackageRoot = join(
    consumer,
    "node_modules",
    "@hraness",
    "kb",
  );
  const installedRoot = join(
    installedPackageRoot,
    "skills",
  );
  const sourceFiles = await regularFiles(sourceRoot);
  const installedFiles = await regularFiles(installedRoot);
  const sourceSkillEntrypoints = sourceFiles.filter(
    (path) => path === "SKILL.md" || path.endsWith("/SKILL.md"),
  );
  const expectedSkillEntrypoints = skillNames.map((name) => `${name}/SKILL.md`);
  if (JSON.stringify(sourceSkillEntrypoints) !== JSON.stringify(expectedSkillEntrypoints)) {
    throw new Error(
      `package source must contain exactly these Agent Skills: ${expectedSkillEntrypoints.join(", ")}`,
    );
  }
  if (JSON.stringify(installedFiles) !== JSON.stringify(sourceFiles)) {
    throw new Error("installed Agent Skill paths differ from the package source");
  }
  for (const relativePath of sourceFiles) {
    const [source, installed] = await Promise.all([
      readFile(join(sourceRoot, relativePath)),
      readFile(join(installedRoot, relativePath)),
    ]);
    if (!source.equals(installed)) {
      throw new Error(`installed Agent Skill bytes differ: ${relativePath}`);
    }
  }
  for (const skillName of skillNames) {
    for (const requiredPath of [
      `${skillName}/AGENTS.md`,
      `${skillName}/SKILL.md`,
      `${skillName}/agents/openai.yaml`,
    ]) {
      if (!installedFiles.includes(requiredPath)) {
        throw new Error(`installed Agent Skill is incomplete: ${requiredPath}`);
      }
    }
  }

  const manifest = JSON.parse(
    await readFile(join(installedPackageRoot, "package.json"), "utf8"),
  ) as { readonly version?: unknown };
  if (typeof manifest.version !== "string") {
    throw new Error("installed package version is missing");
  }
  const [skill, metadata] = await Promise.all([
    readFile(join(installedRoot, "kb", "SKILL.md"), "utf8"),
    readFile(join(installedRoot, "kb", "agents", "openai.yaml"), "utf8"),
  ]);
  if (!skill.includes(`@hraness/kb@${manifest.version}`)) {
    throw new Error("installed KB skill npm pin does not match the package version");
  }
  if (!metadata.includes("$kb")) {
    throw new Error("installed KB skill metadata must invoke $kb explicitly");
  }
}

async function verifyInstalledMetadataSearchTool(consumer: string): Promise<void> {
  const installedPackage = join(consumer, "node_modules", "@hraness", "kb");
  for (const relativePath of metadataSearchToolFiles) {
    const sourcePath = join(repository, relativePath);
    const installedPath = join(installedPackage, relativePath);
    const installedStat = await lstat(installedPath);
    if (installedStat.isSymbolicLink() || !installedStat.isFile()) {
      throw new Error(`installed metadata-search tool resource is not a regular file: ${relativePath}`);
    }
    const [source, installed] = await Promise.all([
      readFile(sourcePath),
      readFile(installedPath),
    ]);
    if (!source.equals(installed)) {
      throw new Error(`installed metadata-search tool resource bytes differ: ${relativePath}`);
    }
  }
}

async function verifyInstalledPackagePolicy(consumer: string): Promise<Readonly<{
  readonly fileCount: number;
  readonly unpackedBytes: number;
}>> {
  const installedPackage = join(consumer, "node_modules", "@hraness", "kb");
  type PackageIdentity = {
    readonly contentPolicy?: { readonly class?: unknown };
    readonly description?: unknown;
    readonly engines?: { readonly bun?: unknown };
    readonly keywords?: unknown;
    readonly name?: unknown;
    readonly publishConfig?: {
      readonly access?: unknown;
      readonly registry?: unknown;
    };
    readonly version?: unknown;
  };
  const [manifest, sourceManifest] = await Promise.all([
    readFile(join(installedPackage, "package.json"), "utf8").then(
      (source) => JSON.parse(source) as PackageIdentity,
    ),
    readFile(join(repository, "package.json"), "utf8").then(
      (source) => JSON.parse(source) as PackageIdentity,
    ),
  ]);
  if (
    sourceManifest.name !== packageName
    || typeof sourceManifest.version !== "string"
    || typeof sourceManifest.description !== "string"
    || !Array.isArray(sourceManifest.keywords)
    || manifest.name !== sourceManifest.name
    || manifest.version !== sourceManifest.version
    || manifest.description !== sourceManifest.description
    || JSON.stringify(manifest.keywords) !== JSON.stringify(sourceManifest.keywords)
  ) {
    throw new Error("installed package identity does not match the source package");
  }
  if (manifest.contentPolicy?.class !== "dual-use") {
    throw new Error("installed package must retain contentPolicy.class=dual-use");
  }
  if (manifest.engines?.bun !== ">=1.3.14") {
    throw new Error("installed package must require Bun >=1.3.14");
  }
  if (
    manifest.publishConfig?.access !== "public"
    || manifest.publishConfig.registry !== "https://registry.npmjs.org"
  ) {
    throw new Error("installed package must pin public publication to the canonical npm registry");
  }
  const files = await regularFiles(installedPackage);
  for (const requiredPath of requiredPackageFiles) {
    if (!files.includes(requiredPath)) {
      throw new Error(`installed package is missing ${requiredPath}`);
    }
  }
  for (const path of files) {
    if (
      path !== "DISCLOSURE"
      && path !== "LICENSE"
      && path !== "README.md"
      && path !== "package.json"
      && !path.startsWith("dist/")
      && !path.startsWith("skills/kb/")
      && !path.startsWith("src/")
    ) {
      throw new Error(`installed package contains an unexpected path: ${path}`);
    }
  }
  if (files.length > maximumPackageFiles) {
    throw new Error(
      `installed package has ${String(files.length)} files; maximum is ${String(maximumPackageFiles)}`,
    );
  }
  let unpackedBytes = 0;
  for (const path of files) {
    unpackedBytes += (await stat(join(installedPackage, path))).size;
  }
  if (unpackedBytes > maximumUnpackedBytes) {
    throw new Error(
      `installed package has ${String(unpackedBytes)} unpacked bytes; maximum is ${String(maximumUnpackedBytes)}`,
    );
  }
  const [sourceDisclosure, installedDisclosure] = await Promise.all([
    readFile(join(repository, "DISCLOSURE")),
    readFile(join(installedPackage, "DISCLOSURE")),
  ]);
  if (!sourceDisclosure.equals(installedDisclosure)) {
    throw new Error("installed dual-use disclosure differs from the source disclosure");
  }
  return { fileCount: files.length, unpackedBytes };
}

const repository = process.cwd();
const packageInput = parsePackageInput(process.argv.slice(2), repository);
const work = await mkdtemp(join(tmpdir(), "hraness-package-smoke-"));
const temporary = join(work, "tmp");
const environment = {
  ...process.env,
  BUN_TMPDIR: temporary,
  TMPDIR: temporary,
  npm_config_audit: "false",
  npm_config_cache: join(temporary, "npm-cache"),
  npm_config_fund: "false",
  npm_config_ignore_scripts: "true",
  npm_config_registry: "https://registry.npmjs.org",
  npm_config_update_notifier: "false",
};
try {
  const suppliedArchive = packageInput.archive ?? null;
  const archive = suppliedArchive ?? join(work, "package.tgz");
  const consumer = join(work, "consumer");
  const npmConsumer = join(work, "npm-consumer");
  await mkdir(temporary, { mode: 0o700 });
  await mkdir(consumer);
  await mkdir(npmConsumer);
  const nodeExecutable = resolveGenuineNodeExecutable();
  const npmExecutable = resolveNpmExecutable();
  if (suppliedArchive === null) {
    await run([
      process.execPath,
      "pm",
      "pack",
      "--filename",
      archive,
      "--ignore-scripts",
      "--quiet",
    ], repository);
  } else {
    const archiveStat = await lstat(archive);
    if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) {
      throw new Error("supplied package archive must be a regular file");
    }
  }
  const sourceManifest = JSON.parse(await readFile(join(repository, "package.json"), "utf8")) as {
    readonly name?: unknown;
    readonly version?: unknown;
  };
  if (sourceManifest.name !== packageName || typeof sourceManifest.version !== "string") {
    throw new Error("source package identity is invalid");
  }
  const inventory = await inspectPackageArtifact(archive);
  if (packageInput.packJson !== undefined) {
    await verifyExactNpmPackMetadata(
      archive,
      packageInput.packJson,
      sourceManifest.version,
      inventory,
    );
  }
  const packedBytes = inventory.packedBytes;
  if (packedBytes > maximumPackedBytes) {
    throw new Error(
      `package archive has ${String(packedBytes)} bytes; maximum is ${String(maximumPackedBytes)}`,
    );
  }
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await writeFile(join(npmConsumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await run([process.execPath, "add", archive, "--ignore-scripts"], consumer);
  await run([
    npmExecutable,
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    archive,
  ], npmConsumer);
  const bunPackage = await verifyInstalledPackagePolicy(consumer);
  const npmPackage = await verifyInstalledPackagePolicy(npmConsumer);
  if (
    bunPackage.fileCount !== npmPackage.fileCount
    || bunPackage.unpackedBytes !== npmPackage.unpackedBytes
  ) {
    throw new Error("Bun and npm consumers installed different package trees");
  }
  await verifyInstalledSkills(consumer);
  await verifyInstalledSkills(npmConsumer);
  await verifyInstalledMetadataSearchTool(consumer);
  await verifyInstalledMetadataSearchTool(npmConsumer);
  await run([nodeExecutable, "--input-type=module", "-e", `await import(${JSON.stringify(packageName)})`], consumer);
  await run([nodeExecutable, "--input-type=module", "-e", `await import(${JSON.stringify(packageName)})`], npmConsumer);
  for (const binName of binNames) {
    await run([join(consumer, "node_modules", ".bin", binName), "--help"], consumer);
    await run([join(npmConsumer, "node_modules", ".bin", binName), "--help"], npmConsumer);
  }
  await run([
    join(consumer, "node_modules", ".bin", "kb"),
    "url-metadata",
    "--help",
  ], consumer);
  await run([
    join(npmConsumer, "node_modules", ".bin", "kb"),
    "url-metadata",
    "--help",
  ], npmConsumer);
  if (verificationPackages.length > 0) {
    await run([process.execPath, "add", ...verificationPackages, "--ignore-scripts"], consumer);
  }
  await run([
    nodeExecutable,
    "--input-type=module",
    "-e",
    `const required = ${JSON.stringify(requiredNamedExports)};
for (const specifier of ${JSON.stringify(importSpecifiers)}) {
  const surface = await import(specifier);
  for (const name of required[specifier] ?? []) {
    if (typeof surface[name] !== "function") throw new Error(specifier + " is missing " + name);
  }
}`,
  ], consumer);
  await run([
    nodeExecutable,
    "--input-type=module",
    "-e",
    `const required = ${JSON.stringify(requiredNamedExports)};
for (const specifier of ${JSON.stringify(importSpecifiers)}) {
  const surface = await import(specifier);
  for (const name of required[specifier] ?? []) {
    if (typeof surface[name] !== "function") throw new Error(specifier + " is missing " + name);
  }
}`,
  ], npmConsumer);
  const consumerSource = `${importSpecifiers.map((specifier, index) =>
    `import * as surface${String(index)} from ${JSON.stringify(specifier)};`
  ).join("\n")}
import { createOhAdoptionPreparerV1 } from "@hraness/kb";
import { readCaptureBundle, verifyCaptureBundle } from "@hraness/kb/clip/bundle-reader";
import { createCaptureJob, openCaptureJobStore, updateCaptureJob } from "@hraness/kb/clip/jobs";
import { diffCaptureBundle } from "@hraness/kb/clip/refresh";
import { openKnowledgePortfolio, parsePortfolioRegistry, parseQualifiedDocumentUri } from "@hraness/kb/portfolio";
import { parseSearchRules, prioritizeSearchHits } from "@hraness/kb/search-rules";
import { createUntrustedToolResult, projectUntrustedJson } from "@hraness/kb/untrusted-content";

const rules = parseSearchRules({ schemaVersion: 1, aliases: {}, priorityRules: [] });
const registry = parsePortfolioRegistry({
  contract: "hraness.kb-portfolio/v1",
  schemaVersion: 1,
  vaults: [{
    owner: "hraness", id: "kb", repository: "hraness/kb", checkout: "kb", root: "kb",
    role: "repository", visibility: "public", parserVersion: 1,
  }],
});
const identity = parseQualifiedDocumentUri("kb://hraness/kb/note-id");
const projected = projectUntrustedJson([{ title: "stored source" }]);
void [
  createOhAdoptionPreparerV1,
  readCaptureBundle, verifyCaptureBundle,
  createCaptureJob, openCaptureJobStore, updateCaptureJob,
  diffCaptureBundle, openKnowledgePortfolio, prioritizeSearchHits,
  createUntrustedToolResult, rules, registry, identity, projected,
];
void [${importSpecifiers.map((_specifier, index) =>
    `surface${String(index)}`
  ).join(", ")}];\n`;
  await writeFile(join(consumer, "index.ts"), consumerSource);
  await writeFile(join(consumer, "tsconfig.bundler.json"), "{\n  \"compilerOptions\": {\n    \"target\": \"ES2023\",\n    \"lib\": [\n      \"ES2023\",\n      \"DOM\",\n      \"DOM.Iterable\"\n    ],\n    \"types\": [\n      \"bun\",\n      \"node\"\n    ],\n    \"strict\": true,\n    \"noEmit\": true,\n    \"skipLibCheck\": false,\n    \"module\": \"Preserve\",\n    \"moduleResolution\": \"Bundler\"\n  },\n  \"include\": [\n    \"index.ts\"\n  ]\n}");
  await run([process.execPath, "x", "tsc", "-p", "./tsconfig.bundler.json"], consumer);

  console.log(JSON.stringify({
    archive: basename(archive),
    fileCount: bunPackage.fileCount,
    packedBytes,
    unpackedBytes: bunPackage.unpackedBytes,
  }));

} finally {
  await rm(work, { recursive: true, force: true });
}
