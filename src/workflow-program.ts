import { Effect, Fiber } from "effect";
import type { Scope } from "effect";

import { needsFor, WorkflowRunError } from "./workflow-model.js";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeContext,
  WorkflowNodeTrace,
  WorkflowResource,
  WorkflowResultId,
  WorkflowResultValue,
  WorkflowRunOptions,
  WorkflowRunResult,
} from "./workflow-model.js";
import {
  admitCallback,
  awaitCallback,
  nextCallback,
  structuredOutputBytes,
  workflowCancellation,
} from "./workflow-platform.js";
import type { NativeCallback, NodeOutcome } from "./workflow-platform.js";

type NodeTask = {
  readonly callback: NativeCallback;
  readonly fiber: Fiber.RuntimeFiber<NodeOutcome>;
  readonly resource: WorkflowResource;
};

function abortedError(): WorkflowRunError {
  return new WorkflowRunError("aborted", "Workflow execution was aborted.");
}

/** One finite owner; native completion and fiber lifetime are deliberately distinct. */
export function executeWorkflow<
  Input,
  KnowledgeBase,
  Results extends object,
  Output extends WorkflowResultId<Results>,
>(
  definition: WorkflowDefinition<Input, KnowledgeBase, Results, Output>,
  options: WorkflowRunOptions<Input, KnowledgeBase>,
  policy: {
    readonly concurrency: number;
    readonly limits: Readonly<Record<WorkflowResource, number>>;
    readonly outputLimit: number;
  },
): Effect.Effect<WorkflowRunResult<Results, Output>, WorkflowRunError, Scope.Scope> {
  return Effect.gen(function*() {
    const cancellation = yield* workflowCancellation(options.signal);
    const { controller } = cancellation;
    const pending = new Set(definition.nodes.map(({ id }) => id));
    const completed = new Set<string>();
    const values = new Map<WorkflowResultId<Results>, WorkflowResultValue<Results>>();
    const active = new Map<string, NodeTask>();
    let failure: WorkflowRunError | undefined;
    let outputBytes = 0;

    const completedValue = <Id extends WorkflowResultId<Results>>(id: Id): Results[Id] => {
      if (!values.has(id)) {
        throw new Error(
          `Workflow result ${JSON.stringify(id)} is unavailable after its dependency completed.`,
        );
      }
      return values.get(id) as Results[Id];
    };
    const contextFor = (node: WorkflowNode<Input, KnowledgeBase, Results>) => {
      const needs = needsFor(node);
      const allowedResults = new Set(needs);
      const dependencyResults = new Map<WorkflowResultId<Results>, WorkflowResultValue<Results>>(
        needs.map((id) => [id, completedValue(id)] as const),
      );
      const context: WorkflowNodeContext<Input, KnowledgeBase, Results> = {
        input: options.input,
        kb: options.kb,
        signal: controller.signal,
        results: dependencyResults,
        result: <Id extends WorkflowResultId<Results>>(id: Id): Results[Id] => {
          if (!allowedResults.has(id)) {
            throw new Error(
              `Workflow result ${JSON.stringify(id)} is not a declared dependency of ${JSON.stringify(node.id)}.`,
            );
          }
          return dependencyResults.get(id) as Results[Id];
        },
      };
      return context;
    };

    while (completed.size < definition.nodes.length && failure === undefined) {
      if (controller.signal.aborted) {
        failure = abortedError();
        break;
      }
      for (const node of definition.nodes) {
        if (!pending.has(node.id) || active.size >= policy.concurrency) continue;
        if (!needsFor(node).every((dependency) => completed.has(dependency))) continue;
        const resource = node.resource ?? "default";
        const occupied = Array.from(active.values()).filter((task) => task.resource === resource).length;
        if (occupied >= policy.limits[resource]) continue;
        const context = contextFor(node);
        // Admission and the scope registration are one masked handoff. Scope
        // closure joins the real callback, even when it ignores its signal.
        const task = yield* Effect.uninterruptible(Effect.gen(function*() {
          const callback = yield* Effect.sync(() => admitCallback(node.id, () => node.run(context)));
          const fiber = yield* Effect.forkScoped(Effect.uninterruptible(awaitCallback(callback)));
          return { callback, fiber, resource };
        }));
        pending.delete(node.id);
        active.set(node.id, task);
      }
      if (active.size === 0) {
        return yield* Effect.die(new Error("Workflow scheduler made no progress after validation."));
      }

      const outcome = yield* nextCallback(Array.from(active.values(), ({ callback }) => callback));
      const task = active.get(outcome.id);
      if (task !== undefined) yield* Fiber.await(task.fiber).pipe(Effect.asVoid);
      active.delete(outcome.id);
      if (outcome.ok) {
        const measured = yield* Effect.either(structuredOutputBytes(outcome.value, outcome.id));
        if (measured._tag === "Left") {
          failure = measured.left;
        } else if (measured.right > policy.outputLimit - outputBytes) {
          failure = new WorkflowRunError(
            "output-limit",
            `Workflow results exceed the ${policy.outputLimit}-byte output limit at node ${JSON.stringify(outcome.id)}.`,
            { node: outcome.id },
          );
        } else {
          outputBytes += measured.right;
          values.set(outcome.id as WorkflowResultId<Results>, outcome.value as WorkflowResultValue<Results>);
          completed.add(outcome.id);
        }
        if (failure !== undefined) controller.abort(failure);
      } else {
        controller.abort(outcome.error);
        failure = cancellation.abortedByCaller
          ? abortedError()
          : new WorkflowRunError(
              "node-failed",
              `Workflow node ${JSON.stringify(outcome.id)} failed.`,
              { node: outcome.id, cause: outcome.error },
            );
      }
    }

    // Do not race interruption against callback completion. Joining the scoped
    // children also observes every rejection after the selected domain failure.
    yield* Effect.forEach(active.values(), ({ fiber }) => Fiber.await(fiber).pipe(Effect.asVoid), { discard: true });
    if (failure !== undefined) return yield* Effect.fail(failure);

    let finalOutputBytes = 0;
    for (const node of definition.nodes) {
      const resultBytes = yield* structuredOutputBytes(values.get(node.id), node.id);
      if (resultBytes > policy.outputLimit - finalOutputBytes) {
        return yield* Effect.fail(new WorkflowRunError(
          "output-limit",
          `Workflow results exceed the ${policy.outputLimit}-byte output limit at node ${JSON.stringify(node.id)}.`,
          { node: node.id },
        ));
      }
      finalOutputBytes += resultBytes;
    }
    const orderedValues = new Map<WorkflowResultId<Results>, WorkflowResultValue<Results>>(
      definition.nodes.map((node) => [node.id, completedValue(node.id)] as const),
    );
    return {
      workflow: definition.id,
      outputNode: definition.output,
      output: values.get(definition.output) as Results[Output],
      outputBytes: finalOutputBytes,
      trace: definition.nodes.map((node): WorkflowNodeTrace => ({
        id: node.id,
        needs: needsFor(node),
        resource: node.resource ?? "default",
        status: "completed",
      })),
      results: orderedValues,
    };
  });
}
