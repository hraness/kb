import { log } from "node:console";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import process from "node:process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Finite contract: never accept paths supplied by an untrusted manifest.
const paths = {
  "product-marketing-preset.css": "src/product-marketing-preset.css",
  "fonts/instrument-serif/instrument-serif-latin-400.woff2": "src/fonts/instrument-serif/instrument-serif-latin-400.woff2",
  "fonts/instrument-serif/OFL.txt": "src/fonts/instrument-serif/OFL.txt",
  "fonts/instrument-serif/UPSTREAM.md": "src/fonts/instrument-serif/UPSTREAM.md",
  "marketing-assets/grain.svg": "src/marketing-assets/grain.svg",
  "marketing-assets/cells.svg": "src/marketing-assets/cells.svg",
  "marketing-assets/UPSTREAM.md": "src/marketing-assets/UPSTREAM.md",
  "check.mjs": "scripts/check-marketing-snapshot.mjs",
  "check.d.mts": "scripts/check-marketing-snapshot.d.mts",
  LICENSE: "LICENSE",
};
const checkerDirectory = dirname(fileURLToPath(import.meta.url));
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
async function inventory(directory, prefix = "") {
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error("Snapshot requires physical directories.");
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Snapshot contains a symbolic link: ${path}`);
    if (entry.isDirectory()) {
      if (!Object.keys(paths).some((name) => name.startsWith(`${path}/`))) throw new Error(`Snapshot contains an unowned directory: ${path}`);
      files.push(...await inventory(join(directory, entry.name), `${path}/`));
    } else if (entry.isFile()) files.push(path);
    else throw new Error(`Snapshot contains a non-file: ${path}`);
  }
  return files.sort();
}
export async function checkMarketingSnapshot(root = checkerDirectory) {
if ((await inventory(root)).join("\n") !== [...Object.keys(paths), "provenance.json"].sort().join("\n")) throw new Error("Snapshot has missing or unowned files.");
const manifest = JSON.parse(await readFile(join(root, "provenance.json"), "utf8"));
if (!record(manifest) || manifest.schemaVersion !== 1 || manifest.contractVersion !== 1
  || !record(manifest.source) || manifest.source.repository !== "https://github.com/hraness/design-kit"
  || manifest.source.export !== "@hraness/design-kit/product-marketing-preset.css"
  || typeof manifest.source.commit !== "string" || !/^[a-f0-9]{40}$/u.test(manifest.source.commit)
  || !record(manifest.files) || Object.keys(manifest.files).sort().join("\n") !== Object.keys(paths).sort().join("\n")) throw new Error("Invalid marketing snapshot provenance.");
for (const [name, sourcePath] of Object.entries(paths)) {
  const receipt = manifest.files[name];
  if (!record(receipt) || receipt.path !== sourcePath || typeof receipt.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(receipt.sha256)) throw new Error(`Invalid ${name} provenance.`);
  if (createHash("sha256").update(await readFile(join(root, name))).digest("hex") !== receipt.sha256) throw new Error(`${name} differs from its immutable snapshot.`);
}
return manifest;
}

if (process.argv[1] !== undefined && await realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error("Usage: node check.mjs [SNAPSHOT_DIRECTORY]");
  const manifest = await checkMarketingSnapshot(process.argv[2] === undefined ? checkerDirectory : resolve(process.argv[2]));
  log(`Marketing snapshot verified at ${manifest.source.commit}.`);
}
