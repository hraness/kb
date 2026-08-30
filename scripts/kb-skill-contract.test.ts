import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  customizationProposalDigest,
  executeCustomizationContract,
  inspectCustomizationContract,
  type CustomizationCapabilities,
  type CustomizationProposal,
  type CustomizationTargetState,
  validateKbSkillContractResources,
} from "./kb-skill-contract.ts";

const root = "/approved/skills";

async function regularFiles(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`skill resources must not contain symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await regularFiles(resolve(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`skill resources must be regular files or directories: ${relativePath}`);
    }
  }
  return files;
}

function proposal(
  overrides: Partial<CustomizationProposal> = {},
): CustomizationProposal {
  return {
    id: "save-decision-kb",
    root,
    runtime: "none",
    reads: [{ surface: "filesystem", target: "/repo/kb" }],
    writes: [{
      surface: "filesystem",
      target: "save-decision-kb/SKILL.md",
      contents: "# Save a decision\n",
    }],
    ...overrides,
  };
}

type MutationAttempt =
  | { readonly kind: "prepare-runtime" }
  | { readonly kind: "write"; readonly target: string };

class FakeCapabilities implements CustomizationCapabilities {
  readonly inspections: { readonly surface: string; readonly target: string }[] = [];
  readonly mutations: MutationAttempt[] = [];
  readonly files = new Map<string, string>();
  readonly states = new Map<string, CustomizationTargetState>();
  failRuntimePreparation = false;
  failWriteTarget: string | null = null;

  async inspect(surface: string, target: string): Promise<void> {
    this.inspections.push({ surface, target });
  }

  async inspectWriteTarget(target: string): Promise<CustomizationTargetState> {
    const explicit = this.states.get(target);
    if (explicit !== undefined) {
      return explicit;
    }
    const contents = this.files.get(target);
    return contents === undefined
      ? { kind: "missing", hasSymlinkAncestor: false }
      : { kind: "file", contents, hasSymlinkAncestor: false };
  }

  async prepareRuntime(): Promise<void> {
    this.mutations.push({ kind: "prepare-runtime" });
    if (this.failRuntimePreparation) {
      throw new Error("injected runtime preparation failure");
    }
  }

  async writeFileAtomic(target: string, contents: string): Promise<void> {
    this.mutations.push({ kind: "write", target });
    if (target === this.failWriteTarget) {
      throw new Error("injected atomic write failure");
    }
    this.files.set(target, contents);
  }
}

test("the shipped skill resources preserve routing and companion contracts", async () => {
  const repositoryRoot = resolve(import.meta.dir, "..");
  const [
    skill,
    customize,
    companionSkills,
    template,
    percolate,
    design,
    readme,
    cli,
    index,
    manifestSource,
    skillFiles,
  ] = await Promise.all([
    readFile(resolve(repositoryRoot, "skills/kb/SKILL.md"), "utf8"),
    readFile(resolve(repositoryRoot, "skills/kb/references/customize.md"), "utf8"),
    readFile(resolve(repositoryRoot, "skills/kb/references/companion-skills.md"), "utf8"),
    readFile(resolve(repositoryRoot, "skills/kb/templates/companion-skill.template.md"), "utf8"),
    readFile(resolve(repositoryRoot, "skills/kb/references/percolate.md"), "utf8"),
    readFile(resolve(repositoryRoot, "docs/design.md"), "utf8"),
    readFile(resolve(repositoryRoot, "README.md"), "utf8"),
    readFile(resolve(repositoryRoot, "src/cli.ts"), "utf8"),
    readFile(resolve(repositoryRoot, "src/index.ts"), "utf8"),
    readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    regularFiles(resolve(repositoryRoot, "skills/kb")),
  ]);
  const manifest = JSON.parse(manifestSource) as {
    readonly exports?: unknown;
    readonly files?: unknown;
    readonly version?: unknown;
  };
  if (
    !Array.isArray(manifest.files)
    || manifest.files.some((file) => typeof file !== "string")
  ) {
    throw new Error("package files must be an array of strings");
  }
  const manifestFiles = manifest.files as string[];
  const publicSourceFiles = manifestFiles
    .filter((file) => file.startsWith("src/") && file.endsWith(".ts"))
    .toSorted();
  const publicSource = (await Promise.all(
    publicSourceFiles.map(async (file) =>
      `${file}\0${await readFile(resolve(repositoryRoot, file), "utf8")}`
    ),
  )).join("\n");
  const resources = {
    skill,
    customize,
    companionSkills,
    template,
    percolate,
    design,
    readme,
    publicSource,
  };

  expect(validateKbSkillContractResources(resources)).toEqual([]);

  expect(validateKbSkillContractResources({
    ...resources,
    skill: skill.replace("## Route the request", "## Request routing"),
  })).toContain("SKILL.md must route requests before runtime preparation");
  for (const forbiddenPublicSource of [
    "export type LifecycleRole = \"plan\";",
    "export type MemoryRole = \"plan\";",
    "export function resolveLifecycleRole(): void {}",
    "export function resolveMemoryRole(): void {}",
    "const lifecycleOption = \"--role\";",
    "const explicitLifecycleOption = \"--lifecycle-role\";",
  ]) {
    expect(validateKbSkillContractResources({
      ...resources,
      publicSource: `${publicSource}\n${forbiddenPublicSource}`,
    }).some((error) => error.startsWith("public package source must not expose")))
      .toBe(true);
  }

  expect(skillFiles.map(String).toSorted()).toEqual([
    "AGENTS.md",
    "SKILL.md",
    "agents/openai.yaml",
    "references/companion-skills.md",
    "references/customize.md",
    "references/pdf-review.md",
    "references/percolate.md",
    "references/plan-structure.md",
    "references/plan.md",
    "references/query.md",
    "references/refresh.md",
    "references/save-pdf.md",
    "references/save-url.md",
    "references/url-authentication.md",
    "references/url-platforms.md",
    "templates/companion-skill.template.md",
  ]);
  expect(manifest.version).toBe("0.18.0");
  expect(manifestFiles).toContain("skills/kb");
  expect(publicSourceFiles).toContain("src/repository-memory.ts");
  expect(Object.keys(manifest.exports as Record<string, unknown>).toSorted()).toEqual([
    ".",
    "./agent-context",
    "./agent-guide-audit",
    "./attachments",
    "./authoring",
    "./benchmark",
    "./browser-profiles",
    "./capture",
    "./cli",
    "./clip/acquire",
    "./clip/args",
    "./clip/bounded-byte-buffer",
    "./clip/bundle-reader",
    "./clip/cli",
    "./clip/cookies",
    "./clip/doctor",
    "./clip/jobs",
    "./clip/network",
    "./clip/network-proxy",
    "./clip/persist",
    "./clip/refresh",
    "./clip/terminal",
    "./evaluation",
    "./evaluation-builder",
    "./evaluation-kb",
    "./git",
    "./graph",
    "./navigation",
    "./pdf",
    "./percolate",
    "./portfolio",
    "./query",
    "./repository-memory",
    "./sdk",
    "./search",
    "./search-rules",
    "./semantic",
    "./source-inbox",
    "./untrusted-content",
    "./url-intelligence",
    "./workflow",
    "./workflows",
    "./workflows/decision-context",
    "./workflows/explain-change",
    "./workflows/plan-radar",
  ]);
  expect(index.trim().split("\n")).toEqual([
    'export * from "./agent-context.js";',
    'export * from "./agent-guide-audit.js";',
    'export * from "./authoring.js";',
    'export * from "./attachments.js";',
    'export * from "./benchmark.js";',
    'export * from "./evaluation.js";',
    'export * from "./evaluation-kb.js";',
    'export * from "./git.js";',
    'export * from "./graph.js";',
    'export * from "./init.js";',
    'export * from "./navigation.js";',
    'export * from "./oh-adoption.js";',
    'export * from "./percolate.js";',
    'export * from "./query.js";',
    'export * from "./repository-memory.js";',
    'export * from "./search.js";',
    'export * from "./semantic.js";',
    'export * from "./sdk.js";',
    'export * from "./source-inbox.js";',
    'export * from "./vault.js";',
    'export * from "./workflow.js";',
  ]);
  const usage = /export const usage = `([\s\S]*?)`;/u.exec(cli)?.[1] ?? "";
  expect(createHash("sha256").update(usage).digest("hex"))
    .toBe("4e3c1e971eeef76a4b7479466914480162c1f3f2b6ab3ad2babcbd121a668576");
  const commandIdentities = usage
    .split("\n")
    .filter((line) => line.startsWith("  kb "))
    .map((line) => {
      const tokens = line.trim().split(/\s+/u);
      const command = tokens[1] ?? "";
      const action = tokens[2] ?? "";
      return /^[a-z][a-z-]*$/u.test(action) ? `${command} ${action}` : command;
    })
    .toSorted();
  expect(commandIdentities).toEqual([
    "adapters",
    "agents audit",
    "agents check",
    "agents identity",
    "backlinks",
    "capture diff",
    "capture show",
    "capture verify",
    "catalog",
    "check",
    "clip",
    "context",
    "doctor",
    "evaluate",
    "graph",
    "history",
    "history search",
    "inbox",
    "index",
    "init",
    "inspect",
    "links",
    "list",
    "note create",
    "pdf",
    "percolate",
    "portfolio audit",
    "portfolio search",
    "refresh",
    "relation add",
    "relation list",
    "relation remove",
    "search",
    "url-metadata backfill",
    "url-metadata tool",
  ]);
});

test("denial and no reply produce no mutation attempts", async () => {
  for (const approval of [{ kind: "denied" }, { kind: "unanswered" }] as const) {
    const capabilities = new FakeCapabilities();
    const result = await executeCustomizationContract(
      proposal(),
      approval,
      capabilities,
    );
    expect(result.status).toBe(
      approval.kind === "denied" ? "denied" : "awaiting-approval",
    );
    expect(result.runtimePreparation).toBe("not-needed");
    expect(capabilities.inspections).toEqual([]);
    expect(capabilities.mutations).toEqual([]);
  }
});

test("preapproval inspection instruments every surface without mutation", async () => {
  const requested = proposal({
    reads: [
      { surface: "filesystem", target: "/repo/kb" },
      { surface: "repository", target: "/repo" },
      { surface: "application", target: "editor" },
      { surface: "account", target: "signed-in-profile" },
      { surface: "network", target: "https://example.com/source" },
      { surface: "integration", target: "capture-adapter" },
    ],
  });
  const capabilities = new FakeCapabilities();
  const result = await inspectCustomizationContract(requested, capabilities);

  expect(result.status).toBe("inspected");
  expect(capabilities.inspections.map(({ surface }) => surface)).toEqual([
    "filesystem",
    "repository",
    "application",
    "account",
    "network",
    "integration",
  ]);
  expect(capabilities.mutations).toEqual([]);
});

test("a changed proposal requires renewed approval", async () => {
  const approved = proposal();
  const changed = proposal({
    writes: [{
      surface: "filesystem",
      target: "different/SKILL.md",
      contents: "# Different\n",
    }],
  });
  const capabilities = new FakeCapabilities();
  const result = await executeCustomizationContract(
    changed,
    { kind: "approved", proposalDigest: customizationProposalDigest(approved) },
    capabilities,
  );

  expect(result.status).toBe("needs-reapproval");
  expect(capabilities.mutations).toEqual([]);
});

test("approval writes only exact targets and an exact repeat is a no-op", async () => {
  const requested = proposal({ runtime: "kb-cli" });
  const capabilities = new FakeCapabilities();
  const approval = {
    kind: "approved" as const,
    proposalDigest: customizationProposalDigest(requested),
  };

  const first = await executeCustomizationContract(requested, approval, capabilities);
  expect(first).toMatchObject({
    status: "applied",
    runtimePreparation: "completed",
    changed: ["/approved/skills/save-decision-kb/SKILL.md"],
  });
  expect(capabilities.mutations).toEqual([
    { kind: "prepare-runtime" },
    { kind: "write", target: "/approved/skills/save-decision-kb/SKILL.md" },
  ]);

  capabilities.mutations.length = 0;
  const repeated = await executeCustomizationContract(requested, approval, capabilities);
  expect(repeated).toMatchObject({
    status: "no-op",
    runtimePreparation: "not-needed",
    changed: [],
  });
  expect(capabilities.mutations).toEqual([]);
});

test("divergent content stops without overwrite", async () => {
  const requested = proposal();
  const capabilities = new FakeCapabilities();
  capabilities.files.set(
    "/approved/skills/save-decision-kb/SKILL.md",
    "# Existing divergent skill\n",
  );
  const result = await executeCustomizationContract(
    requested,
    { kind: "approved", proposalDigest: customizationProposalDigest(requested) },
    capabilities,
  );

  expect(result).toMatchObject({ status: "rejected" });
  expect(capabilities.mutations).toEqual([]);
  expect(capabilities.files.get("/approved/skills/save-decision-kb/SKILL.md"))
    .toBe("# Existing divergent skill\n");
});

test("path escape and symbolic links fail before mutation", async () => {
  const escaped = proposal({
    writes: [{
      surface: "filesystem",
      target: "../outside/SKILL.md",
      contents: "# Escape\n",
    }],
  });
  const escapedCapabilities = new FakeCapabilities();
  expect((await executeCustomizationContract(
    escaped,
    { kind: "approved", proposalDigest: customizationProposalDigest(escaped) },
    escapedCapabilities,
  )).status).toBe("rejected");
  expect(escapedCapabilities.mutations).toEqual([]);

  const linked = proposal();
  const linkedCapabilities = new FakeCapabilities();
  linkedCapabilities.states.set(
    "/approved/skills/save-decision-kb/SKILL.md",
    { kind: "missing", hasSymlinkAncestor: true },
  );
  expect((await executeCustomizationContract(
    linked,
    { kind: "approved", proposalDigest: customizationProposalDigest(linked) },
    linkedCapabilities,
  )).status).toBe("rejected");
  expect(linkedCapabilities.mutations).toEqual([]);
});

test("portable path aliases fail before inspection or mutation", async () => {
  for (const [firstTarget, secondTarget] of [
    ["Save-Decision-KB/SKILL.md", "save-decision-kb/skill.md"],
    ["caf\u00e9/SKILL.md", "cafe\u0301/SKILL.md"],
  ] as const) {
    const requested = proposal({
      writes: [
        { surface: "filesystem", target: firstTarget, contents: "# First\n" },
        { surface: "filesystem", target: secondTarget, contents: "# Second\n" },
      ],
    });
    const capabilities = new FakeCapabilities();
    const result = await executeCustomizationContract(
      requested,
      { kind: "approved", proposalDigest: customizationProposalDigest(requested) },
      capabilities,
    );

    expect(result).toMatchObject({
      status: "rejected",
      runtimePreparation: "not-needed",
    });
    expect(result.status === "rejected" ? result.reason : "")
      .toContain("portable path normalization");
    expect(capabilities.mutations).toEqual([]);
  }
});

test("runtime preparation failure is explicit and stops before file writes", async () => {
  const requested = proposal({ runtime: "kb-cli" });
  const capabilities = new FakeCapabilities();
  capabilities.failRuntimePreparation = true;
  const result = await executeCustomizationContract(
    requested,
    { kind: "approved", proposalDigest: customizationProposalDigest(requested) },
    capabilities,
  );

  expect(result).toMatchObject({
    status: "rejected",
    runtimePreparation: "failed",
    reason: "injected runtime preparation failure",
  });
  expect(capabilities.mutations).toEqual([{ kind: "prepare-runtime" }]);
});

test("a mid-write failure is reported once without retry or rollback", async () => {
  const requested = proposal({
    runtime: "kb-cli",
    writes: [
      {
        surface: "filesystem",
        target: "save-decision-kb/SKILL.md",
        contents: "# Save a decision\n",
      },
      {
        surface: "filesystem",
        target: "save-decision-kb/reference.md",
        contents: "# Reference\n",
      },
    ],
  });
  const capabilities = new FakeCapabilities();
  capabilities.failWriteTarget = "/approved/skills/save-decision-kb/reference.md";
  const result = await executeCustomizationContract(
    requested,
    { kind: "approved", proposalDigest: customizationProposalDigest(requested) },
    capabilities,
  );

  expect(result).toMatchObject({
    status: "partial",
    runtimePreparation: "completed",
    changed: ["/approved/skills/save-decision-kb/SKILL.md"],
    failedTarget: "/approved/skills/save-decision-kb/reference.md",
  });
  expect(capabilities.mutations).toEqual([
    { kind: "prepare-runtime" },
    { kind: "write", target: "/approved/skills/save-decision-kb/SKILL.md" },
    { kind: "write", target: "/approved/skills/save-decision-kb/reference.md" },
  ]);
  expect(capabilities.files.has("/approved/skills/save-decision-kb/SKILL.md")).toBe(true);
  expect(capabilities.files.has("/approved/skills/save-decision-kb/reference.md")).toBe(false);
});

test("non-filesystem write surfaces are never treated as approved scaffolding", async () => {
  for (const surface of [
    "repository",
    "application",
    "account",
    "network",
    "integration",
  ] as const) {
    const requested = proposal({
      writes: [{
        surface,
        target: `${surface}/target`,
        contents: "enabled=true\n",
      }],
    });
    const capabilities = new FakeCapabilities();
    const result = await executeCustomizationContract(
      requested,
      { kind: "approved", proposalDigest: customizationProposalDigest(requested) },
      capabilities,
    );

    expect(result).toMatchObject({
      status: "rejected",
      runtimePreparation: "not-needed",
    });
    expect(result.status === "rejected" ? result.reason : "")
      .toContain(JSON.stringify(surface));
    expect(capabilities.mutations).toEqual([]);
  }
});
