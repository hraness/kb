import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { GitCommandResult } from "../git.js";
import type { CaptureBundleInspection } from "./bundle-reader.js";
import { diffCaptureBundle } from "./refresh.js";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

async function fixture(
  markdown = "current\n",
  documentRepositoryPath = "kb/articles/stored/stored.md",
): Promise<{
  readonly repository: string;
  readonly bundle: string;
  readonly inspection: CaptureBundleInspection;
}> {
  const repository = await realpath(await mkdtemp(join(tmpdir(), "kb-capture-diff-")));
  roots.push(repository);
  const bundle = join(repository, dirname(documentRepositoryPath));
  await mkdir(bundle, { recursive: true });
  return {
    repository,
    bundle,
    inspection: {
      root: bundle,
      schemaVersion: 4,
      sourceUrl: "https://example.com/source",
      canonicalUrl: "https://example.com/source",
      status: "complete",
      capturedAt: "2026-08-26T12:00:00.000Z",
      document: {
        path: basename(documentRepositoryPath),
        bytes: Buffer.byteLength(markdown),
        sha256: new Bun.CryptoHasher("sha256").update(markdown).digest("hex"),
        expectedBytes: Buffer.byteLength(markdown),
        expectedSha256: new Bun.CryptoHasher("sha256").update(markdown).digest("hex"),
        integrity: "verified",
        markdown,
      },
      assets: [],
    },
  };
}

function successfulGit(
  arguments_: readonly string[],
  repository: string,
  historical = "current\n",
  diff = "@@ -1 +1 @@\n-previous\n+current\n",
): GitCommandResult {
  if (arguments_[0] === "rev-parse" && arguments_[1] === "--show-toplevel") {
    return { status: "ok", stdout: `${repository}\n` };
  }
  if (arguments_[0] === "rev-parse") return { status: "ok", stdout: `${"a".repeat(40)}\n` };
  if (arguments_[0] === "ls-tree") return { status: "ok", stdout: `100644 blob ${"b".repeat(40)}\tstored.md\0` };
  if (arguments_[0] === "show") return { status: "ok", stdout: historical };
  if (arguments_[0] === "diff") return { status: "ok", stdout: diff };
  throw new Error(`Unexpected Git command ${arguments_.join(" ")}`);
}

test("reports unchanged exact bytes without requesting a diff", async () => {
  const value = await fixture();
  const calls: string[][] = [];
  const result = await diffCaptureBundle(
    { bundle: value.bundle, repository: value.repository, ref: "HEAD" },
    {
      readBundle: async () => value.inspection,
      runGit: async (request) => {
        calls.push([...request.arguments]);
        return successfulGit(request.arguments, value.repository);
      },
    },
  );

  expect(result.status).toBe("unchanged");
  expect(result.repositoryPath).toBe("kb/articles/stored/stored.md");
  expect(calls).toHaveLength(4);
});

test("returns a bounded Git diff with exact current and reference digests", async () => {
  const value = await fixture();
  const result = await diffCaptureBundle(
    { bundle: value.bundle, repository: value.repository, ref: "main" },
    {
      readBundle: async () => value.inspection,
      runGit: async ({ arguments: arguments_ }) => {
        if (arguments_[0] === "show") {
          expect(arguments_.at(-1)).toBe(`${"a".repeat(40)}:kb/articles/stored/stored.md`);
          return { status: "ok", stdout: "previous\n" };
        }
        if (arguments_[0] === "diff") {
          expect(arguments_).toEqual([
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--unified=3",
            "a".repeat(40),
            "--",
            ":(literal)kb/articles/stored/stored.md",
          ]);
        }
        return successfulGit(arguments_, value.repository, "previous\n");
      },
    },
  );

  expect(result).toMatchObject({ status: "changed", diff: expect.stringContaining("+current") });
  expect(result.referenceSha256).not.toBe(result.currentSha256);
});

test("pins one commit and literal path from the canonical Git top-level", async () => {
  const value = await fixture("current\n", "kb/articles/[stored]/:current*.md");
  const selectedDirectory = join(value.repository, "kb");
  const objectId = "c".repeat(64);
  const calls: Array<{ readonly arguments: readonly string[]; readonly cwd: string }> = [];

  const result = await diffCaptureBundle(
    { bundle: value.bundle, repository: selectedDirectory, ref: "moving-branch" },
    {
      readBundle: async () => value.inspection,
      runGit: async (request) => {
        calls.push({ arguments: request.arguments, cwd: request.cwd });
        if (request.arguments[0] === "rev-parse" && request.arguments[1] === "--show-toplevel") {
          return { status: "ok", stdout: `${value.repository}\n` };
        }
        if (request.arguments[0] === "rev-parse") return { status: "ok", stdout: `${objectId}\n` };
        if (request.arguments[0] === "ls-tree") {
          expect(request.arguments).toEqual([
            "ls-tree",
            "-z",
            objectId,
            "--",
            ":(literal)kb/articles/[stored]/:current*.md",
          ]);
          return { status: "ok", stdout: `100644 blob ${"b".repeat(40)}\t:current*.md\0` };
        }
        if (request.arguments[0] === "show") {
          expect(request.arguments.at(-1)).toBe(`${objectId}:kb/articles/[stored]/:current*.md`);
          return { status: "ok", stdout: "previous\n" };
        }
        if (request.arguments[0] === "diff") {
          expect(request.arguments.at(4)).toBe(objectId);
          expect(request.arguments.at(-1)).toBe(":(literal)kb/articles/[stored]/:current*.md");
          return { status: "ok", stdout: "literal diff" };
        }
        throw new Error(`Unexpected Git command ${request.arguments.join(" ")}`);
      },
    },
  );

  expect(result).toMatchObject({ status: "changed", repositoryPath: "kb/articles/[stored]/:current*.md" });
  expect(calls[0]?.cwd).toBe(selectedDirectory);
  expect(calls.slice(1).every(({ cwd }) => cwd === value.repository)).toBeTrue();
  expect(calls.filter(({ arguments: arguments_ }) =>
    arguments_.some((argument) => argument.includes("moving-branch"))
  )).toHaveLength(1);
});

test("rejects malformed resolved object IDs before inspecting the tree", async () => {
  const value = await fixture();
  await expect(diffCaptureBundle(
    { bundle: value.bundle, repository: value.repository, ref: "main" },
    {
      readBundle: async () => value.inspection,
      runGit: async ({ arguments: arguments_ }) => arguments_[1] === "--verify"
        ? { status: "ok", stdout: "main\n" }
        : successfulGit(arguments_, value.repository),
    },
  )).rejects.toThrow("malformed commit object ID");
});

test("distinguishes a missing historical path from Git transport failure", async () => {
  const value = await fixture();
  const missing = await diffCaptureBundle(
    { bundle: value.bundle, repository: value.repository },
    {
      readBundle: async () => value.inspection,
      runGit: async ({ arguments: arguments_ }) => arguments_[0] === "ls-tree"
        ? { status: "ok", stdout: "" }
        : successfulGit(arguments_, value.repository),
    },
  );
  expect(missing.status).toBe("missing-at-ref");

  await expect(diffCaptureBundle(
    { bundle: value.bundle, repository: value.repository },
    {
      readBundle: async () => value.inspection,
      runGit: async () => ({ status: "unavailable", message: "git missing" }),
    },
  )).rejects.toThrow("git missing");
});

test("rejects a capture that changes before a missing-at-ref result returns", async () => {
  const value = await fixture();
  const changed = await fixture("changed after tree lookup\n");
  let reads = 0;

  await expect(diffCaptureBundle(
    { bundle: value.bundle, repository: value.repository },
    {
      readBundle: async () => {
        reads += 1;
        return reads === 1 ? value.inspection : { ...changed.inspection, root: value.inspection.root };
      },
      runGit: async ({ arguments: arguments_ }) => arguments_[0] === "ls-tree"
        ? { status: "ok", stdout: "" }
        : successfulGit(arguments_, value.repository),
    },
  )).rejects.toThrow("changed while its Git comparison was generated");
  expect(reads).toBe(2);
});

test("rejects a capture that changes before an unchanged result returns", async () => {
  const value = await fixture();
  const changed = await fixture("changed after historical read\n");
  let reads = 0;

  await expect(diffCaptureBundle(
    { bundle: value.bundle, repository: value.repository },
    {
      readBundle: async () => {
        reads += 1;
        return reads === 1 ? value.inspection : { ...changed.inspection, root: value.inspection.root };
      },
      runGit: async ({ arguments: arguments_ }) => successfulGit(arguments_, value.repository),
    },
  )).rejects.toThrow("changed while its Git comparison was generated");
  expect(reads).toBe(2);
});

test("rejects invalid refs and non-Git directories instead of calling them missing", async () => {
  const value = await fixture();
  await expect(diffCaptureBundle(
    { bundle: value.bundle, repository: value.repository, ref: "missing" },
    {
      readBundle: async () => value.inspection,
      runGit: async ({ arguments: arguments_ }) => arguments_[0] === "rev-parse"
        && arguments_[1] === "--verify"
        ? { status: "failed", message: "bad ref", reason: "exit", exitCode: 128 }
        : successfulGit(arguments_, value.repository),
    },
  )).rejects.toThrow("bad ref");

  await expect(diffCaptureBundle(
    { bundle: value.bundle, repository: value.repository },
    {
      readBundle: async () => value.inspection,
      runGit: async () => ({ status: "failed", message: "not a Git work tree", reason: "exit", exitCode: 128 }),
    },
  )).rejects.toThrow("not a Git work tree");
});

test("rejects a capture that changes while Git generates the diff", async () => {
  const value = await fixture();
  const changed = await fixture("changed again\n");
  let reads = 0;
  await expect(diffCaptureBundle(
    { bundle: value.bundle, repository: value.repository },
    {
      readBundle: async () => {
        reads += 1;
        return reads === 1 ? value.inspection : { ...changed.inspection, root: value.inspection.root };
      },
      runGit: async ({ arguments: arguments_ }) => successfulGit(arguments_, value.repository, "previous\n"),
    },
  )).rejects.toThrow("changed while its Git comparison was generated");
});

test("rejects revision injection and bundles outside the repository", async () => {
  await expect(diffCaptureBundle({
    bundle: "/tmp/nope",
    repository: "/tmp",
    ref: "--help",
  })).rejects.toThrow("revision name");

  const first = await fixture();
  const second = await fixture();
  await expect(diffCaptureBundle(
    { bundle: second.bundle, repository: first.repository },
    {
      readBundle: async () => second.inspection,
      runGit: async ({ arguments: arguments_ }) => successfulGit(arguments_, first.repository),
    },
  )).rejects.toThrow("inside the selected repository");
});
