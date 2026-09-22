import type { Editor } from "@tiptap/core";
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
