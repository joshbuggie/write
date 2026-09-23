import { decodeHtmlEntities } from "@tiptap/core";
import { Lexer, type Token, type Tokens } from "marked";
import { isAutolinkLiteral } from "../autolinks";
import { escapeTagLikeSpans } from "../escape";

/** The mark names that make up a unit's identity, in a stable order. */
const unit = (text: string, marks: string[]) => `${text}\u0000${[...marks].sort().join("\u0000")}`;

const IMAGE = "<image>"; // units are single characters otherwise, so these can't collide
const BREAK = "<br>";
const INLINE_MARKS: Record<string, string> = { strong: "bold", em: "italic", del: "strike" };

/** A link as a mark name, the same way for the editor's marks and marked's tokens. */
export const linkMarkName = (href: unknown, title: unknown) =>
  `link ${JSON.stringify([href ?? "", title || null])}`;

/**
 * One unit per character (or image / line break) with its marks, as Tiptap would build it from tokens,
 * into `out`; the units of each bare URL or email that marked linked go into `autolinks` as [start, end).
 */
function unitsOf(tokens: Token[], marks: string[], out: string[], autolinks: Autolinks): boolean {
  return tokens.every((token) => {
    switch (token.type) {
      case "text":
        for (const char of decodeHtmlEntities(token.text)) out.push(unit(char, marks));
        return true;
      case "escape":
        out.push(unit(token.text, marks));
        return true;
      case "codespan":
        for (const char of token.text) out.push(unit(char, [...marks, "code"]));
        return true;
      case "strong":
      case "em":
      case "del":
        return unitsOf(token.tokens ?? [], [...marks, INLINE_MARKS[token.type]], out, autolinks);
      case "link":
        // A bare URL or email the editor kept as plain text re-opens linked: that's accepted (the next
        // save writes the link), so it counts as the plain text it was written as, if it links to that
        // text ("a&amp;amp;" would link to more than it shows).
        if (isAutolinkLiteral(token) && linksToItsText(token as Tokens.Link)) {
          const start = out.length;
          const complete = unitsOf(token.tokens ?? [], marks, out, autolinks);
          autolinks.push([start, out.length]);
          return complete;
        }
        return unitsOf(token.tokens ?? [], [...marks, linkMarkName(token.href, token.title)], out, autolinks);
      case "image":
        out.push(unit(IMAGE, marks));
        return true;
      case "br":
        out.push(unit(BREAK, []));
        return true;
      default:
        return false; // raw HTML and anything else the editor wouldn't read back as the same content
    }
  });
}

/** Whether an autolink's address is its text, as the editor shows it (plus the scheme GFM adds). */
function linksToItsText(token: Tokens.Link): boolean {
  const text = decodeHtmlEntities(token.text);
  return [text, `http://${text}`, `mailto:${text}`].includes(token.href);
}

/** What the editor meant: text characters, images and line breaks with their mark names. */
export type IntendedUnit = { text?: string; node?: string; marks: string[] };

type Autolinks = Array<[start: number, end: number]>;

/** Where marked first misread the markdown (a unit index), and the units of the addresses it linked. */
export type Misread = { at: number; autolinks: Autolinks };

/**
 * A "|" after an odd number of backslashes. A table row escapes every "|" once more (escapeTablePipes),
 * which leaves an even number before it, so the row would split there.
 */
const SPLITS_TABLE_ROW = /(?:^|[^\\])(?:\\\\)*\\\|/;

/**
 * Whether a run of backticks (not escaped, not in a code span) has no closing run in the markdown.
 * Before splitting a table row into cells, Tiptap looks for code spans across the whole row to keep
 * the "|"s inside them, so such a backtick would pair with one in another cell and join the cells.
 */
function hasUnclosedBacktick(markdown: string): boolean {
  for (let i = 0; i < markdown.length; i++) {
    if (markdown[i] === "\\") i++;
    else if (markdown[i] === "`") {
      let length = 1;
      while (markdown[i + length] === "`") length++;
      const close = closingRun(markdown, i + length, length);
      if (close === -1) return true;
      i = close + length - 1;
    }
  }
  return false;
}

/** Where the next run of exactly `length` backticks starts, from `from` on, or -1. */
function closingRun(markdown: string, from: number, length: number): number {
  for (let j = from; j < markdown.length; j++) {
    if (markdown[j] !== "`") continue;
    let run = 1;
    while (markdown[j + run] === "`") run++;
    if (run === length) return j;
    j += run - 1;
  }
  return -1;
}

/**
 * Where marked's reading of `markdown` first differs from the intended characters and marks, or null
 * when it reads back exactly. marked's emphasis matching has corner cases no flanking rule predicts
 * ("**a *b*c**"), so the serializer checks its own output instead of guessing, and simplifies near
 * the first difference. `inTable`: the markdown also has to survive going into a table row, where
 * GFM reads it the same unless a "|" splits the row. `asWritten`: the escaping the paragraph gets
 * after it's rendered, so what's read back is what the file will hold.
 */
export function firstMisread(
  markdown: string,
  intended: IntendedUnit[],
  inTable: boolean,
  asWritten: (markdown: string) => string = escapeTagLikeSpans,
): Misread | null {
  const source = asWritten(markdown);
  if (inTable && SPLITS_TABLE_ROW.test(source)) return { at: 0, autolinks: [] };
  const actual: string[] = [];
  const autolinks: Autolinks = [];
  const complete = unitsOf(Lexer.lexInline(source), [], actual, autolinks);
  if (inTable && hasUnclosedBacktick(source)) {
    // Most likely from a bare URL, where backticks aren't escaped: blame the first one that has one.
    const address = autolinks.find(([start, end]) => actual.slice(start, end).some((u) => u[0] === "`"));
    return { at: address?.[0] ?? 0, autolinks };
  }
  const expected = intended.map((item) =>
    item.node === "hardBreak" ? unit(BREAK, []) : unit(item.node ? IMAGE : (item.text ?? ""), item.marks),
  );
  const length = Math.min(actual.length, expected.length);
  for (let i = 0; i < length; i++) if (actual[i] !== expected[i]) return { at: i, autolinks };
  return complete && actual.length === expected.length ? null : { at: length, autolinks };
}

/**
 * A line that may start a block, end one, or turn the line above into one ("-|" under it): its first
 * character after the indentation is ASCII punctuation or a digit. A paragraph without one is always
 * a single paragraph, so its block structure isn't read back.
 */
const MAY_FORM_BLOCK = /(?:^|\n)[ \t]*[!-/:-@[-`{-~0-9]/;

/**
 * marked's blocks for `markdown` as a note holds it (a newline after it lets a fence or table form),
 * without lexing their inline content: that's the costly part, and superlinear on some long paragraphs.
 */
const blocksOf = (markdown: string) =>
  new Lexer({ gfm: true }).blockTokens(markdown + "\n").filter((token) => token.type !== "space");

/**
 * Whether marked reads `markdown` (a paragraph as written, block-start escapes included) as exactly one
 * paragraph holding all of it. The inline read-back (firstMisread) can't see block syntax that the
 * paragraph's lines form together: a table delimiter row or setext underline under a line, a thematic
 * break, a fence. Then the paragraph's text would re-open as another block, or lose lines.
 */
export function readsAsParagraph(markdown: string): boolean {
  if (!MAY_FORM_BLOCK.test(markdown)) return true;
  const blocks = blocksOf(markdown);
  return blocks.length === 1 && blocks[0].type === "paragraph" && blocks[0].text === markdown;
}

/** Whether marked reads `markdown` as exactly one heading of this level whose inline markdown is `text`. */
export function readsAsHeading(markdown: string, depth: number, text: string): boolean {
  const blocks = blocksOf(markdown);
  return (
    blocks.length === 1 &&
    blocks[0].type === "heading" &&
    blocks[0].depth === depth &&
    blocks[0].text === text
  );
}
