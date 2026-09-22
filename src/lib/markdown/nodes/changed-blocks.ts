import { combineTransactionSteps, getChangedRanges } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/**
 * Calls `visit` for the nodes of every top-level block the transactions touched, for appendTransaction
 * cleanups. Whole top-level blocks, because a change can also move existing content (a paragraph turned
 * into a heading keeps its line breaks), which the changed range alone doesn't cover.
 */
export function forEachChangedNode(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
  visit: (node: Node, pos: number) => boolean | void,
): void {
  if (!transactions.some((tr) => tr.docChanged)) return;
  const { doc } = newState;
  getChangedRanges(combineTransactionSteps(oldState.doc, [...transactions])).forEach(({ newRange }) => {
    const $from = doc.resolve(newRange.from);
    const $to = doc.resolve(newRange.to);
    const from = $from.depth > 0 ? $from.before(1) : newRange.from;
    const to = $to.depth > 0 ? $to.after(1) : newRange.to;
    doc.nodesBetween(from, to, visit);
  });
}
