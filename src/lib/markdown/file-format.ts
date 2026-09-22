/**
 * How a note file is split into front matter (kept verbatim, never shown to the editor) and the markdown body.
 * The editor would otherwise mangle front matter into a horizontal rule plus a setext heading.
 */

export type SplitFile = { frontmatter: string; body: string };

// Opening fence on the first line, a non-blank line right after it (so a leading "---" rule isn't front matter),
// then whole lines up to the closing fence, then any blank lines.
const YAML =
  /^---[ \t]*\r?\n(?![ \t]*(?:\r?\n|$))(?:.*\r?\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/;
const TOML = /^\+\+\+[ \t]*\r?\n(?![ \t]*(?:\r?\n|$))(?:.*\r?\n)*?\+\+\+[ \t]*(?:\r?\n|$)(?:[ \t]*\r?\n)*/;

/**
 * Leading YAML (`---` … `---`|`...`) or TOML (`+++` … `+++`) front matter, verbatim, INCLUDING the blank
 * lines after it. No match → { frontmatter: "", body: file }. Never throws.
 */
export function splitFrontmatter(file: string): SplitFile {
  const match = YAML.exec(file) ?? TOML.exec(file);
  if (!match) return { frontmatter: "", body: file };
  return { frontmatter: match[0], body: file.slice(match[0].length) };
}

/** Guarantee: joinFile(splitFrontmatter(x)) === x for every string x. */
export function joinFile(parts: SplitFile): string {
  return parts.frontmatter + parts.body;
}

/**
 * Canonical form of editor output: no leading newlines, no trailing whitespace or &nbsp; (Tiptap's
 * empty-paragraph marker), and exactly one final "\n". Empty stays "".
 */
export function finalizeMarkdown(md: string): string {
  let s = md.replace(/^\n+/, "");
  for (;;) {
    const trimmed = s.trimEnd(); // also removes U+00A0
    s = trimmed.endsWith("&nbsp;") ? trimmed.slice(0, -"&nbsp;".length) : trimmed;
    if (s === trimmed) break;
  }
  return s ? s + "\n" : "";
}

/** frontmatter + finalizeMarkdown(editorMarkdown): the file text saved from the visual editor. */
export function composeFile(frontmatter: string, editorMarkdown: string): string {
  const body = finalizeMarkdown(editorMarkdown);
  // Front matter that ended the file without a newline must not run into new body text.
  const separator = frontmatter && body && !frontmatter.endsWith("\n") ? "\n" : "";
  return frontmatter + separator + body;
}
