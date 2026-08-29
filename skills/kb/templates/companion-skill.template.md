---
name: replace-with-skill-name
description: Replace with the recurring KB request that should select this skill.
---

# Replace with the skill title

## Use when

State the exact recurring KB request that this skill owns.

## Do not use when

Route generic query, capture, plan, percolation, refresh, and validation work
to the public `kb` skill. State any additional exclusions that prevent an
unsafe or ambiguous match.

## Inputs and preconditions

List required inputs, existing state, commands, and authorization. Do not
install, probe an account, create a cache, or mutate state while resolving
these preconditions.

## Surfaces and authority

List every filesystem, repository, application, account, network, and
integration surface this workflow may read or write. Discovery and an existing
session grant no authority. The setup scaffold writes filesystem targets only;
describe any later external action as a separate runtime request with its own
proposal, approval, capable tool, and result.

## Approval

Name the exact write targets and effects. State when existing user
authorization applies and which proposal changes require renewed approval.

## Workflow

Describe the smallest deterministic sequence that produces the approved
result. Keep every effect inside the approved boundary.

## Idempotence, retries, and failure

Treat matching output as a no-op. Stop on divergent existing content, path
escape, symbolic links, partial writes, or an unapproved surface. Do not
silently retry or overwrite.

## Durable outputs and provenance

Name the files or records that persist, the evidence they retain, and their
authority. Exclude credentials, tokens, cookies, session data, and unrelated
ambient context.

## Verification

Name the narrow checks that demonstrate the approved result and the KB
maintenance required after durable edits.
