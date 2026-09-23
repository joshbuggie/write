import type { Tokenizer } from "marked";

/**
 * How marked reads a single line (or a line and the one after it) of Markdown: the pieces the
 * pre-parse scan in `oversized.ts` is built from. Each mirrors marked's own rules, quirks included,
 * because the scan must never measure a paragraph shorter than marked will parse it.
 */

/** A thematic break ("---", "* * *", "- - - -"), which wins over reading its "-"s as list markers. */
const BREAK = /([-*_])(?:[ \t]*\1){2,}[ \t]*$/.source;
export const THEMATIC_BREAK = new RegExp(`^ {0,3}${BREAK}`);
/** The same at any indentation: whether it's a break in its container is up to the caller. */
export const INDENTED_BREAK = new RegExp(`^[ \\t]*${BREAK}`);
const CONTAINER_MARKER = /^[ \t]*(?:>|(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$))[ \t]?/;
const QUOTE_MARKER = /^ {0,3}>[ \t]?/;
/** A list marker: its bullet (1) or number (2) and delimiter (3), and the spaces after it (4) unless the item is empty. */
export const LIST_MARKER = /^[ \t]*(?:([-+*])|(\d{1,9})([.)]))(?:([ \t]+)(?=\S)|[ \t]*$)/;
/**
 * A marker followed by one space or tab and nothing else ("- "): marked reads it as an empty item only
 * when it continues a list (the same bullet, or delimiter, as the item it follows), and as text otherwise.
 */
export const BARE_MARKER = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]$/;
export const FENCE = /^[ \t]*(`{3,}(?=[^`]*$)|~{3,})/;
export const ATX_HEADING = /^[ \t]*#{1,6}(?:[ \t]|$)/;
/** A setext heading's underline, when it follows paragraph text ("===", "--"). */
export const SETEXT_UNDERLINE = /^(?:=+|-+) *$/;
/** Starts of lines that keep marked from reading the text before an underline as a setext heading. */
export const NOT_SETEXT_TEXT = /^(?:(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)|[>#<|]|`{3}|~{3}|[:\- ]*\|)/;
const TABLE_DELIMITER_ROW = /^ {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?$/;
/** Lines that end a table instead of being one of its rows (marked's list, loosened: more end it). */
export const ENDS_TABLE = /^(?: {0,3}(?:[>#<]|`{3}|~{3}|(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$))| {4}| {0,3}\t)/;

export const isBlank = (line: string) => !/\S/.test(line);

/** Leading whitespace in columns, each tab as four, as marked counts it for list items. */
export function indentOf(line: string): number {
  let columns = 0;
  for (const char of line) {
    if (char === " ") columns++;
    else if (char === "\t") columns += 4;
    else break;
  }
  return columns;
}

/** A line without its blockquote markers (at most `limit` of them), and how many there were. */
export function withoutQuotes(line: string, limit = Infinity): { quotes: number; rest: string } {
  let quotes = 0;
  let rest = line;
  for (let marker = QUOTE_MARKER.exec(rest); marker && quotes < limit; marker = QUOTE_MARKER.exec(rest)) {
    quotes++;
    rest = rest.slice(marker[0].length);
  }
  return { quotes, rest };
}

/** Whether a line opens more nested quotes or list items than `limit`. Linear in the line. */
export function nestsDeeperThan(line: string, limit: number): boolean {
  // Only a line of "-", "*", "_" and spaces can end in a thematic break.
  const mayEndInBreak = !/[^-*_ \t]/.test(line);
  let rest = line;
  for (let depth = 0; depth <= limit; depth++) {
    if (mayEndInBreak && THEMATIC_BREAK.test(rest)) return false;
    const marker = CONTAINER_MARKER.exec(rest);
    if (!marker) return false;
    rest = rest.slice(marker[0].length);
  }
  return true;
}

const BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const ATTRIBUTE = /(?: +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?)/.source;

/**
 * The kinds of HTML block (CommonMark's seven, as marked reads them): how one starts, the text that
 * ends it (its last line) or null when a blank line does, and whether it can interrupt a paragraph.
 */
const HTML_BLOCKS: Array<{
  start: RegExp;
  end: (start: RegExpExecArray) => RegExp | null;
  interrupts: boolean;
}> = [
  {
    start: /^ {0,3}<(script|pre|style|textarea)(?:\s|>|$)/i,
    end: (start) => new RegExp(`</${start[1]}>`, "i"),
    interrupts: true,
  },
  { start: /^ {0,3}<!--/, end: () => /-->/, interrupts: true },
  { start: /^ {0,3}<\?/, end: () => /\?>/, interrupts: false },
  { start: /^ {0,3}<![A-Z]/, end: () => />/, interrupts: false },
  { start: /^ {0,3}<!\[CDATA\[/, end: () => /\]\]>/, interrupts: false },
  // marked takes no tab after the tag name.
  { start: new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?: |/?>|$)`, "i"), end: () => null, interrupts: true },
  {
    start: new RegExp(
      `^ {0,3}(?:<(?!script|pre|style|textarea)[a-z][\\w-]*${ATTRIBUTE}*? */?>|</[a-z][\\w-]*\\s*>)[ \\t]*$`,
      "i",
    ),
    end: () => null,
    interrupts: false,
  },
];

/** The HTML block a line starts, if any: the text that ends it (null: a blank line). */
export function htmlBlockAt(rest: string, paragraphOpen: boolean): { end: RegExp | null } | null {
  for (const kind of HTML_BLOCKS) {
    const start = kind.start.exec(rest);
    if (start && (kind.interrupts || !paragraphOpen)) return { end: kind.end(start) };
  }
  return null;
}

/**
 * For a line less indented than the list item before it: the column of the container an HTML block it
 * starts would be in, since marked ends the item at `<tag …>` or `<!--` indented at most 3 there. -1
 * when the line doesn't end the item that way.
 */
export function htmlAfterItem(rest: string, quotes: number, items: Array<{ column: number }>): number {
  if (!/^<(?:[a-z].*>|!--)/i.test(rest.trimStart())) return -1;
  const indent = indentOf(rest);
  const container = quotes === 0 ? (items.findLast((item) => item.column <= indent)?.column ?? 0) : 0;
  return indent - container < 4 ? container : -1;
}

/** A fenced code block being scanned: its opening run of backticks or tildes, and where it sits. */
export type Fence = { marker: string; quotes: number; column: number };

/** Whether `text` closes the fence: the same run (or a longer one) and nothing else, as marked reads it. */
export function closesFence(fence: Fence, text: string): boolean {
  const indent = indentOf(text);
  const rest = text.trimStart();
  return (
    indent >= fence.column &&
    indent < fence.column + 4 &&
    rest.startsWith(fence.marker) &&
    /^[`~]*[ \t]*$/.test(rest.slice(fence.marker.length))
  );
}

/**
 * Lines that end a list item when indented less than its text (marked's list, simplified), and lines
 * after which a less indented one can't continue it lazily; by how far marked lets them be indented:
 * at most 3, and less than the item's text column.
 */
const LEAVES_ITEM = [0, 1, 2, 3].map((spaces) => ({
  line: new RegExp(`^ {0,${spaces}}(?:[>#<]|\`{3}|~{3}|(?:[*+-]|\\d{1,9}[.)])(?:[ \\t]|$)|${BREAK})`),
  before: new RegExp(`^ {0,${spaces}}(?:\`{3}|~{3}|#|${BREAK})`),
}));

/**
 * Whether a line ends the list item whose text starts at `column` (> 0), as marked decides it: a less
 * indented line that starts another block does, and so does one after a blank line, a line indented as
 * code in the item, or a fence, heading or break; any other less indented line stays in the item as a
 * lazy continuation, whatever the item holds (a paragraph, a fence or an HTML block).
 */
export function leavesItem(column: number, line: string, previous: string): boolean {
  if (column === 0 || isBlank(line) || indentOf(line) >= column) return false;
  const leaves = LEAVES_ITEM[Math.min(3, column - 1)];
  if (leaves.line.test(line)) return true;
  // marked reads the item's lines with each tab as four spaces, and its first line after the marker.
  const expanded = previous.replace(/\t/g, "    ");
  const marker = LIST_MARKER.exec(expanded);
  let inItem = expanded;
  if (marker && itemColumn(marker, indentOf(expanded)) === column) inItem = expanded.slice(marker[0].length);
  else if (indentOf(expanded) >= column) inItem = expanded.slice(column);
  return isBlank(inItem) || indentOf(inItem) >= 4 || leaves.before.test(inItem);
}

/**
 * Whether a line is still inside the fence. A fence outside quotes is followed on the raw lines, since
 * quote markers in it are code; one inside a quote ends where the quote does. Either way it also ends
 * with the list item it's in, read inside the fence's quotes.
 */
export function inFence(fence: Fence, line: string, previous: string, quotes: number): boolean {
  if (quotes < fence.quotes) return false;
  const inQuotes = (text: string) => withoutQuotes(text, fence.quotes).rest;
  return !leavesItem(fence.column, inQuotes(line), inQuotes(previous));
}

/**
 * The column a list item's text starts at: after the marker and the spaces after it, or one space when
 * there are more than four (the rest is indented code).
 */
export function itemColumn(marker: RegExpExecArray, indent: number): number {
  const spaces = marker[4]?.length ?? 1;
  const markerWidth = marker[1] ? 1 : marker[2].length + 1;
  return indent + markerWidth + (spaces <= 4 ? spaces : 1);
}

/**
 * Whether a list marker line starts a new item rather than continuing the open paragraph: a bullet or
 * "1." interrupts a paragraph unless it's indented as code or empty; another number ("5.") only starts
 * an item outside the paragraph's own item (marked, like CommonMark, won't let it interrupt).
 */
export function startsItem(
  marker: RegExpExecArray,
  indent: number,
  paragraphOpen: boolean,
  runColumn: number,
) {
  if (!paragraphOpen) return true;
  if (indent < runColumn) return true; // a sibling or outer item
  const empty = marker[4] === undefined;
  const interrupts = marker[1] !== undefined || Number(marker[2]) === 1;
  return indent < runColumn + 4 && interrupts && !empty;
}

/**
 * Whether `next` is a table delimiter row, which marked lets interrupt a paragraph at the line before
 * it. Plain dashes ("---") are left out: under a paragraph they're a setext heading's underline, unless
 * `line` is a list item, which can't be a heading's text.
 */
export const beforeDelimiterRow = (line: string, next: string) =>
  TABLE_DELIMITER_ROW.test(next) && (/[|:]/.test(next) || LIST_MARKER.test(line));

/** Whether `next` could be a delimiter row under a line in a quote `quotes` deep (marked's paragraph rule). */
export function delimiterRowAfter(next: string, quotes: number): boolean {
  const row = withoutQuotes(next);
  return row.quotes === quotes && TABLE_DELIMITER_ROW.test(row.rest);
}

/** Whether `header` and the line after it form a GFM table (the same column count on both), as marked reads it. */
export function startsTable(header: string, next: string, quotes: number, tables: Tokenizer) {
  const delimiter = withoutQuotes(next);
  if (delimiter.quotes !== quotes || !TABLE_DELIMITER_ROW.test(delimiter.rest)) return false;
  return !!tables.table(`${header}\n${delimiter.rest}`);
}
