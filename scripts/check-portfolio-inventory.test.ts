import { describe, expect, test } from "bun:test";

import {
  canonicalPortfolioInventory,
  hranessSourceRepository,
} from "./check-portfolio-inventory.ts";

const commit = "0123456789abcdef0123456789abcdef01234567";

function manifest(dependencies: Record<string, string>): Record<string, unknown> {
  return {
    name: "@hraness/example",
    version: "1.2.3",
    repository: {
      type: "git",
      url: "git+https://github.com/hraness/example.git",
    },
    dependencies,
  };
}

describe("portfolio inventory dependencies", () => {
  test("derives Hraness ownership only from exact immutable GitHub specifiers", () => {
    expect(hranessSourceRepository(
      `git+https://github.com/hraness/qmd.git#${commit}`,
    )).toBe("hraness/qmd");
    expect(hranessSourceRepository("github:hraness/qmd#main")).toBeUndefined();
    expect(hranessSourceRepository(
      "git+https://github.com/other/qmd.git#0123456789abcdef0123456789abcdef01234567",
    )).toBeUndefined();
    expect(hranessSourceRepository(
      "git+https://github.com/hraness/qmd.git#0123456",
    )).toBeUndefined();
  });

  test("includes Hraness-owned Git dependencies under their package names in stable order", () => {
    const inventory = canonicalPortfolioInventory(manifest({
      "ordinary-package": "1.0.0",
      "@tobilu/qmd": `git+https://github.com/hraness/qmd.git#${commit}`,
      "@hraness/ui": "^0.4.0",
      "@steipete/sweet-cookie": `git+https://github.com/hraness/sweet-cookie.git#${commit}`,
    }));

    expect(inventory.dependencies).toEqual([
      {
        from: "@hraness/example",
        scope: "runtime",
        specifier: "^0.4.0",
        to: "@hraness/ui",
      },
      {
        from: "@hraness/example",
        scope: "runtime",
        specifier: `git+https://github.com/hraness/sweet-cookie.git#${commit}`,
        to: "@steipete/sweet-cookie",
        sourceRepository: "hraness/sweet-cookie",
      },
      {
        from: "@hraness/example",
        scope: "runtime",
        specifier: `git+https://github.com/hraness/qmd.git#${commit}`,
        to: "@tobilu/qmd",
        sourceRepository: "hraness/qmd",
      },
    ]);
  });
});
