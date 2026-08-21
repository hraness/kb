import { expect, test } from "bun:test";

import { staleInstalledCommandPaths } from "./check-installed-command-docs.ts";

test("rejects the checkout-only metadata helper command anywhere in shipped skill/docs", () => {
  expect(staleInstalledCommandPaths([
    { path: "docs/capture.md", contents: "kb url-metadata tool build\n" },
    { path: "skills/kb/references/save-url.md", contents: "bun run url-metadata:tool:build\n" },
    { path: "README.md", contents: "bun run url-metadata:tool:build\n" },
  ])).toEqual([
    "README.md",
    "skills/kb/references/save-url.md",
  ]);
});
