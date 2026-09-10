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
    || environment.EXPECTED_REPOSITORY !== "hraness/wordcell"
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
  if (Object.keys(triggers).length !== 1 || JSON.stringify(push.tags) !== JSON.stringify(["v*", "!v*-beta.*"])) {
    throw new Error(`${label} must accept only stable version-tag pushes`);
  }
  const permissions = record(workflow.permissions, `${label} permissions`);
  if (JSON.stringify(permissions) !== JSON.stringify({ contents: "read" })) throw new Error(`${label} top-level permissions must be contents: read only`);
  const concurrency = record(workflow.concurrency, `${label} concurrency`);
  if (concurrency.group !== "stable-release" || concurrency["cancel-in-progress"] !== false) throw new Error(`${label} must serialize stable releases without cancellation`);
  const jobs = record(workflow.jobs, `${label} jobs`);
  if (JSON.stringify(Object.keys(jobs).sort()) !== JSON.stringify(["admit_npm", "attest", "authorize", "publish", "publish_npm", "verify"])) throw new Error(`${label} must contain exactly authorize, verify, attest, publish, publish_npm, and admit_npm jobs`);
  const authorize = record(jobs.authorize, `${label} authorize`);
  const verify = record(jobs.verify, `${label} verify`);
  const attest = record(jobs.attest, `${label} attest`);
  const publish = record(jobs.publish, `${label} publish`);
  const publishNpm = record(jobs.publish_npm, `${label} publish_npm`);
  const admitNpm = record(jobs.admit_npm, `${label} admit_npm`);
  for (const job of [authorize, verify, attest, publish, publishNpm, admitNpm]) {
    if (job.if !== undefined || job["continue-on-error"] !== undefined) throw new Error(`${label} jobs must retain fail-closed control flow`);
  }
  validateOwnerTagAuthorization(authorize, `${label} owner authorization`);
  if (verify.needs !== "authorize" || JSON.stringify(verify.permissions) !== JSON.stringify({ contents: "read" })) throw new Error(`${label} verification must remain read-only after owner authorization`);
  const verifySteps = jobSteps(verify, `${label} verify`);
  validateExactStepSequence(verifySteps, [
    { kind: "uses", uses: "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0" },
    { kind: "uses", uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020" },
    { kind: "uses", uses: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6" },
    { kind: "run", name: "Pin npm" }, { kind: "run", name: "Verify release identity" },
    { kind: "run", name: "Materialize exact tagged source" }, { kind: "run", name: "Install tagged source" },
    { kind: "run", name: "Check tagged source" }, { kind: "run", name: "Verify generated tagged tree" },
    { kind: "run", name: "Verify tagged package boundary" }, { kind: "run", name: "Prepare and smoke canonical GitHub artifact" },
    { kind: "uses", name: "Upload verified GitHub artifact", uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a" },
  ], `${label} verification`);
  if (verifySteps[6]?.run !== "bun install --frozen-lockfile --ignore-scripts" || verifySteps[7]?.run !== "bun run check") throw new Error(`${label} must retain complete tagged-source verification`);
  const checkout = record(verifySteps[0]?.with, `${label} verify checkout`);
  if (checkout.ref !== "main" || checkout["fetch-depth"] !== 0 || checkout["persist-credentials"] !== false) throw new Error(`${label} requires an uncredentialed complete-history current-main checkout`);
  const verifyCommands = joinedCommands(verifySteps);
  for (const expected of [
    'git merge-base --is-ancestor "$tag_commit" "$default_head"', "Tagged and current release workflow controls differ",
    'git worktree add --detach "$source_tree" "$SOURCE_SHA"', 'bun run ./scripts/prepare-npm-package.ts "$artifact_directory"',
    "bun run ./scripts/package-smoke.ts", 'node "$GITHUB_WORKSPACE/scripts/github-release.ts" prepare "$artifact_directory"',
  ]) if (!verifyCommands.includes(expected)) throw new Error(`${label} must bind current controls, tagged source, and the canonical artifact`);
  if (/npm (?:view|publish|stage|audit)/u.test(verifyCommands)) throw new Error(`${label} canonical publication must not depend on npm registry admission`);
  if (attest.needs !== "verify" || JSON.stringify(attest.permissions) !== JSON.stringify({ actions: "read", contents: "read", "id-token": "write", attestations: "write" })) throw new Error(`${label} attestation must have only the reviewed signing permissions`);
  const attestationSteps = jobSteps(attest, `${label} attestation`);
  validateExactStepSequence(attestationSteps, [
    { kind: "run", name: "Reauthorize current release attempt" },
    { kind: "uses", uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c" },
    { kind: "run", name: "Bind exact verified artifact" },
    { kind: "uses", name: "Attest canonical release files", uses: "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6" },
    { kind: "run", name: "Preserve signed provenance bundle" },
    { kind: "uses", name: "Upload attested GitHub artifact", uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a" },
  ], `${label} attestation`);
  const attestationInputs = record(attestationSteps[3]?.with, `${label} attestation inputs`);
  const subjects = ["${{ needs.verify.outputs.archive_name }}", "npm-pack.json", "release-manifest.json", "SHA256SUMS"].map((name) => `\${{ runner.temp }}/kb-github-handoff/${name}`).join("\n") + "\n";
  if (attestationInputs["subject-path"] !== subjects || attestationInputs["push-to-registry"] !== false || attestationInputs["create-storage-record"] !== false || Object.keys(attestationInputs).length !== 3) throw new Error(`${label} must attest exactly the four verified files without registry writes`);
  if (JSON.stringify(publish.needs) !== JSON.stringify(["verify", "attest"]) || JSON.stringify(publish.permissions) !== JSON.stringify({ actions: "read", contents: "write" })) throw new Error(`${label} publication must follow independent verification and attestation with only release permissions`);
  const publishSteps = jobSteps(publish, `${label} publication`);
  validateExactStepSequence(publishSteps, [
    { kind: "uses", uses: "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0" },
    { kind: "run", name: "Reauthorize current release attempt" },
    { kind: "uses", uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020" },
    { kind: "uses", uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c" },
    { kind: "run", name: "Bind exact verified artifact" }, { kind: "run", name: "Publish verified GitHub Release" },
  ], `${label} publication`);
  const publishCheckout = record(publishSteps[0]?.with, `${label} publication checkout`);
  if (publishCheckout.ref !== "main" || publishCheckout["fetch-depth"] !== 0 || publishCheckout["persist-credentials"] !== false) throw new Error(`${label} requires a complete-history current-main checkout`);
  for (const steps of [attestationSteps, publishSteps]) {
    const commands = joinedCommands(steps);
    for (const expected of ["attempt.triggering_actor?.id !== actorId", "attempt.actor?.id !== actorId", "attempt.run_attempt !== runAttempt", "Current release attempt is not owner-authorized for this exact public workflow", "Release handoff bytes differ from verified output", "Release handoff identity differs from verified outputs"]) {
      if (!commands.includes(expected)) throw new Error(`${label} must reauthorize the exact attempt and rebind verified bytes`);
    }
  }
  const publicationCommands = joinedCommands(publishSteps);
  for (const expected of ['scripts/github-release.ts', 'final_default_sha="$(verify_current_release_controls)"', 'node scripts/github-release.ts publish "$RUNNER_TEMP/kb-github-handoff"']) {
    if (!publicationCommands.includes(expected)) throw new Error(`${label} must rebind current controls before publication`);
  }
  if (containsUnexpectedProviderInvocation(publicationCommands)) throw new Error(`${label} contains an unexpected provider mutation command outside its reviewed helper`);
  validateNpmPublicationJobs(publishNpm, admitNpm, label);
  if ((source.match(/id-token: write/gu) ?? []).length !== 2) throw new Error(`${label} must grant OIDC only to the attestation and npm publication jobs`);
  validateReviewedWorkflowSemantics(workflow, "6c8aae13c95c77118cbf9e18ca211a64a4ef501ef2060e691fcf0383519f4682", label);
}

function validateNpmPublicationJobs(
  publishNpm: Record<string, unknown>,
  admitNpm: Record<string, unknown>,
  label: string,
): void {
  if (
    JSON.stringify(publishNpm.needs) !== JSON.stringify(["verify", "attest", "publish"])
    || publishNpm.environment !== "npm-release"
    || JSON.stringify(publishNpm.permissions) !== JSON.stringify({ actions: "read", contents: "read", "id-token": "write" })
  ) throw new Error(`${label} npm publication must follow the immutable Release inside the npm-release environment with only read and OIDC permissions`);
  const steps = jobSteps(publishNpm, `${label} npm publication`);
  validateExactStepSequence(steps, [
    { kind: "run", name: "Reauthorize current release attempt" },
    { kind: "uses", uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020" },
    { kind: "run", name: "Pin npm" },
    { kind: "uses", uses: "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c" },
    { kind: "run", name: "Bind exact verified artifact" },
    { kind: "run", name: "Admit the immutable GitHub Release before OIDC" },
    { kind: "run", name: "Publish the exact canonical archive through npm trusted publishing" },
  ], `${label} npm publication`);
  const download = record(steps[3]?.with, `${label} npm publication download inputs`);
  if (download["artifact-ids"] !== "${{ needs.attest.outputs.artifact_id }}" || download["merge-multiple"] !== true) {
    throw new Error(`${label} npm publication must download the attested artifact by its numeric identity`);
  }
  const publicationSource = JSON.stringify(publishNpm);
  if (publicationSource.includes("actions/checkout@") || /\bbun\b/u.test(publicationSource) || publicationSource.includes("./scripts/")) {
    throw new Error(`${label} npm publication must not check out or execute repository code`);
  }
  const commands = joinedCommands(steps);
  for (const expected of [
    "attempt.triggering_actor?.id !== actorId",
    "Release handoff bytes differ from verified output",
    "Canonical immutable GitHub Release is not published for this exact tag",
    "Canonical release is not immutable Latest before npm publication",
    "npm publication input is not the exact canonical archive bytes",
    'never overwrite it',
    'process.stdout.write("published")',
    "Release candidate must be newer than current npm latest",
    "npm 11.19.0 `publish --json` prints one object keyed by package name.",
    "output.integrity !== process.env.EXPECTED_ARCHIVE_INTEGRITY",
  ]) if (!commands.includes(expected)) throw new Error(`${label} npm publication must bind the immutable Release, the exact bytes, and an idempotent registry state before mutating npm`);
  const publicationStep = steps[6]!;
  if (typeof publicationStep.run !== "string") throw new Error(`${label} npm publication command is missing`);
  if (/--tag(?:=|\s)/u.test(publicationStep.run)) throw new Error(`${label} must preserve pinned npm's default-tag monotonicity guard`);
  const publishIndex = publicationStep.run.indexOf('npm publish "$TARBALL"');
  const publishCommand = publicationStep.run.slice(publishIndex, publicationStep.run.indexOf('> "$publish_result"', publishIndex));
  for (const required of ["--access public", "--ignore-scripts", "--json", "--provenance", "--registry=https://registry.npmjs.org", '--userconfig="$clean_user_config"', '--globalconfig="$clean_global_config"']) {
    if (publishIndex < 0 || !publishCommand.includes(required)) throw new Error(`${label} npm publication must publish the exact archive with provenance to the canonical registry from clean configuration`);
  }
  validateNoUnexpectedProviderMutations(steps, 6, 'npm publish "$TARBALL"', `${label} npm publication`);
  if (
    JSON.stringify(admitNpm.needs) !== JSON.stringify(["verify", "publish_npm"])
    || JSON.stringify(admitNpm.permissions) !== JSON.stringify({ contents: "read" })
    || admitNpm.environment !== undefined
  ) throw new Error(`${label} npm admission must be a read-only job after publication`);
  const admissionSteps = jobSteps(admitNpm, `${label} npm admission`);
  validateExactStepSequence(admissionSteps, [
    { kind: "uses", uses: "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0" },
    { kind: "uses", uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020" },
    { kind: "uses", uses: "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6" },
    { kind: "run", name: "Pin npm" },
    { kind: "run" },
    { kind: "run", name: "Verify the public registry archive, signatures, and provenance against the canonical asset" },
  ], `${label} npm admission`);
  if (admissionSteps[4]?.run !== "bun install --frozen-lockfile --ignore-scripts") throw new Error(`${label} npm admission must install the frozen verifier dependencies`);
  const admissionCheckout = record(admissionSteps[0]?.with, `${label} npm admission checkout`);
  if (admissionCheckout.ref !== "${{ needs.verify.outputs.workflow_sha }}" || admissionCheckout["persist-credentials"] !== false) {
    throw new Error(`${label} npm admission must check out the exact reviewed verifier closure without credentials`);
  }
  const admissionCommands = joinedCommands(admissionSteps);
  for (const expected of ["bun run ./scripts/npm-package-identity.ts", "npm audit signatures --json --include-attestations", "bun run ./scripts/npm-release-attestation.ts", '--expected-source-sha "$VERIFIED_SOURCE_SHA"']) {
    if (!admissionCommands.includes(expected)) throw new Error(`${label} npm admission must verify registry bytes, signatures, and provenance against the canonical asset`);
  }
  if (containsUnexpectedProviderInvocation(admissionCommands)) throw new Error(`${label} npm admission contains an unexpected provider mutation command`);
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
}
