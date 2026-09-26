import { splitFrontmatter } from "@/lib/markdown/file-format";
import { bodySections } from "./review";
import { joinSections, matchSection, splitSections, type Section } from "./sections";
import type { ProposalChange } from "./types";

/**
 * Turning decisions into text (docs/design-decisions.md#d31). Sections nobody touched keep their exact
 * bytes; only accepted sections are replaced, inserted or removed, and the note's front matter stays.
 */

/** A section of the note being rebuilt; `touched` when an accepted change put its text there. */
type Piece = { key: string; text: string; touched: boolean };

/** A section followed by another ends with one blank line; the last one ends with a single newline. */
function fit(text: string, last: boolean): string {
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return "";
  return trimmed + (last ? "\n" : "\n\n");
}

/** What goes before a new section so it follows `before` after a blank line: nothing, or 1 or 2 newlines. */
function separatorAfter(before: string): string {
  if (before === "" || /\n[ \t]*\n\s*$/.test(before)) return "";
  return before.endsWith("\n") ? "\n" : "\n\n";
}

/** Joins front matter and body without letting the body run into a front matter that lacks a newline. */
function joinFile(frontmatter: string, body: string): string {
  return frontmatter + (frontmatter && body && !frontmatter.endsWith("\n") ? "\n" : "") + body;
}

/**
 * The note with `accepted` applied: each change in it replaces, adds or removes its section in
 * `currentFile`. An added section (or one you had removed) goes after the section before it in the
 * proposal, or the nearest earlier one that is in the note. Returns `currentFile` itself when nothing
 * changes, so an unchanged note is never rewritten.
 */
export function applyChanges(currentFile: string, proposedFile: string, accepted: ProposalChange[]): string {
  if (accepted.length === 0) return currentFile;
  const { frontmatter, body } = splitFrontmatter(currentFile);
  const pieces: Piece[] = splitSections(body).map((s) => ({ key: s.key, text: s.text, touched: false }));
  const order = bodySections(proposedFile).map((s) => s.key);
  const indexOf = (key: string) => pieces.findIndex((p) => p.key === key);

  for (const change of accepted) {
    const at = indexOf(change.key);
    if (change.kind === "removed" || change.proposed === null) {
      if (at !== -1) pieces.splice(at, 1);
      continue;
    }
    if (at !== -1) {
      pieces[at] = { key: change.key, text: change.proposed, touched: true };
      continue;
    }
    let after = 0; // the opening text is always there
    for (let i = order.indexOf(change.key) - 1; i >= 0; i--) {
      const found = indexOf(order[i]);
      if (found !== -1) {
        after = found;
        break;
      }
    }
    // The new section brings its own blank line, so the section before it keeps its exact bytes.
    const lead = separatorAfter(pieces[after].text);
    pieces.splice(after + 1, 0, { key: change.key, text: lead + fit(change.proposed, false), touched: true });
  }

  // Only accepted sections are fitted; untouched ones, the last included, keep their exact bytes.
  const last = pieces.length - 1;
  const text = pieces.map((p, i) => (p.touched ? fit(p.text, i === last) : p.text));
  const next = joinFile(frontmatter, joinSections(text.map((t) => ({ text: t }))));
  return next === currentFile ? currentFile : next;
}

/** One section a harness sends on its own: which one it replaces, and its new text, heading included. */
export interface SectionEdit {
  /**
   * The heading of the section to replace: "## Plan" (that level only) or "Plan" (any level, if only one
   * matches); null or "" for the opening text.
   */
  heading: string | null;
  /** The new text, heading line included; "" removes the section. A heading not in the note adds it. */
  content: string;
}

/**
 * A whole proposed note built from section edits on top of `baseFile`, so a harness whose agents each
 * write one section needn't send the whole note back. New sections go at the end, in the order given. A
 * heading that matches more than one section is refused with a message the harness can act on.
 */
export function proposedFromSections(
  baseFile: string,
  edits: SectionEdit[],
): { ok: true; file: string } | { ok: false; message: string } {
  const { frontmatter, body } = splitFrontmatter(baseFile);
  const sections: Section[] = splitSections(body);
  const added: string[] = [];
  for (const edit of edits) {
    const match = matchSection(sections, edit.heading);
    if ("ambiguous" in match) {
      const which = match.ambiguous.map((h) => `"${h}"`).join(" and ");
      return {
        ok: false,
        message: `The heading "${edit.heading}" matches more than one section (${which}). Name it with its #s, or send the whole note as content.`,
      };
    }
    if ("missing" in match) added.push(edit.content);
    else {
      const at = sections.findIndex((s) => s.key === match.key);
      sections[at] = { ...sections[at], text: edit.content };
    }
  }
  const texts = [...sections.map((s) => s.text), ...added].filter((t, i) => i === 0 || t.trim() !== "");
  const last = texts.length - 1;
  const fitted = texts.map((t, i) => (i === last || !/\n\s*\n$/.test(t) ? fit(t, i === last) : t));
  return { ok: true, file: joinFile(frontmatter, fitted.join("")) };
}
