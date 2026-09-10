---
title: Effect workflow and note publication owners
description: Preserve workflow and note publication contracts while joining every admitted native operation before cleanup.
type: plan
area: runtime-ownership
status: in-progress
tags:
  - effect
  - workflows
  - authoring
repository_scopes:
  - src/workflow.ts
  - src/workflow-model.ts
  - src/workflow-platform.ts
  - src/workflow-program.ts
  - src/workflow-runtime.ts
  - src/authoring.ts
  - src/authoring-model.ts
  - src/authoring-platform.ts
  - src/authoring-program.ts
  - src/authoring-runtime.ts
  - scripts/check-effect-policy.ts
---

# Effect workflow and note publication owners

The workflow scheduler and single-note publication transaction now have native Effect owners behind their existing Promise APIs. Focused causal tests and source review cover both implementations. Final package/generated validation, repository integration, pull-request checks and delivery remain pending, so this plan stays in progress.

## Scope and ownership

The public boundaries remain `src/workflow.ts` and `src/authoring.ts`. Each invokes one finite product-local runtime. The respective model files preserve pure definitions and policy, platform files expose native operations, and program files own admission, settlement and cleanup. Callers do not supply Effect services or a runtime.

The existing NoteLock provider, read-only note APIs, graph/retrieval policy, QMD implementation and capture publication remain outside this change. Effect 3.22.1 is an exact runtime dependency under the existing external-package build convention. Direct's immutable checker edition 1.5.0 remains development source; Wordcell owns the explicit local role map. These boundaries follow [[notes/repository-seams|Repository seams]].

## Workflow compatibility

`src/workflow-program.ts` owns DAG admission, resource occupancy, failure selection, native callback drain, definition-order projection and output revalidation. It removes the old Promise scheduler and duplicated occupancy counters. Node limits, global concurrency, Git limits and QMD serialization remain unchanged.

`src/workflow-platform.ts` retains the original callback Promise chain and native Promise.race ordering. Already-settled ties and callback microtasks affect observable behavior; an Effect fiber race would not establish the same winner. Each admitted callback remains owned until its actual settlement. Selecting failure prevents pending and dependent callbacks from starting, while late failures cannot replace that selection.

The original last-callback behavior is preserved: a callback that ignores abort and succeeds can still complete the workflow successfully. Listener removal remains a required finally operation; its failure supersedes the body exactly, including undefined, null, zero, false and Error reasons. The private runtime projection prevents FiberFailure from replacing the original public error.

## Publication and the observed lifetime correction

`src/authoring-program.ts` owns lock acquisition, temporary descriptor lifetime, native write/sync/close, source quarantine, no-clobber installation, durability, recovery and cleanup. Existing path confinement, inode/device/link checks, revision comparisons, YAML transformations and recovery primitives retain their original declarations. Compatible creates and relation no-ops leave existing bytes and inode identity unchanged.

A real-filesystem baseline exposed premature release: after one of two directory syncs rejected, the original transaction released its lock while the sibling still held a native descriptor. The native adapter now keeps the original Promise.all failure selection and joins both admitted syncs before recovery or release. It also captures a synchronous injected admission failure without abandoning an already-started sibling.

Failure selection remains phase-specific. Fallback temporary-handle close is observed but suppressed; temporary cleanup supersedes the body; outer lock release supersedes both. A later durability or temporary-unlink error does not authorize overwriting an already visible replacement. Displaced bytes remain available at the existing recovery path when safe restoration is impossible. No retry, new cancellation API or timeout is added.

## Execution and verification

1. Workflow implementation and independent source review are accepted. Focused workflow and bundled-workflow tests passed 37 cases and 1,641 assertions, including 64 generated schedules. The explicit test parameter type then passed its 19-case causal replay and broad compiler check.
2. Publication's original native baseline passed seven cases and failed the expected premature-release case. The direct observation was lock release while sibling sync remained pending; the test failed before asserting the competing lock result. The migrated focused suite passed 46 cases and 310 assertions, including the same native lifetime seam, synchronous second admission failure, cleanup precedence, held acquisition and preservation of visible bytes.
3. The local architecture policy and all 13 canonical checker tests passed with 146 assertions. The first combined compiler run found only two unused extracted imports; those imports were removed. The compiler rerun then passed with the combined workflow, authoring and checker source.
4. The integration owner must regenerate distribution files, inspect the package source closure, run the unchanged required repository gate, complete Wordcell maintenance, and deliver through current-head pull-request checks. Focused evidence does not replace those gates.

Reproducible focused commands from the repository root are:

```sh
bun test ./src/workflow.test.ts ./src/workflow-lifecycle.test.ts ./src/workflow-schedule.property.test.ts ./src/workflows/workflows.test.ts
bun test ./src/authoring.test.ts ./src/authoring-lifecycle.test.ts ./src/note-lock.test.ts
bun run check:effect
bun run typecheck
```

On managed Hraness machines, route broad compiler work and native custody/recovery tests through the installed absolute host scheduler as required by root AGENTS. The regression and property tests are the maintained executable evidence. No token-use, coding-model, latency or retrieval-quality benefit was measured.

## Recovery and remaining work

The public interfaces are unchanged, so reverting the native implementation does not require consumer API changes. Physical publication recovery still follows its existing exact revision and no-clobber rules; never remove a retained recovery artifact merely to make a test or later write pass.

Finish generated/package and aggregate convergence before merging. After delivery, record the applicable commit, checks and release result in this file, then add Result and Durable memory sections when changing its status to completed. Promote only reusable conclusions with a maintained owner, following [[notes/documentation-ownership|Documentation ownership]].
