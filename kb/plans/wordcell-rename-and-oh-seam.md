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
  └─ src/graph-authority.ts   engine-neutral port: Fact, Program, Row, Proof
       └─ src/oh/              the only module that imports @hraness/oh
            ├─ profile.ts      Wordcell application profile digest → store profile
            ├─ codec.ts        note → edition:note/<document_id> record
            ├─ projection.ts   fact extractor: wordcell.note, .link, .relation, .tag, .scope
            ├─ programs.ts     positive rule packs: backlinks, bounded reachability,
            │                  scope-route, relation-closure
            └─ authority.ts    memory authority wiring; working store at
                               .wordcell/oh.sqlite, rebuilt from Markdown; explicit
                               empty canonical store and pinned head initially
```

Proposed command syntax (not shipped): `wordcell graph query --program <id>`, `wordcell ask`
(bounded structured positive-Datalog query AST; textual syntax is undecided), `wordcell graph rebuild`, `wordcell graph verify`;
`wordcell percolate` candidates gain proof evidence. Search and Git context stay
on Wordcell's side and rejoin Oh records by `recordSha256`. The dependency
moves from the `v0.2.0` Git pin to the immutable 0.4.3 release archive and
touches only the `store`, `sqlite`, `projection`, and `memory` entry points.
The 2026-07 DataScript retirement stands; Oh may run as an imported library in
the same Bun process. Oh requires a canonical store and pinned head even when
Wordcell has no promoted content: the initial adapter supplies an explicit
empty canonical lane. Orphans and concept counts are closed-snapshot facts
derived by Wordcell or deferred, not native negation or aggregation promises.

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
