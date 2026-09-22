import { Extension } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const MARKDOWN_HINT = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|\|.+\|)|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/m;

/**
 * DOM event dispatched (bubbling) on the editor element when a paste or drop carried only files.
 * The note screen listens for it to show "Image upload isn't supported yet — add files to your data folder."
 */
export const IGNORED_FILES_EVENT = "write:ignored-files";

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

function hasOnlyFiles(data: DataTransfer): boolean {
  return data.files.length > 0 && !data.getData("text/plain") && !data.getData("text/html");
}

function notifyIgnoredFiles(view: EditorView) {
  view.dom.dispatchEvent(new CustomEvent(IGNORED_FILES_EVENT, { bubbles: true }));
}

/**
 * Paste handling for a markdown notes app:
 * - rich HTML goes through the ProseMirror schema (default behavior);
 * - plain text that looks like markdown is parsed as markdown;
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
              notifyIgnoredFiles(view);
              return true;
            }
            if (view.state.selection.$from.parent.type.spec.code) return false;

            const text = data.getData("text/plain");
            const mode = vscodeMode(data);
            const plainText =
              mode === null ? !data.getData("text/html") : mode === "markdown" || mode === "plaintext";
            if (!text || !plainText) return false;

            if (looksLikeMarkdown(text)) {
              return editor.commands.insertContent(text, { contentType: "markdown" });
            }
            // Ignore VS Code's HTML: take PM's plain-text path (one paragraph per line).
            return mode !== null ? view.pasteText(text) : false;
          },
          handleDrop(view, event) {
            if (!event.dataTransfer || !hasOnlyFiles(event.dataTransfer)) return false;
            event.preventDefault();
            notifyIgnoredFiles(view);
            return true;
          },
        },
      }),
    ];
  },
});
