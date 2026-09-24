import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { ContextKind } from "@/lib/ai/prompt";
import { serializeBlocks, serializeBody } from "@/lib/markdown/serialize";

/** The passage a prompt window works on, captured when it opens. Positions are kept current by the plugin. */
export type Target = {
  kind: Exclude<ContextKind, "note">;
  /** Shown in the scope toggle and on the Replace button: "Selection", "Paragraph", "Code block", "Table"… */
  name: string;
  from: number;
  to: number;
  /** Markdown, so a rewrite keeps the passage's links and formatting (plain text inside code). */
  text: string;
  /** from..to spans whole blocks (a selection across blocks, or a table): Replace swaps blocks for blocks. */
  wholeBlocks: boolean;
  /** Inside one code block: replies go in as raw text, never parsed as Markdown. */
  code: boolean;
};

/** Markdown for from..to. The shared ancestor is kept (wrapped up to a node a note can hold), so list items read as a list. */
function markdownOf(editor: Editor, from: number, to: number): string {
  const { doc, schema } = editor.state;
  const $from = doc.resolve(from);
  const depth = $from.sharedDepth(to);
  const shared = $from.node(depth);
  const cut = shared.content.cut(from - $from.start(depth), to - $from.start(depth));
  let blocks: JSONContent[];
  if (depth === 0) blocks = cut.toJSON() as JSONContent[];
  else if (shared.isTextblock) blocks = [schema.nodes.paragraph.create(null, cut).toJSON() as JSONContent];
  else {
    let node = shared.copy(cut);
    for (let d = depth - 1; d > 0 && !doc.type.contentMatch.matchType(node.type); d--) {
      node = $from.node(d).copy(Fragment.from(node)); // a list item alone isn't Markdown; its list is
    }
    blocks = [node.toJSON() as JSONContent];
  }
  try {
    return serializeBlocks(editor, blocks);
  } catch {
    return doc.textBetween(from, to, "\n\n", " ");
  }
}

/** A selection of table cells: the target is the whole table, which Markdown can hold and a model can rewrite. */
function tableTarget(editor: Editor): Target | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== "table") continue;
    const from = $from.before(d);
    const to = $from.after(d);
    return {
      kind: "selection",
      name: "Table",
      from,
      to,
      text: markdownOf(editor, from, to),
      wholeBlocks: true,
      code: false,
    };
  }
  return null;
}

/**
 * A text selection. Inside one block it stays exact. Across blocks it grows to the whole blocks it touches,
 * so Replace never leaves half a list item behind, and the highlight shows exactly what Replace will swap.
 */
function selectionTarget(editor: Editor, from: number, to: number): Target {
  const { doc } = editor.state;
  const $from = doc.resolve(from);
  let $to = doc.resolve(to);
  // A triple-click, or a drag past a line end, ends at the start of the next block: it belongs to the one before.
  if (!$from.sameParent($to) && $to.parentOffset === 0 && $to.depth > 0) {
    const back = Selection.findFrom(doc.resolve($to.before()), -1, true);
    if (back && back.to > from) $to = doc.resolve(back.to);
  }
  if ($from.sameParent($to) && $from.parent.isTextblock) {
    const code = Boolean($from.parent.type.spec.code);
    const text = code ? doc.textBetween(from, $to.pos) : markdownOf(editor, from, $to.pos);
    return { kind: "selection", name: "Selection", from, to: $to.pos, text, wholeBlocks: false, code };
  }
  const depth = $from.sharedDepth($to.pos);
  const start = $from.depth > depth ? $from.before(depth + 1) : from;
  const end = $to.depth > depth ? $to.after(depth + 1) : $to.pos;
  const text = markdownOf(editor, start, end);
  return { kind: "selection", name: "Selection", from: start, to: end, text, wholeBlocks: true, code: false };
}

/**
 * What the prompt window is about: the selection, else the paragraph (or heading, list item line, code
 * block) at the caret, else, on an empty line, just the caret position.
 */
export function captureTarget(editor: Editor): Target {
  const { selection } = editor.state;
  const { $from } = selection;
  if (selection.ranges.length > 1) {
    const table = tableTarget(editor);
    if (table) return table;
  }
  if (!selection.empty) return selectionTarget(editor, selection.from, selection.to);
  const code = Boolean($from.parent.type.spec.code);
  // Only a truly empty line counts: a line holding just an image has no text, but it isn't empty.
  if (!$from.parent.isTextblock || $from.parent.content.size === 0) {
    const pos = $from.pos;
    return { kind: "cursor", name: "At cursor", from: pos, to: pos, text: "", wholeBlocks: false, code };
  }
  const from = $from.start();
  const to = $from.end();
  const text = code ? $from.parent.textContent : markdownOf(editor, from, to);
  const name = code ? "Code block" : "Paragraph";
  return { kind: "paragraph", name, from, to, text, wholeBlocks: false, code };
}

/** The whole note as Markdown, for the "Whole note" context. */
export const noteMarkdown = (editor: Editor) => serializeBody(editor);

type Highlight = { from: number; to: number; visible: boolean };
const highlightKey = new PluginKey<Highlight>("aiTarget");

/**
 * Keeps the target visibly highlighted while focus is in the prompt window (the browser hides an
 * unfocused editor's selection), and maps its positions through any edit made meanwhile. Decorations
 * only: nothing here touches the document, so opening the window never marks the note edited.
 */
export function showHighlight(editor: Editor, target: Target) {
  hideHighlight(editor);
  editor.registerPlugin(
    new Plugin<Highlight>({
      key: highlightKey,
      state: {
        init: () => ({ from: target.from, to: target.to, visible: true }),
        apply(tr, prev) {
          const meta = tr.getMeta(highlightKey) as Partial<Highlight> | undefined;
          const from = tr.mapping.map(prev.from, 1);
          const to = Math.max(from, tr.mapping.map(prev.to, -1));
          return { ...prev, from, to, ...meta };
        },
      },
      props: {
        decorations(state) {
          const h = highlightKey.getState(state);
          if (!h?.visible || h.from >= h.to) return null;
          const soft = target.kind === "paragraph" ? " write-ai-target-soft" : "";
          return DecorationSet.create(state.doc, [
            Decoration.inline(h.from, h.to, { class: `write-ai-target${soft}` }),
          ]);
        },
      },
    }),
  );
}

/** Dims the highlight while "Whole note" is chosen. A meta-only transaction, so no save is triggered. */
export function setHighlightVisible(editor: Editor, visible: boolean) {
  editor.view.dispatch(editor.state.tr.setMeta(highlightKey, { visible }));
}

/** Removes the highlight plugin on close and unmount, so a closed window leaves nothing in the editor. */
export function hideHighlight(editor: Editor) {
  if (!editor.isDestroyed && highlightKey.getState(editor.state)) editor.unregisterPlugin(highlightKey);
}

/** The target's range now: edits made while the window was open have moved it. */
export function currentRange(editor: Editor, target: Target): { from: number; to: number } {
  const h = highlightKey.getState(editor.state);
  return h ? { from: h.from, to: h.to } : { from: target.from, to: target.to };
}
