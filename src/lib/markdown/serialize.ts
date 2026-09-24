import type { Editor, JSONContent } from "@tiptap/core";
import { patchMarkdownManager } from "./escape";
import { finalizeMarkdown } from "./file-format";

/**
 * The ONLY way UI code reads markdown from an editor. It (re)applies the escaping patch, in case the
 * editor was created without our extension set, then normalizes the output so baselines compare equal.
 * Never call editor.getMarkdown() directly.
 */
export function serializeBody(editor: Editor): string {
  patchMarkdownManager(editor.markdown);
  return finalizeMarkdown(editor.getMarkdown());
}

/**
 * Markdown for part of a note (the AI prompt window's selection or paragraph), through the same patched
 * manager as serializeBody, so a passage sent to a model keeps its links, code and escapes.
 */
export function serializeBlocks(editor: Editor, blocks: JSONContent[]): string {
  patchMarkdownManager(editor.markdown);
  if (!editor.markdown) return "";
  return finalizeMarkdown(editor.markdown.serialize({ type: "doc", content: blocks }));
}
