import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  parseOhDependencyClosureCapsuleV1,
  prepareOhAdoptionCandidateV1,
} from "./oh-adoption.js";

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function sha(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function fixture(kind = "assertion") {
  const capabilities = { changesSince: true, dependencyClosureExport: true, exactSnapshots: true,
    operationReplication: false, semanticBundleCommit: true, v: 1, wholeSpacePurge: true } as const;
  const profilePayload = { applicationProfileSha256: null, capabilities, profileId: "kb.working.v1",
    profileKind: "working", v: 1 } as const;
  const profile = { ...profilePayload, profileSha256: sha(profilePayload) };
  const bindingPayload = { contractSha256: "a".repeat(64), profile, realmId: "tenant:test/thread:one",
    spaceId: "thread:one", v: 1 } as const;
  const binding = { ...bindingPayload, bindingSha256: sha(bindingPayload) };
  const evidencePayload = { dependencies: [], key: "evidence:source", kind: "evidence", v: 1,
    value: { locator: "https://example.test/source" } } as const;
  const evidence = { ...evidencePayload, recordSha256: sha(evidencePayload) };
  const assertionPayload = { dependencies: ["evidence:source"], key: "assertion:candidate", kind, v: 1,
    value: { state: "proposed", text: "A bounded candidate." } } as const;
  const assertion = { ...assertionPayload, recordSha256: sha(assertionPayload) };
  const records = [assertion, evidence];
  const recordRefs = records.map((record) => ({ dependencies: record.dependencies, key: record.key,
    kind: record.kind, sha256: record.recordSha256, v: 1 }));
  const head = { generation: 3, graphRevisionSha256: "b".repeat(64), operationSha256: "c".repeat(64),
    recordsSha256: sha(recordRefs), sequence: 3, v: 1 } as const;
  const capsulePayload = { binding, head, records, roots: ["assertion:candidate"], v: 1 } as const;
  const capsule = { ...capsulePayload, closureSha256: sha(capsulePayload) };
  const expectedSource = { authorityId: "sponge.working.primary", binding, head, v: 1 } as const;
  const input = {
    capsule,
    conflicts: { notes: ["No destination collision was found; review must confirm."],
      status: "none-observed", v: 1 },
    destination: { purpose: "kb.maintained-knowledge", targetPath: "notes/adopted-candidate.md", v: 1 },
    expectedSource,
    redactions: [],
    review: { route: "kb.adoption-review", status: "required", v: 1 },
    rights: { decisionId: "rights:decision-one", disposition: "cleared-for-purpose",
      purpose: "kb.maintained-knowledge", v: 1 },
    transformations: [{ id: "transform:normalize-title", recordKey: "assertion:candidate",
      summary: "Normalize the title without changing the proposed claim.", v: 1 }],
    v: 1,
  } as const;
  return { assertion, binding, capsule, evidence, expectedSource, head, input };
}

describe("Oh dependency-closure adoption", () => {
  test("prepares deterministic review-only Markdown without laundering proposal authority", () => {
    const { input } = fixture();
    const first = prepareOhAdoptionCandidateV1(input);
    const second = prepareOhAdoptionCandidateV1({ ...input,
      transformations: [...input.transformations].reverse() });
    expect(second).toEqual(first);
    expect(first.manifest.status).toBe("prepared");
    expect(first.manifest.review.status).toBe("required");
    expect(first.markdown).toContain("This is a review candidate, not reviewed knowledge.");
    expect(first.markdown).toContain("does not mutate a vault");
    expect(first.markdown).not.toContain("status: reviewed");
    expect(first.artifactSha256).toBe(createHash("sha256").update(first.markdown).digest("hex"));
    expect(Object.keys(first)).toEqual(["artifactSha256", "candidateSha256", "manifest", "markdown", "v"]);
  });

  test("verifies the exact expected binding and head and rejects closure tampering", () => {
    const { assertion, capsule, evidence, expectedSource, head } = fixture();
    expect(parseOhDependencyClosureCapsuleV1(capsule, expectedSource)).toEqual(capsule);
    expect(parseOhDependencyClosureCapsuleV1(capsule, { ...expectedSource,
      head: { ...head, operationSha256: "d".repeat(64) } })).toBeNull();
    expect(parseOhDependencyClosureCapsuleV1(capsule, { ...expectedSource,
      binding: { ...expectedSource.binding, bindingSha256: "e".repeat(64) } })).toBeNull();
    expect(parseOhDependencyClosureCapsuleV1({ ...capsule,
      records: [{ ...assertion, value: { state: "reviewed", text: "Tampered." } }, evidence] }, expectedSource)).toBeNull();
    expect(parseOhDependencyClosureCapsuleV1({ ...capsule, records: [assertion] }, expectedSource)).toBeNull();
    const extraPayload = { dependencies: [], key: "entity:smuggled", kind: "entity", v: 1,
      value: { name: "Smuggled" } } as const;
    const extra = { ...extraPayload, recordSha256: sha(extraPayload) };
    const extraCapsulePayload = { binding: capsule.binding, head: capsule.head,
      records: [...capsule.records, extra].sort((left, right) => left.key.localeCompare(right.key)),
      roots: capsule.roots, v: 1 } as const;
    expect(parseOhDependencyClosureCapsuleV1({ ...extraCapsulePayload,
      closureSha256: sha(extraCapsulePayload) }, expectedSource)).toBeNull();
  });

  test("fails closed on unsafe targets, missing policy, derived-only roots, and projection-shaped inputs", () => {
    const { capsule, expectedSource, input } = fixture();
    for (const targetPath of ["../notes/out.md", "/tmp/out.md", "notes/../../out.md", "plans/out.md", "notes/out.txt"]) {
      expect(() => prepareOhAdoptionCandidateV1({ ...input,
        destination: { ...input.destination, targetPath } })).toThrow("source capsule or destination");
    }
    const { rights: _rights, ...withoutRights } = input;
    expect(() => prepareOhAdoptionCandidateV1(withoutRights)).toThrow("Invalid Oh adoption");
    expect(() => prepareOhAdoptionCandidateV1({ ...input,
      review: { route: "kb.adoption-review", status: "reviewed", v: 1 } })).toThrow("requires rights");
    const derived = fixture("view");
    expect(() => prepareOhAdoptionCandidateV1(derived.input)).toThrow("authoritative-root");
    expect(parseOhDependencyClosureCapsuleV1({ authority: "derived", rows: [], v: 1 }, expectedSource)).toBeNull();
    expect(parseOhDependencyClosureCapsuleV1({ ...capsule, projection: { rows: [] } }, expectedSource)).toBeNull();
  });

  test("requires disclosures to reference exact capsule records and escapes review prose", () => {
    const { input } = fixture();
    expect(() => prepareOhAdoptionCandidateV1({ ...input,
      redactions: [{ id: "redact:one", recordKey: "entity:outside", summary: "Remove", v: 1 }] }))
      .toThrow("requires rights");
    const candidate = prepareOhAdoptionCandidateV1({ ...input,
      conflicts: { notes: ["<script>alert(1)</script>"], status: "requires-resolution", v: 1 } });
    expect(candidate.markdown).not.toContain("<script>");
    expect(candidate.markdown).toContain("\\<script\\>");
  });

  test("rejects accessors and non-JSON properties without invoking foreign code", () => {
    const { expectedSource, input } = fixture();
    let invoked = false;
    const hostile = { ...input.capsule } as Record<string, unknown>;
    Object.defineProperty(hostile, "records", { enumerable: true, get: () => {
      invoked = true;
      return input.capsule.records;
    } });
    expect(parseOhDependencyClosureCapsuleV1(hostile, expectedSource)).toBeNull();
    expect(invoked).toBeFalse();
    expect(parseOhDependencyClosureCapsuleV1({ ...input.capsule,
      [Symbol("smuggled")]: true }, expectedSource)).toBeNull();
  });
});
