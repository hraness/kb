# Contents

- `SKILL.md` – plan-authoring workflow for dependency-ordered phased execution.
- `agents/` – Codex UI metadata for discovering and invoking the skill.

# Guidelines

- Keep the plan format aligned with the companion `phase-orchestrator` contract.
- Require explicit scope, acceptance criteria, validation commands, dependencies, and status conventions for every phase.
- Keep examples portable and defer repository-specific commands and delivery policy to the target repository.
- Update `agents/openai.yaml` when the skill name, trigger, or default invocation changes.
