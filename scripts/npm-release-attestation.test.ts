import { describe, expect, test } from "bun:test";

import { verifyNpmReleaseAttestation } from "./npm-release-attestation.ts";

const version = "0.20.0";
const sourceSha = "b".repeat(40);
const tarballSha512 = "a".repeat(128);
const provenancePredicateType = "https://slsa.dev/provenance/v1";
const publishPredicateType = "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function subject(packageVersion: string): readonly Record<string, unknown>[] {
  return [{
    name: `pkg:npm/%40hraness/kb@${packageVersion}`,
    digest: { sha512: tarballSha512 },
  }];
}

function bundle(
  predicateType: string,
  mediaType: string,
  statement: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const publish = predicateType === publishPredicateType;
  const keyid = publish ? "SHA256:test-key" : "";
  return {
    predicateType,
    bundle: {
      mediaType,
      verificationMaterial: {
        ...(publish
          ? { publicKey: { hint: keyid } }
          : { certificate: { rawBytes: Buffer.from("test-certificate").toString("base64") } }),
        tlogEntries: [{ logIndex: "123" }],
        timestampVerificationData: { rfc3161Timestamps: [] },
      },
      dsseEnvelope: {
        payload: Buffer.from(JSON.stringify(statement), "utf8").toString("base64"),
        payloadType: "application/vnd.in-toto+json",
        signatures: [{ keyid, sig: Buffer.from("test-signature").toString("base64") }],
      },
    },
  };
}

function validInput(packageVersion = version) {
  const attestationMetadata = {
    url: `https://registry.npmjs.org/-/npm/v1/attestations/@hraness%2fkb@${packageVersion}`,
    provenance: { predicateType: provenancePredicateType },
  };
  const publishStatement = {
    _type: "https://in-toto.io/Statement/v0.1",
    subject: subject(packageVersion),
    predicateType: publishPredicateType,
    predicate: {
      name: "@hraness/kb",
      version: packageVersion,
      registry: "https://registry.npmjs.org",
    },
  };
  const provenanceStatement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: subject(packageVersion),
    predicateType: provenancePredicateType,
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            ref: "refs/heads/main",
            repository: "https://github.com/hraness/kb",
            path: ".github/workflows/npm-stage.yml",
          },
        },
        internalParameters: {
          github: {
            event_name: "workflow_dispatch",
            repository_id: "1308971873",
            repository_owner_id: "307125679",
          },
        },
        resolvedDependencies: [{
          uri: "git+https://github.com/hraness/kb@refs/heads/main",
          digest: { gitCommit: sourceSha },
        }],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: {
          invocationId: "https://github.com/hraness/kb/actions/runs/123456/attempts/2",
        },
      },
    },
  };
  return {
    audit: {
      invalid: [],
      missing: [],
      verified: [{
        name: "@hraness/kb",
        version: packageVersion,
        location: "node_modules/@hraness/kb",
        registry: "https://registry.npmjs.org/",
        attestations: structuredClone(attestationMetadata),
        attestationBundles: [
          bundle(
            publishPredicateType,
            "application/vnd.dev.sigstore.bundle+json;version=0.2",
            publishStatement,
          ),
          bundle(
            provenancePredicateType,
            "application/vnd.dev.sigstore.bundle.v0.3+json",
            provenanceStatement,
          ),
        ],
      }],
    },
    expectedSourceSha: sourceSha,
    expectedTarballSha512: tarballSha512,
    expectedVersion: packageVersion,
    registryLatest: packageVersion,
    registryView: {
      name: "@hraness/kb",
      version: packageVersion,
      dist: {
        integrity: `sha512-${Buffer.from(tarballSha512, "hex").toString("base64")}`,
        attestations: structuredClone(attestationMetadata),
        signatures: [{ keyid: "SHA256:test", sig: "MEUCIQtest" }],
      },
    },
  };
}

type Fixture = ReturnType<typeof validInput>;

function verifiedRecord(input: Fixture): Record<string, unknown> {
  const audit = record(input.audit, "audit");
  const verified = audit.verified;
  if (!Array.isArray(verified)) throw new TypeError("verified must be an array");
  return record(verified[0], "verified[0]");
}

function statement(
  input: Fixture,
  expectedPredicateType: string,
): Record<string, unknown> {
  const verified = verifiedRecord(input);
  const bundles = verified.attestationBundles;
  if (!Array.isArray(bundles)) throw new TypeError("attestationBundles must be an array");
  const candidate = bundles
    .map((value) => record(value, "attestation bundle"))
    .find((value) => value.predicateType === expectedPredicateType);
  if (candidate === undefined) throw new TypeError("attestation bundle is missing");
  const envelope = record(record(candidate.bundle, "bundle").dsseEnvelope, "envelope");
  const payload = envelope.payload;
  if (typeof payload !== "string") throw new TypeError("payload must be a string");
  return record(JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as unknown, "statement");
}

function replaceStatement(
  input: Fixture,
  expectedPredicateType: string,
  replacement: Record<string, unknown>,
): void {
  const verified = verifiedRecord(input);
  const bundles = verified.attestationBundles;
  if (!Array.isArray(bundles)) throw new TypeError("attestationBundles must be an array");
  const candidate = bundles
    .map((value) => record(value, "attestation bundle"))
    .find((value) => value.predicateType === expectedPredicateType);
  if (candidate === undefined) throw new TypeError("attestation bundle is missing");
  const envelope = record(record(candidate.bundle, "bundle").dsseEnvelope, "envelope");
  envelope.payload = Buffer.from(JSON.stringify(replacement), "utf8").toString("base64");
}

function mutateStatement(
  input: Fixture,
  expectedPredicateType: string,
  mutate: (statement: Record<string, unknown>) => void,
): void {
  const decoded = statement(input, expectedPredicateType);
  mutate(decoded);
  replaceStatement(input, expectedPredicateType, decoded);
}

describe("npm release attestation", () => {
  test("binds the cryptographically audited package to the exact workflow and source", () => {
    expect(verifyNpmReleaseAttestation(validInput())).toEqual({
      invocationId: "https://github.com/hraness/kb/actions/runs/123456/attempts/2",
      sourceSha,
      tarballSha512,
      version,
    });
  });

  test("rejects identity, provenance, publication, signature, and channel drift", () => {
    const corruptions: readonly Readonly<{
      label: string;
      mutate: (input: Fixture) => void;
    }>[] = [
      {
        label: "tarball subject",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const subjects = decoded.subject;
          if (!Array.isArray(subjects)) throw new TypeError("subject must be an array");
          record(record(subjects[0], "subject").digest, "digest").sha512 = "c".repeat(128);
        }),
      },
      {
        label: "workflow path",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const build = record(record(decoded.predicate, "predicate").buildDefinition, "build");
          record(record(build.externalParameters, "external").workflow, "workflow").path = "other.yml";
        }),
      },
      {
        label: "workflow ref",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const build = record(record(decoded.predicate, "predicate").buildDefinition, "build");
          record(record(build.externalParameters, "external").workflow, "workflow").ref = "refs/heads/other";
        }),
      },
      {
        label: "workflow repository",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const build = record(record(decoded.predicate, "predicate").buildDefinition, "build");
          record(record(build.externalParameters, "external").workflow, "workflow").repository = "https://github.com/other/repository";
        }),
      },
      {
        label: "event",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const build = record(record(decoded.predicate, "predicate").buildDefinition, "build");
          record(record(build.internalParameters, "internal").github, "github").event_name = "push";
        }),
      },
      {
        label: "repository id",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const build = record(record(decoded.predicate, "predicate").buildDefinition, "build");
          record(record(build.internalParameters, "internal").github, "github").repository_id = "1";
        }),
      },
      {
        label: "repository owner id",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const build = record(record(decoded.predicate, "predicate").buildDefinition, "build");
          record(record(build.internalParameters, "internal").github, "github").repository_owner_id = "1";
        }),
      },
      {
        label: "source dependency count",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const build = record(record(decoded.predicate, "predicate").buildDefinition, "build");
          const dependencies = build.resolvedDependencies;
          if (!Array.isArray(dependencies)) throw new TypeError("dependencies must be an array");
          dependencies.push(structuredClone(dependencies[0]));
        }),
      },
      {
        label: "source commit",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const build = record(record(decoded.predicate, "predicate").buildDefinition, "build");
          const dependencies = build.resolvedDependencies;
          if (!Array.isArray(dependencies)) throw new TypeError("dependencies must be an array");
          record(record(dependencies[0], "dependency").digest, "digest").gitCommit = "c".repeat(40);
        }),
      },
      {
        label: "source dependency URI",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const build = record(record(decoded.predicate, "predicate").buildDefinition, "build");
          const dependencies = build.resolvedDependencies;
          if (!Array.isArray(dependencies)) throw new TypeError("dependencies must be an array");
          record(dependencies[0], "dependency").uri = "git+https://github.com/hraness/kb@refs/tags/v0.20.0";
        }),
      },
      {
        label: "builder",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const run = record(record(decoded.predicate, "predicate").runDetails, "run");
          record(run.builder, "builder").id = "https://example.com/runner";
        }),
      },
      {
        label: "invocation",
        mutate: (input) => mutateStatement(input, provenancePredicateType, (decoded) => {
          const run = record(record(decoded.predicate, "predicate").runDetails, "run");
          record(run.metadata, "metadata").invocationId = "https://github.com/other/repo/actions/runs/1/attempts/1";
        }),
      },
      {
        label: "publish registry",
        mutate: (input) => mutateStatement(input, publishPredicateType, (decoded) => {
          record(decoded.predicate, "predicate").registry = "https://registry.example";
        }),
      },
      {
        label: "publish version",
        mutate: (input) => mutateStatement(input, publishPredicateType, (decoded) => {
          record(decoded.predicate, "predicate").version = "0.19.0";
        }),
      },
      {
        label: "registry integrity",
        mutate: (input) => {
          record(input.registryView.dist, "dist").integrity = `sha512-${Buffer.from("c".repeat(128), "hex").toString("base64")}`;
        },
      },
      {
        label: "registry signature",
        mutate: (input) => {
          record(input.registryView.dist, "dist").signatures = [];
        },
      },
      {
        label: "attestation metadata",
        mutate: (input) => {
          record(record(input.registryView.dist, "dist").attestations, "attestations").url = "https://example.invalid";
        },
      },
      {
        label: "latest channel",
        mutate: (input) => {
          input.registryLatest = "0.19.0";
        },
      },
      {
        label: "cryptographic audit",
        mutate: (input) => {
          input.audit.invalid.push({ code: "EATTESTATIONVERIFY" });
        },
      },
      {
        label: "missing cryptographic evidence",
        mutate: (input) => {
          input.audit.missing.push({ name: "@hraness/kb", version });
        },
      },
    ];

    for (const corruption of corruptions) {
      const input = structuredClone(validInput());
      corruption.mutate(input);
      expect(() => verifyNpmReleaseAttestation(input), corruption.label).toThrow();
    }
  });

  test("rejects stable version components above Number.MAX_SAFE_INTEGER", () => {
    const maximum = "9007199254740991";
    expect(verifyNpmReleaseAttestation(validInput(`${maximum}.${maximum}.${maximum}`)).version)
      .toBe(`${maximum}.${maximum}.${maximum}`);
    for (const packageVersion of [
      "9007199254740992.0.0",
      "0.9007199254740992.0",
      "0.0.9007199254740992",
    ]) {
      expect(() => verifyNpmReleaseAttestation(validInput(packageVersion)))
        .toThrow("Number.MAX_SAFE_INTEGER");
    }
  });
});
