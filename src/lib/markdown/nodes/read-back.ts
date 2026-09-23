import { decodeHtmlEntities } from "@tiptap/core";
import { Lexer, type Token } from "marked";
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
        // save writes the link), so it counts as the plain text it was written as.
        if (isAutolinkLiteral(token)) {
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

/** What the editor meant: text characters, images and line breaks with their mark names. */
export type IntendedUnit = { text?: string; node?: string; marks: string[] };

type Autolinks = Array<[start: number, end: number]>;

/** Where marked first misread the markdown (a unit index), and the units of the addresses it linked. */
export type Misread = { at: number; autolinks: Autolinks };

/**
 * Where marked's reading of `markdown` first differs from the intended characters and marks, or null
 * when it reads back exactly. marked's emphasis matching has corner cases no flanking rule predicts
 * ("**a *b*c**"), so the serializer checks its own output instead of guessing, and simplifies near
 * the first difference. `inTable`: GFM unescapes `\|` before reading a cell.
 */
export function firstMisread(markdown: string, intended: IntendedUnit[], inTable: boolean): Misread | null {
  const source = escapeTagLikeSpans(inTable ? markdown.replace(/\\\|/g, "|") : markdown);
  const actual: string[] = [];
  const autolinks: Autolinks = [];
  const complete = unitsOf(Lexer.lexInline(source), [], actual, autolinks);
  const expected = intended.map((item) =>
    item.node === "hardBreak" ? unit(BREAK, []) : unit(item.node ? IMAGE : (item.text ?? ""), item.marks),
  );
  const length = Math.min(actual.length, expected.length);
  for (let i = 0; i < length; i++) if (actual[i] !== expected[i]) return { at: i, autolinks };
  return complete && actual.length === expected.length ? null : { at: length, autolinks };
}
