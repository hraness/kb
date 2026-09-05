import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_ACTOR_ID = 894119;
const EXPECTED_PACKAGE = "@hraness/kb";
const EXPECTED_REPOSITORY = "hraness/kb";
const EXPECTED_REPOSITORY_ID = 1308971873;
const EXPECTED_REMOTE_URLS = new Set([
  "git@github.com:hraness/kb.git",
  "https://github.com/hraness/kb.git",
  "ssh://git@github.com/hraness/kb.git",
]);
const DEFAULT_BRANCH = "main";
const CI_WORKFLOW_NAME = "CI";
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const CI_REQUIRED_JOB = "Required";
const RELEASE_ENVIRONMENT = "npm-stage";
const RELEASE_RULESET_POLICIES = [
  { bypassOwner: true, name: "Release tag creation", rules: ["creation"] },
  { bypassOwner: false, name: "Immutable version tags", rules: ["deletion", "update"] },
] as const;
const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const MAXIMUM_INVENTORY_ITEMS = 100;
const MAXIMUM_TAG_LINES = 2_000;
const PROCESS_TIMEOUT_MS = 30_000;
const SHA = /^[0-9a-f]{40}$/u;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-beta\.(0|[1-9][0-9]*))?$/u;

type JsonRecord = Record<string, unknown>;

export type ReleaseVersion = Readonly<{
  beta: bigint | null;
  parts: readonly [bigint, bigint, bigint];
  tag: string;
  version: string;
}>;

export type CiRunIdentity = Readonly<{ runAttempt: number; runId: number }>;

export type RemoteTagAdmission = "absent" | "same-annotated-commit";

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as JsonRecord;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function parseReleaseVersion(value: string): ReleaseVersion {
  const match = VERSION.exec(value);
  if (match === null) {
    throw new Error(`Release version ${value} is not canonical stable or beta.<number> SemVer.`);
  }
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  if (major === undefined || minor === undefined || patch === undefined) {
    throw new Error("Release version parser lost a required SemVer component.");
  }
  return Object.freeze({
    beta: match[4] === undefined ? null : BigInt(match[4]),
    parts: Object.freeze([BigInt(major), BigInt(minor), BigInt(patch)]) as readonly [bigint, bigint, bigint],
    tag: `v${value}`,
    version: value,
  });
}

export function compareReleaseVersions(left: ReleaseVersion, right: ReleaseVersion): number {
  for (let index = 0; index < left.parts.length; index += 1) {
    const leftPart = left.parts[index]!;
    const rightPart = right.parts[index]!;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  if (left.beta === null && right.beta === null) return 0;
  if (left.beta === null) return 1;
  if (right.beta === null) return -1;
  return left.beta === right.beta ? 0 : left.beta > right.beta ? 1 : -1;
}

export function admitOwner(value: unknown): void {
  const actor = record(value, "GitHub authentication receipt");
  if (actor.id !== EXPECTED_ACTOR_ID || actor.type !== "User") {
    throw new Error(`Release-tag authentication must be immutable owner User ${String(EXPECTED_ACTOR_ID)}.`);
  }
}

export function admitRepository(value: unknown): void {
  const repository = record(value, "GitHub repository receipt");
  if (
    repository.full_name !== EXPECTED_REPOSITORY
    || repository.id !== EXPECTED_REPOSITORY_ID
    || repository.default_branch !== DEFAULT_BRANCH
    || repository.archived !== false
    || repository.disabled !== false
    || repository.private !== false
    || repository.visibility !== "public"
  ) {
    throw new Error(`Release-tag authentication must address active ${EXPECTED_REPOSITORY} with default branch ${DEFAULT_BRANCH}.`);
  }
}

export function admitReleaseEnvironment(environmentValue: unknown, policiesValue: unknown): void {
  const environment = record(environmentValue, "npm release environment receipt");
  const deploymentPolicy = record(environment.deployment_branch_policy, "npm release deployment policy");
  if (
    environment.name !== RELEASE_ENVIRONMENT
    || environment.can_admins_bypass !== false
    || deploymentPolicy.custom_branch_policies !== true
    || deploymentPolicy.protected_branches !== false
    || !Array.isArray(environment.protection_rules)
    || environment.protection_rules.length !== 1
    || record(environment.protection_rules[0], "npm release protection rule").type !== "branch_policy"
  ) {
    throw new Error(`${RELEASE_ENVIRONMENT} must have no administrator bypass or reviewers and use only branch_policy protection.`);
  }
  const policies = record(policiesValue, "npm release deployment-policy receipt");
  if (
    policies.total_count !== 1
    || !Array.isArray(policies.branch_policies)
    || policies.branch_policies.length !== 1
  ) throw new Error(`${RELEASE_ENVIRONMENT} must admit exactly one deployment policy.`);
  const policy = record(policies.branch_policies[0], "npm release deployment policy entry");
  if (policy.name !== "v*" || policy.type !== "tag") {
    throw new Error(`${RELEASE_ENVIRONMENT} must admit only the v* tag policy.`);
  }
}

function releaseRulesetIdentities(value: unknown): ReadonlyMap<string, number> {
  if (!Array.isArray(value) || value.length > MAXIMUM_INVENTORY_ITEMS) {
    throw new Error("GitHub ruleset inventory is malformed or exceeds its bound.");
  }
  const identities = new Map<string, number>();
  for (const expected of RELEASE_RULESET_POLICIES) {
    const matches = value
      .map((item) => record(item, "GitHub ruleset summary"))
      .filter((item) => item.name === expected.name);
    if (matches.length !== 1 || !positiveInteger(matches[0]?.id)) {
      throw new Error(`Expected exactly one ${expected.name} ruleset.`);
    }
    identities.set(expected.name, matches[0].id);
  }
  return identities;
}

export function admitReleaseRulesets(
  listValue: unknown,
  detailValues: ReadonlyMap<string, unknown>,
): void {
  const identities = releaseRulesetIdentities(listValue);
  for (const expected of RELEASE_RULESET_POLICIES) {
    const expectedId = identities.get(expected.name);
    const detailValue = detailValues.get(expected.name);
    if (expectedId === undefined || detailValue === undefined) {
      throw new Error(`Missing exact ${expected.name} ruleset readback.`);
    }
    const detail = record(detailValue, `${expected.name} ruleset`);
    const conditions = record(detail.conditions, `${expected.name} ruleset conditions`);
    const refName = record(conditions.ref_name, `${expected.name} ruleset ref condition`);
    if (
      detail.id !== expectedId
      || detail.name !== expected.name
      || detail.target !== "tag"
      || detail.enforcement !== "active"
      || !Array.isArray(refName.exclude)
      || refName.exclude.length !== 0
      || !Array.isArray(refName.include)
      || refName.include.length !== 1
      || refName.include[0] !== "refs/tags/v*"
      || !Array.isArray(detail.rules)
      || detail.rules.length > 20
    ) throw new Error(`${expected.name} does not protect the exact release-tag namespace.`);
    const ruleTypes = detail.rules.map((rule) => record(rule, `${expected.name} rule`).type).sort();
    if (
      ruleTypes.some((type) => typeof type !== "string")
      || JSON.stringify(ruleTypes) !== JSON.stringify([...expected.rules].sort())
    ) throw new Error(`${expected.name} has unexpected rules.`);
    if (!Array.isArray(detail.bypass_actors) || detail.bypass_actors.length > 10) {
      throw new Error(`${expected.name} has malformed bypass authority.`);
    }
    const bypassActors = detail.bypass_actors.map((value) => {
      const actor = record(value, `${expected.name} bypass actor`);
      if (!positiveInteger(actor.actor_id) || typeof actor.actor_type !== "string" || typeof actor.bypass_mode !== "string") {
        throw new Error(`${expected.name} has malformed bypass authority.`);
      }
      return { actor_id: actor.actor_id, actor_type: actor.actor_type, bypass_mode: actor.bypass_mode };
    });
    const expectedBypass = expected.bypassOwner
      ? [{ actor_id: EXPECTED_ACTOR_ID, actor_type: "User", bypass_mode: "always" }]
      : [];
    if (JSON.stringify(bypassActors) !== JSON.stringify(expectedBypass)) {
      throw new Error(`${expected.name} has unexpected bypass authority.`);
    }
  }
}

export function admitRemoteRoutes(fetchOutput: string, pushOutput: string): void {
  const lines = (value: string): string[] => value.trimEnd().split("\n");
  const fetchUrls = lines(fetchOutput);
  const pushUrls = lines(pushOutput);
  if (
    fetchUrls.length !== 1
    || pushUrls.length !== 1
    || !EXPECTED_REMOTE_URLS.has(fetchUrls[0] ?? "")
    || !EXPECTED_REMOTE_URLS.has(pushUrls[0] ?? "")
  ) throw new Error(`Origin fetch and push routing must each name only canonical ${EXPECTED_REPOSITORY}.`);
}

export function admitProtectedBranch(value: unknown, expectedSha: string): void {
  if (!SHA.test(expectedSha)) throw new Error("Protected-main verification requires one lowercase commit SHA.");
  const branch = record(value, "GitHub protected-branch receipt");
  const commit = record(branch.commit, "GitHub protected-branch commit");
  if (branch.name !== DEFAULT_BRANCH || branch.protected !== true || commit.sha !== expectedSha) {
    throw new Error(`Release commit must be the exact protected ${DEFAULT_BRANCH} head.`);
  }
}

export function admitActiveCiWorkflow(value: unknown): number {
  const workflow = record(value, "CI workflow receipt");
  if (
    !positiveInteger(workflow.id)
    || workflow.name !== CI_WORKFLOW_NAME
    || workflow.path !== CI_WORKFLOW_PATH
    || workflow.state !== "active"
  ) {
    throw new Error(`CI must be the exact active ${CI_WORKFLOW_PATH} workflow.`);
  }
  return workflow.id;
}

export function admitCiRun(
  value: unknown,
  workflowId: number,
  expectedSha: string,
): CiRunIdentity {
  if (!positiveInteger(workflowId) || !SHA.test(expectedSha)) {
    throw new Error("CI run verification received an invalid workflow or commit identity.");
  }
  const inventory = record(value, "CI run inventory");
  if (
    !Number.isSafeInteger(inventory.total_count)
    || Number(inventory.total_count) < 0
    || !Array.isArray(inventory.workflow_runs)
    || inventory.workflow_runs.length > MAXIMUM_INVENTORY_ITEMS
    || inventory.total_count !== inventory.workflow_runs.length
  ) {
    throw new Error("CI run inventory is malformed or truncated.");
  }
  const candidates = inventory.workflow_runs.filter((item) => {
    const run = record(item, "CI run");
    const repository = record(run.repository, "CI run repository");
    const headRepository = record(run.head_repository, "CI run head repository");
    return run.workflow_id === workflowId
      && run.name === CI_WORKFLOW_NAME
      && run.path === CI_WORKFLOW_PATH
      && run.event === "push"
      && run.head_branch === DEFAULT_BRANCH
      && run.head_sha === expectedSha
      && repository.full_name === EXPECTED_REPOSITORY
      && headRepository.full_name === EXPECTED_REPOSITORY;
  });
  if (candidates.length !== 1) {
    throw new Error("Current main must have exactly one exact CI push run.");
  }
  const run = record(candidates[0], "Exact CI run");
  if (
    !positiveInteger(run.id)
    || !positiveInteger(run.run_attempt)
    || run.status !== "completed"
    || run.conclusion !== "success"
  ) {
    throw new Error("The exact current-main CI push run is not successful.");
  }
  return Object.freeze({ runAttempt: run.run_attempt, runId: run.id });
}

export function admitCiRequiredJob(value: unknown, run: CiRunIdentity, expectedSha: string): number {
  if (!positiveInteger(run.runId) || !positiveInteger(run.runAttempt) || !SHA.test(expectedSha)) {
    throw new Error("CI job verification received an invalid run or commit identity.");
  }
  const inventory = record(value, "CI job inventory");
  if (
    !Number.isSafeInteger(inventory.total_count)
    || Number(inventory.total_count) < 0
    || !Array.isArray(inventory.jobs)
    || inventory.jobs.length > MAXIMUM_INVENTORY_ITEMS
    || inventory.total_count !== inventory.jobs.length
  ) {
    throw new Error("CI job inventory is malformed or truncated.");
  }
  const candidates = inventory.jobs.filter((item) => {
    const job = record(item, "CI job");
    return job.name === CI_REQUIRED_JOB
      && job.run_id === run.runId
      && job.run_attempt === run.runAttempt
      && job.head_sha === expectedSha;
  });
  if (candidates.length !== 1) {
    throw new Error(`Exact CI run attempt must have one ${CI_REQUIRED_JOB} job.`);
  }
  const job = record(candidates[0], `Exact ${CI_REQUIRED_JOB} job`);
  if (!positiveInteger(job.id) || job.status !== "completed" || job.conclusion !== "success") {
    throw new Error(`The exact CI run attempt ${CI_REQUIRED_JOB} job is not successful.`);
  }
  return job.id;
}

export function admitRemoteReleaseTags(
  text: string,
  expectedVersion: string,
  expectedSha: string,
): RemoteTagAdmission {
  if (!SHA.test(expectedSha)) throw new Error("Remote tag verification requires one lowercase commit SHA.");
  if (new TextEncoder().encode(text).byteLength > MAXIMUM_OUTPUT_BYTES) {
    throw new Error("Remote tag inventory exceeds its byte bound.");
  }
  const expected = parseReleaseVersion(expectedVersion);
  const lines = text === "" ? [] : text.replace(/\n$/u, "").split("\n");
  if (lines.length > MAXIMUM_TAG_LINES || lines.some((line) => line.length > 512 || line.length === 0)) {
    throw new Error("Remote tag inventory is malformed or exceeds its line bound.");
  }
  const tags = new Map<string, { object?: string; peeled?: string }>();
  for (const line of lines) {
    const match = /^([0-9a-f]{40})\trefs\/tags\/(v[^\s^]+)(\^\{\})?$/u.exec(line);
    if (match === null) throw new Error("Remote tag inventory contains a malformed ref.");
    const sha = match[1];
    const tag = match[2];
    const suffix = match[3];
    if (sha === undefined || tag === undefined) throw new Error("Remote tag inventory lost a ref component.");
    parseReleaseVersion(tag.slice(1));
    const current = tags.get(tag) ?? {};
    const field = suffix === undefined ? "object" : "peeled";
    if (current[field] !== undefined) throw new Error(`Remote tag inventory repeats ${tag}${suffix ?? ""}.`);
    current[field] = sha;
    tags.set(tag, current);
  }
  for (const [tag, identity] of tags) {
    if (identity.object === undefined || identity.peeled === identity.object) {
      throw new Error(`Remote tag inventory has an invalid ${tag} identity.`);
    }
  }
  const exact = tags.get(expected.tag);
  if (exact !== undefined) {
    if (exact.peeled === undefined || exact.peeled !== expectedSha) {
      throw new Error(`${expected.tag} conflicts with the requested annotated tag and commit.`);
    }
    return "same-annotated-commit";
  }
  const relevant = [...tags.keys()]
    .map((tag) => parseReleaseVersion(tag.slice(1)))
    .filter((candidate) => expected.beta !== null || candidate.beta === null);
  const blocker = relevant.find((candidate) => compareReleaseVersions(expected, candidate) <= 0);
  if (blocker !== undefined) {
    throw new Error(`${expected.tag} must increase monotonically beyond ${blocker.tag}.`);
  }
  return "absent";
}

type CommandResult = Readonly<{ exitCode: number; stderr: string; stdout: string }>;

async function readBounded(stream: ReadableStream<Uint8Array>, label: string): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAXIMUM_OUTPUT_BYTES) throw new Error(`${label} exceeded its output bound.`);
    chunks.push(next.value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(combined);
}

async function command(
  argv: readonly string[],
  options: Readonly<{ allowFailure?: boolean; cwd: string; label: string }>,
): Promise<CommandResult> {
  const child = Bun.spawn([...argv], {
    cwd: options.cwd,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const completed = Promise.all([
      child.exited,
      readBounded(child.stdout, `${options.label} stdout`),
      readBounded(child.stderr, `${options.label} stderr`),
    ] as const);
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`${options.label} timed out.`)), PROCESS_TIMEOUT_MS);
    });
    const [exitCode, stdout, stderr] = await Promise.race([completed, timedOut]);
    const result = Object.freeze({ exitCode, stderr, stdout });
    if (exitCode !== 0 && options.allowFailure !== true) {
      const detail = stderr.trim().slice(0, 2_000);
      throw new Error(`${options.label} failed${detail === "" ? "." : `: ${detail}`}`);
    }
    return result;
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function jsonCommand(argv: readonly string[], root: string, label: string): Promise<unknown> {
  const result = await command(argv, { cwd: root, label });
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
}

async function refreshMain(root: string, expectedSha?: string): Promise<string> {
  await command(
    ["git", "fetch", "--no-tags", "origin", `refs/heads/${DEFAULT_BRANCH}:refs/remotes/origin/${DEFAULT_BRANCH}`],
    { cwd: root, label: `Fetch ${DEFAULT_BRANCH}` },
  );
  const head = (await command(["git", "rev-parse", "HEAD"], { cwd: root, label: "Read HEAD" })).stdout.trim();
  const remote = (
    await command(["git", "rev-parse", `refs/remotes/origin/${DEFAULT_BRANCH}`], {
      cwd: root,
      label: `Read origin/${DEFAULT_BRANCH}`,
    })
  ).stdout.trim();
  if (!SHA.test(head) || head !== remote || (expectedSha !== undefined && head !== expectedSha)) {
    throw new Error(`Release checkout must be exact current origin/${DEFAULT_BRANCH}.`);
  }
  return head;
}

async function remoteTagInventory(root: string): Promise<string> {
  return (
    await command(["git", "ls-remote", "--tags", "origin", "refs/tags/v*"], {
      cwd: root,
      label: "Read remote release tags",
    })
  ).stdout;
}

async function requireLocalTag(root: string, tag: string, sha: string, message: string): Promise<void> {
  const type = (await command(["git", "cat-file", "-t", `refs/tags/${tag}`], { cwd: root, label: `Read ${tag} type` })).stdout.trim();
  const commit = (
    await command(["git", "rev-parse", `refs/tags/${tag}^{commit}`], { cwd: root, label: `Read ${tag} commit` })
  ).stdout.trim();
  const object = (await command(["git", "cat-file", "tag", `refs/tags/${tag}`], { cwd: root, label: `Read ${tag} object` })).stdout;
  const separator = object.indexOf("\n\n");
  const headers = separator === -1 ? [] : object.slice(0, separator).split("\n");
  const body = separator === -1 ? "" : object.slice(separator + 2).trimEnd();
  if (
    type !== "tag"
    || commit !== sha
    || !headers.includes(`object ${sha}`)
    || !headers.includes("type commit")
    || !headers.includes(`tag ${tag}`)
    || body !== message
  ) {
    throw new Error(`Local ${tag} conflicts with the exact annotated release tag.`);
  }
}

async function main(): Promise<void> {
  const [versionArgument, ...extraArguments] = Bun.argv.slice(2);
  if (versionArgument === undefined || extraArguments.length !== 0) {
    throw new Error("Usage: bun run ./scripts/push-npm-release-tag.ts <stable-or-beta-version>");
  }
  const release = parseReleaseVersion(versionArgument);
  const root = realpathSync(resolve(import.meta.dir, ".."));
  const reportedRoot = realpathSync(
    (await command(["git", "rev-parse", "--show-toplevel"], { cwd: root, label: "Resolve repository root" })).stdout.trim(),
  );
  if (reportedRoot !== root) throw new Error("Release-tag script is not running in its owning repository.");
  const branch = (await command(["git", "branch", "--show-current"], { cwd: root, label: "Read current branch" })).stdout.trim();
  if (branch !== DEFAULT_BRANCH) throw new Error(`Release-tag script must run on ${DEFAULT_BRANCH}.`);
  const fetchUrls = (
    await command(["git", "remote", "get-url", "--all", "origin"], { cwd: root, label: "Read origin fetch URLs" })
  ).stdout;
  const pushUrls = (
    await command(["git", "remote", "get-url", "--push", "--all", "origin"], { cwd: root, label: "Read origin push URLs" })
  ).stdout;
  admitRemoteRoutes(fetchUrls, pushUrls);
  const status = (
    await command(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: root, label: "Read worktree status" })
  ).stdout;
  if (status !== "") throw new Error("Release-tag script requires a clean worktree.");

  const packagePath = resolve(root, "package.json");
  const packageStat = lstatSync(packagePath);
  if (!packageStat.isFile() || packageStat.isSymbolicLink() || packageStat.size > MAXIMUM_OUTPUT_BYTES) {
    throw new Error("package.json must be one bounded regular file.");
  }
  const packageJson = record(JSON.parse(readFileSync(packagePath, "utf8")) as unknown, "package.json");
  if (packageJson.name !== EXPECTED_PACKAGE || packageJson.version !== release.version) {
    throw new Error(`Requested version must exactly match ${EXPECTED_PACKAGE} in package.json.`);
  }

  admitOwner(await jsonCommand(["gh", "api", "user"], root, "Verify GitHub authentication"));
  admitRepository(
    await jsonCommand(["gh", "api", `repos/${EXPECTED_REPOSITORY}`], root, "Verify GitHub repository"),
  );
  const rulesetList = await jsonCommand(
    ["gh", "api", "--method", "GET", `repos/${EXPECTED_REPOSITORY}/rulesets`, "-f", "per_page=100"],
    root,
    "Read release rulesets",
  );
  const rulesetDetails = new Map<string, unknown>();
  for (const [name, id] of releaseRulesetIdentities(rulesetList)) {
    rulesetDetails.set(
      name,
      await jsonCommand(["gh", "api", `repos/${EXPECTED_REPOSITORY}/rulesets/${String(id)}`], root, `Verify ${name}`),
    );
  }
  admitReleaseRulesets(rulesetList, rulesetDetails);
  admitReleaseEnvironment(
    await jsonCommand(
      ["gh", "api", `repos/${EXPECTED_REPOSITORY}/environments/${RELEASE_ENVIRONMENT}`],
      root,
      "Verify npm release environment",
    ),
    await jsonCommand(
      [
        "gh", "api", "--method", "GET",
        `repos/${EXPECTED_REPOSITORY}/environments/${RELEASE_ENVIRONMENT}/deployment-branch-policies`,
        "-f", "per_page=100",
      ],
      root,
      "Verify npm release deployment policies",
    ),
  );
  const sha = await refreshMain(root);
  admitProtectedBranch(
    await jsonCommand(["gh", "api", `repos/${EXPECTED_REPOSITORY}/branches/${DEFAULT_BRANCH}`], root, "Verify protected main"),
    sha,
  );
  const workflowId = admitActiveCiWorkflow(
    await jsonCommand(
      ["gh", "api", `repos/${EXPECTED_REPOSITORY}/actions/workflows/ci.yml`],
      root,
      "Verify active CI workflow",
    ),
  );
  const runInventory = await jsonCommand(
    [
      "gh", "api", "--method", "GET", `repos/${EXPECTED_REPOSITORY}/actions/workflows/ci.yml/runs`,
      "-f", `branch=${DEFAULT_BRANCH}`, "-f", "event=push", "-f", `head_sha=${sha}`, "-F", "per_page=100",
    ],
    root,
    "Read exact CI run",
  );
  const run = admitCiRun(runInventory, workflowId, sha);
  const jobs = await jsonCommand(
    [
      "gh", "api", "--method", "GET",
      `repos/${EXPECTED_REPOSITORY}/actions/runs/${String(run.runId)}/attempts/${String(run.runAttempt)}/jobs`,
      "-F", "per_page=100",
    ],
    root,
    "Read exact CI attempt jobs",
  );
  const jobId = admitCiRequiredJob(jobs, run, sha);

  const firstAdmission = admitRemoteReleaseTags(await remoteTagInventory(root), release.version, sha);
  if (firstAdmission === "same-annotated-commit") {
    console.log(`${release.tag} already exists as the exact annotated release tag at ${sha}.`);
    return;
  }

  await refreshMain(root, sha);
  admitProtectedBranch(
    await jsonCommand(["gh", "api", `repos/${EXPECTED_REPOSITORY}/branches/${DEFAULT_BRANCH}`], root, "Reverify protected main"),
    sha,
  );
  const secondAdmission = admitRemoteReleaseTags(await remoteTagInventory(root), release.version, sha);
  if (secondAdmission === "same-annotated-commit") {
    console.log(`${release.tag} was concurrently created as the exact annotated release tag at ${sha}.`);
    return;
  }

  const releaseMessage = `Release ${EXPECTED_PACKAGE}@${release.version}`;
  const localLookup = await command(["git", "show-ref", "--verify", "--quiet", `refs/tags/${release.tag}`], {
    allowFailure: true,
    cwd: root,
    label: `Check local ${release.tag}`,
  });
  if (localLookup.exitCode === 0) {
    throw new Error(`Local ${release.tag} already exists while the remote tag is absent; refusing an inherited tag object.`);
  }
  if (localLookup.exitCode !== 1) {
    throw new Error(`Could not determine whether local ${release.tag} exists.`);
  }

  await command(["git", "tag", "--annotate", release.tag, sha, "--message", releaseMessage], {
    cwd: root,
    label: `Create local ${release.tag}`,
  });
  const createdTagObject = (
    await command(["git", "rev-parse", `refs/tags/${release.tag}`], {
      cwd: root,
      label: `Read created ${release.tag} object`,
    })
  ).stdout.trim();
  if (!SHA.test(createdTagObject)) throw new Error(`Created ${release.tag} has an invalid object identity.`);

  try {
    await requireLocalTag(root, release.tag, sha, releaseMessage);
    const push = await command(
      ["git", "push", "origin", `refs/tags/${release.tag}:refs/tags/${release.tag}`],
      { allowFailure: true, cwd: root, label: `Push exact ${release.tag} ref` },
    );
    const finalAdmission = admitRemoteReleaseTags(await remoteTagInventory(root), release.version, sha);
    if (finalAdmission !== "same-annotated-commit") {
      const detail = push.stderr.trim().slice(0, 2_000);
      throw new Error(`Exact release tag push did not produce the requested remote tag${detail === "" ? "." : `: ${detail}`}`);
    }
  } catch (error) {
    const cleanup = await command(
      ["git", "update-ref", "-d", `refs/tags/${release.tag}`, createdTagObject],
      { allowFailure: true, cwd: root, label: `Compare-delete unverified local ${release.tag}` },
    );
    if (cleanup.exitCode !== 0) {
      throw new AggregateError(
        [error, new Error(`Local ${release.tag} changed after creation and was not deleted.`)],
        `Release-tag publication failed and safe local cleanup was not possible.`,
      );
    }
    throw error;
  }
  console.log(
    `${release.tag} is the exact annotated release tag at ${sha}; CI run ${String(run.runId)} attempt ${String(run.runAttempt)} Required job ${String(jobId)} was successful.`,
  );
}

if (import.meta.main) {
  await main();
}
