import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export const canonicalMetadataToolBuildCommand = "kb url-metadata tool build";
export const staleMetadataToolBuildCommand = "bun run url-metadata:tool:build";

export function staleInstalledCommandPaths(
  files: readonly { path: string; contents: string }[],
): string[] {
  return files
    .filter(({ contents }) => contents.includes(staleMetadataToolBuildCommand))
    .map(({ path }) => path)
    .toSorted();
}

async function markdownFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await markdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      paths.push(path);
    }
  }
  return paths.toSorted();
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, "..");
  const paths = [
    resolve(repositoryRoot, "README.md"),
    ...await markdownFiles(resolve(repositoryRoot, "docs")),
    ...await markdownFiles(resolve(repositoryRoot, "skills")),
  ];
  const files = await Promise.all(paths.map(async (path) => ({
    path: relative(repositoryRoot, path),
    contents: await readFile(path, "utf8"),
  })));
  const stalePaths = staleInstalledCommandPaths(files);
  if (stalePaths.length > 0) {
    throw new Error(
      `public skill/docs must use ${JSON.stringify(canonicalMetadataToolBuildCommand)}; stale command found in ${stalePaths.join(", ")}`,
    );
  }
  for (const requiredPath of [
    "docs/capture.md",
    "skills/save-url-kb/SKILL.md",
  ]) {
    const file = files.find(({ path }) => path === requiredPath);
    if (!file?.contents.includes(canonicalMetadataToolBuildCommand)) {
      throw new Error(
        `${requiredPath} must document ${JSON.stringify(canonicalMetadataToolBuildCommand)}`,
      );
    }
  }
}
