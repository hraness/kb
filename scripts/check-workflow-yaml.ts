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
  const document = parseDocument(source, { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(`${label} is invalid YAML: ${document.errors[0]?.message ?? "unknown parse error"}`);
  }
  const workflow = record(document.toJS(), label);
  if (typeof workflow.name !== "string" || workflow.name.length === 0) {
    throw new Error(`${label} name must be a non-empty string`);
  }
  record(workflow.on, `${label} on`);
  const jobs = record(workflow.jobs, `${label} jobs`);
  if (Object.keys(jobs).length === 0) throw new Error(`${label} jobs must not be empty`);
  return workflow;
}

export function validateWorkflowYaml(source: string, label: string): void {
  workflowRecord(source, label);
}

function validateOwnerTagAuthorization(
  workflow: Record<string, unknown>,
  label: string,
  dependentJobName: string,
): void {
  const jobs = record(workflow.jobs, `${label} jobs`);
  const authorize = record(jobs.authorize, `${label} authorize job`);
  if (Object.keys(record(authorize.permissions, `${label} authorize permissions`)).length !== 0) {
    throw new Error(`${label} owner authorization must have no token permissions`);
  }
  if (!Array.isArray(authorize.steps) || authorize.steps.length !== 1) {
    throw new Error(`${label} owner authorization must be one pre-checkout step`);
  }
  const step = record(authorize.steps[0], `${label} owner authorization step`);
  const environment = record(step.env, `${label} owner authorization environment`);
  const run = step.run;
  if (
    environment.EXPECTED_ACTOR_ID !== "894119"
    || environment.EXPECTED_REPOSITORY !== "hraness/kb"
    || environment.EXPECTED_REPOSITORY_ID !== "1308971873"
    || environment.REF_PROTECTED !== "${{ github.ref_protected }}"
    || typeof run !== "string"
    || !run.includes('"$GITHUB_ACTOR_ID" != "$EXPECTED_ACTOR_ID"')
    || !run.includes("event.sender?.id !== Number(process.env.EXPECTED_ACTOR_ID)")
    || !run.includes('event.sender?.type !== "User"')
    || !run.includes("event.repository?.id !== Number(process.env.EXPECTED_REPOSITORY_ID)")
    || !run.includes('event.repository?.visibility !== "public"')
    || !run.includes("event.repository?.private !== false")
  ) {
    throw new Error(`${label} owner authorization is missing an exact actor, sender, or public-repository guard`);
  }
  if (JSON.stringify(authorize).includes("actions/checkout@")) {
    throw new Error(`${label} must authorize the tag sender before checkout`);
  }
  const dependent = record(jobs[dependentJobName], `${label} ${dependentJobName} job`);
  if (dependent.needs !== "authorize") {
    throw new Error(`${label} ${dependentJobName} must follow owner authorization`);
  }
}

export function validateOwnerTagWorkflow(source: string, label: string): void {
  const workflow = workflowRecord(source, label);
  validateOwnerTagAuthorization(workflow, label, "verify");
}

export function validateNpmPublishWorkflow(source: string, label: string): void {
  const workflow = workflowRecord(source, label);
  const triggers = record(workflow.on, `${label} on`);
  if (Object.keys(triggers).length !== 1 || !("push" in triggers)) {
    throw new Error(`${label} must accept only protected release-tag pushes`);
  }
  const push = record(triggers.push, `${label} push trigger`);
  if (!Array.isArray(push.tags) || push.tags.length !== 1 || push.tags[0] !== "v*") {
    throw new Error(`${label} must accept exactly v* tag pushes`);
  }

  const permissions = record(workflow.permissions, `${label} permissions`);
  if (permissions.contents !== "read" || Object.keys(permissions).length !== 1) {
    throw new Error(`${label} top-level permissions must be contents: read only`);
  }
  const jobs = record(workflow.jobs, `${label} jobs`);
  const authorize = record(jobs.authorize, `${label} authorize job`);
  const select = record(jobs.select, `${label} select job`);
  const verify = record(jobs.verify, `${label} verify job`);
  const publish = record(jobs.publish, `${label} publish job`);
  validateOwnerTagAuthorization(workflow, label, "select");

  const selectPermissions = record(select.permissions, `${label} select permissions`);
  if (
    select.needs !== "authorize"
    || selectPermissions.contents !== "read"
    || Object.keys(selectPermissions).length !== 1
  ) throw new Error(`${label} selection must follow authorization and remain read-only`);
  const selectOutputs = record(select.outputs, `${label} select outputs`);
  if (
    selectOutputs.should_publish !== "${{ steps.selection.outputs.should_publish }}"
    || selectOutputs.publish_tag !== "${{ steps.selection.outputs.publish_tag }}"
  ) throw new Error(`${label} selection must expose the reviewed decision and tag`);
  const selectionSource = JSON.stringify(select);
  for (const required of [
    "GITHUB_EVENT_NAME",
    "GITHUB_SHA",
    "GITHUB_REF_NAME",
    "github.ref_protected",
    "refs/remotes/origin/$DEFAULT_BRANCH",
    "refs/npm-publish-tags/$GITHUB_REF_NAME",
    "git cat-file -t",
    "exact annotated release tag",
    "publish_tag=latest",
    "publish_tag=beta",
  ]) {
    if (!selectionSource.includes(required)) throw new Error(`${label} tag selection is missing ${required}`);
  }

  const verifyPermissions = record(verify.permissions, `${label} verify permissions`);
  if (
    verify.needs !== "select"
    || verify.if !== "needs.select.outputs.should_publish == 'true'"
    || verifyPermissions.contents !== "read"
    || Object.keys(verifyPermissions).length !== 1
  ) throw new Error(`${label} package verification must follow selection and remain read-only`);

  const publishPermissions = record(publish.permissions, `${label} publish permissions`);
  if (publishPermissions["id-token"] !== "write" || Object.keys(publishPermissions).length !== 1) {
    throw new Error(`${label} terminal publishing must hold only id-token: write`);
  }
  if (publish.environment !== "npm-stage") {
    throw new Error(`${label} publishing must use the exact npm-stage environment`);
  }
  if (!Array.isArray(publish.steps)) throw new Error(`${label} publish steps must be a sequence`);
  const steps = publish.steps.map((step, index) => record(step, `${label} publish step ${String(index + 1)}`));
  if (steps.some((step) =>
    typeof step.uses === "string"
    && (step.uses.startsWith("actions/checkout@") || step.uses.startsWith("oven-sh/setup-bun@")))) {
    throw new Error(`${label} publishing must not check out source or install Bun`);
  }
  const publicationSteps = steps.filter((step) =>
    typeof step.run === "string" && step.run.includes('npm publish "$TARBALL"'));
  if (publicationSteps.length !== 1 || typeof publicationSteps[0]?.run !== "string") {
    throw new Error(`${label} must contain exactly one direct-publication step`);
  }
  const publicationStep = publicationSteps[0];
  const environment = record(publicationStep.env, `${label} direct-publication environment`);
  for (const name of [
    "DEFAULT_BRANCH",
    "DIGEST",
    "EXPECTED_ARCHIVE_SHA256",
    "EXPECTED_DIGEST_SHA256",
    "EXPECTED_METADATA_SHA256",
    "EXPECTED_SOURCE_SHA",
    "METADATA",
    "PUBLISH_TAG",
    "TARBALL",
  ]) {
    if (typeof environment[name] !== "string") throw new Error(`${label} direct publication must bind ${name}`);
  }
  const guardCommands = [
    'git init --quiet --bare "$current_main"',
    'git --git-dir="$current_main" fetch --quiet --no-tags --depth=1',
    'current_default_sha="$(git --git-dir="$current_main" rev-parse FETCH_HEAD)"',
    'release_commit="$(git --git-dir="$current_main" rev-parse',
    'current_archive_sha256="$(sha256sum "$TARBALL"',
    'current_metadata_sha256="$(sha256sum "$METADATA"',
    'current_digest_sha256="$(sha256sum "$DIGEST"',
    'npm view "$package_spec" version --json',
    'npm publish "$TARBALL"',
    '--tag "$PUBLISH_TAG"',
    'npm view "$package_spec" dist --json',
    "dist.attestations.provenance?.predicateType",
  ];
  let previousIndex = -1;
  for (const required of guardCommands) {
    const index = publicationStep.run.indexOf(required);
    if (index <= previousIndex) {
      throw new Error(`${label} must recheck current default-branch HEAD and artifact before direct publication/readback`);
    }
    previousIndex = index;
  }
  const publishSource = JSON.stringify(publish);
  if (/\bbun\b/u.test(publishSource) || publishSource.includes("./scripts/")) {
    throw new Error(`${label} publishing must not execute repository code`);
  }
  if (/\bnpm\s+(?:dist-tag|stage)\b/u.test(source)) {
    throw new Error(`${label} must publish with its initial tag and never promote or stage it`);
  }
  if ((source.match(/id-token: write/gu) ?? []).length !== 1) {
    throw new Error(`${label} must grant OIDC authority to exactly one job`);
  }
  for (const forbidden of ["workflow_dispatch:", "actions: write", "authorization_run_id", "NPM_TOKEN", "NODE_AUTH_TOKEN"]) {
    if (source.includes(forbidden)) throw new Error(`${label} contains forbidden release authority ${forbidden}`);
  }
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, "..");
  const ciPath = ".github/workflows/ci.yml";
  validateWorkflowYaml(await readFile(resolve(repositoryRoot, ciPath), "utf8"), ciPath);
  const releasePath = ".github/workflows/release.yml";
  validateOwnerTagWorkflow(
    await readFile(resolve(repositoryRoot, releasePath), "utf8"),
    releasePath,
  );
  const npmPublishPath = ".github/workflows/npm-stage.yml";
  validateNpmPublishWorkflow(
    await readFile(resolve(repositoryRoot, npmPublishPath), "utf8"),
    npmPublishPath,
  );
}
