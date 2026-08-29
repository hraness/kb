# Contents

- `SKILL.md` – parent workflow for delegated phased implementation, validation, review, and integration.
- `agents/` – Codex UI metadata for discovering and invoking the skill.
- `LICENSE` and `UPSTREAM.md` – license and pinned provenance for the complete five-skill pack.

# Guidelines

- Keep the orchestrator aligned with `write-phase-plan`, `phase-implementer`, `phase-reviewer`, and `phase-final-reviewer`.
- Preserve the parent agent as the owner of phase state, repository policy, shared integration, validation, commits, and delivery.
- Keep host-specific tool names conditional and defer repository commands and authority to the target repository's guides.
- Update `agents/openai.yaml` when the skill name, trigger, or default invocation changes.
