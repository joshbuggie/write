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
 */
export function encodeText(text: string): string {
  const escaped = text
    // A backslash only needs doubling before punctuation, or at the end where the next node may start with it.
    .replace(BACKSLASH_BEFORE_PUNCT_OR_END, "\\\\")
    // & only where it would form an entity; < only where a tag, comment or autolink could start.
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, "&amp;")
    .replace(/<(?=[A-Za-z/!?])/g, "&lt;")
    .replace(/`/g, "\\`")
    // * and ~ can't open or close emphasis when surrounded by whitespace ("5 * 3").
    .replace(/[*~]/g, (c, i: number, s: string) =>
      /\s/.test(s[i - 1] ?? "") && /\s/.test(s[i + 1] ?? "") ? c : "\\" + c,
    )
    // _ can't open or close emphasis between two letters/digits, so snake_case stays readable.
    .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_");
  // [ and ] only where a link or reference definition could form; keeps [[wiki]] and [^1].
  return escapeLinkBrackets(escaped);
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
 * Tiptap's task-list tokenizer looks for "- [ ]" one character into a block, even after "\" or a letter
 * ("x- [ ] y" parses as "x" plus a task list), so the bracket is escaped there too.
 */
const TASK_MARKER_NEAR_START = /^(.?\s*[-+*]\s+)\[(?=[ xX]\])/;

/**
 * Escape paragraph lines that would otherwise start a block ("# x", "- x", "1. x", "> x", "---", "- [ ] x").
 * Also drops code-block indentation from the first line: markdown can't keep leading spaces anyway,
 * and four of them would silently turn the paragraph into code.
 */
export function escapeBlockStarts(markdown: string): string {
  return markdown
    .replace(CODE_INDENT, "")
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
 * Code spans (an unescaped backtick up to the next backtick) are left untouched. Paragraph-level.
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

  for (let i = 0; i < n; i++) {
    if (markdown[i] !== "`" || escaped[i]) continue;
    const close = markdown.indexOf("`", i + 1);
    if (close === -1) break; // no backtick after this one, so no more code spans either
    hides.fill(0, i, close + 1);
    i = close;
  }
  return insertBackslashes(markdown, hides);
}

/**
 * Inside an ordered list item, Tiptap reads a later paragraph starting with letters or roman numerals
 * ("a. x", "iv) x", even "Dr. Smith") as a nested list item, so that "." / ")" is escaped there.
 */
export function escapeLetterListMarker(markdown: string): string {
  return markdown.replace(/^(\s*(?:[a-zA-Z]{1,2}|[ivxlcdmIVXLCDM]+))([.)])(?=\s)/, "$1\\$2");
}

let escapeTablePipes = false;

/**
 * Render table cell content with every `|` escaped (code spans included, as GFM requires), so a pipe
 * typed in a cell can't split the row. Rendering is synchronous, so a module flag scoped by try/finally is safe.
 */
export function withEscapedTablePipes<T>(render: () => T): T {
  const previous = escapeTablePipes;
  escapeTablePipes = true;
  try {
    return render();
  } finally {
    escapeTablePipes = previous;
  }
}

const PATCHED = Symbol.for("write.escapePatched");

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
  // Probe: the original returns "*" unchanged only inside code contexts (code mark / code block parent).
  m.encodeTextForMarkdown = (text, node, parent) => {
    const encoded = original("*", node, parent) === "*" ? text : encodeText(text);
    return escapeTablePipes ? encoded.replace(/\|/g, "\\|") : encoded;
  };
  m[PATCHED] = true;
  return true;
}
