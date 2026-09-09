import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import fc from "fast-check";
import { inspectEffectArchitecture } from "./check-effect-architecture.js";

const directory = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = mkdtempSync(join(directory, ".architecture-fixtures-"));
try {
const fixtures: Record<string, string> = {
  "program.ts": `import {Effect} from "effect"; export const program = Effect.gen(function*(){ yield* Effect.log("ok"); return 1; });`,
  "floating.ts": `import {Effect} from "effect"; export const program = Effect.gen(function*(){ Effect.log("forgotten"); return 1; });`,
  "voided.ts": `import {Effect} from "effect"; void Effect.succeed(1);`,
  "runner.ts": `import {runPromise as execute, succeed} from "effect/Effect"; export const x=execute(succeed(1));`,
  "aliased-runner.ts": `import {Effect} from "effect"; const execute=Effect.runPromise; export const x=execute(Effect.succeed(1));`,
  "computed-runner.ts": `import {Effect} from "effect"; export const x=Effect["runPromise"](Effect.succeed(1));`,
  "runtime-construction.ts": `import {ManagedRuntime,Layer} from "effect"; export const x=ManagedRuntime.make(Layer.empty);`,
  "destructured-runner.ts": `import {Effect} from "effect"; const {runPromise:execute}=Effect; export const x=execute(Effect.succeed(1));`,
  "local-destructured.ts": `import {Effect} from "effect"; const local={runPromise:()=>Effect.succeed(1)}; const {runPromise:execute}=local; export const x=execute();`,
  "unused.ts": `import {Effect} from "effect"; export const x=Effect.gen(function*(){ const dropped=Effect.log("forgotten"); return 1; });`,
  "shorthand.ts": `import {Effect} from "effect"; export function make(){ const effect=Effect.succeed(1); return {effect}; }`,
  "assigned.ts": `import {Effect,Exit} from "effect"; export function make(){ let result:Exit.Exit<number,string>=Exit.succeed(1); result=Exit.fail("failure"); return result; }`,
  "assigned-unused.ts": `import {Effect} from "effect"; export function make(){ let task:Effect.Effect<void>; task=Effect.log("forgotten"); return 1; }`,
  "root.ts": `import {Effect} from "effect"; export const run=<A>(program:Effect.Effect<A,never,never>)=>Effect.runPromise(program);`,
  "ambient.ts": `import {Effect} from "effect"; export const x=Effect.sync(()=>Date.now()+Math.random());`,
  "shadowed.ts": `import {Effect} from "effect"; const fetch=()=>Effect.succeed(1); export const x=fetch();`,
  "adapter.ts": `import {Effect} from "effect"; import {readFile} from "node:fs/promises"; export const read=Effect.tryPromise({try:()=>readFile("sample"),catch:()=>({ _tag:"ReadFailed" as const })});`,
  "native.ts": `import {Effect} from "effect"; import {readFile} from "node:fs/promises"; export const read=Effect.tryPromise({try:()=>readFile("sample"),catch:()=>({ _tag:"ReadFailed" as const })});`,
  "native-dynamic.ts": `import {Effect} from "effect"; export const read=Effect.tryPromise({try:()=>import("node:fs/promises"),catch:()=>({ _tag:"ReadFailed" as const })});`,
  "adapter-dynamic.ts": `import {Effect} from "effect"; export const read=Effect.tryPromise({try:()=>import("node:fs/promises"),catch:()=>({ _tag:"ReadFailed" as const })});`,
  "adapter-runner.ts": `import {Effect} from "effect"; export const result=Effect.runPromise(Effect.succeed(1));`,
  "adapter-floating.ts": `import {Effect} from "effect"; export const read=Effect.gen(function*(){ Effect.log("dropped adapter work"); return 1; });`,
  "ambient-const.ts": `import {Effect} from "effect"; const sample=Date.now; export const program=Effect.sync(()=>sample());`,
  "ambient-transfer.ts": `import {Effect} from "effect"; const sample=Date.now; export const program=Effect.sync(sample);`,
  "ambient-chain.ts": `import {Effect} from "effect"; const clock=Date; const first=clock["now"]; const second=first; export const program=Effect.sync(second);`,
  "ambient-destructure.ts": `import {Effect} from "effect"; const {now:sample}=Date; export const program=Effect.sync(sample);`,
  "ambient-fetch.ts": `import {Effect} from "effect"; const request=globalThis.fetch; export const program=Effect.sync(()=>request("https://example.invalid"));`,
  "ambient-timer.ts": `import {Effect} from "effect"; const schedule=window["setTimeout"]; export const program=Effect.sync(()=>schedule(()=>{},1));`,
  "ambient-random.ts": `import {Effect} from "effect"; const {random:sample}=Math; export const program=Effect.sync(sample);`,
  "ambient-mutable.ts": `import {Effect} from "effect"; let sample=()=>1; sample=Date.now; export const program=Effect.sync(sample);`,
  "adapter-capability.ts": `export const sample=Date.now; export const Clock={now:()=>Date.now()};`,
  "ambient-import.ts": `import {Effect} from "effect"; import {sample} from "./adapter-capability.js"; export const program=Effect.sync(sample);`,
  "ambient-barrel.ts": `export {sample} from "./adapter-capability.js";`,
  "ambient-barrel-use.ts": `import {Effect} from "effect"; import {sample} from "./ambient-barrel.js"; export const program=Effect.sync(sample);`,
  "adapter-capture.ts": `import {Effect} from "effect"; const sample=Date.now; export const program=Effect.sync(sample);`,
  "shadowed-clock.ts": `import {Effect} from "effect"; const Date={now:()=>1}; const Math={random:()=>2}; const {now:sample}=Date; export const program=Effect.sync(()=>sample()+Math.random());`,
  "declared-clock.d.ts": `export declare const Date:{now:()=>number}; export declare function fetch(input:string):number;`,
  "declared-service.ts": `import {Effect} from "effect"; import {Date,fetch} from "./declared-clock.js"; const sample=Date.now; export const program=Effect.sync(()=>sample()+fetch("local"));`,
  "injected-service.ts": `import {Effect} from "effect"; import {Clock} from "./adapter-capability.js"; export const program=Effect.sync(Clock.now);`,
  "mutable-service.ts": `import {Effect} from "effect"; let sample=()=>1; sample=()=>2; export const program=Effect.sync(sample);`,
  "adapter-mutable.ts": `export let sample=Date.now; sample=()=>1; export const holder={now:Date.now}; holder.now=()=>2; export const dynamicKey:string="now";`,
  "mutable-import.ts": `import {Effect} from "effect"; import {sample,holder} from "./adapter-mutable.js"; export const program=Effect.sync(()=>sample()+holder.now());`,
  "dynamic-member.ts": `import {Effect} from "effect"; import {dynamicKey} from "./adapter-mutable.js"; const holder:Record<string,()=>number>={now:()=>1}; export const program=Effect.sync(()=>holder[dynamicKey]?.());`,
  "ambient-return.ts": `import {sample} from "./adapter-capability.js"; export function transfer(){return sample;}`,
  "ambient-shorthand.ts": `import {sample} from "./adapter-capability.js"; export const capability={sample};`,
  "ambient-wrapped.ts": `import {Effect} from "effect"; const sample=(Date.now satisfies ()=>number) as ()=>number; export const program=Effect.sync(sample);`,
  "platform-shaped-service.ts": `import {Effect} from "effect"; export function make(Date:DateConstructor,Math:Math){const sample=Date.now; return Effect.sync(()=>sample()+Math.random());}`,
  "platform-shaped-destructure.ts": `import {Effect} from "effect"; export function make(Date:DateConstructor){const {now:sample}=Date; return Effect.sync(sample);} export function fromParameter({now}:DateConstructor){return Effect.sync(now);}`,
  "platform-shaped-window.ts": `import {Effect} from "effect"; export const make=(window:Window)=>Effect.sync(()=>window.setTimeout(()=>{},1)); export const request=(platform:typeof globalThis)=>Effect.sync(()=>platform.fetch("https://example.invalid"));`,
  "declared-platform.d.ts": `export declare const Date:DateConstructor; export declare const window:Window;`,
  "platform-shaped-declared.ts": `import {Effect} from "effect"; import {Date,window} from "./declared-platform.js"; export const program=Effect.sync(()=>Date.now()+window.setTimeout(()=>{},1));`,
  "ambient-global-chain.ts": `import {Effect} from "effect"; const platform=globalThis; const {Date:Clock}=platform; const sample=Clock.now; export const program=Effect.sync(sample);`,
  "ambient-global-namespace.ts": `import {Effect} from "effect"; const platform=globalThis; export const program=Effect.sync(()=>platform.Math.random());`,
  "ambient-import-namespace.ts": `import {Effect} from "effect"; import * as native from "./adapter-capability.js"; const {sample}=native; export const program=Effect.sync(sample);`,
  "ambient-type.ts": `import {Effect} from "effect"; export type Clock=typeof Date.now; export const program=Effect.succeed(1);`,
  "local-values.ts": `import {Effect} from "effect"; export const work=Effect.succeed(1); export const make=()=>work; export const pure=()=>1; export interface Dto {value:number}; export type Task=typeof work;`,
  "local-barrel.ts": `export * from "./local-values.js";`,
  "unclassified-local-value.ts": `import {work} from "./local-values.js"; work;`,
  "unclassified-local-factory.ts": `import {make} from "./local-barrel.js"; export const task=make();`,
  "unclassified-local-namespace.ts": `import * as local from "./local-barrel.js"; export const task=local.make();`,
  "unclassified-local-reexport.ts": `export {work,make} from "./local-barrel.js";`,
  "unclassified-local-star.ts": `export * from "./local-barrel.js";`,
  "unclassified-local-import.ts": `import {make} from "./local-barrel.js";`,
  "unclassified-local-parameter.ts": `import type {Task} from "./local-values.js"; export const identity=(task:Task)=>task;`,
  "unclassified-local-union.ts": `import {work} from "./local-values.js"; export const choose=(take:boolean)=>take?work:1;`,
  "unclassified-local-pure.ts": `import {pure} from "./local-barrel.js"; export const value=pure();`,
  "unclassified-local-pure-namespace.ts": `import * as local from "./local-barrel.js"; export const value=local.pure();`,
  "unclassified-local-types.ts": `import type {Task,Dto} from "./local-barrel.js"; export type Alias=Task; export type {Dto};`,
  "unclassified-local-type-export.ts": `export type {Task} from "./local-values.js";`,
  "unclassified-type-barrel.ts": `export * from "./unclassified-local-type-export.js";`,
  "unclassified-direct-type.ts": `import type {Effect} from "effect"; export type Task=Effect.Effect<number>;`,
  "unclassified-local-interface.ts": `import type {Task} from "./local-values.js"; export interface Tasks {run:()=>Task}; export function pure<T extends Task>():number{return 1;}`,
  "unclassified-value-type-export.ts": `export type {work} from "./local-values.js";`,
  "unclassified-value-type-barrel.ts": `export * from "./unclassified-value-type-export.js";`,
  "unclassified-duck.ts": `export const work={_tag:"Effect", "__@EffectTypeId@":()=>1};`,
  "local-floating.ts": `import {work} from "./local-barrel.js"; work;`,
  "local-unused.ts": `import {make} from "./local-barrel.js"; export function forget(){ const task=make(); return 1; }`,
  "local-composed.ts": `import {work} from "./local-barrel.js"; export const task=work;`,
  "cycle-a.ts": `export {work} from "./local-values.js"; export {pure} from "./cycle-b.js";`,
  "cycle-b.ts": `export {work} from "./cycle-a.js"; export const pure=()=>1;`,
  "unclassified-cycle.ts": `import {work} from "./cycle-b.js"; work;`,
  "unclassified-cycle-pure.ts": `import {pure} from "./cycle-a.js"; export const x=pure();`,
  "unknown-error.ts": `import {Effect} from "effect"; export const x:Effect.Effect<number,unknown>=Effect.fail("bad");`,
  "any-error.ts": `import {Effect} from "effect"; export const x:Effect.Effect<number,any>=Effect.succeed(1);`,
  "asserted.ts": `import {Effect} from "effect"; export const x=Effect.fail("bad") as Effect.Effect<never,never>;`,
  "erased.ts": `import {Effect} from "effect"; export const x=Effect.orDie(Effect.fail("bad"));`,
  "suppressed.ts": `import {Effect} from "effect"; // @ts-ignore\nexport const x=Effect.succeed(1);`,
  "suppressed-error.ts": `import {Effect} from "effect"; // @ts-expect-error\nexport const x:Effect.Effect<never,never>=Effect.fail("bad");`,
  "unclassified.ts": `import {Effect} from "effect"; export const x=Effect.succeed(1);`,
  "unclassified-dynamic.ts": `export const load=()=>import("effect");`,
  "javascript-catch.ts": `import {Effect} from "effect"; export const program=Effect.gen(function*(){ try { return yield* Effect.fail("bad"); } catch { return 1; } });`,
  "javascript-catch-alias.ts": `import {gen as compose, fail} from "effect/Effect"; export const program=compose(function*(){ try { return yield* fail("bad"); } catch { return 1; } });`,
  "typed-catch.ts": `import {Effect} from "effect"; export const program=Effect.gen(function*(){ try { return yield* Effect.fail("bad").pipe(Effect.catchAll(()=>Effect.succeed(1))); } catch { return 2; } });`,
  "exit-catch.ts": `import {Effect} from "effect"; export const program=Effect.gen(function*(){ try { return (yield* Effect.exit(Effect.fail("bad")))._tag; } catch { return "sync failure"; } });`,
  "nested-generator-catch.ts": `import {Effect} from "effect"; export const program=Effect.gen(function*(){ try { return Effect.gen(function*(){ return yield* Effect.fail("bad"); }); } catch { return Effect.succeed(1); } });`,
  "plain-generator-catch.ts": `import {Effect} from "effect"; export function* values(){ try { yield Effect.fail("bad"); } catch { yield Effect.succeed(1); } }`,
  "javascript-catch-parenthesized.ts": `import {Effect} from "effect"; export const program=Effect.gen((function*(){ try { return yield* Effect.fail("bad"); } catch { return 1; } }));`,
  "javascript-catch-declared.ts": `import {Effect} from "effect"; function* operation(){ try { return yield* Effect.fail("bad"); } catch { return 1; } } export const program=Effect.gen(operation);`,
  "javascript-catch-generator-alias.ts": `import {Effect} from "effect"; const operation=function*(){ try { return yield* Effect.fail("bad"); } catch { return 1; } }; const alias=operation; export const program=Effect.gen(alias);`,
  "imported-generator.ts": `import {Effect} from "effect"; export function* operation(){ try { return yield* Effect.fail("bad"); } catch { return 1; } }`,
  "imported-generator-use.ts": `import {Effect} from "effect"; import {operation as aliased} from "./imported-generator.js"; export const program=Effect.gen(aliased);`,
  "typed-catch-declared.ts": `import {Effect} from "effect"; function* operation(){ try { return yield* Effect.fail("bad").pipe(Effect.catchAll(()=>Effect.succeed(1))); } catch { return 2; } } export const program=Effect.gen(operation);`,
  "plain-generator-consumer.ts": `import {Effect} from "effect"; const local={gen:(operation:()=>Generator<unknown,number,unknown>)=>operation()}; function* operation(){ try { yield Effect.fail("bad"); return 1; } catch { return 2; } } export const iterator=local.gen(operation);`,
};
for(let depth=0;depth<=8;depth++) {
  for(const native of [false,true]) {
    const origin=native?"Date.now":"(()=>1)";
    const chain=Array.from({length:depth},(_,index)=>`const alias${index+1}=alias${index};`).join(" ");
    fixtures[`alias-property-${native?"native":"service"}-${depth}.ts`]=
      `import {Effect} from "effect"; const alias0=${origin}; ${chain} export const work=Effect.sync(alias${depth});`;
  }
}
for(const [name, source] of Object.entries(fixtures)) writeFileSync(join(fixtureRoot,name),source);
const program=ts.createProgram({rootNames:Object.keys(fixtures).map(name=>join(fixtureRoot,name)),options:{
  strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,
  moduleResolution:ts.ModuleResolutionKind.NodeNext,types:[],
}});
const findings=inspectEffectArchitecture(program,{
  root:fixtureRoot,modules:Object.keys(fixtures).filter(n=>!n.startsWith("unclassified")),
  adapters:["adapter.ts","adapter-dynamic.ts","adapter-runner.ts","adapter-floating.ts","adapter-capability.ts","adapter-capture.ts","adapter-mutable.ts"],runtimeRoots:["root.ts"],
});
const rules=(file:string)=>findings.filter(f=>f.file===file).map(f=>f.rule);
  test("accepts composed programs, real root and adapter, and a local fetch service",()=>{
    for(const file of ["program.ts","root.ts","adapter.ts","adapter-dynamic.ts","shadowed.ts","shorthand.ts","assigned.ts","local-destructured.ts"]) expect(rules(file)).toEqual([]);
  });
  test("finds real typed floating Effects even when voided",()=>{
    expect(rules("floating.ts")).toContain("floating-effect");
    expect(rules("voided.ts")).toContain("floating-effect");
    expect(rules("unused.ts")).toContain("unused-effect");
    expect(rules("assigned-unused.ts")).toContain("floating-effect");
  });
  test("recognizes namespace, named, local alias and computed runtime entrypoints",()=>{
    for(const file of ["runner.ts","aliased-runner.ts","computed-runner.ts","runtime-construction.ts","destructured-runner.ts"]) expect(rules(file)).toContain("runtime-owner");
  });
  test("requires adapter ownership for native I/O and ambient clocks",()=>{
    expect(rules("ambient.ts")).toContain("ambient-io");
    expect(rules("native.ts")).toContain("native-import");
    expect(rules("native-dynamic.ts")).toContain("native-import");
    expect(rules("adapter-runner.ts")).toContain("runtime-owner");
    expect(rules("adapter-floating.ts")).toContain("floating-effect");
  });
  test("resolves selected native callback aliases and transfers without rejecting service capabilities",()=>{
    const rejected=["ambient-const.ts","ambient-transfer.ts","ambient-chain.ts","ambient-destructure.ts","ambient-fetch.ts","ambient-timer.ts","ambient-random.ts","ambient-mutable.ts","ambient-import.ts","ambient-barrel.ts","ambient-barrel-use.ts","ambient-return.ts","ambient-shorthand.ts","ambient-wrapped.ts","ambient-global-chain.ts","ambient-global-namespace.ts","ambient-import-namespace.ts"];
    const accepted=["adapter-capability.ts","adapter-capture.ts","shadowed-clock.ts","declared-service.ts","injected-service.ts","mutable-service.ts","ambient-type.ts","adapter-mutable.ts","mutable-import.ts","dynamic-member.ts","platform-shaped-service.ts","platform-shaped-destructure.ts","platform-shaped-window.ts","platform-shaped-declared.ts"];
    const selected=new Set([...rejected,...accepted,"declared-clock.d.ts","declared-platform.d.ts"].map(file=>join(fixtureRoot,file)));
    expect(ts.getPreEmitDiagnostics(program).filter(d=>d.file&&selected.has(d.file.fileName))).toEqual([]);
    for(const file of rejected) expect(rules(file)).toContain("ambient-io");
    for(const file of accepted) expect({file,rules:rules(file)}).toEqual({file,rules:[]});
  });
  test("immutable alias depth preserves native and local-service outcomes",()=>{
    const selected=new Set(Object.keys(fixtures).filter(file=>file.startsWith("alias-property-")).map(file=>join(fixtureRoot,file)));
    expect(ts.getPreEmitDiagnostics(program).filter(d=>d.file&&selected.has(d.file.fileName))).toEqual([]);
    fc.assert(fc.property(fc.integer({min:0,max:8}),fc.boolean(),(depth,native)=>{
      expect(rules(`alias-property-${native?"native":"service"}-${depth}.ts`).includes("ambient-io")).toBe(native);
    }),{seed:1415,numRuns:40});
  });
  test("requires local Effect value ownership without contaminating pure or type-only importers",()=>{
    const rejected=["unclassified-local-value.ts","unclassified-local-factory.ts","unclassified-local-namespace.ts","unclassified-local-reexport.ts","unclassified-local-star.ts","unclassified-local-import.ts","unclassified-local-parameter.ts","unclassified-local-union.ts","unclassified-cycle.ts","unclassified-direct-type.ts"];
    const accepted=["unclassified-local-pure.ts","unclassified-local-pure-namespace.ts","unclassified-local-types.ts","unclassified-local-type-export.ts","unclassified-type-barrel.ts","unclassified-duck.ts","unclassified-cycle-pure.ts","local-composed.ts","unclassified-local-interface.ts","unclassified-value-type-export.ts","unclassified-value-type-barrel.ts"];
    const selected=new Set([...rejected,...accepted,"local-floating.ts","local-unused.ts","cycle-a.ts","cycle-b.ts","local-values.ts","local-barrel.ts"].map(file=>join(fixtureRoot,file)));
    expect(ts.getPreEmitDiagnostics(program).filter(d=>d.file&&selected.has(d.file.fileName))).toEqual([]);
    for(const file of rejected) expect(rules(file)).toContain("unclassified-module");
    for(const file of accepted) expect({file,rules:rules(file)}).toEqual({file,rules:[]});
    expect(rules("local-floating.ts")).toContain("floating-effect");
    expect(rules("local-unused.ts")).toContain("unused-effect");
  });
  test("reports deterministic sorted findings with one diagnostic per rule and source line",()=>{
    const keys=findings.map(f=>`${f.file}:${f.line}:${f.rule}:${f.message}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(findings).toEqual([...findings].sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line||a.rule.localeCompare(b.rule)));
    expect(rules("ambient-chain.ts")).toEqual(["ambient-io"]);
  });
  test("rejects erased channels, unsafe assertions and defect conversion",()=>{
    expect(rules("unknown-error.ts")).toContain("explicit-channel");
    expect(rules("any-error.ts")).toContain("explicit-channel");
    expect(rules("any-error.ts")).toContain("explicit-any");
    expect(rules("asserted.ts")).toContain("effect-assertion");
    expect(rules("erased.ts")).toContain("erased-failure");
  });
  test("requires roles for new production Effect modules and refuses suppressions",()=>{
    expect(rules("unclassified.ts")).toContain("unclassified-module");
    expect(rules("unclassified-dynamic.ts")).toContain("unclassified-module");
    expect(rules("suppressed.ts")).toContain("suppression");
    expect(rules("suppressed-error.ts")).toContain("suppression");
  });
  test("fails closed when a governed file is not in the compilation",()=>{
    expect(inspectEffectArchitecture(program,{root:fixtureRoot,modules:["missing.ts"],adapters:[],runtimeRoots:[]})
      .some(f=>f.rule==="policy-source")).toBe(true);
  });
  test("rejects JavaScript catches for typed generator failures without rejecting handled exits or nested generators",()=>{
    expect(rules("javascript-catch.ts")).toContain("javascript-effect-catch");
    expect(rules("javascript-catch-alias.ts")).toContain("javascript-effect-catch");
    for(const file of ["typed-catch.ts","exit-catch.ts","nested-generator-catch.ts","plain-generator-catch.ts"]) expect(rules(file)).toEqual([]);
  });
  test("follows statically bound generator arguments while preserving plain generators and handled failures",()=>{
    const rejected=["javascript-catch-parenthesized.ts","javascript-catch-declared.ts","javascript-catch-generator-alias.ts","imported-generator.ts"];
    const accepted=["imported-generator-use.ts","typed-catch-declared.ts","plain-generator-consumer.ts"];
    const selected=new Set([...rejected,...accepted].map(file=>join(fixtureRoot,file)));
    expect(ts.getPreEmitDiagnostics(program).filter(d=>d.file&&selected.has(d.file.fileName))).toEqual([]);
    for(const file of rejected) expect(rules(file)).toContain("javascript-effect-catch");
    for(const file of accepted) expect({file,rules:rules(file)}).toEqual({file,rules:[]});
  });
} finally {
  rmSync(fixtureRoot,{recursive:true,force:true});
}
