import { Marked, type Token, type TokensList } from "marked";
import { finalizeMarkdown } from "./file-format";

export type LossReason = "html" | "footnotes" | "math" | "references" | "escapes" | "structure";
export type Fidelity = { kind: "exact" } | { kind: "normalized" } | { kind: "lossy"; reasons: LossReason[] };

const FENCED_CODE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
const INLINE_CODE = /(`+)[^\n]*?\1/g;
const FOOTNOTE_DEFINITION = /^\[\^[^\]]+\]:/m;

/**
 * Paragraphs longer than this open as Markdown source: marked's emphasis matching (used by Tiptap and by
 * this check) is quadratic in paragraph length, and a pasted log of that size can block the tab for seconds.
 * Real prose paragraphs stay far below it.
 */
export const MAX_VISUAL_PARAGRAPH_CHARS = 16 * 1024;

/**
 * Cheap, linear pre-check to run before parsing a note (or a paste) for the visual editor: true when
 * some paragraph outside fenced code is too long to parse without freezing the tab.
 */
export function hasOversizedParagraph(markdown: string): boolean {
  return markdown
    .replace(FENCED_CODE, "")
    .split(/\n[ \t]*\n/)
    .some((block) => block.length > MAX_VISUAL_PARAGRAPH_CHARS);
}

const normalizeLabel = (label: string) => label.replace(/\s+/g, " ").toLowerCase();

/** Lexes like marked, and also collects the reference labels that the text actually uses. */
function lexWithReferences(markdown: string): { tokens: TokensList; usedLabels: Set<string> } {
  const usedLabels = new Set<string>();
  const marked = new Marked({
    gfm: true,
    tokenizer: {
      // Same matching as marked's own reflink tokenizer; `false` lets it run unchanged afterwards.
      reflink(src) {
        const match = this.rules.inline.reflink.exec(src) ?? this.rules.inline.nolink.exec(src);
        if (match) usedLabels.add(normalizeLabel(match[2] || match[1]));
        return false;
      },
    },
  });
  return { tokens: marked.lexer(markdown), usedLabels };
}

/**
 * Link reference definitions are invisible in rendered HTML and the editor drops them, keeping only the
 * links that use them (as inline links). An unused one, or a `[//]: # (comment)`, would silently vanish.
 */
function hasUnusedDefinition(tokens: TokensList, usedLabels: Set<string>): boolean {
  return Object.keys(tokens.links)
    .map(normalizeLabel)
    .some((label) => !label.startsWith("^") && !usedLabels.has(label)); // "[^1]:" is a footnote, see above
}

/** Walks marked's token tree (nested tokens, list items, table cells) looking for raw HTML / comments. */
function containsHtml(tokens: TokensList): boolean {
  let found = false;
  new Marked().walkTokens(tokens, (token: Token) => {
    if (token.type === "html") found = true;
  });
  return found;
}

/**
 * Display math, or inline math with a TeX command. Each `$…$` candidate is a run between two
 * neighboring "$" on one line, so this stays linear on lines full of "$" and backslashes.
 */
function hasTexMath(text: string): boolean {
  if (text.includes("$$")) return true;
  return text.split("\n").some((line) =>
    line
      .split("$")
      .slice(1, -1)
      .some((inner) => /\\[A-Za-z]/.test(inner)),
  );
}

/**
 * Inline `$…$` spans as Obsidian, Typora and pandoc read them: the opening "$" is followed by a non-space,
 * the closing one follows a non-space and isn't followed by a digit ("$5 and $10" is no math).
 */
function inlineMathSpans(text: string): string[] {
  const spans: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "$" && /[^\s$]/.test(text[i + 1] ?? " ")) {
      let j = i + 1;
      while (j < text.length && text[j] !== "$" && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      if (text[j] === "$" && !/\s/.test(text[j - 1]) && !/\d/.test(text[j + 1] ?? "")) {
        spans.push(text.slice(i, j + 1));
        i = j;
      } else {
        i = j - 1; // nothing between i and j can open a span, but the "$" at j still can
      }
    }
  }
  return spans;
}

/**
 * Syntax other tools give meaning to (Obsidian tags, %% comments, [[links]], ==highlights==, $math$)
 * that GFM doesn't, so the round trip may drop the backslashes that kept it literal.
 */
const OTHER_TOOLS_SYNTAX = [/(?<!\S)#[^\s#]/g, /%%/g, /\[\[/g, /==/g, /\$/g];

/** True when the round trip turned escaped (literal) syntax of other tools into live syntax. */
function dropsMeaningfulEscapes(original: string, roundTripped: string): boolean {
  const live = (text: string) => text.replace(/\\[\s\S]/g, "\0\0");
  const [before, after] = [live(original), live(roundTripped)];
  return OTHER_TOOLS_SYNTAX.some(
    (syntax) => (after.match(syntax)?.length ?? 0) > (before.match(syntax)?.length ?? 0),
  );
}

/** Whitespace around block-level tags, which differs between loose and tight lists. */
const BLOCK_TAG_WITH_SPACE =
  /\s*(<\/?(?:ul|ol|li|blockquote|h[1-6]|pre|hr|table|thead|tbody|tr|th|td)\b[^>]*>)\s*/g;

/** A rendered code block. Its content is compared byte for byte: whitespace in code is meaningful. */
const CODE_BLOCK_HTML = /(<pre\b[^>]*>[\s\S]*?<\/pre>)/;

/**
 * Rendered HTML (never inserted into the DOM) minus differences that don't change the document:
 * paragraph tags (loose vs tight lists), &nbsp; blank-line markers, and whitespace outside code blocks.
 */
function semanticForm(tokens: TokensList): string {
  const html = new Marked({ gfm: true }).parser(tokens);
  // split() with a capture group puts the code blocks at the odd indexes; only the prose is normalized.
  return html
    .split(CODE_BLOCK_HTML)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/<\/?p>/g, " ")
            .replace(/&nbsp;|\u00a0/g, " ")
            .replace(BLOCK_TAG_WITH_SPACE, "$1")
            .replace(/\s+/g, " "),
    )
    .join("")
    .replace(BLOCK_TAG_WITH_SPACE, "$1")
    .trim();
}

const withoutCode = (markdown: string) => markdown.replace(FENCED_CODE, "").replace(INLINE_CODE, "");

/**
 * Decides whether a note can be edited visually without destroying anything the editor can't represent.
 * originalBody = splitFrontmatter(file).body; roundTripped = serializeBody(editor) right after load. Pure.
 * Run hasOversizedParagraph first: parsing a huge paragraph is slow here and in the editor alike.
 */
export function analyzeFidelity(originalBody: string, roundTripped: string): Fidelity {
  if (finalizeMarkdown(originalBody) === roundTripped) return { kind: "exact" };

  const reasons: LossReason[] = [];
  const original = withoutCode(originalBody);
  const output = withoutCode(roundTripped);
  // marked's lexer knows exactly what it will treat as HTML (and skips code), so no regex guessing here.
  const { tokens, usedLabels } = lexWithReferences(originalBody);
  if (containsHtml(tokens)) reasons.push("html");
  if (FOOTNOTE_DEFINITION.test(original)) reasons.push("footnotes");
  // Math renderers read `$x_1$` verbatim, so any change inside a span (escapes added or removed) breaks it.
  if (hasTexMath(original) || inlineMathSpans(original).join("\n") !== inlineMathSpans(output).join("\n")) {
    reasons.push("math");
  }
  if (hasUnusedDefinition(tokens, usedLabels)) reasons.push("references");
  if (dropsMeaningfulEscapes(original, output)) reasons.push("escapes");
  if (reasons.length > 0) return { kind: "lossy", reasons };

  const roundTrippedTokens = new Marked({ gfm: true }).lexer(roundTripped);
  return semanticForm(tokens) === semanticForm(roundTrippedTokens)
    ? { kind: "normalized" }
    : { kind: "lossy", reasons: ["structure"] };
}
