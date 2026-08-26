import { afterEach, expect, spyOn, test } from "bun:test";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readCaptureBundle,
  verifyCaptureBundle,
} from "./bundle-reader.js";
import {
  beginCaptureBundle,
  CAPTURE_MANIFEST_FILENAME,
  commitCaptureBundle,
  writeCaptureBundle,
  type CaptureManifestInput,
} from "./persist.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kb-capture-reader-")));
  roots.push(root);
  return root;
}

function manifest(assets: CaptureManifestInput["assets"] = []): CaptureManifestInput {
  return {
    sourceUrl: "https://example.com/source",
    canonicalUrl: "https://example.com/source",
    capturedAt: "2026-08-26T12:00:00.000Z",
    platform: "generic",
    status: "complete",
    scope: "page",
    acquisition: { method: "http", finalUrl: "https://example.com/source", contentType: "text/html" },
    extraction: { extractor: "defuddle", score: 10, wordCount: 2, capturedItems: 1, expectedItems: 1 },
    attempts: [{ method: "http", outcome: "succeeded", message: "complete" }],
    assets,
    artifacts: {
      images: { requested: assets.length > 0, status: assets.length > 0 ? "captured" : "not-requested", files: assets.length },
      media: { requested: false, status: "not-requested", files: 0 },
      videoContext: {
        requested: false,
        status: "not-requested",
        thumbnailPath: null,
        transcriptLanguage: null,
        transcriptCueCount: 0,
        transcriptTruncated: false,
        metadata: null,
      },
    },
    evidence: {
      requested: "source",
      screenshotPath: null,
      screenshotStatus: "not-requested",
      sourceHtmlStatus: "captured",
    },
    warnings: [],
  };
}

function bundle(options: { readonly withAsset?: boolean; readonly asset?: Buffer } = {}): string {
  const root = temporaryRoot();
  const transaction = beginCaptureBundle({ outputRoot: root, slug: "stored", force: false });
  const asset = options.asset ?? Buffer.from("image bytes");
  const assets: CaptureManifestInput["assets"] = options.withAsset
    ? [{
        source: "https://example.com/image.png",
        url: "https://example.com/image.png",
        path: "assets/image.png",
        mimeType: "image/png",
        bytes: asset.byteLength,
        sha256: new Bun.CryptoHasher("sha256").update(asset).digest("hex"),
      }]
    : [];
  if (options.withAsset) {
    mkdirSync(transaction.assetsDirectory, { recursive: true });
    writeFileSync(join(transaction.assetsDirectory, "image.png"), asset);
  }
  writeCaptureBundle(transaction, {
    markdown: "# Safe\n\nUntrusted prose.",
    manifest: manifest(assets),
    sourceHtml: "<html><body>inert</body></html>",
  });
  return commitCaptureBundle(transaction);
}

test("reads and verifies exact v4 Markdown while withholding source HTML by default", async () => {
  const path = bundle({ withAsset: true });
  const inspection = await readCaptureBundle(path, { verifyAssets: true });

  expect(inspection.schemaVersion).toBe(4);
  expect(inspection.document.integrity).toBe("verified");
  expect(inspection.document.markdown).toBe("# Safe\n\nUntrusted prose.\n");
  expect(inspection.assets.map(({ integrity }) => integrity)).toEqual(["verified"]);
  expect("sourceHtml" in inspection).toBeFalse();
  expect((await readCaptureBundle(path, { includeSourceHtml: true })).sourceHtml)
    .toContain("data-captured-source");
});

test("reports Markdown and asset tampering without hiding the stored bytes", async () => {
  const path = bundle({ withAsset: true });
  writeFileSync(join(path, "stored.md"), "changed\n");
  writeFileSync(join(path, "assets/image.png"), "changed asset");

  const verification = await verifyCaptureBundle(path, { verifyAssets: true });

  expect(verification.ok).toBeFalse();
  expect(verification.issues.map(({ kind }) => kind)).toEqual([
    "document-integrity",
    "asset-integrity",
  ]);
  expect(verification.inspection.document.markdown).toBe("changed\n");
});

test("reports a missing listed asset as an immutable integrity issue", async () => {
  const path = bundle({ withAsset: true });
  rmSync(join(path, "assets"), { recursive: true });

  const verification = await verifyCaptureBundle(path, { verifyAssets: true });

  expect(verification.ok).toBeFalse();
  expect(verification.inspection.assets).toEqual([
    expect.objectContaining({ path: "assets/image.png", integrity: "mismatch" }),
  ]);
  expect(verification.issues).toContainEqual(expect.objectContaining({
    kind: "asset-integrity",
    path: "assets/image.png",
  }));
  expect(Object.isFrozen(verification.inspection.assets[0])).toBeTrue();
  expect(Object.isFrozen(verification.issues[0])).toBeTrue();
});

test("applies one verification deadline to ancestor checks for zero-byte assets", async () => {
  const path = bundle({ withAsset: true, asset: Buffer.alloc(0) });
  let clockReads = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => clockReads++ < 3 ? 0 : 2);
  try {
    await expect(readCaptureBundle(path, {
      verifyAssets: true,
      maxAssetVerificationMs: 1,
    })).rejects.toThrow("exceeded its time budget");
  } finally {
    clock.mockRestore();
  }
});

test("reads legacy v3 bundles but marks missing document integrity unavailable", async () => {
  const path = bundle();
  const manifestPath = join(path, CAPTURE_MANIFEST_FILENAME);
  const value = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  value.schemaVersion = 3;
  delete value.document;
  writeFileSync(manifestPath, `${JSON.stringify(value)}\n`);

  const inspection = await readCaptureBundle(path);

  expect(inspection.schemaVersion).toBe(3);
  expect(inspection.document.integrity).toBe("unavailable");
  const verification = await verifyCaptureBundle(path);
  expect(verification.ok).toBeFalse();
  expect(verification.issues).toContainEqual(expect.objectContaining({
    kind: "document-integrity",
    message: expect.stringContaining("does not contain"),
  }));
});

test("bounds legacy top-level Markdown discovery without materializing the directory", async () => {
  const path = bundle();
  const manifestPath = join(path, CAPTURE_MANIFEST_FILENAME);
  const value = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  value.schemaVersion = 3;
  delete value.document;
  writeFileSync(manifestPath, `${JSON.stringify(value)}\n`);
  for (let index = 0; index < 1_001; index += 1) {
    writeFileSync(join(path, `decoy-${index}.txt`), "");
  }

  await expect(readCaptureBundle(path)).rejects.toThrow("more than 1000 top-level entries");
});

test("rejects linked bundle files and escaping manifest paths", async () => {
  const path = bundle();
  const outside = join(temporaryRoot(), "outside.md");
  writeFileSync(outside, "outside");
  rmSync(join(path, "stored.md"));
  linkSync(outside, join(path, "stored.md"));
  await expect(readCaptureBundle(path)).rejects.toThrow("single-link");

  const second = bundle();
  const manifestPath = join(second, CAPTURE_MANIFEST_FILENAME);
  const value = JSON.parse(readFileSync(manifestPath, "utf8")) as { document: { path: string } };
  value.document.path = "../outside.md";
  writeFileSync(manifestPath, `${JSON.stringify(value)}\n`);
  await expect(readCaptureBundle(second)).rejects.toThrow("unsafe segment");
});

test("rejects a symlinked document without following it", async () => {
  const path = bundle();
  const outside = join(temporaryRoot(), "outside.md");
  writeFileSync(outside, "outside");
  rmSync(join(path, "stored.md"));
  symlinkSync(outside, join(path, "stored.md"));

  await expect(readCaptureBundle(path)).rejects.toThrow();
});

test("rejects symlinked ancestors for documents, assets, and source evidence", async () => {
  const documentBundle = bundle();
  const documentOutside = temporaryRoot();
  writeFileSync(join(documentOutside, "stored.md"), "# Safe\n\nUntrusted prose.\n");
  symlinkSync(documentOutside, join(documentBundle, "linked"), "dir");
  const documentManifestPath = join(documentBundle, CAPTURE_MANIFEST_FILENAME);
  const documentManifest = JSON.parse(readFileSync(documentManifestPath, "utf8")) as {
    document: { path: string };
  };
  documentManifest.document.path = "linked/stored.md";
  writeFileSync(documentManifestPath, `${JSON.stringify(documentManifest)}\n`);
  await expect(readCaptureBundle(documentBundle)).rejects.toThrow("ancestor");

  const assetBundle = bundle({ withAsset: true });
  const assetOutside = temporaryRoot();
  writeFileSync(join(assetOutside, "image.png"), "image bytes");
  rmSync(join(assetBundle, "assets"), { recursive: true });
  symlinkSync(assetOutside, join(assetBundle, "assets"), "dir");
  await expect(readCaptureBundle(assetBundle, { verifyAssets: true })).rejects.toThrow("ancestor");

  const evidenceBundle = bundle();
  const evidenceOutside = temporaryRoot();
  writeFileSync(join(evidenceOutside, "source.html"), "<html>external</html>");
  rmSync(join(evidenceBundle, "evidence"), { recursive: true });
  symlinkSync(evidenceOutside, join(evidenceBundle, "evidence"), "dir");
  await expect(readCaptureBundle(evidenceBundle, { includeSourceHtml: true })).rejects.toThrow("ancestor");
});
