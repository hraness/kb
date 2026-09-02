# Contents

- `SKILL.md` – public entrypoint, runtime contract, and intent router for all hraness/kb agent workflows.
- `references/query.md` – scoped retrieval through exact metadata, hybrid search, graph structure, and Git provenance.
- `references/customize.md` and `companion-skills.md` – interview-first KB setup, explicit approval boundaries, and contracts for optional recurring rituals.
- `references/save-url.md`, `url-authentication.md`, and `url-platforms.md` – auditable web capture, signed-in source handling, and platform-specific completeness boundaries.
- `references/save-pdf.md` and `pdf-review.md` – PDF ingestion, OCR, image evidence, and mixed-media review.
- `references/plan.md` and `plan-structure.md` – durable plan authoring and its adaptable Markdown contract.
- `references/percolate.md` and `refresh.md` – evidence-backed graph edits, catalog maintenance, and vault validation.
- `templates/companion-skill.template.md` – inert, copyable starting point for an approved companion skill.
- `agents/openai.yaml` – user-facing skill metadata and invocation prompt.

# Guidelines

- Keep `kb` as the only public skill entrypoint. Preserve substantial workflows as focused references and keep the router compact enough to load by default.
- Keep discovery language grounded in real user requests for knowledge bases, coding-agent memory, Markdown or Obsidian vaults, source capture, repository context, plans, and knowledge graphs. Exclude generic research, PDF reading, and planning outside hraness/kb.
- Invoke the installed `kb` CLI without depending on a source checkout. Check for an existing command first, require Bun when installation is needed, and pin installation to the current immutable repository tag.
- Never initialize or mutate a vault as part of skill or CLI installation.
- Route setup, evolution, and custom-ritual requests before runtime discovery. Keep inspection non-mutating until the exact proposal is approved, and never treat skill discovery or an ambient account as authority.
- Keep Markdown authoritative. Preserve incomplete source boundaries, read cited evidence before graph edits, and never generate reciprocal, inferred, transitive, or similarity-derived relationships.
- In parallel managed-catalog work, defer refresh to the integrating agent and use the catalog-skipping check in each edit lane. Authored-catalog refreshes leave the front door unchanged.
- Update `agents/openai.yaml`, README installation text, package inventory checks, and the pinned CLI tag together when the skill identity or package release changes.
