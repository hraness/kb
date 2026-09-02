# Percolate concepts and relationships

Keep the graph authored, local, and reviewable. `kb percolate` proposes
candidates from deterministic evidence; it never changes a note. Backlinks,
graph reports, and QMD results are derived views, while Markdown remains the
authority.

## Locate the vault

- Resolve `<vault>` to the directory containing its authored or managed
  `index.md` front door.
- Read the applicable repository and vault instructions before editing.
- Pass the resolved path to every `--root`.
- Identify the note or small neighborhood changed by the current task. Prefer a
  bounded review to a vault-wide cleanup during parallel work.

## Inspect candidates

Run percolation on the changed note when possible:

```sh
kb percolate notes/example --root "$KB_ROOT" --limit 25 --json
```

Run it without a note only when reviewing the whole vault:

```sh
kb percolate --root "$KB_ROOT" --min-support 2 --limit 50 --json
```

Treat each result as a prompt to open the cited notes and read the relevant
prose. Candidate kinds may include:

- a recurring tag with no maintained `type: concept` note;
- notes that share a concept or tag but have no explicit relationship;
- an exact title or alias mentioned without a contextual link;
- a self, reciprocal, malformed, broken, or ambiguous authored relationship.

For missing relationships, `support` counts independent shared tags or concept
neighbors; the evidence array shows the participating notes. The default
minimum of two therefore requires two shared signals, not merely both endpoints
of one tag match. Other candidate kinds count their natural unit: supporting
notes, mention occurrences, or authored hygiene evidence.

Percolation Result V2 reports a missing relationship as an unordered pair of
endpoints with `predicate: { "kind": "required" }`. The output does not choose
which note owns the assertion, its direction, or its predicate. In particular,
it never inserts `related-to` as a fallback. Read both notes and their evidence,
then choose a source, target, and predicate only when the prose establishes that
claim. Historical unversioned V1 results may contain a suggested predicate;
parse them through the explicit V1 compatibility surface and do not treat that
suggestion as an authored fact or silently upgrade it to V2. V1 remains
available through the 0.19 release line and is not removed before 0.20.0.

For a missing concept, use `suggestedId`. When `collidesWith` is non-null, the
natural ID is already an ordinary note, so KB chooses an unoccupied
`*-concept` ID. Read the occupied note before deciding whether to create the
suggested concept or promote and improve the existing note instead.

Semantic search may help discover evidence, but similarity is never enough to
author an edge.

## Promote durable concepts

Create a concept only when the idea is likely to be reused and its definition
can be stated from the source material:

```sh
kb note create notes/local-first \
  --root "$KB_ROOT" \
  --title "Local-first" \
  --type concept \
  --tag architecture \
  --body '# Local-first

A concise reviewed definition grounded in the cited notes.'
```

Write a concise definition and cite or link the notes that establish it.
Concepts are ordinary Markdown notes, so they can carry aliases, evidence,
context, and their own outbound relationships. Do not create a concept merely
to mirror every tag.

After promotion, rerun percolation on the cited non-concept notes. The new
concept may support relationships among its neighbors even when a run scoped to
the concept itself has no candidate:

```sh
kb percolate notes/write-path --root "$KB_ROOT" --limit 25 --json
```

## Author typed relationships

Add a relationship from the note that owns the assertion:

```sh
kb relation add notes/write-path supports notes/durable-agent-memory \
  --root "$KB_ROOT"
```

Use a specific lower-kebab-case predicate. Recommended predicates for common
KB evidence and maintenance claims are:

- `synthesizes` when the source combines and maintains conclusions from the
  target material;
- `evidenced-by` when the target directly supports a claim in the source;
- `informed-by` when the target influenced the source without serving as its
  direct evidence;
- `supersedes` when the source deliberately replaces the target as the current
  account;
- `contradicts` when the source records a supported incompatible claim.

This vocabulary is advisory. A vault may use any canonical custom predicate
whose meaning its prose establishes. Do not assign a recommended predicate by
directory, note type, shared tags, chronology, or similarity alone. A local
target is an exact vault-root note ID without `.md`. A reviewed cross-vault
target is its stable qualified identity, such as
`kb://hraness/kb/document-id`; never use a checkout path as cross-vault
identity. Ground the assertion in nearby prose or evidence; the frontmatter is
an indexable statement, not a substitute for explanation.

List or remove relationships without editing reciprocal notes:

```sh
kb relation list notes/write-path --root "$KB_ROOT" --json
kb relation remove notes/write-path supports notes/durable-agent-memory \
  --root "$KB_ROOT"
```

Never write inverse edges, generated backlinks, inferred transitive
relationships, reciprocal edges, similarity-derived relationships, or
semantic-search scores into Markdown. External or unclassified material is
outside this vocabulary evaluation and remains unresolved. Those are derived
views or review work.

The interview-first setup and relationship-review pattern builds on Frank
Chen's public notes about [designing a personal knowledge base with an
agent](https://gist.github.com/fxchen/773397095d7a6bffda621e4237da0da9)
and [extending it with skills](https://gist.github.com/fxchen/09cb410b22c9c5256d80243ee925b57e).

## Query before concluding

Use exact structure to verify that the promoted graph says what the prose says:

```sh
kb links notes/write-path --root "$KB_ROOT" --direction both --depth 2 --json
kb relation list notes/write-path --root "$KB_ROOT" --json
kb graph --root "$KB_ROOT" --json
```

Prefer the note-scoped commands first. Use the whole-vault graph only when the
question spans several neighborhoods, and confirm returned IDs against their
Markdown notes before reporting a conclusion.

## Finish under the vault's catalog mode

When working alone or integrating several lanes:

```sh
kb refresh --root "$KB_ROOT"
kb check --root "$KB_ROOT"
```

When several agents are editing different notes in a managed-catalog vault,
each lane should validate authored structure and local attachments without
rewriting the shared catalog:

```sh
kb check --root "$KB_ROOT" --no-catalog
```

The integrating agent runs one final managed refresh and normal check. In an
authored-catalog vault, refresh and check leave the front door untouched, while
`kb catalog --root "$KB_ROOT"` renders an exhaustive disposable inventory.
Resolve same-note Git conflicts from the prose and evidence; do not accept one
side's frontmatter mechanically.
