import { decodeHtmlEntities } from "@tiptap/core";
import { Lexer, type Token } from "marked";
import { escapeTagLikeSpans } from "../escape";

/** The mark names that make up a unit's identity, in a stable order. */
const unit = (text: string, marks: string[]) => `${text}\u0000${[...marks].sort().join("\u0000")}`;

const IMAGE = "<image>"; // units are single characters otherwise, so these can't collide
const BREAK = "<br>";
const INLINE_MARKS: Record<string, string> = { strong: "bold", em: "italic", del: "strike" };

/** A link as a mark name, the same way for the editor's marks and marked's tokens. */
export const linkMarkName = (href: unknown, title: unknown) =>
  `link ${JSON.stringify([href ?? "", title || null])}`;

/** One unit per character (or image / line break) with its marks, as Tiptap would build it from tokens. */
function unitsOf(tokens: Token[], marks: string[], out: string[]): boolean {
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
        return unitsOf(token.tokens ?? [], [...marks, INLINE_MARKS[token.type]], out);
      case "link":
        return unitsOf(token.tokens ?? [], [...marks, linkMarkName(token.href, token.title)], out);
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

/**
 * Whether marked reads `markdown` back as exactly the intended characters and marks. marked's emphasis
 * matching has corner cases no flanking rule predicts ("**a *b*c**"), so the serializer checks its own
 * output instead of guessing. `inTable`: GFM unescapes `\|` before reading a cell.
 */
export function readsBackAs(markdown: string, intended: IntendedUnit[], inTable: boolean): boolean {
  const source = escapeTagLikeSpans(inTable ? markdown.replace(/\\\|/g, "|") : markdown);
  const actual: string[] = [];
  if (!unitsOf(Lexer.lexInline(source), [], actual)) return false;
  const expected = intended.map((item) =>
    item.node === "hardBreak" ? unit(BREAK, []) : unit(item.node ? IMAGE : (item.text ?? ""), item.marks),
  );
  return actual.length === expected.length && actual.every((value, i) => value === expected[i]);
}
