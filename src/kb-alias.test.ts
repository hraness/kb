import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { KB_ALIAS_NOTICE } from "./kb-alias.js";

test("the deprecated kb alias runs the wordcell CLI after one stderr notice", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./kb-alias.ts", import.meta.url)), "--help"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode).toBe(0);
  expect(stderr).toBe(`${KB_ALIAS_NOTICE}\n`);
  expect(stdout).toContain("wordcell — ");
  expect(stdout).toContain("wordcell init [directory]");
});
