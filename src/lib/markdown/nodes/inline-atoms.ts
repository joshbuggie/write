import type { JSONContent } from "@tiptap/core";
import { autolinkSpans, mayHaveBareUrl } from "../autolinks";
import type { Misread } from "./read-back";

/**
 * The characters of inline content, one "atom" each, prepared the way markdown can hold them. The inline
 * serializer (inline.ts) moves marks between atoms at this granularity when markdown can't put a
 * delimiter somewhere.
 */

export type MarkJSON = { type: string; attrs?: Record<string, unknown> };

/**
 * One code point of text, or one inline node (image, hard break), with the marks it carries.
 * `plainAddress`: part of a bare URL to write so marked doesn't link it (see simplifyNear).
 * `escapeAll`: text to write with all ASCII punctuation escaped (see fallBack).
 */
export type Atom = {
  index: number;
  text?: string;
  node?: JSONContent;
  marks: MarkJSON[];
  plainAddress?: boolean;
  escapeAll?: boolean;
};

/** Marks written with delimiter runs, which can't start or end on whitespace. */
const EMPHASIS = new Set(["bold", "italic", "strike"]);

const hasMark = (atom: Atom | undefined, type: string) => !!atom?.marks.some((mark) => mark.type === type);
const isCodeAtom = (atom: Atom) => atom.marks.some((mark) => mark.type === "code");
const isBreak = (atom?: Atom) => atom?.node?.type === "hardBreak";
const isNewline = (atom?: Atom) => atom?.text === "\n" && !isCodeAtom(atom);
const isSpace = (atom?: Atom) => atom?.text !== undefined && /^[^\S\n]$/.test(atom.text) && !isCodeAtom(atom);
const endsLine = (atom?: Atom) => isBreak(atom) || isNewline(atom);

/**
 * The atoms markdown can hold. It drops whitespace at the start and end of a paragraph and around line
 * breaks, has no line break at a paragraph's start or end, and a blank line would end the paragraph, so
 * those aren't written: the file stays canonical. A newline character in text (a soft break, e.g. from
 * a code block turned into a list item) stays one; in `singleLine` content (headings, cells, a task's
 * text) it is a space, like a hard break there (WriteHardBreak keeps those out of the editor), and in
 * inline code too.
 */
export function toAtoms(content: JSONContent[], singleLine: boolean): Atom[] {
  const atoms = content.flatMap((node, index): Atom[] => {
    const marks = (node.marks ?? []) as MarkJSON[];
    if (node.type !== "text") return [{ index, node, marks: node.type === "hardBreak" ? [] : marks }];
    return Array.from(node.text ?? "", (text) => ({ index, text, marks }));
  });
  const kept: Atom[] = [];
  atoms.forEach((atom) => {
    // Inline code can't hold a line break (marked reads one as a space), and single-line blocks neither.
    if ((singleLine || isCodeAtom(atom)) && atom.text === "\n") atom = { ...atom, text: " " };
    if (singleLine && isBreak(atom)) atom = { index: atom.index, text: " ", marks: [] };
    if (isSpace(atom) && (kept.length === 0 || endsLine(kept.at(-1)))) return;
    if (endsLine(atom)) {
      while (isSpace(kept.at(-1))) kept.pop();
      if (kept.length === 0 || isBreak(kept.at(-1))) return;
      if (isNewline(kept.at(-1))) kept.pop(); // a break wins over a soft break; two soft breaks are one
    }
    kept.push(atom);
  });
  while (isSpace(kept.at(-1)) || endsLine(kept.at(-1))) kept.pop();
  return kept;
}

/**
 * Bold, italic and strikethrough can't start or end on whitespace ("**a **" doesn't parse), so spaces at
 * the edges of those marks lose them first; that also lets marks that end together nest the right way.
 */
export function expelWhitespace(atoms: Atom[]): void {
  for (let changed = true; changed;) {
    changed = false;
    atoms.forEach((atom, i) => {
      if (!isSpace(atom) && !isNewline(atom)) return;
      const marks = atom.marks.filter(
        (mark) =>
          !EMPHASIS.has(mark.type) || (hasMark(atoms[i - 1], mark.type) && hasMark(atoms[i + 1], mark.type)),
      );
      if (marks.length === atom.marks.length) return;
      atom.marks = marks;
      changed = true;
    });
  }
}

/** Whether a paragraph writes nothing at all (only whitespace and line breaks), like an empty one. */
export const isBlankInline = (content: JSONContent[] = []) =>
  content.every(
    (node) =>
      node.type === "hardBreak" ||
      (node.type === "text" &&
        !/\S/.test(node.text ?? "") &&
        !node.marks?.some((mark) => mark.type === "code")),
  );

/** The atoms as one string, with an object replacement character for each inline node. */
const textOf = (atoms: Atom[]) => atoms.map((atom) => atom.text ?? "\ufffc").join("");

/** Whether the text may have a bare URL, which marked links (and reads up to the next space). */
export const hasBareAddress = (atoms: Atom[]) => mayHaveBareUrl(textOf(atoms));

const isPlainSpace = (atom: Atom) => atom.marks.length === 0 && /^[^\S\n]$/.test(atom.text ?? "");

/** Characters an email address can have before and after its "@", as marked reads them. */
const EMAIL_LOCAL = /[A-Za-z0-9._+-]/;
const EMAIL_DOMAIN = /[A-Za-z0-9._-]/;

/**
 * The [start, end) spans of bare URLs and of everything an email could span, in order. An email
 * decides how the text right after it reads ("me@x.comhttps://…" isn't a URL), so neither is cut.
 * Emails are found from each "@" outwards, which stays linear on long runs of letters.
 */
function addressSpans(text: string): Array<[number, number]> {
  const spans = autolinkSpans(text);
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    let [start, end] = [at, at + 1];
    while (start > 0 && EMAIL_LOCAL.test(text[start - 1])) start--;
    while (end < text.length && EMAIL_DOMAIN.test(text[end])) end++;
    spans.push([start, end]);
  }
  return spans.sort(([a], [b]) => a - b);
}

/**
 * Where a paragraph splits into parts that serialize independently: between two unformatted characters,
 * or next to an unformatted space. No mark or delimiter spans such a cut, and every delimiter has the
 * same kind of neighbor in its part as in the paragraph (a space reads like a part's start or end), so
 * marked reads each part the same alone. Line breaks, bare URLs (which marked reads up to the next
 * space) and emails are never cut. Cuts only appear as formatting is given up, never disappear, so the
 * parts of a paragraph as saved are these parts or finer. Returns the start index of every part.
 */
export function independentParts(atoms: Atom[]): number[] {
  const offsets: number[] = [];
  let text = "";
  atoms.forEach((atom) => {
    offsets.push(text.length);
    text += atom.text ?? "\ufffc"; // an inline node, which no address can contain
  });
  const inAddress = new Uint8Array(atoms.length);
  let atom = 0;
  for (const [start, end] of addressSpans(text)) {
    for (; atom < atoms.length && offsets[atom] < end; atom++) {
      if (offsets[atom] >= start) inAddress[atom] = 1;
    }
  }
  const canCut = (i: number) => {
    const [before, after] = [atoms[i - 1], atoms[i]];
    const edges = [before, after];
    if (
      inAddress[i - 1] ||
      inAddress[i] ||
      edges.some((edge) => edge.text === undefined || edge.text === "\n")
    ) {
      return false;
    }
    return edges.every((edge) => edge.marks.length === 0) || edges.some(isPlainSpace);
  };
  const starts = [0];
  for (let i = 1; i < atoms.length; i++) if (canCut(i)) starts.push(i);
  return starts;
}

/**
 * Characters marked may read as inline syntax: delimiters, code, links and images, entities, tags and
 * autolinks, escapes, and the starts of bare URLs and emails. Text without any is read literally.
 * ("|" matters in a table row. Block syntax at a line's start is escaped separately.)
 */
export const MAY_BE_SYNTAX = /[\\`*_~<>&[\]!@|]|www\.|:\/\//i;

/**
 * Whether a part of a paragraph needs writing readably on its own: it has formatting, an inline node or
 * a bare address. Unformatted text is cut into single characters (see independentParts), which read
 * the same anywhere; the whole paragraph is read back afterwards.
 */
export const mayMisread = (atoms: Atom[]) =>
  atoms.some((atom) => atom.node || atom.marks.length > 0) || hasBareAddress(atoms);

/** How far (in characters) from the first misread one a stretch of emphasis is still blamed for it. */
const BLAME_RADIUS = 8;

/**
 * Gives up one stretch of bold, italic or strikethrough near where marked first misread the markdown
 * (the atom at `misread`): the shortest stretch near it, or anywhere when none is near. That's the least
 * formatting to lose. False when there's no emphasis left.
 */
function dropEmphasisNear(atoms: Atom[], misread: number): boolean {
  const stretches: Array<{ type: string; from: number; to: number }> = [];
  for (const type of EMPHASIS) {
    for (let from = 0; from < atoms.length; from++) {
      if (!hasMark(atoms[from], type)) continue;
      let to = from;
      while (to + 1 < atoms.length && hasMark(atoms[to + 1], type)) to++;
      stretches.push({ type, from, to });
      from = to;
    }
  }
  const near = stretches.filter(
    ({ from, to }) => from <= misread + BLAME_RADIUS && to >= misread - BLAME_RADIUS,
  );
  const shortest = (near.length ? near : stretches).reduce<(typeof stretches)[number] | null>(
    (best, stretch) => (!best || stretch.to - stretch.from < best.to - best.from ? stretch : best),
    null,
  );
  if (!shortest) return false;
  for (let i = shortest.from; i <= shortest.to; i++) {
    atoms[i].marks = atoms[i].marks.filter((mark) => mark.type !== shortest.type);
  }
  return true;
}

/**
 * Marks the bare URL (or email) marked linked around the misread atom, or right before it, to be
 * written so marked doesn't link it: marked reads a URL up to the next space, swallowing a code span, a
 * link or delimiters written right after it. `autolinks` are the atoms marked linked, as [start, end).
 * False when there's no such address left to mark.
 */
function unlinkAddressAt(atoms: Atom[], { at, autolinks }: Misread): boolean {
  const address = autolinks.find(([start, end]) => start <= at && at <= end);
  if (!address) return false;
  // Atoms after the misread one may not line up with marked's reading any more; the address's run
  // starts before it, and the whole run is written plainly.
  const unlinked = atoms.slice(address[0], Math.min(at + 1, atoms.length));
  if (unlinked.every((atom) => atom.plainAddress)) return false;
  unlinked.forEach((atom) => (atom.plainAddress = true));
  return true;
}

/** Gives up every bold, italic and strikethrough mark. False when there's none. */
function dropAllEmphasis(atoms: Atom[]): boolean {
  let dropped = false;
  for (const atom of atoms) {
    const marks = atom.marks.filter((mark) => !EMPHASIS.has(mark.type));
    if (marks.length === atom.marks.length) continue;
    atom.marks = marks;
    dropped = true;
  }
  return dropped;
}

/**
 * The inline serializer's safety net, for markdown that still misreads when targeted simplification
 * (see simplifyNear) has nothing left to give up or has run out of tries. One step per call, least
 * loss first, each taking one render for the whole part: no bare address is linked; then all ASCII
 * punctuation in the text is escaped, which CommonMark reads back as the literal characters, so no
 * text can turn into syntax; finally all emphasis is given up. What's left then (text, code, links
 * and images) reads back as written. Null when every step has been taken.
 */
export function fallBack(atoms: Atom[]): "address" | "escape" | "emphasis" | null {
  if (hasBareAddress(atoms) && atoms.some((atom) => !atom.plainAddress)) {
    atoms.forEach((atom) => (atom.plainAddress = true));
    return "address";
  }
  if (atoms.some((atom) => atom.text !== undefined && !atom.escapeAll)) {
    atoms.forEach((atom) => (atom.escapeAll = true));
    return "escape";
  }
  return dropAllEmphasis(atoms) ? "emphasis" : null;
}

/** Forgets how the atoms were last written (see simplifyNear and fallBack), to write them afresh. */
export function resetWriting(atoms: Atom[]): void {
  atoms.forEach((atom) => {
    atom.plainAddress = false;
    atom.escapeAll = false;
  });
}

/**
 * Makes the atoms simpler to write where marked first misread their markdown (see firstMisread):
 * a bare address there is kept from being linked (see unlinkAddressAt), which keeps all formatting;
 * otherwise the nearest emphasis is given up (see dropEmphasisNear). The caller writes and checks
 * again. Returns what it did, or null when there's nothing left to simplify.
 */
export function simplifyNear(atoms: Atom[], misread: Misread): "address" | "emphasis" | null {
  if (unlinkAddressAt(atoms, misread)) return "address";
  return dropEmphasisNear(atoms, misread.at) ? "emphasis" : null;
}
