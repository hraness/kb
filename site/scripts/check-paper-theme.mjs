import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// Offline integrity only: upgrades use the reviewed source's snapshot installer.
const directories = ["vendor/paper-theme"];
for (const relative of directories) {
  const directory = new URL(`../${relative}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("provenance.json", directory), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.contractVersion, 1);
  assert.equal(manifest.source.repository, "https://github.com/hraness/design-kit");
  assert.equal(manifest.source.export, "@hraness/design-kit/paper-theme.css");
  assert.match(manifest.source.commit, /^[a-f0-9]{40}$/u);
  assert.deepEqual(Object.keys(manifest.files).sort(), ["LICENSE", "paper-theme.css"]);
  for (const name of ["paper-theme.css", "LICENSE"]) {
    const file = manifest.files[name];
    assert.equal(file.path, name === "LICENSE" ? "LICENSE" : "src/paper-theme.css");
    assert.match(file.sha256, /^[a-f0-9]{64}$/u);
    const bytes = await readFile(new URL(name, directory));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256,
      `${relative}/${name} drifted; keep adaptations outside the immutable snapshot.`);
  }
}
console.log("Paper theme snapshots verified.");
