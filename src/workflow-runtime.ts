import { Cause, Effect, Exit, Option } from "effect";

import {
  checkedConcurrency,
  checkedOutputBytes,
  resourceLimits,
  validateWorkflow,
  WorkflowRunError,
} from "./workflow-model.js";
import type {
  WorkflowDefinition,
  WorkflowResultId,
  WorkflowRunOptions,
  WorkflowRunResult,
} from "./workflow-model.js";
import { executeWorkflow } from "./workflow-program.js";
import { WorkflowListenerRemovalFailure } from "./workflow-platform.js";

/** Execute ready nodes concurrently while keeping QMD and Git resource groups bounded. */
export async function runWorkflow<
  Input,
  KnowledgeBase,
  Results extends object,
  Output extends WorkflowResultId<Results>,
>(
  definition: WorkflowDefinition<Input, KnowledgeBase, Results, Output>,
  options: WorkflowRunOptions<Input, KnowledgeBase>,
): Promise<WorkflowRunResult<Results, Output>> {
  validateWorkflow(definition);
  const concurrency = checkedConcurrency(options.concurrency);
  const limits = resourceLimits(concurrency, options.resourceConcurrency);
  const outputLimit = checkedOutputBytes(options.maxOutputBytes);
  if (options.signal?.aborted === true) {
    throw new WorkflowRunError("aborted", "Workflow execution was aborted.");
  }
  // Caller cancellation is a domain notification. It must never interrupt the
  // finite root while an admitted native callback is still running.
  const exit = await Effect.runPromiseExit(Effect.scoped(executeWorkflow(
    definition, options, { concurrency, limits, outputLimit },
  )));
  if (Exit.isSuccess(exit)) return exit.value;
  const cleanup = Array.from(Cause.defects(exit.cause)).find(
    (defect): defect is WorkflowListenerRemovalFailure => defect instanceof WorkflowListenerRemovalFailure,
  );
  if (cleanup !== undefined) throw cleanup.reason;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  const defect = Cause.dieOption(exit.cause);
  if (Option.isSome(defect)) throw defect.value;
  throw new Error("Workflow owner was interrupted without a caller cancellation outcome.");
}
