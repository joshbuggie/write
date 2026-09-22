import type { JSONContent } from "@tiptap/core";

/**
 * The characters of inline content, one "atom" each, prepared the way markdown can hold them. The inline
 * serializer (inline.ts) moves marks between atoms at this granularity when markdown can't put a
 * delimiter somewhere.
 */

export type MarkJSON = { type: string; attrs?: Record<string, unknown> };

/** One code point of text, or one inline node (image, hard break), with the marks it carries. */
export type Atom = { index: number; text?: string; node?: JSONContent; marks: MarkJSON[] };

/** Marks written with delimiter runs, which can't start or end on whitespace. */
const EMPHASIS = new Set(["bold", "italic", "strike"]);

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
  const hasEmphasis = (atom: Atom | undefined, type: string) =>
    atom?.marks.some((mark) => mark.type === type);
  for (let changed = true; changed;) {
    changed = false;
    atoms.forEach((atom, i) => {
      if (!isSpace(atom) && !isNewline(atom)) return;
      const marks = atom.marks.filter(
        (mark) =>
          !EMPHASIS.has(mark.type) ||
          (hasEmphasis(atoms[i - 1], mark.type) && hasEmphasis(atoms[i + 1], mark.type)),
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
