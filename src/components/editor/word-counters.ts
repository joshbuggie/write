import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { splitFrontmatter } from "@/lib/markdown/file-format";
import { countDocWords, countMarkdownWords } from "@/lib/word-count";
import type { EditorHandle } from "./note-editor";

type WordCounters = Pick<EditorHandle, "countWords" | "countSelectedWords">;

/**
 * The visual editor's word counts. The whole document is counted again only when it changed (documents
 * are immutable, so comparing them is free), so moving the caret or dragging a selection costs only the
 * selection's words.
 */
export function visualWordCounters(editor: Editor): WordCounters {
  let counted: { doc: PMNode; total: number } | null = null;
  return {
    countWords: () => {
      if (editor.isDestroyed) return counted?.total ?? 0;
      const { doc } = editor.state;
      if (counted?.doc !== doc) counted = { doc, total: countDocWords(doc) };
      return counted.total;
    },
    countSelectedWords: () => {
      if (editor.isDestroyed) return null;
      const { doc, selection } = editor.state;
      return selection.empty ? null : countDocWords(doc, selection.from, selection.to);
    },
  };
}

/**
 * The source editor's word counts: the Markdown body without its front matter, which the visual editor
 * doesn't count either, so a selection only counts the part of it in the body. Recounted only when the
 * text changed, since a source-mode note can be megabytes.
 */
export function sourceWordCounters(el: HTMLTextAreaElement): WordCounters {
  let counted: { text: string; bodyStart: number; total: number } | null = null;
  const count = () => {
    const text = el.value;
    if (counted?.text !== text) {
      const { frontmatter, body } = splitFrontmatter(text);
      counted = { text, bodyStart: frontmatter.length, total: countMarkdownWords(body) };
    }
    return counted;
  };
  return {
    countWords: () => count().total,
    countSelectedWords: () => {
      const { selectionStart, selectionEnd } = el;
      if (selectionStart === selectionEnd) return null;
      const { text, bodyStart } = count();
      return countMarkdownWords(
        text.slice(Math.max(selectionStart, bodyStart), Math.max(selectionEnd, bodyStart)),
      );
    },
  };
}
