import type { MarkdownToken } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { renderListItem } from "./list-item";
import { textAsParagraph } from "./lists";

const upstreamTokenizer = TaskList.config.markdownTokenizer!;

/**
 * An empty task item loses its trailing space at the end of a file ("- [ ]"), and Tiptap's tokenizer
 * needs whitespace after the checkbox. A no-break space is whitespace to it, and no file has one there.
 */
const PAD = String.fromCharCode(0xa0);
const BARE_TASK = /^(\s*[-+*]\s+\[[ xX]\])$/gm;
const PADDED_TASK = new RegExp(`^(\\s*[-+*]\\s+\\[[ xX]\\])${PAD}$`, "gm");
const pad = (src: string) => src.replace(BARE_TASK, `$1${PAD}`);

/**
 * Task list whose tokenizer also accepts an empty item with nothing after the checkbox ("- [ ]"). The
 * source is padded for Tiptap's tokenizer and the padding removed from the token's raw text, so marked
 * still advances over exactly the original characters. Blank lines before the list are left to marked:
 * Tiptap's tokenizer swallowed them, losing the empty paragraph they stand for.
 */
export const WriteTaskList = TaskList.extend({
  // Right after a bullet list ("-", or "*" after another one), "-" would continue that list (an empty
  // last "- [ ]" even as a plain item), so "+" starts a new one.
  renderMarkdown(node, h, ctx) {
    const markdown = h.renderChildren(node.content ?? [], "\n");
    return ctx.previousNode?.type === "bulletList" ? markdown.replace(/^-(?= \[)/gm, "+") : markdown;
  },

  markdownTokenizer: {
    ...upstreamTokenizer,
    start: (src: string) => {
      const { start } = upstreamTokenizer;
      return typeof start === "function" ? start(pad(src)) : pad(src).indexOf(start ?? "");
    },
    tokenize: (src, tokens, lexer) => {
      if (/^[ \t]*\n/.test(src)) return undefined;
      const token = upstreamTokenizer.tokenize(pad(src), tokens, lexer);
      return token && { ...token, raw: token.raw?.replace(PADDED_TASK, "$1") };
    },
  },
});

/**
 * Task item with the list item structure rules (see renderListItem); nested content sits under the text.
 * Paragraphs nested in a task inside another list come back as paragraphs (see textAsParagraph).
 */
export const WriteTaskItem = TaskItem.extend({
  parseMarkdown(token, helpers) {
    const nestedTokens = (token.nestedTokens as MarkdownToken[] | undefined)?.map(textAsParagraph);
    return TaskItem.config.parseMarkdown?.({ ...token, nestedTokens }, helpers) ?? [];
  },

  renderMarkdown(node, h) {
    return renderListItem(node, h, `- [${node.attrs?.checked ? "x" : " "}] `, 2);
  },
});
