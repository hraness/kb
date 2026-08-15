import { describe, expect, test } from "bun:test";

import {
  canonicalJsonBytes,
  kbEvidenceRoutingBuildContractSha256,
  kbEvidenceRoutingEvaluationBuildConfigSchema,
  kbEvidenceRoutingImplementationSha256,
  parseKbEvidenceRoutingBuildCliArguments,
} from "./evaluation-builder.js";

describe("evaluation builder public boundary", () => {
  test("parses only the two explicit artifact lifecycle operations", () => {
    expect(parseKbEvidenceRoutingBuildCliArguments([
      "--anchor-seal",
      "--config",
      "/tmp/build.json",
      "--artifact-root",
      "/tmp/artifact-b",
    ])).toEqual({
      mode: "anchor-seal",
      configPath: "/tmp/build.json",
      artifactRoot: "/tmp/artifact-b",
    });
    expect(parseKbEvidenceRoutingBuildCliArguments([
      "--build",
      "--config",
      "/tmp/build.json",
      "--artifact-root",
      "/tmp/artifact-b",
    ]).mode).toBe("build");
    expect(() => parseKbEvidenceRoutingBuildCliArguments([
      "--build",
      "--config",
      "/tmp/build.json",
    ])).toThrow("Usage: kb-evaluation-builder");
  });

  test("uses canonical JSON bytes for immutable build commitments", () => {
    const bytes = canonicalJsonBytes({ z: [3, { b: true, a: null }], a: "value" });
    expect(bytes.toString("utf8")).toBe(
      '{"a":"value","z":[3,{"a":null,"b":true}]}\n',
    );
    expect(kbEvidenceRoutingBuildContractSha256(bytes)).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => canonicalJsonBytes({ invalid: Number.NaN })).toThrow(
      "non-finite number",
    );
  });

  test("keeps implementation commitments independent of source ordering", () => {
    const sources = [{
      sourcePath: "src/a.ts",
      bytes: Buffer.from("export const a = 1;\n"),
    }, {
      sourcePath: "src/b.ts",
      bytes: Buffer.from("export const b = 2;\n"),
    }] as const;
    expect(kbEvidenceRoutingImplementationSha256(sources)).toBe(
      kbEvidenceRoutingImplementationSha256(sources.toReversed()),
    );
  });

  test("rejects incomplete or extended build configurations", () => {
    expect(kbEvidenceRoutingEvaluationBuildConfigSchema.safeParse({}).success)
      .toBeFalse();
    expect(kbEvidenceRoutingEvaluationBuildConfigSchema.safeParse({
      schemaVersion: 1,
      unexpected: true,
    }).success).toBeFalse();
  });
});
