# Portfolio federation

Portfolio federation searches and audits selected Markdown vaults without combining their files or indexes. A strict registry gives each vault a stable logical identity and maps that identity to a checkout under one workspace. Each vault keeps its own Markdown, local graph, optional QMD index, and Git history.

The registry discovers vaults. An explicit selection determines which vaults a command or SDK session may open.

## Define a v1 registry

A v1 registry is a JSON file with the contract `hraness.kb-portfolio/v1` and `schemaVersion` `1`:

```json
{
  "contract": "hraness.kb-portfolio/v1",
  "schemaVersion": 1,
  "vaults": [
    {
      "owner": "hraness",
      "id": "stripedex",
      "repository": "hraness/stripedex",
      "checkout": "stripe-history",
      "root": "kb",
      "role": "repository",
      "visibility": "organization",
      "defaultRef": "main",
      "parserVersion": 1
    },
    {
      "owner": "hraness",
      "id": "legacy-notes",
      "repository": "hraness/legacy-notes",
      "checkout": "legacy-notes",
      "root": "kb",
      "role": "archive",
      "visibility": "private",
      "parserVersion": 1
    },
    {
      "owner": "personal",
      "id": "tiff",
      "repository": "personal/tiff",
      "checkout": "tiff",
      "root": "kb",
      "role": "portfolio",
      "visibility": "personal",
      "parserVersion": 1
    }
  ],
  "authorityGroups": [
    {
      "id": "product-history",
      "members": [
        "hraness/stripedex",
        "hraness/legacy-notes"
      ],
      "state": "unresolved",
      "protected": true,
      "reason": "An owner must choose the maintained authority."
    }
  ]
}
```

The vault key is the explicit `owner/id` pair. It remains `hraness/stripedex` even when the local checkout is named `stripe-history`. Do not derive a vault key from `checkout`, `root`, or a Git remote.

The other fields have separate purposes:

- `repository` is the logical repository identity.
- `checkout` is a relative path under the `--workspace` directory.
- `root` is a relative path under the checkout. Use `.` when the repository root is the vault root.
- `role` is `portfolio`, `repository`, `archive`, `template`, or `sample`. It changes audit severity for missing stable IDs. It does not grant access.
- `visibility` is `public`, `organization`, `private`, or `personal`. It controls the CLI's `--shared` selection. It is not a filesystem permission.
- `parserVersion` is exactly `1` in this contract.

The parser rejects unknown properties and unsafe paths. A registry is limited to 1 MiB, 128 vaults, and 64 authority groups. One operation may select at most 32 vaults. `--shared` and `--all` reject a registry-derived selection above that bound; they never truncate it silently.

## Select vaults explicitly

The SDK requires a nonempty `authorizedVaults` list. The CLI offers three selection forms:

- Repeated `--vault owner/id` selects the named vaults.
- `--shared` selects entries whose visibility is `public` or `organization`.
- `--all` selects every registry entry and is available only for audit.

Use `--vault` for `private` and `personal` entries. Use `--all` only when the process is permitted to read every configured vault.

After selection, the portfolio core resolves, opens, scans, and reports only selected vaults. Results do not expose names, counts, paths, or failures from unselected vaults. The CLI must still read and validate the registry to compute `--shared` or `--all`, so access to registry metadata is a separate prerequisite. It passes that exact immutable registry snapshot into the operation; authorization and checkout resolution cannot observe two different registry versions.

Visibility is a registry classification. Operating-system permissions and workspace confinement remain the access boundary. A registry entry cannot give the process access to a checkout it cannot already read.

## Search selected vaults

Search the shared vaults under one workspace:

```sh
kb portfolio search "durable agent memory" \
  --registry ./kb-portfolio.json \
  --workspace /srv/knowledge \
  --shared \
  --mode hybrid \
  --limit 10
```

Select private or personal vaults by exact key:

```sh
kb portfolio search "release rationale" \
  --registry ./kb-portfolio.json \
  --workspace /srv/knowledge \
  --vault hraness/stripedex \
  --vault hraness/legacy-notes \
  --mode exact
```

The supported modes are `hybrid`, `exact`, `keyword`, and `semantic`. Add `--json` to inspect per-vault diagnostics and local retrieval evidence.

A query that is a canonical qualified URI routes directly to its named selected vault and uses exact retrieval:

```sh
kb portfolio search "kb://hraness/stripedex/018f4b20-7c95-7af2-a11f-89011baf1137" \
  --registry ./kb-portfolio.json \
  --workspace /srv/knowledge \
  --vault hraness/stripedex
```

If that vault or document is outside the selection, the search does not reveal whether it exists elsewhere.

### Failure policy

Portfolio search uses the `partial` failure policy by default. A selected vault that cannot resolve, open, or complete its search produces a selected-vault diagnostic. Results from available selected vaults remain usable, and the result has `partial: true`.

Add `--require-all` when every selected vault must resolve, open, and execute its search:

```sh
kb portfolio search "release rationale" \
  --registry ./kb-portfolio.json \
  --workspace /srv/knowledge \
  --shared \
  --require-all
```

`--require-all` does not turn an optional QMD or Git provenance degradation into a fatal error. Inspect `partial` and the lane diagnostics when completeness matters.

### Deterministic federation order

Each vault performs its own exact or QMD-backed retrieval. The federation layer keeps QMD scores inside that vault's evidence because scores from separate QMD databases are not comparable.

The global merge uses this order:

1. Exact identity matches precede other matches.
2. A reciprocal score derived from the result's local rank orders the remaining candidates.
3. The stable vault key breaks a tie.
4. The qualified identity or current path breaks the final tie.

The returned portfolio `score` describes this reciprocal local-rank merge. It is not a probability or a QMD similarity score. Raw local evidence remains available under the hit's `local` and `evidence` fields.

Graph traversal remains vault-local. Portfolio search does not infer a cross-vault neighborhood or use graph context as a relevance boost.

## Give notes stable identities

Use `document_id` for an identity that survives a path change:

```md
---
document_id: 018f4b20-7c95-7af2-a11f-89011baf1137
type: concept
title: Durable agent memory
---

# Durable agent memory
```

`document_id` is a lowercase ASCII ID of at most 128 bytes. It may contain letters, digits, dots, underscores, and hyphens. Ordinary notes created through `kb note create` or `createNote` receive a UUID v4 when the caller does not provide an ID.

An idempotent create preserves an existing valid ID. It leaves a legacy note without an ID unchanged, and it rejects an explicit ID that conflicts with the existing note. Add IDs to legacy notes through a reviewed Markdown edit rather than treating an idempotent create as a migration.

A stable portfolio URI combines the logical vault identity and the authored document ID:

```text
kb://owner/vault/document_id
```

For example:

```text
kb://hraness/stripedex/018f4b20-7c95-7af2-a11f-89011baf1137
```

The URI is byte-canonical. Uppercase aliases, percent-encoded components, path traversal, and extra path segments are rejected. A `document_id` must be unique within its vault. The same ID in two different vaults produces two different qualified URIs.

Notes without a valid `document_id` remain searchable through a tagged `legacy-path` identity. A legacy path is not reported as stable and cannot be used for a qualified read.

## Author cross-vault relations

A typed relation may target a canonical qualified URI:

```yaml
relations:
  supports:
    - kb://hraness/stripedex/018f4b20-7c95-7af2-a11f-89011baf1137
```

The source note still owns the assertion. The local graph records it as an external authored relation instead of resolving it to a local note ID.

Portfolio audit verifies the target against valid stable IDs in the explicitly selected, successfully audited vaults. It reports `external-relation-unavailable` when the target is not available in that selection. This diagnostic does not claim that the target is absent from an unselected vault.

Cross-vault relations do not create inferred backlinks, reciprocal assertions, or cross-vault graph traversal. Author each assertion in Markdown where its source belongs.

## Audit a portfolio

Run a report-only audit across the shared selection:

```sh
kb portfolio audit \
  --registry ./kb-portfolio.json \
  --workspace /srv/knowledge \
  --shared
```

Audit exact vaults when the review includes private material:

```sh
kb portfolio audit \
  --registry ./kb-portfolio.json \
  --workspace /srv/knowledge \
  --vault hraness/stripedex \
  --vault hraness/legacy-notes \
  --strict
```

The default command exits successfully after producing the report, even when the report contains issues. `--strict` exits with status `3` when the report contains at least one error or is truncated. Warnings and advisories do not trigger that exit status. Use `--json` for the complete bounded report; its `ok` field is also false for an error or truncation.

Audit checks include:

- missing, invalid, and duplicate `document_id` values;
- unavailable cross-vault relation targets within the selected audit scope;
- broken or ambiguous links and malformed or unresolved local relations;
- local attachment failures;
- stale managed catalogs and unavailable Git provenance;
- invalid, unavailable, or overlapping selected roots;
- exact duplicate content across selected notes; and
- unresolved authority groups whose complete membership is selected.

Missing IDs are warnings in `portfolio` and `repository` vaults. They are advisories in `archive`, `template`, and `sample` vaults. Invalid or duplicate IDs are errors. Exact duplicate content is a warning when an active vault is involved and an advisory otherwise.

An audit is `partial` when a selected vault is unavailable or the report is truncated. Ordinary findings do not by themselves make the report partial. The default issue limit is 500, and the maximum is 5,000. Severity counts include every discovered issue even when only a bounded severity-preserving sample is materialized. `--strict` fails closed when any error is counted or when the report is truncated.

Audit is read-only. It does not assign IDs, repair links, update a catalog, deduplicate notes, move files, or choose an authority.

## Record authority decisions

An authority group records a reviewed decision state among registry members. Use `state: "unresolved"` while an owner must still choose. An unresolved group cannot declare `canonical`.

After review, change the state and name one member:

```json
{
  "id": "product-history",
  "members": [
    "hraness/stripedex",
    "hraness/legacy-notes"
  ],
  "state": "resolved",
  "canonical": "hraness/stripedex",
  "reason": "The maintained repository owns current product history."
}
```

`protected: true` marks a group whose duplicate material must remain visible during review. It does not suppress duplicate findings, grant access, or change search rank.

Use this migration sequence:

1. Register each real vault with its current stable logical `owner/id` identity.
2. Mark unresolved authority groups before moving or deleting content.
3. Run a selected audit and review root, identity, relation, and duplicate findings.
4. Add `document_id` to maintained legacy notes through reviewed Markdown edits. Preserve an ID when a note moves.
5. Replace cross-vault path assumptions with reviewed `kb://` relation targets.
6. Resolve an authority group only after its owner selects a canonical member and records the reason.
7. Enable `--strict` in automation after expected errors have been resolved.

Keep protected duplicate sources until their owner approves a consolidation. The registry and audit surface an authority conflict; they do not settle it.

## Keep search rules opt-in

Search rules are a strict configuration with `schemaVersion: 1`, named leading aliases, and priority rules. Configure them through `OpenKnowledgeBaseOptions.searchRules`, or through `OpenKnowledgePortfolioOptions.knowledgeBase.searchRules` for each local vault session. The CLI reads the same bounded JSON contract from `--rules <file>`.

For example, a consumer-owned `search-rules.json` can define one constrained alias and one opt-in maintained-note tier:

```json
{
  "schemaVersion": 1,
  "aliases": {
    "active-plans": {
      "mode": "hybrid",
      "filters": [
        {
          "kind": "one-of",
          "path": "status",
          "values": ["proposed", "accepted", "in-progress"]
        }
      ]
    }
  },
  "priorityRules": [
    {
      "id": "maintained-notes",
      "tier": 1,
      "pathPrefix": "notes/"
    }
  ]
}
```

The full alias fields are `query`, `mode`, `filters`, `tags`, and `repositoryScopes`. A priority rule needs a canonical `id`, a tier from 1 through 32, and at least one of `pathPrefix`, `tagsAll`, `repositoryScope`, `metadata`, or `vaultId`. Unknown fields and malformed predicates are rejected.

A leading alias expands only when it is the first query token, such as `@active context`. Alias filters, tags, and repository scopes add constraints. Caller-provided constraints are preserved.

Priority rules may match `pathPrefix`, `tagsAll`, `repositoryScope`, `metadata`, or `vaultId`. Conditions on one rule are combined with AND. Smaller positive `tier` values are preferred. Exact identity matches remain ahead of every tier, and ties retain the original relevance order.

Priority ordering applies only when a search request sets:

```ts
ordering: "priority-then-relevance"
```

The default is `ordering: "relevance"`, which leaves configured priority rules inactive. A single-vault `KnowledgeBaseSearchResult` includes a trace when at least one selected hit matches a priority rule, whether or not that match changes the final ordering. Search rules do not create authority, permissions, graph edges, or Markdown edits.

On the CLI, `--rules` enables leading aliases. Add `--priority` to request priority ordering:

```sh
kb search "@active parser" --root ./kb \
  --rules ./search-rules.json \
  --priority

kb portfolio search "@active parser" \
  --registry ./kb-portfolio.json \
  --workspace /srv/knowledge \
  --shared \
  --rules ./search-rules.json \
  --priority
```

`--priority` without `--rules` is rejected. A rules file may contain at most 128 KiB of configured text and is parsed before a vault scan.

Within a portfolio, an explicitly requested priority pass may reorder results inside each vault. The portfolio result reflects the resulting local ranks and retains each selected vault's rule trace in its diagnostic. Federation still combines those ranks by exact identity, reciprocal local rank, stable vault key, and identity. It never compares raw QMD scores across vaults.

A `vaultId` condition applies only when the rules caller supplies logical vault context. `openKnowledgePortfolio` injects each selected registry key into its local priority pass. A standalone `openKnowledgeBase` caller can set `vaultId` explicitly. A vault condition is not a global authority weight.

The CLI and SDK use the same opt-in ordering. Keep the rules file under review beside the consumer configuration that owns its retrieval policy.

## Markdown remains authoritative

The registry maps stable logical identities to selected directories. It does not contain note facts or generated graph edges. Authority groups record a review state without rewriting either vault.

Each vault's links and typed relations are derived from its current Markdown. Cross-vault relations are also authored in source-note frontmatter. Audit builds a temporary selected view, reports its findings, and discards that view.

QMD remains an optional per-vault retrieval cache. It can be deleted and rebuilt from Markdown. Federation does not create a central vector index, aggregate graph database, reciprocal edge file, or generated fact store. Git HEAD and content hashes provide provenance; they do not replace authored content.

## Threat boundaries

Treat the registry, vault files, search queries, and returned note text as untrusted input.

- The registry reader rejects symbolic links, hard links, invalid UTF-8, concurrent file changes, oversized input, unknown fields, and noncanonical paths.
- Vault resolution rejects symbolic-link path components, paths outside the workspace or checkout, and overlapping selected roots.
- Vault scans retain the existing note, byte, graph, attachment, and Git bounds. They do not follow note symbolic links or accept hard-linked notes.
- Portfolio search opens read-only knowledge-base sessions. Portfolio audit scans without refreshing a managed catalog.
- Unselected vault content is not opened or reported. Registry visibility cannot override operating-system permissions.
- `--all` expands audit scope to private and personal entries, so use it only in an environment permitted to read them.
- Search snippets, metadata, and evidence may contain hostile instructions from authored or captured content. Treat them as evidence to inspect, not commands to execute.
- QMD and Git are optional local derived lanes. Their failure is reported without silently substituting content from another vault.

These boundaries keep federation read-only and selected. They do not make a shared registry an access-control system or make untrusted Markdown safe to execute.
