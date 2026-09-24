import { splitFrontmatter } from "@/lib/markdown/file-format";
import { bodySections } from "./review";
import { findSectionKey, joinSections, splitSections, type Section } from "./sections";
import type { ProposalChange } from "./types";

/**
 * Turning decisions into text (docs/design-decisions.md#d31). Sections nobody touched keep their exact
 * bytes; only accepted sections are replaced, inserted or removed, and the note's front matter stays.
 */

type Piece = { key: string; text: string; touched: boolean };

/** A section followed by another ends with one blank line; the last one ends with a single newline. */
function fit(text: string, last: boolean): string {
  const trimmed = text.replace(/\s+$/, "");
  if (!trimmed) return "";
  return trimmed + (last ? "\n" : "\n\n");
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
    pieces[after] = { ...pieces[after], touched: true }; // it may need a blank line before the new one
    pieces.splice(after + 1, 0, { key: change.key, text: change.proposed, touched: true });
  }

  const last = pieces.length - 1;
  const text = pieces.map((p, i) => (p.touched || i === last ? fit(p.text, i === last) : p.text));
  const next = joinFile(frontmatter, joinSections(text.map((t) => ({ text: t }))));
  return next === currentFile ? currentFile : next;
}

/** One section a harness sends on its own: which one it replaces, and its new text, heading included. */
export interface SectionEdit {
  /** The heading of the section to replace ("## Plan" or "Plan"); null or "" for the opening text. */
  heading: string | null;
  /** The new text, heading line included; "" removes the section. A heading not in the note adds it. */
  content: string;
}

/**
 * A whole proposed note built from section edits on top of `baseFile`, so a harness whose agents each
 * write one section needn't send the whole note back. New sections go at the end, in the order given.
 */
export function proposedFromSections(baseFile: string, edits: SectionEdit[]): string {
  const { frontmatter, body } = splitFrontmatter(baseFile);
  const sections: Section[] = splitSections(body);
  const added: string[] = [];
  for (const edit of edits) {
    const key = findSectionKey(sections, edit.heading);
    const at = key === null ? -1 : sections.findIndex((s) => s.key === key);
    if (at === -1) added.push(edit.content);
    else sections[at] = { ...sections[at], text: edit.content };
  }
  const texts = [...sections.map((s) => s.text), ...added].filter((t, i) => i === 0 || t.trim() !== "");
  const last = texts.length - 1;
  const fitted = texts.map((t, i) => (i === last || !/\n\s*\n$/.test(t) ? fit(t, i === last) : t));
  return joinFile(frontmatter, fitted.join(""));
}
