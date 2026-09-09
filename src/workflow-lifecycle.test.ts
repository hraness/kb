import { describe, expect, test } from "bun:test";

import { defineWorkflow, runWorkflow, WorkflowRunError } from "./workflow.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const options = { input: undefined, kb: undefined };

describe("workflow native lifetime", () => {
  test("admits callbacks in the existing first microtask after returning the Promise", async () => {
    const release = deferred<string>();
    const events: string[] = [];
    const definition = defineWorkflow({
      id: "callback-prefix",
      nodes: ["first", "second"].map((id) => ({
        id, run: () => { events.push(id); return release.promise; },
      })),
      output: "second",
    });
    const running = runWorkflow(definition, options);
    expect(events).toEqual([]);
    await Promise.resolve();
    expect(events).toEqual(["first", "second"]);
    release.resolve("done");
    expect((await running).output).toBe("done");
  });

  test("drains held native work and its late failure after selecting the first failure", async () => {
    const broken = deferred<never>();
    const sibling = deferred<never>();
    const bothStarted = deferred<void>();
    const cancellation = deferred<void>();
    const primary = new Error("primary native failure");
    const late = new Error("late native failure");
    const events: string[] = [];
    let settled = false;
    const definition = defineWorkflow({
      id: "late-native-drain",
      nodes: [
        { id: "broken", resource: "qmd", run: () => { events.push("broken"); return broken.promise; } },
        { id: "held", run: ({ signal }) => {
          events.push("held");
          signal.addEventListener("abort", () => cancellation.resolve(), { once: true });
          bothStarted.resolve();
          return sibling.promise;
        } },
        { id: "queued", resource: "qmd", run: () => { events.push("queued"); } },
        { id: "dependent", needs: ["broken"], run: () => { events.push("dependent"); } },
      ],
      output: "dependent",
    });
    const running = runWorkflow(definition, { ...options, concurrency: 2 }).then(
      () => { settled = true; return undefined; },
      (error: unknown) => { settled = true; return error; },
    );
    await bothStarted.promise;
    broken.reject(primary);
    await cancellation.promise;
    expect(settled).toBeFalse();
    expect(events).toEqual(["broken", "held"]);
    sibling.reject(late);
    const error = await running;
    expect(error).toBeInstanceOf(WorkflowRunError);
    expect(error).toMatchObject({ kind: "node-failed", node: "broken" });
    expect((error as Error).cause).toBe(primary);
    expect(events).toEqual(["broken", "held"]);
  });

  test.each([undefined, null, 0, false, new Error("native identity")])(
    "retains the exact native cause %p", async (reason) => {
      const definition = defineWorkflow({
        id: "failure-identity",
        nodes: [{ id: "broken", run: () => Promise.reject(reason) }],
        output: "broken",
      });
      const error = await runWorkflow(definition, options).then(() => null, (cause: unknown) => cause);
      expect(error).toBeInstanceOf(WorkflowRunError);
      expect((error as WorkflowRunError).kind).toBe("node-failed");
      expect((error as Error).cause).toBe(reason);
    },
  );

  test("preserves active insertion order when several remaining callbacks already settled", async () => {
    const first = deferred<string>();
    const second = deferred<never>();
    const third = deferred<never>();
    const started = deferred<void>();
    const secondReason = new Error("second");
    const definition = defineWorkflow({
      id: "settled-ties",
      nodes: [
        { id: "first", run: () => first.promise },
        { id: "second", run: () => second.promise },
        { id: "third", run: () => { started.resolve(); return third.promise; } },
      ],
      output: "first",
    });
    const running = runWorkflow(definition, options).then(() => null, (error: unknown) => error);
    await started.promise;
    first.resolve("first");
    third.reject(new Error("third settled before second"));
    second.reject(secondReason);
    const error = await running;
    expect(error).toMatchObject({ kind: "node-failed", node: "second" });
    expect((error as Error).cause).toBe(secondReason);
  });

  test("notifies external abort synchronously but drains an ignoring callback before rejecting pending work", async () => {
    const started = deferred<void>();
    const held = deferred<string>();
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    let nativeSignal: AbortSignal | undefined;
    let dependentRan = false;
    let settled = false;
    const definition = defineWorkflow({
      id: "external-abort-drain",
      nodes: [
        { id: "held", run: ({ signal }) => { nativeSignal = signal; started.resolve(); return held.promise; } },
        { id: "dependent", needs: ["held"], run: () => { dependentRan = true; } },
      ],
      output: "dependent",
    });
    const running = runWorkflow(definition, { ...options, signal: controller.signal }).then(
      () => { settled = true; return null; },
      (error: unknown) => { settled = true; return error; },
    );
    await started.promise;
    controller.abort(reason);
    expect(nativeSignal?.reason).toBe(reason);
    await Promise.resolve();
    expect(settled).toBeFalse();
    expect(dependentRan).toBeFalse();
    held.resolve("native completed");
    expect(await running).toMatchObject({ kind: "aborted" });
    expect(dependentRan).toBeFalse();
  });

  test.each(["same-turn", "next-microtask"] as const)(
    "preserves final ignoring callback success after %s caller abort", async (ordering) => {
      const started = deferred<void>();
      const held = deferred<string>();
      const controller = new AbortController();
      let nativeSignal: AbortSignal | undefined;
      const definition = defineWorkflow({
        id: "final-abort-order",
        nodes: [{ id: "last", run: ({ signal }) => {
          nativeSignal = signal;
          started.resolve();
          return held.promise;
        } }],
        output: "last",
      });
      const running = runWorkflow(definition, { ...options, signal: controller.signal });
      await started.promise;
      held.resolve("finished");
      if (ordering === "next-microtask") await Promise.resolve();
      controller.abort("stop");
      expect(nativeSignal?.aborted).toBeTrue();
      expect((await running).output).toBe("finished");
    },
  );

  test.each([1, 2])("registers caller abort before first callback admission for %i nodes", async (count) => {
    const controller = new AbortController();
    const reason = new Error("abort before callback microtask");
    const seen: unknown[] = [];
    const definition = defineWorkflow({
      id: "immediate-caller-abort",
      nodes: Array.from({ length: count }, (_, i) => ({
        id: `node-${i}`,
        run: ({ signal }: { readonly signal: AbortSignal }) => { seen.push(signal.reason); return i; },
      })),
      output: "node-0",
    });
    const running = runWorkflow(definition, { ...options, signal: controller.signal }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    controller.abort(reason);
    expect(seen).toEqual([]);
    const outcome = await running;
    expect(seen).toEqual(Array(count).fill(reason));
    if (count === 1) {
      expect(outcome.ok).toBeTrue();
      if (outcome.ok) expect(outcome.result.output).toBe(0);
    } else {
      expect(outcome.ok).toBeFalse();
      if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: "aborted" });
    }
  });

  test.each([undefined, null, 0, false, new Error("listener removal")])(
    "retains listener-removal precedence and exact cleanup reason %p", async (cleanup) => {
      const controller = new AbortController();
      const primary = new Error("callback failed before cleanup");
      Object.defineProperty(controller.signal, "removeEventListener", {
        value: () => { throw cleanup; },
      });
      const definition = defineWorkflow({
        id: "listener-cleanup-failure",
        nodes: [{ id: "broken", run: () => Promise.reject(primary) }],
        output: "broken",
      });
      const result = await runWorkflow(definition, { ...options, signal: controller.signal }).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error).toBe(cleanup);
    },
  );

  test("selects caller abort arriving in the microtask after native rejection", async () => {
    const controller = new AbortController();
    const started = deferred<void>();
    const held = deferred<never>();
    const definition = defineWorkflow({
      id: "reject-then-abort",
      nodes: [{ id: "broken", run: () => { started.resolve(); return held.promise; } }],
      output: "broken",
    });
    const running = runWorkflow(definition, { ...options, signal: controller.signal }).then(
      () => null, (error: unknown) => error,
    );
    await started.promise;
    held.reject(new Error("native rejected"));
    await Promise.resolve();
    controller.abort(new Error("later caller abort"));
    expect(await running).toMatchObject({ kind: "aborted" });
  });
});
