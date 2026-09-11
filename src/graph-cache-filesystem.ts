import { lstat, open } from "node:fs/promises";

/** Internal filesystem boundary, kept explicit so race tests observe the real I/O sequence. */
export const graphCacheFileSystem = { lstat, open };
