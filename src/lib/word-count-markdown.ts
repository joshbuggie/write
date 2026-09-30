import { splitFrontmatter } from "./markdown/file-format";
import { countWords } from "./word-count";

/** Stands in for syntax: neither a space nor a letter or digit, so words keep their boundaries and offsets. */
const MASK = "\u0001";
const mask = (s: string) => s.replace(/\S/g, MASK);

const FENCE_OPEN = /^([ \t>]*)(`{3,}|~{3,})(.*)$/;
/** Four columns of indentation: an indented code block, unless it continues a list item. */
const INDENTED = /^(?: {4}|\t| {1,3}\t)/;
const LIST_ITEM = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** List markers with digits (`1.`) and task boxes (`[x]`); bullets, `#`, `>` and pipes have no letters anyway. */
const LINE_MARKERS = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\](?=[ \t]|$))?/;
/** `[id]: url "title"`: the visual editor turns reference links into inline ones and drops the definition. */
const DEFINITION = /^ {0,3}\[[^\]]+\]:[ \t]*\S/;

/**
 * Inline syntax the visual editor doesn't show as text, unless escaped with `\`: images (alt text isn't
 * counted there), link destinations and titles, HTML tags and entities. Autolinks like
 * `<https://…>` aren't tags (a tag name can't hold `:` or `@`), so their URL still counts as a word.
 */
const INLINE =
  /(?<!\\)!\[[^\]\n]*\]\([^)\n]*\)|(?<!\\)\]\([^)\n]*\)|(?<!\\)<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>\n]*)?\/?>|(?<!\\)&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{1,31});/g;
const HAS_INLINE = /[\]<&]/;
const maskInlineSyntax = (s: string) =>
  HAS_INLINE.test(s) ? s.replace(INLINE, (m) => (m.startsWith("]") ? "]" + mask(m.slice(1)) : mask(m))) : s;

/** Where a line's code spans start and end: each backtick run pairs with the next run of the same length. */
function codeSpans(line: string): [number, number][] {
  const runs = Array.from(line.matchAll(/`+/g), (m) => ({ at: m.index, len: m[0].length }));
  const next = new Array<number>(runs.length);
  const seen = new Map<number, number>();
  for (let i = runs.length - 1; i >= 0; i--) {
    next[i] = seen.get(runs[i].len) ?? -1;
    seen.set(runs[i].len, i);
  }
  const spans: [number, number][] = [];
  for (let i = 0; i < runs.length; i++) {
    if (next[i] < 0) continue;
    spans.push([runs[i].at, runs[next[i]].at + runs[next[i]].len]);
    i = next[i];
  }
  return spans;
}

/** Masks a line's inline syntax outside its code spans, whose text the visual editor shows literally. */
function maskInline(line: string): string {
  if (!line.includes("`")) return maskInlineSyntax(line);
  let out = "";
  let from = 0;
  for (const [start, end] of codeSpans(line)) {
    out += maskInlineSyntax(line.slice(from, start)) + line.slice(start, end);
    from = end;
  }
  return out + maskInlineSyntax(line.slice(from));
}

/**
 * The file with its Markdown syntax masked, so counting its words matches the visual editor's count of
 * the same note (docs/design-decisions.md#d33). Front matter, list markers, task boxes, a fence's language,
 * reference definitions and inline syntax are masked; code keeps its text, as the visual editor shows it.
 * The result has the same length and word boundaries as the file, so a selection's offsets count its
 * words in their context. A line scan rather than a parse, since source-mode notes can be megabytes.
 */
export function maskMarkdown(file: string): string {
  const { frontmatter, body } = splitFrontmatter(file);
  let fence: { char: string; length: number } | null = null;
  let inIndentedCode = false;
  let inList = false;
  let prevBlank = true;
  const lines = body.split("\n").map((line) => {
    if (fence) {
      const close = /^[ \t>]*(`+|~+)[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      return line;
    }
    const blank = !/\S/.test(line);
    if (!blank && prevBlank && !LIST_ITEM.test(line) && !INDENTED.test(line)) inList = false;
    inIndentedCode = !blank && !inList && (prevBlank || inIndentedCode) && INDENTED.test(line);
    prevBlank = blank;
    if (inIndentedCode) return line;

    const open = FENCE_OPEN.exec(line);
    if (open && !(open[2][0] === "`" && open[3].includes("`"))) {
      fence = { char: open[2][0], length: open[2].length };
      return open[1] + open[2] + mask(open[3]);
    }
    if (DEFINITION.test(line)) return mask(line);
    if (LIST_ITEM.test(line)) inList = true;
    const marker = LINE_MARKERS.exec(line)?.[0] ?? "";
    return mask(marker) + maskInline(line.slice(marker.length));
  });
  return mask(frontmatter) + lines.join("\n");
}

/** Words in a Markdown file as the visual editor would count them, optionally only within `from`–`to`. */
export function countMarkdownWords(file: string, from?: number, to?: number): number {
  return countWords(maskMarkdown(file), from, to);
}
