#!/usr/bin/env bun
/**
 * Deprecated `kb` command alias. Wordcell 0.20.0 renamed the CLI to
 * `wordcell`; this entry point keeps existing `kb …` invocations working for
 * one minor cycle and is removed in 0.21.0.
 */
import { runExecutable } from "./cli-program.js";

export const KB_ALIAS_NOTICE = "kb is now wordcell; the kb alias is removed in 0.21.0";

if (import.meta.main) {
  process.stderr.write(`${KB_ALIAS_NOTICE}\n`);
  process.exitCode = await runExecutable();
}
