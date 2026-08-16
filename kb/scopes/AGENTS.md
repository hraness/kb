# Contents

- `*.md` – optional deterministic agent-context hubs mapped reciprocally to repository `AGENTS.md` guides.

# Guidelines

- Keep one hub per exact repository-relative directory scope, with `type: agent-context` and `scope` in frontmatter.
- Derive the canonical hub path and reciprocal marker with `kb agents identity <scope>`; do not reproduce the slug or hash logic by hand.
- Put rationale, history, examples, evidence, and links here. Keep ownership, prohibitions, required commands, and every rule needed before editing in the guide.
- Use `kb agents check --root <vault> --repo <repository>` after changing a mapping; use `kb agents audit` to review guide and inherited-chain size without treating length as correctness.
