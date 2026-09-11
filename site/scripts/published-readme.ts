/** Bind installation coordinates to the admitted release, preserving all other prose. */
export function publishedReadme(source: string, sourceVersion: string, publishedVersion: string | null): string {
  if (publishedVersion === null) {
    throw new Error("Cannot publish README installation commands without an admitted release.");
  }
  for (const version of [sourceVersion, publishedVersion]) {
    if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(version)
      || version.split(".").some((part) => BigInt(part) > BigInt(Number.MAX_SAFE_INTEGER))) {
      throw new TypeError("README installation version must be a canonical stable version.");
    }
  }
  const archive = (version: string) => `https://github.com/hraness/wordcell/releases/download/v${version}/hraness-wordcell-${version}.tgz`;
  const escaped = sourceVersion.replaceAll(".", "\\.");
  return source.replaceAll(archive(sourceVersion), archive(publishedVersion))
    .replace(new RegExp(`hraness/wordcell#v${escaped}(?![\\w.-])`, "gu"), `hraness/wordcell#v${publishedVersion}`)
    .replace(new RegExp(`@hraness/wordcell@${escaped}(?![\\w.-])`, "gu"), `@hraness/wordcell@${publishedVersion}`);
}
