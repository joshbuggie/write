import { Extension, type Editor } from "@tiptap/core";
import { TableCell, TableHeader } from "@tiptap/extension-table";
import { Fragment, Slice, type Node, type ResolvedPos, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const CELLS = new Set(["tableCell", "tableHeader"]);

/** Whether a position is inside a table cell, where only one line of inline text can be saved. */
export function isInTableCell($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (CELLS.has($pos.node(depth).type.name)) return true;
  }
  return false;
}

/** Pasted blocks become one paragraph of their inline content, joined with spaces. */
function flattenToParagraph(slice: Slice, schema: Schema): Slice {
  const first = slice.content.firstChild;
  if (!first?.isBlock || (slice.content.childCount === 1 && first.type.name === "paragraph")) return slice;
  const inline: Node[] = [];
  slice.content.descendants((node) => {
    if (!node.isTextblock) return true;
    if (inline.length && node.content.size) inline.push(schema.text(" "));
    node.content.forEach((child) => inline.push(child));
    return false;
  });
  return new Slice(Fragment.from(schema.nodes.paragraph.create(null, inline)), 1, 1);
}

/**
 * Typing in a table cell, before the default handlers: Enter moves to the next cell like Tab (adding a
 * row at the end), and paste becomes one line, since blocks would split the table (a cell holds a single
 * paragraph). Runs before the markdown paste handler, which would insert parsed blocks.
 */
const TableCellInput = Extension.create({
  name: "tableCellInput",
  priority: 1001,

  addKeyboardShortcuts() {
    return { Enter: () => moveToNextCell(this.editor) };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("tableCellInput"),
        props: {
          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data || !isInTableCell(view.state.selection.$from) || data.getData("text/html"))
              return false;
            const text = data
              .getData("text/plain")
              .replace(/\s*\n\s*/g, " ")
              .trim();
            if (text) view.dispatch(view.state.tr.insertText(text));
            return true;
          },
          transformPasted(slice, view) {
            return isInTableCell(view.state.selection.$from)
              ? flattenToParagraph(slice, view.state.schema)
              : slice;
          },
        },
      }),
    ];
  },
});

/**
 * A GFM table cell is one line of inline text, so cells hold exactly one paragraph. Lists, headings,
 * quotes, code blocks and a second paragraph (Enter) are then refused by the schema itself, for
 * toolbar, shortcut, input rule and paste alike, instead of being saved as text or `<br>`. Commands that
 * would insert a block next to the paragraph (divider, table) refuse cells too (see isInTableCell).
 */
export const WriteTableCell = TableCell.extend({
  content: "paragraph",

  addExtensions() {
    return [TableCellInput];
  },
});

/** Header cells follow the same one-paragraph rule as body cells (see WriteTableCell). */
export const WriteTableHeader = TableHeader.extend({ content: "paragraph" });

/**
 * Enter in a cell moves on like Tab does (adding a row at the end) instead of doing nothing. A selection
 * that leaves the cell isn't split at all: Tiptap's splitBlock throws on it with one-paragraph cells.
 */
function moveToNextCell(editor: Editor): boolean {
  const { $from, $to } = editor.state.selection;
  if (!isInTableCell($from) && !isInTableCell($to)) return false;
  if (!$from.sameParent($to)) return true;
  if (editor.commands.goToNextCell()) return true;
  return !editor.can().addRowAfter() || editor.chain().addRowAfter().goToNextCell().run();
}
