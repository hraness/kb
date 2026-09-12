import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import Home from "../app/page";
import Docs from "../app/docs/page";
import { publishedRelease } from "../app/publication";

test("the homepage leads with the README identity and the verified install command", () => {
  const html = renderToStaticMarkup(<Home />);
  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(html).toContain("Memory your coding agents can open, search, and trust");
  if (publishedRelease === null) {
    expect(html).toContain("First Wordcell release in preparation");
    expect(html).not.toContain(".tgz");
  } else {
    expect(html).toContain(`hraness-wordcell-${publishedRelease.version}.tgz`);
    expect(html).toContain("wordcell init kb");
    expect(html).toContain(publishedRelease.verificationRun);
  }
  expect(html).not.toContain("hraness.com/kb");
});

test("the docs page renders the README with its installation anchor", () => {
  const html = renderToStaticMarkup(<Docs />);
  expect(html).toContain('id="install"');
  expect(html).toContain('id="the-kb-vault-format"');
  expect(html).toContain("wordcell --help");
  expect(html).not.toContain("data-hraness-marketing-preset");
});

test("scopes the editorial preset to the homepage header and real command example", () => {
  const html = renderToStaticMarkup(<Home />);
  const elements: string[] = [];
  new HTMLRewriter()
    .on('[data-hraness-marketing-preset="editorial"] .hraness-marketing-header.hraness-material-chrome', {
      element() { elements.push("header"); },
    })
    .on('[data-hraness-marketing-preset="editorial"] #main .hraness-material-wall .hraness-marketing-proof-frame.hraness-material-pane', {
      element() { elements.push("proof"); },
    })
    .transform(html);
  expect(elements).toEqual(["header", "proof"]);
  expect(html).toContain("wordcell context packages/parser/src/index.ts --root kb --repo .");
  expect(html).toContain("Example commands:");
});
