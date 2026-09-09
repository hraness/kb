import type {
  AuthoringOptions, CreateConceptNoteInput, CreateNoteInput, NoteAuthoringResult,
  NoteRelation, NoteRevision,
} from "./authoring-model.js";
import { canonicalNoteId, frontmatter, relationsFromParts } from "./authoring-model.js";
import {
  assertNoInterruptedRecovery, nativeAuthoringPlatform, readSnapshot, resolveVault,
} from "./authoring-platform.js";
import { createNoteProgram, editNoteRelationProgram } from "./authoring-program.js";
import { runAuthoring } from "./authoring-runtime.js";

export {
  InvalidCanonicalNoteIdError, NoteAlreadyExistsError, NoteRecoveryRequiredError,
  NoteRevisionConflictError, canonicalNoteId, canonicalRelationTarget, normalizeRelationPredicate,
} from "./authoring-model.js";
export type {
  AuthoringDependencies, AuthoringInstallContext, AuthoringOptions,
  CreateConceptNoteInput, CreateNoteInput, NoteAuthoringResult, NoteRelation, NoteRevision,
} from "./authoring-model.js";

/**
 * Read the content revision used by optimistic authoring operations.
 *
 * Revisions intentionally describe UTF-8 bytes, while installation also
 * checks inode and timestamps to detect same-content replacement races.
 */
export async function noteRevision(root: string, id: string): Promise<NoteRevision> {
  const vault = await resolveVault(root);
  const canonicalId = canonicalNoteId(id);
  await assertNoInterruptedRecovery(vault, canonicalId);
  return (await readSnapshot(vault, canonicalId)).revision;
}

/** List exact outbound relation declarations without taking an authoring lock. */
export async function listNoteRelations(root: string, sourceId: string): Promise<readonly NoteRelation[]> {
  const vault = await resolveVault(root);
  const canonicalId = canonicalNoteId(sourceId);
  await assertNoInterruptedRecovery(vault, canonicalId);
  const source = await readSnapshot(vault, canonicalId);
  return relationsFromParts(frontmatter(source.content, source.relativePath), source.relativePath);
}

/**
 * Create one ordinary Markdown note. Existing compatible notes are an
 * idempotent success and are never rewritten.
 *
 * Parent directories must already exist as real in-vault directories. This
 * keeps the operation's durable write set to exactly one note.
 */
export async function createNote(
  root: string, input: CreateNoteInput, options: AuthoringOptions = {},
): Promise<NoteAuthoringResult> {
  return runAuthoring(createNoteProgram(nativeAuthoringPlatform, root, input, options));
}

/** Create an ordinary `type: concept` Markdown note. */
export async function createConceptNote(
  root: string, input: CreateConceptNoteInput, options: AuthoringOptions = {},
): Promise<NoteAuthoringResult> {
  return createNote(root, { ...input, type: "concept" }, options);
}

/** Add one exact outbound typed relation, idempotently. */
export async function addNoteRelation(
  root: string, sourceId: string, predicate: string, targetId: string, options: AuthoringOptions = {},
): Promise<NoteAuthoringResult> {
  return runAuthoring(editNoteRelationProgram(nativeAuthoringPlatform, "add", root, sourceId, predicate, targetId, options));
}

/** Remove one exact outbound typed relation, idempotently. */
export async function removeNoteRelation(
  root: string, sourceId: string, predicate: string, targetId: string, options: AuthoringOptions = {},
): Promise<NoteAuthoringResult> {
  return runAuthoring(editNoteRelationProgram(nativeAuthoringPlatform, "remove", root, sourceId, predicate, targetId, options));
}
