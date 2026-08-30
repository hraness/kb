import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  canonicalSha256,
  createKnowledgeGraphRecordV1,
  knowledgeGraphRecordRefV1,
  type KnowledgeGraphRecordKindV1,
} from "@hraness/oh";
import {
  createOhDependencyClosureV1,
  createOhStoreBindingV1,
  OH_CANONICAL_STORE_PROFILE_V1,
  OH_WORKING_STORE_PROFILE_V1,
} from "@hraness/oh/store";

import { createOhAdoptionPreparerV1 } from "./oh-adoption.js";

function fixture(kind: KnowledgeGraphRecordKindV1 = "assertion") {
  const binding = createOhStoreBindingV1({
    profile: OH_WORKING_STORE_PROFILE_V1,
    realmId: "tenant:test/thread:one",
    spaceId: "thread:one",
    v: 1,
  });
  const evidence = createKnowledgeGraphRecordV1({
    dependencies: [],
    key: "evidence:source",
    kind: "evidence",
    v: 1,
    value: { locator: "https://example.test/source" },
  });
  const assertion = createKnowledgeGraphRecordV1({
    dependencies: ["evidence:source"],
    key: "assertion:candidate",
    kind,
    v: 1,
    value: { state: "proposed", text: "A bounded candidate." },
  });
  const records = [assertion, evidence];
  const head = {
    generation: 3,
    graphRevisionSha256: canonicalSha256({ fixture: "graph-revision", v: 1 }),
    operationSha256: canonicalSha256({ fixture: "operation", v: 1 }),
    recordsSha256: canonicalSha256(records.map(knowledgeGraphRecordRefV1)),
    sequence: 3,
    v: 1,
  } as const;
  const capsule = createOhDependencyClosureV1({
    binding,
    roots: [assertion.key],
    snapshot: { head, records, v: 1 },
  });
  const expectedSource = {
    authorityId: "sponge.working.primary",
    binding,
    head,
    v: 1,
  } as const;
  const hostPolicy = {
    conflicts: {
      notes: ["No destination collision was found; review must confirm."],
      status: "none-observed",
      v: 1,
    },
    destination: {
      purpose: "kb.maintained-knowledge",
      targetPath: "notes/adopted-candidate.md",
      v: 1,
    },
    expectedSource,
    review: { route: "kb.adoption-review", status: "required", v: 1 },
    rights: {
      decisionId: "rights:decision-one",
      disposition: "cleared-for-purpose",
      purpose: "kb.maintained-knowledge",
      v: 1,
    },
    v: 1,
  } as const;
  const prepareInput = {
    capsule,
    redactions: [],
    transformations: [{
      id: "transform:normalize-title",
      recordKey: assertion.key,
      summary: "Normalize the title without changing the proposed claim.",
      v: 1,
    }],
    v: 1,
  } as const;
  return { assertion, binding, capsule, evidence, expectedSource, head, hostPolicy, prepareInput };
}

describe("Oh dependency-closure adoption", () => {
  test("prepares deterministic immutable review bytes from a host-bound policy", () => {
    const { hostPolicy, prepareInput } = fixture();
    const preparer = createOhAdoptionPreparerV1(hostPolicy);
    const first = preparer.prepare(prepareInput);
    const second = preparer.prepare({ ...prepareInput,
      transformations: [...prepareInput.transformations].reverse() });
    expect(second).toEqual(first);
    expect(first.manifest.status).toBe("prepared");
    expect(first.manifest.review.status).toBe("required");
    expect(first.markdown).toContain("This is a review candidate, not reviewed knowledge.");
    expect(first.markdown).toContain("does not mutate a vault");
    expect(first.markdown).not.toContain("status: reviewed");
    expect(first.artifactSha256).toBe(createHash("sha256").update(first.markdown).digest("hex"));
    expect(Object.keys(first)).toEqual(["artifactSha256", "candidateSha256", "manifest", "markdown", "v"]);
    expect(Object.keys(first.manifest.source.binding)).toEqual(["bindingSha256", "v"]);
    expect("realmId" in first.manifest.source.binding).toBeFalse();
    expect(Object.isFrozen(first)).toBeTrue();
    expect(Object.isFrozen(first.manifest)).toBeTrue();
    expect(Object.isFrozen(first.manifest.source.head)).toBeTrue();
    expect(Object.isFrozen(first.manifest.source.records)).toBeTrue();
    expect(Object.isFrozen(first.manifest.source.records[0]!.dependencies)).toBeTrue();
  });

  test("binds authority and policy before exposing the narrow preparation facade", () => {
    const { hostPolicy, prepareInput } = fixture();
    const mutablePolicy = structuredClone(hostPolicy);
    const preparer = createOhAdoptionPreparerV1(mutablePolicy);
    Reflect.set(mutablePolicy.destination, "targetPath", "notes/laundered.md");
    Reflect.set(mutablePolicy.expectedSource, "authorityId", "attacker.working");
    Reflect.set(mutablePolicy.conflicts.notes, "0", "Silently replace the destination.");
    const candidate = preparer.prepare(prepareInput);
    expect(candidate.manifest.destination.targetPath).toBe("notes/adopted-candidate.md");
    expect(candidate.manifest.source.authorityId).toBe("sponge.working.primary");
    expect(candidate.manifest.conflicts.notes).toEqual([
      "No destination collision was found; review must confirm.",
    ]);
    expect(Object.keys(preparer)).toEqual(["prepare"]);
    for (const forbidden of ["commit", "purge", "store", "write", "expectedSource", "destination"]) {
      expect(forbidden in preparer).toBeFalse();
    }
    expect(() => preparer.prepare({ ...prepareInput,
      destination: hostPolicy.destination })).toThrow("Invalid Oh adoption preparation input");
    expect(() => preparer.prepare({ ...prepareInput,
      expectedSource: hostPolicy.expectedSource })).toThrow("Invalid Oh adoption preparation input");
  });

  test("uses Oh's verifier for exact binding, head, closure, and records", () => {
    const { assertion, binding, capsule, evidence, head, hostPolicy, prepareInput } = fixture();
    const wrongHead = createOhAdoptionPreparerV1({ ...hostPolicy,
      expectedSource: { ...hostPolicy.expectedSource,
        head: { ...head, operationSha256: canonicalSha256({ wrong: "head" }) } } });
    expect(() => wrongHead.prepare(prepareInput)).toThrow("bound authority and head");

    const otherBinding = createOhStoreBindingV1({ profile: OH_WORKING_STORE_PROFILE_V1,
      realmId: "tenant:test/thread:other", spaceId: "thread:other", v: 1 });
    const wrongBinding = createOhAdoptionPreparerV1({ ...hostPolicy,
      expectedSource: { ...hostPolicy.expectedSource, binding: otherBinding } });
    expect(() => wrongBinding.prepare(prepareInput)).toThrow("bound authority and head");

    const preparer = createOhAdoptionPreparerV1(hostPolicy);
    expect(() => preparer.prepare({ ...prepareInput, capsule: { ...capsule,
      records: [{ ...assertion, value: { state: "reviewed", text: "Tampered." } }, evidence] } }))
      .toThrow("source capsule");
    expect(() => preparer.prepare({ ...prepareInput,
      capsule: { ...capsule, records: [assertion] } })).toThrow("source capsule");

    const extra = createKnowledgeGraphRecordV1({ dependencies: [], key: "entity:smuggled",
      kind: "entity", v: 1, value: { name: "Smuggled" } });
    const extraPayload = { binding, head,
      records: [...capsule.records, extra].sort((left, right) => left.key.localeCompare(right.key)),
      roots: capsule.roots, v: 1 as const };
    expect(() => preparer.prepare({ ...prepareInput, capsule: { ...extraPayload,
      closureSha256: canonicalSha256(extraPayload) } })).toThrow("source capsule");
  });

  test("fails closed on unsafe host policy, canonical sources, and derived-only roots", () => {
    const { head, hostPolicy } = fixture();
    for (const targetPath of ["../notes/out.md", "/tmp/out.md", "notes/../../out.md",
      "plans/out.md", "notes/out.txt", "notes/.hidden.md"]) {
      expect(() => createOhAdoptionPreparerV1({ ...hostPolicy,
        destination: { ...hostPolicy.destination, targetPath } })).toThrow("host policy");
    }
    const { rights: _rights, ...withoutRights } = hostPolicy;
    expect(() => createOhAdoptionPreparerV1(withoutRights)).toThrow("host policy");
    expect(() => createOhAdoptionPreparerV1({ ...hostPolicy,
      review: { route: "kb.adoption-review", status: "reviewed", v: 1 } })).toThrow("host policy");
    expect(() => createOhAdoptionPreparerV1({ ...hostPolicy,
      rights: { ...hostPolicy.rights, purpose: "kb.some-other-purpose" } })).toThrow("host policy");

    const canonicalBinding = createOhStoreBindingV1({ profile: OH_CANONICAL_STORE_PROFILE_V1,
      realmId: "tenant:test/canonical", spaceId: "canonical", v: 1 });
    expect(() => createOhAdoptionPreparerV1({ ...hostPolicy,
      expectedSource: { ...hostPolicy.expectedSource, binding: canonicalBinding, head } }))
      .toThrow("host policy");

    const derived = fixture("view");
    expect(() => createOhAdoptionPreparerV1(derived.hostPolicy).prepare(derived.prepareInput))
      .toThrow("authoritative root");
    expect(() => createOhAdoptionPreparerV1(hostPolicy).prepare({
      authority: "derived", rows: [], v: 1,
    })).toThrow("preparation input");
  });

  test("requires exact record disclosures and escapes host review prose", () => {
    const { hostPolicy, prepareInput } = fixture();
    const preparer = createOhAdoptionPreparerV1(hostPolicy);
    expect(() => preparer.prepare({ ...prepareInput,
      redactions: [{ id: "redact:one", recordKey: "entity:outside", summary: "Remove", v: 1 }] }))
      .toThrow("valid disclosures");
    const candidate = createOhAdoptionPreparerV1({ ...hostPolicy,
      conflicts: { notes: ["<script>alert(1)</script>"], status: "requires-resolution", v: 1 } })
      .prepare(prepareInput);
    expect(candidate.markdown).not.toContain("<script>");
    expect(candidate.markdown).toContain("\\<script\\>");
  });

  test("rejects accessors, symbols, oversized capsules, and deep input without invoking code", () => {
    const { capsule, hostPolicy, prepareInput } = fixture();
    const preparer = createOhAdoptionPreparerV1(hostPolicy);
    let invoked = false;
    const hostileCapsule = { ...capsule } as Record<string, unknown>;
    Object.defineProperty(hostileCapsule, "records", { enumerable: true, get: () => {
      invoked = true;
      return capsule.records;
    } });
    expect(() => preparer.prepare({ ...prepareInput, capsule: hostileCapsule })).toThrow("preparation input");
    expect(invoked).toBeFalse();
    expect(() => preparer.prepare({ ...prepareInput,
      [Symbol("smuggled")]: true })).toThrow("preparation input");
    expect(() => preparer.prepare({ ...prepareInput,
      capsule: { ...capsule, records: Array.from({ length: 1_025 }, () => capsule.records[0]) } }))
      .toThrow("preparation input");

    let deep: unknown = "leaf";
    for (let index = 0; index < 130; index += 1) deep = { next: deep };
    expect(() => preparer.prepare({ ...prepareInput, redactions: deep })).toThrow("preparation input");

    const hostilePolicy = { ...hostPolicy } as Record<string, unknown>;
    Object.defineProperty(hostilePolicy, "rights", { enumerable: true, get: () => {
      invoked = true;
      return hostPolicy.rights;
    } });
    expect(() => createOhAdoptionPreparerV1(hostilePolicy)).toThrow("host policy");
    expect(invoked).toBeFalse();
  });

  test("detaches candidate provenance from mutable capsule-owned arrays", () => {
    const { capsule, hostPolicy, prepareInput } = fixture();
    const candidate = createOhAdoptionPreparerV1(hostPolicy).prepare(prepareInput);
    const original = candidate.manifest.source.records[0]!.dependencies;
    (capsule.records[0]!.dependencies as string[]).push("entity:late-mutation");
    expect(candidate.manifest.source.records[0]!.dependencies).toEqual(original);
    expect(candidate.manifest.source.records[0]!.dependencies).not.toContain("entity:late-mutation");
  });
});
