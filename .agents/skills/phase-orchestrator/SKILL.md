---
name: phase-orchestrator
description: Orchestrate phase-based implementation plans in Codex with dependency analysis, parallel sub-agent lanes, join gates, validation, review/fix loops, and final integration. Use when the user provides a plan, checklist, PRD, or phased task and explicitly asks Codex to execute it with phases, delegation, parallel agents, or orchestration in any repository.
---

# Phase Orchestrator

Execute a phased plan safely. Treat the plan as the source of scope and repository
instructions as the authority for tooling, validation, version control, and delivery.

## Rules

- Read applicable repository instructions and the complete plan before acting.
- Use `update_plan` for orchestration state. Keep at most one orchestration step
  `in_progress`; represent parallel lanes inside that step or as pending siblings until
  they join.
- Use Codex collaboration tools for bounded work: `spawn_agent`, `send_message`,
  `followup_task`, `wait_agent`, `interrupt_agent`, and `list_agents`.
- Record each agent id, task path, owned scope, and result. Resume the same agent with
  `followup_task` when continuity helps; use a fresh agent for independent review.
- Respect the active concurrency limit. Keep one slot for the root orchestrator; when
  four slots are available, run at most three worker agents concurrently.
- Run dependent work sequentially. Parallelize read-only work freely. Parallelize writers
  only with disjoint paths in one checkout or isolated worktrees/workspaces.
- Remember that Codex agents share the same filesystem. A prompt alone does not isolate
  writes; give every writer an explicit worktree path and ownership boundary.
- Preserve user-owned changes. Never revert, overwrite, stage, or commit unrelated work.
- Do not commit, push, open/modify PRs, merge, deploy, or make other external writes
  unless the user authorized them.
- Never rebase or amend a pushed branch, force-push, or use destructive VCS commands
  unless the user explicitly requested the exact operation.
- Follow repository policy over this skill.

## Orient

Before implementation:

1. Locate the repository root and read applicable `AGENTS.md`, contributor, workflow,
   writing, and delivery instructions.
2. Inspect VCS status, active branch/change, remotes when relevant, and existing changes.
3. Discover setup, focused checks, aggregate checks, generated-file policy, migrations,
   release/version rules, CI, review gates, and PR conventions.
4. Read the plan and supporting specification.
5. Capture the requested stopping point and authorization for commits, pushes, PRs,
   merges, or deploys.
6. Identify dependencies, write scopes, shared files, acceptance criteria, and validation.

Ask only when a missing choice materially changes the result or requires new authority.

## Build the orchestration graph

Convert the plan into a dependency DAG before spawning workers.

Classify each node:

- **Convergence**: shared contracts, schemas, migrations, barrels, integration, release.
  Run with one owner.
- **Parallel lane**: bounded work with independent inputs and disjoint writes.
- **Join gate**: integrate lanes and prove cross-lane contracts before downstream work.
- **Validation/review**: read-heavy work that may run concurrently after a stable diff.

For every parallel fan-out, record:

- prerequisites and join gate;
- owned directories/files per lane;
- shared files deferred to the integration owner;
- focused validation and required evidence;
- whether isolation needs Git worktrees or jj workspaces.

Do not parallelize unresolved shared-interface design. Freeze the shared contract first,
then fan out. Prefer this shape:

```text
contract phase
  ├─ independent lane A
  └─ independent lane B
          ↓ join gate
  ┌───────┼───────┐
lane C  lane D  lane E
  └───────┼───────┘
       final join
```

Update the plan document when orchestration changes are part of the user's request.

## Prepare parallel writers

Use the repository's documented isolation mechanism. For Git worktrees:

1. Start from the intended feature base.
2. Create one `codex/` topic branch and worktree per concurrent writer.
3. Tell each agent its absolute worktree path and require every command to use it.
4. Keep shared barrels, manifests, lockfiles, generated indexes, docs, and version files
   with the integration owner unless one lane explicitly owns them.
5. Integrate completed lane commits into one feature branch without rewriting pushed
   history.
6. Prove intended commits are contained in the integration tip before cleanup.

If writers operate in one checkout, allow only disjoint paths and tell agents that edits
are immediately visible to every worker. Stop the fan-out if overlapping edits appear.

## Execute each phase

### 1. Orient the phase

- Re-read its criteria, prior results, current status, and owned paths.
- Confirm prerequisites and isolation.
- Mark the phase or fan-out orchestration step `in_progress`.

### 2. Delegate bounded implementation

Spawn workers only for concrete independent tasks. Include the plan path or relevant
excerpt, repository rules, acceptance criteria, worktree, ownership, validation, existing
changes, and commit policy. Do not assume workers infer parent-only context.

Continue useful root work while agents run. Send concise commentary updates at least once
per minute during long operations.

### 3. Inspect and validate

For each worker result:

- inspect its summary, status, diff, changed files, validation, deviations, and blockers;
- independently inspect the focused diff and repository status;
- run the smallest repository-documented checks that establish lane correctness;
- use `followup_task` for bounded corrections.

Do not silently replace a blocked check with a weaker one. Record the command, blocker,
and risk.

### 4. Join

At a join gate:

1. Wait for every required lane.
2. Integrate all completed work into the feature tip.
3. Prove no intended lane commit or file remains outside it.
4. Resolve shared files once through the integration owner.
5. Run contract and cross-lane tests, then aggregate focused checks.
6. Freeze the next shared interface before another fan-out.

Do not advance because each lane passes alone. The join gate proves composition.

### 5. Review and fix

After implementation and initial validation, spawn a fresh reviewer with the phase diff,
criteria, repository rules, and validation evidence. Ask it to patch bounded issues, avoid
commits unless authorized, and report a clear no-op when clean. Re-run affected checks.

### 6. Finalize the phase

Record:

- Done, Partial, or Blocked;
- behavior and changed areas;
- validation commands/results;
- review result;
- commit/change ids when authorized;
- deviations, downstream changes, risks, and manual checks.

## Whole-feature pass

After requested phases complete:

1. Integrate every lane into one feature tip or working tree.
2. Prove no worker output was omitted.
3. Run repository-appropriate aggregate validation.
4. Spawn a fresh final reviewer against the complete diff.
5. Validate final fixes.
6. Deliver only to the user's authorized stopping point.
7. Follow repository-specific PR, CI, readiness, merge, and deployment workflows.

Respect partial stopping points. Do not implement or review future phases the user did not
request.

## Worker prompt

```text
Implement {phase_or_lane} in {absolute_worktree_path}.

Context:
- Plan: {plan_path_and_relevant_scope}
- Acceptance criteria: {criteria}
- Dependencies/prior results: {summary}
- Repository rules: {rules}
- Validation: {commands}
- Existing user-owned changes: {summary}

Ownership:
- Own only {paths_or_modules}.
- Defer {shared_files} to the integration owner.
- Other agents may be working concurrently. Do not revert or overwrite their work.

Task:
- Implement only this lane.
- Report evidence that invalidates the plan and its downstream impact.
- Commit policy: {policy}. Do not commit unless explicitly delegated.

Return:
- Behavior and changed files.
- Validation and exact results.
- Deviations, blockers, risks, and integration notes.
```

## Review prompt

```text
Review and fix {scope} in {absolute_worktree_path}.

Context:
- Plan/criteria: {context}
- Diff scope: {diff}
- Repository rules: {rules}
- Validation so far: {results}
- Commit policy: {policy}

Review correctness, criteria, repository conventions, security, data ownership,
migrations, tests, and integration boundaries. Patch concrete bounded issues. Do not
commit unless delegated. Report fixes or a clear no-op, validation, and residual risks.
```

## Completion standard

Complete the run only when:

- every requested phase has a terminal status;
- every intended worker result is integrated;
- join gates and aggregate checks have recorded results;
- review fixes are validated;
- no unauthorized external writes occurred;
- the final report states exact repository, branch/worktree, validation, and remaining
  risk.
