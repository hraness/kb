# Changelog

## 0.21.1

Improves the README quick start, npm and Agent Skill discovery, and the shared site presentation. CLI, SDK, graph proofs, and vault formats retain their 0.21.0 behavior.

### Upgrade to v0.21.0

Version 0.21.0 adds a rebuildable Oh graph, named positive-rule queries with
source proofs, read-only cache verification, and opt-in percolation proofs.
See [the graph guide](docs/graph-authority.md) for commands, resource limits,
revision identity, and cache recovery. Existing graph reports, percolation V2,
search ranking, vault formats and `kb://` identifiers stay compatible.

The deprecated `kb` command alias is removed as announced in 0.20.0. Update
scripts to invoke `wordcell`; existing pinned 0.20.x installations retain the
alias. No Markdown or document-ID migration is required.

### Upgrade to v0.20.0

Version 0.20.0 renames the product from KB to Wordcell. The package is
`@hraness/wordcell`, the commands are `wordcell` and
`wordcell-evaluation-builder`, the Agent Skill is `wordcell`, and the homepage
moved from hraness.com to [wordcell.io](https://wordcell.io). The `kb` command
stays as a deprecated alias that prints one notice; it is removed in 0.21.0.
The vault format keeps its `kb` names, so existing vaults need no migration.
The package is published as ordinary software with no npm content-policy
declaration, and each tag Release now publishes the same archive bytes to npm
automatically through OIDC trusted publishing. Versions through 0.19.6 remain
available under `@hraness/kb`.

### Upgrade to v0.19.6

Version 0.19.6 adopts the upstream Sweet Cookie 0.4.3 registry package in place
of the Hraness 0.4.4 fork. Upstream includes the cookie-scope, isolation, and
explicit Chromium Keychain fixes. Capture retains host-only and Domain cookie
scope, rejects partitioned or container state it cannot replay, and keeps
explicit browser selection bound to its profile. The local cookie guards and
synthetic provider regressions remain in place.

### Upgrade to v0.19.5

This candidate corrects draft asset URL admission before the first canonical
GitHub package release. GitHub may expose a temporary same-repository URL until
the draft is published; published assets still require their exact versioned
URLs and verified bytes. The failed `v0.19.4` draft is retained as release
evidence and is not an installable release.

GitHub Releases become the canonical installation source. Each release binds its packed archive to the reviewed source and signed GitHub build identity. npm remains an optional mirror and older installations keep working. The SDK and CLI interfaces do not change.

### Upgrade to v0.19.3

Version 0.19.3 gives workflow execution and single-note publication complete
Effect owners behind their existing Promise APIs. Native callbacks and writes
remain owned until they settle. In particular, a failed directory sync now
joins its admitted sibling before recovery releases the note lock. Workflow
ordering, concurrency bounds, exact public errors, revision checks and
no-clobber recovery remain compatible. Effect 3.22.1 is an exact runtime
dependency; consumers do not need to create an Effect runtime or change calls.

### Upgrade to v0.19.2

Version 0.19.2 recognizes npm 11.19's `signedAccessSignatureUrl` attestation
wrapper field only when it is the currently evidenced empty string. Exact-key,
signature, package, workflow, source, and provenance verification remain
mandatory. Package runtime behavior is unchanged.

### Upgrade to v0.19.1

Version 0.19.1 updates the pinned Hraness Sweet Cookie fork to v0.4.4. Cookie
ingestion now rejects records marked `partitionKeyOpaque: true` even when
`partitionKey` is missing or null. If every selected inline cookie has
unsupported isolation provenance, Sweet Cookie returns no cookies instead of
falling back to browser stores. Explicit `partitionKeyOpaque: false` remains
replayable, while malformed marker values fail closed.

### Upgrade to v0.19.0

Version 0.19.0 adds interview-first setup and evolution guidance, a bounded
filesystem-only companion-skill scaffold contract, and Percolation Result V2.
V2 requires an explicit predicate and leaves relationship ownership and
direction to review. The release does not add lifecycle metadata, a resolver,
a lifecycle CLI, inferred edges, or automatic account and network actions.

### Upgrade to v0.18.1

Version 0.18.1 restructures the public README and hosted projection around one
durable note, the exact recovery workflow, inspectable retrieval signals, and
explicit authority boundaries. Runtime APIs and package behavior are
unchanged.

### Upgrade to v0.18.0

Version 0.18.0 adds a review-only adoption seam for exact dependency closures
from an Oh working authority. Trusted host code creates a
`createOhAdoptionPreparerV1` facade with the expected binding and head,
destination, rights clearance, review route, and conflict policy. The narrow
`prepare` call accepts only a capsule plus transformation and redaction
disclosures, returns deeply immutable deterministic Markdown and manifest
bytes with status `prepared`, and has no vault, Git, Oh-store, or promotion
capability. Wordcell pins `@hraness/oh` v0.2.0 and delegates closure integrity to its
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
- `createNote` and `wordcell note create` now assign `document_id` to new ordinary
  notes. Preserve that ID across renames and update snapshots that intentionally
  assert the generated frontmatter.

Existing Markdown is not rewritten automatically. Add IDs to maintained legacy
notes only through reviewed edits, and keep every QMD, graph, portfolio, and
audit projection disposable.
