import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type CustomizationSurface =
  | "filesystem"
  | "repository"
  | "application"
  | "account"
  | "network"
  | "integration";

export type CustomizationProposal = {
  readonly id: string;
  readonly root: string;
  readonly runtime: "none" | "kb-cli";
  readonly reads: readonly {
    readonly surface: CustomizationSurface;
    readonly target: string;
  }[];
  readonly writes: readonly {
    readonly surface: CustomizationSurface;
    readonly target: string;
    readonly contents: string;
  }[];
};

export type CustomizationApproval =
  | { readonly kind: "approved"; readonly proposalDigest: string }
  | { readonly kind: "denied" }
  | { readonly kind: "unanswered" };

export type CustomizationTargetState =
  | { readonly kind: "missing"; readonly hasSymlinkAncestor: boolean }
  | {
    readonly kind: "file";
    readonly contents: string;
    readonly hasSymlinkAncestor: boolean;
  }
  | { readonly kind: "symlink"; readonly hasSymlinkAncestor: boolean }
  | { readonly kind: "other"; readonly hasSymlinkAncestor: boolean };

export type CustomizationCapabilities = {
  readonly inspect: (
    surface: CustomizationSurface,
    target: string,
  ) => Promise<void>;
  readonly inspectWriteTarget: (
    absolutePath: string,
  ) => Promise<CustomizationTargetState>;
  readonly prepareRuntime: () => Promise<void>;
  readonly writeFileAtomic: (
    absolutePath: string,
    contents: string,
  ) => Promise<void>;
};

export type RuntimePreparationStatus = "not-needed" | "completed" | "failed";

type CustomizationExecutionTrace = {
  readonly proposalDigest: string;
  readonly runtimePreparation: RuntimePreparationStatus;
};

export type CustomizationExecutionResult = CustomizationExecutionTrace & (
  | { readonly status: "awaiting-approval" }
  | { readonly status: "denied" }
  | { readonly status: "needs-reapproval" }
  | {
    readonly status: "rejected";
    readonly reason: string;
  }
  | {
    readonly status: "no-op" | "applied";
    readonly changed: readonly string[];
  }
  | {
    readonly status: "partial";
    readonly changed: readonly string[];
    readonly failedTarget: string;
    readonly reason: string;
  }
);

export type CustomizationInspectionResult =
  | { readonly status: "inspected"; readonly proposalDigest: string }
  | {
    readonly status: "rejected";
    readonly proposalDigest: string;
    readonly reason: string;
  };

type PreparedWrite = {
  readonly absolutePath: string;
  readonly contents: string;
  readonly state: CustomizationTargetState;
};

const MAX_INSPECTIONS = 64;
const MAX_WRITES = 16;
const MAX_CONTENT_BYTES = 1024 * 1024;

function canonicalProposal(proposal: CustomizationProposal): string {
  return JSON.stringify({
    id: proposal.id,
    root: proposal.root,
    runtime: proposal.runtime,
    reads: proposal.reads.map(({ surface, target }) => ({ surface, target })),
    writes: proposal.writes.map(({ surface, target, contents }) => ({
      surface,
      target,
      contents,
    })),
  });
}

export function customizationProposalDigest(
  proposal: CustomizationProposal,
): string {
  return createHash("sha256").update(canonicalProposal(proposal)).digest("hex");
}

export async function inspectCustomizationContract(
  proposal: CustomizationProposal,
  capabilities: Pick<CustomizationCapabilities, "inspect">,
): Promise<CustomizationInspectionResult> {
  const proposalDigest = customizationProposalDigest(proposal);
  if (proposal.reads.length > MAX_INSPECTIONS) {
    return {
      status: "rejected",
      proposalDigest,
      reason: `proposal exceeds ${MAX_INSPECTIONS} read surfaces`,
    };
  }
  for (const read of proposal.reads) {
    await capabilities.inspect(read.surface, read.target);
  }
  return { status: "inspected", proposalDigest };
}

function confinedTarget(root: string, target: string): string | null {
  if (!isAbsolute(root) || isAbsolute(target) || target.length === 0) {
    return null;
  }
  const absolutePath = resolve(root, target);
  const fromRoot = relative(root, absolutePath);
  if (
    fromRoot.length === 0
    || fromRoot === ".."
    || fromRoot.startsWith(`..${sep}`)
    || isAbsolute(fromRoot)
  ) {
    return null;
  }
  return absolutePath;
}

/**
 * Build a deterministic caseless filesystem identity with JavaScript's
 * locale-independent Unicode casing tables. NFKC joins canonically and
 * compatibly equivalent spellings. Lowercasing normalizes context-sensitive
 * forms, while the final uppercase pass joins Greek final sigma and expands
 * sharp S to its multi-code-point portable identity.
 */
function portableTargetIdentity(absolutePath: string): string {
  return absolutePath
    .normalize("NFKC")
    .toLowerCase()
    .toUpperCase()
    .normalize("NFC");
}

function validateProposalShape(proposal: CustomizationProposal): string | null {
  if (proposal.id.trim().length === 0) {
    return "proposal id is required";
  }
  if (proposal.reads.length > MAX_INSPECTIONS) {
    return `proposal exceeds ${MAX_INSPECTIONS} read surfaces`;
  }
  if (proposal.writes.length > MAX_WRITES) {
    return `proposal exceeds ${MAX_WRITES} write targets`;
  }
  const targets = new Set<string>();
  let contentBytes = 0;
  for (const write of proposal.writes) {
    if (write.surface !== "filesystem") {
      return `write surface ${JSON.stringify(write.surface)} is not an approved scaffold surface`;
    }
    const absolutePath = confinedTarget(proposal.root, write.target);
    if (absolutePath === null) {
      return `write target ${JSON.stringify(write.target)} escapes the approved root`;
    }
    const targetIdentity = portableTargetIdentity(absolutePath);
    if (targets.has(targetIdentity)) {
      return `write target ${JSON.stringify(write.target)} aliases another scaffold target after portable path normalization`;
    }
    targets.add(targetIdentity);
    contentBytes += Buffer.byteLength(write.contents, "utf8");
    if (contentBytes > MAX_CONTENT_BYTES) {
      return `proposal exceeds ${MAX_CONTENT_BYTES} bytes of durable output`;
    }
  }
  return null;
}

export async function executeCustomizationContract(
  proposal: CustomizationProposal,
  approval: CustomizationApproval,
  capabilities: CustomizationCapabilities,
): Promise<CustomizationExecutionResult> {
  const proposalDigest = customizationProposalDigest(proposal);
  const noRuntime = {
    proposalDigest,
    runtimePreparation: "not-needed" as const,
  };

  if (approval.kind === "unanswered") {
    return { status: "awaiting-approval", ...noRuntime };
  }
  if (approval.kind === "denied") {
    return { status: "denied", ...noRuntime };
  }
  if (approval.proposalDigest !== proposalDigest) {
    return { status: "needs-reapproval", ...noRuntime };
  }

  const shapeError = validateProposalShape(proposal);
  if (shapeError !== null) {
    return { status: "rejected", ...noRuntime, reason: shapeError };
  }

  const prepared: PreparedWrite[] = [];
  for (const write of proposal.writes) {
    const absolutePath = confinedTarget(proposal.root, write.target);
    if (absolutePath === null) {
      return {
        status: "rejected",
        ...noRuntime,
        reason: `write target ${JSON.stringify(write.target)} escapes the approved root`,
      };
    }
    const state = await capabilities.inspectWriteTarget(absolutePath);
    if (state.hasSymlinkAncestor || state.kind === "symlink") {
      return {
        status: "rejected",
        ...noRuntime,
        reason: `write target ${JSON.stringify(write.target)} crosses a symbolic link`,
      };
    }
    if (state.kind === "other") {
      return {
        status: "rejected",
        ...noRuntime,
        reason: `write target ${JSON.stringify(write.target)} is not a regular file`,
      };
    }
    if (state.kind === "file" && state.contents !== write.contents) {
      return {
        status: "rejected",
        ...noRuntime,
        reason: `write target ${JSON.stringify(write.target)} has divergent content`,
      };
    }
    prepared.push({ absolutePath, contents: write.contents, state });
  }

  const changed: string[] = [];
  for (const write of prepared) {
    if (write.state.kind !== "file") {
      changed.push(write.absolutePath);
    }
  }

  if (changed.length === 0) {
    return {
      status: "no-op",
      ...noRuntime,
      changed: Object.freeze([]),
    };
  }

  let runtimePreparation: RuntimePreparationStatus = "not-needed";
  if (proposal.runtime === "kb-cli") {
    try {
      await capabilities.prepareRuntime();
      runtimePreparation = "completed";
    } catch (error) {
      return {
        status: "rejected",
        proposalDigest,
        runtimePreparation: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const completed: string[] = [];
  for (const write of prepared) {
    if (write.state.kind === "file") {
      continue;
    }
    try {
      await capabilities.writeFileAtomic(write.absolutePath, write.contents);
      completed.push(write.absolutePath);
    } catch (error) {
      return {
        status: "partial",
        proposalDigest,
        runtimePreparation,
        changed: Object.freeze([...completed]),
        failedTarget: write.absolutePath,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    status: "applied",
    proposalDigest,
    runtimePreparation,
    changed: Object.freeze(completed),
  };
}

export type KbSkillContractResources = {
  readonly skill: string;
  readonly customize: string;
  readonly companionSkills: string;
  readonly template: string;
  readonly percolate: string;
  readonly design: string;
  readonly readme: string;
  readonly publicSource: string;
};

const CUSTOMIZE_HEADINGS = [
  "Customize a KB setup",
  "Establish the boundary",
  "Inspect without mutation",
  "Interview in small batches",
  "Propose the smallest useful change",
  "Obtain approval",
  "Scaffold within the approved boundary",
  "Start with real material",
  "Verify and hand off",
  "Evolve an existing setup",
] as const;

const COMPANION_HEADINGS = [
  "Companion skill contracts",
  "Identity and routing",
  "Inputs and preconditions",
  "Surfaces and authority",
  "Approval boundary",
  "Execution semantics",
  "Durable outputs and provenance",
  "Verification and KB maintenance",
  "Composition boundary",
  "Review checklist",
] as const;

const TEMPLATE_HEADINGS = [
  "Use when",
  "Do not use when",
  "Inputs and preconditions",
  "Surfaces and authority",
  "Approval",
  "Workflow",
  "Idempotence, retries, and failure",
  "Durable outputs and provenance",
  "Verification",
] as const;

function missingHeadings(contents: string, headings: readonly string[]): string[] {
  const actual = new Set(Array.from(
    contents.matchAll(/^#{1,6}\s+(.+?)\s*$/gmu),
    (match) => match[1] ?? "",
  ));
  return headings.filter((heading) => !actual.has(heading));
}

function templateFrontmatterKeys(contents: string): string[] | null {
  const lines = contents.split("\n");
  if (lines[0] !== "---") {
    return null;
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    return null;
  }
  const keys: string[] = [];
  for (const line of lines.slice(1, end)) {
    if (line.trim().length === 0) {
      continue;
    }
    const match = /^([a-z][a-z0-9_-]*):(?:\s|$)/u.exec(line);
    if (match?.[1] === undefined) {
      return null;
    }
    keys.push(match[1]);
  }
  return keys;
}

export function validateKbSkillContractResources(
  resources: KbSkillContractResources,
): readonly string[] {
  const errors: string[] = [];
  const routeIndex = resources.skill.indexOf("## Route the request");
  const runtimeIndex = resources.skill.indexOf("## Prepare the runtime");
  if (routeIndex < 0 || runtimeIndex < 0 || routeIndex >= runtimeIndex) {
    errors.push("SKILL.md must route requests before runtime preparation");
  }
  for (const link of [
    "references/customize.md",
    "references/companion-skills.md",
  ]) {
    if (!resources.skill.includes(link)) {
      errors.push(`SKILL.md must link ${link}`);
    }
  }
  if (!resources.skill.includes("bun add --global @hraness/kb@0.19.0")) {
    errors.push("SKILL.md must retain the immutable 0.19.0 runtime pin");
  }
  for (const [name, contents, headings] of [
    ["customize.md", resources.customize, CUSTOMIZE_HEADINGS],
    ["companion-skills.md", resources.companionSkills, COMPANION_HEADINGS],
    ["companion-skill.template.md", resources.template, TEMPLATE_HEADINGS],
  ] as const) {
    for (const heading of missingHeadings(contents, headings)) {
      errors.push(`${name} is missing heading ${JSON.stringify(heading)}`);
    }
  }
  const frontmatterKeys = templateFrontmatterKeys(resources.template);
  if (
    frontmatterKeys === null
    || frontmatterKeys.length !== 2
    || frontmatterKeys[0] !== "name"
    || frontmatterKeys[1] !== "description"
  ) {
    errors.push("companion skill template frontmatter must contain only name and description");
  }
  for (const required of [
    "Silence, a denial, or an ambiguous response is not approval.",
    "<explicit-skill-root>/<name>/SKILL.md",
    "Do not run `kb doctor`, `kb init`, `kb index`, QMD",
    "The scaffold executor writes filesystem targets only.",
  ]) {
    if (!resources.customize.includes(required)) {
      errors.push(`customize.md must include ${JSON.stringify(required)}`);
    }
  }
  for (const required of [
    "available through the 0.19 release line",
    "not removed before 0.20.0",
    "any canonical custom predicate",
    "Never write inverse edges",
    "https://gist.github.com/fxchen/773397095d7a6bffda621e4237da0da9",
    "https://gist.github.com/fxchen/09cb410b22c9c5256d80243ee925b57e",
  ]) {
    if (!resources.percolate.includes(required)) {
      errors.push(`percolate.md must include ${JSON.stringify(required)}`);
    }
  }
  for (const required of [
    "ships no `kb_role` field",
    "lifecycle resolver or API",
    "lifecycle CLI",
  ]) {
    if (!resources.design.includes(required) && !resources.readme.includes(required)) {
      errors.push(`public documentation must include ${JSON.stringify(required)}`);
    }
  }
  for (const { label, pattern } of [
    { label: "kb_role", pattern: /\bkb_role\b/iu },
    {
      label: "a lifecycle-role identity",
      pattern:
        /\b(?:KbLifecycle|Lifecycle|Memory|Document|Knowledge|Authority)Role(?:Resolver|Resolution)?\b/iu,
    },
    {
      label: "a lifecycle-role resolver",
      pattern:
        /\b(?:resolve|classify|infer|assign|audit|inspect)(?:KbLifecycle|Lifecycle|Memory|Document|Knowledge|Authority)Role\b/iu,
    },
    {
      label: "a lifecycle-role CLI option",
      pattern:
        /--(?:kb-)?(?:lifecycle-|memory-|document-|knowledge-|authority-)?role\b/iu,
    },
    { label: "kb lifecycle", pattern: /\bkb[ -]lifecycle\b/iu },
  ]) {
    if (pattern.test(resources.publicSource)) {
      errors.push(`public package source must not expose ${label}`);
    }
  }
  return Object.freeze(errors);
}
