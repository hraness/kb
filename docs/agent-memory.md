# Markdown memory for coding agents

[Back to Wordcell](../README.md) · [Practical agent workflow](agent-workflow.md)

## A knowledge base for your coding agents

> Give coding agents durable, searchable memory beside the repository with plain Markdown, Git history, and replaceable local search.

Coding agents lose useful context when a session ends. The next agent can search the code again, but it cannot recover a source that was never saved, a decision that stayed in chat, or the relationship between two notes that nobody recorded. Repeating that work costs time and produces inconsistent answers.

Search alone cannot preserve agent memory. The system also needs a write path into inspectable files under version control: evidence can be captured, current understanding can be revised, plans can accumulate outcomes, and mandatory edit rules can move onto the instruction path. Search indexes, graph views, and embeddings used for meaning-based similarity should remain derived and replaceable.

[hraness/wordcell](<https://wordcell.io>) implements that split as repository-adjacent Markdown and Git. Exact lookup, metadata filters, local search, explicit links, and Git provenance help an agent find and inspect the files without making application code depend on the knowledge system.

### The pattern converged across agent tools

[Devin's 2024 release history](<https://docs.devin.ai/release-notes/2024>) records Knowledge that could be recalled across future sessions and Repo Knowledge produced by scanning repositories. Its [2025 release history](<https://docs.devin.ai/release-notes/2025>) records DeepWiki in April, codebase intelligence inside Devin in May, and a DeepWiki Model Context Protocol server later that month.

In April 2026, Andrej Karpathy published an [LLM Wiki proposal](<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>) with immutable raw sources, an agent-maintained interlinked Markdown wiki, and an instruction schema. Its operations are ingest, query, and lint, with QMD as an optional search layer when a simple index stops being enough. These systems converged on durable agent-readable knowledge. The sequence does not establish direct lineage between them or hraness/wordcell.

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

hraness/wordcell packages the pattern as a small file contract. A useful vault can begin with Markdown, Git, `index.md`, and standard file search. Source capture, metadata queries, repository-path context, QMD, typed relationships, graph traversal, and TypeScript sessions are layers to add when the simpler setup stops answering the repository's questions. Application code need not import Wordcell, and no hosted service or graph database owns its records.

Captured sources preserve evidence, notes hold current explanations, and plans retain decisions and outcomes. YAML frontmatter adds queryable metadata without requiring one domain schema for every vault. A code-related record may declare a few exact repository-relative `repository_scopes` so an agent can recover it from the path it is about. The declaration stays in the record instead of a central project database, which lets parallel agents update unrelated memory without sharing a generated file.

The Markdown files are authoritative. The catalog, QMD database, backlink view, path-context view, graph traversal, and bounded Git index are derived and replaceable. A vault can keep a managed catalog or an authored front door and render the complete inventory on demand. Deleting one of those views removes a way to retrieve knowledge, not the knowledge itself.

### Route current memory from the code path

A broad semantic search over years of completed plans can rank a detailed historical record above the short explanation that owns the code today. `wordcell context packages/parser/src/index.ts --root kb --repo .` starts from a stronger signal: the path being changed. It returns the inherited guides that govern the edit, curated scope hubs, and bounded records whose declared scope is that path or one of its ancestors.

The records stay grouped by role. Maintained notes, proposed through blocked plans, dated market research, and generated reports form current memory. Completed, superseded, and cancelled plans remain available in a separate historical group. Every result states the declaration that matched and whether the target currently exists. A plan can therefore describe a future path, while a retired path remains honest historical evidence instead of being silently rewritten after a rename.

**Path context, exact scope filtering, and Git memory**

```shell
wordcell context packages/parser/src/index.ts --root kb --repo .
wordcell list --root kb --scope packages/parser --where type=plan --json
wordcell history search packages/parser/src/index.ts --root kb --repo . --json
```

### Preserve evidence and plans as working records

Durable reasoning needs inspectable evidence. `wordcell clip` can read a public URL,
saved HTML, rendered page, a page already open in an authenticated browser, or
an existing exact Archive.today snapshot after the direct routes fail. Archive
fallback is read-only and always partial. The
[capture documentation](capture.md) defines the supported routes. A capture
writes readable Markdown beside localized assets and `capture.json`, whose
manifest records where the material came from, how it was extracted, what was
saved, and any warnings. “Complete” describes the selected page surface, not
every hidden branch or future version of the site.

**Capture a web source or local PDF**

```shell
wordcell clip "https://example.com/article" --output articles
wordcell pdf "/absolute/path/to/document.pdf" --output articles
```

The resulting bundle is evidence, not final interpretation. A maintained note can cite several captures, record disagreement, and change when later evidence warrants it. The sources stay available for audit. This prevents an agent from silently replacing what a page said with what it now believes the page meant.

The `wordcell` Agent Skill routes vault planning requests to a focused durable-plan workflow. It creates a normal Markdown file under `kb/plans/` with an outcome, status, area, repository scopes, assumptions, dependencies, decisions, and verification method. The file grows during execution as agents record deviations, review findings, and reproducible evidence. Closeout adds a compact result and durable-memory disposition: each reusable conclusion links to the maintained note, guide, code contract, or runbook that now owns it, or says that no promotion was needed. Completed plans remain in Git as the history of the work. When a finding becomes a rule whose omission would make a future edit wrong, move that rule into the applicable `AGENTS.md` and retain the plan as its rationale.

### Search and connect with bounded signals

An identifier, title, alias, path, tag, or quoted phrase should not depend on an embedding. Exact mode reads the live Markdown. The default hybrid mode combines those results with keyword and vector result orders from [QMD, a local search engine for Markdown](<https://github.com/tobi/qmd>), while keeping exact identity matches first. Graph context and Git provenance remain separate evidence, so neither silently changes the primary text rank.

**Path context, exact and hybrid search, and direct history**

```shell
wordcell context packages/parser/src/index.ts --root kb --repo .
wordcell search "parser-v2" --root kb --mode exact
wordcell search "why does the parser reject this input?" --root kb \
  --tag architecture --where status=active --json
wordcell history "notes/parser-design" --root kb --repo . --json
```

`--mode keyword` uses QMD's local full-text index without loading an embedding model. Hybrid and semantic modes use a pinned local embedding model. Wordcell reconciles every QMD hit with current Markdown before returning it, and applies metadata and tag filters to those live notes. Search modes remain explicit through `--mode exact`, `--mode keyword`, `--mode semantic`, and `--mode hybrid`.

Retrieval is bounded. The high-level `wordcell search` and `KnowledgeBaseSession.search` surfaces return at most 100 primary results and request at most 500 candidates from each QMD retrieval lane. Selective filters can discard stale or ineligible rows from that window. When those discards prevent Wordcell from filling the requested eligible result set, Wordcell marks the QMD lane degraded and the overall result partial instead of presenting the bounded approximation as complete. Scores are local ranking signals, not probabilities, and cannot be compared across modes.

Each note owns its outbound typed relationships in frontmatter. Wordcell derives backlinks, inverse edges, and bounded traversal at read time, so parallel agents do not contend on one generated fact file. `wordcell percolate <note>` reports recurring concepts and missing-link candidates with inspectable support but writes nothing. An agent reads the cited notes before creating a reusable concept or relationship. Semantic similarity never creates an edge automatically.

Percolation Result V2 presents a missing relationship as an unordered pair of
notes with a required predicate. It does not choose the source, direction, or a
`related-to` fallback. Recommended authored predicates include `synthesizes`,
`evidenced-by`, `informed-by`, `supersedes`, and `contradicts`; they are an
advisory vocabulary, so a vault can use another canonical predicate when its
prose and evidence define the claim. Wordcell never infers reciprocal, inverse,
transitive, or similarity-derived relationships.

Git provenance is opt-in. A search without `--history` performs no Git indexing. `--history` requests best-effort provenance, while `--require-history` rejects unavailable history or incomplete provenance for the selected notes. If one commit exceeds the 2,000-path detail limit, Wordcell retains its identity and vault-local note associations, marks its co-change detail incomplete, and continues through later commits. Best-effort search reports that requested lane as partial.

Local attachment checks cover Markdown and Obsidian references to images, PDFs, and editable tldraw sources. They reject missing or escaping files while leaving external URLs alone. A source-inbox view separately lists recent captures that have no inbound disposition from maintained knowledge. It is an advisory, not an automatic backlink requirement: a saved source may intentionally remain a leaf.

### Measure retrieval on a frozen corpus

The August 2, 2026 pilot froze one repository snapshot and 18 questions whose graded relevance judgments were written before the rankings were inspected. The evaluator scanned 156 Markdown records and projected 155 searchable notes into QMD after excluding the authored vault index and agent guides. Nine questions formed the development set, and nine were held out for the test. The test covered exact identity, conceptual recall, active plans, current decisions, code-path context, source evidence, historical rationale, stale-versus-current conflicts, and one no-answer case.

At a cutoff of 10 results, exact search recorded `Recall@10` of 0.833333, `MRR@10` of 0.892857, and `nDCG@10` of 0.790377. Hybrid search recorded 0.833333, 0.937500, and 0.833884, respectively. Recall measures how much of the judged relevant set appeared; mean reciprocal rank rewards an earlier first relevant result; normalized discounted cumulative gain also accounts for graded relevance and position.

Eight test questions had an answer. A 10,000-resample paired bootstrap, which repeatedly samples those same questions to estimate the stability of the difference, measured hybrid minus exact. The `Recall@10` difference was 0 with a 95% confidence interval of \[0, 0\]; the `MRR@10` difference was +0.044643 with \[0, 0.133929\]; and the `nDCG@10` difference was +0.043508 with \[-0.012752, 0.111832\]. Both retrievers returned a result for the one no-answer question instead of abstaining, so their no-answer accuracy was 0.

The same mixed-cache, single-run test recorded p95 latencies of 44.345 milliseconds for exact, 62.834 for hybrid, 821.370 for keyword, and 41,000.524 for semantic retrieval. The semantic figure includes the first in-process model load. The run used [QMD 2.5.3 at Hraness compatibility commit aa993dc](<https://github.com/hraness/qmd/commit/aa993dceb3ef8cfb71d470554ca437570f5a2b3c>) and a locally verified EmbeddingGemma 300M Q8 model on Bun 1.3.14 and Node 24.3.0 under arm64 Darwin 25.5.0, with an Apple M4 Max, 16 logical CPUs, and 128 GiB of memory. Each p95 summarizes only nine queries with mixed cold and warm state, so these are local diagnostics, not speed claims. The corpus is too small to establish that hybrid is generally superior to exact search or to compare Wordcell with industry retrieval systems.

Search finds candidates. Similarity does not establish that a passage is current, correct, or supported by its sources. The Markdown, cited captures, explicit relationships, and requested Git history supply the material a reader must inspect.

### Customize through an approved proposal

The Agent Skill routes setup and evolution requests before it prepares a
runtime. It inspects the proposed location without mutation, interviews the
user about the memory questions the Wordcell should answer, and presents exact read
and write targets. Only the approved targets may be scaffolded. A changed path,
repository, account, integration, or companion skill requires renewed
approval.

The standard router may be enough. A recurring ritual can instead receive a
companion skill with explicit inputs, authority, durable outputs, idempotence,
failure behavior, and verification. These skills are inert instructions. They
do not create a plugin runtime, execute vault metadata, inherit ambient account
access, or couple application code to the Wordcell. An exact repeat is a no-op;
divergence, path escape, symbolic links, partial writes, and unapproved
external surfaces stop the workflow.

The repository's fake-capability suite exercises those transitions. It is a
tested contract example, not proof that every agent or host integration
complies.

This workflow builds on Frank Chen's public notes about [designing a personal
knowledge base with an
agent](https://gist.github.com/fxchen/773397095d7a6bffda621e4237da0da9)
and [extending it with
skills](https://gist.github.com/fxchen/09cb410b22c9c5256d80243ee925b57e).

Wordcell ships no `kb_role` metadata, lifecycle resolver or API, lifecycle CLI,
compatibility diagnostic, or metadata migration. A frozen Phase 0 value gate
must show that those surfaces improve deterministic agent decisions before they
are introduced. Current and historical plan routing remains derived from
existing type, path, and status conventions.

### Adopt the smallest useful split

Start with a short inherited `AGENTS.md` path for rules whose omission would make an edit wrong. A small knowledge base may need only Markdown, Git, an index page, and ordinary file search. Add source capture when evidence keeps disappearing. Add repository scopes when agents need to recover current memory from code paths. Add metadata or hybrid search when file search stops answering the repository's questions. Add links and graph views only when the relationships themselves help people make decisions.

Treat the knowledge base as repository-adjacent durable memory. Authored Markdown and Git are the record; catalogs, indexes, embeddings, and graph views are replaceable ways to find and inspect it. Checks can validate structure, captures can preserve a selected surface, and similarity can suggest candidates. None of those mechanisms proves that a source is trustworthy or an explanation is still true. People and agents must revise the knowledge as the repository changes.

