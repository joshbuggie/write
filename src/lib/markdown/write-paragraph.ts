import { Paragraph } from "@tiptap/extension-paragraph";
import {
  escapeBlockStarts,
  escapeLetterListMarker,
  escapeTagLikeSpans,
  withEscapedTablePipes,
} from "./escape";

// Upstream's markdown hooks are arrow functions (no `this`), and the extend() `this` type has no `parent`,
// so we call the original config hooks directly.
const upstream = Paragraph.config;

/** Parents whose paragraphs are rendered on a single table row line (Tiptap reports "table" today). */
const TABLE_PARENTS = new Set(["table", "tableRow", "tableCell", "tableHeader"]);

/**
 * Paragraph with markdown fixes for files people own:
 * - a paragraph holding a single image stays a paragraph (upstream unwraps it, which is invalid with inline images);
 * - typed text that looks like a block start ("# x", "- x", "---") is escaped so it re-opens as the same paragraph;
 * - inside table cells, `|` is escaped so it can't split the row;
 * - a literal "<" that would hide later formatting from marked is escaped.
 */
export const WriteParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const tokens = token.tokens ?? [];
    if (tokens.length === 1 && tokens[0].type === "image") {
      return helpers.createNode("paragraph", undefined, helpers.parseInline(tokens));
    }
    return upstream.parseMarkdown?.(token, helpers) ?? [];
  },

  renderMarkdown(node, helpers, ctx) {
    if (ctx?.parentType && TABLE_PARENTS.has(ctx.parentType)) {
      return escapeTagLikeSpans(
        withEscapedTablePipes(() => upstream.renderMarkdown?.(node, helpers, ctx) ?? ""),
      );
    }
    const markdown = escapeBlockStarts(
      escapeTagLikeSpans(upstream.renderMarkdown?.(node, helpers, ctx) ?? ""),
    );
    // A list item's first paragraph sits on the marker line; later ones are continuation lines.
    const listContinuation = ctx?.parentType === "listItem" && ctx.index > 0;
    return listContinuation ? escapeLetterListMarker(markdown) : markdown;
  },
});
