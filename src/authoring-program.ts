import { Effect, Exit } from "effect";

import {
  MAX_NOTE_BYTES, NoteRevisionConflictError, addRelationToParts, assertCompatibleCreate,
  assertExpected, canonicalNoteId, canonicalRelationTarget, checkedExpectedRevision,
  frontmatter, isErrno, normalizeRelationPredicate, noteResult, pathFor, relationsFromParts,
  removeRelationFromParts, renderCreatedNote, renderFrontmatter, revisionFor,
  sameQuarantinedSnapshot, sameSnapshot, withRecoveryPath,
} from "./authoring-model.js";
import type {
  AuthoringDependencies, AuthoringInstallContext, AuthoringOptions, CreateNoteInput,
  DirectoryIdentity, NoteAuthoringResult, NoteRevision, NoteSnapshot, RecoveryLocation, Vault,
} from "./authoring-model.js";
import type { NoteLock } from "./note-lock.js";
import { parseDocumentId } from "./portfolio-identity.js";
import { joinDirectorySyncs } from "./authoring-platform.js";
import type { AuthoringPlatform, TemporaryNoteHandle } from "./authoring-platform.js";
import {
  AuthoringFailure, authoringCauseValue, authoringNative, authoringResource, authoringSync,
} from "./authoring-runtime.js";

const fail = (reason: unknown) => Effect.fail(new AuthoringFailure(reason));

type InstallState = {
  readonly handle: TemporaryNoteHandle;
  readonly path: string;
  readonly relativePath: string;
  readonly directory: string;
  readonly expectedDirectory: DirectoryIdentity;
  readonly temporaryPath: string;
  readonly mode: number;
  readonly bytes: Uint8Array;
  closed: boolean;
  identity: { readonly device: bigint; readonly inode: bigint } | null;
  recovery: RecoveryLocation | null;
  sourceQuarantined: boolean;
  destinationInstalled: boolean;
};

function installBody(
  platform: AuthoringPlatform, vault: Vault, id: string, expected: NoteSnapshot | null,
  lock: NoteLock, dependencies: AuthoringDependencies, state: InstallState,
) {
  return Effect.gen(function*() {
    const { handle, path, relativePath, directory, expectedDirectory, temporaryPath, mode, bytes } = state;
    const created = yield* authoringNative(() => handle.stat({ bigint: true }));
    if (!created.isFile() || created.nlink !== 1n) {
      return yield* fail(new Error("the temporary note target is not a private regular file"));
    }
    const identity = { device: created.dev, inode: created.ino };
    state.identity = identity;
    yield* authoringNative(() => handle.chmod(mode));
    yield* authoringNative(() => handle.writeFile(bytes));
    yield* authoringNative(() => handle.sync());
    const complete = yield* authoringNative(() => handle.stat({ bigint: true }));
    if (!complete.isFile() || complete.nlink !== 1n || complete.dev !== identity.device || complete.ino !== identity.inode) {
      return yield* fail(new Error("the temporary note target changed before installation"));
    }
    yield* authoringNative(() => handle.close());
    state.closed = true;

    yield* authoringNative(() => Promise.resolve(dependencies.beforeInstall?.({
      operation: expected === null ? "create" : "replace", path, temporaryPath,
    })));
    yield* authoringNative(() => lock.assertOwned());
    const current = yield* authoringNative(() => platform.readOptionalSnapshot(vault, id));
    if ((expected === null && current !== null)
      || (expected !== null && (current === null || !sameSnapshot(current, expected)))) {
      return yield* fail(new NoteRevisionConflictError(relativePath, expected?.revision ?? null, current?.revision ?? null));
    }
    yield* authoringNative(() => platform.assertSafeParent(vault, path));
    const temporary = yield* authoringNative(() => platform.statTemporary(temporaryPath));
    if (!temporary.isFile() || temporary.isSymbolicLink() || temporary.nlink !== 1n
      || temporary.dev !== identity.device || temporary.ino !== identity.inode) {
      return yield* fail(new Error("the temporary note target changed before installation"));
    }

    if (expected === null) {
      const context: AuthoringInstallContext = { operation: "create", path, temporaryPath };
      yield* authoringNative(() => Promise.resolve(dependencies.beforeCommit?.(context)));
      yield* authoringNative(() => lock.assertOwned());
      yield* authoringNative(() => platform.assertSameDirectory(vault, path, expectedDirectory));
      const installed = yield* authoringNative(() => platform.installTemporaryWithoutClobber(temporaryPath, path));
      if (!installed) {
        const actual = yield* authoringNative(() => platform.currentRevisionOrNull(vault, id));
        return yield* fail(new NoteRevisionConflictError(relativePath, null, actual));
      }
      state.destinationInstalled = true;
      yield* authoringNative(() => platform.fsyncDirectory(directory));
      return yield* authoringSync(() => revisionFor(bytes));
    }

    const recovery = yield* authoringNative(() => platform.createRecoveryLocation(vault, path, dependencies));
    state.recovery = recovery;
    const context: Required<AuthoringInstallContext> = {
      operation: "replace", path, temporaryPath, recoveryPath: recovery.path,
    };
    yield* authoringNative(() => Promise.resolve(dependencies.beforeCommit?.(context)));
    yield* authoringNative(() => lock.assertOwned());
    yield* authoringNative(() => platform.assertSameDirectory(vault, path, expectedDirectory));
    yield* authoringNative(() => platform.assertRecoveryLocation(recovery));
    const moved = yield* Effect.exit(authoringNative(() => platform.rename(path, recovery.path)));
    if (Exit.isFailure(moved)) {
      const reason = authoringCauseValue(moved.cause);
      return yield* fail(isErrno(reason, "ENOENT")
        ? new NoteRevisionConflictError(relativePath, expected.revision, null)
        : reason);
    }
    state.sourceQuarantined = true;
    // A first failure cannot release the lock while the sibling still owns a
    // native directory handle. Promise.all's original first failure is retained.
    yield* authoringNative(() => joinDirectorySyncs([directory, recovery.directory], (path) => platform.fsyncDirectory(path)));

    const quarantined = yield* authoringNative(() => platform.readSnapshotAtPath(vault, recovery.path, recovery.relativePath));
    if (!sameQuarantinedSnapshot(quarantined, expected)) {
      return yield* fail(new NoteRevisionConflictError(relativePath, expected.revision, quarantined.revision));
    }
    yield* authoringNative(() => Promise.resolve(dependencies.afterSourceQuarantined?.(context)));
    yield* authoringNative(() => lock.assertOwned());
    yield* authoringNative(() => platform.assertSameDirectory(vault, path, expectedDirectory));
    yield* authoringNative(() => platform.assertRecoveryLocation(recovery));
    const stillQuarantined = yield* authoringNative(() => platform.readSnapshotAtPath(vault, recovery.path, recovery.relativePath));
    if (!sameQuarantinedSnapshot(stillQuarantined, expected)) {
      return yield* fail(new NoteRevisionConflictError(relativePath, expected.revision, stillQuarantined.revision));
    }
    const installed = yield* authoringNative(() => platform.installTemporaryWithoutClobber(temporaryPath, path));
    if (!installed) {
      const actual = yield* authoringNative(() => platform.currentRevisionOrNull(vault, id));
      return yield* fail(new NoteRevisionConflictError(relativePath, expected.revision, actual));
    }
    state.destinationInstalled = true;
    yield* authoringNative(() => platform.fsyncDirectory(directory));
    yield* authoringNative(() => platform.unlink(recovery.path));
    state.sourceQuarantined = false;
    yield* authoringNative(() => platform.fsyncDirectory(recovery.directory));
    yield* authoringNative(() => platform.removeRecoveryDirectory(recovery, directory));
    state.recovery = null;
    yield* authoringNative(() => platform.fsyncDirectory(directory));
    return yield* authoringSync(() => revisionFor(bytes));
  });
}

function recoverInstall(platform: AuthoringPlatform, vault: Vault, state: InstallState, error: unknown) {
  return Effect.gen(function*() {
    if (state.recovery !== null && state.sourceQuarantined && !state.destinationInstalled) {
      const recovery = state.recovery;
      const restored = yield* Effect.exit(authoringNative(() => platform.restoreQuarantinedSource(
        vault, recovery, state.path, state.expectedDirectory,
      )));
      if (Exit.isFailure(restored)) {
        return yield* fail(withRecoveryPath(new AggregateError(
          [error, authoringCauseValue(restored.cause)],
          "authoring failed and the prior source could not be restored",
        ), state.relativePath, recovery.relativePath));
      }
      if (restored.value) {
        state.sourceQuarantined = false;
        state.recovery = null;
      }
    }
    if (state.recovery !== null && state.sourceQuarantined) {
      return yield* fail(withRecoveryPath(error, state.relativePath, state.recovery.relativePath));
    }
    if (state.recovery !== null) {
      const recovery = state.recovery;
      const cleaned = yield* Effect.exit(authoringNative(() => platform.removeRecoveryDirectory(recovery, state.directory)));
      if (Exit.isSuccess(cleaned)) state.recovery = null;
      else {
        const cleanupError = authoringCauseValue(cleaned.cause);
        if (!isErrno(cleanupError, "ENOENT")) {
          return yield* fail(new AggregateError(
            [error, cleanupError], "authoring failed and its empty recovery directory could not be removed",
          ));
        }
      }
    }
    return yield* fail(error);
  });
}

function installNote(
  platform: AuthoringPlatform, vault: Vault, id: string, content: string,
  expected: NoteSnapshot | null, lock: NoteLock, dependencies: AuthoringDependencies,
): Effect.Effect<NoteRevision, AuthoringFailure> {
  return Effect.gen(function*() {
    const { path, relativePath } = yield* authoringSync(() => pathFor(vault, id));
    yield* authoringNative(() => platform.assertSafeParent(vault, path));
    const bytes = yield* authoringSync(() => new TextEncoder().encode(content));
    if (bytes.byteLength > MAX_NOTE_BYTES) return yield* fail(new Error("the rendered note is too large for bounded authoring"));
    const directory = yield* authoringSync(() => platform.directoryPath(path));
    const expectedDirectory = yield* authoringNative(() => platform.directoryIdentity(vault, path));
    const temporaryPath = yield* authoringSync(() => platform.temporaryPath(path, dependencies));
    const mode = expected?.mode ?? 0o644;
    return yield* authoringResource(
      authoringNative(() => platform.openTemporary(temporaryPath, mode)).pipe(Effect.map((handle): InstallState => ({
        handle, path, relativePath, directory, expectedDirectory, temporaryPath, mode, bytes,
        closed: false, identity: null, recovery: null, sourceQuarantined: false, destinationInstalled: false,
      }))),
      (state) => Effect.gen(function*() {
        const body = yield* Effect.exit(installBody(platform, vault, id, expected, lock, dependencies, state));
        if (Exit.isSuccess(body)) return body.value;
        return yield* recoverInstall(platform, vault, state, authoringCauseValue(body.cause));
      }),
      (state) => Effect.gen(function*() {
        // Legacy fallback close is best effort. Temporary cleanup remains a
        // required finally and may supersede the selected operation failure.
        if (!state.closed) yield* Effect.exit(authoringNative(() => state.handle.close())).pipe(Effect.asVoid);
        yield* authoringNative(() => platform.cleanupTemporary(temporaryPath, state.identity));
      }),
    );
  });
}

export function createNoteProgram(
  platform: AuthoringPlatform, root: string, input: CreateNoteInput, options: AuthoringOptions,
): Effect.Effect<NoteAuthoringResult, AuthoringFailure> {
  return Effect.gen(function*() {
    const vault = yield* authoringNative(() => platform.resolveVault(root));
    const id = yield* authoringSync(() => canonicalNoteId(input.id));
    const requestedDocumentId = yield* authoringSync(() => input.documentId === undefined ? undefined : parseDocumentId(input.documentId));
    const expected = yield* authoringSync(() => checkedExpectedRevision(options));
    const dependencies = yield* authoringSync(() => platform.dependenciesFor(options.dependencies));
    return yield* authoringResource(
      authoringNative(() => platform.acquireNoteLock(vault.root, id, options.lock)),
      (lock) => Effect.gen(function*() {
        yield* authoringNative(() => platform.recoverInterruptedAuthoring(vault, id, lock));
        const existing = yield* authoringNative(() => platform.readOptionalSnapshot(vault, id));
        if (existing !== null) {
          yield* authoringSync(() => assertExpected(existing, expected));
          const compatible = yield* authoringSync(() => assertCompatibleCreate(existing, input, requestedDocumentId));
          return yield* authoringSync(() => noteResult(existing, compatible.relations, false, compatible.documentId));
        }
        if (expected !== undefined) return yield* fail(new NoteRevisionConflictError(`${id}.md`, expected, null));
        const documentId = yield* authoringSync(() => requestedDocumentId ?? parseDocumentId(dependencies.documentId()));
        const content = yield* authoringSync(() => renderCreatedNote(input, documentId));
        const revision = yield* installNote(platform, vault, id, content, null, lock, dependencies);
        return { changed: true, path: `${id}.md`, revision, relations: [], documentId };
      }),
      (lock) => authoringNative(() => lock.release()),
    );
  });
}

export function editNoteRelationProgram(
  platform: AuthoringPlatform, operation: "add" | "remove", root: string,
  sourceIdInput: string, predicateInput: string, targetIdInput: string, options: AuthoringOptions,
): Effect.Effect<NoteAuthoringResult, AuthoringFailure> {
  return Effect.gen(function*() {
    const vault = yield* authoringNative(() => platform.resolveVault(root));
    const sourceId = yield* authoringSync(() => canonicalNoteId(sourceIdInput));
    const targetId = yield* authoringSync(() => canonicalRelationTarget(targetIdInput));
    const predicate = yield* authoringSync(() => normalizeRelationPredicate(predicateInput));
    const expected = yield* authoringSync(() => checkedExpectedRevision(options));
    const dependencies = yield* authoringSync(() => platform.dependenciesFor(options.dependencies));
    return yield* authoringResource(
      authoringNative(() => platform.acquireNoteLock(vault.root, sourceId, options.lock)),
      (lock) => Effect.gen(function*() {
        yield* authoringNative(() => platform.recoverInterruptedAuthoring(vault, sourceId, lock));
        const source = yield* authoringNative(() => platform.readSnapshot(vault, sourceId));
        yield* authoringSync(() => assertExpected(source, expected));
        if (operation === "add" && !targetId.startsWith("kb://") && targetId !== sourceId) {
          yield* authoringNative(() => platform.readSnapshot(vault, targetId)).pipe(Effect.asVoid);
        }
        const parts = yield* authoringSync(() => frontmatter(source.content, source.relativePath));
        if (operation === "add") yield* authoringSync(() => relationsFromParts(parts, source.relativePath)).pipe(Effect.asVoid);
        const changed = yield* authoringSync(() => operation === "add"
          ? addRelationToParts(parts, source.relativePath, predicate, targetId)
          : removeRelationFromParts(parts, source.relativePath, predicate, targetId, sourceId));
        if (!changed) return yield* authoringSync(() => noteResult(source, relationsFromParts(parts, source.relativePath), false));
        const content = yield* authoringSync(() => renderFrontmatter(parts));
        const relations = yield* authoringSync(() => relationsFromParts(frontmatter(content, source.relativePath), source.relativePath));
        const revision = yield* installNote(platform, vault, sourceId, content, source, lock, dependencies);
        return { changed: true, path: source.relativePath, revision, relations };
      }),
      (lock) => authoringNative(() => lock.release()),
    );
  });
}
