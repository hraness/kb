# Contents

- `SKILL.md` – bounded worker contract for implementing one plan phase.
- `agents/` – Codex UI metadata for discovering and invoking the skill.

# Guidelines

- Keep this role scoped to one parent-assigned phase and its explicit write boundary.
- Preserve the fixed result contract and default prohibition on commits unless the parent delegates commit authority.
- Defer plan state, shared integration, cross-phase decisions, and delivery to the parent orchestrator.
- Update `agents/openai.yaml` when the skill name, trigger, or default invocation changes.
