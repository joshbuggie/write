import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { countDocWords, countWords } from "@/lib/word-count";
import { maskMarkdown } from "@/lib/word-count-markdown";
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
 * The source editor's word counts, from the text with its Markdown syntax masked (see maskMarkdown), which
 * matches what the visual editor counts. A selection counts the words it covers in the masked text, so it
 * keeps its context: text inside a fence is code, and front matter is never counted. Masked again only
 * when the text changed, since a source-mode note can be megabytes.
 */
export function sourceWordCounters(el: HTMLTextAreaElement): WordCounters {
  let counted: { text: string; masked: string; total: number } | null = null;
  const count = () => {
    const text = el.value;
    if (counted?.text !== text) {
      const masked = maskMarkdown(text);
      counted = { text, masked, total: countWords(masked) };
    }
    return counted;
  };
  return {
    countWords: () => count().total,
    countSelectedWords: () => {
      const { selectionStart, selectionEnd } = el;
      return selectionStart === selectionEnd
        ? null
        : countWords(count().masked, selectionStart, selectionEnd);
    },
  };
}
