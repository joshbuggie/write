import { Heading } from "@tiptap/extension-heading";
import { escapeTagLikeSpans } from "../escape";
import { renderInlineMarkdown } from "./inline";
import { readsAsHeading } from "./read-back";

/** A heading's text as written: trailing "#"s the user typed aren't a closing sequence. */
const headingText = (markdown: string) => escapeTagLikeSpans(markdown).replace(/(^|\s)(#+)$/, "$1\\$2");

/**
 * Heading written with the same inline serializer as paragraphs. An empty heading stays a bare `##`
 * (upstream dropped it), and trailing `#`s the user typed are escaped so they aren't read as a closing
 * sequence. Headings never hold line breaks: WriteHardBreak refuses them there. The result is read back
 * as a block too (see readsAsHeading).
 */
export const WriteHeading = Heading.extend({
  renderMarkdown(node, h) {
    const level = Number(node.attrs?.level) || 1;
    const hashes = "#".repeat(level);
    if (!node.content?.length) return hashes;
    const readsAsOneBlock = (markdown: string) => {
      const text = headingText(markdown);
      return readsAsHeading(`${hashes} ${text}`, level, text);
    };
    const text = headingText(renderInlineMarkdown(node.content, h, { singleLine: true, readsAsOneBlock }));
    return text ? `${hashes} ${text}` : hashes;
  },
});
