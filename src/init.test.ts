import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initVault } from "./init.js";
import { scanVault } from "./vault.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("vault initialization", () => {
  test("creates an agent-ready empty vault that passes graph checks", async () => {
    const parent = mkdtempSync(join(tmpdir(), "hraness-wordcell-init-test-"));
    roots.push(parent);
    const root = join(parent, "knowledge");
    const result = await initVault(root);
    const scanned = await scanVault(root);

    expect(result.files).toContain("articles/AGENTS.md");
    expect(result.files).toContain("scopes/AGENTS.md");
    expect(result.files).toContain("index.md");
    expect(scanned.index).toBe("current");
    expect(scanned.analysis.noteCount).toBe(0);
    expect(scanned.analysis.issues).toEqual([]);
    const rootGuide = readFileSync(join(root, "AGENTS.md"), "utf8");
    const planGuide = readFileSync(join(root, "plans/AGENTS.md"), "utf8");
    const scopeGuide = readFileSync(join(root, "scopes/AGENTS.md"), "utf8");
    expect(rootGuide).toContain("# Guidelines");
    expect(rootGuide).toContain("wordcell search");
    expect(rootGuide).toContain("wordcell graph");
    expect(rootGuide).toContain("wordcell percolate");
    expect(rootGuide).toContain("--no-catalog");
    expect(rootGuide).toContain("type: concept");
    expect(rootGuide).toContain("relations");
    expect(planGuide).toContain("type: plan");
    expect(planGuide).toContain("verification");
    expect(planGuide).toContain("same file");
    expect(planGuide).toContain("## Result");
    expect(planGuide).toContain("## Durable memory");
    expect(planGuide).toContain("no durable promotion was needed");
    expect(scopeGuide).toContain("type: agent-context");
    expect(scopeGuide).toContain("wordcell agents identity");
    expect(scopeGuide).toContain("wordcell agents check");
  });

  test("refuses to merge into an existing directory", async () => {
    const parent = mkdtempSync(join(tmpdir(), "hraness-wordcell-init-existing-test-"));
    roots.push(parent);
    const root = join(parent, "knowledge");
    await initVault(root);

    let rejected = false;
    try {
      await initVault(root);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(existsSync(join(root, "index.md"))).toBe(true);
  });
});
