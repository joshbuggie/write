import type { JSONContent } from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Document } from "@tiptap/extension-document";
import { Table } from "@tiptap/extension-table";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { forEachChangedNode } from "./changed-blocks";
import { isBlankInline } from "./inline-atoms";
import { isInTableCell } from "./table-cells";
import { renderTableMarkdown } from "./table-markdown";

/** A paragraph that writes nothing: empty, or only whitespace and line breaks. */
export const isBlankParagraph = (node?: JSONContent) =>
  node?.type === "paragraph" && isBlankInline(node.content);

/**
 * A container's children without blank paragraphs at the end: markdown has no way to keep an empty line
 * at the end of a quote or list item, so they aren't written (the file stays the same on every save).
 */
export function withoutTrailingBlankParagraphs(children: JSONContent[], keep = 0): JSONContent[] {
  let end = children.length;
  while (end > keep && isBlankParagraph(children[end - 1])) end--;
  return children.slice(0, end);
}

/** The note: blank paragraphs at its start and end aren't written (finalizeMarkdown would drop most). */
export const WriteDocument = Document.extend({
  renderMarkdown(node, h) {
    const content = withoutTrailingBlankParagraphs(node.content ?? []);
    const start = Math.max(
      0,
      content.findIndex((child) => !isBlankParagraph(child)),
    );
    // Each child renders with its own index, so it still sees its real previous sibling.
    return content
      .slice(start)
      .map((child, i) => h.renderChild?.(child, start + i) ?? "")
      .join("\n\n");
  },
});

/**
 * Blockquote that never re-opens empty (`>` alone parses to a quote without content, which the schema
 * rejects), doesn't write trailing blank paragraphs, and keeps whitespace-only lines (code) intact.
 */
export const WriteBlockquote = Blockquote.extend({
  parseMarkdown(token, helpers) {
    const parsed = Blockquote.config.parseMarkdown?.(token, helpers) as JSONContent;
    return parsed.content?.length ? parsed : { ...parsed, content: [{ type: "paragraph", content: [] }] };
  },

  renderMarkdown(node, h) {
    return withoutTrailingBlankParagraphs(node.content ?? [], 1)
      .map((child, index) =>
        (h.renderChild?.(child, index) ?? "")
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n"),
      )
      .join("\n>\n");
  },
});

/**
 * Table written by renderTableMarkdown (no blank lines around it, which re-opened as extra empty
 * paragraphs, and no collapsed spaces). Like a GFM table, its first row is always the header row and
 * the others body rows: edits that break that (deleting across rows, pasting) are corrected right away.
 * A table can't be inserted inside another one: cells hold one line, so it would split the outer table.
 */
export const WriteTable = Table.extend({
  addCommands() {
    const upstream = this.parent?.();
    return {
      ...upstream,
      insertTable: (options) => (props) =>
        !isInTableCell(props.state.selection.$from) && (upstream?.insertTable?.(options)(props) ?? false),
    };
  },

  renderMarkdown: (node, h) => renderTableMarkdown(node, h),

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey("writeTableHeaderRow"),
        appendTransaction: (transactions, oldState, newState) => {
          const { tableHeader, tableCell } = newState.schema.nodes;
          const tr = newState.tr;
          forEachChangedNode(transactions, oldState, newState, (table, pos) => {
            if (table.type.name !== this.name) return true;
            table.forEach((row, rowOffset, rowIndex) => {
              const type = rowIndex === 0 ? tableHeader : tableCell;
              row.forEach((cell, cellOffset) => {
                if (cell.type !== type) tr.setNodeMarkup(pos + 2 + rowOffset + cellOffset, type, cell.attrs);
              });
            });
            return false;
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
