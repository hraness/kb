import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseDocument } from "yaml";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function workflowRecord(source: string, label: string): Record<string, unknown> {
  const document = parseDocument(source, {
    prettyErrors: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(`${label} is invalid YAML: ${document.errors[0]?.message ?? "unknown parse error"}`);
  }
  const workflow = record(document.toJS(), label);
  if (typeof workflow.name !== "string" || workflow.name.length === 0) {
    throw new Error(`${label} name must be a non-empty string`);
  }
  record(workflow.on, `${label} on`);
  const jobs = record(workflow.jobs, `${label} jobs`);
  if (Object.keys(jobs).length === 0) {
    throw new Error(`${label} jobs must not be empty`);
  }
  return workflow;
}

function validateReviewedWorkflowSemantics(
  workflow: Record<string, unknown>,
  expectedSha256: string,
  label: string,
): void {
  const actual = createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(`${label} must retain its exact reviewed workflow semantics`);
  }
}

export function validateWorkflowYaml(source: string, label: string): void {
  workflowRecord(source, label);
}

function jobSteps(job: Record<string, unknown>, label: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(job.steps) || job.steps.length === 0) {
    throw new Error(`${label} steps must be a non-empty sequence`);
  }
  return job.steps.map((step, index) => record(step, `${label} step ${String(index + 1)}`));
}

type ExpectedStep =
  | Readonly<{ if?: string; kind: "run"; name?: string }>
  | Readonly<{ if?: string; kind: "uses"; name?: string; uses: string }>;

function validateExactStepSequence(
  steps: readonly Record<string, unknown>[],
  expected: readonly ExpectedStep[],
  label: string,
): void {
  if (steps.length !== expected.length) {
    throw new Error(`${label} must retain its exact reviewed step sequence`);
  }
  for (const [index, expectedStep] of expected.entries()) {
    const step = steps[index]!;
    const name = typeof step.name === "string" ? step.name : undefined;
    if (name !== expectedStep.name) {
      throw new Error(`${label} must retain its exact reviewed step sequence`);
    }
    if (
      step.if !== expectedStep.if
      || step["continue-on-error"] !== undefined
    ) {
      throw new Error(`${label} must retain fail-closed step control flow`);
    }
    if (expectedStep.kind === "run") {
      if (typeof step.run !== "string" || step.uses !== undefined) {
        throw new Error(`${label} must retain its exact reviewed step sequence`);
      }
    } else if (step.uses !== expectedStep.uses || step.run !== undefined) {
      throw new Error(`${label} must retain its exact reviewed step sequence`);
    }
  }
}

type ProviderExecutable = "curl" | "gh" | "git" | "npm" | "wget";

function shellTokens(source: string): readonly string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/gu;
  for (const match of source.matchAll(pattern)) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

function commandAfterGlobalOptions(
  tokens: readonly string[],
  optionsWithValues: ReadonlySet<string>,
): Readonly<{ arguments: readonly string[]; command?: string }> {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    if (!token.startsWith("-")) {
      return { arguments: tokens.slice(index + 1), command: token };
    }
    if (optionsWithValues.has(token)) index += 1;
    index += 1;
  }
  return { arguments: [] };
}

function isUnexpectedProviderInvocation(
  executable: ProviderExecutable,
  tokens: readonly string[],
): boolean {
  if (executable === "curl" || executable === "wget") return true;
  if (executable === "npm") {
    const invocation = commandAfterGlobalOptions(tokens, new Set([
      "--auth-type",
      "--cache",
      "--globalconfig",
      "--loglevel",
      "--otp",
      "--prefix",
      "--registry",
      "--scope",
      "--userconfig",
      "--workspace",
      "-w",
    ]));
    return invocation.command !== undefined && new Set([
      "access",
      "deprecate",
      "dist-tag",
      "owner",
      "publish",
      "stage",
      "token",
      "unpublish",
    ]).has(invocation.command);
  }
  if (executable === "git") {
    return commandAfterGlobalOptions(tokens, new Set([
      "--config-env",
      "--git-dir",
      "--namespace",
      "--work-tree",
      "-C",
      "-c",
    ])).command === "push";
  }
  const invocation = commandAfterGlobalOptions(tokens, new Set([
    "--hostname",
    "--repo",
    "-R",
  ]));
  if (invocation.command === "release") return true;
  if (invocation.command !== "api") return false;
  return invocation.arguments.some((argument, index) => (
    new Set(["--field", "--input", "--raw-field", "-F", "-f"]).has(argument)
    || /^(?:--field|--input|--raw-field|-F|-f)=/u.test(argument)
    || (
      new Set(["--method", "-X"]).has(argument)
      && new Set(["DELETE", "PATCH", "POST", "PUT"])
        .has((invocation.arguments[index + 1] ?? "").toUpperCase())
    )
    || /^(?:--method|-X)=(?:DELETE|PATCH|POST|PUT)$/iu.test(argument)
  ));
}

function containsUnexpectedProviderInvocation(commands: string): boolean {
  const normalized = commands.replace(/\\\r?\n\s*/gu, " ");
  const shellInvocation = /(?:^|&&|\|\||;|\$\()\s*(?:(?:do|elif|if|then|until|while)\s+)?!?\s*(?:command\s+)?(?:env\s+(?:-[^\s]+\s+)*)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*(?:\/(?:[^/\s]+\/)*)?(npm|gh|git|curl|wget)\b([^;&|]*)/gmu;
  for (const match of normalized.matchAll(shellInvocation)) {
    if (isUnexpectedProviderInvocation(
      match[1] as ProviderExecutable,
      shellTokens(match[2] ?? ""),
    )) return true;
  }

  const embeddedInvocation = /\b(?:execFileSync|execute|spawnSync)\(\s*["'](npm|gh|git|curl|wget)["']\s*,\s*\[([\s\S]*?)\]\s*(?:,|\))/gu;
  for (const match of commands.matchAll(embeddedInvocation)) {
    const arguments_ = [...(match[2] ?? "").matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'/gu)]
      .map((argument) => argument[1] ?? argument[2] ?? "");
    if (isUnexpectedProviderInvocation(
      match[1] as ProviderExecutable,
      arguments_,
    )) return true;
  }
  return false;
}

function validateNoUnexpectedProviderMutations(
  steps: readonly Record<string, unknown>[],
  allowedStepIndex: number,
  allowedCommand: string,
  label: string,
): void {
  const commands = steps.map((step, index) => {
    if (typeof step.run !== "string") return "";
    if (index !== allowedStepIndex) return step.run;
    const occurrences = step.run.split(allowedCommand).length - 1;
    if (occurrences !== 1) {
      throw new Error(`${label} must contain its one reviewed terminal mutation`);
    }
    return step.run.replace(allowedCommand, "");
  }).join("\n");
  if (
    containsUnexpectedProviderInvocation(commands)
    || /["'](?:POST|PUT|PATCH|DELETE)["']/u.test(commands)
    || JSON.stringify(steps).includes("secrets.")
  ) {
    throw new Error(`${label} contains an unexpected provider mutation command`);
  }
}

function validatePinnedActionUses(
  steps: readonly Record<string, unknown>[],
  expected: readonly string[],
  label: string,
): void {
  const actual = steps.flatMap((step) => typeof step.uses === "string" ? [step.uses] : []);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must retain its exact pinned action sequence`);
  }
}

function joinedCommands(steps: readonly Record<string, unknown>[]): string {
  return steps
    .map((step) => typeof step.run === "string" ? step.run : "")
    .join("\n");
}

function validateOwnerTagAuthorization(
  job: Record<string, unknown>,
  label: string,
): void {
  if (Object.keys(record(job.permissions, `${label} permissions`)).length !== 0) {
    throw new Error(`${label} must hold no token permissions`);
  }
  const steps = jobSteps(job, label);
  if (steps.length !== 1 || JSON.stringify(job).includes("actions/checkout@")) {
    throw new Error(`${label} must authorize the tag sender before checkout`);
  }
  const step = steps[0]!;
  const environment = record(step.env, `${label} environment`);
  const command = step.run;
  if (
    step.if !== undefined
    || step["continue-on-error"] !== undefined
    || environment.EXPECTED_ACTOR_ID !== "894119"
    || environment.EXPECTED_REPOSITORY !== "hraness/kb"
    || environment.EXPECTED_REPOSITORY_ID !== "1308971873"
    || environment.REF_PROTECTED !== "${{ github.ref_protected }}"
    || typeof command !== "string"
  ) {
    throw new Error(`${label} must bind the immutable owner and public repository`);
  }
  for (const required of [
    '"$GITHUB_EVENT_NAME" != push',
    '"$GITHUB_ACTOR_ID" != "$EXPECTED_ACTOR_ID"',
    '"$GITHUB_REPOSITORY_ID" != "$EXPECTED_REPOSITORY_ID"',
    '"$REF_PROTECTED" != true',
    "event.sender?.id !== Number(process.env.EXPECTED_ACTOR_ID)",
    'event.sender?.type !== "User"',
    "event.repository?.id !== Number(process.env.EXPECTED_REPOSITORY_ID)",
    'event.repository?.visibility !== "public"',
    "event.repository?.private !== false",
    'event.repository?.default_branch !== "main"',
  ]) {
    if (!command.includes(required)) {
      throw new Error(`${label} is missing ${required}`);
    }
  }
}

export function validateReleaseWorkflow(source: string, label: string): void {
  const workflow = workflowRecord(source, label);
  const triggers = record(workflow.on, `${label} on`);
  const push = record(triggers.push, `${label} push trigger`);
  if (
    Object.keys(triggers).length !== 1
    || !Array.isArray(push.tags)
    || JSON.stringify(push.tags) !== JSON.stringify(["v*", "!v*-beta.*"])
  ) {
    throw new Error(`${label} must accept only stable version-tag pushes`);
  }
  const topPermissions = record(workflow.permissions, `${label} permissions`);
  if (topPermissions.contents !== "read" || Object.keys(topPermissions).length !== 1) {
    throw new Error(`${label} top-level permissions must be contents: read only`);
  }
  const concurrency = record(workflow.concurrency, `${label} concurrency`);
  if (concurrency.group !== "stable-release" || concurrency["cancel-in-progress"] !== false) {
    throw new Error(`${label} must serialize stable releases without cancellation`);
  }

  const jobs = record(workflow.jobs, `${label} jobs`);
  if (JSON.stringify(Object.keys(jobs).sort()) !== JSON.stringify(["authorize", "publish", "verify"])) {
    throw new Error(`${label} must contain exactly authorize, verify, and publish jobs`);
  }
  const authorize = record(jobs.authorize, `${label} authorize job`);
  const verify = record(jobs.verify, `${label} verify job`);
  const publish = record(jobs.publish, `${label} publish job`);
  if ([authorize, verify, publish].some((job) => (
    job.if !== undefined || job["continue-on-error"] !== undefined
  ))) {
    throw new Error(`${label} jobs must retain fail-closed control flow`);
  }
  validateOwnerTagAuthorization(authorize, `${label} owner authorization`);

  const verifyPermissions = record(verify.permissions, `${label} verify permissions`);
  if (
    verify.needs !== "authorize"
    || verifyPermissions.contents !== "read"
    || Object.keys(verifyPermissions).length !== 1
  ) {
    throw new Error(`${label} verification must follow authorization with contents: read only`);
  }
  const verifySteps = jobSteps(verify, `${label} verify`);
  validateExactStepSequence(verifySteps, [
    {
      kind: "uses",
      uses: "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
    },
    {
      kind: "uses",
      uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    },
    {
      kind: "uses",
      uses: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
    },
    { kind: "run", name: "Pin npm" },
    { kind: "run", name: "Verify release identity" },
    { kind: "run", name: "Materialize exact tagged source" },
    { kind: "run", name: "Install tagged source" },
    { kind: "run", name: "Check tagged source" },
    { kind: "run", name: "Verify generated tagged tree" },
    { kind: "run", name: "Verify tagged package boundary" },
    { kind: "run", name: "Verify canonical npm delivery" },
  ], `${label} verification`);
  const verifyCheckout = verifySteps[0]!;
  const verifyCheckoutWith = record(verifyCheckout.with, `${label} verify checkout inputs`);
  if (
    typeof verifyCheckout.uses !== "string"
    || !verifyCheckout.uses.startsWith("actions/checkout@")
    || verifyCheckoutWith["fetch-depth"] !== 0
    || verifyCheckoutWith["persist-credentials"] !== false
    || verifyCheckoutWith.ref !== "main"
  ) {
    throw new Error(`${label} verification must begin from an uncredentialed full-history current-main checkout`);
  }
  const verifyCommands = joinedCommands(verifySteps);
  let previousIndex = -1;
  for (const required of [
    'refs/heads/$DEFAULT_BRANCH:refs/remotes/origin/$DEFAULT_BRANCH',
    'checked_out_head="$(git rev-parse HEAD)"',
    'git merge-base --is-ancestor "$tag_commit" "$default_head"',
    'Tagged and current release workflow controls differ',
    'git worktree add --detach "$source_tree" "$SOURCE_SHA"',
    'current_attestation="$GITHUB_WORKSPACE/scripts/npm-release-attestation.ts"',
    "npm audit signatures",
    'run "$current_attestation"',
  ]) {
    const index = verifyCommands.indexOf(required);
    if (index <= previousIndex) {
      throw new Error(`${label} must bind current controls, tagged source, and npm attestation in order`);
    }
    previousIndex = index;
  }

  const publishPermissions = record(publish.permissions, `${label} publish permissions`);
  if (
    publish.needs !== "verify"
    || publishPermissions.actions !== "read"
    || publishPermissions.contents !== "write"
    || Object.keys(publishPermissions).length !== 2
  ) {
    throw new Error(`${label} publication must follow verification with only actions: read and contents: write`);
  }
  const publishSteps = jobSteps(publish, `${label} publish`);
  validateExactStepSequence(publishSteps, [
    {
      kind: "uses",
      uses: "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
    },
    { kind: "run", name: "Reauthorize current release attempt" },
    { kind: "run", name: "Publish verified GitHub Release" },
  ], `${label} publication`);
  const publishCheckout = publishSteps[0]!;
  const publishCheckoutWith = record(publishCheckout.with, `${label} publish checkout inputs`);
  if (
    publishCheckout.uses !== "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0"
    || publishCheckoutWith["fetch-depth"] !== 0
    || publishCheckoutWith["persist-credentials"] !== false
    || publishCheckoutWith.ref !== "main"
  ) {
    throw new Error(`${label} publication must begin from an uncredentialed full-history current-main checkout`);
  }
  const reauthorizeIndex = publishSteps.findIndex((step) => step.name === "Reauthorize current release attempt");
  const mutationIndex = publishSteps.findIndex((step) =>
    typeof step.run === "string" && step.run.includes('gh release create "$VERIFIED_TAG"'));
  if (reauthorizeIndex !== 1 || mutationIndex <= reauthorizeIndex) {
    throw new Error(`${label} must reauthorize the current attempt immediately before any release mutation boundary`);
  }
  const publishCommands = joinedCommands(publishSteps);
  let publishGuardIndex = -1;
  for (const required of [
    "attempt.triggering_actor?.id !== actorId",
    "Current release attempt is not owner-authorized for this exact public workflow",
    "verify_current_release_controls()",
    'scripts/npm-release-attestation.ts',
    'final_default_sha="$(verify_current_release_controls)"',
    'gh release create "$VERIFIED_TAG"',
    'release.immutable !== true',
    'author?.id !== Number(process.env.EXPECTED_ACTIONS_BOT_ID)',
  ]) {
    const index = publishCommands.indexOf(required);
    if (index <= publishGuardIndex) {
      throw new Error(`${label} must reauthorize and rebind current controls before immutable release publication`);
    }
    publishGuardIndex = index;
  }
  if (
    (source.match(/gh release create "\$VERIFIED_TAG"/gu) ?? []).length !== 1
    || source.includes("id-token: write")
  ) {
    throw new Error(`${label} must contain one tokenless GitHub Release mutation`);
  }
  validateNoUnexpectedProviderMutations(
    publishSteps,
    2,
    'gh release create "$VERIFIED_TAG"',
    `${label} publication`,
  );
  validateReviewedWorkflowSemantics(
    workflow,
    "730142a72697531c636c0979d4499a3934277f5d0057d557ad8419b88a8dade3",
    label,
  );
}

function validatePendingStableReleaseClosure(command: string, label: string): void {
  const latestIndex = command.indexOf('const latestValue = JSON.parse(execute("npm", [');
  const priorTagIndex = command.indexOf('const priorTag = `v${latestValue}`;', latestIndex + 1);
  const tagLookupIndex = command.indexOf('const remoteTagLines = execute("git", [', priorTagIndex + 1);
  const tagErrorIndex = command.indexOf("lacks one annotated Git tag", tagLookupIndex + 1);
  const releaseIndex = command.indexOf('`repos/${repository}/releases/tags/${priorTag}`', tagLookupIndex + 1);
  const latestReleaseIndex = command.indexOf("releases/latest", releaseIndex + 1);
  const comparisonIndex = command.indexOf(
    '`repos/${repository}/compare/${tagIdentity.get("source")}...main`',
    latestReleaseIndex + 1,
  );
  const releaseErrorIndex = command.indexOf(
    "lacks its exact immutable GitHub Release",
    latestReleaseIndex + 1,
  );
  const comparisonErrorIndex = command.indexOf(
    "is not reachable from current main",
    comparisonIndex + 1,
  );
  if (
    latestIndex < 0
    || priorTagIndex <= latestIndex
    || tagLookupIndex <= priorTagIndex
    || tagErrorIndex <= tagLookupIndex
    || releaseIndex <= tagLookupIndex
    || latestReleaseIndex <= releaseIndex
    || comparisonIndex <= latestReleaseIndex
    || releaseErrorIndex <= latestReleaseIndex
    || comparisonErrorIndex <= comparisonIndex
  ) {
    throw new Error(`${label} must prove the prior npm latest release closure in order`);
  }
  for (const required of [
    '"dist-tags.latest",',
    '"--registry=https://registry.npmjs.org",',
    '`https://github.com/${repository}.git`,',
    '`refs/tags/${priorTag}`,',
    '`refs/tags/${priorTag}^{}`,',
    "remoteTagLines.length !== 2",
    'match[2] !== `refs/tags/${priorTag}`',
    'tagIdentity.get("object") === tagIdentity.get("source")',
    'typeof tagIdentity.get("source") !== "string"',
    "release?.tag_name !== priorTag",
    'release?.name !== `KB ${priorTag}`',
    "release?.draft !== false",
    "release?.prerelease !== false",
    "release?.immutable !== true",
    "release?.author?.id !== 41898282",
    'release?.author?.login !== "github-actions[bot]"',
    'release?.author?.type !== "Bot"',
    "!Array.isArray(release?.assets)",
    "release.assets.length !== 0",
    "latestRelease?.id !== release.id",
    "latestRelease?.tag_name !== priorTag",
    "latestRelease?.immutable !== true",
    'comparison?.status !== "ahead" && comparison?.status !== "identical"',
  ]) {
    if (!command.includes(required)) {
      throw new Error(`${label} must prove the prior npm latest release closure`);
    }
  }
}

function validateFinalStableReleaseClosure(command: string, label: string): void {
  const finalLatestGuardIndex = command.indexOf(
    'CURRENT_LATEST="$current_latest" FINAL_LATEST="$final_latest" node -e',
  );
  const finalMainGuardIndex = command.indexOf(
    '"$final_default_sha" != "$EXPECTED_SOURCE_SHA"',
    finalLatestGuardIndex + 1,
  );
  const priorVersionIndex = command.indexOf(
    'prior_version="$(FINAL_LATEST="$final_latest" node -p',
    finalMainGuardIndex + 1,
  );
  const priorTagIndex = command.indexOf('prior_tag="v$prior_version"', priorVersionIndex + 1);
  const tagLookupIndex = command.indexOf(
    'git ls-remote --tags "https://github.com/$GITHUB_REPOSITORY.git"',
    priorTagIndex + 1,
  );
  const releaseIndex = command.indexOf(
    'gh api "repos/$GITHUB_REPOSITORY/releases/tags/$prior_tag"',
    tagLookupIndex + 1,
  );
  const latestReleaseIndex = command.indexOf(
    'gh api "repos/$GITHUB_REPOSITORY/releases/latest"',
    releaseIndex + 1,
  );
  const comparisonIndex = command.indexOf(
    'gh api "repos/$GITHUB_REPOSITORY/compare/$prior_source...$DEFAULT_BRANCH"',
    latestReleaseIndex + 1,
  );
  const comparisonGuardIndex = command.indexOf(
    'comparison?.status !== "ahead" && comparison?.status !== "identical"',
    comparisonIndex + 1,
  );
  const terminalLatestIndex = command.indexOf(
    'terminal_latest="$(npm view "@hraness/kb" dist-tags.latest',
    comparisonGuardIndex + 1,
  );
  const terminalLatestGuardIndex = command.indexOf(
    'FINAL_LATEST="$final_latest" TERMINAL_LATEST="$terminal_latest" node -e',
    terminalLatestIndex + 1,
  );
  const terminalRefsIndex = command.indexOf(
    'git ls-remote --exit-code',
    terminalLatestGuardIndex + 1,
  );
  const candidateTagGuardIndex = command.indexOf(
    "was created after package verification",
    terminalRefsIndex + 1,
  );
  const priorTagGuardIndex = command.indexOf(
    "changed during final release-closure verification",
    candidateTagGuardIndex + 1,
  );
  const terminalRefsGuardIndex = command.indexOf(
    "Could not prove exact",
    priorTagGuardIndex + 1,
  );
  const publishIndex = command.indexOf('npm stage publish "$TARBALL"', terminalRefsGuardIndex + 1);
  if (
    finalLatestGuardIndex < 0
    || finalMainGuardIndex <= finalLatestGuardIndex
    || priorVersionIndex <= finalMainGuardIndex
    || priorTagIndex <= priorVersionIndex
    || tagLookupIndex <= priorTagIndex
    || releaseIndex <= tagLookupIndex
    || latestReleaseIndex <= releaseIndex
    || comparisonIndex <= latestReleaseIndex
    || comparisonGuardIndex <= comparisonIndex
    || terminalLatestIndex <= comparisonGuardIndex
    || terminalLatestGuardIndex <= terminalLatestIndex
    || terminalRefsIndex <= terminalLatestGuardIndex
    || candidateTagGuardIndex <= terminalRefsIndex
    || priorTagGuardIndex <= candidateTagGuardIndex
    || terminalRefsGuardIndex <= priorTagGuardIndex
    || publishIndex <= terminalRefsGuardIndex
  ) {
    throw new Error(`${label} must prove the prior npm latest release closure at the final mutation boundary`);
  }
  const terminalLatestCommand = command.slice(terminalLatestIndex, terminalLatestGuardIndex);
  if (
    !terminalLatestCommand.includes('terminal_latest="$(npm view "@hraness/kb" dist-tags.latest')
    || !terminalLatestCommand.includes("--json")
    || !terminalLatestCommand.includes("--registry=https://registry.npmjs.org")
  ) {
    throw new Error(`${label} must bind the terminal npm latest read to the canonical registry`);
  }
  const terminalRefsCommand = command.slice(terminalRefsIndex, candidateTagGuardIndex);
  if (terminalRefsCommand.includes("--refs")) {
    throw new Error(`${label} final remote snapshot must retain peeled annotated-tag identity`);
  }
  for (const required of [
    'if (typeof current !== "string" || final !== current)',
    'const value = JSON.parse(process.env.FINAL_LATEST ?? "null")',
    '"refs/tags/$prior_tag" "refs/tags/$prior_tag^{}"',
    'const priorTag = process.env.PRIOR_TAG ?? "";',
    'match[2] !== `refs/tags/${priorTag}`',
    'identity.get("object") === identity.get("source")',
    'typeof identity.get("source") !== "string"',
    "release?.tag_name !== priorTag",
    'release?.name !== `KB ${priorTag}`',
    "release?.draft !== false",
    "release?.prerelease !== false",
    "release?.immutable !== true",
    "release?.author?.id !== 41898282",
    'release?.author?.login !== "github-actions[bot]"',
    'release?.author?.type !== "Bot"',
    "!Array.isArray(release?.assets)",
    "release.assets.length !== 0",
    "latestRelease?.id !== release.id",
    "latestRelease?.tag_name !== priorTag",
    "latestRelease?.immutable !== true",
    'comparison?.status !== "ahead" && comparison?.status !== "identical"',
    'const terminal = JSON.parse(process.env.TERMINAL_LATEST ?? "null")',
    'if (typeof final !== "string" || terminal !== final)',
    '"refs/heads/$DEFAULT_BRANCH"',
    '"refs/tags/$release_tag"',
    '"refs/tags/$prior_tag"',
    '"refs/tags/$prior_tag^{}" > "$terminal_refs_output"',
    'const expectedHeadRef = `refs/heads/${process.env.DEFAULT_BRANCH ?? ""}`',
    'const expectedTagRef = `refs/tags/${process.env.RELEASE_TAG ?? ""}`',
    'const priorTagRef = `refs/tags/${process.env.PRIOR_TAG ?? ""}`',
    "PRIOR_TAG_IDENTITY",
    "entries.some((entry) => entry.ref === expectedTagRef)",
    'terminalPriorIdentity.get("object") !== initialPriorIdentity.get("object")',
    'terminalPriorIdentity.get("source") !== initialPriorIdentity.get("source")',
    "entries.length !== 3",
    "headEntries.length !== 1",
    "headEntries[0]?.sha !== expectedSourceSha",
    "Final remote snapshot has malformed identity data",
    "lacks one annotated Git tag",
    "lacks its exact immutable GitHub Release",
    "is not reachable from current main",
  ]) {
    if (!command.includes(required)) {
      throw new Error(`${label} must prove the prior npm latest release closure`);
    }
  }
}

export function validateNpmStageWorkflow(source: string, label: string): void {
  const workflow = workflowRecord(source, label);
  const triggers = record(workflow.on, `${label} on`);
  if (!("workflow_dispatch" in triggers)) {
    throw new Error(`${label} must retain manual recovery dispatch`);
  }
  const dispatch = record(triggers.workflow_dispatch, `${label} workflow dispatch`);
  const dispatchInputs = record(dispatch.inputs, `${label} workflow dispatch inputs`);
  const publishInput = record(
    dispatchInputs.publish_to_npm,
    `${label} publish_to_npm input`,
  );
  const resolvedStageInput = record(
    dispatchInputs.resolved_stage_version,
    `${label} resolved_stage_version input`,
  );
  if (
    Object.keys(dispatchInputs).length !== 2
    || publishInput.default !== false
    || publishInput.required !== false
    || publishInput.type !== "boolean"
    || typeof publishInput.description !== "string"
    || publishInput.description.length === 0
  ) {
    throw new Error(`${label} must expose one fail-closed boolean publish_to_npm input`);
  }
  if (
    resolvedStageInput.default !== ""
    || resolvedStageInput.required !== false
    || resolvedStageInput.type !== "string"
    || typeof resolvedStageInput.description !== "string"
    || resolvedStageInput.description.length === 0
  ) {
    throw new Error(`${label} must expose one empty-by-default resolved_stage_version recovery input`);
  }
  const push = record(triggers.push, `${label} push trigger`);
  if (
    !Array.isArray(push.branches)
    || push.branches.length !== 1
    || push.branches[0] !== "main"
    || !Array.isArray(push.paths)
    || push.paths.length !== 1
    || push.paths[0] !== "package.json"
  ) {
    throw new Error(`${label} must run only for package.json pushes to main`);
  }
  const jobs = record(workflow.jobs, `${label} jobs`);
  const select = record(jobs.select, `${label} select job`);
  const verify = record(jobs.verify, `${label} verify job`);
  const stage = record(jobs.stage, `${label} stage job`);
  if (stage.name !== "Stage exact package v${{ needs.verify.outputs.package_version }}") {
    throw new Error(`${label} staging job name must bind the exact package version`);
  }
  const selectPermissions = record(select.permissions, `${label} select permissions`);
  if (
    selectPermissions.contents !== "read"
    || "id-token" in selectPermissions
    || Object.keys(selectPermissions).length !== 1
  ) {
    throw new Error(`${label} selection must remain read-only without OIDC authority`);
  }
  const selectOutputs = record(select.outputs, `${label} select outputs`);
  if (selectOutputs.should_stage !== "${{ steps.selection.outputs.should_stage }}") {
    throw new Error(`${label} selection must expose the reviewed should_stage decision`);
  }
  if (
    verify.needs !== "select"
    || verify.if !== "needs.select.outputs.should_stage == 'true'"
  ) {
    throw new Error(`${label} verification must require an affirmative stage selection`);
  }
  const verifyPermissions = record(verify.permissions, `${label} verify permissions`);
  if (verifyPermissions.contents !== "read" || "id-token" in verifyPermissions) {
    throw new Error(`${label} verification must remain read-only without OIDC authority`);
  }
  const stagePermissions = record(stage.permissions, `${label} stage permissions`);
  if (stage.needs !== "verify" || stage.if !== "inputs.publish_to_npm == true") {
    throw new Error(`${label} staging must require explicit publish_to_npm opt-in`);
  }
  if (
    stagePermissions.actions !== "read"
    || stagePermissions.contents !== "read"
    || stagePermissions["id-token"] !== "write"
    || Object.keys(stagePermissions).length !== 3
  ) {
    throw new Error(`${label} staging must hold only actions: read, contents: read, and id-token: write`);
  }
  if (stage.environment !== "npm-stage") {
    throw new Error(`${label} staging must use the exact npm-stage environment`);
  }
  if (
    select.if !== undefined
    || select["continue-on-error"] !== undefined
    || verify["continue-on-error"] !== undefined
    || stage["continue-on-error"] !== undefined
  ) {
    throw new Error(`${label} jobs must retain fail-closed control flow`);
  }
  if (!Array.isArray(select.steps)) {
    throw new Error(`${label} select steps must be a sequence`);
  }
  const selectionSteps = select.steps.map((step, index) =>
    record(step, `${label} select step ${String(index + 1)}`));
  validatePinnedActionUses(selectionSteps, [
    "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
    "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
  ], `${label} selection`);
  const verificationSteps = jobSteps(verify, `${label} verification`);
  validateExactStepSequence(verificationSteps, [
    {
      kind: "uses",
      uses: "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
    },
    {
      kind: "uses",
      uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    },
    {
      kind: "uses",
      uses: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
    },
    { kind: "run", name: "Pin npm" },
    { kind: "run", name: "Require current default-branch head" },
    { kind: "run", name: "Verify package can be staged" },
    { kind: "run" },
    { kind: "run" },
    { kind: "run", name: "Verify generated tree" },
    { kind: "run", name: "Prepare and smoke exact npm artifact" },
    {
      kind: "uses",
      name: "Upload reviewed npm artifact",
      uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    },
  ], `${label} verification`);
  if (
    verificationSteps[6]?.run !== "bun install --frozen-lockfile --ignore-scripts"
    || verificationSteps[7]?.run !== "bun run check"
  ) {
    throw new Error(`${label} verification must retain its exact package gate commands`);
  }
  const selectionCommands = selectionSteps.filter((step) =>
    typeof step.run === "string" && step.run.includes("scripts/npm-stage-selection.ts"));
  if (selectionCommands.length !== 1 || typeof selectionCommands[0]?.run !== "string") {
    throw new Error(`${label} must contain exactly one package-version selection step`);
  }
  const selectionCommand = selectionCommands[0].run;
  for (const required of [
    'git fetch --no-tags origin',
    'git merge-base --is-ancestor "$BEFORE_SHA" "$default_head"',
    'git show "$BEFORE_SHA:package.json"',
    'bun run ./scripts/npm-stage-selection.ts',
  ]) {
    if (!selectionCommand.includes(required)) {
      throw new Error(`${label} package-version selection is missing ${required}`);
    }
  }
  if (!Array.isArray(stage.steps)) {
    throw new Error(`${label} stage steps must be a sequence`);
  }
  const steps = stage.steps.map((step, index) =>
    record(step, `${label} stage step ${String(index + 1)}`));
  validateExactStepSequence(steps, [
    { kind: "run", name: "Reauthorize current npm staging attempt" },
    {
      kind: "uses",
      uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    },
    { kind: "run", name: "Pin npm" },
    { kind: "run", name: "Reject unresolved stable-stage intent" },
    {
      kind: "run",
      if: "inputs.resolved_stage_version != ''",
      name: "Record cleared stable-stage intent v${{ inputs.resolved_stage_version }}",
    },
    { kind: "run", name: "Bind artifact reference" },
    {
      kind: "uses",
      name: "Download reviewed package",
      uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    },
    { kind: "run", name: "Rebind downloaded package" },
    { kind: "run", name: "Record exclusive stable-stage intent" },
    { kind: "run", name: "Revalidate current main and stage exact package" },
  ], `${label} staging`);
  const setupNodeWith = record(steps[1]?.with, `${label} stage setup-node inputs`);
  if (
    setupNodeWith["node-version"] !== "24"
    || setupNodeWith["package-manager-cache"] !== false
    || setupNodeWith["registry-url"] !== "https://registry.npmjs.org"
    || Object.keys(setupNodeWith).length !== 3
  ) {
    throw new Error(`${label} staging must retain the exact reviewed setup-node inputs`);
  }
  const downloadWith = record(steps[6]?.with, `${label} stage download inputs`);
  if (
    downloadWith.name !== "${{ needs.verify.outputs.artifact_name }}"
    || downloadWith.path !== "${{ runner.temp }}/kb-npm-stage"
    || Object.keys(downloadWith).length !== 2
  ) {
    throw new Error(`${label} staging must retain the exact reviewed artifact download inputs`);
  }
  const authorizationStep = steps[0];
  if (
    authorizationStep?.name !== "Reauthorize current npm staging attempt"
    || typeof authorizationStep.run !== "string"
  ) {
    throw new Error(`${label} staging must reauthorize the current attempt before any other step`);
  }
  const authorizationEnvironment = record(
    authorizationStep.env,
    `${label} staging authorization environment`,
  );
  if (
    authorizationEnvironment.EXPECTED_ACTOR_ID !== "894119"
    || authorizationEnvironment.EXPECTED_REPOSITORY !== "hraness/kb"
    || authorizationEnvironment.EXPECTED_REPOSITORY_ID !== "1308971873"
    || authorizationEnvironment.EXPECTED_SOURCE_SHA !== "${{ needs.verify.outputs.source_sha }}"
    || authorizationEnvironment.EXPECTED_WORKFLOW_ID !== "344070109"
    || authorizationEnvironment.EXPECTED_WORKFLOW_NAME !== "Stage npm package"
    || authorizationEnvironment.EXPECTED_WORKFLOW_PATH !== ".github/workflows/npm-stage.yml"
    || authorizationEnvironment.GH_TOKEN !== "${{ github.token }}"
    || authorizationEnvironment.PUBLISH_TO_NPM !== "${{ inputs.publish_to_npm }}"
    || authorizationEnvironment.REF_PROTECTED !== "${{ github.ref_protected }}"
  ) {
    throw new Error(`${label} staging authorization must bind the exact owner, repository, workflow, source, input, and protected ref`);
  }
  for (const required of [
    '"$GITHUB_ACTOR_ID" != "$EXPECTED_ACTOR_ID"',
    '"$GITHUB_EVENT_NAME" != workflow_dispatch',
    '"$GITHUB_REPOSITORY_ID" != "$EXPECTED_REPOSITORY_ID"',
    '"$GITHUB_REF" != refs/heads/main',
    '"$GITHUB_SHA" != "$EXPECTED_SOURCE_SHA"',
    '"$PUBLISH_TO_NPM" != true',
    '"$REF_PROTECTED" != true',
    'attempt.id !== runId',
    'attempt.run_attempt !== runAttempt',
    'attempt.workflow_id !== workflowId',
    'attempt.name !== process.env.EXPECTED_WORKFLOW_NAME',
    'attempt.path !== process.env.EXPECTED_WORKFLOW_PATH',
    'attempt.event !== "workflow_dispatch"',
    'attempt.head_branch !== "main"',
    'attempt.head_sha !== process.env.EXPECTED_SHA',
    'attempt.actor?.id !== actorId',
    'attempt.actor?.type !== "User"',
    'attempt.triggering_actor?.id !== actorId',
    'attempt.triggering_actor?.type !== "User"',
    'attempt.repository?.id !== repositoryId',
    'workflow.id !== workflowId',
    'workflow.name !== process.env.EXPECTED_WORKFLOW_NAME',
    'workflow.path !== process.env.EXPECTED_WORKFLOW_PATH',
    'workflow.state !== "active"',
    'repository.id !== repositoryId',
    'repository.visibility !== "public"',
    'repository.default_branch !== "main"',
  ]) {
    if (!authorizationStep.run.includes(required)) {
      throw new Error(`${label} staging attempt authorization is missing ${required}`);
    }
  }
  for (const stepName of [
    "Bind artifact reference",
    "Rebind downloaded package",
    "Revalidate current main and stage exact package",
  ]) {
    const boundary = steps.find((step) => step.name === stepName);
    if (
      boundary === undefined
      || typeof boundary.run !== "string"
      || !boundary.run.includes("BigInt(Number.MAX_SAFE_INTEGER)")
      || !boundary.run.includes("Verified package version components exceed Number.MAX_SAFE_INTEGER")
    ) {
      throw new Error(`${label} ${stepName} must reject unsafe stable-version components`);
    }
  }
  const pendingStageStep = steps.find((step) => step.name === "Reject unresolved stable-stage intent");
  if (pendingStageStep === undefined || typeof pendingStageStep.run !== "string") {
    throw new Error(`${label} must reject another unresolved stage intent`);
  }
  if (!pendingStageStep.run.includes("BigInt(Number.MAX_SAFE_INTEGER)")) {
    throw new Error(`${label} pending-stage guard must reject unsafe stable-version components`);
  }
  const pendingStageEnvironment = record(
    pendingStageStep.env,
    `${label} pending-stage environment`,
  );
  if (
    pendingStageEnvironment.EXPECTED_VERSION !== "${{ needs.verify.outputs.package_version }}"
    || pendingStageEnvironment.EXPECTED_WORKFLOW_ID !== "344070109"
    || pendingStageEnvironment.GH_TOKEN !== "${{ github.token }}"
    || pendingStageEnvironment.RESOLVED_STAGE_VERSION !== "${{ inputs.resolved_stage_version }}"
  ) {
    throw new Error(`${label} pending-stage guard must bind exact workflow history and recovery input`);
  }
  for (const required of [
    "Completed npm-stage history exceeds the reviewed 100-run bound",
    "Stage exact package v",
    "already reserved stable stage",
    "does not identify a blocking intent",
    "Record exclusive stable-stage intent",
    "Record cleared stable-stage intent",
    "jobs?filter=all&per_page=100",
    "has a terminal write without one immediately preceding durable intent",
    "has an unsealed generic stage job",
    "jobId: 99146963354",
    "Number.isSafeInteger(step?.number)",
    "intents[0].number !== terminalWrites[0].number - 1",
    "contains staging controls outside a version-bound stage job",
    'execute("npm", [',
    "dist-tags.latest",
  ]) {
    if (!pendingStageStep.run.includes(required)) {
      throw new Error(`${label} pending-stage guard is missing ${required}`);
    }
  }
  validatePendingStableReleaseClosure(
    pendingStageStep.run,
    `${label} pending-stage guard`,
  );
  const terminalInspectionIndex = pendingStageStep.run.indexOf("const terminalWrites =");
  const jobDisplayNameFilterIndex = pendingStageStep.run.indexOf(
    'if (!job.name.startsWith("Stage exact package"))',
  );
  if (
    terminalInspectionIndex < 0
    || jobDisplayNameFilterIndex < 0
    || terminalInspectionIndex >= jobDisplayNameFilterIndex
  ) {
    throw new Error(`${label} must inspect terminal writes before trusting a job display name`);
  }
  if (steps.some((step) =>
    typeof step.uses === "string"
    && (step.uses.startsWith("actions/checkout@") || step.uses.startsWith("oven-sh/setup-bun@")))) {
    throw new Error(`${label} staging must not check out source or install Bun`);
  }
  const publicationSteps = steps.filter((step) =>
    typeof step.run === "string" && step.run.includes("npm stage publish"));
  if (publicationSteps.length !== 1) {
    throw new Error(`${label} must contain exactly one staged-publication step`);
  }
  const publicationStep = publicationSteps[0];
  if (publicationStep === undefined || typeof publicationStep.run !== "string") {
    throw new Error(`${label} staged-publication command is missing`);
  }
  const intentSteps = steps.filter((step) => step.name === "Record exclusive stable-stage intent");
  const resolutionSteps = steps.filter((step) =>
    step.name === "Record cleared stable-stage intent v${{ inputs.resolved_stage_version }}");
  if (
    intentSteps.length !== 1
    || resolutionSteps.length !== 1
    || steps.indexOf(intentSteps[0]!) !== steps.indexOf(publicationStep) - 1
    || steps.indexOf(resolutionSteps[0]!) <= steps.indexOf(pendingStageStep)
    || steps.indexOf(resolutionSteps[0]!) >= steps.indexOf(intentSteps[0]!)
  ) {
    throw new Error(`${label} must persist resolution and exclusive intent immediately before mutation`);
  }
  const intentStep = intentSteps[0]!;
  const resolutionStep = resolutionSteps[0]!;
  const intentEnvironment = record(intentStep.env, `${label} stable-stage intent environment`);
  const resolutionEnvironment = record(
    resolutionStep.env,
    `${label} stable-stage resolution environment`,
  );
  if (
    typeof intentStep.run !== "string"
    || intentEnvironment.EXPECTED_VERSION !== "${{ needs.verify.outputs.package_version }}"
    || !intentStep.run.includes("$GITHUB_RUN_ID")
    || !intentStep.run.includes("$GITHUB_RUN_ATTEMPT")
    || resolutionStep.if !== "inputs.resolved_stage_version != ''"
    || typeof resolutionStep.run !== "string"
    || resolutionEnvironment.RESOLVED_STAGE_VERSION !== "${{ inputs.resolved_stage_version }}"
  ) {
    throw new Error(`${label} stable-stage intent and resolution identities are incomplete`);
  }
  const environment = record(publicationStep.env, `${label} staged-publication environment`);
  const expectedEnvironment = {
    DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}",
    DIGEST: "${{ steps.artifact.outputs.digest }}",
    EXPECTED_ARCHIVE_SHA256: "${{ steps.artifact.outputs.archive_sha256 }}",
    EXPECTED_DIGEST_SHA256: "${{ steps.artifact.outputs.digest_sha256 }}",
    EXPECTED_METADATA_SHA256: "${{ steps.artifact.outputs.metadata_sha256 }}",
    EXPECTED_SOURCE_SHA: "${{ needs.verify.outputs.source_sha }}",
    EXPECTED_VERSION: "${{ needs.verify.outputs.package_version }}",
    GH_TOKEN: "${{ github.token }}",
    METADATA: "${{ steps.artifact.outputs.metadata }}",
    TARBALL: "${{ steps.artifact.outputs.tarball }}",
  } as const;
  if (
    Object.keys(environment).length !== Object.keys(expectedEnvironment).length
    || Object.entries(expectedEnvironment).some(([name, value]) => environment[name] !== value)
  ) {
    throw new Error(`${label} staged publication must bind its exact reviewed environment`);
  }
  const guardCommands = [
    'git init --quiet --bare "$current_main"',
    'git --git-dir="$current_main" fetch',
    'current_default_sha="$(git --git-dir="$current_main" rev-parse FETCH_HEAD)"',
    'npm view "@hraness/kb" dist-tags.latest',
    'current_archive_sha256="$(sha256sum "$TARBALL"',
    'current_metadata_sha256="$(sha256sum "$METADATA"',
    'current_digest_sha256="$(sha256sum "$DIGEST"',
    "npm config get tag",
    'final_default_sha="$(git --git-dir="$current_main" rev-parse FETCH_HEAD)"',
    'final_latest="$(npm view "@hraness/kb" dist-tags.latest',
    "Public npm latest changed immediately before staged publication",
    "$DEFAULT_BRANCH changed immediately before staged publication",
    'prior_version="$(FINAL_LATEST="$final_latest" node -p',
    'git ls-remote --tags "https://github.com/$GITHUB_REPOSITORY.git"',
    'gh api "repos/$GITHUB_REPOSITORY/releases/tags/$prior_tag"',
    'gh api "repos/$GITHUB_REPOSITORY/releases/latest"',
    'gh api "repos/$GITHUB_REPOSITORY/compare/$prior_source...$DEFAULT_BRANCH"',
    'terminal_latest="$(npm view "@hraness/kb" dist-tags.latest',
    "Public npm latest changed during final release-closure verification",
    'git ls-remote --exit-code',
    '"refs/heads/$DEFAULT_BRANCH"',
    '"refs/tags/$release_tag"',
    '"refs/tags/$prior_tag"',
    '"refs/tags/$prior_tag^{}"',
    "changed during final release-closure verification",
    "Could not prove exact",
    'npm stage publish "$TARBALL"',
  ];
  let previousIndex = -1;
  for (const command of guardCommands) {
    const index = publicationStep.run.indexOf(command, previousIndex + 1);
    if (index <= previousIndex) {
      throw new Error(`${label} must recheck current default-branch HEAD immediately before staged publication`);
    }
    previousIndex = index;
  }
  const finalFetchIndex = publicationStep.run.lastIndexOf(
    'git --git-dir="$current_main" fetch',
  );
  const npmConfigIndex = publicationStep.run.indexOf("npm config get tag");
  const finalDefaultIndex = publicationStep.run.indexOf(
    'final_default_sha="$(git --git-dir="$current_main" rev-parse FETCH_HEAD)"',
  );
  if (
    finalFetchIndex <= npmConfigIndex
    || finalFetchIndex >= finalDefaultIndex
    || (publicationStep.run.match(/git --git-dir="\$current_main" fetch/gu) ?? []).length !== 2
    || (publicationStep.run.match(/npm view "@hraness\/kb" dist-tags\.latest/gu) ?? []).length !== 3
  ) {
    throw new Error(`${label} must re-read current main and npm latest at the final mutation boundary`);
  }
  validateFinalStableReleaseClosure(
    publicationStep.run,
    `${label} staged-publication boundary`,
  );
  for (const message of [
    "lacks one annotated Git tag",
    "lacks its exact immutable GitHub Release",
    "is not reachable from current main",
  ]) {
    if ((source.match(new RegExp(message, "gu")) ?? []).length !== 2) {
      throw new Error(`${label} must repeat the prior npm latest release closure at both boundaries`);
    }
  }
  const publishIndex = publicationStep.run.indexOf('npm stage publish "$TARBALL"');
  if (!publicationStep.run.slice(publishIndex).includes("--registry=https://registry.npmjs.org")) {
    throw new Error(`${label} staged publication must bind the canonical npm registry`);
  }
  if (/--tag(?:=|\s)/u.test(publicationStep.run)) {
    throw new Error(`${label} must preserve pinned npm's default-tag monotonicity guard`);
  }
  validateNoUnexpectedProviderMutations(
    steps,
    9,
    'npm stage publish "$TARBALL"',
    `${label} staging`,
  );
  const stageSource = JSON.stringify(stage);
  if (/\bbun\b/u.test(stageSource) || stageSource.includes("./scripts/")) {
    throw new Error(`${label} staging must not execute repository code`);
  }
  if ((source.match(/id-token: write/gu) ?? []).length !== 1) {
    throw new Error(`${label} must grant OIDC authority to exactly one job`);
  }
  validateReviewedWorkflowSemantics(
    workflow,
    "92d4df09713882861aaa5fdd9163792771d1c2f687e9fc946b661c740c1dd8e2",
    label,
  );
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, "..");
  validateWorkflowYaml(
    await readFile(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8"),
    ".github/workflows/ci.yml",
  );
  validateReleaseWorkflow(
    await readFile(resolve(repositoryRoot, ".github/workflows/release.yml"), "utf8"),
    ".github/workflows/release.yml",
  );
  const npmStagePath = ".github/workflows/npm-stage.yml";
  validateNpmStageWorkflow(
    await readFile(resolve(repositoryRoot, npmStagePath), "utf8"),
    npmStagePath,
  );
}
