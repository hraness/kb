#!/usr/bin/env bun
import { runExecutable } from "./cli-program.js";

export * from "./cli-program.js";

if (import.meta.main) process.exitCode = await runExecutable();
