import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { runGitCommand, type GitCommandProvider, type GitCommandResult } from "../git.js";
import {
  readCaptureBundle,
  type CaptureBundleInspection,
  type ReadCaptureBundleOptions,
} from "./bundle-reader.js";

const MAX_GIT_DOCUMENT_BYTES = 64 * 1_024 * 1_024;
const MAX_DIFF_BYTES = 2 * 1_024 * 1_024;
const GIT_TIMEOUT_MS = 10_000;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u;
const OBJECT_ID_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

export type CaptureBundleDiff = {
  readonly status: "changed" | "missing-at-ref" | "unchanged";
  readonly ref: string;
  readonly repositoryPath: string;
  readonly currentSha256: string;
  readonly referenceSha256: string | null;
  readonly diff: string | null;
};

export type CaptureBundleDiffOptions = {
  readonly bundle: string;
  readonly repository: string;
  readonly ref?: string;
  readonly readOptions?: Pick<ReadCaptureBundleOptions, "maxDocumentBytes">;
};

export type CaptureBundleDiffDependencies = {
  readonly runGit?: GitCommandProvider;
  readonly readBundle?: typeof readCaptureBundle;
};

function gitRef(value: string | undefined): string {
  const ref = value ?? "HEAD";
  if (
    !REF_PATTERN.test(ref)
    || ref.includes("..")
    || ref.includes("//")
    || ref.endsWith("/")
    || ref.endsWith(".lock")
  ) throw new TypeError("capture diff ref is not a bounded Git revision name");
  return ref;
}

function utf8(value: string | Uint8Array | undefined): Buffer {
  if (value === undefined) return Buffer.alloc(0);
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function gitMessage(result: Exclude<GitCommandResult, { readonly status: "ok" }>, label: string): Error {
  return new Error(`${label}: ${result.message}`);
}

async function canonicalRepository(input: string): Promise<string> {
  const repository = await realpath(resolve(input));
  const stats = await lstat(repository);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("capture diff repository must be a real directory");
  return repository;
}

function repositoryPath(repository: string, path: string): string {
  const fromRepository = relative(repository, path);
  if (
    fromRepository === ""
    || fromRepository === ".."
    || fromRepository.startsWith(`..${sep}`)
    || isAbsolute(fromRepository)
  ) throw new Error("capture bundle must be inside the selected repository");
  return fromRepository.split(sep).join("/");
}

async function assertCaptureBundleStable(
  options: CaptureBundleDiffOptions,
  readBundle: typeof readCaptureBundle,
  inspection: CaptureBundleInspection,
): Promise<void> {
  const confirmed = await readBundle(options.bundle, options.readOptions);
  if (
    confirmed.root !== inspection.root
    || confirmed.document.path !== inspection.document.path
    || confirmed.document.sha256 !== inspection.document.sha256
  ) {
    throw new Error("Capture bundle changed while its Git comparison was generated; retry.");
  }
}

/** Compare one verified stored capture with its exact bytes at a bounded Git ref. */
export async function diffCaptureBundle(
  options: CaptureBundleDiffOptions,
  dependencies: CaptureBundleDiffDependencies = {},
): Promise<CaptureBundleDiff> {
  const ref = gitRef(options.ref);
  const selectedDirectory = await canonicalRepository(options.repository);
  const readBundle = dependencies.readBundle ?? readCaptureBundle;
  const inspection = await readBundle(options.bundle, options.readOptions);
  const runGit = dependencies.runGit ?? runGitCommand;
  const repositoryCheck = await runGit({
    arguments: ["rev-parse", "--show-toplevel"],
    cwd: selectedDirectory,
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: 4 * 1_024,
  });
  if (repositoryCheck.status !== "ok") {
    throw gitMessage(repositoryCheck, "Capture diff repository is not a Git work tree");
  }
  const topLevel = utf8(repositoryCheck.stdout).toString("utf8").trim();
  if (!isAbsolute(topLevel)) throw new Error("Capture diff repository did not resolve to a canonical Git work tree");
  const repository = await canonicalRepository(topLevel);
  const selectedFromRepository = relative(repository, selectedDirectory);
  if (
    selectedFromRepository === ".."
    || selectedFromRepository.startsWith(`..${sep}`)
    || isAbsolute(selectedFromRepository)
  ) {
    throw new Error("Capture diff repository did not resolve inside its Git work tree");
  }
  const path = repositoryPath(repository, resolve(inspection.root, inspection.document.path));
  const refCheck = await runGit({
    arguments: ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    cwd: repository,
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: 4 * 1_024,
  });
  if (refCheck.status !== "ok") throw gitMessage(refCheck, "Could not resolve capture diff Git ref");
  const objectId = utf8(refCheck.stdout).toString("utf8").trim();
  if (!OBJECT_ID_PATTERN.test(objectId)) {
    throw new Error("Could not resolve capture diff Git ref: Git returned a malformed commit object ID");
  }
  const literalPathspec = `:(literal)${path}`;
  const specifier = `${objectId}:${path}`;
  const tree = await runGit({
    arguments: ["ls-tree", "-z", objectId, "--", literalPathspec],
    cwd: repository,
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: 8 * 1_024,
  });
  if (tree.status !== "ok") throw gitMessage(tree, "Could not inspect capture path at the requested Git ref");
  if (utf8(tree.stdout).byteLength === 0) {
    await assertCaptureBundleStable(options, readBundle, inspection);
    return Object.freeze({
      status: "missing-at-ref",
      ref,
      repositoryPath: path,
      currentSha256: inspection.document.sha256,
      referenceSha256: null,
      diff: null,
    });
  }
  const historical = await runGit({
    arguments: ["show", "--no-ext-diff", "--no-textconv", "--format=", specifier],
    cwd: repository,
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: MAX_GIT_DOCUMENT_BYTES,
  });
  if (historical.status !== "ok") {
    throw gitMessage(historical, "Could not read capture at the requested Git ref");
  }
  const referenceBytes = utf8(historical.stdout);
  const referenceSha256 = sha256(referenceBytes);
  if (referenceSha256 === inspection.document.sha256) {
    await assertCaptureBundleStable(options, readBundle, inspection);
    return Object.freeze({
      status: "unchanged",
      ref,
      repositoryPath: path,
      currentSha256: inspection.document.sha256,
      referenceSha256,
      diff: "",
    });
  }
  const result = await runGit({
    arguments: ["diff", "--no-ext-diff", "--no-textconv", "--unified=3", objectId, "--", literalPathspec],
    cwd: repository,
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: MAX_DIFF_BYTES,
  });
  if (result.status !== "ok") throw gitMessage(result, "Could not diff capture bundle");
  await assertCaptureBundleStable(options, readBundle, inspection);
  return Object.freeze({
    status: "changed",
    ref,
    repositoryPath: path,
    currentSha256: inspection.document.sha256,
    referenceSha256,
    diff: utf8(result.stdout).toString("utf8"),
  });
}
