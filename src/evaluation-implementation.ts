import { createHash } from "node:crypto";

import {
  assertEvaluationRetrieverLockedV2,
  type EvaluationRetrieverDescriptorV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

const MAX_IMPLEMENTATION_SOURCES = 32;
const MAX_IMPLEMENTATION_SOURCE_BYTES = 4 * 1_024 * 1_024;
const MAX_IMPLEMENTATION_TOTAL_BYTES = 16 * 1_024 * 1_024;
const GIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const artifactBrand: unique symbol = Symbol("verified-evaluation-implementation-v2");

export type EvaluationImplementationSourceV2 = Readonly<{
  readonly sourcePath: string;
  readonly bytes: Uint8Array;
}>;

export type VerifiedEvaluationImplementationArtifactV2 = Readonly<{
  readonly retrieverId: string;
  readonly repositoryCommit: string;
  readonly implementationSha256: string;
  readonly sourcePaths: readonly string[];
  readonly [artifactBrand]: true;
}>;

function confinedPath(value: string, label: string): string {
  if (
    value === ""
    || value.normalize("NFC") !== value
    || /[\0\r\n\\]/u.test(value)
    || value.startsWith("/")
    || value.startsWith("./")
    || /^[a-z]:[\\/]/iu.test(value)
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) throw new TypeError(`${label} must be a canonical confined repository-relative path.`);
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const input = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(input).toSorted().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(",")}}`;
  }
  throw new TypeError("Canonical JSON accepts only JSON values.");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Hash the exact implementation source manifest used by both authoring and execution. */
export function evaluationImplementationArtifactSha256V2(
  sources: readonly EvaluationImplementationSourceV2[],
): string {
  if (sources.length < 1 || sources.length > MAX_IMPLEMENTATION_SOURCES) {
    throw new TypeError(`Implementation sources must contain from 1 through ${MAX_IMPLEMENTATION_SOURCES} files.`);
  }
  let totalBytes = 0;
  const seen = new Set<string>();
  const manifest = sources.map(({ sourcePath: rawSourcePath, bytes }, index) => {
    const sourcePath = confinedPath(rawSourcePath, `implementation sources[${index}].sourcePath`);
    if (seen.has(sourcePath)) throw new TypeError(`Implementation source path ${sourcePath} is repeated.`);
    seen.add(sourcePath);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IMPLEMENTATION_SOURCE_BYTES) {
      throw new TypeError(
        `Implementation source ${sourcePath} must contain at most ${MAX_IMPLEMENTATION_SOURCE_BYTES} bytes.`,
      );
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_IMPLEMENTATION_TOTAL_BYTES) {
      throw new TypeError(`Implementation sources exceed ${MAX_IMPLEMENTATION_TOTAL_BYTES} aggregate bytes.`);
    }
    return Object.freeze({ sourcePath, sha256: sha256(bytes) });
  }).toSorted((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  return sha256(Buffer.from(`${canonicalJson(manifest)}\n`, "utf8"));
}

/**
 * Prove that the files loaded for execution are from the corpus commit and match
 * the candidate-locked descriptor. The returned branded artifact is the only
 * runtime binding accepted by the KB v2 adapter.
 */
export function verifyEvaluationImplementationArtifactV2(options: Readonly<{
  readonly corpus: RetrievalEvaluationCorpusV2;
  readonly descriptor: EvaluationRetrieverDescriptorV2;
  readonly loadedRepositoryCommit: string;
  readonly sources: readonly EvaluationImplementationSourceV2[];
}>): VerifiedEvaluationImplementationArtifactV2 {
  if (!GIT_OBJECT.test(options.loadedRepositoryCommit)) {
    throw new TypeError("Loaded implementation repository commit must be a lowercase Git object ID.");
  }
  if (options.loadedRepositoryCommit !== options.corpus.frozen.repositoryCommit) {
    throw new TypeError("Loaded implementation is not from the corpus's frozen repository commit.");
  }
  assertEvaluationRetrieverLockedV2(options.corpus, options.descriptor);
  const implementationSha256 = evaluationImplementationArtifactSha256V2(options.sources);
  if (implementationSha256 !== options.descriptor.implementationSha256) {
    throw new TypeError(`Retriever ${options.descriptor.id} implementation bytes do not match its candidate lock.`);
  }
  return Object.freeze({
    retrieverId: options.descriptor.id,
    repositoryCommit: options.loadedRepositoryCommit,
    implementationSha256,
    sourcePaths: Object.freeze(options.sources.map(({ sourcePath }, index) =>
      confinedPath(sourcePath, `implementation sources[${index}].sourcePath`)).toSorted()),
    [artifactBrand]: true as const,
  });
}

export function assertEvaluationImplementationArtifactV2(
  artifact: VerifiedEvaluationImplementationArtifactV2 | undefined,
  corpus: RetrievalEvaluationCorpusV2,
  descriptor: EvaluationRetrieverDescriptorV2,
): void {
  if (
    artifact?.[artifactBrand] !== true
    || artifact.retrieverId !== descriptor.id
    || artifact.repositoryCommit !== corpus.frozen.repositoryCommit
    || artifact.implementationSha256 !== descriptor.implementationSha256
  ) throw new TypeError(`Retriever ${descriptor.id} lacks a verified frozen implementation artifact.`);
  assertEvaluationRetrieverLockedV2(corpus, descriptor);
}
