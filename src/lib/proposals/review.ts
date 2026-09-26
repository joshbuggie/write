import { splitFrontmatter } from "@/lib/markdown/file-format";
import { headingText, sameText, splitSections, type Section } from "./sections";
import type { ProposalChange } from "./types";

/**
 * The three-way comparison behind a proposal review (docs/design-decisions.md#d31): what the harness read
 * (base), what it proposes, and the note as it is now (current). A section the harness changed is a
 * clean change when you left it alone, and a conflict when you changed it too. Front matter is never part
 * of a proposal: it is split off all three and left as it is in the note.
 */

/** Sections of a file's body, front matter removed. */
export const bodySections = (file: string) => splitSections(splitFrontmatter(file).body);

const byKey = (sections: Section[]) => new Map(sections.map((s) => [s.key, s]));

/**
 * The reason given for a section, matched on its heading text, and its level too when the reason's key
 * has #s ("## Plan"); the opening text is "".
 */
function reasonFor(reasons: Record<string, string>, section: Section): string | null {
  for (const [heading, reason] of Object.entries(reasons)) {
    const marks = /^\s*(#+)\s+/.exec(heading);
    if (marks && !section.key.startsWith(`${marks[1].length}:`)) continue;
    if (headingText(heading.replace(/^\s*#+\s*/, "")) === section.name) return reason;
  }
  return null;
}

/** Every change the proposal makes, in the proposed note's order, whether decided or not. */
export function buildChanges(
  baseFile: string,
  proposedFile: string,
  currentFile: string,
  reasons: Record<string, string> = {},
): ProposalChange[] {
  const base = bodySections(baseFile);
  const proposed = bodySections(proposedFile);
  const baseByKey = byKey(base);
  const proposedByKey = byKey(proposed);
  const currentByKey = byKey(bodySections(currentFile));
  const changes: ProposalChange[] = [];

  const removedAfter = new Map<string, Section[]>(); // removals shown after the nearest kept section
  let anchor = "";
  for (const b of base) {
    if (proposedByKey.has(b.key)) anchor = b.key;
    else removedAfter.set(anchor, [...(removedAfter.get(anchor) ?? []), b]);
  }

  const pushRemovals = (key: string) => {
    for (const b of removedAfter.get(key) ?? []) {
      const c = currentByKey.get(b.key);
      if (!c) continue; // already gone
      const state = sameText(c.text, b.text) ? "clean" : "conflict";
      const reason = reasonFor(reasons, b);
      changes.push({
        key: b.key,
        kind: "removed",
        heading: b.heading,
        state,
        reason,
        base: b.text,
        current: c.text,
        proposed: null,
      });
    }
  };

  for (const p of proposed) {
    const b = baseByKey.get(p.key);
    const c = currentByKey.get(p.key);
    const done = c !== undefined && sameText(c.text, p.text);
    if (!(b && sameText(b.text, p.text)) && !done) {
      const state = b
        ? !c
          ? "gone"
          : sameText(c.text, b.text)
            ? "clean"
            : "conflict"
        : c
          ? "conflict"
          : "clean";
      changes.push({
        key: p.key,
        kind: b ? "modified" : "added",
        heading: p.heading,
        state,
        reason: reasonFor(reasons, p),
        base: b?.text ?? null,
        current: c?.text ?? null,
        proposed: p.text,
      });
    }
    pushRemovals(p.key);
  }
  return changes;
}

/**
 * Whether `proposed` puts sections it shares with `base` in another order. A review can't show or apply
 * a move (each change replaces its section where it is), so such a proposal is refused up front instead
 * of being applied in the old order while saying it was applied.
 */
export function reordersSections(base: string, proposed: string): boolean {
  const baseKeys = bodySections(base).map((s) => s.key);
  const inBase = new Set(baseKeys);
  const kept = bodySections(proposed)
    .map((s) => s.key)
    .filter((k) => inBase.has(k));
  const inBoth = new Set(kept);
  const baseOrder = baseKeys.filter((k) => inBoth.has(k));
  return kept.some((k, i) => k !== baseOrder[i]);
}
