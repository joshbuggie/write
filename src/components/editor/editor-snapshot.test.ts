import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensions } from "@/lib/markdown/extensions";
import { restoreSnapshot, takeSnapshot, visualContent } from "./editor-snapshot";

const editors: Editor[] = [];
function headlessEditor(content: string | JSONContent): Editor {
  const editor = new Editor({
    element: null,
    extensions: createExtensions(),
    content,
    contentType: typeof content === "string" ? "markdown" : "json",
  });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

const paragraph = (text?: string): JSONContent =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });

/** Types `text` at `pos`, like a keystroke (insertContent needs a DOM to parse strings). */
const typeAt = (editor: Editor, pos: number, text: string) =>
  editor.view.dispatch(editor.state.tr.insertText(text, pos));

/** Where the caret is after typing to the end of the document. */
const caretAtEnd = (editor: Editor) => editor.commands.setTextSelection(editor.state.doc.content.size - 1);

/** What a rename does: snapshot the old editor, open a new one from its Markdown, restore the snapshot. */
function remount(before: Editor, frontmatter = "") {
  const snapshot = takeSnapshot(before, frontmatter);
  const after = headlessEditor(snapshot.content.slice(frontmatter.length));
  let updates = 0;
  after.on("update", () => updates++);
  const restored = restoreSnapshot(after, snapshot, frontmatter);
  return { snapshot, after, restored, updates };
}

describe("rename handover snapshot", () => {
  it("keeps a trailing empty paragraph that Markdown drops", () => {
    const before = headlessEditor(doc(paragraph("Line one"), paragraph()));
    caretAtEnd(before); // in the empty paragraph
    const { snapshot, after, restored } = remount(before);

    expect(headlessEditor(snapshot.content).state.doc.childCount).toBe(1); // the Markdown alone loses it
    expect(restored).toBe(true);
    expect(after.getJSON()).toEqual(before.getJSON());
    // The caret still fits: the next word starts the new line instead of joining "Line one".
    typeAt(after, snapshot.caret, "Line two");
    expect(visualContent(after, "")).toBe("Line one\n\nLine two\n");
  });

  it("keeps a trailing space, so the next word isn't glued on", () => {
    const before = headlessEditor(doc(paragraph("The quick ")));
    caretAtEnd(before);
    const { snapshot, after, restored } = remount(before);

    expect(restored).toBe(true);
    typeAt(after, snapshot.caret, "brown");
    expect(visualContent(after, "")).toBe("The quick brown\n");
  });

  it("is not an edit: no update event, no undo step, same file text", () => {
    const before = headlessEditor(doc(paragraph("Text"), paragraph()));
    const { snapshot, after, updates } = remount(before, "---\ntitle: x\n---\n");
    expect(updates).toBe(0);
    expect(visualContent(after, "---\ntitle: x\n---\n")).toBe(snapshot.content);
    expect(after.can().undo()).toBe(false);
  });

  it("does nothing when the editor shows different text", () => {
    const before = headlessEditor(doc(paragraph("Mine"), paragraph()));
    const snapshot = takeSnapshot(before, "");
    const after = headlessEditor("Changed on disk");
    expect(restoreSnapshot(after, snapshot, "")).toBe(false);
    expect(visualContent(after, "")).toBe("Changed on disk\n");
  });

  it("does nothing without a document or with one the schema rejects", () => {
    const after = headlessEditor("Same");
    const content = visualContent(after, "");
    expect(restoreSnapshot(after, { content, caret: 1 }, "")).toBe(false);
    const bogus = { type: "doc", content: [{ type: "nope" }] };
    expect(restoreSnapshot(after, { content, caret: 1, doc: bogus }, "")).toBe(false);
    expect(visualContent(after, "")).toBe(content);
  });
});
