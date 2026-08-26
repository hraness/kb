import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CaptureJobConflictError,
  CaptureJobSafetyError,
  MAX_CAPTURE_JOB_BYTES,
  completeCaptureJob,
  createCaptureJob,
  failCaptureJob,
  listCaptureJobs,
  openCaptureJobStore,
  readCaptureJob,
  updateCaptureJob,
  type CaptureJobStore,
} from "./jobs.js";

const cleanupRoots: string[] = [];
const digest = "a".repeat(64);

async function temporaryStore(): Promise<{ readonly root: string; readonly store: CaptureJobStore }> {
  const created = await mkdtemp(join(tmpdir(), "hraness-kb-capture-jobs-"));
  const root = await realpath(created);
  cleanupRoots.push(root);
  const jobs = join(root, "jobs");
  await mkdir(jobs, { mode: 0o700 });
  return { root, store: await openCaptureJobStore(jobs) };
}

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("capture job ledger", () => {
  test("records a sanitized, revisioned running-to-completed lifecycle", async () => {
    const { store } = await temporaryStore();
    const created = await createCaptureJob(store, {
      id: uuid(1),
      target: "https://alice:verysecret@example.com/post?access_token=target-secret\u001b]0;forged\u0007",
      at: new Date("2026-08-26T10:00:00.000Z"),
    });

    expect(created).toMatchObject({
      revision: 1,
      lifecycle: "running",
      captureStatus: null,
      phase: "queued",
      finishedAt: null,
    });
    expect(created.target).not.toContain("verysecret");
    expect(created.target).not.toContain("target-secret");
    expect(created.target).not.toContain("forged");

    const advanced = await updateCaptureJob(store, created.id, {
      expectedRevision: 1,
      phase: "acquiring",
      at: new Date("2026-08-26T10:00:01.000Z"),
      appendAttempts: [{
        method: "browser\u001b[31m",
        outcome: "succeeded",
        message: "Authorization: Bearer attempt-secret",
      }],
      appendWarnings: ["Recovered\u202e warning"],
    });

    expect(advanced).toMatchObject({ revision: 2, phase: "acquiring" });
    expect(advanced.attempts[0]?.method).toBe("browser");
    expect(advanced.attempts[0]?.message).not.toContain("attempt-secret");
    expect(advanced.warnings[0]).toBe("Recovered warning");

    const completed = await completeCaptureJob(store, created.id, {
      expectedRevision: 2,
      status: "complete",
      at: new Date("2026-08-26T10:00:02.000Z"),
      bundle: { path: "/retained/captures/post", sha256: digest },
      appendAttempts: [{ method: "persist", outcome: "succeeded", message: "Bundle committed." }],
    });

    expect(completed).toMatchObject({
      revision: 3,
      lifecycle: "completed",
      captureStatus: "complete",
      phase: "finished",
      updatedAt: "2026-08-26T10:00:02.000Z",
      finishedAt: "2026-08-26T10:00:02.000Z",
      error: null,
      bundle: { path: "/retained/captures/post", sha256: digest },
    });
    expect(await readCaptureJob(store, created.id)).toEqual(completed);
    expect(await listCaptureJobs(store)).toEqual([completed]);

    const recordPath = join(store.root, `${created.id}.json`);
    const disk = await readFile(recordPath, "utf8");
    expect(disk).toBe(`${JSON.stringify(completed, null, 2)}\n`);
    expect(await readdir(store.root)).toEqual([`${created.id}.json`]);

    await expect(updateCaptureJob(store, created.id, {
      expectedRevision: 3,
      phase: "finalizing",
    })).rejects.toThrow("terminal");
  });

  test("separates operational failure from capture status and leaves crashed work running", async () => {
    const { store } = await temporaryStore();
    const crashed = await createCaptureJob(store, {
      id: uuid(2),
      target: "https://example.com/crashed",
      at: new Date("2026-08-26T11:00:00.000Z"),
    });

    const reopened = await openCaptureJobStore(store.root);
    expect(await readCaptureJob(reopened, crashed.id)).toMatchObject({
      lifecycle: "running",
      captureStatus: null,
      phase: "queued",
    });

    const failed = await failCaptureJob(reopened, crashed.id, {
      expectedRevision: 1,
      at: new Date("2026-08-26T11:00:01.000Z"),
      error: "Authorization: Bearer failure-secret\u001b[2J",
      appendWarnings: ["Capture subprocess exited."],
    });
    expect(failed).toMatchObject({
      lifecycle: "failed",
      captureStatus: null,
      phase: "finished",
      bundle: null,
      revision: 2,
    });
    expect(failed.error).not.toContain("failure-secret");
    expect(failed.error).not.toContain("\u001b");
    await expect(completeCaptureJob(reopened, crashed.id, {
      expectedRevision: 2,
      status: "partial",
    })).rejects.toThrow("terminal");
  });

  test("enforces revisions, monotonic phases and bounded terminal schemas", async () => {
    const { store } = await temporaryStore();
    const created = await createCaptureJob(store, {
      id: uuid(3),
      target: "https://example.com",
      at: new Date("2026-08-26T12:00:00.000Z"),
    });
    const extracting = await updateCaptureJob(store, created.id, {
      expectedRevision: 1,
      phase: "extracting",
      at: new Date("2026-08-26T12:00:01.000Z"),
    });

    await expect(updateCaptureJob(store, created.id, {
      expectedRevision: 1,
      phase: "persisting",
    })).rejects.toBeInstanceOf(CaptureJobConflictError);
    await expect(updateCaptureJob(store, created.id, {
      expectedRevision: extracting.revision,
      phase: "acquiring",
    })).rejects.toThrow("backwards");
    await expect(updateCaptureJob(store, created.id, {
      expectedRevision: extracting.revision,
      phase: "persisting",
      at: new Date("2026-08-26T11:59:59.000Z"),
    })).rejects.toThrow("backwards");
    await expect(completeCaptureJob(store, created.id, {
      expectedRevision: extracting.revision,
      status: "complete",
      bundle: { path: "/bundle", sha256: digest.toUpperCase() },
    })).rejects.toThrow("lowercase SHA-256");
    expect(await readCaptureJob(store, created.id)).toEqual(extracting);
    expect(await readdir(store.root)).toEqual([`${created.id}.json`]);
  });

  test("rejects oversized raw strings before redaction or terminal sanitization", async () => {
    const { store } = await temporaryStore();
    // This is only about 10K UTF-16 code units but more than 20K UTF-8 bytes,
    // and terminal sanitization would otherwise collapse it to just "ok".
    const oversized = `ok\u001b]0;${"é".repeat(10_000)}\u0007`;

    await expect(createCaptureJob(store, {
      id: uuid(300),
      target: oversized,
    })).rejects.toThrow("16384-byte input limit");

    const created = await createCaptureJob(store, {
      id: uuid(301),
      target: "https://example.com/bounded",
    });
    await expect(updateCaptureJob(store, created.id, {
      expectedRevision: 1,
      phase: "acquiring",
      appendAttempts: [{ method: oversized, outcome: "failed", message: "bounded" }],
    })).rejects.toThrow("256-byte input limit");
    await expect(updateCaptureJob(store, created.id, {
      expectedRevision: 1,
      phase: "acquiring",
      appendAttempts: [{ method: "bounded", outcome: "failed", message: oversized }],
    })).rejects.toThrow("8192-byte input limit");
    await expect(updateCaptureJob(store, created.id, {
      expectedRevision: 1,
      phase: "acquiring",
      appendWarnings: [oversized],
    })).rejects.toThrow("8192-byte input limit");
    await expect(completeCaptureJob(store, created.id, {
      expectedRevision: 1,
      status: "complete",
      bundle: { path: oversized, sha256: digest },
    })).rejects.toThrow("16384-byte input limit");
    await expect(failCaptureJob(store, created.id, {
      expectedRevision: 1,
      error: oversized,
    })).rejects.toThrow("16384-byte input limit");

    expect(await readCaptureJob(store, created.id)).toEqual(created);
    expect(await readdir(store.root)).toEqual([`${created.id}.json`]);
  });

  test("creates independent jobs concurrently and serializes conflicting updates", async () => {
    const { store } = await temporaryStore();
    const records = await Promise.all(Array.from({ length: 32 }, (_, index) => createCaptureJob(store, {
      id: uuid(100 + index),
      target: `https://example.com/${index}`,
      at: new Date(`2026-08-26T13:00:${index.toString().padStart(2, "0")}.000Z`),
    })));

    expect(new Set(records.map((record) => record.id)).size).toBe(32);
    expect((await readdir(store.root)).filter((name) => name.endsWith(".json"))).toHaveLength(32);
    expect(await listCaptureJobs(store, { limit: 32 })).toHaveLength(32);

    const selected = records[0];
    expect(selected).toBeDefined();
    if (selected === undefined) throw new Error("Expected a selected capture job.");
    const updates = await Promise.allSettled([
      updateCaptureJob(store, selected.id, { expectedRevision: 1, phase: "acquiring" }),
      updateCaptureJob(store, selected.id, { expectedRevision: 1, phase: "extracting" }),
    ]);
    expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(updates.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await readCaptureJob(store, selected.id)).revision).toBe(2);
  });

  test("serializes same-revision updates across separate Bun processes", async () => {
    const { root, store } = await temporaryStore();
    const created = await createCaptureJob(store, {
      id: uuid(200),
      target: "https://example.com/cross-process",
    });
    const script = join(root, "contender.ts");
    await writeFile(script, [
      'import { writeFile } from "node:fs/promises";',
      `import { openCaptureJobStore, updateCaptureJob } from ${JSON.stringify(new URL("./jobs.ts", import.meta.url).href)};`,
      "const [root, id, phase, marker, ready, start] = process.argv.slice(2);",
      "if (!root || !id || !phase || !marker || !ready || !start) throw new Error('missing args');",
      "await writeFile(ready, 'ready');",
      "while (!(await Bun.file(start).exists())) await Bun.sleep(1);",
      "const store = await openCaptureJobStore(root);",
      "try {",
      "  const record = await updateCaptureJob(store, id, { expectedRevision: 1, phase: phase as 'acquiring' | 'extracting', appendWarnings: [marker] });",
      "  process.stdout.write(JSON.stringify({ ok: true, revision: record.revision, marker }));",
      "} catch (error) {",
      "  const value = error instanceof Error ? error : new Error(String(error));",
      "  process.stdout.write(JSON.stringify({ ok: false, name: value.name, message: value.message, actualRevision: 'actualRevision' in value ? value.actualRevision : null }));",
      "  process.exitCode = 2;",
      "}",
    ].join("\n"));
    const start = join(root, "start");
    const contenders = [
      { phase: "acquiring", marker: "first", ready: join(root, "ready-first") },
      { phase: "extracting", marker: "second", ready: join(root, "ready-second") },
    ] as const;
    const processes = contenders.map(({ phase, marker, ready }) => Bun.spawn([
      process.execPath,
      script,
      store.root,
      created.id,
      phase,
      marker,
      ready,
      start,
    ], { stdout: "pipe", stderr: "pipe" }));
    const deadline = performance.now() + 5_000;
    while (!(await Promise.all(contenders.map(({ ready }) => Bun.file(ready).exists()))).every(Boolean)) {
      if (performance.now() > deadline) throw new Error("capture-job contenders did not become ready");
      await Bun.sleep(2);
    }
    await writeFile(start, "go");
    const outcomes = await Promise.all(processes.map(async (process_) => {
      const [code, stdout, stderr] = await Promise.all([
        process_.exited,
        new Response(process_.stdout).text(),
        new Response(process_.stderr).text(),
      ]);
      return { code, value: JSON.parse(stdout) as Record<string, unknown>, stderr };
    }));

    expect(outcomes.map(({ code }) => code).toSorted()).toEqual([0, 2]);
    expect(outcomes.every(({ stderr }) => stderr === "")).toBeTrue();
    expect(outcomes.find(({ code }) => code === 2)?.value).toMatchObject({
      ok: false,
      name: "CaptureJobConflictError",
      actualRevision: 2,
    });
    const retained = await readCaptureJob(store, created.id);
    expect(retained.revision).toBe(2);
    expect(retained.warnings).toHaveLength(1);
    expect(await readdir(store.root)).toEqual([`${created.id}.json`]);
  });

  test("rejects malformed, noncanonical, oversized and overly-permissive records", async () => {
    const { store } = await temporaryStore();
    const first = await createCaptureJob(store, { id: uuid(4), target: "https://example.com" });
    const firstPath = join(store.root, `${first.id}.json`);
    const malformed = { ...first, lifecycle: "completed" };
    await writeFile(firstPath, `${JSON.stringify(malformed, null, 2)}\n`, { mode: 0o600 });
    await expect(readCaptureJob(store, first.id)).rejects.toThrow("inconsistent");

    const second = await createCaptureJob(store, { id: uuid(5), target: "https://example.com" });
    const secondPath = join(store.root, `${second.id}.json`);
    await writeFile(secondPath, JSON.stringify(second), { mode: 0o600 });
    await expect(readCaptureJob(store, second.id)).rejects.toThrow("canonical JSON");

    const oversizedId = uuid(6);
    const oversizedPath = join(store.root, `${oversizedId}.json`);
    await writeFile(oversizedPath, "x".repeat(MAX_CAPTURE_JOB_BYTES + 1), { mode: 0o600 });
    await expect(readCaptureJob(store, oversizedId)).rejects.toThrow("bounded record size");

    const privateRecord = await createCaptureJob(store, { id: uuid(7), target: "https://example.com" });
    await chmod(join(store.root, `${privateRecord.id}.json`), 0o644);
    await expect(readCaptureJob(store, privateRecord.id)).rejects.toThrow("group or world");
  });

  test("rejects job-file links, store aliases, replacements and path traversal", async () => {
    const { root, store } = await temporaryStore();
    const linked = await createCaptureJob(store, { id: uuid(8), target: "https://example.com" });
    const linkedPath = join(store.root, `${linked.id}.json`);
    const secondName = join(root, "second-link.json");
    await link(linkedPath, secondName);
    await expect(readCaptureJob(store, linked.id)).rejects.toThrow("single-link regular file");

    const symlinkId = uuid(9);
    const symlinkPath = join(store.root, `${symlinkId}.json`);
    await symlink(secondName, symlinkPath);
    await expect(readCaptureJob(store, symlinkId)).rejects.toThrow("single-link regular file");
    await expect(readCaptureJob(store, "../../outside")).rejects.toThrow("UUID v4");

    const alias = join(root, "jobs-alias");
    await symlink(store.root, alias, "dir");
    await expect(openCaptureJobStore(alias)).rejects.toBeInstanceOf(CaptureJobSafetyError);

    const displaced = join(root, "jobs-displaced");
    await rename(store.root, displaced);
    await mkdir(store.root, { mode: 0o700 });
    await expect(listCaptureJobs(store)).rejects.toThrow("replaced");
  });
});
