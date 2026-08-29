# Contents

- `write-phase-plan/` – dependency-ordered plan authoring with explicit acceptance and validation criteria.
- `phase-orchestrator/` – parent workflow for delegated phased execution, integration, and delivery.
- `phase-implementer/`, `phase-reviewer/`, and `phase-final-reviewer/` – bounded implementation, independent phase review, and end-to-end review workers.

# Guidelines

- Keep portable repository-support workflows under `.agents/skills/`; keep the single canonical public KB skill and its focused references under `skills/kb/`.
- Do not duplicate, wrap, or fork the package-owned KB skill here. Its repository and packed copies must remain byte-identical.
- Keep trigger descriptions precise and orchestration instructions portable across independently versioned repositories.
- Update a skill's metadata and directory guide when its trigger, resources, or default invocation changes.
- Validate changed skill folders with the installed Codex skill validator when available.
