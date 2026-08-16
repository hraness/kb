# Contents

- Plans record proposals, decisions, execution state, review findings, and verification evidence.

# Guidelines

- Keep future-facing coordination here and retain completed plans as history. Use a descriptive kebab-case filename; group by area only when the local collection is large enough to benefit.
- Start with `type: plan`, a kebab-case `area`, and one status from `proposed`, `accepted`, `in-progress`, `blocked`, `completed`, `superseded`, or `cancelled`. Add tags only as useful query facets.
- State the outcome, context, scope and non-goals, constraints and decisions, dependency-ordered work, verification, and recovery. Let small plans omit empty optional sections.
- Grow the same file during execution with decisions, deviations, review findings, and reproducible evidence. Do not create satellite progress or completion documents for one plan.
- Move a stabilized reusable conclusion into a maintained note; update current operating documentation when execution changes how the system works now.
- When a plan becomes completed, superseded, or cancelled, add non-empty `## Result` and `## Durable memory` sections. Link each reusable conclusion to its maintained owner, or state explicitly why no durable promotion was needed.
