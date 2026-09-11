import { resolve } from "node:path";

import { readmeLanding, renderReadmeHtml } from "./readme-html.ts";
import { publishedReadme } from "./published-readme.ts";
import { publishedRelease } from "../app/publication.ts";

const siteRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(siteRoot, "..");

if (import.meta.main) {
  const source = await Bun.file(resolve(repositoryRoot, "README.md")).text();
  const manifest = await Bun.file(resolve(repositoryRoot, "package.json")).json() as { version: string };
  const landing = readmeLanding(source);
  const html = renderReadmeHtml(publishedReadme(source, manifest.version, publishedRelease?.version ?? null));
  await Bun.write(
    resolve(siteRoot, "app/readme.generated.ts"),
    "// Generated from ../README.md by scripts/sync-readme.ts. Do not edit.\n"
      + `export const readmeTitle = ${JSON.stringify(landing.title)};\n`
      + `export const readmeLead = ${JSON.stringify(landing.lead)};\n`
      + `export const readmeHtml = ${JSON.stringify(html)};\n`,
  );
}
