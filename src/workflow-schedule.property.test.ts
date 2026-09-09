import { expect, test } from "bun:test";
import fc from "fast-check";

import { defineWorkflow, runWorkflow } from "./workflow.js";
import type { WorkflowResource } from "./workflow.js";

const options = { input: undefined, kb: undefined };

test("preserves DAG dependencies, declaration order and resource caps across bounded schedules", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.record({
        resource: fc.constantFrom<WorkflowResource>("default", "git", "qmd"),
        depends: fc.boolean(),
        turns: fc.integer({ min: 0, max: 3 }),
      }), { minLength: 1, maxLength: 12 }),
      fc.integer({ min: 1, max: 8 }),
      async (specs, concurrency) => {
        let global = 0;
        const active = { default: 0, git: 0, qmd: 0 };
        const finished = new Set<string>();
        const nodes = specs.map((spec, i) => ({
          id: `node-${i}`,
          needs: i > 0 && spec.depends ? [`node-${i - 1}`] : [],
          resource: spec.resource,
          run: async () => {
            if (i > 0 && spec.depends) expect(finished.has(`node-${i - 1}`)).toBeTrue();
            global += 1;
            active[spec.resource] += 1;
            expect(global).toBeLessThanOrEqual(concurrency);
            expect(active.qmd).toBeLessThanOrEqual(1);
            expect(active.git).toBeLessThanOrEqual(Math.min(4, concurrency));
            try {
              for (let turn = 0; turn < spec.turns; turn += 1) await Promise.resolve();
              finished.add(`node-${i}`);
              return i;
            } finally {
              global -= 1;
              active[spec.resource] -= 1;
            }
          },
        }));
        const result = await runWorkflow(defineWorkflow({
          id: "generated-schedule", nodes, output: nodes.at(-1)!.id,
        }), { ...options, concurrency });
        expect(result.trace.map(({ id }) => id)).toEqual(nodes.map(({ id }) => id));
        expect([...result.results.keys()]).toEqual(nodes.map(({ id }) => id));
        expect(result.output).toBe(nodes.length - 1);
        expect(global).toBe(0);
      },
    ), { seed: 20260908, numRuns: 64 });
  });
