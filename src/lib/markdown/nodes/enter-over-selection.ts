import { Extension } from "@tiptap/core";
import { AllSelection } from "@tiptap/pm/state";
import { isInTableCell } from "./table-cells";

/**
 * Enter over a selection that spans blocks (two list items, a heading and a list…) first deletes the
 * selection and then does what Enter does at the caret, like a word processor: "- al|pha", "- be|ta"
 * becomes "- al" and "- ta". Tiptap's splitListItem and splitBlock throw on many such ranges ("Invalid
 * content for node bulletList"), and the key press was lost. Table cells handle Enter themselves (see
 * WriteTableCell), so selections touching a cell are left to them.
 */
export const EnterOverSelection = Extension.create({
  name: "enterOverSelection",
  priority: 1002, // before the table cell, list item and paragraph Enter handlers

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        const { $from, $to } = selection;
        const acrossBlocks = selection instanceof AllSelection || !$from.sameParent($to);
        if (selection.empty || !acrossBlocks || isInTableCell($from) || isInTableCell($to)) return false;
        editor.commands.deleteSelection();
        return false; // the other Enter handlers now run at the caret the deletion left
      },
    };
  },
});
