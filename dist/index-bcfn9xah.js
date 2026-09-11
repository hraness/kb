// @bun
import {
  GRAPH_LIMITS,
  GraphAuthorityError,
  validateGraphQueryRequest
} from "./index-11621h23.js";
import {
  scanVault
} from "./index-0k2x4nn9.js";
import {
  acquireFileLease
} from "./index-3rm7cz6h.js";
import {
  analyzeAuthoredRepositoryScopes
} from "./index-06c9ctr6.js";
import {
  VaultAnalysisBudgetError,
  analyzeVault,
  documentIdState,
  isCanonicalNoteId,
  parseNote
} from "./index-ekpwvbra.js";
import {
  __require
} from "./index-z1w83f81.js";

// src/graph-authority.ts
import { createHash as createHash2 } from "crypto";
import { constants } from "fs";
import { mkdir, mkdtemp, realpath, rename, rm } from "fs/promises";
import { join, resolve as resolve2 } from "path";

// src/graph-facts.ts
import { createHash } from "crypto";
import { isAbsolute, relative, resolve, sep } from "path";
var compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
function canonicalJson(value) {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).toSorted(([left], [right]) => compareText(left, right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}
function invalid(message) {
  throw new GraphAuthorityError("invalid-input", message);
}
function budget(message) {
  throw new GraphAuthorityError("budget", message);
}
function textAtom(value, label) {
  if (typeof value !== "string")
    invalid(`${label} must be a string.`);
  if (Buffer.byteLength(value, "utf8") > GRAPH_LIMITS.atomBytes) {
    budget(`${label} exceeds the ${GRAPH_LIMITS.atomBytes} byte graph atom limit.`);
  }
  return value;
}
function markdownPath(value, label) {
  const path = textAtom(value, label);
  if (!path.toLowerCase().endsWith(".md") || !isCanonicalNoteId(path.slice(0, -3))) {
    invalid(`${label} must be a canonical vault-relative Markdown path.`);
  }
  return path;
}
function createGraphSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== "object")
    invalid("A vault snapshot is required.");
  const rootInput = textAtom(snapshot.root, "Vault root");
  if (!isAbsolute(rootInput) || rootInput.includes("\x00"))
    invalid("Vault root must be absolute.");
  const root = resolve(rootInput);
  const indexPath = textAtom(snapshot.indexPath, "Catalog path");
  if (!isAbsolute(indexPath) || indexPath.includes("\x00"))
    invalid("Catalog path must be absolute.");
  const catalogPath = markdownPath(relative(root, resolve(indexPath)).split(sep).join("/"), "Catalog path");
  const catalogNoteId = catalogPath.slice(0, -3);
  if (!Array.isArray(snapshot.notes))
    invalid("Vault notes must be an array.");
  if (snapshot.notes.length > GRAPH_LIMITS.notes) {
    budget(`Graph exceeds the ${GRAPH_LIMITS.notes} note limit.`);
  }
  let sourceBytes = 0;
  const paths = new Set;
  const sources = snapshot.notes.map((value) => {
    if (value === null || typeof value !== "object")
      invalid("Every vault note must be an object.");
    const candidate = value;
    const path = markdownPath(candidate.path, "Note path");
    if (candidate.id !== path.slice(0, -3))
      invalid(`Note ID must match its canonical path: ${path}.`);
    if (paths.has(path))
      invalid(`Duplicate note path: ${path}.`);
    paths.add(path);
    if (typeof candidate.content !== "string")
      invalid(`Note content must be a string: ${path}.`);
    sourceBytes += Buffer.byteLength(candidate.content, "utf8");
    if (sourceBytes > GRAPH_LIMITS.sourceBytes) {
      budget(`Graph sources exceed the ${GRAPH_LIMITS.sourceBytes} byte limit.`);
    }
    return { path, content: candidate.content };
  }).toSorted((left, right) => compareText(left.path, right.path));
  const documentIds = new Set;
  const noteIds = new Set;
  let connectionObservations = 0;
  const checked = sources.map(({ path, content }) => {
    let note;
    try {
      note = parseNote(path, content);
    } catch {
      invalid(`Cannot parse authored Markdown: ${path}.`);
    }
    if (noteIds.has(note.id))
      invalid(`Duplicate note ID: ${note.id}.`);
    noteIds.add(note.id);
    textAtom(note.title, `Title in ${path}`);
    textAtom(note.properties.type ?? "", `Type in ${path}`);
    for (const tag of note.tags)
      textAtom(tag, `Tag in ${path}`);
    const identity2 = documentIdState(note.metadata);
    if (identity2.kind === "invalid")
      invalid(`Invalid document_id in ${path}.`);
    const documentId = identity2.kind === "valid" ? identity2.documentId : null;
    if (documentId !== null) {
      if (documentIds.has(documentId))
        invalid(`Duplicate document_id: ${documentId}.`);
      documentIds.add(documentId);
    }
    const scopes = analyzeAuthoredRepositoryScopes(note.metadata);
    if (!scopes.valid)
      invalid(`Invalid repository_scopes in ${path}.`);
    for (const scope of scopes.scopes)
      textAtom(scope, `Repository scope in ${path}`);
    connectionObservations += note.links.length + (note.relationDeclarations?.length ?? 0) + (note.relationIssues?.length ?? 0);
    if (connectionObservations > GRAPH_LIMITS.facts) {
      budget(`Graph connections exceed the ${GRAPH_LIMITS.facts} observation limit.`);
    }
    return { note, documentId, scopes: scopes.scopes };
  });
  let analysis;
  try {
    analysis = analyzeVault(checked.map(({ note }) => note), {
      catalogNoteId,
      mentionScope: () => false,
      maxNotes: GRAPH_LIMITS.notes,
      maxConnectionObservations: GRAPH_LIMITS.facts
    });
  } catch (error) {
    if (error instanceof VaultAnalysisBudgetError)
      budget(error.message);
    throw error;
  }
  const included = new Set(analysis.noteConnections.map(({ id }) => id));
  const factGroups = new Map;
  let factCount = 0;
  const add = (source, relation, tuple) => {
    if (!included.has(source))
      invalid(`Graph fact has no authored source: ${source}.`);
    for (const atom of tuple) {
      if (typeof atom === "string")
        textAtom(atom, relation);
      else if (typeof atom === "number" && (!Number.isSafeInteger(atom) || atom < 1)) {
        invalid(`Graph source lines must be positive safe integers: ${source}.`);
      }
    }
    const key = canonicalJson({ relation, tuple });
    const group = factGroups.get(source) ?? new Map;
    if (group.has(key))
      return;
    if (factCount >= GRAPH_LIMITS.facts)
      budget(`Graph exceeds the ${GRAPH_LIMITS.facts} fact limit.`);
    factCount += 1;
    group.set(key, Object.freeze({ relation, tuple: Object.freeze([...tuple]) }));
    factGroups.set(source, group);
  };
  for (const { note, scopes } of checked) {
    if (!included.has(note.id))
      continue;
    const type = note.properties.type ?? "";
    add(note.id, "wordcell.note", [note.id, note.path, note.title, type]);
    if (type.normalize("NFC").toLocaleLowerCase("en-US") === "concept") {
      add(note.id, "wordcell.concept", [note.id]);
    }
    for (const tag of note.tags)
      add(note.id, "wordcell.tag", [note.id, tag]);
    for (const scope of scopes)
      add(note.id, "wordcell.scope", [note.id, scope]);
  }
  for (const link of analysis.contextualLinks) {
    const source = link.source.slice(0, -3);
    add(source, "wordcell.link", [source, link.target.slice(0, -3), link.line]);
  }
  for (const relation of analysis.authoredRelations) {
    add(relation.source, "wordcell.relation", [
      relation.source,
      relation.target,
      relation.predicate,
      relation.provenance.line
    ]);
  }
  for (const relation of analysis.externalAuthoredRelations) {
    add(relation.source, "wordcell.external-relation", [
      relation.source,
      relation.target,
      relation.predicate,
      relation.provenance.line
    ]);
  }
  const sourceDigests = Object.freeze(sources.map(({ path, content }) => Object.freeze({ path, contentSha256: sha256(content) })));
  const digests = new Map(sourceDigests.map(({ path, contentSha256 }) => [path, contentSha256]));
  const records = Object.freeze(checked.filter(({ note }) => included.has(note.id)).map(({ note, documentId }) => Object.freeze({
    key: `edition:note/${sha256(documentId === null ? `path:${note.id}` : `document:${documentId}`)}`,
    id: note.id,
    path: note.path,
    documentId,
    contentSha256: digests.get(note.path),
    facts: Object.freeze([...factGroups.get(note.id)?.entries() ?? []].toSorted(([left], [right]) => compareText(left, right)).map(([, fact]) => fact))
  })).toSorted((left, right) => compareText(left.key, right.key)));
  const identity = Object.freeze({
    schemaVersion: 1,
    vaultIdentity: sha256(root),
    catalogNoteId,
    sourceDigests,
    records
  });
  return Object.freeze({ ...identity, revision: sha256(canonicalJson(identity)), factCount });
}

// src/graph-cache-filesystem.ts
import { lstat, open } from "fs/promises";
var graphCacheFileSystem = { lstat, open };

// src/graph-authority.ts
var openOhGraphAdapter = async (...args) => await (await import("./authority-4sp9d552.js")).openOhGraphAdapter(...args);
var MAX_CACHE_BYTES = 67108864;
var ignoredCache = `# Disposable Wordcell graph state. Rebuild from Markdown.
*
`;
var hash = (bytes) => createHash2("sha256").update(bytes).digest("hex");
function errno(value, code) {
  return value !== null && typeof value === "object" && "code" in value && value.code === code;
}
async function rootPath(root) {
  if (typeof root !== "string" || root.trim() === "" || root.includes("\x00")) {
    throw new GraphAuthorityError("invalid-input", "A graph operation requires a vault root.");
  }
  return await realpath(resolve2(root));
}
async function scan(root, options) {
  return await scanVault(root, {
    ...options,
    mentionScope: false,
    maxNotes: GRAPH_LIMITS.notes,
    maxTotalBytes: GRAPH_LIMITS.sourceBytes,
    maxConnectionObservations: GRAPH_LIMITS.facts
  });
}
async function directoryIdentity(path) {
  const info = await graphCacheFileSystem.lstat(path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) {
    throw new GraphAuthorityError("unsafe-cache", "Wordcell graph state requires a real directory inside the vault.");
  }
  return { dev: info.dev, ino: info.ino };
}
async function sameDirectory(path, expected) {
  const actual = await directoryIdentity(path);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new GraphAuthorityError("unsafe-cache", "The graph cache directory changed during the operation.");
  }
}
async function readCache(path, maximumBytes = MAX_CACHE_BYTES) {
  let observed;
  try {
    observed = await graphCacheFileSystem.lstat(path, { bigint: true });
  } catch (error) {
    if (errno(error, "ENOENT"))
      return null;
    throw error;
  }
  if (!observed.isFile() || observed.isSymbolicLink() || observed.nlink !== 1n) {
    throw new GraphAuthorityError("unsafe-cache", "Graph cache files must be regular files with one link.");
  }
  if (observed.size > BigInt(maximumBytes))
    throw new GraphAuthorityError("budget", "Graph cache exceeds its byte limit.");
  const handle = await graphCacheFileSystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.dev !== observed.dev || before.ino !== observed.ino) {
      throw new GraphAuthorityError("unsafe-cache", "The graph cache changed before it could be read.");
    }
    if (before.size > BigInt(maximumBytes)) {
      throw new GraphAuthorityError("budget", "Graph cache exceeds its byte limit.");
    }
    if (before.size !== observed.size || before.mtimeNs !== observed.mtimeNs || before.ctimeNs !== observed.ctimeNs) {
      throw new GraphAuthorityError("stale", "The graph cache changed before it could be read.");
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0)
        throw new GraphAuthorityError("stale", "The graph cache changed during its read.");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const current = await graphCacheFileSystem.lstat(path, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || current.dev !== before.dev || current.ino !== before.ino || current.nlink !== 1n) {
      throw new GraphAuthorityError("stale", "The graph cache changed during its read.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
async function requireSingleFileCache(path) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await graphCacheFileSystem.lstat(path + suffix);
    } catch (error) {
      if (errno(error, "ENOENT"))
        continue;
      throw error;
    }
    throw new GraphAuthorityError("unsafe-cache", "Graph cache has an active or foreign SQLite sidecar; close its writer before rebuilding.");
  }
}
async function assertFresh(root, options, revision) {
  if (createGraphSnapshot(await scan(root, options)).revision !== revision) {
    throw new GraphAuthorityError("stale", "Markdown changed during the graph operation; retry from a fresh snapshot.");
  }
}
async function openGraphAuthority(snapshot) {
  return await openOhGraphAdapter(createGraphSnapshot(snapshot));
}
async function withGraph(rootInput, options, work) {
  const root = await rootPath(rootInput);
  const snapshot = createGraphSnapshot(await scan(root, options));
  let authority;
  if (options.persisted) {
    const cache = join(root, ".wordcell");
    let identity;
    try {
      identity = await directoryIdentity(cache);
    } catch (error) {
      if (errno(error, "ENOENT"))
        throw new GraphAuthorityError("stale", "No graph cache exists; run wordcell graph rebuild first.");
      throw error;
    }
    const path = join(cache, "oh.sqlite");
    await requireSingleFileCache(path);
    const bytes = await readCache(path);
    if (bytes === null)
      throw new GraphAuthorityError("stale", "No graph cache exists; run wordcell graph rebuild first.");
    await sameDirectory(cache, identity);
    authority = await openOhGraphAdapter(snapshot, { databaseBytes: bytes });
  } else
    authority = await openOhGraphAdapter(snapshot);
  try {
    const result = await work(authority);
    await assertFresh(root, options, snapshot.revision);
    return result;
  } finally {
    await authority.close();
  }
}
async function verifyGraph(root, options = {}) {
  return await withGraph(root, { ...options, persisted: true }, async (authority) => await authority.verify());
}
async function queryGraph(root, request, options = {}) {
  const checked = validateGraphQueryRequest(request);
  return await withGraph(root, options, async (authority) => await authority.query(checked));
}
async function rebuildGraph(rootInput, options = {}) {
  const root = await rootPath(rootInput);
  const rootIdentity = await directoryIdentity(root);
  const snapshot = createGraphSnapshot(await scan(root, options));
  const cache = join(root, ".wordcell");
  try {
    await mkdir(cache, { mode: 448 });
  } catch (error) {
    if (!errno(error, "EEXIST"))
      throw error;
  }
  const cacheIdentity = await directoryIdentity(cache);
  const lease = await acquireFileLease(join(cache, ".rebuild.lock"));
  let staging;
  let stagingIdentity;
  try {
    await sameDirectory(root, rootIdentity);
    await sameDirectory(cache, cacheIdentity);
    const ignore = join(cache, ".gitignore");
    const oldIgnore = await readCache(ignore, 4096);
    if (oldIgnore !== null && oldIgnore.toString("utf8") !== ignoredCache) {
      throw new GraphAuthorityError("unsafe-cache", "The graph cache has an unrecognized .gitignore; preserve it and use a separate vault root.");
    }
    if (oldIgnore === null) {
      const handle2 = await graphCacheFileSystem.open(ignore, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
      try {
        await handle2.writeFile(ignoredCache);
        await handle2.sync();
      } finally {
        await handle2.close();
      }
    }
    const path = join(cache, "oh.sqlite");
    await requireSingleFileCache(path);
    const previous = await readCache(path);
    staging = await mkdtemp(join(cache, ".build-"));
    stagingIdentity = await directoryIdentity(staging);
    const stagedPath = join(staging, "oh.sqlite");
    if (previous !== null && !options.fresh) {
      const handle2 = await graphCacheFileSystem.open(stagedPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
      try {
        await handle2.writeFile(previous);
      } finally {
        await handle2.close();
      }
    }
    const authority = await openOhGraphAdapter(snapshot, { databasePath: stagedPath, writable: true });
    let result;
    try {
      result = await authority.verify();
    } finally {
      await authority.close();
    }
    const ready = await readCache(stagedPath);
    if (ready === null)
      throw new GraphAuthorityError("corrupt-cache", "The graph rebuild did not produce a database.");
    await requireSingleFileCache(stagedPath);
    await assertFresh(root, options, snapshot.revision);
    await lease.assertOwned();
    await sameDirectory(root, rootIdentity);
    await sameDirectory(cache, cacheIdentity);
    await requireSingleFileCache(path);
    const current = await readCache(path);
    if (previous === null !== (current === null) || previous !== null && current !== null && hash(previous) !== hash(current)) {
      throw new GraphAuthorityError("stale", "The graph cache changed during rebuild; retry from its current state.");
    }
    const handle = await graphCacheFileSystem.open(stagedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(stagedPath, path);
    const directory = await graphCacheFileSystem.open(cache, constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return result;
  } finally {
    try {
      if (staging !== undefined && stagingIdentity !== undefined) {
        let stillOwned = false;
        try {
          await sameDirectory(root, rootIdentity);
          await sameDirectory(cache, cacheIdentity);
          await sameDirectory(staging, stagingIdentity);
          stillOwned = true;
        } catch {}
        if (stillOwned)
          await rm(staging, { recursive: true, force: true });
      }
    } finally {
      await lease.release();
    }
  }
}

export { createGraphSnapshot, openGraphAuthority, verifyGraph, queryGraph, rebuildGraph };
