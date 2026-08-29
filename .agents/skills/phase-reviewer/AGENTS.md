# Contents

- `SKILL.md` – independent review-and-fix contract for one implemented phase.
- `agents/` – Codex UI metadata for discovering and invoking the skill.

# Guidelines

- Keep this role independent from the phase implementer and bounded to the assigned phase.
- Preserve the fixed result contract, evidence requirements, and default prohibition on commits.
- Patch only concrete low-risk findings inside the delegated scope; return broader findings to the parent orchestrator.
- Update `agents/openai.yaml` when the skill name, trigger, or default invocation changes.
