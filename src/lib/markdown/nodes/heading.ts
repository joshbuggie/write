import { Heading } from "@tiptap/extension-heading";
import { escapeTagLikeSpans } from "../escape";
import { renderInlineMarkdown } from "./inline";

/**
 * Heading written with the same inline serializer as paragraphs. An empty heading stays a bare `##`
 * (upstream dropped it), and trailing `#`s the user typed are escaped so they aren't read as a closing
 * sequence. Headings never hold line breaks: WriteHardBreak refuses them there.
 */
export const WriteHeading = Heading.extend({
  renderMarkdown(node, h) {
    const hashes = "#".repeat(Number(node.attrs?.level) || 1);
    const text = node.content?.length
      ? escapeTagLikeSpans(renderInlineMarkdown(node.content, h, { singleLine: true }))
      : "";
    return text ? `${hashes} ${text.replace(/(^|\s)(#+)$/, "$1\\$2")}` : hashes;
  },
});
