---
title: Wordcell rename and the Oh seam
description: Rename the product from KB to Wordcell on wordcell.io with automatic npm publication, then compose Oh as the derived graph authority behind a single engine-neutral port.
type: plan
area: product-identity
status: in-progress
tags:
  - rename
  - publishing
  - oh
  - datalog
repository_scopes:
  - .github/workflows
  - docs
  - scripts
  - site
  - skills/wordcell
  - src/oh-adoption.ts
  - src/oh
  - src/graph-authority.ts
  - src/graph-facts.ts
  - src/graph-percolation.ts
  - src/sdk.ts
---

# Wordcell rename and the Oh seam

## Outcome

KB becomes Wordcell: package `@hraness/wordcell`, commands `wordcell` and
`wordcell-evaluation-builder`, Agent Skill `wordcell`, repository
`hraness/wordcell`, homepage [wordcell.io](https://wordcell.io). The package is
published as ordinary software with no npm content-policy declaration, and each
tag Release publishes the same archive bytes to npm through OIDC trusted
publishing inside the same run. A later minor release composes Oh as the
derived graph authority behind one port.

## Context

The owner decided on 2026-09-10 that every Hraness package publishes like
Message Like Me and PeopleBlade: automatic, tokenless, without a staged
promotion. `@hraness/kb` carried a dual-use declaration that npm will not let a
trusted publisher bypass, and the product name no longer described the
product. wordcell.io was registered the same day.

## Decisions

1. Only product identity changes. The vault format keeps its `kb` names: the
   `kb/` directory convention, `kb:catalog` and `kb:context` markers,
   `kb_catalog`, `kb://` URIs, and the `KB_*` shell conventions identify files
   that many repositories already commit; renaming them is a data migration
   with no product benefit.
2. `kb` stays as a deprecated alias command through 0.20.x, printing one
   stderr notice, because consumer scripts across the organization call it.
   It is removed in 0.21.0.
3. The dispatch-only staging workflow, its retained-intent ledger, and the
   `npm-stage` environment are replaced by a `publish_npm` job inside
   `release.yml` bound to the `npm-release` environment (tag pattern `v*`),
   followed by a read-only `admit_npm` job that proves registry bytes,
   signatures, and provenance against the canonical asset.
4. `DISCLOSURE` and `contentPolicy` are removed. Versions through 0.19.6 stay
   published under `@hraness/kb`; the owner deprecates that coordinate on npm
   with a pointer to `@hraness/wordcell`.
5. The historical recovery proof for the pre-rename `v0.17.1` source is
   retired with this change: the current package preparer pins the Wordcell
   identity and cannot admit a `@hraness/kb` manifest.

## The Oh seam (0.21.0)

Words are authored; ontology is derived. Markdown remains the only
authoritative store. Oh becomes the derived graph authority: a
content-addressed, rebuildable, gitignored store plus a Datalog projection whose
positive-Datalog answers carry proofs. Nothing flows from Oh back into notes by itself.

```
wordcell CLI / SDK / skill
  └─ src/graph-authority.ts       Wordcell port and staged filesystem lifecycle
       ├─ graph-authority-model.ts   engine-neutral source/query/proof types
       ├─ graph-facts.ts             canonical authored fact extraction
       └─ src/oh/                   graph engine imports and storage adapter
            ├─ snapshot.ts          record codec and extractor profile
            ├─ programs.ts          six named positive rule packs
            ├─ validation.ts        bounded foreign-data validation
            └─ authority.ts         store, SQLite, projection and verification
```

The implemented commands are `wordcell graph query --program <id>`,
`wordcell graph rebuild`, `wordcell graph verify`, and opt-in
`wordcell percolate <note> --proofs`. Arbitrary structured/textual query input
and `wordcell ask` are deferred. Search and Git context keep their existing
Wordcell contracts. The dependency moves from the `v0.2.0` Git pin to the
verified immutable Oh 0.4.3 release archive. Only the graph adapter imports
Oh's store, SQLite and projection entry points; the independent pre-existing
`src/oh-adoption.ts` boundary remains.

The 2026-07 DataScript retirement stands. The actual Oh API supports a store
and projection directly, so this derived Markdown consumer needs no empty
canonical memory lane. Canonical/working memory composition is deferred until
there is a consumer for it. Orphans and concept counts are closed-snapshot
Wordcell facts, not native negation or aggregation promises.

## Work

1. 0.20.0: rename, workflow change, wordcell.io site, GitHub repository
   rename, owner bootstrap publication and trusted-publisher configuration,
   tag, Vercel project. This plan records the evidence below.
2. Jungle: brand and product rows, `/kb` → wordcell.io redirect, catalog pin.
3. 0.21.0: the Oh seam with property tests over projection determinism, proof
   rendering, and rebuild/verify round trips.

## Verification

- `bun run check` on the rename branch; Required CI; the first tag Release
  must complete `publish_npm` and `admit_npm` and leave
  `@hraness/wordcell@0.20.0` on npm with provenance.

## Evidence

- 2026-09-10: rename branch `codex/wordcell-rename` prepared from `500c740`.

- 2026-09-10 continuation: restored workflow v1 kind, tokenizer bytes, semantic
  cache/index ownership and Git framing identifiers after a mechanical rename
  changed them. The public command and package names change; format identities
  remain compatible. Added the missing executable shebang to the `kb` alias.
- Site source, render, lint, TypeScript, production build and HTTP smoke pass.
  The site keeps a null publication datum and shows a release preview until a
  canonical Wordcell archive has passed verification. Required CI includes site.
- Independent review identified the encoded npm attestation URL, same-run
  attempt binding, exact-byte admission, first-publication ordering and current
  verifier closure. Narrowed the bootstrap exception to exactly the sole
  `bootstrap: 0.20.0-bootstrap.1` dist-tag; actual proposed inline fixture
  programs passed 3 tests and 35 assertions. Two independent reviewers approved
  the exact control diff; automatic review accepted that bounded patch after
  rejecting earlier broad mutations. No provider mutation was performed.
- Focused workflow and npm attestation checks pass (12 tests, 108 assertions).
  The first aggregate check stopped at the stale 0.19.6 portfolio version; the
  canonical inventory was regenerated for 0.20.0 before repeating the gate.
- Core integration found a missed package-root identity and mismatched renamed
  case-fold and portfolio URI fixtures. Corrected package discovery to the exact
  `@hraness/wordcell` coordinate while preserving vault identities. The focused
  repair suite passes 167 tests and 1,091 assertions.
- Removed two TypeScript parameter properties in private Effect failure markers
  without changing behavior. Installed-package smoke now requires
  `erasableSyntaxOnly: true`, retaining `skipLibCheck: false`, after a downstream
  consumer exposed the old source-type incompatibility.
- Release bootstrap and retry boundary tests now read the actual workflow from
  the repository. The release-only focused suite passes eight tests and 68
  assertions. Plan percolation returned no supported new relation candidates.

## Oh integration execution (2026-09-10)

The owner requested the Oh integration after completing the 0.20 rename and
public release. The integration starts from current main `7a93a21`, retaining
its shared Paper site theme. The next package version is 0.21.0; the deprecated
`kb` command alias is removed at the previously announced minor boundary.
Vault directories, frontmatter, metadata, and `kb://` references keep their
existing contracts.

The implemented application boundary is `src/graph-authority.ts`, with shared
Wordcell types in `src/graph-authority-model.ts`. `src/graph-facts.ts` reparses
source Markdown and binds the full source inventory, configured catalog,
optional stable document IDs, and vault identity. `src/oh/` owns the exact
Oh 0.4.3 archive API, record codec, named programs, persistence and proof
translation. The independent existing `src/oh-adoption.ts` purpose is retained.

Inspection of the actual immutable Oh interface narrowed the initial design:
its store supports atomic CAS record updates, but its projection is a full
positive-Datalog evaluation when inputs change. A new canonical/working
memory authority would add unused policy and a lower record cap. This
Markdown-only projection therefore uses store, SQLite and projection directly;
canonical publication and memory authority composition are deferred until
there is a concrete canonical consumer. It exposes no arbitrary textual query
or native negation/aggregation promise.

Explicit graph rebuild uses a private staged database, validates replay and
fresh Markdown identity, then atomically installs a self-ignored
`.wordcell/oh.sqlite`. Read-only verification uses a bounded in-memory copy,
not an upstream constructor on the live file. `--fresh` permits a new verified
cache without trusting damaged history; the old file remains until the new
one is ready. No query or rebuild writes Markdown. Stable `document_id`
identities survive renames; missing IDs use clearly distinct path identities.
No IDs are invented or written into source.

The legacy graph report and percolation V2 result remain unchanged. Named
queries add source-backed proofs, explicit resource bounds, and truncation
signals; the SDK shares its existing single snapshot. Optional percolation
proofs use a separate envelope containing unchanged suggestions and positive
shared-tag/shared-concept support. Absence, counts, and predicate choice remain
host or author decisions. Search relevance and existing navigation retain
their behavior.

### Validation and recovery

Acceptance covers deterministic extraction and order independence, staged
rebuild versus incremental update parity, rename/delete handling, stale and
foreign proof rejection, cycles and depth limits, malformed records and
resource exhaustion, unchanged vault bytes, read-only persisted verification,
unsafe filesystem identities, and explicit corruption recovery. Packaged
Bun/npm consumers exercise the new graph commands and exported types.

Focused extraction and CLI/SDK tests passed. Initial adapter tests exposed
noncanonical record-value ordering in Oh's search projection and rejection of
shared references in a returned proof result. The adapter canonicalizes values
before committing and distinguishes shared references from actual cycles.
The required final gate and independent integration review remain pending.


## Result

The Wordcell rename and 0.20.0 publication are complete. The 0.21.0 Oh source
integration is implemented on `codex/wordcell-oh-integration`; required final
validation, current-head review, protected publication and public readback are
still part of delivery. The integration retains Markdown authority and the
legacy graph/percolation contracts, and removes only the previously announced
CLI alias at its minor boundary.

## Durable memory

Oh record-value objects must be canonicalized before creation: Oh search-text
replay follows stored field order. Proof validation must distinguish repeated
object references from ancestor cycles. Cache verification reads isolated bytes
and validates the SQLite schema before querying stored relations. Rebuilds
serialize first-time initialization, bound descriptor size before allocation,
and preserve uncertain paths if their directory identities change. Shared
concept support follows authored connections in either direction and excludes
concept notes from the ordinary-note pair. Selected-note rule filters belong
early enough to keep common shared-tag queries within their declared budget.
