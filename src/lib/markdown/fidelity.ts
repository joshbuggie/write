import { Marked, type Token } from "marked";
import { finalizeMarkdown } from "./file-format";

export type LossReason = "html" | "footnotes" | "math" | "structure";
export type Fidelity = { kind: "exact" } | { kind: "normalized" } | { kind: "lossy"; reasons: LossReason[] };

const FENCED_CODE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
const INLINE_CODE = /(`+)[^\n]*?\1/g;
const FOOTNOTE_DEFINITION = /^\[\^[^\]]+\]:/m;
const MATH = /\$\$|\$[^$\n]*\\[A-Za-z]+[^$\n]*\$/;

/** Walks marked's token tree (nested tokens, list items, table cells) looking for raw HTML / comments. */
function containsHtml(tokens: readonly Token[]): boolean {
  return tokens.some((token) => {
    if (token.type === "html") return true;
    const children: Token[] = [
      ...("tokens" in token && Array.isArray(token.tokens) ? token.tokens : []),
      ...("items" in token && Array.isArray(token.items) ? (token.items as Token[]) : []),
      ...(token.type === "table"
        ? [...token.header, ...token.rows.flat()].flatMap((cell: { tokens: Token[] }) => cell.tokens)
        : []),
    ];
    return containsHtml(children);
  });
}

/** Whitespace around block-level tags, which differs between loose and tight lists. */
const BLOCK_TAG_WITH_SPACE =
  /\s*(<\/?(?:ul|ol|li|blockquote|h[1-6]|pre|hr|table|thead|tbody|tr|th|td)\b[^>]*>)\s*/g;

/**
 * Rendered HTML (never inserted into the DOM) minus differences that don't change the document:
 * paragraph tags (loose vs tight lists), &nbsp; blank-line markers, and whitespace.
 */
function semanticForm(markdown: string): string {
  const html = new Marked({ gfm: true }).parse(markdown, { async: false });
  return html
    .replace(/<\/?p>/g, " ")
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(BLOCK_TAG_WITH_SPACE, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Decides whether a note can be edited visually without destroying anything the editor can't represent.
 * originalBody = splitFrontmatter(file).body; roundTripped = serializeBody(editor) right after load. Pure.
 */
export function analyzeFidelity(originalBody: string, roundTripped: string): Fidelity {
  if (finalizeMarkdown(originalBody) === roundTripped) return { kind: "exact" };

  const reasons: LossReason[] = [];
  const withoutCode = originalBody.replace(FENCED_CODE, "").replace(INLINE_CODE, "");
  // marked's lexer knows exactly what it will treat as HTML (and skips code), so no regex guessing here.
  if (containsHtml(new Marked({ gfm: true }).lexer(originalBody))) reasons.push("html");
  if (FOOTNOTE_DEFINITION.test(withoutCode)) reasons.push("footnotes");
  if (MATH.test(withoutCode)) reasons.push("math");
  if (reasons.length > 0) return { kind: "lossy", reasons };

  return semanticForm(originalBody) === semanticForm(roundTripped)
    ? { kind: "normalized" }
    : { kind: "lossy", reasons: ["structure"] };
}
