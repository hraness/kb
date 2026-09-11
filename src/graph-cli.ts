import { queryGraph, rebuildGraph, verifyGraph } from "./graph-authority.js";
import type { GraphQueryRequest, GraphQueryResult, GraphVerification } from "./graph-authority-model.js";
import { validateGraphQueryRequest } from "./graph-query.js";

type GraphCliBase = Readonly<{ root: string; index?: string; json: boolean }>;
export type GraphCliCommand =
  | GraphCliBase & Readonly<{ kind: "graph-rebuild"; fresh: boolean }>
  | GraphCliBase & Readonly<{ kind: "graph-verify" }>
  | GraphCliBase & Readonly<{ kind: "graph-query"; request: GraphQueryRequest; persisted: boolean }>;
export type GraphCliParseResult =
  | Readonly<{ ok: true; value: GraphCliCommand }>
  | Readonly<{ ok: false; message: string }>;
export type GraphCliDependencies = Readonly<{
  queryGraph?: typeof queryGraph;
  rebuildGraph?: typeof rebuildGraph;
  verifyGraph?: typeof verifyGraph;
}>;

export function parseGraphCommand(arguments_: readonly string[]): GraphCliParseResult {
  const action = arguments_[0];
  if (action !== "rebuild" && action !== "verify" && action !== "query") {
    return { ok: false, message: "unknown graph action" };
  }
  if (arguments_.length > 32) return { ok: false, message: "too many graph options" };
  let root = ".";
  let index: string | undefined;
  let json = false;
  let persisted = false;
  let fresh = false;
  const request: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (let position = 1; position < arguments_.length; position += 1) {
    const option = arguments_[position]!;
    if (seen.has(option)) return { ok: false, message: "duplicate graph option" };
    seen.add(option);
    if (option === "--json") { json = true; continue; }
    if (option === "--fresh" && action === "rebuild") { fresh = true; continue; }
    if (option === "--persisted" && action === "query") { persisted = true; continue; }
    if (option !== "--root" && option !== "--index"
      && !(action === "query" && ["--program", "--note", "--scope", "--predicate", "--depth", "--limit"].includes(option))) {
      return { ok: false, message: "unknown graph option" };
    }
    const value = arguments_[++position];
    if (value === undefined || value.startsWith("--") || value.length === 0 || Buffer.byteLength(value, "utf8") > 16_384) {
      return { ok: false, message: "graph option requires a bounded value" };
    }
    if (option === "--root") { root = value; continue; }
    if (option === "--index") { index = value; continue; }
    if (option === "--depth" || option === "--limit") {
      if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
        return { ok: false, message: "graph count must be a positive integer" };
      }
      if (option === "--depth") request.depth = Number(value);
      else request.limits = { rows: Number(value) };
    } else request[option.slice(2)] = value;
  }
  const base = { root, ...(index === undefined ? {} : { index }), json };
  if (action === "rebuild") return { ok: true, value: { kind: "graph-rebuild", ...base, fresh } };
  if (action === "verify") return { ok: true, value: { kind: "graph-verify", ...base } };
  try {
    return { ok: true, value: { kind: "graph-query", ...base, persisted, request: validateGraphQueryRequest(request) } };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "invalid graph query" };
  }
}

export async function executeGraphCommand(
  command: GraphCliCommand,
  dependencies: GraphCliDependencies = {},
): Promise<Readonly<{ value: GraphQueryResult | GraphVerification; text: string; exitCode: number }>> {
  const options = command.index === undefined ? {} : { index: command.index };
  if (command.kind === "graph-query") {
    const value = await (dependencies.queryGraph ?? queryGraph)(command.root, command.request, {
      ...options, persisted: command.persisted,
    });
    const lines = [
      `${value.request.program}: ${value.rows.length} derived graph rows.`,
      `Snapshot: ${value.revision}`,
      "Proofs and exact source record digests are included in --json output.",
      value.columns.join("\t"),
      ...value.rows.map((row) => row.values.map((atom) => JSON.stringify(atom)).join("\t")),
    ];
    if (value.truncated || value.proofsTruncated) {
      lines.push(`Partial result: ${value.truncationReasons.join(", ") || "proof evidence was truncated"}.`);
    }
    return { value, text: `${lines.join("\n")}\n`, exitCode: value.truncated || value.proofsTruncated ? 4 : 0 };
  }
  const value = command.kind === "graph-rebuild"
    ? await (dependencies.rebuildGraph ?? rebuildGraph)(command.root, { ...options, fresh: command.fresh })
    : await (dependencies.verifyGraph ?? verifyGraph)(command.root, options);
  return {
    value,
    text: `${command.kind === "graph-rebuild" ? "Rebuilt" : "Verified"} the local graph projection: ${value.records} notes, ${value.facts} facts.\nSnapshot: ${value.revision}\n`,
    exitCode: 0,
  };
}
