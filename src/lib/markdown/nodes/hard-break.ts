import { HardBreak } from "@tiptap/extension-hard-break";
import type { ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { forEachChangedNode } from "./changed-blocks";
import { isInTableCell } from "./table-cells";

/**
 * Markdown headings and table cells are single lines, and a task item's text must stay on its checkbox
 * line (Tiptap reads the next line as a new block), so a line break there can't be saved.
 */
export function canHoldLineBreak($pos: ResolvedPos): boolean {
  if ($pos.parent.type.name === "heading" || isInTableCell($pos)) return false;
  return !($pos.depth > 0 && $pos.node(-1).type.name === "taskItem" && $pos.index(-1) === 0);
}

/**
 * Hard break that only goes where markdown can keep it (see canHoldLineBreak). Shift+Enter (setHardBreak)
 * does nothing there, and a break that arrives another way (paste, drop) becomes a space.
 */
export const WriteHardBreak = HardBreak.extend({
  addCommands() {
    const upstream = this.parent?.();
    return {
      setHardBreak: () => (props) =>
        canHoldLineBreak(props.state.selection.$from) && (upstream?.setHardBreak?.()(props) ?? false),
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key: new PluginKey("writeHardBreakPlacement"),
        appendTransaction: (transactions, oldState, newState) => {
          const misplaced = new Set<number>();
          forEachChangedNode(transactions, oldState, newState, (node, pos) => {
            if (!node.isTextblock) return true;
            if (!canHoldLineBreak(newState.doc.resolve(pos + 1))) {
              node.forEach((child, offset) => {
                if (child.type.name === this.name) misplaced.add(pos + 1 + offset);
              });
            }
            return false;
          });
          if (misplaced.size === 0) return null;
          const tr = newState.tr;
          // Same size (one position each), so positions stay valid while replacing.
          misplaced.forEach((pos) => tr.replaceWith(pos, pos + 1, newState.schema.text(" ")));
          return tr;
        },
      }),
    ];
  },
});
