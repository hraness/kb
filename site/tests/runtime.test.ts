import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { publishedRelease } from "../app/publication";

const site = join(import.meta.dir, "..");

async function startBuiltSite() {
  const process_ = Bun.spawn([
    join(site, "node_modules/.bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "0",
  ], {
    cwd: site,
    env: { ...process.env, NODE_ENV: "production" },
    stderr: "pipe",
    stdout: "pipe",
  });
  let output = "";
  let startupSettled = false;
  let rejectStartup: (error: Error) => void = () => {};
  let resolveStartup: (origin: string) => void = () => {};
  const startup = new Promise<string>((resolve, reject) => {
    rejectStartup = reject;
    resolveStartup = resolve;
  });
  const settleFromOutput = (): void => {
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/u);
    if (match === null || !output.includes("Ready in") || startupSettled) return;
    startupSettled = true;
    resolveStartup(`http://127.0.0.1:${match[1]}`);
  };
  const capture = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
        settleFromOutput();
      }
      output += decoder.decode();
      settleFromOutput();
    } catch (error) {
      if (!startupSettled) {
        startupSettled = true;
        rejectStartup(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      reader.releaseLock();
    }
  };
  const captureTasks = [capture(process_.stdout), capture(process_.stderr)];
  const exitTask = process_.exited.then((exitCode) => {
    if (startupSettled) return;
    startupSettled = true;
    rejectStartup(new Error(`Next exited with code ${exitCode} before startup.\n${output}`));
  });
  const timeout = setTimeout(() => {
    if (startupSettled) return;
    startupSettled = true;
    rejectStartup(new Error(`Next did not start within 10 seconds.\n${output}`));
  }, 10_000);
  try {
    const origin = await startup;
    clearTimeout(timeout);
    return { captureTasks, exitTask, origin, process_ };
  } catch (error) {
    clearTimeout(timeout);
    if (process_.exitCode === null) process_.kill("SIGTERM");
    await process_.exited;
    await Promise.allSettled(captureTasks);
    throw error;
  }
}

async function stopBuiltSite(server: Awaited<ReturnType<typeof startBuiltSite>>): Promise<void> {
  if (server.process_.exitCode === null) server.process_.kill("SIGTERM");
  const stoppedGracefully = await Promise.race([
    server.process_.exited.then(() => true),
    Bun.sleep(2_000).then(() => false),
  ]);
  if (!stoppedGracefully && server.process_.exitCode === null) {
    server.process_.kill("SIGKILL");
    await server.process_.exited;
  }
  await server.exitTask;
  await Promise.allSettled(server.captureTasks);
}

describe("built Wordcell site", () => {
  test("serves the homepage, docs, and static discovery files through Next", async () => {
    const server = await startBuiltSite();
    try {
      const [homeResponse, docsResponse, robotsResponse, missingResponse] = await Promise.all([
        fetch(`${server.origin}/`, { redirect: "manual" }),
        fetch(`${server.origin}/docs`, { redirect: "manual" }),
        fetch(`${server.origin}/robots.txt`, { redirect: "manual" }),
        fetch(`${server.origin}/missing`, { redirect: "manual" }),
      ]);
      const [home, docs, robots] = await Promise.all([homeResponse.text(), docsResponse.text(), robotsResponse.text()]);
      expect(homeResponse.status).toBe(200);
      expect(home).toContain(publishedRelease === null ? "First Wordcell release in preparation" : `Current verified release · v${publishedRelease.version}`);
      expect(home).toContain('<link rel="canonical" href="https://wordcell.io"');
      expect(home).toContain('aria-label="Ask AI about this"');
      expect(docsResponse.status).toBe(200);
      expect(docs).toContain('<link rel="canonical" href="https://wordcell.io/docs"');
      expect(docs).toContain('id="install"');
      expect(robotsResponse.status).toBe(200);
      expect(robots).toContain("Sitemap: https://wordcell.io/sitemap.xml");
      expect(missingResponse.status).toBe(404);
    } finally {
      await stopBuiltSite(server);
    }
  }, 20_000);
});
