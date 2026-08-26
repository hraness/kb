import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseDocument } from "yaml";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

export function validateWorkflowYaml(source: string, label: string): void {
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
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, "..");
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
  ]) {
    validateWorkflowYaml(
      await readFile(resolve(repositoryRoot, path), "utf8"),
      path,
    );
  }
}
