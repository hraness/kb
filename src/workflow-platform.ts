import { serialize } from "node:v8";
import { Effect } from "effect";

import { WorkflowRunError } from "./workflow-model.js";

export type NodeOutcome =
  | { readonly ok: true; readonly id: string; readonly value: unknown }
  | { readonly ok: false; readonly id: string; readonly error: unknown };

export type NativeCallback = { readonly completion: Promise<NodeOutcome> };

/** Register both outcomes before exposing an admitted callback to its owner. */
export function admitCallback(id: string, run: () => unknown): NativeCallback {
  const completion = Promise.resolve()
    .then(run)
    .then((value): NodeOutcome => ({ ok: true, id, value }))
    .catch((error: unknown): NodeOutcome => ({ ok: false, id, error }));
  return { completion };
}

export function awaitCallback(callback: NativeCallback): Effect.Effect<NodeOutcome> {
  return Effect.promise(() => callback.completion);
}

/** Native Promise ties and observation microtasks are part of the public contract. */
export function nextCallback(
  callbacks: Iterable<NativeCallback>,
): Effect.Effect<NodeOutcome> {
  return Effect.promise(() => Promise.race(
    Array.from(callbacks, ({ completion }) => completion),
  ));
}

export function structuredOutputBytes(value: unknown, node: string) {
  return Effect.try({
    try: () => serialize(value).byteLength,
    catch: (error: unknown) => new WorkflowRunError(
      "node-failed",
      `Workflow node ${JSON.stringify(node)} returned a result that cannot be structurally serialized.`,
      { node, cause: error },
    ),
  });
}

/** Private phase marker: a native finally failure must override the body failure. */
export class WorkflowListenerRemovalFailure {
  constructor(readonly reason: unknown) {}
}

export function workflowCancellation(signal: AbortSignal | undefined) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const controller = new AbortController();
      let abortedByCaller = false;
      const abort = () => {
        abortedByCaller = true;
        controller.abort(signal?.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      return { controller, abort, get abortedByCaller() { return abortedByCaller; } };
    }),
    ({ abort }) => Effect.sync(() => {
      try {
        signal?.removeEventListener("abort", abort);
      } catch (error: unknown) {
        throw new WorkflowListenerRemovalFailure(error);
      }
    }),
  );
}
