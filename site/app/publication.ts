import publication from "../published-release.json";

type PublishedRelease = Readonly<{ version: string; verificationRun: string }>;

export function parsePublishedRelease(value: unknown): PublishedRelease | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Published release must be an object.");
  }
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).sort().join(",") !== "verificationRun,version") {
    throw new TypeError("Published release has unexpected fields.");
  }
  if (fields.version === null && fields.verificationRun === null) return null;
  if (typeof fields.version !== "string"
    || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(fields.version)
    || fields.version.split(".").some((part) => BigInt(part) > BigInt(Number.MAX_SAFE_INTEGER))
    || typeof fields.verificationRun !== "string"
    || !/^https:\/\/github\.com\/hraness\/wordcell\/actions\/runs\/[1-9][0-9]*$/u.test(fields.verificationRun)) {
    throw new TypeError("Published release must bind a stable version to its verification run.");
  }
  return { version: fields.version, verificationRun: fields.verificationRun };
}

export const publishedRelease = parsePublishedRelease(publication);
