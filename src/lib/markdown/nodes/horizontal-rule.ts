import { InputRule } from "@tiptap/core";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { isInTableCell } from "./table-cells";

/**
 * Divider that isn't inserted from inside a table cell: a cell holds one line of text, and inserting it
 * there split the table in two. The command and the `---` input rule both refuse.
 */
export const WriteHorizontalRule = HorizontalRule.extend({
  addCommands() {
    const upstream = this.parent?.();
    return {
      setHorizontalRule: () => (props) =>
        !isInTableCell(props.state.selection.$from) && (upstream?.setHorizontalRule?.()(props) ?? false),
    };
  },

  addInputRules() {
    return (this.parent?.() ?? []).map(
      (rule) =>
        new InputRule({
          find: rule.find,
          undoable: rule.undoable,
          handler: (props) => (isInTableCell(props.state.selection.$from) ? null : rule.handler(props)),
        }),
    );
  },
});
