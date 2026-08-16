# Contents

- `phase-orchestrator/` – portable phased execution with Codex collaboration agents and explicit join gates.

# Guidelines

- Keep portable repository-support workflows under `.agents/skills/`; keep the six canonical public KB workflows under the root `skills/` package directory.
- Do not duplicate, wrap, or fork the package-owned KB skills here. Their repository and packed copies must remain byte-identical.
- Keep trigger descriptions precise and orchestration instructions portable across independently versioned repositories.
- Update a skill's metadata and directory guide when its trigger, resources, or default invocation changes.
- Validate changed skill folders with the installed Codex skill validator when available.
