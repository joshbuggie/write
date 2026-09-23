import { Lexer, Tokenizer } from "marked";

/**
 * The check that runs before a note (or a paste) is parsed for the visual editor: whether some inline
 * run is too long to parse without freezing the tab, or quotes and lists nest too deep. It must stay
 * fast on anything up to the 256 KiB a note can have to open visually, so it reads lines, not tokens.
 */

/**
 * Paragraphs longer than this open as Markdown source: marked's emphasis matching (used by Tiptap) is
 * quadratic in paragraph length, and a pasted log of that size can block the tab for seconds. Real prose
 * paragraphs stay far below it.
 */
export const MAX_VISUAL_PARAGRAPH_CHARS = 16 * 1024;

/** Quotes or list items nested deeper than this on one line ("> > > …") open as source: marked recurses per level. */
const MAX_NESTING = 32;
/**
 * The same for a line the scan below reads as code, where markers are text ("```" + ">>>>…" as a
 * separator): far more, in case it guessed wrong, but still well below what overflows the stack.
 */
const MAX_NESTING_IN_CODE = 256;
const CONTAINER_MARKER = /^[ \t]*(?:>|(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$))[ \t]?/;
/** A thematic break ("---", "* * *", "- - - -"), which wins over reading its "-"s as list markers. */
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/** Whether a line opens more nested quotes or list items than `limit`. Linear in the line. */
function nestsDeeperThan(line: string, limit: number): boolean {
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

const QUOTE_MARKER = /^ {0,3}>[ \t]?/;
const LIST_MARKER = /^[ \t]*(?:([-+*])|(\d{1,9})[.)])(?:([ \t]+)(?=\S)|[ \t]*$)/;
const FENCE = /^[ \t]*(`{3,}(?=[^`]*$)|~{3,})/;
const ATX_HEADING = /^[ \t]*#{1,6}(?:[ \t]|$)/;
const TABLE_DELIMITER_ROW = /^ {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?$/;
/** Lines that end a table instead of being one of its rows (marked's list, loosened: more end it). */
const ENDS_TABLE = /^(?: {0,3}(?:[>#<]|`{3}|~{3}|(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$))| {4}| {0,3}\t)/;

const isBlank = (line: string) => !/\S/.test(line);

/** Leading whitespace in columns, tabs to the next multiple of 4, as CommonMark counts it. */
function indentOf(line: string): number {
  let columns = 0;
  for (const char of line) {
    if (char === " ") columns++;
    else if (char === "\t") columns += 4 - (columns % 4);
    else break;
  }
  return columns;
}

/** A line without its blockquote markers, and how many there were. */
function withoutQuotes(line: string): { quotes: number; rest: string } {
  let quotes = 0;
  let rest = line;
  for (let marker = QUOTE_MARKER.exec(rest); marker; marker = QUOTE_MARKER.exec(rest)) {
    quotes++;
    rest = rest.slice(marker[0].length);
  }
  return { quotes, rest };
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
  { start: new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?: |\\t|/?>|$)`, "i"), end: () => null, interrupts: true },
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
function htmlBlockAt(rest: string, paragraphOpen: boolean): { end: RegExp | null } | null {
  for (const kind of HTML_BLOCKS) {
    const start = kind.start.exec(rest);
    if (start && (kind.interrupts || !paragraphOpen)) return { end: kind.end(start) };
  }
  return null;
}

/** A fenced code block being scanned: its opening run of backticks or tildes, and where it sits. */
type Fence = { marker: string; quotes: number; column: number };

/** Whether `text` closes the fence: the same run (or a longer one) and nothing else, as marked reads it. */
function closesFence(fence: Fence, text: string): boolean {
  const indent = indentOf(text);
  const rest = text.trimStart();
  return (
    indent >= fence.column &&
    indent < fence.column + 4 &&
    rest.startsWith(fence.marker) &&
    /^[`~]*[ \t]*$/.test(rest.slice(fence.marker.length))
  );
}

/** Lines that end a list item when indented less than its text (marked's list, simplified). */
const LEAVES_ITEM = /^ {0,3}(?:[>#<]|`{3}|~{3}|(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$))/;

/**
 * Whether a line ends the list item a fence is in (`column` > 0), as marked decides it: a less indented
 * line that starts another block does, and so does one after a blank line, a line indented as code in
 * the item, or a fence, heading or break; any other less indented line stays in the item (and so in
 * the fence) as a lazy continuation.
 */
function leavesItem(column: number, line: string, previous: string): boolean {
  if (column === 0 || isBlank(line) || indentOf(line) >= column) return false;
  if (LEAVES_ITEM.test(line) || THEMATIC_BREAK.test(line)) return true;
  const inItem = indentOf(previous) >= column ? previous.slice(column) : previous;
  return (
    isBlank(previous) ||
    indentOf(inItem) >= 4 ||
    /^ {0,3}(?:`{3}|~{3}|#)/.test(inItem) ||
    THEMATIC_BREAK.test(inItem)
  );
}

/**
 * Whether a line is still inside the fence. A fence outside quotes is followed on the raw lines, since
 * quote markers in it are code; one inside a quote ends where the quote does.
 */
function inFence(fence: Fence, line: string, previous: string, quotes: number): boolean {
  if (fence.quotes === 0) return !leavesItem(fence.column, line, previous);
  return quotes >= fence.quotes;
}

/**
 * The longest inline run (a paragraph, a list item's text, a heading or a table cell: marked lexes each
 * on its own) the markdown can have, and whether it nests too deep. One pass over the lines, so it stays
 * fast on any input; marked's own block lexer is super-linear on some shapes (a list item with thousands
 * of continuation lines, quotes whose depth changes on every line), which froze the tab on open.
 *
 * The run length is an upper bound: a line joins the current run unless it certainly starts a new one
 * or no run at all. Blank lines, headings, thematic breaks, list items that interrupt the paragraph,
 * table rows and code (fenced, or indented where no paragraph is open) end runs. What the scan doesn't
 * follow (HTML blocks, quote depths changing) joins the run, so an unusual note may open as source when
 * it didn't need to. Code lines aren't counted. Exported for tests.
 */
export function scanBlocks(markdown: string): { longestRun: number; tooDeep: boolean } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const tables = new Tokenizer();
  new Lexer({ gfm: true, tokenizer: tables }); // gives the tokenizer marked's GFM rules
  let longestRun = 0;
  let run = 0; // characters in the current run, 0 when none is open
  let runColumn = 0; // where the current run's container starts its content (a list item's text column)
  let runQuotes = 0; // the quote depth the current run started at
  /** Content columns of the list items still open, innermost last (followed outside quotes only). */
  const items: number[] = [];
  let fence: Fence | null = null;
  let html: { end: RegExp | null; quotes: number } | null = null;
  let codeColumn = -1; // the container column of the indented code being scanned, -1 outside code
  let tableQuotes = -1; // the quote depth of the table whose rows come next, -1 outside tables

  const endRun = (length = 0) => {
    longestRun = Math.max(longestRun, run, length);
    run = 0;
  };
  /** Closes the list items a line indented `indent` columns isn't part of. */
  const closeItems = (indent: number) => {
    while (items.length > 0 && indent < items.at(-1)!) items.pop();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const { quotes, rest } = withoutQuotes(line);
    const indent = indentOf(rest);
    const blank = isBlank(rest);
    const previousLine = lines[i - 1] ?? "";

    if (fence) {
      if (inFence(fence, line, previousLine, quotes)) {
        if (closesFence(fence, fence.quotes === 0 ? line : rest) && quotes === fence.quotes) fence = null;
        if (nestsDeeperThan(line, MAX_NESTING_IN_CODE)) return { longestRun, tooDeep: true };
        continue;
      }
      fence = null; // the quote or list item holding it ended
    }
    if (html) {
      const ended = quotes < html.quotes || (blank && html.end === null);
      if (!ended) {
        run += rest.length + 1; // HTML is counted as text: its lines are no reason to open as source
        if (html.end?.test(rest)) {
          html = null;
          endRun();
        }
        if (nestsDeeperThan(line, MAX_NESTING_IN_CODE)) return { longestRun, tooDeep: true };
        continue;
      }
      html = null;
      endRun();
    }
    if (codeColumn >= 0 && quotes === 0 && (blank || indent >= codeColumn + 4)) {
      if (nestsDeeperThan(line, MAX_NESTING_IN_CODE)) return { longestRun, tooDeep: true };
      continue;
    }
    codeColumn = -1;
    // Indented code starting on this line is checked below, with the code limit.
    const startsCode = run === 0 && quotes === 0 && indent >= 4;
    if (!startsCode && nestsDeeperThan(line, MAX_NESTING)) return { longestRun, tooDeep: true };
    if (blank) {
      endRun();
      tableQuotes = -1;
      continue;
    }

    if (tableQuotes === quotes && !THEMATIC_BREAK.test(rest) && !ENDS_TABLE.test(rest)) {
      endRun(rest.length); // a row: each cell is a run of its own
      continue;
    }
    tableQuotes = -1;

    // At the top level, a line followed by a table's delimiter row ("a | b" before "--- | ---") ends
    // the paragraph before it, whether or not the two make a valid table (in quotes and list items,
    // marked's rules differ).
    const next = lines[i + 1];
    const topLevel = quotes === 0 && runQuotes === 0 && runColumn === 0 && items.length === 0;
    if (topLevel && indent < 4 && next !== undefined && beforeDelimiterRow(rest, next)) endRun();
    const paragraphOpen = run > 0;
    const fenceOpen = FENCE.exec(rest);
    const heading = THEMATIC_BREAK.test(rest) || ATX_HEADING.test(rest); // or a thematic break
    const blockStart = !!fenceOpen || heading;
    // A quote ends the list items it's less indented than (it can't continue their text lazily).
    if (quotes > 0) closeItems(indentOf(line));
    // Where this line's container starts its content: indented 4 more, a line is code or continuation.
    // A less indented line continues an open paragraph lazily, unless it starts a block.
    let column: number = runQuotes === quotes ? runColumn : 0;
    if (!paragraphOpen || (indent < column && blockStart)) {
      closeItems(quotes === 0 ? indent : indentOf(line));
      column = quotes === 0 ? (items.at(-1) ?? 0) : 0;
    }

    if (!paragraphOpen && quotes === 0 && indent >= column + 4) {
      codeColumn = column;
      if (nestsDeeperThan(line, MAX_NESTING_IN_CODE)) return { longestRun, tooDeep: true };
      continue;
    }
    if (startsCode && nestsDeeperThan(line, MAX_NESTING)) return { longestRun, tooDeep: true };
    const htmlStart = indent < column + 4 ? htmlBlockAt(rest.trimStart(), paragraphOpen) : null;
    if (htmlStart) {
      // Fences and other syntax inside it are HTML content until it ends (maybe on this line).
      endRun();
      run = rest.length + 1;
      html = htmlStart.end?.test(rest) ? null : { end: htmlStart.end, quotes };
      if (!html) endRun();
      continue;
    }
    // A fence interrupts a paragraph only with a line after it in the same container.
    const lineAfter = i + 1 < lines.length && withoutQuotes(lines[i + 1]).quotes >= quotes;
    if (fenceOpen && indent < column + 4 && (!paragraphOpen || lineAfter)) {
      endRun();
      fence = { marker: fenceOpen[1], quotes, column };
      continue;
    }
    if (heading && indent < column + 4) {
      endRun(rest.length);
      continue;
    }
    const marker = LIST_MARKER.exec(rest);
    if (marker && startsItem(marker, indent, paragraphOpen, column)) {
      endRun();
      if (quotes === 0) closeItems(indent);
      runColumn = itemColumn(marker, indent);
      runQuotes = quotes;
      if (quotes === 0) items.push(runColumn);
      // An empty item holds no paragraph for the next line to continue.
      run = marker[3] === undefined ? 0 : rest.length + 1;
      continue;
    }
    if (!marker && next !== undefined && startsTable(rest, next, quotes, tables)) {
      endRun(rest.length);
      tableQuotes = quotes;
      i++; // the delimiter row
      continue;
    }
    if (!paragraphOpen) {
      runColumn = column;
      runQuotes = quotes;
    } else if (quotes !== runQuotes) {
      runQuotes = -1; // quotes started or ended in the run: its container is unknown, so column 0 is used
    }
    run += rest.length + 1;
  }
  endRun();
  return { longestRun, tooDeep: false };
}

/**
 * The column a list item's text starts at: after the marker and the spaces after it, or one space when
 * there are more than four (the rest is indented code).
 */
function itemColumn(marker: RegExpExecArray, indent: number): number {
  const spaces = marker[3]?.length ?? 1;
  const markerWidth = marker[1] ? 1 : marker[2].length + 1;
  return indent + markerWidth + (spaces <= 4 ? spaces : 1);
}

/**
 * Whether a list marker line starts a new item rather than continuing the open paragraph: a bullet or
 * "1." interrupts a paragraph unless it's indented as code or empty; another number ("5.") only starts
 * an item outside the paragraph's own item (marked, like CommonMark, won't let it interrupt).
 */
function startsItem(marker: RegExpExecArray, indent: number, paragraphOpen: boolean, runColumn: number) {
  if (!paragraphOpen) return true;
  if (indent < runColumn) return true; // a sibling or outer item
  const empty = marker[3] === undefined;
  const interrupts = marker[1] !== undefined || Number(marker[2]) === 1;
  return indent < runColumn + 4 && interrupts && !empty;
}

/**
 * Whether `next` is a table delimiter row, which marked lets interrupt a paragraph at the line before
 * it. Plain dashes ("---") are left out: under a paragraph they're a setext heading's underline, unless
 * `line` is a list item, which can't be a heading's text.
 */
const beforeDelimiterRow = (line: string, next: string) =>
  TABLE_DELIMITER_ROW.test(next) && (/[|:]/.test(next) || LIST_MARKER.test(line));

/** Whether `header` and the line after it form a GFM table (the same column count on both), as marked reads it. */
function startsTable(header: string, next: string, quotes: number, tables: Tokenizer) {
  const delimiter = withoutQuotes(next);
  if (delimiter.quotes !== quotes || !TABLE_DELIMITER_ROW.test(delimiter.rest)) return false;
  return !!tables.table(`${header}\n${delimiter.rest}`);
}

/**
 * Pre-check to run before parsing a note (or a paste) for the visual editor: true when some paragraph
 * (or list item, heading, table cell) may be too long to parse without freezing the tab, or quotes and
 * lists nest so deep that parsing could overflow the stack. Linear (see scanBlocks).
 */
export function hasOversizedParagraph(markdown: string): boolean {
  const { longestRun, tooDeep } = scanBlocks(markdown);
  return tooDeep || longestRun > MAX_VISUAL_PARAGRAPH_CHARS;
}
