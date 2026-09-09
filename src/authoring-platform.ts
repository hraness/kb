import { acquireNoteLock } from "./note-lock.js";
import { rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { type NoteLock } from "./note-lock.js";
import { MAX_NOTE_BYTES, MAX_PARENT_DIRECTORY_ENTRIES, MAX_RECOVERY_LOCATIONS_PER_NOTE, type NoteRevision, type AuthoringDependencies, NoteRecoveryRequiredError, type Vault, type NoteSnapshot, isErrno, sha256, revisionFor, inside, pathFor, type RecoveryLocation, type DirectoryIdentity, recoveryRelativePath } from "./authoring-model.js";

export async function resolveVault(rootInput: string): Promise<Vault> {
  const root = await realpath(resolve(rootInput));
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("the vault root must be a real directory");
  }
  if (dirname(root) === root) {
    throw new Error("refusing to author notes in a filesystem root");
  }
  return { root };
}

export async function assertExactDirectoryEntry(
  directory: string,
  name: string,
): Promise<void> {
  const entries = await readdir(directory);
  if (!entries.includes(name)) {
    const error = new Error(`vault path component is not exact: ${name}`) as Error & {
      code?: string;
    };
    error.code = "ENOENT";
    throw error;
  }
}

export async function assertSafeParent(vault: Vault, path: string): Promise<void> {
  if (!inside(vault.root, path)) {
    throw new Error("the note path must remain inside the vault");
  }
  const parent = dirname(path);
  const segments = relative(vault.root, parent).split(sep).filter(Boolean);
  let current = vault.root;
  for (const segment of segments) {
    await assertExactDirectoryEntry(current, segment);
    current = join(current, segment);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error("the note path must not traverse a symbolic link");
    }
    if (!metadata.isDirectory()) {
      throw new Error("every note parent must be a directory");
    }
  }
  const canonicalParent = await realpath(parent);
  if (canonicalParent !== parent || !inside(vault.root, join(canonicalParent, basename(path)))) {
    throw new Error("the note parent resolves outside the vault");
  }
}

export async function readSnapshotAtPath(
  vault: Vault,
  path: string,
  relativePath: string,
): Promise<NoteSnapshot> {
  await assertSafeParent(vault, path);
  await assertExactDirectoryEntry(dirname(path), basename(path));

  const beforeOpen = await lstat(path, { bigint: true });
  if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink()) {
    throw new Error("the note target must be a regular file");
  }
  if (beforeOpen.nlink !== 1n) {
    throw new Error("the note target must not be hard-linked");
  }
  if (beforeOpen.size > BigInt(MAX_NOTE_BYTES)) {
    throw new Error("the note is too large for bounded authoring");
  }

  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || opened.dev !== beforeOpen.dev
      || opened.ino !== beforeOpen.ino
      || opened.size !== beforeOpen.size
      || opened.size > BigInt(MAX_NOTE_BYTES)
    ) {
      throw new Error("the note target changed while it was opened");
    }
    const bytes = new Uint8Array(Number(opened.size));
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) {
        throw new Error("the note target changed while it was read");
      }
      offset += result.bytesRead;
    }
    const overflow = new Uint8Array(1);
    if ((await handle.read(overflow, 0, 1, Number(opened.size))).bytesRead !== 0) {
      throw new Error("the note target grew while it was read");
    }

    const finished = await handle.stat({ bigint: true });
    const finalPath = await lstat(path, { bigint: true });
    if (
      !finalPath.isFile()
      || finalPath.isSymbolicLink()
      || finalPath.nlink !== 1n
      || finalPath.dev !== opened.dev
      || finalPath.ino !== opened.ino
      || finalPath.size !== opened.size
      || finished.size !== opened.size
      || finished.mtimeNs !== opened.mtimeNs
      || finished.ctimeNs !== opened.ctimeNs
    ) {
      throw new Error("the note target changed while it was read");
    }
    const canonicalPath = await realpath(path);
    if (canonicalPath !== path || !inside(vault.root, canonicalPath)) {
      throw new Error("the note target resolves outside the vault");
    }

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new Error("the note target is not valid UTF-8", { cause: error });
    }
    return {
      path,
      relativePath,
      content,
      revision: revisionFor(bytes),
      device: opened.dev,
      inode: opened.ino,
      size: opened.size,
      modifiedAtNs: opened.mtimeNs,
      changedAtNs: opened.ctimeNs,
      mode: Number(opened.mode & 0o777n),
    };
  } finally {
    await handle.close();
  }
}

export async function readSnapshot(
  vault: Vault,
  id: string,
): Promise<NoteSnapshot> {
  const { path, relativePath } = pathFor(vault, id);
  return readSnapshotAtPath(vault, path, relativePath);
}

export async function readOptionalSnapshot(
  vault: Vault,
  id: string,
): Promise<NoteSnapshot | null> {
  try {
    return await readSnapshot(vault, id);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  }
}

export function dependenciesFor(
  overrides: Partial<AuthoringDependencies> | undefined,
): AuthoringDependencies {
  return {
    documentId: overrides?.documentId ?? randomUUID,
    token: overrides?.token ?? randomUUID,
    ...(overrides?.beforeInstall === undefined
      ? {}
      : { beforeInstall: overrides.beforeInstall }),
    ...(overrides?.beforeCommit === undefined
      ? {}
      : { beforeCommit: overrides.beforeCommit }),
    ...(overrides?.afterSourceQuarantined === undefined
      ? {}
      : { afterSourceQuarantined: overrides.afterSourceQuarantined }),
  };
}

export async function cleanupTemporary(
  temporaryPath: string,
  identity: { readonly device: bigint; readonly inode: bigint } | null,
): Promise<void> {
  if (identity === null) return;
  try {
    const current = await lstat(temporaryPath, { bigint: true });
    if (current.dev === identity.device && current.ino === identity.inode) {
      await unlink(temporaryPath);
    }
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
}

export async function fsyncDirectory(
  path: string,
  openDirectory: typeof open = open,
): Promise<void> {
  const handle = await openDirectory(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function discoveredRecoveryLocations(
  vault: Vault,
  notePath: string,
): Promise<{
  readonly recoverable: readonly RecoveryLocation[];
  readonly empty: readonly RecoveryLocation[];
}> {
  const directory = dirname(notePath);
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > MAX_PARENT_DIRECTORY_ENTRIES) {
    throw new Error("the note parent has too many entries for bounded recovery");
  }
  const prefix = `.${basename(notePath)}.`;
  const suffix = ".recovery";
  const matching = entries
    .filter(({ name }) => name.startsWith(prefix) && name.endsWith(suffix))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  if (matching.length > MAX_RECOVERY_LOCATIONS_PER_NOTE) {
    const firstPath = join(directory, matching[0]?.name ?? "");
    throw new NoteRecoveryRequiredError(
      recoveryRelativePath(vault, notePath),
      recoveryRelativePath(vault, firstPath),
      new Error("too many interrupted authoring transactions require manual recovery"),
    );
  }
  const recoverable: RecoveryLocation[] = [];
  const empty: RecoveryLocation[] = [];
  for (const entry of matching) {
    const nonce = entry.name.slice(prefix.length, -suffix.length);
    const recoveryDirectory = join(directory, entry.name);
    const recoveryDirectoryRelative = recoveryRelativePath(vault, recoveryDirectory);
    if (
      !/^\d+\.[0-9a-f]{32}$/u.test(nonce)
      || !entry.isDirectory()
      || entry.isSymbolicLink()
    ) {
      throw new NoteRecoveryRequiredError(
        recoveryRelativePath(vault, notePath),
        recoveryDirectoryRelative,
        new Error("an unrecognized authoring recovery artifact is present"),
      );
    }
    const metadata = await lstat(recoveryDirectory, { bigint: true });
    if (
      !metadata.isDirectory()
      || metadata.isSymbolicLink()
      || await realpath(recoveryDirectory) !== recoveryDirectory
    ) {
      throw new NoteRecoveryRequiredError(
        recoveryRelativePath(vault, notePath),
        recoveryDirectoryRelative,
        new Error("an authoring recovery directory changed identity"),
      );
    }
    const children = await readdir(recoveryDirectory);
    if (children.length === 0) {
      empty.push({
        directory: recoveryDirectory,
        path: join(recoveryDirectory, basename(notePath)),
        relativePath: recoveryRelativePath(
          vault,
          join(recoveryDirectory, basename(notePath)),
        ),
        device: metadata.dev,
        inode: metadata.ino,
      });
      continue;
    }
    if (children.length !== 1 || children[0] !== basename(notePath)) {
      throw new NoteRecoveryRequiredError(
        recoveryRelativePath(vault, notePath),
        recoveryDirectoryRelative,
        new Error("an authoring recovery directory has unexpected contents"),
      );
    }
    const recoveryPath = join(recoveryDirectory, basename(notePath));
    try {
      await readSnapshotAtPath(
        vault,
        recoveryPath,
        recoveryRelativePath(vault, recoveryPath),
      );
    } catch (error) {
      throw new NoteRecoveryRequiredError(
        recoveryRelativePath(vault, notePath),
        recoveryRelativePath(vault, recoveryPath),
        error,
      );
    }
    recoverable.push({
      directory: recoveryDirectory,
      path: recoveryPath,
      relativePath: recoveryRelativePath(vault, recoveryPath),
      device: metadata.dev,
      inode: metadata.ino,
    });
  }
  return { recoverable, empty };
}

export async function directoryIdentity(
  vault: Vault,
  notePath: string,
): Promise<DirectoryIdentity> {
  await assertSafeParent(vault, notePath);
  const metadata = await lstat(dirname(notePath), { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("the note parent must remain a real directory");
  }
  return { device: metadata.dev, inode: metadata.ino };
}

export async function assertSameDirectory(
  vault: Vault,
  notePath: string,
  expected: DirectoryIdentity,
): Promise<void> {
  const current = await directoryIdentity(vault, notePath);
  if (current.device !== expected.device || current.inode !== expected.inode) {
    throw new Error("the note parent changed during authoring");
  }
}

export async function createRecoveryLocation(
  vault: Vault,
  path: string,
  dependencies: AuthoringDependencies,
): Promise<RecoveryLocation> {
  const directory = dirname(path);
  const recoveryDirectory = join(
    directory,
    `.${basename(path)}.${process.pid}.${sha256(dependencies.token()).slice(0, 32)}.recovery`,
  );
  await mkdir(recoveryDirectory, { mode: 0o700 });
  const metadata = await lstat(recoveryDirectory, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("the recovery location is not a private directory");
  }
  await fsyncDirectory(directory);
  const recoveryPath = join(recoveryDirectory, basename(path));
  return {
    directory: recoveryDirectory,
    path: recoveryPath,
    relativePath: relative(vault.root, recoveryPath).split(sep).join("/"),
    device: metadata.dev,
    inode: metadata.ino,
  };
}

export async function assertRecoveryLocation(recovery: RecoveryLocation): Promise<void> {
  const metadata = await lstat(recovery.directory, { bigint: true });
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || metadata.dev !== recovery.device
    || metadata.ino !== recovery.inode
    || await realpath(recovery.directory) !== recovery.directory
  ) {
    throw new Error("the recovery location changed during authoring");
  }
}

export async function removeRecoveryDirectory(
  recovery: RecoveryLocation,
  parentDirectory: string,
): Promise<void> {
  await rmdir(recovery.directory);
  await fsyncDirectory(parentDirectory);
}

export async function restoreQuarantinedSource(
  vault: Vault,
  recovery: RecoveryLocation,
  path: string,
  expectedDirectory: DirectoryIdentity,
): Promise<boolean> {
  await assertSameDirectory(vault, path, expectedDirectory);
  await assertRecoveryLocation(recovery);
  try {
    // link(2) is the portable no-clobber primitive: unlike rename, it returns
    // EEXIST rather than replacing a writer that recreated the source path.
    await link(recovery.path, path);
  } catch (error) {
    if (isErrno(error, "EEXIST")) return false;
    throw error;
  }
  await unlink(recovery.path);
  await fsyncDirectory(recovery.directory);
  await removeRecoveryDirectory(recovery, dirname(path));
  return true;
}

export async function assertNoInterruptedRecovery(
  vault: Vault,
  id: string,
): Promise<void> {
  const { path, relativePath } = pathFor(vault, id);
  await assertSafeParent(vault, path);
  const artifacts = await discoveredRecoveryLocations(vault, path);
  const first = artifacts.recoverable[0] ?? artifacts.empty[0];
  if (first !== undefined) {
    throw new NoteRecoveryRequiredError(
      relativePath,
      first.relativePath,
      new Error("an interrupted authoring transaction requires a writer to recover it"),
    );
  }
}

export async function recoverInterruptedAuthoring(
  vault: Vault,
  id: string,
  lock: NoteLock,
): Promise<void> {
  const { path, relativePath } = pathFor(vault, id);
  await lock.assertOwned();
  await assertSafeParent(vault, path);
  const artifacts = await discoveredRecoveryLocations(vault, path);
  for (const emptyRecovery of artifacts.empty) {
    await assertRecoveryLocation(emptyRecovery);
    await removeRecoveryDirectory(emptyRecovery, dirname(path));
  }
  const first = artifacts.recoverable[0];
  if (first === undefined) return;
  if (artifacts.recoverable.length !== 1) {
    throw new NoteRecoveryRequiredError(
      relativePath,
      first.relativePath,
      new Error("multiple interrupted authoring transactions require manual recovery"),
    );
  }

  const current = await readOptionalSnapshot(vault, id);
  if (current !== null) {
    throw new NoteRecoveryRequiredError(
      relativePath,
      first.relativePath,
      new Error("both the canonical note and displaced bytes exist"),
    );
  }
  const expectedDirectory = await directoryIdentity(vault, path);
  if (!await restoreQuarantinedSource(vault, first, path, expectedDirectory)) {
    throw new NoteRecoveryRequiredError(
      relativePath,
      first.relativePath,
      new Error("the canonical note was recreated during interrupted recovery"),
    );
  }
  await lock.assertOwned();
}

export async function installTemporaryWithoutClobber(
  temporaryPath: string,
  path: string,
): Promise<boolean> {
  try {
    // The temporary file has already been fsync'd. Linking gives the final
    // name to that exact inode only if the name is still absent.
    await link(temporaryPath, path);
  } catch (error) {
    if (isErrno(error, "EEXIST")) return false;
    throw error;
  }
  await unlink(temporaryPath);
  return true;
}

export async function currentRevisionOrNull(
  vault: Vault,
  id: string,
): Promise<NoteRevision | null> {
  try {
    return (await readOptionalSnapshot(vault, id))?.revision ?? null;
  } catch {
    // A raced directory, link, or non-UTF-8 file is still a conflict. Do not
    // inspect or mutate it further merely to improve an error field.
    return null;
  }
}

/** Preserve Promise.all's first native failure, retaining both admitted handles. */
export async function joinDirectorySyncs(
  paths: readonly [string, string],
  sync: (path: string) => Promise<void>,
): Promise<void> {
  const pending = paths.map((path) => {
    // An injected native port may throw before returning its Promise. Observe
    // that admission failure without abandoning another admitted operation.
    try { return sync(path); }
    catch (error: unknown) { return Promise.reject(error); }
  });
  try {
    await Promise.all(pending);
  } catch (error: unknown) {
    await Promise.allSettled(pending);
    throw error;
  }
}

/** Internal physical boundary. It never owns a complete note-publication transaction. */
export const nativeAuthoringPlatform = {
  resolveVault,
  acquireNoteLock,
  dependenciesFor,
  readSnapshot,
  readOptionalSnapshot,
  readSnapshotAtPath,
  recoverInterruptedAuthoring,
  assertSafeParent,
  directoryIdentity,
  assertSameDirectory,
  createRecoveryLocation,
  assertRecoveryLocation,
  removeRecoveryDirectory,
  restoreQuarantinedSource,
  installTemporaryWithoutClobber,
  currentRevisionOrNull,
  cleanupTemporary,
  fsyncDirectory,
  rename,
  unlink,
  directoryPath: dirname,
  temporaryPath(path: string, dependencies: AuthoringDependencies): string {
    return join(dirname(path), `.${basename(path)}.${process.pid}.${sha256(dependencies.token()).slice(0, 32)}.tmp`);
  },
  openTemporary(path: string, mode: number) {
    return open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  },
  statTemporary(path: string) {
    return lstat(path, { bigint: true });
  },
};

export type AuthoringPlatform = typeof nativeAuthoringPlatform;

export type TemporaryNoteHandle = Awaited<ReturnType<typeof open>>;
