import { escapeLineStarts } from "../escape";
import type { Piece } from "./flanking";

/**
 * Tiptap's task-list tokenizer is tried one character into a paragraph, so a paragraph starting with
 * "`- [ ] x`" would re-open as "`" plus a task list. A two-backtick fence and a space keep the marker out
 * of its reach without touching the code (CommonMark strips that one space on each side).
 */
const TASK_MARKER = /^\s*[-+*]\s+\[[ xX]\]/;

/**
 * A code span that re-opens with exactly this content: the fence is longer than any backtick run inside,
 * and a space pads content that starts or ends with a backtick or that marked would otherwise trim.
 */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const looksLikeTask = TASK_MARKER.test(text);
  const fence = "`".repeat(Math.max(longest + 1, looksLikeTask ? 2 : 1));
  const trimmedByParser = /^ [\s\S]* $/.test(text) && /[^ ]/.test(text);
  const pad = /^`|`$/.test(text) || trimmedByParser || looksLikeTask ? " " : "";
  return fence + pad + text + pad + fence;
}

/**
 * Escape `[`/`]` that aren't part of a balanced pair in the text pieces from `from` on (code and images
 * keep theirs), so they can't end a link's text early ("a]b") or start a new link ("a[b"). Pairs nested
 * inside another pair are escaped too: marked reads one level of brackets in link text, not "[[x] y]".
 */
function escapeUnbalancedBrackets(pieces: Piece[], from: number): void {
  const open: Array<[piece: number, offset: number]> = [];
  const unbalanced: Array<[piece: number, offset: number]> = [];
  for (let p = from; p < pieces.length; p++) {
    const piece = pieces[p];
    if (!piece.text) continue;
    for (let i = 0; i < piece.md.length; i++) {
      const char = piece.md[i];
      if (char === "\\") i++;
      else if (char === "[") open.push([p, i]);
      else if (char === "]") {
        const opening = open.pop();
        if (!opening || open.length) unbalanced.push([p, i]);
        if (opening && open.length) unbalanced.push(opening);
      }
    }
  }
  // Insert from the end so earlier offsets stay valid.
  [...unbalanced, ...open]
    .sort(([pa, oa], [pb, ob]) => pb - pa || ob - oa)
    .forEach(([p, offset]) => {
      const md = pieces[p].md;
      pieces[p] = { ...pieces[p], md: md.slice(0, offset) + "\\" + md.slice(offset) };
    });
}

/** A bracket after a literal (escaped) backslash: an even run of backslashes before it. */
const BRACKET_AFTER_BACKSLASH = /(?<!\\)((?:\\\\)+)(?=[[\]])/g;

/**
 * Escape link text so it stays the link's text: unbalanced brackets (see escapeUnbalancedBrackets).
 * marked also un-escapes brackets in link text before reading it, so a "(" right after "]" is escaped
 * ("[x](y)" typed in link text isn't a link), and so is a bracket after a typed backslash ("\\[" would
 * lose the backslash).
 */
export function escapeLinkText(pieces: Piece[], from: number): void {
  const escapeText = (escape: (md: string) => string) => {
    for (let p = from; p < pieces.length; p++) {
      if (pieces[p].text) pieces[p] = { ...pieces[p], md: escape(pieces[p].md) };
    }
  };
  // First, so the brackets it escapes no longer count toward balancing the others.
  escapeText((md) => md.replace(BRACKET_AFTER_BACKSLASH, "$1\\"));
  escapeUnbalancedBrackets(pieces, from);
  escapeText((md) => md.replace(/\](?=\()/g, "]\\"));
}

/**
 * A newline in alt text stays one only before a line that starts with a letter or digit and wouldn't
 * start a block ("a long\ndescription"); before anything else (a blank line, "<div>", a fence, "1. x",
 * a delimiter row) it would end the paragraph or start a block, and the image would be lost.
 */
const keepsNewline = (line: string) => /^[\p{L}\p{N}]/u.test(line) && escapeLineStarts(line) === line;

/**
 * marked only reads a backtick in an image's (or link's) text as part of a pair ("a `b` c"): a backtick
 * with no later one to pair with ends the text, and the image is lost. Such a backtick is escaped.
 */
function escapeUnpairedBackticks(alt: string): string {
  let out = "";
  for (let i = 0; i < alt.length; i++) {
    if (alt[i] === "\\") {
      out += alt.slice(i, i + 2);
      i++;
    } else if (alt[i] === "`") {
      const close = alt.indexOf("`", i + 1);
      out += close === -1 ? "\\`" : alt.slice(i, close + 1);
      if (close !== -1) i = close;
    } else out += alt[i];
  }
  return out;
}

/**
 * An image's alt text; marked un-escapes brackets in it and keeps every other backslash as written, so
 * what a backslash can't fix is written differently: a newline before a line that would end the
 * paragraph or start a block as a space (see keepsNewline), a backslash at the end, which would escape
 * the "]", with a space after it, and a backtick with nothing to pair with escaped (it re-opens with the
 * backslash). None can come from Markdown (the text wouldn't be an image there), only from pasted HTML.
 */
export function escapeAltText(alt: string): string {
  const oneBlock = alt.replace(/\n(?=([^\n]*))/g, (newline, line: string) =>
    keepsNewline(line) ? newline : " ",
  );
  const pieces: Piece[] = [{ md: escapeUnpairedBackticks(oneBlock), text: true }];
  escapeUnbalancedBrackets(pieces, 0);
  return pieces[0].md.replace(/(?<!\\)(?:\\\\)*\\$/, "$& ");
}

/**
 * A backslash marked removes from a destination: before any punctuation or symbol (marked unescapes
 * Unicode ones too, "\\「"), or at the end, where the ")" or ">" closing the destination follows. A
 * literal one there is doubled.
 */
const BACKSLASH_BEFORE_PUNCTUATION = /\\(?=[\p{P}\p{S}]|$)/gu;

function parenthesesBalance(href: string): boolean {
  let depth = 0;
  for (const char of href) {
    if (char === "(") depth++;
    else if (char === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * A link or image destination that re-opens as the same href: bare when that's unambiguous, otherwise
 * in `<…>` (spaces, unbalanced parentheses, angle brackets), which keeps Wikipedia-style `Foo_(bar)` bare.
 * A backtick is escaped: in a table row, Tiptap would pair it with one in another cell (and marked
 * removes the backslash again).
 */
export function linkDestination(href: string): string {
  const escaped = href.replace(BACKSLASH_BEFORE_PUNCTUATION, "\\\\").replace(/`/g, "\\`");
  const bare = href !== "" && !/[\s<>\p{Cc}]/u.test(href) && parenthesesBalance(href);
  return bare ? escaped : `<${escaped.replace(/[<>]/g, "\\$&")}>`;
}

/** `](destination "title")`, the end of a link whose text has just been written. */
export function linkSuffix(attrs: Record<string, unknown> = {}): string {
  const href = typeof attrs.href === "string" ? attrs.href : "";
  const title = typeof attrs.title === "string" && attrs.title ? attrs.title : "";
  const titlePart = title ? ` "${title.replace(/["\\`]/g, "\\$&")}"` : "";
  return `](${linkDestination(href)}${titlePart})`;
}
