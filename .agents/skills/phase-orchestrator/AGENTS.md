# Contents

- `SKILL.md` – portable Codex workflow for executing phased implementation plans with delegated lanes and join gates.
- `agents/` – Codex UI metadata for discovering and invoking the skill.

# Guidelines

- Keep orchestration instructions specific to Codex collaboration tools and defer repository commands, validation, version control, and delivery authority to the repository's own guides.
- Preserve the root agent as the owner of shared interfaces, convergence files, integration, validation, and delivery.
- Keep repository-owned execution plans in `kb/plans/`; use lane-safe KB checks during fan-out and the refresh-check workflow at integration.
- Update `agents/openai.yaml` when the skill name, trigger, or default invocation changes.
