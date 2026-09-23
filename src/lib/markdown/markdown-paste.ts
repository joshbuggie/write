import { Extension, type JSONContent } from "@tiptap/core";
import type { MarkdownManager } from "@tiptap/markdown";
import type { EditorView } from "@tiptap/pm/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { VISUAL_EDITOR_MAX_BYTES } from "@/lib/constants";
import { analyzeFidelity, hasOversizedParagraph } from "./fidelity";
import { finalizeMarkdown } from "./file-format";

// Each scan stops where the next match could start: link text at the next "[", the destination at the
// next "(" or space, bold at the next "*". That keeps the test linear on text full of "[a](" or "**".
const MARKDOWN_HINT = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|\|.+\|)|\*\*[^*]+\*\*|\[[^[\]]+\]\([^()\s]+\)/m;

/**
 * DOM event dispatched (bubbling) on the editor element when a paste or drop carried only files.
 * The note screen listens for it to show "Image upload isn't supported yet — add files to your data folder."
 */
export const IGNORED_FILES_EVENT = "write:ignored-files";

/**
 * DOM event dispatched (bubbling) on the editor element when markdown-looking text was pasted as plain
 * text because the visual editor would have dropped part of it. The note screen shows a toast so the
 * user knows why the Markdown wasn't formatted.
 */
export const PASTED_AS_TEXT_EVENT = "write:pasted-as-text";

/** Heuristic: does plain text look like markdown someone copied (headings, lists, quotes, fences, tables, bold, links)? */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINT.test(text);
}

/** VS Code puts its language mode in `vscode-editor-data`; prose modes are pasted as text, code modes as a code block. */
function vscodeMode(data: DataTransfer): string | null {
  try {
    const raw = data.getData("vscode-editor-data");
    if (!raw) return null;
    const mode: unknown = (JSON.parse(raw) as { mode?: unknown }).mode;
    return typeof mode === "string" ? mode : "";
  } catch {
    return null;
  }
}

/**
 * Parses pasted markdown for insertion, or returns null when the editor can't keep all of it (fenced
 * code nested in list items, linked images, HTML, unused reference definitions…): inserting it as
 * markdown would silently drop that content, so the caller pastes it as plain text instead.
 * Uses the same fidelity check as opening a note, on the pasted text alone.
 */
export function parsePastedMarkdown(manager: MarkdownManager, text: string): JSONContent | null {
  // Like a note, too much Markdown to parse quickly is pasted as text (see VISUAL_EDITOR_MAX_BYTES).
  if (text.length > VISUAL_EDITOR_MAX_BYTES || hasOversizedParagraph(text)) return null;
  const parsed = manager.parse(text);
  const roundTripped = finalizeMarkdown(manager.serialize(parsed));
  return analyzeFidelity(text, roundTripped).kind === "lossy" ? null : parsed;
}

function hasOnlyFiles(data: DataTransfer): boolean {
  return data.files.length > 0 && !data.getData("text/plain") && !data.getData("text/html");
}

function notify(view: EditorView, event: string) {
  view.dom.dispatchEvent(new CustomEvent(event, { bubbles: true }));
}

/**
 * Paste handling for a markdown notes app:
 * - rich HTML goes through the ProseMirror schema (default behavior);
 * - plain text that looks like markdown is parsed as markdown, unless the editor would drop part of it:
 *   then it is pasted as plain text and announced via PASTED_AS_TEXT_EVENT;
 * - inside a code block, text is pasted raw (default behavior);
 * - text copied from VS Code in a prose mode (markdown, plaintext) counts as plain text, not a code block;
 * - files and images are ignored (no uploads in v1), announced via IGNORED_FILES_EVENT.
 */
export const MarkdownPaste: Extension = Extension.create({
  name: "markdownPaste",
  // Run before CodeBlock's VS Code paste handler, which would turn every VS Code paste into a code block.
  priority: 1000,

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("markdownPaste"),
        props: {
          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data) return false;
            if (hasOnlyFiles(data)) {
              notify(view, IGNORED_FILES_EVENT);
              return true;
            }
            if (view.state.selection.$from.parent.type.spec.code) return false;

            const text = data.getData("text/plain");
            const mode = vscodeMode(data);
            const plainText =
              mode === null ? !data.getData("text/html") : mode === "markdown" || mode === "plaintext";
            if (!text || !plainText) return false;

            if (looksLikeMarkdown(text)) {
              const content = editor.markdown ? parsePastedMarkdown(editor.markdown, text) : null;
              if (content) return editor.commands.insertContent(content);
              notify(view, PASTED_AS_TEXT_EVENT);
              return view.pasteText(text);
            }
            // Ignore VS Code's HTML: take PM's plain-text path (one paragraph per line).
            return mode !== null ? view.pasteText(text) : false;
          },
          handleDrop(view, event) {
            if (!event.dataTransfer || !hasOnlyFiles(event.dataTransfer)) return false;
            event.preventDefault();
            notify(view, IGNORED_FILES_EVENT);
            return true;
          },
        },
      }),
    ];
  },
});
