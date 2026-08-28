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
  if (
    stagePermissions["id-token"] !== "write"
    || Object.keys(stagePermissions).length !== 1
  ) {
    throw new Error(`${label} staging must hold only id-token: write`);
  }
  if (stage.environment !== "npm-stage") {
    throw new Error(`${label} staging must use the protected npm-stage environment`);
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
