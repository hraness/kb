# Query the derived graph

Wordcell 0.21 adds named graph programs backed by the immutable Oh 0.4.3
library. Markdown is authoritative. Queries never add links or inferred
relationships to notes, and the existing `wordcell graph --json` report keeps
its format.

## Query without creating a cache

Use an exact extensionless note ID. The default query creates an in-memory
projection of a complete bounded Markdown snapshot and closes it afterward.

```sh
wordcell graph query --program backlinks --note notes/design --root kb --json
wordcell graph query --program reachability --note notes/design --depth 3 --root kb --json
wordcell graph query --program relation-closure --note notes/design --predicate depends-on --depth 3 --root kb --json
wordcell graph query --program scope-route --scope src --root kb --json
```

| Program | Returned columns | Meaning |
| --- | --- | --- |
| `backlinks` | `source`, `target`, `line`, `kind`, `predicate` | Incoming resolved contextual links and local typed relationships. |
| `reachability` | `source`, `target`, `depth` | Positive contextual and typed paths of lengths 1 through the requested depth. |
| `relation-closure` | `source`, `target`, `depth` | Positive local relationship paths using one exact predicate. |
| `scope-route` | `note`, `scope` | Exact authored `repository_scopes` declarations. |
| `shared-tags` | `note`, `other`, `tag` | Positive tag evidence shared with another note. |
| `shared-concepts` | `note`, `other`, `concept` | Positive evidence that two ordinary notes connect to the same concept, in either direction. |

Depth defaults to 3 and is bounded at 8. A cyclic path may return its starting
note; the same target at different lengths is a different row. External
`kb://` relationship targets remain external facts and never enter local path
closure. Broken and ambiguous links remain diagnostics in the existing graph
report. The configured catalog is excluded from graph relationships.

There is no arbitrary Datalog text evaluator. These reviewed named programs
use positive rules. Wordcell computes absence, orphans and counts from a
complete snapshot; an Oh proof does not prove that an authored claim is true.

## Rebuild and verify local state

```sh
wordcell graph rebuild --root kb --json
wordcell graph verify --root kb --json
wordcell graph query --program backlinks --note notes/design --root kb --persisted --json
```

Only rebuild writes `.wordcell/oh.sqlite` and its self-ignoring cache directory.
It serializes local rebuilds, applies changed records and deletions in a private
staging database, verifies replay, rechecks the Markdown revision, and atomically
installs the result. A failed build leaves the previous database in place.
The operation never edits Markdown or initializes a vault.

Verification and `--persisted` queries read a bounded copy into memory. They
reject a missing, stale, foreign or corrupt cache; they do not repair it or
create files. SQLite sidecars and symbolic or hard links are refused. Close any
foreign writer before retrying. To rebuild a damaged disposable cache from
Markdown, explicitly request a fresh database:

```sh
wordcell graph rebuild --fresh --root kb --json
```

The previous file stays in place until its replacement passes verification.
A fresh rebuild also removes accumulated derived history. Oh supports atomic
record updates, but its query engine evaluates the complete projection after
an input change. Equal source snapshots produce equal rows and source proofs;
history-bound projection identities can differ after a fresh rebuild.
In-memory projections use a fixed synthetic genesis time so identical snapshots
can reproduce and verify their proof results across sessions. That logical time
is never evidence of when a note was authored or an operation occurred.

## Inspect proof and limit information

Each result identifies the vault, exact source revision, named request,
projection digest, evaluated limits, rows, and supporting proof trees. Fact
proofs name the source note, its content digest and its exact Oh record digest.
Derived proofs name the applied rule and its premises. A declared `document_id`
retains record identity across renames; notes without one use an explicit path
identity. Wordcell never invents or writes IDs. Invalid or duplicate stable IDs
and invalid scope metadata stop extraction.

The graph boundary accepts at most 4,000 Markdown notes, 100,000 facts, and
64 MiB of source text; individual query atoms are bounded at 16 KiB. Queries
also have explicit row, work, derived-tuple, round, result-byte and proof
budgets. `--limit` sets the row limit up to 1,000. SDK callers can reduce each
budget. Work exhaustion fails instead of claiming a complete answer. Row or
proof truncation is retained in JSON and yields CLI exit code 4. Inspect
`truncated`, `proofsTruncated`, and proof truncation nodes before using a result
as complete evidence.

```ts
import { openKnowledgeBase } from "@hraness/wordcell";
const kb = await openKnowledgeBase({ root: "kb" });
try {
  const result = await kb.graphQuery({
    program: "reachability", note: "notes/design", depth: 3,
    limits: { rows: 100, workUnits: 500_000 },
  });
  console.log(result.revision, result.rows);
  console.log(await kb.graphVerifyResult(result));
} finally {
  await kb.close();
}
```

A session intentionally retains one read-only snapshot. Reopen the session
when Markdown changes. `graphVerifyResult` re-evaluates a bounded result
against that session and rejects modified, foreign or stale evidence; it does
not authorize writing any fact into Markdown. The lower-level graph API is
available at `@hraness/wordcell/graph-authority`.

## Add positive proofs to percolation

```sh
wordcell percolate notes/design --proofs --root kb --json
```

This opt-in result has kind `wordcell.graph-percolation`. `suggestions` retains
the existing percolation V2 candidates. `positiveSupport` contains separate
shared-tag and shared-concept query results, each with its own limits and
proofs. Missing concepts, absent edges, support counts, and predicate selection
remain Wordcell or author decisions. A positive shared tag does not establish
that two notes need a relationship. Read the cited Markdown before editing.

SDK callers use `kb.percolateWithProofs({ note: "notes/design" })` or
`percolateWithGraph(snapshot, options)` from
`@hraness/wordcell/graph-percolation`. No proof operation writes notes.
