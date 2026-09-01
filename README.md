<!-- hraness:kb-landing:start -->
# kb

[![skills.sh](https://skills.sh/b/hraness/kb)](https://skills.sh/hraness/kb)

A knowledge base for coding agents, built from Markdown, backlinks, semantic
search, and Git context.
It turns sources, plans, and decisions into inspectable context that agents can
recover across sessions without coupling application code to the knowledge
system.

## Install

Bun 1.3.14 or newer is required.

```sh
bun add --global @hraness/kb@0.18.0
kb --help
```

## Keep one decision available to the next session

Suppose a parser must stop retrying after three attempts. Record that constraint
in a note, then link the plan that will implement it:

```shell
kb init kb
kb note create notes/parser-contract \
  --title "Parser contract" --type concept --tag architecture \
  --body "Parser retries stop after three attempts." --root kb
kb note create plans/parser-v2 \
  --title "Parser v2" --type plan \
  --body "The plan implements [[notes/parser-contract|the parser contract]]." \
  --root kb
```

The first `kb note create` command stores ordinary Markdown at
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
kb context packages/parser/src/index.ts --root kb --repo .
kb search "why parser retries stop" --root kb --mode exact \
  --history --repo .
kb backlinks notes/parser-contract --root kb
kb history notes/parser-contract --root kb --repo .
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

<!-- hraness:kb-landing:end -->

## Links

[Install `@hraness/kb` from npm](https://www.npmjs.com/package/@hraness/kb) ·
[KB source on GitHub](https://github.com/hraness/kb) ·
[KB overview](https://hraness.com/kb)

## A knowledge base for your coding agents

> Give coding agents durable, searchable memory beside the repository with plain Markdown, Git history, and replaceable local search.

Coding agents lose useful context when a session ends. The next agent can search the code again, but it cannot recover a source that was never saved, a decision that stayed in chat, or the relationship between two notes that nobody recorded. Repeating that work costs time and produces inconsistent answers.

Search alone cannot preserve agent memory. The system also needs a write path into inspectable files under version control: evidence can be captured, current understanding can be revised, plans can accumulate outcomes, and mandatory edit rules can move onto the instruction path. Search indexes, graph views, and embeddings used for meaning-based similarity should remain derived and replaceable.

[hraness/kb](<https://hraness.com/kb>) implements that split as repository-adjacent Markdown and Git. Exact lookup, metadata filters, local search, explicit links, and Git provenance help an agent find and inspect the files without making application code depend on the knowledge system.

### The pattern converged across agent tools

[Devin's 2024 release history](<https://docs.devin.ai/release-notes/2024>) records Knowledge that could be recalled across future sessions and Repo Knowledge produced by scanning repositories. Its [2025 release history](<https://docs.devin.ai/release-notes/2025>) records DeepWiki in April, codebase intelligence inside Devin in May, and a DeepWiki Model Context Protocol server later that month.

In April 2026, Andrej Karpathy published an [LLM Wiki proposal](<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>) with immutable raw sources, an agent-maintained interlinked Markdown wiki, and an instruction schema. Its operations are ingest, query, and lint, with QMD as an optional search layer when a simple index stops being enough. These systems converged on durable agent-readable knowledge. The sequence does not establish direct lineage between them or hraness/kb.

### Separate rules from explanations

A repository needs two kinds of memory. Rules that must govern an edit belong in a scoped `AGENTS.md` file on the path to the code. Rationale, history, examples, evidence, plans, and neighboring decisions belong in a knowledge base that an agent pulls only when the task needs them. This keeps mandatory instructions short without throwing away the context behind them.

A root guide carries repository-wide policy, and nested guides add constraints owned by a package or product. A nearby knowledge note can explain why a parser rejects a tempting shortcut, preserve the source behind the decision, and link the plan that introduced it. If the note and the applicable guide disagree, the guide controls the edit and the note needs repair.

The result has two concrete parts: scoped instruction files govern edits, while an ordinary Markdown vault stores supporting context. Application code imports neither the vault nor its search indexes:

**Repository rules beside durable knowledge**

```text
repository/
├── AGENTS.md                         # inherited root rules
├── packages/parser/
│   ├── AGENTS.md                     # scoped rules and checks
│   └── src/
└── kb/
    ├── articles/<slug>/              # captured evidence and assets
    ├── notes/                         # maintained explanations
    ├── plans/                         # decisions and outcomes
    └── index.md                       # short authored front door
```

### Keep the implementation small and the files authoritative

hraness/kb packages the pattern as a small file contract. A useful vault can begin with Markdown, Git, `index.md`, and standard file search. Source capture, metadata queries, repository-path context, QMD, typed relationships, graph traversal, and TypeScript sessions are layers to add when the simpler setup stops answering the repository's questions. Application code need not import KB, and no hosted service or graph database owns its records.

Captured sources preserve evidence, notes hold current explanations, and plans retain decisions and outcomes. YAML frontmatter adds queryable metadata without requiring one domain schema for every vault. A code-related record may declare a few exact repository-relative `repository_scopes` so an agent can recover it from the path it is about. The declaration stays in the record instead of a central project database, which lets parallel agents update unrelated memory without sharing a generated file.

The Markdown files are authoritative. The catalog, QMD database, backlink view, path-context view, graph traversal, and bounded Git index are derived and replaceable. A vault can keep a managed catalog or an authored front door and render the complete inventory on demand. Deleting one of those views removes a way to retrieve knowledge, not the knowledge itself.

### Route current memory from the code path

A broad semantic search over years of completed plans can rank a detailed historical record above the short explanation that owns the code today. `kb context packages/parser/src/index.ts --root kb --repo .` starts from a stronger signal: the path being changed. It returns the inherited guides that govern the edit, curated scope hubs, and bounded records whose declared scope is that path or one of its ancestors.

The records stay grouped by role. Maintained notes, proposed through blocked plans, dated market research, and generated reports form current memory. Completed, superseded, and cancelled plans remain available in a separate historical group. Every result states the declaration that matched and whether the target currently exists. A plan can therefore describe a future path, while a retired path remains honest historical evidence instead of being silently rewritten after a rename.

**Path context, exact scope filtering, and Git memory**

```shell
kb context packages/parser/src/index.ts --root kb --repo .
kb list --root kb --scope packages/parser --where type=plan --json
kb history search packages/parser/src/index.ts --root kb --repo . --json
```

### Preserve evidence and plans as working records

Durable reasoning needs inspectable evidence. `kb clip` can read a public URL,
saved HTML, rendered page, a page already open in an authenticated browser, or
an existing exact Archive.today snapshot after the direct routes fail. Archive
fallback is read-only and always partial. The
[capture documentation](docs/capture.md) defines the supported routes. A capture
writes readable Markdown beside localized assets and `capture.json`, whose
manifest records where the material came from, how it was extracted, what was
saved, and any warnings. “Complete” describes the selected page surface, not
every hidden branch or future version of the site.

**Capture a web source or local PDF**

```shell
kb clip "https://example.com/article" --output articles
kb pdf "/absolute/path/to/document.pdf" --output articles
```

The resulting bundle is evidence, not final interpretation. A maintained note can cite several captures, record disagreement, and change when later evidence warrants it. The sources stay available for audit. This prevents an agent from silently replacing what a page said with what it now believes the page meant.

The `kb` Agent Skill routes vault planning requests to a focused durable-plan workflow. It creates a normal Markdown file under `kb/plans/` with an outcome, status, area, repository scopes, assumptions, dependencies, decisions, and verification method. The file grows during execution as agents record deviations, review findings, and reproducible evidence. Closeout adds a compact result and durable-memory disposition: each reusable conclusion links to the maintained note, guide, code contract, or runbook that now owns it, or says that no promotion was needed. Completed plans remain in Git as the history of the work. When a finding becomes a rule whose omission would make a future edit wrong, move that rule into the applicable `AGENTS.md` and retain the plan as its rationale.

### Search and connect with bounded signals

An identifier, title, alias, path, tag, or quoted phrase should not depend on an embedding. Exact mode reads the live Markdown. The default hybrid mode combines those results with keyword and vector result orders from [QMD, a local search engine for Markdown](<https://github.com/tobi/qmd>), while keeping exact identity matches first. Graph context and Git provenance remain separate evidence, so neither silently changes the primary text rank.

**Path context, exact and hybrid search, and direct history**

```shell
kb context packages/parser/src/index.ts --root kb --repo .
kb search "parser-v2" --root kb --mode exact
kb search "why does the parser reject this input?" --root kb \
  --tag architecture --where status=active --json
kb history "notes/parser-design" --root kb --repo . --json
```

`--mode keyword` uses QMD's local full-text index without loading an embedding model. Hybrid and semantic modes use a pinned local embedding model. KB reconciles every QMD hit with current Markdown before returning it, and applies metadata and tag filters to those live notes. Search modes remain explicit through `--mode exact`, `--mode keyword`, `--mode semantic`, and `--mode hybrid`.

Retrieval is bounded. The high-level `kb search` and `KnowledgeBaseSession.search` surfaces return at most 100 primary results and request at most 500 candidates from each QMD retrieval lane. Selective filters can discard stale or ineligible rows from that window. When those discards prevent KB from filling the requested eligible result set, KB marks the QMD lane degraded and the overall result partial instead of presenting the bounded approximation as complete. Scores are local ranking signals, not probabilities, and cannot be compared across modes.

Each note owns its outbound typed relationships in frontmatter. KB derives backlinks, inverse edges, and bounded traversal at read time, so parallel agents do not contend on one generated fact file. `kb percolate <note>` reports recurring concepts and missing-link candidates with inspectable support but writes nothing. An agent reads the cited notes before creating a reusable concept or relationship. Semantic similarity never creates an edge automatically.

Git provenance is opt-in. A search without `--history` performs no Git indexing. `--history` requests best-effort provenance, while `--require-history` rejects unavailable history or incomplete provenance for the selected notes. If one commit exceeds the 2,000-path detail limit, KB retains its identity and vault-local note associations, marks its co-change detail incomplete, and continues through later commits. Best-effort search reports that requested lane as partial.

Local attachment checks cover Markdown and Obsidian references to images, PDFs, and editable tldraw sources. They reject missing or escaping files while leaving external URLs alone. A source-inbox view separately lists recent captures that have no inbound disposition from maintained knowledge. It is an advisory, not an automatic backlink requirement: a saved source may intentionally remain a leaf.

### Measure retrieval on a frozen corpus

The August 2, 2026 pilot froze one repository snapshot and 18 questions whose graded relevance judgments were written before the rankings were inspected. The evaluator scanned 156 Markdown records and projected 155 searchable notes into QMD after excluding the authored vault index and agent guides. Nine questions formed the development set, and nine were held out for the test. The test covered exact identity, conceptual recall, active plans, current decisions, code-path context, source evidence, historical rationale, stale-versus-current conflicts, and one no-answer case.

At a cutoff of 10 results, exact search recorded `Recall@10` of 0.833333, `MRR@10` of 0.892857, and `nDCG@10` of 0.790377. Hybrid search recorded 0.833333, 0.937500, and 0.833884, respectively. Recall measures how much of the judged relevant set appeared; mean reciprocal rank rewards an earlier first relevant result; normalized discounted cumulative gain also accounts for graded relevance and position.

Eight test questions had an answer. A 10,000-resample paired bootstrap, which repeatedly samples those same questions to estimate the stability of the difference, measured hybrid minus exact. The `Recall@10` difference was 0 with a 95% confidence interval of \[0, 0\]; the `MRR@10` difference was +0.044643 with \[0, 0.133929\]; and the `nDCG@10` difference was +0.043508 with \[-0.012752, 0.111832\]. Both retrievers returned a result for the one no-answer question instead of abstaining, so their no-answer accuracy was 0.

The same mixed-cache, single-run test recorded p95 latencies of 44.345 milliseconds for exact, 62.834 for hybrid, 821.370 for keyword, and 41,000.524 for semantic retrieval. The semantic figure includes the first in-process model load. The run used [QMD 2.5.3 at Hraness compatibility commit aa993dc](<https://github.com/hraness/qmd/commit/aa993dceb3ef8cfb71d470554ca437570f5a2b3c>) and a locally verified EmbeddingGemma 300M Q8 model on Bun 1.3.14 and Node 24.3.0 under arm64 Darwin 25.5.0, with an Apple M4 Max, 16 logical CPUs, and 128 GiB of memory. Each p95 summarizes only nine queries with mixed cold and warm state, so these are local diagnostics, not speed claims. The corpus is too small to establish that hybrid is generally superior to exact search or to compare KB with industry retrieval systems.

Search finds candidates. Similarity does not establish that a passage is current, correct, or supported by its sources. The Markdown, cited captures, explicit relationships, and requested Git history supply the material a reader must inspect.

### Adopt the smallest useful split

Start with a short inherited `AGENTS.md` path for rules whose omission would make an edit wrong. A small knowledge base may need only Markdown, Git, an index page, and ordinary file search. Add source capture when evidence keeps disappearing. Add repository scopes when agents need to recover current memory from code paths. Add metadata or hybrid search when file search stops answering the repository's questions. Add links and graph views only when the relationships themselves help people make decisions.

Treat the knowledge base as repository-adjacent durable memory. Authored Markdown and Git are the record; catalogs, indexes, embeddings, and graph views are replaceable ways to find and inspect it. Checks can validate structure, captures can preserve a selected surface, and similarity can suggest candidates. None of those mechanisms proves that a source is trustworthy or an explanation is still true. People and agents must revise the knowledge as the repository changes.

## Installation reference

[Bun](https://bun.sh/docs/installation) is the required runtime.

### Tell your coding agent to install it

Copy this prompt into Codex, Claude Code, or another coding agent:

```text
Install the `kb` Agent Skill from `hraness/kb#v0.18.0` with the standard skills
CLI. Use the skill's runtime instructions to install the exact
`@hraness/kb@0.18.0` registry release only when the command is missing. Verify it
with `kb doctor` and `kb --help`, but do not initialize or modify a vault until
I ask.
```

Install the single public skill with either runner:

```sh
npx skills add hraness/kb#v0.18.0
bunx skills add hraness/kb#v0.18.0
```

Both commands discover the same `kb` skill and install it into the selected
agent runner. Skill installation is inert: it does not initialize a vault,
refresh a catalog, or edit Markdown. When invoked, the skill uses an existing
`kb` command or, when the command is missing, checks for Bun and installs the
CLI from the immutable `@hraness/kb@0.18.0` npm version.

The public skills CLI reads `skills/kb/` from the repository. The immutable
`0.18.0` npm package includes the same tree under
`node_modules/@hraness/kb/skills/kb/`, and the package check verifies that the
installed skill is byte-identical to the repository source.

Install the two global commands with Bun:

```sh
bun add --global @hraness/kb@0.18.0
kb --help
kb-evaluation-builder --help
```

The same registry package can be installed with npm:

```sh
npm install --global --ignore-scripts @hraness/kb@0.18.0
kb --help
```

Both commands are Bun executables. Bun `1.3.14` or newer must remain in `PATH`
even when npm performs the global installation. The conservative npm command
above disables dependency lifecycle scripts. Optional native search and
rendered-browser setup remain unavailable until the relevant scripts are
reviewed and enabled; run `kb doctor` to inspect the resulting capabilities.

For programmatic use, add the exact npm version to a Bun project:

```sh
bun add --exact @hraness/kb@0.18.0
```

The resulting dependency should remain exact:

```json
{
  "dependencies": {
    "@hraness/kb": "0.18.0"
  }
}
```

Version 0.18.0 retains three public GitHub dependencies: `@hraness/oh` at
immutable release `v0.2.0` for closure verification,
`@steipete/sweet-cookie` at Hraness release `v0.4.2` for the cookie-scope safety
fork, and `@tobilu/qmd` at commit
`aa993dceb3ef8cfb71d470554ca437570f5a2b3c` for store-local model behavior. A
registry installation therefore needs Git and public GitHub access while it
resolves those dependencies. They remain part of this release's supported
installation contract until equivalent registry releases are available.

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
chosen, then reinstall and run `kb doctor` to verify that capability. npm runs
dependency lifecycle scripts by default, so inspect the same packages before
omitting `--ignore-scripts` from an npm installation.

KB follows [npm's dual-use content
policy](https://docs.npmjs.com/policies/dual-use/) because it can read
explicitly selected signed-in browser state and perform bounded capture and
network operations. Read [`DISCLOSURE`](DISCLOSURE) and the [security
policy](SECURITY.md) before using authenticated capture.

Contributors can install from a checkout instead:

```sh
git clone https://github.com/hraness/kb.git
cd kb
bun install --frozen-lockfile
bun link
kb --help
```

HTTP and Archive.today capture work with the installed JavaScript dependencies. Rendered capture additionally needs a local Chromium-compatible browser. [yt-dlp](https://github.com/yt-dlp/yt-dlp) adds YouTube metadata, thumbnails, and transcripts; full audio or video localization is opt-in and some formats also need [FFmpeg](https://ffmpeg.org). PDF ingestion uses the open-source Poppler tools `pdfinfo` and `pdftohtml`; [Tesseract](https://github.com/tesseract-ocr/tesseract) adds local OCR for scans and screenshots. URL metadata backfill requires Rust on macOS or Linux to build the immutable, fixed-network, memory-confined `metadata-search-engine-rs` helper included in the installed package. Run `kb url-metadata tool build` once, then use `kb url-metadata backfill` from any working directory.

Structural commands and exact search read the current Markdown directly and
need no service, model, or graph database. KB pins
[QMD](https://github.com/tobi/qmd) 2.5.3 for local keyword and vector search.
`--mode keyword` uses its full-text index without an embedding model. Hybrid
and semantic search use a revision-pinned compact local EmbeddingGemma model;
the first index or vector query downloads about 300 MB. On macOS with Bun,
install extension-capable Homebrew SQLite with `brew install sqlite` before
using vector retrieval.

`kb doctor` statically checks the pinned QMD, SQLite, sqlite-vec,
node-llama-cpp, and matching native packages without importing native code or
downloading the model. Exact and keyword search remain model-free. KB also
refuses an older adjacent `.snapshot` directory that lacks its ownership
marker; inspect and remove only the explicitly named disposable directory,
then retry so KB never guesses that unrelated files are cache data.

## Start a vault

```sh
kb init my-kb
cd my-kb
kb clip https://example.com/article --output articles
kb refresh --root .
kb check --root .
```

`kb init` creates an `index.md` front door plus `articles/`, `notes/`,
`plans/`, `riffs/`, and optional repository-context `scopes/` boundaries. The
generated Markdown remains ordinary Markdown: open it in Obsidian, edit it in a
text editor, search it with standard tools, and version it with Git.

When a vault lives at `kb/` inside a repository, inspect the instructions and
mapped context for a repository path from the repository root:

```sh
kb agents identity packages/parser --json
kb context packages/parser/src/index.ts --root kb --repo .
kb agents check --root kb --repo .
```

`kb agents identity` derives a canonical mapping without writing files.
`kb context` lists inherited `AGENTS.md` files from the repository root toward
the target, verified context hubs from the nearest scope back toward the root,
and bounded repository-scoped memory. Maintained knowledge, active plans,
dated research, reports, and terminal plans stay in separate groups. Every
record states the exact authored scope that matched and whether it exists.
Open only the useful summaries, then use `kb links`, `kb backlinks`, `kb list`,
or `kb search` to expand the question deliberately.

## Command surface

| Command | Purpose |
| --- | --- |
| `kb init [directory]` | Create a new vault without merging into or overwriting an existing path; the default directory is `kb`. |
| `kb clip <url\|current>` | Capture a source and write an article bundle. `current` reads an attached active tab without navigating it; `kb capture <url>` is the explicit URL form. |
| `kb capture show\|verify\|diff <bundle>` | Inspect a stored capture as hostile content, verify its recorded document and optional asset hashes, or compare its exact Markdown bytes with a bounded Git ref. |
| `kb inspect <url>` | Run acquisition and extraction without writing a bundle. |
| `kb pdf <file-or-url> [--slug <slug>]` | Convert a local or public remote PDF into Markdown while retaining the original bytes, extracted images, OCR-derived text, URL provenance, and page provenance. |
| `kb refresh --root <directory>` | Rebuild a managed catalog atomically and report graph findings. An authored-catalog vault remains unchanged. |
| `kb check --root <directory>` | Verify catalog policy, graph integrity, and confined local image, PDF, and tldraw attachments without changing files. `--no-catalog` gates an edit lane without requiring the shared catalog refresh. |
| `kb catalog --root <directory>` | Render an exhaustive disposable catalog without modifying an authored or managed front door. |
| `kb graph --root <directory>` | Print the resolved contextual and typed graph, broken or ambiguous targets, orphans, and advisory mention candidates. |
| `kb backlinks <note> --root <directory>` | Show incoming contextual links and typed relationships for a note resolved by path, title, or alias. |
| `kb links <note> --root <directory>` | Traverse incoming, outgoing, or bidirectional contextual links and typed relationships with explicit depth and node limits. |
| `kb note create <id> --title <title> --root <directory>` | Atomically create one confined Markdown note; use `--type concept` for a reusable concept. |
| `kb relation add\|remove <source> <predicate> <target>` | Idempotently edit one source note's typed outbound relationship using an exact local note ID or canonical stable `kb://` URI. |
| `kb relation list <note> --root <directory>` | List a note's authored outbound and derived inbound typed relationships. |
| `kb percolate [note] --root <directory>` | Report evidence-backed recurring-concept and missing-relationship candidates without writing notes. |
| `kb list --root <directory>` | Filter typed nested frontmatter, tags, and repeated exact `--scope` declarations; sort by metadata, title, path, or graph counts. `kb notes` is an alias. |
| `kb index --root <directory>` | Build or incrementally refresh the optional local QMD embedding index. |
| `kb search <query> --root <directory>` | Combine live exact matches with local QMD keyword and vector retrieval. Use `--mode exact\|keyword\|semantic\|hybrid`, metadata, tags, exact `--scope` filters, or bounded graph context. `--rules <file>` enables reviewed aliases; add `--priority` for explicit rule-based ordering. Omitted history performs no Git work; `--history` requests best-effort provenance and `--require-history` rejects unavailable or incomplete selected-note provenance. |
| `kb portfolio search <query> --registry <file> --workspace <directory>` | Search only explicitly authorized vaults. Use `--shared` for public and organization entries or repeat `--vault owner/id` for a deliberate selection. The same `--rules <file>` and opt-in `--priority` apply within each selected vault before deterministic federation. |
| `kb portfolio audit --registry <file> --workspace <directory>` | Audit selected vault identities, authority groups, graph references, attachments, exact duplicate content, catalogs, and Git availability without repairing or electing an authority. |
| `kb history <note> --root <vault> --repo <repository>` | Return bounded direct provenance for one resolved note, including explicit oversized-commit limitations. |
| `kb history search <query-or-path> --root <vault> --repo <repository>` | Search bounded commit subjects, note paths, and co-change paths without authoring links or repository scopes. |
| `kb context <repository-path> --root <vault> --repo <repository>` | List inherited guides root to nearest, reciprocal hubs nearest to root, and grouped repository-scoped current and historical memory. Use `--kind auto\|file\|directory` to control path interpretation. |
| `kb inbox --root <vault>` | List recent captures without a maintained-note disposition. This is advisory and never creates links or fails merely because a source is a leaf. |
| `kb evaluate <manifest.json> --root <vault> --repo <repository>` | Verify an exact frozen Git/vault snapshot and run built-in exact, QMD, metadata, graph, path-context, and Git retrievers with raw evidence, latency, resource counters, metrics, and paired intervals. |
| `kb-evaluation-builder --anchor-seal\|--build --config <file> --artifact-root <directory>` | Anchor or build a frozen evaluation corpus through the installed package boundary. |
| `kb url-metadata tool build\|check` | Build or validate the pinned Rust metadata-search helper through the installed package boundary. |
| `kb url-metadata backfill --root <vault>` | Add resumable `url-metadata.json` sidecars for saved external URLs through the pinned metadata search helper and optional read-only Archive.today discovery. |
| `kb agents identity <repository-scope>` | Derive the normalized scope, canonical hub ID and path, owning guide path, and exact reciprocal marker without writing files. |
| `kb agents check --root <vault> --repo <repository>` | Validate context identities, exact scopes, reciprocal markers, real guide paths, collisions, confinement, and guide shape. Unmapped guides remain valid. |
| `kb agents audit --root <vault> --repo <repository>` | Run the same correctness gate, then report deterministic per-guide, section, inherited-chain, long-bullet, and exact-duplicate advisories. |
| `kb doctor` | Report capture capabilities and statically inspect local QMD, SQLite, sqlite-vec, node-llama-cpp, and native search prerequisites without loading a model. |
| `kb adapters` | Print the installed platform capability matrix. |

Vault commands default to the current directory and `index.md`; use `--root` and `--index` to select alternatives. Commands that report structured data accept `--json`. Run `kb --help` for the complete top-level surface and `kb clip --help` for capture, authentication, evidence, and resource-bound options.

## Capture reference

Use the current browser tab without navigating it:

```sh
kb clip current --browser-live --output articles
kb clip current --cdp 9222 --output articles
```

For `--browser-live`, first enable Chrome's local debugging connection at `chrome://inspect/#remote-debugging` (Chrome 144+). If Chrome was launched with an explicit loopback debugging port, pass that numeric port to `--cdp` instead.

To open a URL with state from a path-backed Chromium profile, pass its path. The capture runs against a temporary copy, leaving the source profile unchanged. A named profile selects reusable agent-browser-managed state instead:

```sh
kb clip https://example.com/private --browser-profile <path> --output articles
```

Each web capture writes readable Markdown, `capture.json`, localized assets, and optional evidence under `articles/<slug>/`. Unless media is disabled, YouTube captures add the title, description, duration, channel, thumbnail, and a locally extracted transcript when available; other video surfaces retain a poster or thumbnail instead of downloading the video by default. See [Capture web content](docs/capture.md) for scopes, saved files, browser modes, media, evidence, completeness states, and limits.

Schema v4 manifests bind the exact saved Markdown path, byte count, and SHA-256
digest. `kb capture verify articles/<slug>` checks that digest without executing
the content. Add `--verify-assets` to check recorded assets. Source HTML remains
omitted unless `kb capture show` receives `--include-source-html`.

PDF capture uses the same bundle boundary:

```sh
kb pdf "/absolute/path/to/document.pdf" --output articles
kb pdf "https://example.com/document.pdf" --output articles
```

The bundle includes byte-identical `source.pdf`, readable Markdown, `capture.json`, and content-addressed extracted images. A reviewed second pass also retains its hash-bound `annotations.json`. See [Capture PDF documents](docs/pdf.md) for heading inference, OCR, screenshot metadata, completeness, and review.

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
`.md`; cross-vault targets use canonical stable `kb://` URIs. `kb graph`, `kb backlinks`, `kb relation list`, and `kb links` derive
inverse edges and bounded paths without injecting reciprocal or inferred facts into notes.
`kb percolate` proposes reusable concepts and missing connections with explicit
support; an agent reviews the cited prose before authoring anything.

Within a portfolio, a note can target a stable cross-vault identity such as
`kb://hraness/sleepyland/sound-wellness-expansion`. The target vault must be
explicitly selected for `kb portfolio audit` to resolve it. Missing or invalid
`document_id` values remain legacy path identities and never gain a stable URI
by inference.

These focused views are rebuilt from current Markdown. KB never commits a graph
database, generated fact file, or engine entity ID. Parallel agents therefore
keep editing separate notes. Each lane can run `kb check --no-catalog`, and the
integrator runs one final `kb refresh` for the only shared generated region in
`index.md`. Use `kb graph --json` for a whole-vault structural question; when a
question recurs, prefer adding a focused command with a bounded output contract
over introducing a parallel query store.

Frontmatter retains nested objects, arrays, finite numbers with safe integer precision, booleans, strings, and nulls. `kb list --where type=plan --tag ingestion --sort metadata.updated --order desc` answers exact questions from that authored data. Unquoted `true`, `false`, `null`, and numeric filter values are typed; keep the quotes inside the argument to match a string with the same spelling, for example `kb list --where 'external_id="9007199254740993"'`. Hybrid search fuses exact and QMD result orders, then joins each match back to live metadata. Graph neighbors and Git provenance are returned as separate evidence. Similarity never becomes a link automatically.

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
files at development time. Applications do not need to import KB or couple
their runtime to the vault.

The package exports its full programmatic surface from `@hraness/kb`. Open one
read-only vault session through `@hraness/kb/sdk` to share a live Markdown scan
across exact search, metadata queries, reads, navigation, hybrid search, and Git
provenance. Compose finite parallel retrieval graphs with
`@hraness/kb/workflow`. `@hraness/kb/workflows` includes editable
`decision-context`, `explain-change`, and `plan-radar` compositions. Focused
lower-level entry points include
`@hraness/kb/search`, `@hraness/kb/git`,
`@hraness/kb/agent-context`,
`@hraness/kb/agent-guide-audit`, `@hraness/kb/attachments`,
`@hraness/kb/authoring`, `@hraness/kb/evaluation`,
`@hraness/kb/evaluation-kb`, and `@hraness/kb/evaluation-builder`. The builder
entry point owns frozen-corpus authoring, evidence compilation, implementation
commitments, seal validation, and the bounded v2 evaluation mechanics. A
consumer keeps its corpus, build configuration, repository-specific retriever
descriptors, and promotion expectations in its own repository. The installed
`kb-evaluation-builder` binary exposes the same build lifecycle without a
source checkout.
Other focused entries include
`@hraness/kb/graph`, `@hraness/kb/navigation`, `@hraness/kb/percolate`,
`@hraness/kb/portfolio`, `@hraness/kb/query`, `@hraness/kb/repository-memory`,
`@hraness/kb/search-rules`, `@hraness/kb/untrusted-content`,
`@hraness/kb/source-inbox`, and `@hraness/kb/semantic`; web-capture orchestration and
diagnostics from
`@hraness/kb/capture`; metadata search, Archive.today discovery, sidecar parsing,
and backfill composition from `@hraness/kb/url-intelligence`; PDF ingestion from `@hraness/kb/pdf`; and reusable
disposable-profile helpers from `@hraness/kb/browser-profiles`. Embedders that
need the CLI's lower-level ingestion machinery can use the explicit
capture-primitive subpaths listed in `package.json`, including
`@hraness/kb/clip/acquire`, `@hraness/kb/clip/args`, the DNS-pinned request and
connection-pool boundary at `@hraness/kb/clip/network`, and the browser proxy at
`@hraness/kb/clip/network-proxy`. Stored-bundle inspection, capture refresh
diffs, and the explicit local job ledger are available from
`@hraness/kb/clip/bundle-reader`, `@hraness/kb/clip/refresh`, and
`@hraness/kb/clip/jobs`.

## Agent skills

The repository ships one reusable `kb` Agent Skill under `skills/kb/`. Its
intent router loads focused references only when a task needs them: querying
repository context and agent memory, capturing URLs or PDFs, writing durable
plans, promoting concepts and typed relationships, or refreshing and checking
a vault. The package smoke test keeps future tagged packages byte-identical to
that source tree.

```sh
npx skills add hraness/kb#v0.18.0
# or
bunx skills add hraness/kb#v0.18.0
```

The skill invokes the installed `kb` command without depending on a repository
checkout. Its runtime setup installs the pinned CLI only when the command is
missing, and it never initializes or mutates a vault as an installation side
effect. The repository's phase-orchestration skill remains available to local
repository agents but is marked internal, so public skill discovery omits it.

See [Design](docs/design.md), [Portfolio federation](docs/portfolio.md), [Agent workflow](docs/agent-workflow.md), [PDF capture](docs/pdf.md), and [Contributing](CONTRIBUTING.md) for the durable contracts and development gate. hraness/kb is available under the [MIT License](LICENSE).

## Release notes

### Upgrade to v0.18.0

Version 0.18.0 adds a review-only adoption seam for exact dependency closures
from an Oh working authority. Trusted host code creates a
`createOhAdoptionPreparerV1` facade with the expected binding and head,
destination, rights clearance, review route, and conflict policy. The narrow
`prepare` call accepts only a capsule plus transformation and redaction
disclosures, returns deeply immutable deterministic Markdown and manifest
bytes with status `prepared`, and has no vault, Git, Oh-store, or promotion
capability. KB pins `@hraness/oh` v0.2.0 and delegates closure integrity to its
official store verifier.

### Upgrade to v0.17.3

Version 0.17.3 restructures the README around an inspectable first task,
explicit operating boundaries, and a shorter path from installation to useful
output. Runtime APIs and package behavior are unchanged.

### Upgrade to v0.17.2

Version 0.17.2 improves package discovery through focused npm keywords, a more
specific README opening, and direct links between npm, GitHub, and the project
overview. Runtime APIs and package behavior are unchanged.

### Upgrade to v0.17.1

Version 0.17.1 adds the public `@hraness/kb` npm installation path without
changing the runtime API introduced in 0.17.0. Bun `1.3.14` or newer is now an
explicit package requirement. Consumers should review the package's declared
dual-use capture boundary and the lifecycle scripts used by optional browser
and native search adapters before enabling those scripts.

### Upgrade to v0.17.0

Version 0.17 adds selected portfolio federation, stable note identities,
qualified external relations, search rules, capture inspection, and untrusted
context packing. Consumers with typed fixtures or custom capture writers should
make these migrations before upgrading:

- Capture writers now emit manifest schema v4 and must provide the stored
  document `path`, exact UTF-8 `bytes`, and lowercase SHA-256 digest. The reader
  can inspect schema v1-v3, but verification reports their document integrity as
  unavailable instead of success.
- `DecisionContextOutput.search` has been removed. Consume the bounded untrusted
  `context` projection and its `truncated` flag instead of transporting the raw
  search result into an agent prompt.
- `VaultAnalysis` fixtures must include `externalAuthoredRelations`, even when
  the value is an empty array. This keeps qualified authored edges distinct
  from locally resolved graph edges.
- `createNote` and `kb note create` now assign `document_id` to new ordinary
  notes. Preserve that ID across renames and update snapshots that intentionally
  assert the generated frontmatter.

Existing Markdown is not rewritten automatically. Add IDs to maintained legacy
notes only through reviewed edits, and keep every QMD, graph, portfolio, and
audit projection disposable.
