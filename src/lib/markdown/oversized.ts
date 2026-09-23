import { Lexer, Tokenizer } from "marked";
import {
  ATX_HEADING,
  BARE_MARKER,
  beforeDelimiterRow,
  closesFence,
  delimiterRowAfter,
  endsLazyQuote,
  ENDS_TABLE,
  FENCE,
  type Fence,
  htmlAfterItem,
  htmlBlockAt,
  INDENTED_BREAK,
  indentOf,
  inFence,
  isBlank,
  itemColumn,
  lazyQuoteLines,
  leavesItem,
  LIST_MARKER,
  nestsDeeperThan,
  NOT_SETEXT_TEXT,
  SETEXT_UNDERLINE,
  spacesAfterMarker,
  startsItem,
  startsTable,
  THEMATIC_BREAK,
  underlinesAhead,
  withoutQuotes,
} from "./oversized-lines";

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

/**
 * Follows a quirk of marked's blockquote reading: a quote that holds a list, goes on lazily (a line
 * without ">"), then resumes (`> - a`, `b`, `> c`) is counted one character too long per resumption,
 * so marked skips that many characters after the quote. A fence opener, blank line or indentation there
 * then reads differently, and everything after can too. Returns whether the text is still trusted.
 */
function quoteResumptions() {
  let quotedList = false; // a quoted line held a list marker since the last blank line
  let lazyAfterList = false; // and a line without quotes followed it
  let trusted = true;
  return (quotes: number, rest: string, blank: boolean) => {
    if (quotes > 0) {
      if (lazyAfterList) trusted = false;
      if (LIST_MARKER.test(rest)) quotedList = true;
    } else if (blank) {
      quotedList = lazyAfterList = false;
    } else if (quotedList) {
      lazyAfterList = true;
    }
    return trusted;
  };
}

/**
 * The longest inline run (a paragraph, a list item's text, a heading or a table cell: marked lexes each
 * on its own) the markdown can have, and whether it nests too deep. One pass over the lines, so it stays
 * fast on any input; marked's own block lexer is super-linear on some shapes (a list item with thousands
 * of continuation lines, quotes whose depth changes on every line), which froze the tab on open.
 *
 * The run length is an upper bound: a line joins the current run unless it certainly starts a new one
 * or no run at all. Blank lines, headings, thematic breaks, list items that interrupt the paragraph,
 * table rows and code (fenced, or indented where no paragraph is open) end runs, as marked reads them,
 * quirks included (see oversized-lines.ts). What the scan doesn't follow (quote depths changing, lists
 * inside quotes) joins the run, so an unusual note may open as source when it didn't need to. Code
 * lines aren't counted. Exported for tests.
 */
export function scanBlocks(markdown: string): { longestRun: number; tooDeep: boolean } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const tables = new Tokenizer();
  new Lexer({ gfm: true, tokenizer: tables }); // gives the tokenizer marked's GFM rules
  const stillTrusted = quoteResumptions();
  const inLazyQuote = lazyQuoteLines();
  const underlineAhead = underlinesAhead(lines);
  let untrustedFrom = -1; // the first line marked may read shifted, whose rest then counts as one run
  let longestRun = 0;
  let run = 0; // characters in the current run, 0 when none is open
  let runColumn = 0; // where the current run's container starts its content (a list item's text column)
  let runQuotes = 0; // the quote depth the current run started at
  let runBullet: string | undefined; // the marker kind when the current run is a list item's text
  let runNotSetext = false; // a line of the current run keeps it from being a setext heading's text
  let lastNotSetext = false; // the last line of the current run does
  // The current run went on over a blank line: marked's setext rule, which stops at one, can't take it.
  let acrossBlank = false;
  /** The list items still open, innermost last (followed outside quotes only). */
  const items: Array<{ column: number; bullet: string }> = [];
  let fence: Fence | null = null;
  let html: { end: RegExp | null; quotes: number; column: number } | null = null;
  let codeColumn = -1; // the container column of the indented code being scanned, -1 outside code
  let tableQuotes = -1; // the quote depth of the table whose rows come next, -1 outside tables

  const endRun = (length = 0) => {
    longestRun = Math.max(longestRun, run, length);
    run = 0;
    acrossBlank = false;
  };
  /** Closes the list items a line indented `indent` columns isn't part of. */
  const closeItems = (indent: number) => {
    while (items.length > 0 && indent < items.at(-1)!.column) items.pop();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const { quotes, rest } = withoutQuotes(line);
    const indent = indentOf(rest);
    const blank = isBlank(rest);
    const previousLine = lines[i - 1] ?? "";
    const previous = withoutQuotes(previousLine);
    const next = lines[i + 1];
    // Whether the next line continues this line's quote lazily (it has fewer ">" and some text).
    const lazyNext = next !== undefined && withoutQuotes(next).quotes < quotes && !isBlank(next);
    if (!stillTrusted(quotes, rest, blank) && untrustedFrom < 0) untrustedFrom = i;
    // A quoted line that is code (a fence, or indented code) takes no lazy lines after it.
    const quotedCode =
      quotes > 0 &&
      ((fence !== null && fence.quotes > 0 && quotes >= fence.quotes) ||
        FENCE.test(rest) ||
        (indent >= 4 && run === 0));
    // The depth of the quote that takes this line lazily, where "-" is text (see lazyQuoteLines), or 0.
    const lazyQuote = inLazyQuote(line, quotes, quotedCode);

    if (fence) {
      if (inFence(fence, line, previousLine, quotes)) {
        if (closesFence(fence, fence.quotes === 0 ? line : rest) && quotes === fence.quotes) fence = null;
        if (nestsDeeperThan(line, MAX_NESTING_IN_CODE)) return { longestRun, tooDeep: true };
        continue;
      }
      fence = null; // the quote or list item holding it ended
    }
    if (html) {
      const inQuotes = (text: string) => withoutQuotes(text, html!.quotes).rest;
      const ended =
        quotes < html.quotes ||
        (html.end === null && isBlank(inQuotes(line))) ||
        leavesItem(html.column, inQuotes(line), inQuotes(previousLine));
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
    // A quote ends the list items it's less indented than (it can't continue their text lazily).
    if (quotes > 0) closeItems(indentOf(line));
    // A deeper quote than the run's starts a container of its own, where no paragraph is open yet.
    let paragraphOpen = run > 0 && !(runQuotes >= 0 && runQuotes < quotes);
    // A paragraph marked reads with its paragraph rule (not a list item's text, which it reads by line).
    let plainParagraph = paragraphOpen && (runQuotes === quotes ? runColumn : 0) === 0;
    // That rule runs on over a blank line holding a tab, and over a quoted one holding whitespace
    // after its "> " (">\t", ">  ") when the quote then goes on lazily: marked joins the lazy lines'
    // paragraph, or indented code, to the quote's.
    const quotedWhitespace = quotes > 0 && !/> ?$/.test(line);
    if (blank && plainParagraph && (rest.includes("\t") || (quotedWhitespace && lazyNext))) {
      run += rest.length + 1;
      acrossBlank = true;
      continue;
    }
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

    // A setext underline ends the paragraph when marked reads the text before it as the heading's: all
    // of it for "===", and at least the line before for dashes (marked starts a paragraph there). Not
    // in a list item's text, where marked's lazy lines still continue the item after it, on a line a
    // quote takes lazily, which marked indents to keep it from being one, or after a blank line.
    const underline =
      plainParagraph &&
      runQuotes === quotes &&
      indent < 4 &&
      lazyQuote === 0 &&
      !acrossBlank &&
      SETEXT_UNDERLINE.test(rest.trimStart()) &&
      !(rest.trimStart().startsWith("=") ? runNotSetext : lastNotSetext);
    // At the top level, a line followed by a table's delimiter row ("a | b" before "--- | ---") ends
    // the paragraph before it, whether or not the two make a valid table (in quotes and list items,
    // marked's rules differ). Not an underline: marked reads the heading first ("a", "==", "| - |").
    const topLevel = quotes === 0 && runQuotes === 0 && runColumn === 0 && items.length === 0;
    if (topLevel && !underline && indent < 4 && next !== undefined && beforeDelimiterRow(rest, next)) {
      endRun();
      paragraphOpen = plainParagraph = false;
    }
    // Before what could be a delimiter row ("-", "| - |"), a line indented as code joins the paragraph
    // as lazy text, and the paragraph ends there. (Not on the first line a quote continues lazily:
    // marked joins the paragraph after it back up.)
    const firstLazyLine = previous.quotes > quotes;
    if (
      plainParagraph &&
      indent >= 4 &&
      !firstLazyLine &&
      next !== undefined &&
      delimiterRowAfter(next, quotes)
    ) {
      endRun(run + rest.length + 1);
      continue;
    }
    // The kind of list a marker here would continue: the outermost open item it's less indented than.
    const openList =
      quotes === 0
        ? items.find((item) => item.column > indent)?.bullet
        : runQuotes === quotes && indent < runColumn
          ? runBullet
          : undefined;
    const listMarker = LIST_MARKER.exec(rest);
    const bullet = listMarker?.[1] ?? listMarker?.[3];
    // A marker alone of another kind ("-\t" in a "1." item) starts no item, but marked's list item
    // still ends there, and a paragraph starts outside the list.
    const bareOtherMarker = BARE_MARKER.test(rest) && openList !== bullet;
    if (
      paragraphOpen &&
      bareOtherMarker &&
      quotes === 0 &&
      runQuotes === 0 &&
      indent < Math.min(4, runColumn)
    ) {
      endRun();
      paragraphOpen = plainParagraph = false;
    }
    const fenceOpen = FENCE.exec(rest);
    // A heading or thematic break, at any indentation: whether it's one in its container is checked below.
    const heading = INDENTED_BREAK.test(rest) || ATX_HEADING.test(rest);
    // Where this line's container starts its content: indented 4 more, a line is code or continuation.
    // A less indented line continues an open paragraph lazily, unless it starts a block.
    let column: number = runQuotes === quotes ? runColumn : 0;
    if (!paragraphOpen || (indent < column && (!!fenceOpen || heading))) {
      // marked continues a list item on any less indented line that doesn't leave it, paragraph or not.
      if (quotes === 0)
        while (items.length > 0 && leavesItem(items.at(-1)!.column, line, previousLine)) items.pop();
      // In a quote, only the item the run was in is known: a line indented into it is still in it.
      const itemInQuote = runQuotes === quotes && indent >= runColumn ? runColumn : 0;
      column = quotes === 0 ? (items.at(-1)?.column ?? 0) : itemInQuote;
    }

    // Indented code. Right after a quote, marked may read the line as part of a list item in the quote,
    // and a quote's lazy lines (see lazyQuoteLines) as part of its last paragraph: counted as text.
    const afterQuotedItem = runQuotes > 0 && runBullet !== undefined && previous.quotes > 0;
    if (!paragraphOpen && quotes === 0 && indent >= column + 4 && !afterQuotedItem && lazyQuote === 0) {
      codeColumn = column;
      if (nestsDeeperThan(line, MAX_NESTING_IN_CODE)) return { longestRun, tooDeep: true };
      continue;
    }
    // In a quote its lines aren't followed like that: each is checked, and none continues a paragraph.
    if (!paragraphOpen && quotes > 0 && indent >= column + 4) {
      endRun();
      runBullet = undefined;
      continue;
    }
    if (startsCode && nestsDeeperThan(line, MAX_NESTING)) return { longestRun, tooDeep: true };
    // HTML interrupts a paragraph only at its first column (marked); in a list item's text, indented up
    // to 3. A less indented line that starts a tag ends the item, so no paragraph is open for it; one
    // that doesn't ("\t<!--" under "1.   a") is a lazy line of the paragraph.
    const afterItem = column > 0 && indent < column ? htmlAfterItem(rest, quotes, items) : -1;
    const inItemText = column > 0 && (indent >= column || afterItem >= 0);
    const htmlCanStart = indent < column + 4 && (!paragraphOpen || inItemText || indent === 0);
    const htmlStart = htmlCanStart ? htmlBlockAt(rest.trimStart(), paragraphOpen && afterItem < 0) : null;
    if (htmlStart) {
      // Fences and other syntax inside it are HTML content until it ends (maybe on this line).
      endRun();
      run = rest.length + 1;
      const htmlColumn = afterItem < 0 ? column : afterItem;
      html = htmlStart.end?.test(rest) ? null : { end: htmlStart.end, quotes, column: htmlColumn };
      if (!html) endRun();
      continue;
    }
    // A fence interrupts a paragraph only with a line after it in the same container.
    const lineAfter = next !== undefined && withoutQuotes(next).quotes >= quotes;
    if (fenceOpen && indent < column + 4 && (!paragraphOpen || lineAfter)) {
      endRun();
      // Indented further into a list item, it may be in a nested item the scan doesn't follow ("1. -"
      // over "      ~~~~"): taking its own indentation as its column ends it at the first line less
      // indented, which counts more lines as text, never fewer.
      fence = { marker: fenceOpen[1], quotes, column: column > 0 ? Math.max(column, indent) : column };
      continue;
    }
    if (heading && indent < column + 4) {
      endRun(rest.length);
      continue;
    }
    if (underline) {
      endRun();
      continue;
    }
    // A quote reads "-" among its lazy lines indented, as text (see lazyQuoteLines), not as an item.
    const lazyText = lazyQuote > 0 && indent < 4 && SETEXT_UNDERLINE.test(rest.trimStart());
    // In a paragraph, a marker and a tab before an underline is heading text too (see underlinesAhead).
    const headingText = plainParagraph && quotes === 0 && runQuotes === 0 && underlineAhead[i] === 1;
    const marker = bareOtherMarker || lazyText || headingText ? null : listMarker;
    if (marker && bullet && startsItem(marker, indent, paragraphOpen, column)) {
      endRun();
      if (quotes === 0) closeItems(indent);
      runColumn = itemColumn(marker, indent);
      runQuotes = quotes;
      runBullet = bullet;
      if (quotes === 0) items.push({ column: runColumn, bullet });
      // An empty item holds no paragraph for the next line to continue, nor one whose text opens a block.
      run = marker[4] === undefined ? 0 : rest.length + 1;
      const text = rest.slice(marker[0].length);
      runNotSetext = lastNotSetext = NOT_SETEXT_TEXT.test(text);
      const opensBlock = marker[4] !== undefined && spacesAfterMarker(marker, indent) <= 4;
      const textFence = opensBlock ? FENCE.exec(text) : null;
      const textHtml = opensBlock ? htmlBlockAt(text, false) : null;
      if (textFence) {
        run = 0;
        fence = { marker: textFence[1], quotes, column: runColumn };
      } else if (textHtml && !textHtml.end?.test(text)) {
        html = { end: textHtml.end, quotes, column: runColumn }; // counted as text, as above
      } else if (textHtml || THEMATIC_BREAK.test(text) || ATX_HEADING.test(text)) {
        endRun();
      }
      continue;
    }
    // A header indented as code in its container is code (lazy text in an open paragraph), never a
    // table. (A list item's lazy line keeps its own indentation in the item's text.)
    const indentInContainer = indent >= column ? indent - column : indent;
    // Nor a line a quote takes lazily when the next line isn't one: they're in different containers.
    const splitByQuote = lazyQuote > 0 && next !== undefined && endsLazyQuote(next);
    if (
      !marker &&
      !splitByQuote &&
      indentInContainer < 4 &&
      next !== undefined &&
      startsTable(rest, next, quotes, tables)
    ) {
      endRun(rest.length);
      tableQuotes = quotes;
      i++; // the delimiter row
      continue;
    }
    lastNotSetext = indent >= column + 4 || NOT_SETEXT_TEXT.test(rest.trimStart());
    if (!paragraphOpen) {
      // marked takes the lazy lines after a quoted line with any text into the quote, and those after
      // one holding only spaces (even a less deep one).
      const afterSpaces = previous.quotes > quotes && previous.rest !== "" && isBlank(previous.rest);
      runColumn = column;
      runQuotes = lazyQuote > 0 ? lazyQuote : afterSpaces ? previous.quotes : quotes;
      runBullet = undefined;
      runNotSetext = lastNotSetext;
    } else if (quotes !== runQuotes) {
      runQuotes = -1; // quotes started or ended in the run: its container is unknown, so column 0 is used
      runNotSetext = true;
    } else {
      runNotSetext ||= lastNotSetext;
    }
    run += rest.length + 1;
  }
  endRun();
  if (untrustedFrom >= 0) longestRun = Math.max(longestRun, lines.slice(untrustedFrom).join("\n").length);
  return { longestRun, tooDeep: false };
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
