# Contents

- `index.md` – the vault front door and deterministically refreshed note catalog.
- `articles/` – self-contained source captures with local attachments and capture metadata.
- `notes/` – maintained concept, entity, comparison, and synthesis notes.
- `plans/` – proposed through completed design and implementation plans.
- `riffs/` – cleaned first-person notes made from dictated or stream-of-consciousness source material.
- `scopes/` – optional pull-based context hubs mapped to selected repository `AGENTS.md` guides.

# Guidelines

- Treat this directory as one Git-backed, Obsidian-compatible Markdown vault.
- Use vault-root wikilinks without `.md`, such as `[[notes/context-engineering|context engineering]]`.
- Put links in explanatory prose when they carry part of the argument. Do not add bare reciprocal links to improve graph counts.
- Keep reusable concepts as ordinary notes with `type: concept`. Store typed outbound assertions under `relations` with lower-kebab-case predicates and exact vault-root target IDs; ground each assertion in prose or evidence.
- Never write reciprocal, transitive, similarity-derived, or otherwise inferred relationships into notes. Backlinks, graph traversal, and percolation candidates are disposable views.
- Preserve source authority: article bodies are captures, riffs retain the speaker's claims, and maintained notes own later synthesis.
- Keep `AGENTS.md` normative and concise without removing load-bearing rules. A scope hub may hold rationale, history, examples, and linked decisions, but never silently overrides a guide or becomes the only home of an edit-time rule.
- Run `kb percolate <changed-note> --root .` after materially changing a note, review the cited evidence, then run `kb refresh --root .` and `kb check --root .`.
- During parallel edits, each lane runs `kb check --root . --no-catalog`; the integrating agent performs one final refresh and normal check.
- Use `kb context <path> --root . --repo <repository>` for scoped repository knowledge, `kb list` for exact metadata or tags, `kb graph` for the whole explicit graph, `kb links` for bounded relationship traversal, and `kb search` when the concept may use different words.
