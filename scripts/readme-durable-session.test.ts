import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { parseArguments } from "../src/cli.js";

const manifestUrl = new URL("../package.json", import.meta.url);
const readmeUrl = new URL("../README.md", import.meta.url);
const skillUrl = new URL("../skills/kb/SKILL.md", import.meta.url);
const queryReferenceUrl = new URL(
  "../skills/kb/references/query.md",
  import.meta.url,
);

async function publicSurface(): Promise<Readonly<{
  manifest: Readonly<{ version: string }>;
  readme: string;
  skill: string;
  queryReference: string;
}>> {
  const [manifestSource, readme, skill, queryReference] = await Promise.all([
    readFile(manifestUrl, "utf8"),
    readFile(readmeUrl, "utf8"),
    readFile(skillUrl, "utf8"),
    readFile(queryReferenceUrl, "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource) as { readonly version?: unknown };
  if (typeof manifest.version !== "string") {
    throw new TypeError("package.json must declare a string version");
  }
  return Object.freeze({
    manifest: Object.freeze({ version: manifest.version }),
    readme,
    skill,
    queryReference,
  });
}

function compact(value: string): string {
  return value.replace(/\s+/gu, " ");
}

describe("durable-session documentation", () => {
  test("leads with the working narrative and keeps reference depth behind it", async () => {
    const { readme } = await publicSurface();
    const headings = [
      "## Install",
      "## Keep one decision available to the next session",
      "## Recover the stopped session",
      "## A knowledge base for your coding agents",
      "## Installation reference",
      "## Command surface",
      "## Agent skills",
      "## Release notes",
    ] as const;
    const offsets = headings.map((heading) => readme.indexOf(heading));
    expect(offsets.every((offset) => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));

    const landingStart = readme.indexOf("<!-- hraness:kb-landing:start -->");
    const landingEnd = readme.indexOf("<!-- hraness:kb-landing:end -->");
    expect(landingStart).toBeGreaterThanOrEqual(0);
    expect(landingEnd).toBeGreaterThan(landingStart);
    const landing = compact(readme.slice(landingStart, landingEnd));
    for (const evidence of [
      "kb/notes/parser-contract.md",
      "kb backlinks notes/parser-contract --root kb",
      "kb search \"why parser retries stop\" --root kb --mode exact",
      "kb context packages/parser/src/index.ts --root kb --repo .",
      "kb history notes/parser-contract --root kb --repo .",
      "They do not reconstruct private chat or prove that the note is still correct.",
    ] as const) expect(landing).toContain(evidence);
  });

  test("keeps the package, README, and public skill on one immutable release", async () => {
    const { manifest, readme, skill } = await publicSurface();
    const packagePin = `@hraness/kb@${manifest.version}`;
    const skillPin = `hraness/kb#v${manifest.version}`;
    expect(readme).toContain(`bun add --global ${packagePin}`);
    expect(readme).toContain(`bun add --exact ${packagePin}`);
    expect(readme).toContain(skillPin);
    expect(skill).toContain(`bun add --global ${packagePin}`);
    expect(`${readme}\n${skill}`).not.toContain("@hraness/kb@latest");
  });

  test("keeps every opening workflow command accepted by the CLI parser", () => {
    const commands = [
      ["init", "kb"],
      [
        "note", "create", "notes/parser-contract",
        "--title", "Parser contract",
        "--type", "concept",
        "--tag", "architecture",
        "--body", "Parser retries stop after three attempts.",
        "--root", "kb",
      ],
      [
        "note", "create", "plans/parser-v2",
        "--title", "Parser v2",
        "--type", "plan",
        "--body", "The plan implements [[notes/parser-contract|the parser contract]].",
        "--root", "kb",
      ],
      ["context", "packages/parser/src/index.ts", "--root", "kb", "--repo", "."],
      [
        "search", "why parser retries stop", "--root", "kb", "--mode", "exact",
        "--history", "--repo", ".",
      ],
      ["backlinks", "notes/parser-contract", "--root", "kb"],
      ["history", "notes/parser-contract", "--root", "kb", "--repo", "."],
    ] as const;
    const expectedKinds = [
      "init",
      "note-create",
      "note-create",
      "context",
      "search",
      "backlinks",
      "history",
    ] as const;

    for (const [index, command] of commands.entries()) {
      const result = parseArguments(command);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.kind).toBe(expectedKinds[index]);
    }
  });

  test("routes recovered-session work to matching agent-readable guidance", async () => {
    const { skill, queryReference } = await publicSurface();
    expect(skill).toContain("Recover work from an earlier session");
    expect(skill).toContain("[Query the knowledge base](references/query.md)");
    expect(queryReference).toContain("## Recover a stopped session");
    for (const command of [
      "kb context packages/parser/src/index.ts",
      "kb search \"why parser retries stop\"",
      "kb backlinks notes/parser-contract",
      "kb history notes/parser-contract",
    ] as const) expect(queryReference).toContain(command);
    expect(compact(queryReference)).toContain(
      "This workflow recovers only context that was persisted in files or Git",
    );
  });
});
