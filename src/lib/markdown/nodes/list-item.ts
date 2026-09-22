import type { JSONContent, MarkdownRendererHelpers } from "@tiptap/core";
import { isBlankParagraph, withoutTrailingBlankParagraphs } from "./containers";

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);
const INTERRUPTS_PARAGRAPH = new Set(["codeBlock", "blockquote", "heading"]);

/** Whether a list's first line may interrupt a paragraph (CommonMark: not empty, ordered only from 1). */
function listInterruptsParagraph(list: JSONContent): boolean {
  if (isBlankParagraph(list.content?.[0]?.content?.[0])) return false;
  return list.type !== "orderedList" || (list.attrs?.start ?? 1) === 1;
}

/**
 * Blocks that can start right under a paragraph; everything else needs a blank line first. A paragraph
 * or table would merge into the text, and `---` right under text is a setext heading underline. After
 * other blocks a blank line always separates (two quotes in a row would otherwise merge).
 */
const canFollowParagraph = (child: JSONContent) =>
  INTERRUPTS_PARAGRAPH.has(child.type ?? "") ||
  (LISTS.has(child.type ?? "") && listInterruptsParagraph(child));

/**
 * Markdown for a list or task item: `marker` plus the first paragraph, then the other children indented
 * by `indent` columns (the marker's content column), each separated as markdown needs it. An empty item
 * is written as the bare marker (`-`, `1.`), which markdown reads as an empty item; with a trailing space
 * it would re-open as literal text.
 */
export function renderListItem(
  node: JSONContent,
  h: MarkdownRendererHelpers,
  marker: string,
  indent: number,
): string {
  const pad = " ".repeat(indent);
  const indentLines = (text: string) => text.replace(/\n(?=.)/g, "\n" + pad).trimEnd();
  const isTask = marker.includes("[");
  const [first, ...children] = withoutTrailingBlankParagraphs(node.content ?? [], 1);
  let text = first ? indentLines(h.renderChild?.(first, 0) ?? "") : "";
  // An empty item is a bare marker, but that can't be followed by a blank line, so an empty first
  // paragraph with blocks after it is written as "&nbsp;" (read back as an empty paragraph).
  if (!text && children.length && !isTask) text = "&nbsp;";
  // A task item keeps its trailing space: "- [ ]" alone is read back by WriteTaskList's tokenizer.
  let markdown = text || isTask ? marker + text : marker.trimEnd();
  children.forEach((child, i) => {
    const rendered = indentLines(pad + (h.renderChild?.(child, i + 1) ?? ""));
    const previous = i === 0 ? first : children[i - 1];
    const directly = previous?.type === "paragraph" && canFollowParagraph(child);
    markdown += (directly ? "\n" : "\n\n") + rendered;
  });
  return markdown;
}
