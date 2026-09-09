import { afterEach, describe, expect, test } from "bun:test";
import fc from "fast-check";
import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileHandle } from "node:fs/promises";

import { createConceptNote, NoteRecoveryRequiredError } from "./authoring.js";
import { acquireNoteLock, NoteLockBusyError } from "./note-lock.js";
import { fsyncDirectory, nativeAuthoringPlatform } from "./authoring-platform.js";
import type { AuthoringPlatform } from "./authoring-platform.js";
import { createNoteProgram, editNoteRelationProgram } from "./authoring-program.js";
import { runAuthoring } from "./authoring-runtime.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "kb-publication-lifetime-"));
  roots.push(base);
  const root = join(base, "vault");
  const cache = join(base, "cache");
  await mkdir(join(root, "notes"), { recursive: true });
  await mkdir(cache);
  const options = { lock: { cacheHome: cache, waitTimeoutMs: 250 } };
  return { root: await realpath(root), cache: await realpath(cache), options };
}
function observed<A>(promise: Promise<A>) {
  return promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
async function beforeSettlement<A>(milestone: Promise<void>, running: Promise<A>): Promise<void> {
  await Promise.race([
    milestone,
    running.then((outcome) => {
      throw new Error("publication settled before its required native milestone", { cause: outcome });
    }),
  ]);
}
function withHandle(handle: FileHandle, overrides: Partial<Pick<FileHandle, "sync" | "close">>): FileHandle {
  return new Proxy(handle, {
    get(target, key) {
      if (key === "sync" && overrides.sync !== undefined) return overrides.sync;
      if (key === "close" && overrides.close !== undefined) return overrides.close;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("authoring real publication lifetime", () => {
  test.each([undefined, null, 0, false, new Error("release failure")])(
    "outer release selects exact raw reason %p over callback failure", async (reason) => {
      const { root, options } = await fixture();
      const primary = new Error("before installation failed");
      const result = await observed(createConceptNote(root, { id: "notes/one", title: "One" }, {
        ...options,
        dependencies: { beforeInstall: async () => { throw primary; } },
        lock: {
          ...options.lock,
          dependencies: { afterTombstoneMove: async () => { throw reason; } },
        },
      }));
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error).toBe(reason);
      expect(await readdir(join(root, "notes"))).toEqual([]);
    },
  );

  test("holds the real same-note lease through beforeCommit and publishes only after settlement", async () => {
    const { root, cache, options } = await fixture();
    const entered = deferred<void>();
    const release = deferred<void>();
    const running = observed(createConceptNote(root, { id: "notes/one", title: "One" }, {
      ...options,
      dependencies: { beforeCommit: async () => { entered.resolve(); await release.promise; } },
    }));
    try {
      await beforeSettlement(entered.promise, running);
      const competing = await observed(acquireNoteLock(root, "notes/one", { cacheHome: cache, waitTimeoutMs: 50 }));
      if (competing.ok) await competing.value.release();
      expect(competing.ok).toBeFalse();
      if (!competing.ok) expect(competing.error).toBeInstanceOf(NoteLockBusyError);
      expect((await readdir(join(root, "notes"))).filter((name) => name === "one.md")).toEqual([]);
    } finally { release.resolve(); await running; }
    const result = await running;
    expect(result.ok).toBeTrue();
    expect(await readFile(join(root, "notes/one.md"), "utf8")).toContain("title: One");
  });

  test("compatible create leaves the exact existing inode, bytes and revision unchanged", async () => {
    const { root, options } = await fixture();
    const input = { id: "notes/one", title: "One" };
    const first = await createConceptNote(root, input, options);
    const path = join(root, "notes/one.md");
    const before = await stat(path, { bigint: true });
    const bytes = await readFile(path);
    const second = await createConceptNote(root, input, {
      ...options, dependencies: { beforeInstall: async () => { throw new Error("must not publish"); } },
    });
    const after = await stat(path, { bigint: true });
    expect(second.changed).toBeFalse();
    expect(second.revision).toBe(first.revision);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(await readFile(path)).toEqual(bytes);
  });

  test("joins a held sibling directory sync before recovery and lease release", async () => {
    const { root, cache, options } = await fixture();
    const original = "---\ntitle: One\ntype: concept\n---\n\n# One\n";
    await writeFile(join(root, "notes/one.md"), original);
    await writeFile(join(root, "notes/two.md"), "---\ntitle: Two\ntype: concept\n---\n\n# Two\n");
    const bothEntered = deferred<void>();
    const release = deferred<void>();
    const firstFailed = deferred<void>();
    const primary = new Error("first directory sync failed");
    const late = new Error("held sibling sync failed later");
    let armed = false;
    let parentSelected = false;
    let recoverySelected = false;
    let nativePending = false;
    let releaseObserved = false;
    let recoveryObserved = false;
    let siblingClosed = false;
    const siblingClose = deferred<void>();
    const observedOpen: typeof open = async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      const path = String(file);
      if (armed && path === join(root, "notes") && !parentSelected) {
        parentSelected = true;
        return withHandle(handle, { sync: async () => {
          await bothEntered.promise;
          firstFailed.resolve();
          throw primary;
        } });
      }
      if (armed && path.endsWith(".recovery") && !recoverySelected) {
        recoverySelected = true;
        return withHandle(handle, { sync: async () => {
          nativePending = true;
          bothEntered.resolve();
          await release.promise;
          nativePending = false;
          throw late;
        }, close: async () => {
          try { await handle.close(); siblingClosed = true; }
          finally { siblingClose.resolve(); }
        } });
      }
      return handle;
    };
    const platform: AuthoringPlatform = {
      ...nativeAuthoringPlatform,
      fsyncDirectory: (path) => fsyncDirectory(path, observedOpen),
      restoreQuarantinedSource: async (...args) => {
        recoveryObserved = true;
        expect(siblingClosed).toBeTrue();
        return nativeAuthoringPlatform.restoreQuarantinedSource(...args);
      },
    };
    const running = observed(runAuthoring(editNoteRelationProgram(platform, "add", root, "notes/one", "relates-to", "notes/two", {
      ...options,
      dependencies: { beforeCommit: async () => { armed = true; } },
      lock: { ...options.lock, dependencies: { afterTombstoneMove: async () => {
        expect(siblingClosed).toBeTrue();
        releaseObserved = true;
      } } },
    })));
    try {
      await beforeSettlement(firstFailed.promise, running);
      const competing = await observed(acquireNoteLock(root, "notes/one", { cacheHome: cache, waitTimeoutMs: 150 }));
      if (competing.ok) await competing.value.release();
      expect(nativePending).toBeTrue();
      expect(releaseObserved).toBeFalse();
      expect(recoveryObserved).toBeFalse();
      expect(siblingClosed).toBeFalse();
      expect(competing.ok).toBeFalse();
      if (!competing.ok) expect(competing.error).toBeInstanceOf(NoteLockBusyError);
    } finally {
      release.resolve();
      const outcome = await running;
      await siblingClose.promise;
      expect(outcome.ok).toBeFalse();
      if (!outcome.ok) expect(outcome.error).toBe(primary);
      expect(nativePending).toBeFalse();
      expect(siblingClosed).toBeTrue();
      expect(releaseObserved).toBeTrue();
      expect(recoveryObserved).toBeTrue();
      expect(await readFile(join(root, "notes/one.md"), "utf8")).toBe(original);
    }
  });

  test.each([undefined, null, 0, false, new Error("temporary cleanup failure")])(
    "temporary cleanup selects exact raw reason %p over the body", async (reason) => {
      const { root, options } = await fixture();
      const primary = new Error("publication body failed");
      let releases = 0;
      const platform: AuthoringPlatform = {
        ...nativeAuthoringPlatform,
        cleanupTemporary: async (...args) => {
          await nativeAuthoringPlatform.cleanupTemporary(...args);
          throw reason;
        },
      };
      const result = await observed(runAuthoring(createNoteProgram(platform, root, {
        id: "notes/one", title: "One", type: "concept",
      }, {
        ...options,
        dependencies: { beforeInstall: async () => { throw primary; } },
        lock: { ...options.lock, dependencies: { afterTombstoneMove: async () => { releases += 1; } } },
      })));
      expect(result.ok).toBeFalse();
      if (!result.ok) expect(result.error).toBe(reason);
      expect(releases).toBe(1);
      expect(await readdir(join(root, "notes"))).toEqual([]);
    },
  );

  test("joins an admitted native sync when the second service admission throws synchronously", async () => {
    const { root, cache, options } = await fixture();
    const original = "---\ntitle: One\ntype: concept\n---\n\n# One\n";
    await writeFile(join(root, "notes/one.md"), original);
    await writeFile(join(root, "notes/two.md"), "---\ntitle: Two\ntype: concept\n---\n\n# Two\n");
    const entered = deferred<void>();
    const release = deferred<void>();
    const primary = new Error("second sync admission failed");
    const late = new Error("first admitted sync later failed");
    let armed = false;
    let selected = false;
    let closed = false;
    let released = false;
    const observedOpen: typeof open = async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      return withHandle(handle, {
        sync: async () => { entered.resolve(); await release.promise; throw late; },
        close: async () => { await handle.close(); closed = true; },
      });
    };
    const platform: AuthoringPlatform = {
      ...nativeAuthoringPlatform,
      fsyncDirectory: (path) => {
        if (armed && path === join(root, "notes") && !selected) {
          selected = true;
          return fsyncDirectory(path, observedOpen);
        }
        if (armed && path.endsWith(".recovery")) throw primary;
        return nativeAuthoringPlatform.fsyncDirectory(path);
      },
    };
    const running = observed(runAuthoring(editNoteRelationProgram(
      platform, "add", root, "notes/one", "relates-to", "notes/two", {
        ...options,
        dependencies: { beforeCommit: async () => { armed = true; } },
        lock: { ...options.lock, dependencies: { afterTombstoneMove: async () => {
          expect(closed).toBeTrue(); released = true;
        } } },
      },
    )));
    try {
      await beforeSettlement(entered.promise, running);
      const competitor = await observed(acquireNoteLock(root, "notes/one", { cacheHome: cache, waitTimeoutMs: 50 }));
      if (competitor.ok) await competitor.value.release();
      expect(competitor.ok).toBeFalse();
      if (!competitor.ok) expect(competitor.error).toBeInstanceOf(NoteLockBusyError);
      expect(closed).toBeFalse();
      expect(released).toBeFalse();
    } finally { release.resolve(); await running; }
    const result = await running;
    expect(result.ok).toBeFalse();
    if (!result.ok) expect(result.error).toBe(primary);
    expect(closed).toBeTrue();
    expect(released).toBeTrue();
    expect(await readFile(join(root, "notes/one.md"), "utf8")).toBe(original);
  });

  test("outer lease release supersedes temporary cleanup and body failures", async () => {
    const { root, options } = await fixture();
    const primary = new Error("body failed");
    const cleanup = new Error("temporary cleanup failed");
    const release = new Error("lease release failed");
    const events: string[] = [];
    const platform: AuthoringPlatform = {
      ...nativeAuthoringPlatform,
      cleanupTemporary: async (...args) => {
        await nativeAuthoringPlatform.cleanupTemporary(...args);
        events.push("temporary-cleaned");
        throw cleanup;
      },
    };
    const result = await observed(runAuthoring(createNoteProgram(platform, root, {
      id: "notes/one", title: "One", type: "concept",
    }, {
      ...options,
      dependencies: { beforeInstall: async () => { events.push("body"); throw primary; } },
      lock: { ...options.lock, dependencies: { afterTombstoneMove: async () => {
        events.push("lease-release"); throw release;
      } } },
    })));
    expect(result.ok).toBeFalse();
    if (!result.ok) expect(result.error).toBe(release);
    expect(events).toEqual(["body", "temporary-cleaned", "lease-release"]);
  });

  test("selects the last failing physical cleanup phase for generated raw values", async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({ temporaryFails: fc.boolean(), releaseFails: fc.boolean(), reason: fc.jsonValue() }),
      async ({ temporaryFails, releaseFails, reason }) => {
        const { root, options } = await fixture();
        const primary = new Error("body failed");
        const releaseReason = { phase: "release", reason };
        const events: string[] = [];
        const platform: AuthoringPlatform = {
          ...nativeAuthoringPlatform,
          cleanupTemporary: async (...args) => {
            await nativeAuthoringPlatform.cleanupTemporary(...args);
            events.push("temporary-cleaned");
            if (temporaryFails) throw reason;
          },
        };
        const result = await observed(runAuthoring(createNoteProgram(platform, root, {
          id: "notes/one", title: "One", type: "concept",
        }, {
          ...options,
          dependencies: { beforeInstall: async () => { throw primary; } },
          lock: { ...options.lock, dependencies: { afterTombstoneMove: async () => {
            events.push("lease-release");
            if (releaseFails) throw releaseReason;
          } } },
        })));
        expect(result.ok).toBeFalse();
        if (!result.ok) expect(result.error).toBe(releaseFails ? releaseReason : temporaryFails ? reason : primary);
        expect(events).toEqual(["temporary-cleaned", "lease-release"]);
        expect(await readdir(join(root, "notes"))).toEqual([]);
      },
    ), { seed: 91242, numRuns: 16 });
  });

  test("fallback descriptor close is observed but does not replace a failed sync", async () => {
    const { root, options } = await fixture();
    const primary = new Error("temporary sync failed");
    const cleanup = new Error("fallback close failed after native close");
    let closed = false;
    const platform: AuthoringPlatform = {
      ...nativeAuthoringPlatform,
      openTemporary: async (...args) => {
        const handle = await nativeAuthoringPlatform.openTemporary(...args);
        return withHandle(handle, {
          sync: async () => { throw primary; },
          close: async () => { await handle.close(); closed = true; throw cleanup; },
        });
      },
    };
    const result = await observed(runAuthoring(createNoteProgram(platform, root, {
      id: "notes/one", title: "One", type: "concept",
    }, options)));
    expect(result.ok).toBeFalse();
    if (!result.ok) expect(result.error).toBe(primary);
    expect(closed).toBeTrue();
    expect(await readdir(join(root, "notes"))).toEqual([]);
  });

  test("a late temporary acquisition remains under its real lease through native close", async () => {
    const { root, cache, options } = await fixture();
    const acquired = deferred<void>();
    const release = deferred<void>();
    const primary = new Error("sync fails after late acquisition");
    let closed = false;
    let released = false;
    const platform: AuthoringPlatform = {
      ...nativeAuthoringPlatform,
      openTemporary: async (...args) => {
        const handle = await nativeAuthoringPlatform.openTemporary(...args);
        acquired.resolve();
        await release.promise;
        return withHandle(handle, {
          sync: async () => { throw primary; },
          close: async () => { await handle.close(); closed = true; },
        });
      },
    };
    const running = observed(runAuthoring(createNoteProgram(platform, root, {
      id: "notes/one", title: "One", type: "concept",
    }, {
      ...options,
      lock: { ...options.lock, dependencies: { afterTombstoneMove: async () => {
        expect(closed).toBeTrue(); released = true;
      } } },
    })));
    try {
      await beforeSettlement(acquired.promise, running);
      const competitor = await observed(acquireNoteLock(root, "notes/one", { cacheHome: cache, waitTimeoutMs: 50 }));
      if (competitor.ok) await competitor.value.release();
      expect(competitor.ok).toBeFalse();
      if (!competitor.ok) expect(competitor.error).toBeInstanceOf(NoteLockBusyError);
      expect(closed).toBeFalse();
      expect(released).toBeFalse();
    } finally { release.resolve(); await running; }
    const result = await running;
    expect(result.ok).toBeFalse();
    if (!result.ok) expect(result.error).toBe(primary);
    expect(closed).toBeTrue();
    expect(released).toBeTrue();
  });

  test.each(["durability", "temporary-unlink"] as const)(
    "preserves visible replacement and displaced source after %s failure", async (failureAt) => {
      const { root, options } = await fixture();
      const original = "---\ntitle: One\ntype: concept\n---\n\n# One\n";
      await writeFile(join(root, "notes/one.md"), original);
      await writeFile(join(root, "notes/two.md"), "---\ntitle: Two\ntype: concept\n---\n\n# Two\n");
      const primary = new Error(`post-link ${failureAt} failed`);
      let linked = false;
      const platform: AuthoringPlatform = {
        ...nativeAuthoringPlatform,
        installTemporaryWithoutClobber: async (temporaryPath, path) => {
          if (failureAt === "temporary-unlink") {
            // The exact native link succeeds; model only the following unlink's
            // rejection. Real transaction cleanup still removes its temp name.
            await link(temporaryPath, path);
            linked = true;
            throw primary;
          }
          const installed = await nativeAuthoringPlatform.installTemporaryWithoutClobber(temporaryPath, path);
          linked = installed;
          return installed;
        },
        fsyncDirectory: async (path) => {
          if (failureAt === "durability" && linked) throw primary;
          await nativeAuthoringPlatform.fsyncDirectory(path);
        },
      };
      const result = await observed(runAuthoring(editNoteRelationProgram(
        platform, "add", root, "notes/one", "relates-to", "notes/two", options,
      )));
      expect(result.ok).toBeFalse();
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(NoteRecoveryRequiredError);
        const error = result.error as NoteRecoveryRequiredError;
        expect(error.cause).toBe(primary);
        expect(await readFile(join(root, error.recoveryPath), "utf8")).toBe(original);
      }
      expect(linked).toBeTrue();
      expect(await readFile(join(root, "notes/one.md"), "utf8")).toContain("notes/two");
      expect((await readdir(join(root, "notes"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    },
  );
});
