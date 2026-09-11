const REPOSITORY_BLOB_ROOT = "https://github.com/hraness/wordcell/blob/main/";
const REPOSITORY_RAW_ROOT = "https://raw.githubusercontent.com/hraness/wordcell/main/";

export const LANDING_START = "<!-- hraness:wordcell-landing:start -->";
export const LANDING_END = "<!-- hraness:wordcell-landing:end -->";

function decodeCharacterReferences(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/giu, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);?/gu, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10)))
    .replaceAll("&colon;", ":")
    .replaceAll("&Tab;", "\t")
    .replaceAll("&NewLine;", "\n")
    .replaceAll("&amp;", "&");
}

function assertSafeTarget(encodedTarget: string): void {
  const target = decodeCharacterReferences(encodedTarget);
  const compact = target.trim().replace(/[\u0000- \u007f]+/gu, "");
  if (compact.startsWith("//")) {
    throw new Error(`README contains a protocol-relative URL: ${JSON.stringify(target)}`);
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(compact)?.[1]?.toLowerCase();
  if (scheme !== undefined && !["http", "https", "mailto"].includes(scheme)) {
    throw new Error(`README contains a disallowed URL scheme: ${JSON.stringify(target)}`);
  }
}

function rewriteRelativeTargets(html: string): string {
  return html.replace(/(href|src)="([^"]*)"/gu, (
    attribute,
    name: "href" | "src",
    target: string,
  ) => {
    assertSafeTarget(target);
    if (
      target === ""
      || target.startsWith("#")
      || target.startsWith("/")
      || /^[a-z][a-z0-9+.-]*:/iu.test(decodeCharacterReferences(target).trim())
    ) {
      return attribute;
    }
    const root = name === "src" ? REPOSITORY_RAW_ROOT : REPOSITORY_BLOB_ROOT;
    return `${name}="${root}${target}"`;
  });
}

function headingText(html: string): string {
  // Parse text nodes instead of trying to remove nested or malformed markup.
  // The extracted text is used only to derive a restricted fragment identifier.
  let text = "";
  new HTMLRewriter().onDocument({
    text(chunk) {
      text += chunk.text;
    },
  }).transform(html);
  return decodeCharacterReferences(text)
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function githubHeadingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}\s_-]/gu, "")
    .replace(/\s/gu, "-");
}

function addHeadingIds(html: string): string {
  const occurrences = new Map<string, number>();
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/gu, (_, level: string, body: string) => {
    const base = githubHeadingSlug(headingText(body));
    if (base === "") throw new Error("README contains a heading without a stable fragment ID");
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    const id = occurrence === 0 ? base : `${base}-${occurrence}`;
    return `<h${level} id="${id}">${body}</h${level}>`;
  });
}

function assertFragmentsResolve(html: string): void {
  const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/gu), ([, id]) => id));
  for (const [, encodedFragment] of html.matchAll(/\shref="#([^"]+)"/gu)) {
    let fragment: string;
    try {
      fragment = decodeURIComponent(encodedFragment);
    } catch {
      throw new Error(`README contains an invalid encoded fragment: ${JSON.stringify(encodedFragment)}`);
    }
    if (!ids.has(fragment)) {
      throw new Error(`README fragment has no rendered heading: ${JSON.stringify(fragment)}`);
    }
  }
}

export function renderReadmeHtml(source: string): string {
  const document = source.replaceAll(LANDING_START, "").replaceAll(LANDING_END, "")
    .replace(/^\[!\[Agent Skill\]\([^)]+\)\]\(([^)]+)\)\s*$/mu, "[Install the Agent Skill]($1)");
  const html = Bun.markdown.html(document, {
    noHtmlBlocks: true,
    noHtmlSpans: true,
    tagFilter: true,
  });
  for (const match of html.matchAll(/\s(?:href|src)="([^"]*)"/gu)) {
    const target = match[1];
    if (target !== undefined) assertSafeTarget(target);
  }
  const rendered = rewriteRelativeTargets(addHeadingIds(html));
  assertFragmentsResolve(rendered);
  return rendered;
}

/** The README landing block between the shared Hraness markers, without its heading. */
export function readmeLanding(source: string): Readonly<{ title: string; lead: string; markdown: string }> {
  const start = source.indexOf(LANDING_START);
  const end = source.indexOf(LANDING_END);
  if (start < 0 || end <= start) throw new Error("README landing markers are missing or out of order");
  const block = source.slice(start + LANDING_START.length, end).trim();
  const lines = block.split("\n");
  const heading = lines[0] ?? "";
  if (!heading.startsWith("# ")) throw new Error("README landing block must start with its H1");
  const rest = lines.slice(1).join("\n").trim();
  const paragraphs = rest.split(/\n\s*\n/u).filter((paragraph) => !paragraph.startsWith("[![") && !paragraph.startsWith("## "));
  const lead = (paragraphs[0] ?? "").replace(/\s+/gu, " ").trim();
  if (lead === "") throw new Error("README landing block has no lead paragraph");
  return { lead, markdown: rest, title: heading.slice(2).trim() };
}
