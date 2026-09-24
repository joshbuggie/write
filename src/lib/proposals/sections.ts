/**
 * A note body cut into sections at its `#` and `##` headings (docs/design-decisions.md#d31). Proposals
 * are reviewed one section at a time, so this is the unit a harness changes and the owner accepts.
 * Deeper headings (`###` and below) stay inside their section. Isomorphic: no Node or browser APIs.
 */

export interface Section {
  /**
   * Identifies the section across versions of the note: its heading level and text (case and spacing
   * ignored), plus "\n2", "\n3"… for a repeated heading. The text before the first heading is "".
   */
  key: string;
  /** The heading's text as compared ("plan"), or "" for the text before the first heading. */
  name: string;
  /** The heading line as written, trimmed ("## Plan"), or null for the text before the first heading. */
  heading: string | null;
  /** The section's exact text, heading line and trailing blank lines included. */
  text: string;
}

/** Opening fence of a code block: up to three spaces, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** An ATX heading of level 1 or 2; the text may be empty ("#") and closing #s are dropped. */
const HEADING = /^ {0,3}(#{1,2})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

/** Heading text as a key: closing hashes gone, spacing collapsed, case ignored. */
export const headingText = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The level and text of a heading line, or null for any other line. */
function parseHeading(line: string): { level: number; text: string } | null {
  const match = HEADING.exec(line.replace(/\r?\n$/, ""));
  return match ? { level: match[1].length, text: match[2] ?? "" } : null;
}

/**
 * Splits a body (front matter already removed) into sections. Joining every section's `text` gives the
 * body back exactly. The first section is always the text before the first heading, possibly empty.
 * Headings inside fenced code blocks don't count.
 */
export function splitSections(body: string): Section[] {
  const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const sections: Section[] = [{ key: "", name: "", heading: null, text: "" }];
  const seen = new Map<string, number>();
  let fence: { char: string; length: number } | null = null;
  for (const line of lines) {
    const open = FENCE.exec(line);
    if (fence) {
      const close = open && open[1][0] === fence.char && open[1].length >= fence.length;
      if (close && line.trim() === open[1]) fence = null;
    } else if (open) {
      fence = { char: open[1][0], length: open[1].length };
    } else {
      const heading = parseHeading(line);
      if (heading) {
        const name = headingText(heading.text);
        const base = `${heading.level}:${name}`;
        const count = (seen.get(base) ?? 0) + 1;
        seen.set(base, count);
        // A newline can't be in a heading, so "Plan" twice never collides with a heading "Plan 2".
        sections.push({
          key: count > 1 ? `${base}\n${count}` : base,
          name,
          heading: line.trim(),
          text: line,
        });
        continue;
      }
    }
    sections[sections.length - 1].text += line;
  }
  return sections;
}

/** Joins sections back into a body. */
export const joinSections = (sections: readonly Pick<Section, "text">[]) =>
  sections.map((s) => s.text).join("");

/** Two versions of a section are the same when they differ only in trailing whitespace. */
export const sameText = (a: string, b: string) => a.trimEnd() === b.trimEnd();

/** The key a harness means by a heading it names ("## Plan", "Plan"), matched on its text only. */
export function findSectionKey(sections: readonly Section[], heading: string | null): string | null {
  if (heading === null || heading.trim() === "") return "";
  const wanted = headingText(heading.replace(/^\s*#+\s*/, "").replace(/\s+#+\s*$/, ""));
  return sections.find((s) => s.heading !== null && s.name === wanted)?.key ?? null;
}
