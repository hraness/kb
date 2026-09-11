// @bun
import {
  createGraphSnapshot,
  openGraphAuthority
} from "./index-bcfn9xah.js";
import {
  GraphAuthorityError,
  validateGraphPercolationOptions
} from "./index-11621h23.js";
import {
  percolateVault
} from "./index-nd6nynv2.js";
import {
  analyzeVault,
  lookupNote,
  parseNote
} from "./index-ekpwvbra.js";

// src/graph-percolation.ts
async function percolateWithGraph(snapshot, options) {
  options = validateGraphPercolationOptions(options);
  const graph = createGraphSnapshot(snapshot);
  const notes = snapshot.notes.map((note) => parseNote(note.path, note.content));
  const selected = lookupNote(notes, options.note);
  if (selected.kind !== "found" || !graph.records.some((record) => record.id === selected.note.id)) {
    throw new GraphAuthorityError("invalid-input", "Proof-backed percolation requires one unambiguous content note.");
  }
  const analysis = analyzeVault(notes, {
    catalogNoteId: graph.catalogNoteId,
    mentionScope: (note) => note.id === selected.note.id,
    maxMentionPairs: 250000
  });
  const suggestions = percolateVault(notes, analysis, options);
  const authority = await openGraphAuthority(snapshot);
  try {
    const limits = { rows: 1000, workUnits: 1e6, resultBytes: 1024 * 1024 };
    const sharedTags = await authority.query({ program: "shared-tags", note: selected.note.id, limits });
    const sharedConcepts = await authority.query({ program: "shared-concepts", note: selected.note.id, limits });
    return Object.freeze({
      schemaVersion: 1,
      kind: "wordcell.graph-percolation",
      revision: graph.revision,
      suggestions,
      positiveSupport: Object.freeze({ sharedTags, sharedConcepts })
    });
  } finally {
    await authority.close();
  }
}

export { percolateWithGraph };
