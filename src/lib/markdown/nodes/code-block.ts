import { CodeBlock } from "@tiptap/extension-code-block";

/** Backtick runs that could close a fence: at the start of a line, after at most three spaces. */
const FENCE_LIKE_RUN = /^ {0,3}(`{3,})/gm;

/**
 * The fence for a code block: three backticks, or one more than the longest backtick run that starts a
 * line of the code, so a README or chat answer pasted into a code block can't close it early. An info
 * string with a backtick can't follow a backtick fence, so that rare case uses tildes.
 */
export function codeFence(code: string, language: string): string {
  const longest = Math.max(0, ...Array.from(code.matchAll(FENCE_LIKE_RUN), (match) => match[1].length));
  if (language.includes("`")) {
    const tildes = Math.max(0, ...Array.from(code.matchAll(/^ {0,3}(~{3,})/gm), (match) => match[1].length));
    return "~".repeat(Math.max(3, tildes + 1));
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/** Code block whose fence always outlasts the code inside it (see codeFence). */
export const WriteCodeBlock = CodeBlock.extend({
  renderMarkdown(node) {
    const code = (node.content ?? []).map((child) => child.text ?? "").join("");
    const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
    const fence = codeFence(code, language);
    return `${fence}${language}\n${code}\n${fence}`;
  },
});
