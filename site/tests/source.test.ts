import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parsePublishedRelease } from "../app/publication";

const site = join(import.meta.dir, "..");
const read = async (path: string): Promise<string> => await readFile(join(site, path), "utf8");

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function stableVersion(value: unknown, label: string): readonly [bigint, bigint, bigint] {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(value);
  if (match === null) throw new TypeError(`${label} must be a stable version.`);
  return [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)];
}

function compare(left: readonly [bigint, bigint, bigint], right: readonly [bigint, bigint, bigint]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index]! > right[index]! ? 1 : -1;
  }
  return 0;
}

describe("Wordcell site source contract", () => {
  test("advertises only a verified published release that does not exceed the source version", async () => {
    const [home, publication, packageSource] = await Promise.all([
      read("app/page.tsx"),
      read("published-release.json"),
      readFile(join(site, "..", "package.json"), "utf8"),
    ]);
    const publishedRelease = record(JSON.parse(publication) as unknown, "published release");
    const packageJson = record(JSON.parse(packageSource) as unknown, "source package");
    expect(Object.keys(publishedRelease).sort()).toEqual(["verificationRun", "version"]);
    const admitted = parsePublishedRelease(publishedRelease);
    if (admitted === null) {
      expect(home).toContain("First Wordcell release in preparation");
      return;
    }
    const published = stableVersion(admitted.version, "published version");
    const source = stableVersion(packageJson.version, "source version");
    expect(compare(published, source)).toBeLessThanOrEqual(0);
    expect(publishedRelease.verificationRun).toMatch(/^https:\/\/github\.com\/hraness\/(?:kb|wordcell)\/actions\/runs\/[1-9][0-9]*$/u);
    expect(home).toContain('import { publishedRelease } from "./publication"');
    expect(home).toContain("const releaseVersion = publishedRelease?.version;");
    expect(home).not.toContain("package.json");
    expect(home).toContain("href={publishedRelease.verificationRun}");
  });

  test("renders the README landing identity and the shared Ask AI links", async () => {
    const [packageJson, home, docs, generated] = await Promise.all([
      read("package.json"),
      read("app/page.tsx"),
      read("app/docs/page.tsx"),
      read("app/readme.generated.ts"),
    ]);
    expect(packageJson).toContain('"@hraness/ui": "github:hraness/ui#v0.4.10"');
    expect(packageJson).toContain('"@hraness/design-kit": "github:hraness/design-kit#v0.4.0"');
    expect(home).toContain('import { AskAiAboutThis } from "@hraness/ui"');
    expect(home).toContain('<AskAiAboutThis className="ask-ai" url="https://wordcell.io" />');
    expect(docs).toContain('<AskAiAboutThis className="ask-ai" url="https://wordcell.io/docs" />');
    expect(generated).toContain('export const readmeTitle = "Wordcell";');
    expect(generated).toContain("export const readmeHtml = ");
  });

  test("uses the shared design-kit fonts and marketing grammar", async () => {
    const globals = await read("app/globals.css");
    expect(globals).toContain('@import "@hraness/design-kit/fonts.css"');
    expect(globals).toContain('@import "@hraness/design-kit/product-marketing.css"');
    expect(globals).toContain('@import "../vendor/paper-theme/paper-theme.css"');
    expect(globals).not.toMatch(/Georgia|Times New Roman/u);
  });

  test("keeps the sitemap and robots on the canonical origin", async () => {
    const [sitemap, robots] = await Promise.all([read("public/sitemap.xml"), read("public/robots.txt")]);
    expect(sitemap).toContain("<loc>https://wordcell.io/</loc>");
    expect(sitemap).toContain("<loc>https://wordcell.io/docs</loc>");
    expect(robots).toContain("Sitemap: https://wordcell.io/sitemap.xml");
  });
});


test("publication metadata fails closed on malformed or partially verified releases", () => {
  expect(parsePublishedRelease({ version: null, verificationRun: null })).toBeNull();
  const verificationRun = "https://github.com/hraness/wordcell/actions/runs/123";
  expect(parsePublishedRelease({ version: "0.20.0", verificationRun })).toEqual({ version: "0.20.0", verificationRun });
  for (const value of [null, {}, { version: "0.20.0", verificationRun: null }, { version: "0.20.0", verificationRun: "https://example.com" }, { version: "9007199254740992.0.0", verificationRun }, { version: "0.20.0", verificationRun, extra: true }]) {
    expect(() => parsePublishedRelease(value)).toThrow();
  }
});


test("loads the immutable material after Paper and editorial styling", async () => {
  const [css, layout, checker] = await Promise.all([read("app/globals.css"), read("app/layout.tsx"), read("scripts/check-paper-theme.mjs")]);
  const materialImport = '@import "../vendor/hraness-lantern/lantern-material.css";';
  expect(css).toContain(materialImport);
  expect(css.indexOf(materialImport)).toBeGreaterThan(css.indexOf('product-marketing-preset.css";'));
  expect(layout).toContain('data-hraness-material="lantern"');
  expect(checker).toContain('import { checkLanternMaterialSnapshot } from "../vendor/hraness-lantern/check.mjs"');
  expect(checker).toContain("await checkLanternMaterialSnapshot();");
});
