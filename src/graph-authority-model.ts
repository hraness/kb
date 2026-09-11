/** Wordcell-owned graph protocol. Vendor record and program types stay in the adapter. */
export type GraphAtom = string | number | boolean | null;
export type GraphFactRelation = "wordcell.note" | "wordcell.link" | "wordcell.relation"
  | "wordcell.external-relation" | "wordcell.tag" | "wordcell.scope" | "wordcell.concept";

export type GraphFact = Readonly<{ relation: GraphFactRelation; tuple: readonly GraphAtom[] }>;
export type GraphSourceRecord = Readonly<{
  key: string;
  id: string;
  path: string;
  documentId: string | null;
  contentSha256: string;
  facts: readonly GraphFact[];
}>;
export type GraphSnapshot = Readonly<{
  schemaVersion: 1;
  vaultIdentity: string;
  revision: string;
  catalogNoteId: string;
  sourceDigests: readonly Readonly<{ path: string; contentSha256: string }>[];
  records: readonly GraphSourceRecord[];
  factCount: number;
}>;

export const GRAPH_LIMITS = Object.freeze({
  notes: 4_000,
  facts: 100_000,
  sourceBytes: 64 * 1024 * 1024,
  atomBytes: 16 * 1024,
  depth: 8,
  rows: 1_000,
  workUnits: 8_000_000,
  derivedTuples: 100_000,
  rounds: 64,
  proofDepth: 64,
  proofNodes: 4_096,
  totalProofNodes: 32_768,
  resultBytes: 8 * 1024 * 1024,
});

export type GraphQueryLimits = Readonly<{
  rows?: number;
  workUnits?: number;
  derivedTuples?: number;
  rounds?: number;
  proofDepth?: number;
  proofNodes?: number;
  totalProofNodes?: number;
  resultBytes?: number;
}>;

export type GraphProgramRequest =
  | Readonly<{ program: "backlinks"; note: string }>
  | Readonly<{ program: "reachability"; note: string; depth?: number }>
  | Readonly<{ program: "scope-route"; scope: string }>
  | Readonly<{ program: "relation-closure"; note: string; predicate: string; depth?: number }>
  | Readonly<{ program: "shared-tags"; note: string }>
  | Readonly<{ program: "shared-concepts"; note: string }>;
export type GraphQueryRequest = GraphProgramRequest & Readonly<{ limits?: GraphQueryLimits }>;

export type GraphProofSource = Readonly<{
  key: string;
  recordSha256: string;
  noteId: string;
  path: string;
  contentSha256: string;
}>;
export type GraphProof =
  | Readonly<{ kind: "fact"; relation: string; tuple: readonly GraphAtom[]; sources: readonly GraphProofSource[] }>
  | Readonly<{ kind: "derived"; relation: string; tuple: readonly GraphAtom[]; ruleId: string;
      ruleSha256: string; premises: readonly GraphProof[]; premisesTruncated: boolean }>
  | Readonly<{ kind: "truncated"; relation: string; tuple: readonly GraphAtom[]; reason: "cycle" | "depth" | "nodes" }>;

export type GraphQueryResult = Readonly<{
  schemaVersion: 1;
  authority: "derived";
  vaultIdentity: string;
  revision: string;
  projectionSha256: string;
  request: GraphQueryRequest;
  columns: readonly string[];
  rows: readonly Readonly<{ values: readonly GraphAtom[]; proofs: readonly GraphProof[];
    proofsTruncated: boolean; supportCount: number }>[];
  limits: Required<GraphQueryLimits>;
  truncated: boolean;
  proofsTruncated: boolean;
  truncationReasons: readonly string[];
  stats: Readonly<{ baseFacts: number; derivedFacts: number; workUnits: number;
    rounds: number; proofNodes: number; queryMatches: number }>;
}>;

export type GraphVerification = Readonly<{
  schemaVersion: 1;
  status: "verified";
  vaultIdentity: string;
  revision: string;
  records: number;
  facts: number;
}>;

export interface GraphAuthority {
  query(request: GraphQueryRequest): Promise<GraphQueryResult>;
  /** Re-evaluate a bounded result against this authority; foreign or stale evidence is rejected. */
  verifyResult(value: unknown): Promise<boolean>;
  verify(): Promise<GraphVerification>;
  close(): Promise<void>;
}

export class GraphAuthorityError extends Error {
  readonly code: "invalid-input" | "budget" | "stale" | "unsafe-cache" | "corrupt-cache" | "closed";
  constructor(code: GraphAuthorityError["code"], message: string) {
    super(message);
    this.name = "GraphAuthorityError";
    this.code = code;
  }
}
