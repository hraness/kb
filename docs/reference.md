# Wordcell installation and command reference

[Back to the quick start](../README.md#install)

## Installation reference

[Bun](https://bun.sh/docs/installation) is the required runtime. GitHub Releases are the canonical distribution, and each release publishes the same archive to npm as `@hraness/wordcell`. The examples pin release `0.21.1`. Historical `@hraness/kb` installs remain available under their original package name. For signed artifact verification, see [the release procedure](publishing.md#verify-a-published-release).

### Tell your coding agent to install it

Copy this prompt into Codex, Claude Code, or another coding agent:

```text
Install the `wordcell` Agent Skill from `hraness/wordcell#v0.21.1` with the standard skills
CLI. Use the skill's runtime instructions to install the exact
versioned GitHub release archive only when the command is missing. Verify it
with `wordcell doctor` and `wordcell --help`, but do not initialize or modify a vault until
I ask.
```

Install the single public skill with either runner:

```sh
npx skills add hraness/wordcell#v0.21.1
bunx skills add hraness/wordcell#v0.21.1
```

Both commands discover the same `wordcell` skill and install it into the selected
agent runner. Skill installation is inert: it does not initialize a vault,
refresh a catalog, or edit Markdown. When invoked, the skill uses an existing
`wordcell` command or, when the command is missing, checks for Bun and installs the
CLI from the immutable GitHub release archive.

The public skills CLI reads `skills/wordcell/` from the repository. The immutable
`0.21.1` packed release includes the same tree under
`node_modules/@hraness/wordcell/skills/wordcell/`, and the package check verifies that the
installed skill is byte-identical to the repository source.

Install the two global commands with Bun:

```sh
bun add --global --ignore-scripts https://github.com/hraness/wordcell/releases/download/v0.21.1/hraness-wordcell-0.21.1.tgz
wordcell --help
wordcell-evaluation-builder --help
```

The same GitHub archive can be installed with npm:

```sh
npm install --global --ignore-scripts https://github.com/hraness/wordcell/releases/download/v0.21.1/hraness-wordcell-0.21.1.tgz
wordcell --help
```

Both commands are Bun executables. Bun `1.3.14` or newer must remain in `PATH`
even when npm performs the global installation. The conservative npm command
above disables dependency lifecycle scripts. Optional native search and
rendered-browser setup remain unavailable until the relevant scripts are
reviewed and enabled; run `wordcell doctor` to inspect the resulting capabilities.

For programmatic use, add the versioned GitHub archive to a Bun project:

```sh
bun add --exact --ignore-scripts https://github.com/hraness/wordcell/releases/download/v0.21.1/hraness-wordcell-0.21.1.tgz
```

The resulting dependency should remain exact:

```json
{
  "dependencies": {
    "@hraness/wordcell": "https://github.com/hraness/wordcell/releases/download/v0.21.1/hraness-wordcell-0.21.1.tgz"
  }
}
```

Version 0.21.1 retains two public GitHub dependencies: `@hraness/oh` at
immutable release archive `v0.4.3` for graph projection and closure verification and `@tobilu/qmd` at commit
`aa993dceb3ef8cfb71d470554ca437570f5a2b3c` for store-local model behavior.
Installation also needs Git and public GitHub access while it resolves those
dependencies. Browser-cookie capture uses the exact upstream registry release
`@steipete/sweet-cookie` `0.4.3`, which includes the host-scope, isolation, and
explicit Chromium Keychain fixes previously carried by the Hraness fork.

### Review lifecycle scripts before enabling optional adapters

[Bun blocks dependency lifecycle scripts](https://bun.sh/docs/pm/lifecycle)
unless the consumer trusts them. Run
`bun pm untrusted` in the consuming project and inspect the exact resolved
versions and scripts before allowing any of them. Do not use `bun pm trust
--all` for this package's dependency graph.

The pinned QMD Git dependency has a `prepare` script that installs development
hooks only when its own `.git` directory exists; the packaged runtime does not
need that script. Optional rendered capture uses `agent-browser`, whose
postinstall downloads a platform-specific executable. QMD's native semantic
and language-parser paths can report lifecycle scripts for `node-llama-cpp`,
`tree-sitter-go`, `tree-sitter-javascript`, `tree-sitter-python`, and
`tree-sitter-rust`. Trust only the packages required by the capability you have
chosen, then reinstall and run `wordcell doctor` to verify that capability. npm runs
dependency lifecycle scripts by default, so inspect the same packages before
omitting `--ignore-scripts` from an npm installation.

Wordcell can read explicitly selected signed-in browser state and perform
bounded capture and network operations. Read the [security
policy](../SECURITY.md) before using authenticated capture.

Contributors can install from a checkout instead:

```sh
git clone https://github.com/hraness/wordcell.git
cd wordcell
bun install --frozen-lockfile
bun link
wordcell --help
```

HTTP and Archive.today capture work with the installed JavaScript dependencies. Rendered capture additionally needs a local Chromium-compatible browser. [yt-dlp](https://github.com/yt-dlp/yt-dlp) adds YouTube metadata, thumbnails, and transcripts; full audio or video localization is opt-in and some formats also need [FFmpeg](https://ffmpeg.org). PDF ingestion uses the open-source Poppler tools `pdfinfo` and `pdftohtml`; [Tesseract](https://github.com/tesseract-ocr/tesseract) adds local OCR for scans and screenshots. URL metadata backfill requires Rust on macOS or Linux to build the immutable, fixed-network, memory-confined `metadata-search-engine-rs` helper included in the installed package. Run `wordcell url-metadata tool build` once, then use `wordcell url-metadata backfill` from any working directory.

Structural commands and exact search read the current Markdown directly and
need no service, model, or graph database. Wordcell pins
[QMD](https://github.com/tobi/qmd) 2.5.3 for local keyword and vector search.
`--mode keyword` uses its full-text index without an embedding model. Hybrid
and semantic search use a revision-pinned compact local EmbeddingGemma model;
the first index or vector query downloads about 300 MB. On macOS with Bun,
install extension-capable Homebrew SQLite with `brew install sqlite` before
using vector retrieval.

`wordcell doctor` statically checks the pinned QMD, SQLite, sqlite-vec,
node-llama-cpp, and matching native packages without importing native code or
downloading the model. Exact and keyword search remain model-free. Wordcell also
refuses an older adjacent `.snapshot` directory that lacks its ownership
marker; inspect and remove only the explicitly named disposable directory,
then retry so Wordcell never guesses that unrelated files are cache data.

## The kb vault format

Wordcell is the product; `kb` is the vault format. The conventional vault
directory is `kb/`, managed regions use the `<!-- kb:catalog:start -->` and
`<!-- kb:context … -->` markers, the front-door frontmatter key is
`kb_catalog`, portfolio identities use `kb://<owner>/<vault>/<document_id>`
URIs, and the shell conventions in the skill and docs are `KB_ROOT` and
`KB_REPO`. These names identify files that many repositories already commit,
so they did not change with the product name. Every `wordcell` command reads
and writes the same vaults that `kb` did.

## Start a vault

```sh
wordcell init my-kb
cd my-kb
wordcell clip https://example.com/article --output articles
wordcell refresh --root .
wordcell check --root .
```

`wordcell init` creates an `index.md` front door plus `articles/`, `notes/`,
`plans/`, `riffs/`, and optional repository-context `scopes/` boundaries. The
generated Markdown remains ordinary Markdown: open it in Obsidian, edit it in a
text editor, search it with standard tools, and version it with Git.

When a vault lives at `kb/` inside a repository, inspect the instructions and
mapped context for a repository path from the repository root:

```sh
wordcell agents identity packages/parser --json
wordcell context packages/parser/src/index.ts --root kb --repo .
wordcell agents check --root kb --repo .
```

`wordcell agents identity` derives a canonical mapping without writing files.
`wordcell context` lists inherited `AGENTS.md` files from the repository root toward
the target, verified context hubs from the nearest scope back toward the root,
and bounded repository-scoped memory. Maintained knowledge, active plans,
dated research, reports, and terminal plans stay in separate groups. Every
record states the exact authored scope that matched and whether it exists.
Open only the useful summaries, then use `wordcell links`, `wordcell backlinks`, `wordcell list`,
or `wordcell search` to expand the question deliberately.

## Command surface

| Command | Purpose |
| --- | --- |
| `wordcell init [directory]` | Create a new vault without merging into or overwriting an existing path; the default directory is `kb`. |
| `wordcell clip <url\|current>` | Capture a source and write an article bundle. `current` reads an attached active tab without navigating it; `wordcell capture <url>` is the explicit URL form. |
| `wordcell capture show\|verify\|diff <bundle>` | Inspect a stored capture as hostile content, verify its recorded document and optional asset hashes, or compare its exact Markdown bytes with a bounded Git ref. |
| `wordcell inspect <url>` | Run acquisition and extraction without writing a bundle. |
| `wordcell pdf <file-or-url> [--slug <slug>]` | Convert a local or public remote PDF into Markdown while retaining the original bytes, extracted images, OCR-derived text, URL provenance, and page provenance. |
| `wordcell refresh --root <directory>` | Rebuild a managed catalog atomically and report graph findings. An authored-catalog vault remains unchanged. |
| `wordcell check --root <directory>` | Verify catalog policy, graph integrity, and confined local image, PDF, and tldraw attachments without changing files. `--no-catalog` gates an edit lane without requiring the shared catalog refresh. |
| `wordcell catalog --root <directory>` | Render an exhaustive disposable catalog without modifying an authored or managed front door. |
| `wordcell graph query --program <name> --root <directory>` | Query a bounded, proof-bearing Oh projection; see [the graph guide](graph-authority.md). |
| `wordcell graph rebuild\|verify --root <directory>` | Rebuild or verify the disposable local graph cache without editing Markdown. |
| `wordcell graph --root <directory>` | Print the resolved contextual and typed graph, broken or ambiguous targets, orphans, and advisory mention candidates. |
| `wordcell backlinks <note> --root <directory>` | Show incoming contextual links and typed relationships for a note resolved by path, title, or alias. |
| `wordcell links <note> --root <directory>` | Traverse incoming, outgoing, or bidirectional contextual links and typed relationships with explicit depth and node limits. |
| `wordcell note create <id> --title <title> --root <directory>` | Atomically create one confined Markdown note; use `--type concept` for a reusable concept. |
| `wordcell relation add\|remove <source> <predicate> <target>` | Idempotently edit one source note's typed outbound relationship using an exact local note ID or canonical stable `kb://` URI. |
| `wordcell relation list <note> --root <directory>` | List a note's authored outbound and derived inbound typed relationships. |
| `wordcell percolate [note] --root <directory>` | Report evidence-backed recurring-concept and missing-relationship candidates without writing notes. |
| `wordcell list --root <directory>` | Filter typed nested frontmatter, tags, and repeated exact `--scope` declarations; sort by metadata, title, path, or graph counts. `wordcell notes` is an alias. |
| `wordcell index --root <directory>` | Build or incrementally refresh the optional local QMD embedding index. |
| `wordcell search <query> --root <directory>` | Combine live exact matches with local QMD keyword and vector retrieval. Use `--mode exact\|keyword\|semantic\|hybrid`, metadata, tags, exact `--scope` filters, or bounded graph context. `--rules <file>` enables reviewed aliases; add `--priority` for explicit rule-based ordering. Omitted history performs no Git work; `--history` requests best-effort provenance and `--require-history` rejects unavailable or incomplete selected-note provenance. |
| `wordcell portfolio search <query> --registry <file> --workspace <directory>` | Search only explicitly authorized vaults. Use `--shared` for public and organization entries or repeat `--vault owner/id` for a deliberate selection. The same `--rules <file>` and opt-in `--priority` apply within each selected vault before deterministic federation. |
| `wordcell portfolio audit --registry <file> --workspace <directory>` | Audit selected vault identities, authority groups, graph references, attachments, exact duplicate content, catalogs, and Git availability without repairing or electing an authority. |
| `wordcell history <note> --root <vault> --repo <repository>` | Return bounded direct provenance for one resolved note, including explicit oversized-commit limitations. |
| `wordcell history search <query-or-path> --root <vault> --repo <repository>` | Search bounded commit subjects, note paths, and co-change paths without authoring links or repository scopes. |
| `wordcell context <repository-path> --root <vault> --repo <repository>` | List inherited guides root to nearest, reciprocal hubs nearest to root, and grouped repository-scoped current and historical memory. Use `--kind auto\|file\|directory` to control path interpretation. |
| `wordcell inbox --root <vault>` | List recent captures without a maintained-note disposition. This is advisory and never creates links or fails merely because a source is a leaf. |
| `wordcell evaluate <manifest.json> --root <vault> --repo <repository>` | Verify an exact frozen Git/vault snapshot and run built-in exact, QMD, metadata, graph, path-context, and Git retrievers with raw evidence, latency, resource counters, metrics, and paired intervals. |
| `wordcell-evaluation-builder --anchor-seal\|--build --config <file> --artifact-root <directory>` | Anchor or build a frozen evaluation corpus through the installed package boundary. |
| `wordcell url-metadata tool build\|check` | Build or validate the pinned Rust metadata-search helper through the installed package boundary. |
| `wordcell url-metadata backfill --root <vault>` | Add resumable `url-metadata.json` sidecars for saved external URLs through the pinned metadata search helper and optional read-only Archive.today discovery. |
| `wordcell agents identity <repository-scope>` | Derive the normalized scope, canonical hub ID and path, owning guide path, and exact reciprocal marker without writing files. |
| `wordcell agents check --root <vault> --repo <repository>` | Validate context identities, exact scopes, reciprocal markers, real guide paths, collisions, confinement, and guide shape. Unmapped guides remain valid. |
| `wordcell agents audit --root <vault> --repo <repository>` | Run the same correctness gate, then report deterministic per-guide, section, inherited-chain, long-bullet, and exact-duplicate advisories. |
| `wordcell doctor` | Report capture capabilities and statically inspect local QMD, SQLite, sqlite-vec, node-llama-cpp, and native search prerequisites without loading a model. |
| `wordcell adapters` | Print the installed platform capability matrix. |

Vault commands default to the current directory and `index.md`; use `--root` and `--index` to select alternatives. Commands that report structured data accept `--json`. Run `wordcell --help` for the complete top-level surface and `wordcell clip --help` for capture, authentication, evidence, and resource-bound options.

## Capture reference

Use the current browser tab without navigating it:

```sh
wordcell clip current --browser-live --output articles
wordcell clip current --cdp 9222 --output articles
```

For `--browser-live`, first enable Chrome's local debugging connection at `chrome://inspect/#remote-debugging` (Chrome 144+). If Chrome was launched with an explicit loopback debugging port, pass that numeric port to `--cdp` instead.

To open a URL with state from a path-backed Chromium profile, pass its path. The capture runs against a temporary copy, leaving the source profile unchanged. A named profile selects reusable agent-browser-managed state instead:

```sh
wordcell clip https://example.com/private --browser-profile <path> --output articles
```

Each web capture writes readable Markdown, `capture.json`, localized assets, and optional evidence under `articles/<slug>/`. Unless media is disabled, YouTube captures add the title, description, duration, channel, thumbnail, and a locally extracted transcript when available; other video surfaces retain a poster or thumbnail instead of downloading the video by default. See [Capture web content](capture.md) for scopes, saved files, browser modes, media, evidence, completeness states, and limits.

Schema v4 manifests bind the exact saved Markdown path, byte count, and SHA-256
digest. `wordcell capture verify articles/<slug>` checks that digest without executing
the content. Add `--verify-assets` to check recorded assets. Source HTML remains
omitted unless `wordcell capture show` receives `--include-source-html`.

PDF capture uses the same bundle boundary:

```sh
wordcell pdf "/absolute/path/to/document.pdf" --output articles
wordcell pdf "https://example.com/document.pdf" --output articles
```

The bundle includes byte-identical `source.pdf`, readable Markdown, `capture.json`, and content-addressed extracted images. A reviewed second pass also retains its hash-bound `annotations.json`. See [Capture PDF documents](pdf.md) for heading inference, OCR, screenshot metadata, completeness, and review.

## Graph reference

Vault-root wikilinks such as
`[[notes/context-engineering|context engineering]]` and source-owned typed
frontmatter relationships are the graph's authored facts:

```yaml
type: concept
document_id: durable-agent-memory
relations:
  supports:
    - notes/durable-agent-memory
```

Predicates use lower-kebab-case. Local targets use exact vault-root IDs without
`.md`; cross-vault targets use canonical stable `kb://` URIs. `wordcell graph`, `wordcell backlinks`, `wordcell relation list`, and `wordcell links` derive
inverse edges and bounded paths without injecting reciprocal or inferred facts into notes.
`wordcell percolate` proposes reusable concepts and missing connections with explicit
support; an agent reviews the cited prose before authoring anything. In its V2
result, a missing relationship is an unordered endpoint pair with a required
predicate, never an executable directed assertion or an automatic
`related-to`. Common reviewed claims use `synthesizes`, `evidenced-by`,
`informed-by`, `supersedes`, or `contradicts`; other canonical custom predicates
remain valid when their meaning is supported.

Within a portfolio, a note can target a stable cross-vault identity such as
`kb://hraness/sleepyland/sound-wellness-expansion`. The target vault must be
explicitly selected for `wordcell portfolio audit` to resolve it. Missing or invalid
`document_id` values remain legacy path identities and never gain a stable URI
by inference.

These focused views are rebuilt from current Markdown. Wordcell never commits a graph
database, generated fact file, or engine entity ID. Parallel agents therefore
keep editing separate notes. Each lane can run `wordcell check --no-catalog`, and the
integrator runs one final `wordcell refresh` for the only shared generated region in
`index.md`. Use `wordcell graph --json` for a whole-vault structural question; when a
question recurs, prefer adding a focused command with a bounded output contract
over introducing a parallel query store.

Frontmatter retains nested objects, arrays, finite numbers with safe integer precision, booleans, strings, and nulls. `wordcell list --where type=plan --tag ingestion --sort metadata.updated --order desc` answers exact questions from that authored data. Unquoted `true`, `false`, `null`, and numeric filter values are typed; keep the quotes inside the argument to match a string with the same spelling, for example `wordcell list --where 'external_id="9007199254740993"'`. Hybrid search fuses exact and QMD result orders, then joins each match back to live metadata. Graph neighbors and Git provenance are returned as separate evidence. Similarity never becomes a link automatically.

Repository context preserves a stricter authority boundary. `AGENTS.md` remains
the always-loaded, normative home for ownership, required commands,
prohibitions, and edit gates. An optional `type: agent-context` note under
`scopes/` holds rationale, history, examples, evidence, and links for one exact
repository-relative directory. Its reciprocal
`<!-- kb:context scopes/<id> -->` marker appears before the guide headings.
A hub cannot override its guide or become the only home of a load-bearing
editing rule. Moving the scoped directory changes its identity.

Scope hubs are ordinary Markdown in the graph and optional QMD index;
`AGENTS.md` files remain excluded. This workflow reads repository and vault
files at development time. Applications do not need to import Wordcell or couple
their runtime to the vault.

The package exports its full programmatic surface from `@hraness/wordcell`. Open one
read-only vault session through `@hraness/wordcell/sdk` to share a live Markdown scan
across exact search, metadata queries, reads, navigation, hybrid search, and Git
provenance. Compose finite parallel retrieval graphs with
`@hraness/wordcell/workflow`. `@hraness/wordcell/workflows` includes editable
`decision-context`, `explain-change`, and `plan-radar` compositions. Focused
lower-level entry points include
`@hraness/wordcell/search`, `@hraness/wordcell/git`,
`@hraness/wordcell/agent-context`,
`@hraness/wordcell/agent-guide-audit`, `@hraness/wordcell/attachments`,
`@hraness/wordcell/authoring`, `@hraness/wordcell/evaluation`,
`@hraness/wordcell/evaluation-kb`, and `@hraness/wordcell/evaluation-builder`. The builder
entry point owns frozen-corpus authoring, evidence compilation, implementation
commitments, seal validation, and the bounded v2 evaluation mechanics. A
consumer keeps its corpus, build configuration, repository-specific retriever
descriptors, and promotion expectations in its own repository. The installed
`wordcell-evaluation-builder` binary exposes the same build lifecycle without a
source checkout.
Other focused entries include
`@hraness/wordcell/graph-authority`, `@hraness/wordcell/graph-percolation`, `@hraness/wordcell/graph`, `@hraness/wordcell/navigation`, `@hraness/wordcell/percolate`,
`@hraness/wordcell/portfolio`, `@hraness/wordcell/query`, `@hraness/wordcell/repository-memory`,
`@hraness/wordcell/search-rules`, `@hraness/wordcell/untrusted-content`,
`@hraness/wordcell/source-inbox`, and `@hraness/wordcell/semantic`; web-capture orchestration and
diagnostics from
`@hraness/wordcell/capture`; metadata search, Archive.today discovery, sidecar parsing,
and backfill composition from `@hraness/wordcell/url-intelligence`; PDF ingestion from `@hraness/wordcell/pdf`; and reusable
disposable-profile helpers from `@hraness/wordcell/browser-profiles`. Embedders that
need the CLI's lower-level ingestion machinery can use the explicit
capture-primitive subpaths listed in `package.json`, including
`@hraness/wordcell/clip/acquire`, `@hraness/wordcell/clip/args`, the DNS-pinned request and
connection-pool boundary at `@hraness/wordcell/clip/network`, and the browser proxy at
`@hraness/wordcell/clip/network-proxy`. Stored-bundle inspection, capture refresh
diffs, and the explicit local job ledger are available from
`@hraness/wordcell/clip/bundle-reader`, `@hraness/wordcell/clip/refresh`, and
`@hraness/wordcell/clip/jobs`.

## Agent skills

The repository ships one reusable `wordcell` Agent Skill under `skills/wordcell/`. Its
intent router loads focused references only when a task needs them: querying
repository context and agent memory, capturing URLs or PDFs, writing durable
plans, promoting concepts and typed relationships, refreshing and checking a
vault, or designing a setup through an interview and approved proposal. An
approved setup may scaffold a bounded companion skill for a distinct recurring
ritual. The package smoke test keeps future tagged packages byte-identical to
that source tree.

```sh
npx skills add hraness/wordcell#v0.21.1
# or
bunx skills add hraness/wordcell#v0.21.1
```

The skill invokes the installed `wordcell` command without depending on a repository
checkout. It routes setup and evolution before runtime preparation. For
execution workflows, runtime setup installs the pinned CLI only when the
command is missing, and it never initializes or mutates a vault as an
installation side effect. The repository's phase-orchestration skill remains
available to local repository agents but is marked internal, so public skill
discovery omits it.

See [Design](design.md), [Portfolio federation](portfolio.md), [Agent workflow](agent-workflow.md), [PDF capture](pdf.md), and [Contributing](../CONTRIBUTING.md) for the durable contracts and development gate. hraness/wordcell is available under the [MIT License](../LICENSE).
