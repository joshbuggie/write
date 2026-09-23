import { autolinkSpans, LINK_START } from "./autolinks";

/**
 * Conservative markdown escaping for text the user typed in the visual editor.
 *
 * Tiptap's built-in escaping backslash-escapes every `* _ [ ] ~ \` and turns `&`/`<` into entities, which
 * writes `snake\_case`, `Tom &amp; Jerry` and `\[\[wiki\]\]` into files people own. We only escape a
 * character where it could actually change how the text parses, so plain prose stays byte-identical.
 */

/** ASCII punctuation, the only characters a backslash can escape in CommonMark. */
const BACKSLASH_BEFORE_PUNCT_OR_END = /\\(?=[!-/:-@[-`{-~]|$)/g;

/**
 * Escape one text node's content (never code: the manager skips code contexts before calling us).
 * The text is escaped in isolation, so anything at the node's edges is treated as "could combine".
 * Bare URLs (see autolinkSpans) are left as typed, because marked links them with every backslash
 * inside ("https://x.com/\~u" would change the link); `inLink` turns that off for a link's own text,
 * where marked doesn't autolink and a "*" would be read as emphasis.
 * `plainAddresses` escapes URLs like other text and keeps marked from linking them (see LINK_START),
 * for the rare URL that would swallow the syntax after it.
 * `everything` backslash-escapes all ASCII punctuation (see escapeEverything): the inline serializer's
 * last resort, when the targeted escaping above still reads back differently.
 */
export function encodeText(
  text: string,
  { inLink = false, plainAddresses = false, everything = false } = {},
): string {
  if (everything) return escapeEverything(text);
  if (plainAddresses) {
    // Split where a link would start; escaping the pieces alone escapes them the same way.
    const pieces = text.split(LINK_START).map(escapeProse);
    return escapeLinkBrackets(pieces.join("\\"));
  }
  let escaped = "";
  let last = 0;
  for (const [start, end] of inLink ? [] : autolinkSpans(text)) {
    // A "<" right before a URL would make it an <autolink> (or a tag), so it is escaped like "<a".
    escaped += escapeProse(text.slice(last, start)).replace(/<$/, "&lt;");
    escaped += escapeEntities(text.slice(start, end));
    last = end;
  }
  // [ and ] only where a link or reference definition could form; keeps [[wiki]] and [^1].
  return escapeLinkBrackets(escaped + escapeProse(text.slice(last)));
}

/** ASCII punctuation but "|", which only matters in a table row and is escaped there (see escapeTablePipes). */
const ESCAPABLE = /[!-/:-@[-`{}~]/g;

/**
 * Every ASCII punctuation character with a backslash before it. CommonMark reads "\" followed by any
 * ASCII punctuation as that literal character, so the text can't start emphasis, code, a link, an
 * image ("\![x]"), an entity ("\&amp;" reads "&amp;"), a tag or <autolink> ("\<"), a bare URL ("https\:\/\/",
 * "www\.") or an email ("me\@x\.com"), and it can't hide syntax around it either. Ugly, so it is used
 * only when nothing prettier reads back.
 */
export const escapeEverything = (text: string) => text.replace(ESCAPABLE, "\\$&");

/** & only where it would form an entity; < only where a tag, comment or autolink could start. */
const escapeEntities = (text: string) =>
  text.replace(/&(?=#?[A-Za-z0-9]+;)/g, "&amp;").replace(/<(?=[A-Za-z/!?])/g, "&lt;");

/** Everything but brackets (escapeLinkBrackets looks at the whole text node). */
function escapeProse(text: string): string {
  // A backslash only needs doubling before punctuation, or at the end where the next node may start with it.
  return (
    escapeEntities(text.replace(BACKSLASH_BEFORE_PUNCT_OR_END, "\\\\"))
      .replace(/`/g, "\\`")
      // * and ~ can't open or close emphasis when surrounded by whitespace ("5 * 3").
      .replace(/[*~]/g, (c, i: number, s: string) =>
        /\s/.test(s[i - 1] ?? "") && /\s/.test(s[i + 1] ?? "") ? c : "\\" + c,
      )
      // _ can't open or close emphasis between two letters/digits, so snake_case stays readable.
      .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_")
  );
}

/** What may follow a "]" to form a link, a reference link or a reference definition. */
const LINK_CONTINUATION = /[([:]/;

/**
 * Escape every "]" followed by "(", "[" or ":", and every "[" whose next "]" is such a one.
 * One right-to-left pass: a per-"[" lookahead was quadratic on text full of unclosed "[".
 */
function escapeLinkBrackets(text: string): string {
  const escape = new Uint8Array(text.length);
  let nextCloseFormsLink = false;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === "]") nextCloseFormsLink = LINK_CONTINUATION.test(text[i + 1] ?? "");
    if ((text[i] === "]" || text[i] === "[") && nextCloseFormsLink) escape[i] = 1;
  }
  return insertBackslashes(text, escape);
}

/** Copy of `text` with a backslash before every index flagged in `at`. */
function insertBackslashes(text: string, at: Uint8Array): string {
  let out = "";
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    if (!at[i]) continue;
    out += text.slice(last, i) + "\\";
    last = i;
  }
  return out + text.slice(last);
}

/** Leading indentation that would turn a paragraph's first line into an indented code block. */
const CODE_INDENT = /^(?: {0,3}\t| {4,})[ \t]*/;

const BLOCK_STARTS: Array<[RegExp, string]> = [
  [/^(\s{0,3})(#{1,6})(?=\s|$)/, "$1\\$2"], // heading
  [/^(\s{0,3})([-+*])(?=\s|$)/, "$1\\$2"], // bullet list
  [/^(\s{0,3})(\d+)([.)])(?=\s|$)/, "$1$2\\$3"], // ordered list (Tiptap accepts any number of digits)
  [/^(\s{0,3})>/, "$1\\>"], // blockquote
  [/^(\s{0,3})(=+|-+)(\s*)$/, "$1\\$2$3"], // setext underline / thematic break
];

/**
 * Tiptap's task-list tokenizer looks for "- [ ] " one character into a block, even after "\" or a letter
 * ("x- [ ] y" parses as "x" plus a task list), so the bracket is escaped there too. It needs space
 * after the "]", so a link ("- [x](url)") is left alone.
 */
const TASK_MARKER_NEAR_START = /^(.?\s*[-+*]\s+)\[(?=[ xX]\](?:\s|$))/;

/**
 * Escape paragraph lines that would otherwise start a block ("# x", "- x", "1. x", "> x", "---", "- [ ] x").
 * Also drops code-block indentation from the first line: markdown can't keep leading spaces anyway,
 * and four of them would silently turn the paragraph into code.
 */
export function escapeBlockStarts(markdown: string): string {
  return escapeLineStarts(markdown.replace(CODE_INDENT, ""));
}

/**
 * escapeBlockStarts without dropping the first line's indentation: what the inline serializer's
 * read-back checks, since it compares text with the leading spaces still there.
 */
export function escapeLineStarts(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => BLOCK_STARTS.reduce((l, [re, replacement]) => l.replace(re, replacement), line))
    .join("\n")
    .replace(TASK_MARKER_NEAR_START, "$1\\[");
}

/** Characters marked's emphasis matching can't see inside a tag-shaped span (a backtick too: see below). */
const HIDDEN_DELIMITERS = new Set(["*", "_", "~", "`"]);

/** After "<", these start a real tag, comment, autolink or plain "< " text, which never need escaping here. */
const NOT_A_HIDING_LT = /[A-Za-z/!? ]/;

/**
 * While matching emphasis, marked skips anything shaped like a tag ("<x" … ">"), so a literal "<" with
 * formatting before the next ">" hides those delimiters ("x <5 **c** y> z" would lose the bold).
 * Such a "<" is written as "\<"; escaped "<"s don't stop marked's skip, so every one before the ">" is.
 * A backtick counts too: a skipped span ending inside a code span breaks that code span.
 * Code spans (see codeSpans) are left untouched. Paragraph-level.
 *
 * Linear on purpose: it runs on every save, and a per-"<" lookahead froze the tab on long paragraphs
 * full of "<". One pass marks escaped characters, one (right to left) tracks the next unescaped ">"
 * and delimiter, and one writes the output while skipping code spans.
 */
export function escapeTagLikeSpans(markdown: string): string {
  const n = markdown.length;
  // A character is escaped when it follows an unescaped backslash.
  const escaped = new Uint8Array(n);
  for (let i = 1; i < n; i++) escaped[i] = markdown[i - 1] === "\\" && !escaped[i - 1] ? 1 : 0;

  // A "<" hides delimiters when an unescaped delimiter comes before the next unescaped ">" (which must exist).
  const hides = new Uint8Array(n);
  let nextGt = Infinity;
  let nextDelimiter = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    const c = markdown[i];
    if (c === "<" && !NOT_A_HIDING_LT.test(markdown[i + 1] ?? "") && nextDelimiter < nextGt && nextGt < n) {
      hides[i] = 1;
    }
    if (escaped[i]) continue;
    if (c === ">") nextGt = i;
    else if (HIDDEN_DELIMITERS.has(c)) nextDelimiter = i;
  }

  for (const [start, end] of codeSpans(markdown, escaped)) hides.fill(0, start, end);
  return insertBackslashes(markdown, hides);
}

/**
 * The [start, end) ranges of the code spans in inline markdown: a run of backticks up to the next run
 * of the same length ("``a`b``"). A backslash before a run makes its first backtick literal. Linear
 * but for a binary search per run.
 */
function codeSpans(markdown: string, escaped: Uint8Array): Array<[number, number]> {
  const runs: Array<[start: number, length: number]> = [];
  for (let i = 0; i < markdown.length; i++) {
    if (markdown[i] !== "`") continue;
    const start = i;
    while (markdown[i + 1] === "`") i++;
    runs.push([start, i + 1 - start]);
  }
  // The runs of each length, in order, to find the next one that closes an opening run.
  const byLength = new Map<number, number[]>();
  runs.forEach(([, length], r) => {
    if (!byLength.has(length)) byLength.set(length, []);
    byLength.get(length)!.push(r);
  });
  const nextRun = (length: number, after: number) => {
    const candidates = byLength.get(length) ?? [];
    let [low, high] = [0, candidates.length];
    while (low < high) {
      const middle = (low + high) >> 1;
      if (candidates[middle] > after) high = middle;
      else low = middle + 1;
    }
    return candidates[low];
  };

  const spans: Array<[number, number]> = [];
  for (let r = 0; r < runs.length; r++) {
    const literal = escaped[runs[r][0]] ? 1 : 0;
    const [start, length] = [runs[r][0] + literal, runs[r][1] - literal];
    const close = length > 0 ? nextRun(length, r) : undefined;
    if (close === undefined) continue;
    spans.push([start, runs[close][0] + length]);
    r = close;
  }
  return spans;
}

/**
 * Inside an ordered list item, Tiptap reads a later paragraph starting with letters or roman numerals
 * ("a. x", "iv) x", even "Dr. Smith") as a nested list item, so that "." / ")" is escaped there.
 */
export function escapeLetterListMarker(markdown: string): string {
  return markdown.replace(/^(\s*(?:[a-zA-Z]{1,2}|[ivxlcdmIVXLCDM]+))([.)])(?=\s)/, "$1\\$2");
}

/**
 * A table cell's markdown as it goes in the row: every "|" escaped (inside code spans and link
 * destinations too, as GFM requires), so a pipe can't split the row. GFM removes exactly these
 * backslashes before reading the cell, so it reads the same as `markdown` would outside a table.
 */
export const escapeTablePipes = (markdown: string) => markdown.replace(/\|/g, "\\|");

let plainAddresses = false;
let everything = false;

/**
 * Render text with bare addresses written so marked doesn't link them (see encodeText), for the
 * inline serializer's retry when an address swallowed the syntax after it. Rendering is synchronous,
 * so a module flag scoped by try/finally is safe.
 */
export function withPlainAddresses<T>(render: () => T): T {
  const previous = plainAddresses;
  plainAddresses = true;
  try {
    return render();
  } finally {
    plainAddresses = previous;
  }
}

/** Render text with all ASCII punctuation escaped (see escapeEverything). Scoped like the flag above. */
export function withEverythingEscaped<T>(render: () => T): T {
  const previous = everything;
  everything = true;
  try {
    return render();
  } finally {
    everything = previous;
  }
}

const PATCHED = Symbol.for("write.escapePatched");

/** Whether a text node (as the manager passes it) carries a link mark. */
const hasLink = (node: unknown) =>
  ((node as { marks?: Array<string | { type?: string }> } | null)?.marks ?? []).some(
    (mark) => (typeof mark === "string" ? mark : mark.type) === "link",
  );

type PatchableManager = {
  encodeTextForMarkdown?: (text: string, node: unknown, parent?: unknown) => string;
  [PATCHED]?: true;
};

/**
 * Replace the instance's (private) encodeTextForMarkdown with the conservative version. Idempotent.
 * Returns false if the method is missing, i.e. Tiptap internals changed; a test asserts it returns true.
 */
export function patchMarkdownManager(manager: unknown): boolean {
  const m = manager as PatchableManager | null | undefined;
  if (!m || typeof m.encodeTextForMarkdown !== "function") return false;
  if (m[PATCHED]) return true;
  const original = m.encodeTextForMarkdown.bind(m);
  m.encodeTextForMarkdown = (text, node, parent) => {
    // The original returns "*" unchanged only inside code contexts (code mark / code block parent).
    if (original("*", node, parent) === "*") return text;
    return encodeText(text, { inLink: hasLink(node), plainAddresses, everything });
  };
  m[PATCHED] = true;
  return true;
}
