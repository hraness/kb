<!-- hraness:wordcell-landing:start -->
# Wordcell

[![Agent Skill](https://raw.githubusercontent.com/hraness/wordcell/main/assets/agent-skill.svg)](https://github.com/hraness/wordcell/tree/main/skills/wordcell)

A knowledge base for coding agents, built from Markdown, backlinks, semantic
search, and Git context.
It turns sources, plans, and decisions into inspectable context that agents can
recover across sessions without coupling application code to the knowledge
system.

[Documentation](https://wordcell.io/docs) · [npm package](https://www.npmjs.com/package/@hraness/wordcell) · [Graph guide](https://github.com/hraness/wordcell/blob/main/docs/graph-authority.md) · [Changelog](https://github.com/hraness/wordcell/blob/main/CHANGELOG.md)

## Install

[Bun 1.3.14 or newer](https://bun.sh/docs/installation) and Git are required.
The CLI and TypeScript SDK run with Bun. Choose one installation source:

```sh
# Canonical, versioned GitHub archive
bun add --global --ignore-scripts https://github.com/hraness/wordcell/releases/download/v0.21.1/hraness-wordcell-0.21.1.tgz
wordcell --help
```

The same release is mirrored to [npm](https://www.npmjs.com/package/@hraness/wordcell):

```sh
npm install --global --ignore-scripts @hraness/wordcell@0.21.1
wordcell --help
```

Bun must remain in `PATH` when npm installs the commands. Exact search and
Markdown graph commands need no account, service, or embedding model. Optional
semantic search, browser capture, and PDF tools have [additional prerequisites](https://github.com/hraness/wordcell/blob/main/docs/reference.md#review-lifecycle-scripts-before-enabling-optional-adapters).

### Use with a coding agent

Install the single public Agent Skill into your choice of compatible agent,
including Claude Code, Codex, Cursor, or GitHub Copilot:

```sh
bunx skills add hraness/wordcell#v0.21.1 --skill wordcell
```

Then ask:

```text
Use Wordcell to find the notes and plans about packages/parser in ./kb.
Open the sources behind the result and explain the recorded decision.
```

The skill installs instructions, not a running service. It uses an existing
`wordcell` command and prepares the pinned runtime only when needed. Installing
it does not create a vault or modify your notes. [Read the skill](https://github.com/hraness/wordcell/blob/main/skills/wordcell/SKILL.md).

## Keep one decision available to the next session

Suppose a parser must stop retrying after three attempts. Record that constraint
in a note, then link the plan that will implement it:

```shell
wordcell init kb
wordcell note create notes/parser-contract \
  --title "Parser contract" --type concept --tag architecture \
  --body "Parser retries stop after three attempts." --root kb
wordcell note create plans/parser-v2 \
  --title "Parser v2" --type plan \
  --body "The plan implements [[notes/parser-contract|the parser contract]]." \
  --root kb
```

The first `wordcell note create` command stores ordinary Markdown at
`kb/notes/parser-contract.md` and assigns its stable `document_id`. Add the
exact code boundary to that note's frontmatter so path lookup can recover it:

```yaml
repository_scopes:
  - packages/parser
```

Commit the vault with the repository. The Markdown and its Git history are the
durable record.

## Recover the stopped session

In a later session, start from the code path and inspect each independent
signal:

```shell
wordcell context packages/parser/src/index.ts --root kb --repo .
wordcell search "why parser retries stop" --root kb --mode exact \
  --history --repo .
wordcell backlinks notes/parser-contract --root kb
wordcell history notes/parser-contract --root kb --repo .
```

| Signal | What it recovers |
| --- | --- |
| Markdown | The current parser constraint in the file you can review and edit. |
| Backlinks | The plan that explicitly links to the constraint. |
| Exact search | The current note matched from its words, without a network request or embedding model. |
| Repository context | Inherited `AGENTS.md` guides and records scoped to `packages/parser`. |
| Git history | The commits and bounded co-change evidence associated with the note. |

Together, those views recover the persisted decision, related plan, applicable
rules, and provenance needed to resume the work. They do not reconstruct
private chat or prove that the note is still correct. Open the returned
Markdown and guides before acting on them.

The boundaries stay visible: Markdown and Git are authoritative, backlinks and
indexes are replaceable views, and Git work is opt-in. Application code imports
neither the vault nor a hosted knowledge service.

<!-- hraness:wordcell-landing:end -->

## What you can do

| Task | Command | Evidence and effects |
| --- | --- | --- |
| Find a saved decision | `wordcell search "parser retries" --root kb --mode exact` | Reads current Markdown; no model or network request. |
| Recover context for code | `wordcell context packages/parser/src/index.ts --root kb --repo .` | Returns scoped notes, plans, and inherited `AGENTS.md` rules. |
| Inspect explicit connections | `wordcell backlinks notes/parser-contract --root kb` | Returns notes that link to the decision. |
| Search by meaning | `wordcell search "retry policy" --root kb --mode hybrid` | Adds optional local QMD keyword and vector retrieval; model setup is required. |
| Query with graph proofs | `wordcell graph query --program scope-route --scope packages/parser --root kb` | Returns bounded results tied to the source revision. Queries do not write a cache. |
| Capture a source | `wordcell clip https://example.com/article --output kb/articles` | Reads the selected URL and writes a Markdown bundle with a capture receipt. |
| Capture a PDF | `wordcell pdf /absolute/path/to/document.pdf --output kb/articles` | Preserves the original PDF and extracted evidence; Poppler is required. |
| Check the vault | `wordcell check --root kb` | Reports structural and attachment problems without editing files. |

Use `--json` for structured output and `wordcell --help` for the complete command
surface. [Full command reference](https://github.com/hraness/wordcell/blob/main/docs/reference.md#command-surface).

## How the files fit together

```text
repository/
├── AGENTS.md                # rules that govern edits
├── packages/parser/
│   └── AGENTS.md            # rules scoped to this code
└── kb/
    ├── index.md             # authored or managed front door
    ├── articles/            # captured sources and assets
    ├── notes/               # maintained explanations
    └── plans/               # decisions and outcomes
```

Markdown, YAML frontmatter, explicit wikilinks, and Git hold the record. Open
the same files in Obsidian, a text editor, or ordinary file-search tools.
Application code does not need to import Wordcell or its vault.

QMD supplies optional local search. Oh supplies a disposable graph projection;
only an explicit `wordcell graph rebuild --root kb` writes `.wordcell/oh.sqlite`.
Backlinks and typed relationships come from authored links. Percolation
suggests connections for review and does not add inferred edges to notes.

Graph proofs explain a supported derivation from a specific source revision.
They do not prove that a note is true or that a missing relationship cannot
exist. [Graph queries and proof limits](https://github.com/hraness/wordcell/blob/main/docs/graph-authority.md).

## Build with the TypeScript SDK

Add the same immutable release to a Bun project:

```sh
bun add --exact --ignore-scripts https://github.com/hraness/wordcell/releases/download/v0.21.1/hraness-wordcell-0.21.1.tgz
```

The SDK provides read-only vault sessions, metadata queries, search, graph
proofs, Git context, and composable workflows. A session owns one snapshot;
reopen it after Markdown changes. [SDK and workflow examples](https://github.com/hraness/wordcell/blob/main/docs/reference.md#graph-reference)
show the public imports and lifecycle.

## Privacy and boundaries

- Structural queries and exact search read local files. Optional semantic
  search downloads its model on first use and runs locally.
- URL capture contacts the requested source. Signed-in capture uses only
  explicitly selected browser state. Review the [security policy](https://github.com/hraness/wordcell/blob/main/SECURITY.md)
  before using it with private sources.
- An agent that reads the vault follows its own provider and data-handling
  settings. Keep private records out of public repositories and outputs.
- Git history is opt-in. Saved notes preserve recorded context; Wordcell does
  not reconstruct unsaved conversations or silently record every agent action.

## Documentation

| Read next | Purpose |
| --- | --- |
| [Agent workflow](https://github.com/hraness/wordcell/blob/main/docs/agent-workflow.md) | Set up, query, maintain, and revise repository memory. |
| [Installation and command reference](https://github.com/hraness/wordcell/blob/main/docs/reference.md) | Exact interfaces, SDK imports, optional adapters, and troubleshooting prerequisites. |
| [Web capture](https://github.com/hraness/wordcell/blob/main/docs/capture.md) and [PDF capture](https://github.com/hraness/wordcell/blob/main/docs/pdf.md) | Save sources with provenance, assets, and explicit completeness limits. |
| [Graph guide](https://github.com/hraness/wordcell/blob/main/docs/graph-authority.md) | Named queries, proofs, revisions, resource limits, and cache recovery. |
| [Portfolio federation](https://github.com/hraness/wordcell/blob/main/docs/portfolio.md) | Search only selected, authorized vaults. |
| [Design](https://github.com/hraness/wordcell/blob/main/docs/design.md) and [memory rationale](https://github.com/hraness/wordcell/blob/main/docs/agent-memory.md) | File contracts, design choices, and evaluation context. |
| [Release verification](https://github.com/hraness/wordcell/blob/main/docs/publishing.md#verify-a-published-release) | Verify archive identity, signatures, and provenance. |

### Installation reference

[Alternative installs and optional capabilities](https://github.com/hraness/wordcell/blob/main/docs/reference.md#installation-reference).

### The kb vault format

Existing `kb/`, `index.md`, `kb://` identifiers, and Markdown formats remain
compatible. [Vault format reference](https://github.com/hraness/wordcell/blob/main/docs/reference.md#the-kb-vault-format).

### Command surface

[Complete CLI reference](https://github.com/hraness/wordcell/blob/main/docs/reference.md#command-surface).

### Capture reference

[Capture commands and dependencies](https://github.com/hraness/wordcell/blob/main/docs/reference.md#capture-reference).

### Graph reference

[Graph and SDK interfaces](https://github.com/hraness/wordcell/blob/main/docs/reference.md#graph-reference).

### Agent skills

[Installation and runtime contract](https://github.com/hraness/wordcell/blob/main/docs/reference.md#agent-skills).
The same skill is included at `node_modules/@hraness/wordcell/skills/wordcell/`.

## Release notes

Version 0.21 adds Oh graph queries and proofs. The deprecated `kb` command was
removed at this boundary; use `wordcell`. Existing vaults need no migration.
[All release notes and upgrade instructions](https://github.com/hraness/wordcell/blob/main/CHANGELOG.md).

## Contributing

Run `bun run check` for source, architecture, package installation, types, and
native-helper validation. The site has its own `bun run check` under `site/`.
See [Contributing](https://github.com/hraness/wordcell/blob/main/CONTRIBUTING.md), [Security](https://github.com/hraness/wordcell/blob/main/SECURITY.md), and the [MIT License](https://github.com/hraness/wordcell/blob/main/LICENSE).

[Install Wordcell from GitHub Releases](https://github.com/hraness/wordcell/releases) ·
[Wordcell source on GitHub](https://github.com/hraness/wordcell) ·
[Wordcell overview](https://wordcell.io)
