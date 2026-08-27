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
  const jobs = record(workflow.jobs, `${label} jobs`);
  const stage = record(jobs.stage, `${label} stage job`);
  if (!Array.isArray(stage.steps)) {
    throw new Error(`${label} stage steps must be a sequence`);
  }
  const steps = stage.steps.map((step, index) =>
    record(step, `${label} stage step ${String(index + 1)}`));
  if (!steps.some((step) =>
    typeof step.uses === "string" && step.uses.startsWith("actions/checkout@"))) {
    throw new Error(`${label} stage job must check out the dispatch commit`);
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
  if (environment.DEFAULT_BRANCH !== "${{ github.event.repository.default_branch }}") {
    throw new Error(`${label} staged publication must bind the repository default branch`);
  }
  const guardCommands = [
    'git fetch origin "$DEFAULT_BRANCH"',
    'remote_head="$(git rev-parse "origin/$DEFAULT_BRANCH")"',
    'if [[ "$GITHUB_SHA" != "$remote_head" ]]; then',
    'npm stage publish "$archive"',
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
