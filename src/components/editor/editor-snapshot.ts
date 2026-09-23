import type { Editor } from "@tiptap/core";
import { composeFile } from "@/lib/markdown/file-format";
import { serializeBody } from "@/lib/markdown/serialize";
import type { EditorSnapshot } from "./note-editor";

/** The full file text the visual editor saves: the read-only front matter plus the serialized body. */
export const visualContent = (editor: Editor, frontmatter: string) =>
  composeFile(frontmatter, serializeBody(editor));

/** The visual editor's exact state, for the editor that remounts under a note's new name. */
export function takeSnapshot(editor: Editor, frontmatter: string): EditorSnapshot {
  return {
    content: visualContent(editor, frontmatter),
    caret: editor.state.selection.head,
    doc: editor.getJSON(),
  };
}

/**
 * Loads a snapshot's document into a freshly opened editor. Markdown drops a trailing empty paragraph or
 * trailing space, so the remounted editor, opened from Markdown, is missing whatever the user typed last.
 * The swap happens only when both documents save as the same text, so it can never change the file (and
 * the fidelity check the editor ran on open still holds). It isn't an edit or an undo step, so the note
 * doesn't turn "Edited". Returns whether the document was replaced.
 */
export function restoreSnapshot(editor: Editor, snapshot: EditorSnapshot, frontmatter: string): boolean {
  if (!snapshot.doc || visualContent(editor, frontmatter) !== snapshot.content) return false;
  let doc;
  try {
    doc = editor.schema.nodeFromJSON(snapshot.doc);
    doc.check();
  } catch {
    return false; // not a document this schema accepts; the Markdown version stands
  }
  if (doc.eq(editor.state.doc)) return false;
  const { tr } = editor.state;
  tr.replaceWith(0, tr.doc.content.size, doc.content)
    .setMeta("preventUpdate", true)
    .setMeta("addToHistory", false);
  editor.view.dispatch(tr);
  return true;
}
