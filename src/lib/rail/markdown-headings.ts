import { splitFrontmatter } from "@/lib/markdown/file-format";

/**
 * The headings in a Markdown file, for the note rail in source mode (docs/design-decisions.md#d32), where
 * the note is a textarea with no heading elements to measure. Framework-free.
 */

/** A heading line: where it starts in the file, its level (1–3) and its text. */
export type SourceHeading = { offset: number; level: number; title: string };

/** Opening fence of a code block: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** An ATX heading of level 1 to 3 with text; closing #s are dropped. Deeper headings stay out of the rail. */
const HEADING = /^ {0,3}(#{1,3})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** Headings of level 1–3 in `file`, skipping its front matter and anything inside fenced code blocks. */
export function markdownHeadings(file: string): SourceHeading[] {
  const start = splitFrontmatter(file).frontmatter.length;
  const headings: SourceHeading[] = [];
  let fence: { char: string; length: number } | null = null;
  let offset = start;
  for (const raw of file.slice(start).split("\n")) {
    const line = raw.replace(/\r$/, "");
    const open = FENCE.exec(line);
    if (fence) {
      if (open && open[1][0] === fence.char && open[1].length >= fence.length && line.trim() === open[1]) {
        fence = null;
      }
    } else if (open) {
      fence = { char: open[1][0], length: open[1].length };
    } else {
      const heading = HEADING.exec(line);
      const title = heading?.[2].trim();
      if (heading && title) headings.push({ offset, level: heading[1].length, title });
    }
    offset += raw.length + 1;
  }
  return headings;
}
