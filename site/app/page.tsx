import {
  MarketingCallToAction,
  MarketingInstallPanel,
  MarketingInterfaceGrid,
  MarketingMaker,
  MarketingPage,
  MarketingPrimitives,
  MarketingProofFrame,
  MarketingQuestionList,
  MarketingSection,
  MarketingSiteHeader,
  MarketingTrustBoundary,
  ProductHero,
} from "@hraness/design-kit/react/server";
import { AskAiAboutThis } from "@hraness/ui";

import { publishedRelease } from "./publication";
import { readmeLead, readmeTitle } from "./readme.generated";

const releaseVersion = publishedRelease?.version;
const repository = "https://github.com/hraness/wordcell";
const archiveUrl = releaseVersion === undefined ? null : `${repository}/releases/download/v${releaseVersion}/hraness-wordcell-${releaseVersion}.tgz`;

const heading = "Memory your coding agents can open, search, and trust";
const footnote =
  `Free and MIT licensed. Bun 1.3.14 or newer, plain Markdown, no account.${releaseVersion === undefined ? " First Wordcell release in preparation." : ` Current verified release v${releaseVersion}.`}`;

const primitives = [
  {
    label: "Notes",
    summary: "Ordinary Markdown with frontmatter. A stable document id, tags, and typed relationships live in the file, so Obsidian, grep, and Git all read the same record.",
  },
  {
    label: "Backlinks and graph views",
    summary: "Derived at read time from wikilinks and typed relationships. Wordcell never writes reciprocal or inferred edges into your notes.",
  },
  {
    label: "Search lanes",
    summary: "Exact metadata filters, local full-text, and optional local embeddings stay separate evidence. Results join back to the current file, never to a stale index.",
  },
  {
    label: "Git provenance",
    summary: "History and co-change come from your repository's own log, on request, as context rather than a silent relevance boost.",
  },
  {
    label: "Capture",
    summary: "Clip a page or a PDF into the vault with its source metadata, assets, and a capture receipt an agent can verify later.",
  },
  {
    label: "Repository scopes",
    summary: "Route a code path to the notes, plans, and decisions that own it, so the next session starts from the right context.",
  },
] as const;

const trust = [
  {
    label: "Markdown is authoritative",
    detail: "Catalogs, backlinks, graph reports, semantic indexes, and repository context are derived and disposable. Nothing you commit depends on a database.",
  },
  {
    label: "Bounded and inspectable",
    detail: "Every command returns sorted, bounded results with the evidence behind them. Search never becomes graph authority, and percolation only proposes.",
  },
  {
    label: "Headless by design",
    detail: "A CLI, a TypeScript SDK, and a packaged Agent Skill operate the same vault. Application code never has to import the knowledge system.",
  },
] as const;

const questions = [
  {
    question: "Where does my knowledge live?",
    answer: "In a directory of Markdown files, conventionally kb/, committed beside your code. Wordcell reads and writes those files; it keeps no server, account, or hidden state.",
  },
  {
    question: "What changed with the Wordcell name?",
    answer: "Only the product identity. The package is @hraness/wordcell and the command is wordcell, with kb kept as a deprecated alias through 0.20.x. The vault format keeps its kb names, so existing vaults need no migration.",
  },
  {
    question: "Do I need an embedding model?",
    answer: "No. Exact and keyword search work without one. Hybrid and semantic modes use a pinned local model through the optional QMD dependency, and the index is rebuildable from Markdown.",
  },
  {
    question: "How do agents use it?",
    answer: "Install the wordcell Agent Skill through skills.sh. It teaches Codex, Claude Code, and compatible agents to search, capture, plan, percolate, refresh, and validate a vault with the installed command.",
  },
  {
    question: "How is it published?",
    answer: "Each release is an immutable GitHub Release with a packing receipt, checksums, and signed provenance. The same archive bytes are published to npm from the tag workflow through OIDC trusted publishing.",
  },
  {
    question: "Who made it?",
    answer: "Ben Guo, a musician and builder, formerly a founder and engineering leader at companies including Venmo and Stripe, now building from Puerto Rico. Wordcell is published by Hraness under the MIT license.",
  },
] as const;

const navigation = [
  { href: "#model", label: "Model" },
  { href: "#interfaces", label: "Interfaces" },
  { href: "#install", label: "Install" },
  { href: "/docs", label: "Docs" },
  { href: repository, label: "GitHub" },
] as const;

function BrandMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="brand-mark">
      <rect x="1" y="1" width="22" height="22" rx="5" fill="currentColor" />
      <path d="M6 7h12M6 12h8M6 17h10" fill="none" stroke="var(--background)" strokeLinecap="round" strokeWidth="2.1" />
    </svg>
  );
}

export default function Home() {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      codeRepository: repository,
      description: readmeLead,
      license: "https://opensource.org/license/mit",
      name: readmeTitle,
      programmingLanguage: "TypeScript",
      runtimePlatform: "Bun",
      url: "https://wordcell.io",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: questions.map(({ answer, question }) => ({
        "@type": "Question",
        acceptedAnswer: { "@type": "Answer", text: answer },
        name: question,
      })),
    },
  ];

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        type="application/ld+json"
      />
      <a className="skip-link" href="#main">Skip to content</a>
      <MarketingSiteHeader
        action={{ href: "#install", label: "Install Wordcell" }}
        brand={<><BrandMark />Wordcell</>}
        brandLabel="Wordcell home"
        links={navigation}
      />

      <main id="main" tabIndex={-1}>
        <MarketingPage>
          <ProductHero
            actions={[
              { href: "#install", label: "Install Wordcell" },
              { href: "/docs", label: "Read the docs" },
            ]}
            boundary={footnote}
            className="wordcell-marketing-hero"
            eyebrow="A knowledge base for coding agents"
            frame={(
              <MarketingProofFrame
                caption="Example commands: record a constraint, inspect repository context, and recover its backlinks and history."
                credit="From the README"
                title="Keep one decision available to the next session"
              >
                <pre className="transcript" tabIndex={0}><code>{`$ wordcell note create notes/parser-contract \\
    --title "Parser contract" --type concept --tag architecture \\
    --body "Parser retries stop after three attempts." --root kb

$ wordcell context packages/parser/src/index.ts --root kb --repo .
$ wordcell backlinks notes/parser-contract --root kb
$ wordcell history notes/parser-contract --root kb --repo .`}</code></pre>
              </MarketingProofFrame>
            )}
            heading={heading}
            headingId="hero-title"
            name={readmeTitle}
            summary={readmeLead}
          />

          <MarketingPrimitives
            heading="Plain files, derived views."
            headingId="model-title"
            id="model"
            items={primitives.map((primitive) => ({ label: primitive.label, summary: primitive.summary }))}
            label="The model"
            summary="A vault is Markdown under version control. Wordcell adds the write path and the bounded read paths an agent needs, and keeps every index replaceable."
          />

          <MarketingInterfaceGrid
            heading="One vault, three interfaces."
            headingId="interfaces-title"
            id="interfaces"
            interfaces={[
              {
                label: "CLI",
                summary: "Search, capture, link, and validate from a terminal or a script.",
                example: (
                  <pre tabIndex={0}><code>{`wordcell search "why parser retries stop" \\
  --root kb --mode exact --history --repo .`}</code></pre>
                ),
              },
              {
                label: "TypeScript SDK",
                summary: "Open a read-only session over one vault scan and compose bounded workflows.",
                example: (
                  <pre tabIndex={0}><code>{`import { openKnowledgeBase } from "@hraness/wordcell/sdk";

const session = await openKnowledgeBase({ root: "kb" });
const hits = await session.search({ query: "parser contract", mode: "exact" });`}</code></pre>
                ),
              },
              {
                label: "Agent Skill",
                summary: "Teach a coding agent the vault rituals through skills.sh.",
                example: (
                  <>
                    {releaseVersion === undefined ? <p>The first Wordcell skill release is in preparation.</p> : <pre tabIndex={0}><code>{`bunx skills add hraness/wordcell#v${releaseVersion}`}</code></pre>}
                    <p className="interface-link"><a href={`${repository}/blob/main/skills/wordcell/SKILL.md`}>Inspect the packaged skill</a></p>
                  </>
                ),
              },
            ]}
            label="Interfaces"
            summary="The CLI, the SDK, and the packaged skill read and write the same files. There is no agent-only path behind the convenient one."
          />

          <MarketingSection
            heading="What Wordcell will not do."
            headingId="boundary-title"
            id="boundary"
            label="Boundaries"
            summary="Wordcell derives views from your files and refuses to become a second source of truth."
          >
            <MarketingTrustBoundary
              heading="Small enough to trust."
              headingId="kernel-title"
              id="kernel"
              items={trust}
              label="Guarantees"
              summary="These rules are enforced by the command surface and its tests, not by convention."
            />
          </MarketingSection>

          <MarketingInstallPanel
            eyebrow={releaseVersion === undefined ? "First Wordcell release in preparation" : `Current verified release · v${releaseVersion}`}
            heading="Install and start a vault."
            headingId="install-title"
            id="install"
          >
            {publishedRelease !== null && archiveUrl !== null ? (
              <>
                <pre className="install-command" tabIndex={0}><code>{`bun add --global --ignore-scripts ${archiveUrl}
wordcell --help`}</code></pre>
                <pre className="install-command" tabIndex={0}><code>{`wordcell init kb
wordcell note create notes/first --title "First note" --root kb
wordcell check --root kb`}</code></pre>
                <p className="install-note">
                  <a href={publishedRelease.verificationRun}>Public release verification</a>.{" "}
                  GitHub Releases are the canonical distribution. Needs Bun 1.3.14 or newer.{" "}
                  <a href="/docs#install">Read the full installation reference</a>.
                </p>
              </>
            ) : (
              <p className="install-note">
                Wordcell is being prepared for its first release under the new name.{" "}
                <a href={`${repository}/releases`}>Check published releases</a> or{" "}
                <a href="/docs">read the documentation</a>.
              </p>
            )}
          </MarketingInstallPanel>

          <MarketingQuestionList
            heading="Before you install."
            headingId="questions-title"
            id="questions"
            label="Questions"
            questions={questions.map(({ answer, question }) => ({
              answer: <p>{answer}</p>,
              question,
            }))}
          />

          <MarketingMaker
            heading="Built by Ben Guo"
            headingId="maker-title"
            id="maker"
            label="The maker"
            links={[
              { href: "https://hraness.com", label: "hraness.com" },
              { href: "https://x.com/hraness", label: "@hraness" },
              { href: repository, label: "GitHub" },
            ]}
          >
            <p>
              Wordcell is built by Ben Guo, a musician and builder, formerly a founder and engineering
              leader at companies including Venmo and Stripe, now building from Puerto Rico. It is
              published by Hraness under the MIT license.
            </p>
          </MarketingMaker>

          <MarketingCallToAction
            actions={[
              { href: "#install", label: "Install Wordcell" },
              { href: "/docs", label: "Read the docs" },
            ]}
            footnote={footnote}
            heading="Give the next session what this one learned."
            headingId="cta-title"
            summary="Install the CLI, start one vault beside your code, and let your agents record what they should not have to rediscover."
          />
        </MarketingPage>
      </main>

      <AskAiAboutThis className="ask-ai" url="https://wordcell.io" />

      <footer className="site-footer">
        <p>Wordcell is open source for developers and the agents working beside them.</p>
        <nav aria-label="Project links">
          <a href="/docs">Docs</a>
          <a href={repository}>hraness/wordcell</a>
          <a href="https://hraness.com/projects">Hraness projects</a>
        </nav>
      </footer>
    </>
  );
}
