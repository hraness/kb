import {
  createOhProjectionLiteralV1 as literal,
  createOhProjectionQueryV1,
  createOhProjectionRulePackV1,
  createOhProjectionRuleV1,
  ohProjectionConstantV1 as constant,
  ohProjectionVariableV1 as variable,
  type OhProjectionLiteralV1,
  type OhProjectionRuleV1,
  type OhProjectionTermV1,
} from "@hraness/oh/projection";
import { type GraphQueryLimits, type GraphQueryRequest } from "../graph-authority-model";
import { validateGraphQueryRequest } from "../graph-query";
import { detachedData } from "./validation";

export const DEFAULT_GRAPH_QUERY_LIMITS: Required<GraphQueryLimits> = Object.freeze({
  rows: 100, workUnits: 1_000_000, derivedTuples: 50_000, rounds: 32,
  proofDepth: 32, proofNodes: 256, totalProofNodes: 8_192, resultBytes: 1_048_576,
});

/** Validate before scanning a vault or opening any storage. Returned requests include all defaults. */
export function normalizeGraphQueryRequest(input: unknown): GraphQueryRequest {
  const request = validateGraphQueryRequest(detachedData(input, 64 * 1024));
  const depth = request.program === "reachability" || request.program === "relation-closure"
    ? { depth: request.depth ?? 3 } : {};
  return Object.freeze({ ...request, ...depth,
    limits: Object.freeze({ ...DEFAULT_GRAPH_QUERY_LIMITS, ...request.limits }) });
}

const atom = (relation: string, ...terms: OhProjectionTermV1[]) => literal({ relation, terms });

export function compileGraphProgram(request: GraphQueryRequest) {
  const rules: OhProjectionRuleV1[] = [];
  const add = (ruleId: string, head: OhProjectionLiteralV1, ...body: OhProjectionLiteralV1[]) => {
    rules.push(createOhProjectionRuleV1({ ruleId: `wordcell.${ruleId}`, head, body }));
  };
  const a = variable("source"), b = variable("target"), line = variable("line"), predicate = variable("predicate");
  let columns: string[];
  let where: OhProjectionLiteralV1[];
  switch (request.program) {
    case "backlinks": {
      add("backlink.link", atom("wordcell.answer", a, b, line, constant("link"), constant("")), atom("wordcell.link", a, b, line));
      add("backlink.relation", atom("wordcell.answer", a, b, line, constant("relation"), predicate), atom("wordcell.relation", a, b, predicate, line));
      columns = ["source", "target", "line", "kind", "predicate"];
      where = [atom("wordcell.answer", a, b, line, variable("kind"), predicate), atom("wordcell.selected", b)];
      break;
    }
    case "reachability":
    case "relation-closure": {
      const relation = request.program === "relation-closure";
      const edge = "wordcell.edge";
      if (relation) add("edge.relation", atom(edge, a, b), atom("wordcell.relation", a, b, constant(request.predicate), line));
      else {
        add("edge.link", atom(edge, a, b), atom("wordcell.link", a, b, line));
        add("edge.relation", atom(edge, a, b), atom("wordcell.relation", a, b, predicate, line));
      }
      const source = constant(request.note);
      // Positive walks of exact lengths 1..depth. Cycles may return the starting note,
      // and a destination reached at different lengths produces one row per length.
      add("walk.1", atom("wordcell.walk.1", b), atom(edge, source, b));
      for (let depth = 1; depth <= (request.depth ?? 3); depth += 1) {
        if (depth > 1) add(`walk.${depth}`, atom(`wordcell.walk.${depth}`, b), atom(`wordcell.walk.${depth - 1}`, a), atom(edge, a, b));
        add(`walk.answer.${depth}`, atom("wordcell.answer", source, b, constant(depth)), atom(`wordcell.walk.${depth}`, b));
      }
      columns = ["source", "target", "depth"];
      where = [atom("wordcell.answer", a, b, variable("depth"))];
      break;
    }
    case "scope-route": {
      add("scope", atom("wordcell.answer", a, constant(request.scope)), atom("wordcell.scope", a, constant(request.scope)));
      columns = ["note", "scope"];
      where = [atom("wordcell.answer", variable("note"), variable("scope"))];
      break;
    }
    case "shared-tags": {
      const note = variable("note"), other = variable("other"), tag = variable("tag");
      add("shared.tags", atom("wordcell.answer", note, other, tag), atom("wordcell.selected", note), atom("wordcell.tag", note, tag), atom("wordcell.tag", other, tag), atom("wordcell.peer", other));
      columns = ["note", "other", "tag"];
      where = [atom("wordcell.answer", note, other, tag)];
      break;
    }
    case "shared-concepts": {
      const note = variable("note"), other = variable("other"), concept = variable("concept");
      add("concept.link", atom("wordcell.concept-edge", a, b), atom("wordcell.link", a, b, line), atom("wordcell.concept", b));
      add("concept.relation", atom("wordcell.concept-edge", a, b), atom("wordcell.relation", a, b, predicate, line), atom("wordcell.concept", b));
      add("concept.reverse-link", atom("wordcell.concept-edge", a, b), atom("wordcell.link", b, a, line), atom("wordcell.concept", b));
      add("concept.reverse-relation", atom("wordcell.concept-edge", a, b), atom("wordcell.relation", b, a, predicate, line), atom("wordcell.concept", b));
      add("shared.concepts", atom("wordcell.answer", note, other, concept), atom("wordcell.selected", note), atom("wordcell.ordinary", note), atom("wordcell.concept-edge", note, concept), atom("wordcell.concept-edge", other, concept), atom("wordcell.peer", other), atom("wordcell.ordinary", other));
      columns = ["note", "other", "concept"];
      where = [atom("wordcell.answer", note, other, concept)];
      break;
    }
  }
  return {
    columns,
    query: createOhProjectionQueryV1({ queryId: `wordcell.${request.program}`, find: columns, where, limit: request.limits?.rows ?? DEFAULT_GRAPH_QUERY_LIMITS.rows }),
    rulePack: createOhProjectionRulePackV1({ rulePackId: `wordcell.${request.program}`, rulePackRevision: 1, rules }),
  };
}
