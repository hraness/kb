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

export function validateWorkflowYaml(source: string, label: string): void {
  workflowRecord(source, label);
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
  if (
    Object.keys(dispatchInputs).length !== 1
    || publishInput.default !== false
    || publishInput.required !== false
    || publishInput.type !== "boolean"
    || typeof publishInput.description !== "string"
    || publishInput.description.length === 0
  ) {
    throw new Error(`${label} must expose one fail-closed boolean publish_to_npm input`);
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
    || stagePermissions["id-token"] !== "write"
    || Object.keys(stagePermissions).length !== 2
  ) {
    throw new Error(`${label} staging must hold only actions: read and id-token: write`);
  }
  if (stage.environment !== "npm-stage") {
    throw new Error(`${label} staging must use the exact npm-stage environment`);
  }
  if (!Array.isArray(select.steps)) {
    throw new Error(`${label} select steps must be a sequence`);
  }
  const selectionSteps = select.steps.map((step, index) =>
    record(step, `${label} select step ${String(index + 1)}`));
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
  const environment = record(publicationStep.env, `${label} staged-publication environment`);
  for (const name of [
    "DEFAULT_BRANCH",
    "DIGEST",
    "EXPECTED_ARCHIVE_SHA256",
    "EXPECTED_DIGEST_SHA256",
    "EXPECTED_METADATA_SHA256",
    "EXPECTED_SOURCE_SHA",
    "METADATA",
    "TARBALL",
  ]) {
    if (typeof environment[name] !== "string") {
      throw new Error(`${label} staged publication must bind ${name}`);
    }
  }
  const guardCommands = [
    'git init --quiet --bare "$current_main"',
    'git --git-dir="$current_main" fetch',
    'current_default_sha="$(git --git-dir="$current_main" rev-parse FETCH_HEAD)"',
    'current_archive_sha256="$(sha256sum "$TARBALL"',
    'current_metadata_sha256="$(sha256sum "$METADATA"',
    'current_digest_sha256="$(sha256sum "$DIGEST"',
    'npm stage publish "$TARBALL"',
    "--tag latest",
    "--registry=https://registry.npmjs.org",
  ];
  let previousIndex = -1;
  for (const command of guardCommands) {
    const index = publicationStep.run.indexOf(command);
    if (index <= previousIndex) {
      throw new Error(`${label} must recheck current default-branch HEAD immediately before staged publication`);
    }
    previousIndex = index;
  }
  const stageSource = JSON.stringify(stage);
  if (/\bbun\b/u.test(stageSource) || stageSource.includes("./scripts/")) {
    throw new Error(`${label} staging must not execute repository code`);
  }
  if ((source.match(/id-token: write/gu) ?? []).length !== 1) {
    throw new Error(`${label} must grant OIDC authority to exactly one job`);
  }
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, "..");
  for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
    validateWorkflowYaml(await readFile(resolve(repositoryRoot, path), "utf8"), path);
  }
  const npmStagePath = ".github/workflows/npm-stage.yml";
  validateNpmStageWorkflow(
    await readFile(resolve(repositoryRoot, npmStagePath), "utf8"),
    npmStagePath,
  );
}
