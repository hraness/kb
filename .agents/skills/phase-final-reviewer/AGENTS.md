# Contents

- `SKILL.md` – end-to-end review contract for a completed multi-phase feature.
- `agents/` – Codex UI metadata for discovering and invoking the skill.

# Guidelines

- Review the complete feature across phase boundaries against the plan and governing specification.
- Preserve the fixed result contract, evidence requirements, and default prohibition on commits.
- Patch only safe concrete issues; return architectural, authority-sensitive, or scope-expanding findings to the parent orchestrator.
- Update `agents/openai.yaml` when the skill name, trigger, or default invocation changes.
