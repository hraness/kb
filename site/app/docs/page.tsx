import type { Metadata } from "next";
import { AskAiAboutThis } from "@hraness/ui";

import { publishedRelease } from "../publication";
import { readmeHtml, readmeTitle } from "../readme.generated";

export const metadata: Metadata = {
  title: `${readmeTitle} documentation`,
  description: "The complete Wordcell README: installation, vault format, command surface, capture, graph, skills, and release notes.",
  alternates: { canonical: "/docs" },
  openGraph: {
    title: `${readmeTitle} documentation`,
    description: "The complete Wordcell README.",
    type: "article",
    url: "/docs",
  },
};

export default function Docs() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <main id="main" tabIndex={-1} className="document-page">
        <nav aria-label="Site" className="document-nav">
          <a href="/">Wordcell home</a>
          <a href="https://github.com/hraness/wordcell">Source on GitHub</a>
          <a href="https://github.com/hraness/wordcell/releases">Releases</a>
        </nav>
        {publishedRelease === null && <p>Release preview: the installation examples below target the forthcoming Wordcell release. <a href="https://github.com/hraness/wordcell/releases">Check published releases before installing</a>.</p>}
        <article dangerouslySetInnerHTML={{ __html: readmeHtml }} />
      </main>
      <AskAiAboutThis className="ask-ai" url="https://wordcell.io/docs" />
    </>
  );
}
