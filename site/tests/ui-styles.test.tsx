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


test("delivers material chrome and reduced-transparency fallback through the existing CSS compiler", async () => {
  const { root } = await compiled;
  const header = new Map<string, string>();
  let reducedTransparency = false;
  let forcedPlane = false;
  root.walkRules(rule => {
    if (rule.selector === '[data-hraness-material="lantern"] .hraness-marketing-header.hraness-material-chrome') {
      rule.walkDecls(declaration => { header.set(declaration.prop, declaration.value.replaceAll(/\s/gu, "")); });
    }
    const parent = rule.parent;
    if (parent?.type === "atrule" && parent.name === "media") {
      if (parent.params.includes("prefers-reduced-transparency") && rule.selector.includes("hraness-material-chrome")) {
        rule.walkDecls("--hraness-material-chrome-blur", declaration => { if (declaration.value === "none") reducedTransparency = true; });
      }
      if (parent.params.includes("forced-colors") && rule.selector === '[data-hraness-material="lantern"]') {
        rule.walkDecls("--hraness-material-plane", declaration => { if (declaration.value === "Canvas") forcedPlane = true; });
      }
    }
  });
  expect(header.get("backdrop-filter")).toBe("var(--hraness-material-chrome-blur,none)");
  expect(header.get("-webkit-backdrop-filter")).toBe("var(--hraness-material-chrome-blur,none)");
  expect(header.get("background")).toBe("var(--hraness-material-chrome-paint,var(--hraness-material-plane))");
  expect(reducedTransparency).toBe(true);
  expect(forcedPlane).toBe(true);
});

test("keeps wrapped phone navigation in flow while preserving desktop sticky chrome", async () => {
  const { root } = await compiled;
  let desktopSticky = false;
  const phoneOverrides: Rule[] = [];
  root.walkRules(rule => {
    if (rule.selector === ".hraness-marketing-header") {
      rule.walkDecls("position", declaration => { if (declaration.value === "sticky") desktopSticky = true; });
    }
    if (rule.selector === '[data-hraness-material="lantern"] .hraness-marketing-header.hraness-material-chrome') {
      rule.walkDecls("position", declaration => { if (declaration.value === "static") phoneOverrides.push(rule); });
    }
  });
  expect(desktopSticky).toBe(true);
  expect(phoneOverrides).toHaveLength(1);
  const parent = phoneOverrides[0]!.parent;
  expect(parent?.type).toBe("atrule");
  if (parent?.type !== "atrule") throw new Error("Phone chrome override must be scoped by a media query");
  expect(parent.name).toBe("media");
  expect(parent.params.replaceAll(/\s/gu, "")).toBe("(max-width:48rem)");
  expect(phoneOverrides[0]!.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value])).toEqual([["position", "static"]]);
});
