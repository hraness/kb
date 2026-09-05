import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

const expectedName = "@hraness/kb";
const expectedRegistry = "https://registry.npmjs.org";
const expectedAuditRegistry = `${expectedRegistry}/`;
const expectedRepository = "https://github.com/hraness/kb";
const expectedRepositoryId = "1308971873";
const expectedRepositoryOwnerId = "307125679";
const expectedWorkflowPath = ".github/workflows/npm-stage.yml";
const expectedWorkflowRef = "refs/heads/main";
const expectedWorkflowEvent = "workflow_dispatch";
const expectedBuilder = "https://github.com/actions/runner/github-hosted";
const expectedBuildType = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const provenancePredicateType = "https://slsa.dev/provenance/v1";
const publishPredicateType = "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";
const inTotoPayloadType = "application/vnd.in-toto+json";
const provenanceBundleMediaType = "application/vnd.dev.sigstore.bundle.v0.3+json";
const publishBundleMediaType = "application/vnd.dev.sigstore.bundle+json;version=0.2";
const stableVersionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const maximumStableVersionPart = BigInt(Number.MAX_SAFE_INTEGER);
const maximumAuditBytes = 20_000_000;
const maximumRegistryViewBytes = 1_000_000;

type ReleaseAttestationInput = Readonly<{
  audit: unknown;
  expectedSourceSha: string;
  expectedTarballSha512: string;
  expectedVersion: string;
  registryLatest: unknown;
  registryView: unknown;
}>;

export type VerifiedReleaseAttestation = Readonly<{
  invocationId: string;
  sourceSha: string;
  tarballSha512: string;
  version: string;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function stringField(value: Record<string, unknown>, key: string, label: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new TypeError(`${label}.${key} must be a non-empty string`);
  }
  return field;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${label} must contain exactly ${expected.join(", ")}`);
  }
}

function stableVersion(version: string): void {
  const match = stableVersionPattern.exec(version);
  if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new TypeError(`Expected version is not a canonical stable semantic version: ${version}`);
  }
  if ([match[1], match[2], match[3]].some(
    (part) => BigInt(part) > maximumStableVersionPart,
  )) {
    throw new TypeError(`Expected version components exceed Number.MAX_SAFE_INTEGER: ${version}`);
  }
}

function canonicalAttestations(version: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    provenance: Object.freeze({ predicateType: provenancePredicateType }),
    url: `${expectedRegistry}/-/npm/v1/attestations/@hraness%2fkb@${version}`,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(source[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function canonicalBase64(value: string, label: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new TypeError(`${label} is not canonical base64`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength === 0 || decoded.toString("base64") !== value) {
    throw new TypeError(`${label} is not nonempty canonical base64`);
  }
  return decoded;
}

function assertCanonicalAttestations(value: unknown, version: string, label: string): void {
  if (canonicalJson(value) !== canonicalJson(canonicalAttestations(version))) {
    throw new TypeError(`${label} is not the canonical npm attestation metadata`);
  }
}

function verifyRegistryIntegrity(value: unknown, tarballSha512: string): void {
  if (typeof value !== "string") {
    throw new TypeError("npm registry view.dist.integrity must be a string");
  }
  const match = /^sha512-((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==)?)$/u.exec(value);
  if (match === null || match[1] === undefined) {
    throw new TypeError("npm registry view.dist.integrity must be one canonical SHA-512 SRI");
  }
  const digest = Buffer.from(match[1], "base64");
  if (
    digest.byteLength !== 64
    || digest.toString("base64") !== match[1]
    || digest.toString("hex") !== tarballSha512
  ) {
    throw new TypeError("npm registry integrity does not bind the downloaded tarball SHA-512");
  }
}

function verifySubject(
  statement: Record<string, unknown>,
  version: string,
  tarballSha512: string,
  label: string,
): void {
  const subjects = array(statement.subject, `${label}.subject`);
  if (subjects.length !== 1) throw new TypeError(`${label} must have exactly one subject`);
  const subject = record(subjects[0], `${label}.subject[0]`);
  const digest = record(subject.digest, `${label}.subject[0].digest`);
  exactKeys(subject, ["digest", "name"], `${label}.subject[0]`);
  exactKeys(digest, ["sha512"], `${label}.subject[0].digest`);
  if (
    subject.name !== `pkg:npm/%40hraness/kb@${version}`
    || digest.sha512 !== tarballSha512
  ) {
    throw new TypeError(`${label} subject does not bind the exact npm tarball`);
  }
}

function decodeStatement(
  value: unknown,
  predicateType: string,
  mediaType: string,
): Record<string, unknown> {
  const attestation = record(value, `${predicateType} attestation`);
  exactKeys(attestation, ["bundle", "predicateType"], `${predicateType} attestation`);
  if (attestation.predicateType !== predicateType) {
    throw new TypeError(`${predicateType} attestation has the wrong predicate type`);
  }
  const bundle = record(attestation.bundle, `${predicateType} bundle`);
  exactKeys(
    bundle,
    ["dsseEnvelope", "mediaType", "verificationMaterial"],
    `${predicateType} bundle`,
  );
  if (bundle.mediaType !== mediaType) {
    throw new TypeError(`${predicateType} bundle has the wrong media type`);
  }
  const verificationMaterial = record(
    bundle.verificationMaterial,
    `${predicateType} verification material`,
  );
  const materialKeys = predicateType === publishPredicateType
    ? ["publicKey", "timestampVerificationData", "tlogEntries"]
    : ["certificate", "timestampVerificationData", "tlogEntries"];
  exactKeys(verificationMaterial, materialKeys, `${predicateType} verification material`);
  if (array(verificationMaterial.tlogEntries, `${predicateType} transparency log entries`).length < 1) {
    throw new TypeError(`${predicateType} bundle has no transparency log entry`);
  }
  const timestampVerification = record(
    verificationMaterial.timestampVerificationData,
    `${predicateType} timestamp verification data`,
  );
  exactKeys(
    timestampVerification,
    ["rfc3161Timestamps"],
    `${predicateType} timestamp verification data`,
  );
  if (array(
    timestampVerification.rfc3161Timestamps,
    `${predicateType} RFC3161 timestamps`,
  ).length !== 0) {
    throw new TypeError(`${predicateType} bundle has unexpected RFC3161 timestamps`);
  }
  const envelope = record(bundle.dsseEnvelope, `${predicateType} DSSE envelope`);
  exactKeys(envelope, ["payload", "payloadType", "signatures"], `${predicateType} DSSE envelope`);
  if (envelope.payloadType !== inTotoPayloadType) {
    throw new TypeError(`${predicateType} DSSE envelope has the wrong payload type`);
  }
  const signatures = array(envelope.signatures, `${predicateType} DSSE signatures`);
  if (signatures.length !== 1) {
    throw new TypeError(`${predicateType} DSSE envelope must have exactly one signature`);
  }
  const signature = record(signatures[0], `${predicateType} DSSE signature`);
  exactKeys(signature, ["keyid", "sig"], `${predicateType} DSSE signature`);
  canonicalBase64(stringField(signature, "sig", `${predicateType} DSSE signature`), `${predicateType} DSSE signature.sig`);
  if (typeof signature.keyid !== "string") {
    throw new TypeError(`${predicateType} DSSE signature.keyid must be a string`);
  }
  if (predicateType === publishPredicateType) {
    const publicKey = record(verificationMaterial.publicKey, "npm publish public key");
    exactKeys(publicKey, ["hint"], "npm publish public key");
    const hint = stringField(publicKey, "hint", "npm publish public key");
    if (signature.keyid !== hint) {
      throw new TypeError("npm publish signature key ID does not match its public key hint");
    }
  } else {
    const certificate = record(verificationMaterial.certificate, "SLSA signing certificate");
    exactKeys(certificate, ["rawBytes"], "SLSA signing certificate");
    canonicalBase64(
      stringField(certificate, "rawBytes", "SLSA signing certificate"),
      "SLSA signing certificate.rawBytes",
    );
    if (signature.keyid !== "") {
      throw new TypeError("SLSA provenance must use a keyless DSSE signature");
    }
  }
  const payload = stringField(envelope, "payload", `${predicateType} DSSE envelope`);
  const decoded = canonicalBase64(payload, `${predicateType} DSSE payload`);
  try {
    return record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)) as unknown,
      `${predicateType} statement`,
    );
  } catch (error) {
    throw new TypeError(`${predicateType} DSSE payload is not UTF-8 JSON`, { cause: error });
  }
}

function verifyPublishStatement(
  statement: Record<string, unknown>,
  version: string,
  tarballSha512: string,
): void {
  exactKeys(statement, ["_type", "predicate", "predicateType", "subject"], "npm publish statement");
  if (
    statement._type !== "https://in-toto.io/Statement/v0.1"
    || statement.predicateType !== publishPredicateType
  ) {
    throw new TypeError("npm publish statement has the wrong in-toto identity");
  }
  verifySubject(statement, version, tarballSha512, "npm publish statement");
  const predicate = record(statement.predicate, "npm publish predicate");
  exactKeys(predicate, ["name", "registry", "version"], "npm publish predicate");
  if (
    predicate.name !== expectedName
    || predicate.version !== version
    || predicate.registry !== expectedRegistry
  ) {
    throw new TypeError("npm publish attestation does not identify the exact registry package");
  }
}

function verifyProvenanceStatement(
  statement: Record<string, unknown>,
  version: string,
  tarballSha512: string,
  sourceSha: string,
): string {
  exactKeys(statement, ["_type", "predicate", "predicateType", "subject"], "SLSA provenance statement");
  if (
    statement._type !== "https://in-toto.io/Statement/v1"
    || statement.predicateType !== provenancePredicateType
  ) {
    throw new TypeError("SLSA provenance statement has the wrong in-toto identity");
  }
  verifySubject(statement, version, tarballSha512, "SLSA provenance statement");
  const predicate = record(statement.predicate, "SLSA provenance predicate");
  exactKeys(predicate, ["buildDefinition", "runDetails"], "SLSA provenance predicate");
  const buildDefinition = record(predicate.buildDefinition, "SLSA build definition");
  exactKeys(
    buildDefinition,
    ["buildType", "externalParameters", "internalParameters", "resolvedDependencies"],
    "SLSA build definition",
  );
  if (buildDefinition.buildType !== expectedBuildType) {
    throw new TypeError("SLSA provenance has the wrong GitHub Actions build type");
  }
  const external = record(buildDefinition.externalParameters, "SLSA external parameters");
  exactKeys(external, ["workflow"], "SLSA external parameters");
  const workflow = record(external.workflow, "SLSA workflow parameters");
  exactKeys(workflow, ["path", "ref", "repository"], "SLSA workflow parameters");
  if (
    workflow.path !== expectedWorkflowPath
    || workflow.ref !== expectedWorkflowRef
    || workflow.repository !== expectedRepository
  ) {
    throw new TypeError("SLSA provenance does not identify the exact main staging workflow");
  }
  const internal = record(buildDefinition.internalParameters, "SLSA internal parameters");
  exactKeys(internal, ["github"], "SLSA internal parameters");
  const github = record(internal.github, "SLSA GitHub parameters");
  exactKeys(
    github,
    ["event_name", "repository_id", "repository_owner_id"],
    "SLSA GitHub parameters",
  );
  if (
    github.event_name !== expectedWorkflowEvent
    || github.repository_id !== expectedRepositoryId
    || github.repository_owner_id !== expectedRepositoryOwnerId
  ) {
    throw new TypeError("SLSA provenance has the wrong GitHub event or immutable repository identity");
  }
  const dependencies = array(buildDefinition.resolvedDependencies, "SLSA resolved dependencies");
  if (dependencies.length !== 1) {
    throw new TypeError("SLSA provenance must have exactly one resolved source dependency");
  }
  const dependency = record(dependencies[0], "SLSA resolved dependency");
  exactKeys(dependency, ["digest", "uri"], "SLSA resolved dependency");
  const dependencyDigest = record(dependency.digest, "SLSA resolved dependency digest");
  exactKeys(dependencyDigest, ["gitCommit"], "SLSA resolved dependency digest");
  if (
    dependency.uri !== `git+${expectedRepository}@${expectedWorkflowRef}`
    || dependencyDigest.gitCommit !== sourceSha
  ) {
    throw new TypeError("SLSA provenance does not bind the exact main source commit");
  }
  const runDetails = record(predicate.runDetails, "SLSA run details");
  exactKeys(runDetails, ["builder", "metadata"], "SLSA run details");
  const builder = record(runDetails.builder, "SLSA builder");
  exactKeys(builder, ["id"], "SLSA builder");
  if (builder.id !== expectedBuilder) {
    throw new TypeError("SLSA provenance was not produced by a GitHub-hosted runner");
  }
  const metadata = record(runDetails.metadata, "SLSA run metadata");
  exactKeys(metadata, ["invocationId"], "SLSA run metadata");
  const invocationId = stringField(metadata, "invocationId", "SLSA run metadata");
  if (!/^https:\/\/github\.com\/hraness\/kb\/actions\/runs\/[1-9][0-9]*\/attempts\/[1-9][0-9]*$/u.test(invocationId)) {
    throw new TypeError("SLSA provenance has a noncanonical GitHub Actions invocation");
  }
  return invocationId;
}

export function verifyNpmReleaseAttestation(
  input: ReleaseAttestationInput,
): VerifiedReleaseAttestation {
  stableVersion(input.expectedVersion);
  if (!/^[a-f0-9]{40}$/u.test(input.expectedSourceSha)) {
    throw new TypeError("Expected source SHA must be one lowercase Git commit");
  }
  if (!/^[a-f0-9]{128}$/u.test(input.expectedTarballSha512)) {
    throw new TypeError("Expected tarball SHA-512 must be one lowercase hexadecimal digest");
  }
  if (input.registryLatest !== input.expectedVersion) {
    throw new TypeError("npm latest does not identify the exact release version");
  }

  const registryView = record(input.registryView, "npm registry view");
  if (registryView.name !== expectedName || registryView.version !== input.expectedVersion) {
    throw new TypeError("npm registry view does not identify the exact release package");
  }
  const dist = record(registryView.dist, "npm registry view.dist");
  verifyRegistryIntegrity(dist.integrity, input.expectedTarballSha512);
  assertCanonicalAttestations(dist.attestations, input.expectedVersion, "npm registry view.dist.attestations");
  const registrySignatures = array(dist.signatures, "npm registry view.dist.signatures");
  if (registrySignatures.length < 1) {
    throw new TypeError("npm registry view has no registry signature");
  }
  for (const [index, value] of registrySignatures.entries()) {
    const signature = record(value, `npm registry signature ${String(index + 1)}`);
    stringField(signature, "keyid", `npm registry signature ${String(index + 1)}`);
    stringField(signature, "sig", `npm registry signature ${String(index + 1)}`);
  }

  const audit = record(input.audit, "npm signature audit");
  if (array(audit.invalid, "npm signature audit.invalid").length !== 0) {
    throw new TypeError("npm signature audit reports invalid cryptographic evidence");
  }
  if (array(audit.missing, "npm signature audit.missing").length !== 0) {
    throw new TypeError("npm signature audit reports missing registry signatures");
  }
  const matching = array(audit.verified, "npm signature audit.verified")
    .map((value, index) => record(value, `npm signature audit.verified[${String(index)}]`))
    .filter((value) => value.name === expectedName && value.version === input.expectedVersion);
  if (matching.length !== 1) {
    throw new TypeError("npm signature audit must verify the exact release package once");
  }
  const verified = matching[0] as Record<string, unknown>;
  if (
    verified.location !== "node_modules/@hraness/kb"
    || verified.registry !== expectedAuditRegistry
  ) {
    throw new TypeError("npm signature audit did not verify the isolated canonical package install");
  }
  assertCanonicalAttestations(
    verified.attestations,
    input.expectedVersion,
    "npm signature audit attestation metadata",
  );
  const bundles = array(verified.attestationBundles, "npm signature audit attestation bundles");
  if (bundles.length !== 2) {
    throw new TypeError("npm signature audit must verify exactly publish and provenance attestations");
  }
  const byPredicate = new Map<string, unknown>();
  for (const value of bundles) {
    const attestation = record(value, "npm signature audit attestation bundle");
    const predicateType = stringField(attestation, "predicateType", "npm signature audit attestation bundle");
    if (byPredicate.has(predicateType)) {
      throw new TypeError(`npm signature audit repeats ${predicateType}`);
    }
    byPredicate.set(predicateType, value);
  }
  if (
    byPredicate.size !== 2
    || !byPredicate.has(publishPredicateType)
    || !byPredicate.has(provenancePredicateType)
  ) {
    throw new TypeError("npm signature audit has an unexpected attestation predicate set");
  }
  const publishStatement = decodeStatement(
    byPredicate.get(publishPredicateType),
    publishPredicateType,
    publishBundleMediaType,
  );
  verifyPublishStatement(publishStatement, input.expectedVersion, input.expectedTarballSha512);
  const provenanceStatement = decodeStatement(
    byPredicate.get(provenancePredicateType),
    provenancePredicateType,
    provenanceBundleMediaType,
  );
  const invocationId = verifyProvenanceStatement(
    provenanceStatement,
    input.expectedVersion,
    input.expectedTarballSha512,
    input.expectedSourceSha,
  );
  return Object.freeze({
    invocationId,
    sourceSha: input.expectedSourceSha,
    tarballSha512: input.expectedTarballSha512,
    version: input.expectedVersion,
  });
}

function parseJson(source: string, label: string, maximumBytes: number): unknown {
  if (Buffer.byteLength(source, "utf8") > maximumBytes) {
    throw new TypeError(`${label} exceeds its size bound`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new TypeError(`${label} must be valid JSON`, { cause: error });
  }
}

function resolvePath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

async function main(): Promise<void> {
  const requiredFlags = [
    "--audit-json",
    "--expected-source-sha",
    "--expected-tarball-sha512",
    "--expected-version",
    "--registry-latest-json",
    "--registry-view-json",
  ] as const;
  const args = process.argv.slice(2);
  if (args.length !== requiredFlags.length * 2) {
    throw new TypeError(`Usage: bun run scripts/npm-release-attestation.ts ${requiredFlags.map((flag) => `${flag} <value>`).join(" ")}`);
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      flag === undefined
      || value === undefined
      || !requiredFlags.includes(flag as (typeof requiredFlags)[number])
      || values.has(flag)
    ) {
      throw new TypeError("npm release attestation arguments are unknown, duplicated, or incomplete");
    }
    values.set(flag, value);
  }
  for (const flag of requiredFlags) {
    if (!values.has(flag)) throw new TypeError(`Missing npm release attestation argument ${flag}`);
  }
  const auditPath = resolvePath(values.get("--audit-json") as string);
  const latestPath = resolvePath(values.get("--registry-latest-json") as string);
  const registryViewPath = resolvePath(values.get("--registry-view-json") as string);
  const [auditSource, latestSource, registryViewSource] = await Promise.all([
    readFile(auditPath, "utf8"),
    readFile(latestPath, "utf8"),
    readFile(registryViewPath, "utf8"),
  ]);
  const result = verifyNpmReleaseAttestation({
    audit: parseJson(auditSource, "npm signature audit", maximumAuditBytes),
    expectedSourceSha: values.get("--expected-source-sha") as string,
    expectedTarballSha512: values.get("--expected-tarball-sha512") as string,
    expectedVersion: values.get("--expected-version") as string,
    registryLatest: parseJson(latestSource, "npm latest readback", 1_024),
    registryView: parseJson(registryViewSource, "npm registry view", maximumRegistryViewBytes),
  });
  console.log(
    `Verified npm registry signature, publish attestation, and SLSA provenance for ${expectedName}@${result.version} from ${result.sourceSha}; invocation ${result.invocationId}.`,
  );
}

if (import.meta.main) await main();
