import { describe, expect, test } from "bun:test";

import { validateWorkflowYaml } from "./check-workflow-yaml.ts";

describe("GitHub workflow YAML", () => {
  test("accepts commands with YAML-significant text inside block scalars", () => {
    expect(() => validateWorkflowYaml(`
name: CI
on:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: >-
          node -e 'const value = { type: "json" }'
`, "workflow.yml")).not.toThrow();
  });

  test("rejects YAML-significant command text in a plain scalar", () => {
    expect(() => validateWorkflowYaml(`
name: CI
on:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: node -e 'const value = { type: "json" }'
`, "workflow.yml")).toThrow("invalid YAML");
  });
});
