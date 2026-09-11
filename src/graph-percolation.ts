import { analyzeVault, lookupNote, parseNote } from "./graph.js";
import { createGraphSnapshot, openGraphAuthority, GraphAuthorityError } from "./graph-authority.js";
import type { GraphQueryResult } from "./graph-authority.js";
import { validateGraphPercolationOptions } from "./graph-query.js";
import { percolateVault } from "./percolate.js";
import type { PercolateOptions, PercolationResultV2 } from "./percolate.js";
import type { VaultSnapshot } from "./vault.js";

export type GraphPercolationResult = Readonly<{
  schemaVersion: 1;
  kind: "wordcell.graph-percolation";
  revision: string;
  suggestions: PercolationResultV2;
  /** Positive shared-tag/concept support only. Absence, counts and predicate decisions remain host-owned. */
  positiveSupport: Readonly<{ sharedTags: GraphQueryResult; sharedConcepts: GraphQueryResult }>;
}>;

/** Add bounded, separately inspectable positive proofs without changing percolation V2 candidates. */
export async function percolateWithGraph(snapshot: VaultSnapshot,
  options: PercolateOptions & Readonly<{ note: string }>): Promise<GraphPercolationResult> {
  options = validateGraphPercolationOptions(options);
  const graph = createGraphSnapshot(snapshot);
  const notes = snapshot.notes.map(note => parseNote(note.path, note.content));
  const selected = lookupNote(notes, options.note);
  if (selected.kind !== "found" || !graph.records.some(record => record.id === selected.note.id)) {
    throw new GraphAuthorityError("invalid-input", "Proof-backed percolation requires one unambiguous content note.");
  }
  const analysis = analyzeVault(notes, { catalogNoteId: graph.catalogNoteId,
    mentionScope: note => note.id === selected.note.id, maxMentionPairs: 250_000 });
  const suggestions = percolateVault(notes, analysis, options);
  const authority = await openGraphAuthority(snapshot);
  try {
    const limits = { rows: 1_000, workUnits: 1_000_000, resultBytes: 1024 * 1024 };
    const sharedTags = await authority.query({ program: "shared-tags", note: selected.note.id, limits });
    const sharedConcepts = await authority.query({ program: "shared-concepts", note: selected.note.id, limits });
    return Object.freeze({ schemaVersion: 1, kind: "wordcell.graph-percolation", revision: graph.revision,
      suggestions, positiveSupport: Object.freeze({ sharedTags, sharedConcepts }) });
  } finally { await authority.close(); }
}
