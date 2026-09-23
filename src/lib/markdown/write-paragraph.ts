import type { RenderContext } from "@tiptap/core";
import { Paragraph } from "@tiptap/extension-paragraph";
import {
  escapeBlockStarts,
  escapeLetterListMarker,
  escapeLineStarts,
  escapeTablePipes,
  escapeTagLikeSpans,
} from "./escape";
import { renderInlineMarkdown } from "./nodes/inline";
import { isBlankInline } from "./nodes/inline-atoms";
import { readsAsParagraph } from "./nodes/read-back";

// Upstream's markdown hooks are arrow functions (no `this`), and the extend() `this` type has no `parent`,
// so we call the original config hooks directly.
const upstream = Paragraph.config;

/** "[ ]" / "[x]" at the start of a list item's text would make marked (and Tiptap) read a task item. */
const escapeTaskMarker = (markdown: string) => markdown.replace(/^\[(?=[ xX]\](?:\s|$))/, "\\[");

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);
const CONTAINERS = new Set(["listItem", "taskItem", "blockquote"]);

/**
 * An empty paragraph. At the top level blank lines keep it, with "&nbsp;" (upstream's marker) for the
 * second of several and after a list, where the blank lines would only make the list loose. Inside quotes
 * and list items blank lines don't survive, so it's always "&nbsp;", except on a list item's marker line.
 */
function blankParagraph(ctx: RenderContext | undefined): string {
  const previous = ctx?.previousNode;
  if (ctx?.parentType && CONTAINERS.has(ctx.parentType)) {
    return ctx.parentType !== "blockquote" && ctx.index === 0 ? "" : "&nbsp;";
  }
  const afterBlank = previous?.type === "paragraph" && isBlankInline(previous.content);
  return afterBlank || LISTS.has(previous?.type ?? "") ? "&nbsp;" : "";
}

/** The escaping a paragraph outside tables gets, as the read-back checks it (see escapeLineStarts). */
const asWritten = (markdown: string) => escapeLineStarts(escapeTagLikeSpans(markdown));

/** The escaping a paragraph outside tables gets, as it goes in the file. */
const asFinal = (markdown: string) => escapeBlockStarts(escapeTagLikeSpans(markdown));

/** Whether the paragraph, as it goes in the file, reads back as one paragraph (see readsAsParagraph). */
const readsAsOneBlock = (markdown: string) => readsAsParagraph(asFinal(markdown));

/** Parents whose paragraphs are rendered on a single table row line (Tiptap reports "table" today). */
const TABLE_PARENTS = new Set(["table", "tableRow", "tableCell", "tableHeader"]);

/**
 * Paragraph with markdown fixes for files people own:
 * - a paragraph holding a single image stays a paragraph (upstream unwraps it, which is invalid with inline images);
 * - typed text that looks like a block start ("# x", "- x", "---") is escaped so it re-opens as the same paragraph,
 *   and the result is read back as a block (see readsAsParagraph), escaping more when it isn't one;
 * - inside table cells, `|` is escaped so it can't split the row;
 * - a literal "<" that would hide later formatting from marked is escaped;
 * - text with marks is written by renderInlineMarkdown (nested delimiters, no HTML fallback);
 * - "[ ] x" typed at the start of a plain list item stays text instead of re-opening as a checkbox.
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
    const inTable = !!ctx?.parentType && TABLE_PARENTS.has(ctx.parentType);
    // A task's text must stay on its checkbox line: Tiptap reads the next line as a new block.
    const singleLine = ctx?.parentType === "taskItem" && ctx.index === 0;
    const render = () =>
      isBlankInline(node.content)
        ? blankParagraph(ctx)
        : renderInlineMarkdown(node.content ?? [], helpers, {
            inTable,
            singleLine,
            ...(inTable ? {} : { asWritten, readsAsOneBlock }),
          });
    // A cell's text can't form blocks: every line of the table is a row.
    if (inTable) return escapeTablePipes(escapeTagLikeSpans(render()));
    const markdown = asFinal(render());
    if (ctx?.parentType !== "listItem") return markdown;
    // A list item's first paragraph sits on the marker line; later ones are continuation lines.
    return ctx.index > 0 ? escapeLetterListMarker(markdown) : escapeTaskMarker(markdown);
  },
});
