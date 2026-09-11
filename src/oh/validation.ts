import { isProxy } from "node:util/types";
import { canonicalJson } from "@hraness/oh";
import { GraphAuthorityError } from "../graph-authority-model";

/** Detach foreign data without invoking getters, prototypes, proxies or toJSON. */
export function detachedData(input: unknown, maximumBytes: number): unknown {
  const seen = new Set<object>();
  let nodes = 0, bytes = 0;
  function visit(value: unknown, depth: number): unknown {
    nodes += 1;
    if (nodes > 1_000_000 || depth > 192) throw new GraphAuthorityError("budget", "Graph input exceeds structural bounds.");
    if (value === null || typeof value === "boolean") { bytes += 5; return value; }
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value) + 2;
      if (bytes > maximumBytes) throw new GraphAuthorityError("budget", "Graph input exceeds its byte bound.");
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) { bytes += 32; return value; }
    if (typeof value !== "object" || value === null || isProxy(value) || seen.has(value)) throw new GraphAuthorityError("invalid-input", "Graph input must be acyclic plain data.");
    seen.add(value);
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new GraphAuthorityError("invalid-input", "Graph input must contain plain objects.");
    const keys = Reflect.ownKeys(value);
    if (keys.length > 200_000 || keys.some(key => typeof key !== "string")) throw new GraphAuthorityError("budget", "Graph input has too many fields.");
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    if (array && keys.length !== value.length + 1) throw new GraphAuthorityError("invalid-input", "Graph arrays must be dense.");
    for (const key of keys as string[]) {
      if (array && key === "length") continue;
      if (array && (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length)) throw new GraphAuthorityError("invalid-input", "Graph array has extra fields.");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) throw new GraphAuthorityError("invalid-input", "Graph input accessors are forbidden.");
      bytes += Buffer.byteLength(key) + 4;
      if (bytes > maximumBytes) throw new GraphAuthorityError("budget", "Graph input exceeds its byte bound.");
      output[key] = visit(descriptor.value, depth + 1);
    }
    seen.delete(value);
    return array ? Array.from({ length: (value as unknown[]).length }, (_, index) => output[String(index)]) : output;
  }
  const value = visit(input, 0);
  try {
    const encoded = canonicalJson(value);
    if (Buffer.byteLength(encoded) > maximumBytes) throw new GraphAuthorityError("budget", "Graph input exceeds its canonical byte bound.");
    return JSON.parse(encoded) as unknown;
  } catch (error) {
    if (error instanceof GraphAuthorityError) throw error;
    throw new GraphAuthorityError("invalid-input", "Graph input is not canonical JSON data.");
  }
}

export function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const keys = Object.keys(value);
  if (required.some(key => !keys.includes(key)) || keys.some(key => !required.includes(key) && !optional.includes(key))) throw new GraphAuthorityError("invalid-input", "Graph input has missing or unexpected fields.");
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}
