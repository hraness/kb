import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { LANDING_END, LANDING_START, readmeLanding, renderReadmeHtml } from "./readme-html.ts";

const repository = join(import.meta.dir, "..", "..");

test("renders the repository README with stable heading fragments and repository-rooted relative links", async () => {
  const source = await readFile(join(repository, "README.md"), "utf8");
  const html = renderReadmeHtml(source);
  expect(html).toContain('<h2 id="install">Install</h2>');
  expect(html).toContain('<h2 id="the-kb-vault-format">The kb vault format</h2>');
  expect(html).toContain('href="https://github.com/hraness/wordcell/blob/main/SECURITY.md"');
  expect(html).not.toContain("<script");
});

test("extracts the landing block between the shared Hraness markers", async () => {
  const source = await readFile(join(repository, "README.md"), "utf8");
  expect(source.indexOf(LANDING_START)).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(LANDING_END)).toBeGreaterThan(source.indexOf(LANDING_START));
  const landing = readmeLanding(source);
  expect(landing.title).toBe("Wordcell");
  expect(landing.lead).toContain("knowledge base for coding agents");
  expect(landing.markdown).toContain("wordcell init kb");
});

test("rejects unsafe README link targets", () => {
  expect(() => renderReadmeHtml("[x](javascript:alert(1))")).toThrow("disallowed URL scheme");
  expect(() => renderReadmeHtml("[x](//evil.example)")).toThrow("protocol-relative");
  expect(() => renderReadmeHtml("[x](#missing)")).toThrow("no rendered heading");
});


test("omits repository landing markers and renders the skill badge as a durable text link", async () => {
  const source = await Bun.file(new URL("../../README.md", import.meta.url)).text();
  const html = renderReadmeHtml(source);
  expect(html).not.toContain("hraness:wordcell-landing");
  expect(html).not.toContain("https://skills.sh/b/");
  expect(html).toContain("Agent Skill on skills.sh");
});
