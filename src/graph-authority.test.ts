import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { graphCacheFileSystem as fsPromises } from "./graph-cache-filesystem.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openGraphAuthority, queryGraph, rebuildGraph, verifyGraph } from "./graph-authority.js";
import { scanVault } from "./vault.js";

const roots: string[] = [];
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fixture(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wordcell-oh-"))); roots.push(root);
  writeFileSync(join(root, "index.md"), "---\nkb_catalog: authored\n---\n# Vault\n");
  writeFileSync(join(root, "alpha.md"), "---\ndocument_id: alpha\ntags: [shared]\nrelations:\n  depends-on: [beta]\n---\n# Alpha\n[[beta]]\n");
  writeFileSync(join(root, "beta.md"), "---\ndocument_id: beta\ntags: [shared]\n---\n# Beta\n");
  return root;
}
function markdown(root: string) {
  return readdirSync(root).filter(path => path.endsWith(".md")).sort().map(path => [path, readFileSync(join(root,path),"utf8")]);
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Wordcell graph cache and lifecycle", () => {
  test("read-only queries and missing verification create no files; invalid queries fail before scanning", async () => {
    const root = fixture(); const before = readdirSync(root).sort();
    await expect(queryGraph("/does-not-exist", { program: "backlinks", note: "../escape" })).rejects.toThrow();
    const result = await queryGraph(root, { program: "backlinks", note: "beta" });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.some(row => row.values.includes("alpha"))).toBe(true);
    await expect(verifyGraph(root)).rejects.toThrow("rebuild");
    expect(readdirSync(root).sort()).toEqual(before);
  });

  test("rebuild persists only ignored derived state; verification and persisted queries leave bytes and mtimes unchanged", async () => {
    const root = fixture(); const authored = markdown(root);
    const rebuilt = await rebuildGraph(root);
    expect(rebuilt.status).toBe("verified");
    const path = join(root,".wordcell","oh.sqlite");
    const before = readFileSync(path); const mtime = statSync(path).mtimeMs;
    expect((await verifyGraph(root)).revision).toBe(rebuilt.revision);
    const result = await queryGraph(root,{program:"shared-tags",note:"alpha"},{persisted:true});
    expect(result.rows.map(row => row.values)).toEqual([["alpha","beta","shared"]]);
    expect(readFileSync(path)).toEqual(before); expect(statSync(path).mtimeMs).toBe(mtime);
    expect(markdown(root)).toEqual(authored);
    expect(readdirSync(join(root,".wordcell")).sort()).toEqual([".gitignore","oh.sqlite"]);
    expect(readFileSync(join(root,".wordcell",".gitignore"),"utf8")).toContain("\n*\n");
  });

  test("incremental rename/delete is equivalent to a fresh replay, including exact proof sources", async () => {
    const root=fixture(); await rebuildGraph(root);
    renameSync(join(root,"beta.md"),join(root,"renamed.md"));
    writeFileSync(join(root,"alpha.md"),"---\ndocument_id: alpha\ntags: [shared]\n---\n# Alpha\n[[renamed]]\n");
    await expect(verifyGraph(root)).rejects.toThrow();
    await rebuildGraph(root);
    const request = {program:"backlinks",note:"renamed"} as const;
    const incremental=await queryGraph(root,request,{persisted:true});
    await rebuildGraph(root,{fresh:true});
    const fresh=await queryGraph(root,request,{persisted:true});
    expect(fresh.revision).toBe(incremental.revision); expect(fresh.rows).toEqual(incremental.rows);
    rmSync(join(root,"alpha.md")); await rebuildGraph(root);
    expect((await queryGraph(root,request,{persisted:true})).rows).toEqual([]);
  });

  test("stale and foreign evidence is rejected while a session retains its immutable snapshot", async () => {
    const root=fixture(); const snapshot=await scanVault(root,{mentionScope:false});
    const authority=await openGraphAuthority(snapshot);
    try {
      const result=await authority.query({program:"shared-tags",note:"alpha"});
      expect(await authority.verifyResult(result)).toBe(true);
      const altered=JSON.parse(JSON.stringify(result)); altered.revision="0".repeat(64);
      expect(await authority.verifyResult(altered)).toBe(false);
      const foreign=await openGraphAuthority(await scanVault(fixture(),{mentionScope:false}));
      try { expect(await foreign.verifyResult(result)).toBe(false); } finally { await foreign.close(); }
      writeFileSync(join(root,"beta.md"),"# Changed\n");
      expect(await authority.verifyResult(result)).toBe(true);
      const current=await openGraphAuthority(await scanVault(root,{mentionScope:false}));
      try { expect(await current.verifyResult(result)).toBe(false); } finally { await current.close(); }
    } finally { await authority.close(); }
    await expect(authority.query({program:"backlinks",note:"beta"})).rejects.toThrow();
  });

  test("corrupt cache is preserved on failed normal rebuild; explicit fresh rebuild recovers from Markdown", async () => {
    const root=fixture(); await rebuildGraph(root); const path=join(root,".wordcell","oh.sqlite");
    const broken=Buffer.from("not a sqlite database"); writeFileSync(path,broken);
    await expect(verifyGraph(root)).rejects.toThrow();
    await expect(rebuildGraph(root)).rejects.toThrow(); expect(readFileSync(path)).toEqual(broken);
    await rebuildGraph(root,{fresh:true}); expect((await verifyGraph(root)).status).toBe("verified");
  });

  test("refuses cache symlinks, hard links, non-files and foreign sidecars without touching their targets", async () => {
    for (const kind of ["symlink","hardlink","directory","sidecar"] as const) {
      const root=fixture(); await rebuildGraph(root); const path=join(root,".wordcell","oh.sqlite");
      const outside=join(fixture(),"important.bin"); writeFileSync(outside,"preserve"); const before=digest(readFileSync(outside));
      if(kind==="sidecar") writeFileSync(path+"-wal","foreign");
      else { rmSync(path); if(kind==="symlink") symlinkSync(outside,path); else if(kind==="hardlink") linkSync(outside,path); else mkdirSync(path); }
      await expect(verifyGraph(root)).rejects.toThrow(); await expect(rebuildGraph(root,{fresh:true})).rejects.toThrow();
      expect(digest(readFileSync(outside))).toBe(before);
    }
  });

  test("refuses redirected cache directories and serializes competing rebuilds", async () => {
    const root=fixture(); const outside=fixture(); symlinkSync(outside,join(root,".wordcell"));
    await expect(rebuildGraph(root)).rejects.toThrow(); expect(readdirSync(outside)).not.toContain(".gitignore");
    rmSync(join(root,".wordcell"));
    const results=await Promise.all([rebuildGraph(root),rebuildGraph(root)]);
    expect(results[0]?.revision).toBe(results[1]?.revision);
    expect((await verifyGraph(root)).status).toBe("verified");
  });

  test("rejects cache growth between path inspection and opening before allocating its bytes", async () => {
    const root = fixture(); await rebuildGraph(root);
    const path = join(root, ".wordcell", "oh.sqlite");
    const originalOpen = fsPromises.open;
    let grew = false;
    const intercepted = spyOn(fsPromises, "open").mockImplementation(async (file, flags, mode) => {
      if (file === path && !grew) { grew = true; truncateSync(path, 65 * 1024 * 1024); }
      return await originalOpen(file, flags, mode);
    });
    try { await expect(verifyGraph(root)).rejects.toMatchObject({ code: "budget" }); }
    finally { intercepted.mockRestore(); }
    expect(grew).toBe(true);
  });

  test("preserves a replacement staging path when the cache directory changes during rebuild", async () => {
    const root = fixture(); const cache = join(root, ".wordcell");
    const originalLstat = fsPromises.lstat;
    let sentinel: string | undefined;
    const intercepted = spyOn(fsPromises, "lstat").mockImplementation((async (file, options) => {
      if (file === cache && sentinel === undefined) {
        const stage = readdirSync(cache).find(name => name.startsWith(".build-"));
        if (stage !== undefined) {
          renameSync(cache, join(root, ".original-wordcell"));
          mkdirSync(join(cache, stage), { recursive: true });
          sentinel = join(cache, stage, "keep.txt");
          writeFileSync(sentinel, "preserve replacement");
        }
      }
      return await originalLstat(file, options);
    }) as typeof fsPromises.lstat);
    try { await expect(rebuildGraph(root)).rejects.toThrow(); }
    finally { intercepted.mockRestore(); }
    expect(sentinel).toBeDefined();
    expect(readFileSync(sentinel!, "utf8")).toBe("preserve replacement");
  });
});
