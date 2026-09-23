import { Extension, type Editor } from "@tiptap/core";
import { TableCell, TableHeader } from "@tiptap/extension-table";
import { Fragment, Slice, type Node, type ResolvedPos, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

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
 * Where the drop being handled lands, per view. ProseMirror calls transformPasted for a drop before it
 * knows the drop position (the selection is still the dragged text or the old caret), so it's noted
 * when the drop event arrives, just before ProseMirror handles it, and forgotten right after.
 */
const dropTargets = new WeakMap<EditorView, number>();

const TABLE_PARTS = new Set(["table", "tableRow", ...CELLS]);

/**
 * Drops content (already flattened by transformPasted) into the cell text nearest to `target`, a
 * position between table parts: the padding of a cell resolves before or after its paragraph, and
 * ProseMirror would fit a slice there by making a new cell or splitting the table. Replaces
 * ProseMirror's default drop, which does the same with the position it computed.
 */
function dropIntoCell(view: EditorView, target: number, slice: Slice, moved: boolean): void {
  const $target = view.state.doc.resolve(target);
  const inside = Selection.findFrom($target, $target.index() === 0 ? 1 : -1, true);
  if (!inside) return;
  const tr = view.state.tr;
  if (moved) tr.deleteSelection(); // the dragged content leaves its old place
  const pos = tr.mapping.map(inside.head);
  tr.replaceRange(pos, pos, slice);
  // Select what was dropped, like ProseMirror does.
  let end = pos;
  tr.mapping.maps.at(-1)?.forEach((_from, _to, _newFrom, newTo) => (end = newTo));
  tr.setSelection(TextSelection.between(tr.doc.resolve(pos), tr.doc.resolve(end)));
  view.focus();
  view.dispatch(tr.setMeta("uiEvent", "drop"));
}

/** Where pasted or dropped content goes: the drop position during a drop, otherwise the selection. */
function insertionPoint(view: EditorView): ResolvedPos {
  const drop = dropTargets.get(view);
  return drop === undefined ? view.state.selection.$from : view.state.doc.resolve(drop);
}

/**
 * Typing in a table cell, before the default handlers: Enter moves to the next cell like Tab (adding a
 * row at the end), and paste or drop becomes one line, since blocks would split the table (a cell holds
 * a single paragraph); a drop on a cell's padding goes into its text (see dropIntoCell). Runs before
 * the markdown paste handler, which would insert parsed blocks.
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
          handleDOMEvents: {
            drop(view, event) {
              const target = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (target) dropTargets.set(view, target.pos);
              // ProseMirror handles the drop synchronously after this handler returns.
              queueMicrotask(() => dropTargets.delete(view));
              return false;
            },
          },
          handleDrop(view, event, slice, moved) {
            const target = dropTargets.get(view);
            if (target === undefined) return false;
            const { parent } = view.state.doc.resolve(target);
            if (!TABLE_PARTS.has(parent.type.name)) return false; // in text: the default drop is right
            dropIntoCell(view, target, slice, moved);
            return true;
          },
          transformPasted(slice, view) {
            const $at = insertionPoint(view);
            // Between cells or rows, a drop lands in a cell too (see dropIntoCell).
            const inCell = isInTableCell($at) || TABLE_PARTS.has($at.parent.type.name);
            return inCell ? flattenToParagraph(slice, view.state.schema) : slice;
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
