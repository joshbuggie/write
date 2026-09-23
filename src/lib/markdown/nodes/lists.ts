import type { JSONContent, MarkdownParseHelpers, MarkdownToken } from "@tiptap/core";
import { BulletList, ListItem, OrderedList } from "@tiptap/extension-list";
import { renderListItem } from "./list-item";

/**
 * marked lexes blocks inside a list item "tight": a paragraph there is a `text` token, which Tiptap
 * would insert as bare text next to the blocks (invalid). As a block among blocks it is a paragraph.
 */
export const textAsParagraph = (token: MarkdownToken): MarkdownToken =>
  token.type === "text" ? { ...token, type: "paragraph" } : token;

/**
 * marked turns a leading "[ ] " of an ordered item into a checkbox token, which Tiptap would drop.
 * Ordered items can't be tasks here, so the marker goes back into the text.
 */
function keepTaskMarkerAsText(item: MarkdownToken): MarkdownToken {
  if (!item.task) return item;
  const restore = (tokens: MarkdownToken[] = []): MarkdownToken[] =>
    tokens.flatMap((token) => {
      if (token.type === "checkbox") return [{ type: "text", raw: token.raw, text: token.raw }];
      return token.tokens ? [{ ...token, tokens: restore(token.tokens) }] : [token];
    });
  const [first, second, ...rest] = item.tokens ?? [];
  // Tight items get the checkbox as a block token before the text token: merge it into that text.
  if (first?.type === "checkbox" && second?.tokens) {
    return { ...item, tokens: [{ ...second, tokens: [...restore([first]), ...second.tokens] }, ...rest] };
  }
  return { ...item, tokens: restore(item.tokens) };
}

/** The marker each list was last written with, so a list of the same kind right after it can differ. */
const writtenWith = new WeakMap<JSONContent, string>();

/**
 * The marker for a list: the first one, unless the list right before is of the same kind and used it
 * (then the other one, so the two don't merge). Three lists in a row alternate.
 */
function markerAfter(
  previous: JSONContent | null | undefined,
  type: string,
  [first, other]: [string, string],
) {
  return previous?.type === type && (writtenWith.get(previous) ?? first) === first ? other : first;
}

/**
 * Ordered lists are read by marked's own CommonMark list tokenizer. Tiptap's tokenizer measured item
 * content from the wrong column (fenced code under "1." gained a space on every save, a task list under
 * "1." fell apart, "1." alone became text) and also read "Dr. Smith" or "a." as list markers.
 * Markdown only has numbered lists, so pasted letter/roman styles aren't kept either.
 */
export const WriteOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      type: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    };
  },

  // A tokenizer that never matches, so marked's built-in list tokenizer handles ordered lists.
  markdownTokenizer: { name: "orderedList", level: "block", start: () => -1, tokenize: () => undefined },

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    if (token.type !== "list" || !token.ordered) return [];
    const start = typeof token.start === "number" ? token.start : 1;
    const content = helpers.parseChildren((token.items ?? []).map(keepTaskMarkerAsText));
    return helpers.createNode("orderedList", start === 1 ? undefined : { start }, content);
  },

  renderMarkdown(node, h, ctx) {
    const markdown = h.renderChildren(node.content ?? [], "\n");
    // "1." and "1)" lists are different lists, so a list right after another one stays separate.
    const delimiter = markerAfter(ctx.previousNode, "orderedList", [".", ")"]);
    writtenWith.set(node, delimiter);
    return delimiter === "." ? markdown : markdown.replace(/^(\d+)\.(?= |$)/gm, "$1)");
  },
});

/**
 * Bullet list. Markdown only starts a new list when the bullet character changes, so right after another
 * bullet list it uses the other one of "-" and "*" (task lists there use "+").
 */
export const WriteBulletList = BulletList.extend({
  renderMarkdown(node, h, ctx) {
    const markdown = h.renderChildren(node.content ?? [], "\n");
    const bullet = markerAfter(ctx.previousNode, "bulletList", ["-", "*"]);
    writtenWith.set(node, bullet);
    return bullet === "-" ? markdown : markdown.replace(/^-(?= |$)/gm, bullet);
  },
});

/**
 * List item with markdown-safe structure: an empty item is a bare marker, children line up with the
 * marker's content column, and blocks that can't interrupt a paragraph get a blank line before them.
 * Its first child is always a paragraph, also for items marked reads as "just a nested list", and text
 * after a heading (which marked leaves as a tight `text` token) is a paragraph, not loose text.
 */
export const WriteListItem = ListItem.extend({
  parseMarkdown(token, helpers) {
    const tokens = token.tokens?.map(textAsParagraph);
    const parsed = ListItem.config.parseMarkdown?.({ ...token, tokens }, helpers) as JSONContent | undefined;
    if (!parsed || Array.isArray(parsed)) return parsed ?? [];
    const content = parsed.content ?? [];
    return content[0]?.type === "paragraph"
      ? parsed
      : { ...parsed, content: [{ type: "paragraph", content: [] }, ...content] };
  },

  renderMarkdown(node, h, ctx) {
    const index = (ctx.meta?.parentAttrs?.start ?? 1) + ctx.index;
    const marker = ctx.parentType === "orderedList" ? `${index}. ` : "- ";
    return renderListItem(node, h, marker, marker.length);
  },
});
