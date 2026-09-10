import { expect, test } from "bun:test";

import { staleInstalledCommandPaths } from "./check-installed-command-docs.ts";

test("rejects the checkout-only metadata helper command anywhere in shipped skill/docs", () => {
  expect(staleInstalledCommandPaths([
    { path: "docs/capture.md", contents: "wordcell url-metadata tool build\n" },
    { path: "skills/wordcell/references/save-url.md", contents: "bun run url-metadata:tool:build\n" },
    { path: "README.md", contents: "bun run url-metadata:tool:build\n" },
  ])).toEqual([
    "README.md",
    "skills/wordcell/references/save-url.md",
  ]);
});
