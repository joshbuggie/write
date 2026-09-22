import { Image } from "@tiptap/extension-image";
import { escapeAltText, linkSuffix } from "./inline-syntax";

/** Image whose alt text and source re-open unchanged (spaces or an unbalanced ")" in the path included). */
export const WriteImage = Image.extend({
  renderMarkdown(node) {
    const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
    return `![${escapeAltText(alt)}${linkSuffix({ href: node.attrs?.src, title: node.attrs?.title })}`;
  },
});
