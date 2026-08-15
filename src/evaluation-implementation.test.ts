import { describe, expect, test } from "bun:test";

import {
  assertEvaluationImplementationArtifactV2,
  evaluationImplementationArtifactSha256V2,
  verifyEvaluationImplementationArtifactV2,
} from "./evaluation-implementation.js";
import {
  evaluationRetrieverDescriptorDigestV2,
  type EvaluationRetrieverDescriptorV2,
  type RetrievalEvaluationCorpusV2,
} from "./evaluation-v2.js";

const commit = "a".repeat(40);
const sources = [{ sourcePath: "src/retriever.ts", bytes: Buffer.from("export {};\n") }];

function fixture() {
  const descriptor: EvaluationRetrieverDescriptorV2 = {
    id: "candidate",
    role: "candidate",
    version: "fixture-v1",
    implementationSha256: evaluationImplementationArtifactSha256V2(sources),
    lanes: ["hybrid"],
    configuration: { limit: 10 },
  };
  const corpus = {
    frozen: { repositoryCommit: commit, vaultTree: "b".repeat(40), vaultRoot: "kb" },
    retrievers: [descriptor],
    candidateLock: {
      baselineRetrieverId: "candidate",
      candidateRetrieverIds: [],
      descriptorDigests: [{
        retrieverId: descriptor.id,
        sha256: evaluationRetrieverDescriptorDigestV2(descriptor),
      }],
    },
  } as unknown as RetrievalEvaluationCorpusV2;
  return { corpus, descriptor };
}

describe("evaluation implementation artifact", () => {
  test("is canonical across source order and binds execution to the frozen commit", () => {
    const second = { sourcePath: "src/shared.ts", bytes: Buffer.from("export const x = 1;\n") };
    expect(evaluationImplementationArtifactSha256V2([...sources, second]))
      .toBe(evaluationImplementationArtifactSha256V2([second, ...sources]));
    const { corpus, descriptor } = fixture();
    const artifact = verifyEvaluationImplementationArtifactV2({
      corpus,
      descriptor,
      loadedRepositoryCommit: commit,
      sources,
    });
    expect(() => assertEvaluationImplementationArtifactV2(artifact, corpus, descriptor)).not.toThrow();
  });

  test("rejects changed bytes, a changed commit, duplicate paths, and a forged artifact", () => {
    const { corpus, descriptor } = fixture();
    expect(() => verifyEvaluationImplementationArtifactV2({
      corpus,
      descriptor,
      loadedRepositoryCommit: commit,
      sources: [{ ...sources[0]!, bytes: Buffer.from("export const changed = true;\n") }],
    })).toThrow("implementation bytes do not match");
    expect(() => verifyEvaluationImplementationArtifactV2({
      corpus,
      descriptor,
      loadedRepositoryCommit: "c".repeat(40),
      sources,
    })).toThrow("not from the corpus's frozen repository commit");
    expect(() => evaluationImplementationArtifactSha256V2([...sources, ...sources]))
      .toThrow("is repeated");
    expect(() => assertEvaluationImplementationArtifactV2(
      undefined,
      corpus,
      descriptor,
    )).toThrow("lacks a verified frozen implementation artifact");
  });
});
