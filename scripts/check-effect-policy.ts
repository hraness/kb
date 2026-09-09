import { resolve } from "node:path";
import { createArchitectureProgram, inspectEffectArchitecture } from "./check-effect-architecture.js";

const root = resolve(import.meta.dir, "..");
const findings = inspectEffectArchitecture(createArchitectureProgram(resolve(root, "tsconfig.json")), {
  root,
  modules: [
    "src/workflow-platform.ts",
    "src/workflow-program.ts",
    "src/workflow-runtime.ts",
    "src/authoring.ts",
    "src/authoring-platform.ts",
    "src/authoring-program.ts",
    "src/authoring-runtime.ts",
  ],
  // Native callback admission, filesystem operations and Promise settlement.
  adapters: ["src/workflow-platform.ts", "src/authoring-platform.ts"],
  // Public Promise facades enter exactly one finite runtime per invocation.
  runtimeRoots: ["src/workflow-runtime.ts", "src/authoring-runtime.ts"],
  ignoredDirectories: ["scripts", "work", "artifacts", "node_modules", "dist"],
});
for (const finding of findings) console.error(`${finding.file}:${finding.line} ${finding.rule}: ${finding.message}`);
if (findings.length > 0) process.exitCode = 1;
