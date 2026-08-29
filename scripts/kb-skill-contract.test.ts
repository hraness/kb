import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
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
  const [skill, customize, companionSkills, template] = await Promise.all([
    readFile(resolve(repositoryRoot, "skills/kb/SKILL.md"), "utf8"),
    readFile(resolve(repositoryRoot, "skills/kb/references/customize.md"), "utf8"),
    readFile(resolve(repositoryRoot, "skills/kb/references/companion-skills.md"), "utf8"),
    readFile(resolve(repositoryRoot, "skills/kb/templates/companion-skill.template.md"), "utf8"),
  ]);

  expect(validateKbSkillContractResources({
    skill,
    customize,
    companionSkills,
    template,
  })).toEqual([]);

  expect(validateKbSkillContractResources({
    skill: skill.replace("## Route the request", "## Request routing"),
    customize,
    companionSkills,
    template,
  })).toContain("SKILL.md must route requests before runtime preparation");
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
    changed: ["/approved/skills/save-decision-kb/SKILL.md"],
  });
  expect(capabilities.mutations).toEqual([
    { kind: "prepare-runtime" },
    { kind: "write", target: "/approved/skills/save-decision-kb/SKILL.md" },
  ]);

  capabilities.mutations.length = 0;
  const repeated = await executeCustomizationContract(requested, approval, capabilities);
  expect(repeated).toMatchObject({ status: "no-op", changed: [] });
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

test("a mid-write failure is reported once without retry or rollback", async () => {
  const requested = proposal({
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
    changed: ["/approved/skills/save-decision-kb/SKILL.md"],
    failedTarget: "/approved/skills/save-decision-kb/reference.md",
  });
  expect(capabilities.mutations).toEqual([
    { kind: "write", target: "/approved/skills/save-decision-kb/SKILL.md" },
    { kind: "write", target: "/approved/skills/save-decision-kb/reference.md" },
  ]);
  expect(capabilities.files.has("/approved/skills/save-decision-kb/SKILL.md")).toBe(true);
  expect(capabilities.files.has("/approved/skills/save-decision-kb/reference.md")).toBe(false);
});

test("an external write surface is never treated as approved scaffolding", async () => {
  const requested = proposal({
    writes: [{
      surface: "account",
      target: "profile/preferences",
      contents: "enabled=true\n",
    }],
  });
  const capabilities = new FakeCapabilities();
  const result = await executeCustomizationContract(
    requested,
    { kind: "approved", proposalDigest: customizationProposalDigest(requested) },
    capabilities,
  );

  expect(result).toMatchObject({ status: "rejected" });
  expect(capabilities.mutations).toEqual([]);
});
