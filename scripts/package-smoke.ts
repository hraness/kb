import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const packageName = "@hraness/kb";
const importSpecifiers = ["@hraness/kb","@hraness/kb/agent-context","@hraness/kb/agent-guide-audit","@hraness/kb/attachments","@hraness/kb/authoring","@hraness/kb/benchmark","@hraness/kb/browser-profiles","@hraness/kb/capture","@hraness/kb/cli","@hraness/kb/clip/acquire","@hraness/kb/clip/args","@hraness/kb/clip/bounded-byte-buffer","@hraness/kb/clip/cli","@hraness/kb/clip/cookies","@hraness/kb/clip/doctor","@hraness/kb/clip/network","@hraness/kb/clip/network-proxy","@hraness/kb/clip/persist","@hraness/kb/clip/terminal","@hraness/kb/evaluation","@hraness/kb/evaluation-builder","@hraness/kb/evaluation-kb","@hraness/kb/git","@hraness/kb/graph","@hraness/kb/navigation","@hraness/kb/pdf","@hraness/kb/percolate","@hraness/kb/query","@hraness/kb/repository-memory","@hraness/kb/sdk","@hraness/kb/search","@hraness/kb/semantic","@hraness/kb/source-inbox","@hraness/kb/url-intelligence","@hraness/kb/workflow","@hraness/kb/workflows","@hraness/kb/workflows/decision-context","@hraness/kb/workflows/explain-change","@hraness/kb/workflows/plan-radar"];
const binNames = ["kb", "kb-evaluation-builder"];
const verificationPackages = ["@types/bun@^1.3.14","fast-check@^4.8.0","typescript@^6.0.3"];
const skillNames = [
  "percolate-kb",
  "plan-kb",
  "query-kb",
  "refresh-kb",
  "save-pdf-kb",
  "save-url-kb",
] as const;
const metadataSearchToolFiles = [
  "src/clip/metadata-search-tool/.gitignore",
  "src/clip/metadata-search-tool/Cargo.lock",
  "src/clip/metadata-search-tool/Cargo.toml",
  "src/clip/metadata-search-tool/runner.ts",
  "src/clip/metadata-search-tool/src/main.rs",
] as const;

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

async function regularFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name))) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`packaged skill tree contains a symbolic link: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await regularFiles(join(root, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function verifyInstalledSkills(consumer: string): Promise<void> {
  const sourceRoot = join(repository, "skills");
  const installedRoot = join(
    consumer,
    "node_modules",
    "@hraness",
    "kb",
    "skills",
  );
  const sourceFiles = await regularFiles(sourceRoot);
  const installedFiles = await regularFiles(installedRoot);
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

const repository = process.cwd();
const work = await mkdtemp(join(tmpdir(), "hraness-package-smoke-"));
const temporary = join(work, "tmp");
const environment = {
  ...process.env,
  BUN_TMPDIR: temporary,
  TMPDIR: temporary,
};
try {
  const archive = join(work, "package.tgz");
  const consumer = join(work, "consumer");
  await mkdir(temporary, { mode: 0o700 });
  await mkdir(consumer);
  const nodeExecutable = resolveGenuineNodeExecutable();
  await run([
    process.execPath,
    "pm",
    "pack",
    "--filename",
    archive,
    "--ignore-scripts",
    "--quiet",
  ], repository);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await run([process.execPath, "add", archive, "--ignore-scripts"], consumer);
  await verifyInstalledSkills(consumer);
  await verifyInstalledMetadataSearchTool(consumer);
  await run([nodeExecutable, "--input-type=module", "-e", `await import(${JSON.stringify(packageName)})`], consumer);
  for (const binName of binNames) {
    await run([join(consumer, "node_modules", ".bin", binName), "--help"], consumer);
  }
  await run([
    join(consumer, "node_modules", ".bin", "kb"),
    "url-metadata",
    "--help",
  ], consumer);
  if (verificationPackages.length > 0) {
    await run([process.execPath, "add", ...verificationPackages, "--ignore-scripts"], consumer);
  }
  await run([
    nodeExecutable,
    "--input-type=module",
    "-e",
    `await Promise.all(${JSON.stringify(importSpecifiers)}.map((specifier) => import(specifier)))`,
  ], consumer);
  const consumerSource = `${importSpecifiers.map((specifier, index) =>
    `import * as surface${String(index)} from ${JSON.stringify(specifier)};`
  ).join("\n")}\nvoid [${importSpecifiers.map((_specifier, index) =>
    `surface${String(index)}`
  ).join(", ")}];\n`;
  await writeFile(join(consumer, "index.ts"), consumerSource);
  await writeFile(join(consumer, "tsconfig.bundler.json"), "{\n  \"compilerOptions\": {\n    \"target\": \"ES2023\",\n    \"lib\": [\n      \"ES2023\",\n      \"DOM\",\n      \"DOM.Iterable\"\n    ],\n    \"types\": [\n      \"bun\",\n      \"node\"\n    ],\n    \"strict\": true,\n    \"noEmit\": true,\n    \"skipLibCheck\": false,\n    \"module\": \"Preserve\",\n    \"moduleResolution\": \"Bundler\"\n  },\n  \"include\": [\n    \"index.ts\"\n  ]\n}");
  await run([process.execPath, "x", "tsc", "-p", "./tsconfig.bundler.json"], consumer);

} finally {
  await rm(work, { recursive: true, force: true });
}
