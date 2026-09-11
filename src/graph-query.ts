import { isProxy } from "node:util/types";
import { isCanonicalNoteId, isCanonicalRelationPredicate } from "./graph.js";
import {
  GRAPH_LIMITS,
  GraphAuthorityError,
  type GraphQueryLimits,
  type GraphQueryRequest,
} from "./graph-authority-model.js";
import type { PercolateOptions } from "./percolate.js";
import { validateRepositoryScopeSelection } from "./repository-memory.js";

function invalid(message: string): never {
  throw new GraphAuthorityError("invalid-input", message);
}

function dataObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || isProxy(value) || Array.isArray(value)) {
    return invalid(`${label} must be a plain data object.`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(`${label} must be a plain data object.`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length > 16) return invalid(`${label} contains too many fields.`);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string") return invalid(`${label} must have only named data fields.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      return invalid(`${label} must have only enumerable data fields.`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > GRAPH_LIMITS.atomBytes) {
    return invalid(`${label} must be a bounded string.`);
  }
  return value;
}

function boundedInteger(value: unknown, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    return invalid(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return value;
}

function checkedLimits(value: unknown): GraphQueryLimits {
  const input = dataObject(value, "Graph query limits");
  const result: Record<string, number> = {};
  const keys = ["rows", "workUnits", "derivedTuples", "rounds", "proofDepth", "proofNodes",
    "totalProofNodes", "resultBytes"] as const;
  for (const key of Object.keys(input)) {
    if (!(keys as readonly string[]).includes(key)) return invalid("Unknown graph query limit.");
  }
  for (const key of keys) {
    if (Object.hasOwn(input, key)) {
      result[key] = boundedInteger(input[key], GRAPH_LIMITS[key], `Graph query ${key}`);
    }
  }
  return Object.freeze(result);
}

/** Validate and copy a named query before any scan, store open, or asynchronous work. */
export function validateGraphQueryRequest(value: unknown): GraphQueryRequest {
  const input = dataObject(value, "Graph query");
  const program = input.program;
  if (program !== "backlinks" && program !== "reachability" && program !== "scope-route"
    && program !== "relation-closure" && program !== "shared-tags" && program !== "shared-concepts") {
    return invalid("Graph query requires a supported named program.");
  }
  const allowed = new Set(["program", "limits", program === "scope-route" ? "scope" : "note"]);
  if (program === "reachability" || program === "relation-closure") allowed.add("depth");
  if (program === "relation-closure") allowed.add("predicate");
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return invalid("Graph query contains an option unsupported by its named program.");
  }
  const limits = Object.hasOwn(input, "limits") ? checkedLimits(input.limits) : undefined;
  const extras = limits === undefined ? {} : { limits };
  if (program === "scope-route") {
    const scope = boundedText(input.scope, "Graph query scope");
    try { validateRepositoryScopeSelection([scope]); } catch {
      return invalid("Graph query scope must be an exact canonical repository path.");
    }
    return Object.freeze({ program, scope, ...extras });
  }
  const note = boundedText(input.note, "Graph query note");
  if (!isCanonicalNoteId(note)) return invalid("Graph query note must be an exact canonical note ID.");
  const depth = Object.hasOwn(input, "depth")
    ? boundedInteger(input.depth, GRAPH_LIMITS.depth, "Graph query depth") : undefined;
  const depthOption = depth === undefined ? {} : { depth };
  if (program === "relation-closure") {
    const predicate = boundedText(input.predicate, "Graph query predicate");
    if (!isCanonicalRelationPredicate(predicate)) {
      return invalid("Graph query predicate must be an exact lower-kebab relation predicate.");
    }
    return Object.freeze({ program, note, predicate, ...depthOption, ...extras });
  }
  if (program === "reachability") return Object.freeze({ program, note, ...depthOption, ...extras });
  return Object.freeze({ program, note, ...extras });
}

/** Copy bounded advisory options without evaluating foreign getters. Note lookup remains Wordcell-owned. */
export function validateGraphPercolationOptions(value: unknown): PercolateOptions & Readonly<{ note: string }> {
  const input = dataObject(value, "Graph percolation options");
  if (Object.keys(input).some((key) => !["note", "minSupport", "limit"].includes(key))) {
    return invalid("Unknown graph percolation option.");
  }
  const note = boundedText(input.note, "Graph percolation note");
  if (note.trim() === "") return invalid("Graph percolation requires one note.");
  const minSupport = Object.hasOwn(input, "minSupport")
    ? boundedInteger(input.minSupport, 1_000, "Graph percolation minSupport") : undefined;
  if (minSupport === 1) return invalid("Graph percolation minSupport must be at least 2.");
  const limit = Object.hasOwn(input, "limit")
    ? boundedInteger(input.limit, 1_000, "Graph percolation limit") : undefined;
  return Object.freeze({ note, ...(minSupport === undefined ? {} : { minSupport }),
    ...(limit === undefined ? {} : { limit }) });
}
