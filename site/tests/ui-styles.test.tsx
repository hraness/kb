import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postcss, { type Rule } from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { AskAiAboutThis } from "@hraness/ui";

const site = join(import.meta.dir, "..");
const globalsPath = join(site, "app/globals.css");
const compiled = readFile(globalsPath, "utf8").then(async source =>
  await postcss([tailwindcss({ base: site, optimize: false })]).process(source, { from: globalsPath }),
);

function renderedClasses(slot: string): string[] {
  const classes: string[] = [];
  new HTMLRewriter().on(`[data-slot="${slot}"]`, {
    element(element) { classes.push(...(element.getAttribute("class") ?? "").split(/\s+/u)); },
  }).transform(renderToStaticMarkup(<AskAiAboutThis url="https://wordcell.io" />));
  // Match the classes emitted by the installed component rather than freezing StyleX hashes.
  return [...new Set(classes)].filter(name => /^x[a-z0-9]+$/u.test(name));
}

function ownsRenderedClass(rule: Rule, classes: readonly string[]): boolean {
  return classes.some(name => new RegExp(`\\.${name}(?![a-zA-Z0-9_-])`, "u").test(rule.selector));
}

describe("shared Ask AI stylesheet delivery", () => {
  test("compiles the component recipes and their touch/focus states into the site CSS", async () => {
    const { root } = await compiled;
    for (const [slot, display] of [
      ["ask-ai-about-this", "flex"],
      ["ask-ai-about-this-links", "flex"],
      ["ask-ai-about-this-link", "inline-flex"],
      ["ask-ai-about-this-icon", "block"],
    ] as const) {
      const classes = renderedClasses(slot);
      let delivered = false;
      root.walkRules(rule => {
        if (ownsRenderedClass(rule, classes)) rule.walkDecls("display", declaration => {
          if (declaration.value === display) delivered = true;
        });
      });
      expect(delivered).toBe(true);
    }

    const links = renderedClasses("ask-ai-about-this-link");
    let touchTarget = false;
    let keyboardFocus = false;
    root.walkRules(rule => {
      if (!ownsRenderedClass(rule, links)) return;
      const parent = rule.parent;
      if (parent?.type === "atrule" && parent.name === "media" && /pointer:\s*coarse/u.test(parent.params)) {
        rule.walkDecls("min-height", declaration => {
          if (declaration.value.includes("--interactive-target-min")) touchTarget = true;
        });
      }
      if (rule.selector.includes(":focus-visible")) rule.walkDecls("outline-width", declaration => {
        if (declaration.value === "2px") keyboardFocus = true;
      });
    });
    expect(touchTarget).toBe(true);
    expect(keyboardFocus).toBe(true);
  });

  test("keeps Paper's token bridge after the shared defaults without copying component recipes", async () => {
    const { root } = await compiled;
    const foregrounds: string[] = [];
    const rings: string[] = [];
    root.walkRules(rule => {
      if (!rule.selector.includes('[data-hraness-theme="paper"]')) return;
      rule.walkDecls("--ui-foreground", declaration => { foregrounds.push(declaration.value); });
      rule.walkDecls("--ui-ring", declaration => { rings.push(declaration.value); });
    });
    expect(foregrounds).toContain("var(--foreground)");
    expect(rings).toContain("var(--focus)");

    const globals = await readFile(globalsPath, "utf8");
    expect(globals).not.toMatch(/data-slot\s*=\s*["']ask-ai-about-this-/u);
    expect(globals).not.toContain(".hraness-ask-ai-about-this__");
  });
});
