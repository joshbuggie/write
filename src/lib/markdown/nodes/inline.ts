import type { JSONContent, MarkdownRendererHelpers } from "@tiptap/core";
import {
  hasBareAddress,
  independentParts,
  mayMisread,
  simplifyNear,
  toAtoms,
  type Atom,
} from "./inline-atoms";
import { markKey, settle, STYLES, type Renderer, type Style, type StyleAt } from "./inline-render";
import { firstMisread } from "./read-back";

/** `hasAddress`: the paragraph has a bare URL, so it's read back even without delimiters. */
type Options = { inTable: boolean; hasAddress: boolean };

/** Where marked first misreads `markdown` as a rendering of `atoms` (see firstMisread), or null. */
const misreadOf = (markdown: string, atoms: Atom[], { inTable }: Options) =>
  firstMisread(
    markdown,
    atoms.map((atom) => ({ text: atom.text, node: atom.node?.type, marks: atom.marks.map(markKey) })),
    inTable,
  );

/**
 * Settles the atoms and reads the markdown back with marked; if marked still gets it wrong ("**a *b*c**"),
 * the other styles are tried in order, and failing that the atoms are simplified where marked first
 * misread them (see simplifyNear), until it reads back. Returns the markdown, the style used, and
 * whether formatting was given up on the way.
 */
function writeReadably(atoms: Atom[], renderer: Renderer, options: Options, styles: StyleAt[]) {
  const [preferred, ...alternatives] = styles;
  for (let gaveUp = false; ;) {
    const plain = settle(atoms, renderer, preferred);
    gaveUp ||= plain.dropped > 0;
    const misread =
      plain.hasDelimiters || options.hasAddress ? misreadOf(plain.markdown, atoms, options) : null;
    if (!misread) return { markdown: plain.markdown, style: preferred, gaveUp };
    for (const style of alternatives) {
      const copy = atoms.map((atom) => ({ ...atom }));
      const attempt = settle(copy, renderer, style);
      if (attempt.dropped === 0 && !misreadOf(attempt.markdown, copy, options)) {
        return { markdown: attempt.markdown, style, gaveUp };
      }
    }
    const simplified = simplifyNear(atoms, misread);
    if (!simplified) return { markdown: plain.markdown, style: preferred, gaveUp };
    gaveUp ||= simplified === "emphasis";
  }
}

const STYLE_CHOICES: StyleAt[] = STYLES.map((style) => () => style);

/**
 * The style for each atom of a part of a paragraph, written readably on its own. A part that gives up
 * formatting may split into finer parts (see independentParts), as it will on the next save, so it's
 * written again from what's left: that keeps saving twice writing the same bytes.
 */
function writePart(atoms: Atom[], renderer: Renderer, inTable: boolean): Style[] {
  if (!mayMisread(atoms)) return Array<Style>(atoms.length).fill(STYLES[0]);
  for (;;) {
    const starts = independentParts(atoms);
    if (starts.length > 1) {
      return starts.flatMap((start, i) =>
        writePart(atoms.slice(start, starts[i + 1] ?? atoms.length), renderer, inTable),
      );
    }
    const options = { inTable, hasAddress: hasBareAddress(atoms) };
    const { style, gaveUp } = writeReadably(atoms, renderer, options, STYLE_CHOICES);
    if (!gaveUp) return Array<Style>(atoms.length).fill(style(0));
    atoms.forEach((atom) => (atom.plainAddress = false));
  }
}

/**
 * Inline content (text with marks, images, hard breaks) as markdown that re-opens as the same marks.
 * Overlapping marks are closed and reopened instead of falling back to HTML. Where CommonMark can't open
 * or close a delimiter (a mark edge between a letter and punctuation, like `これは「強調」です` or
 * `**Note:**do`), that mark is dropped from the character at the edge. The result is then read back with
 * marked (see writeReadably). The file may lose a little formatting that way, never text, and never
 * shows literal asterisks. A bare URL or email left as plain text re-opens as a link, which is accepted.
 *
 * Paragraphs are written in independent parts (see writePart), so the work stays close to linear even
 * for long paragraphs full of formatting; the whole paragraph is then checked once more.
 * `singleLine` (headings, a task's text) writes newline characters as spaces; `inTable` too, for a cell.
 */
export function renderInlineMarkdown(
  content: JSONContent[],
  h: MarkdownRendererHelpers,
  { singleLine = false, inTable = false } = {},
): string {
  const atoms = toAtoms(content, singleLine || inTable);
  const renderer: Renderer = { h, escaped: new Map() };
  const options = { inTable, hasAddress: hasBareAddress(atoms) };
  for (;;) {
    // Marks CommonMark can't open or close are given up first, so the parts are cut where they'll stay.
    settle(atoms, renderer, STYLE_CHOICES[0]);
    const styles = writePart(atoms, renderer, inTable);
    const whole = writeReadably(atoms, renderer, options, [(atom) => styles[atom]]);
    // The parts read the same together (see independentParts) unless escaping differs at a cut: rare,
    // and then the paragraph is written again from what's left, like the next save will.
    if (!whole.gaveUp) return whole.markdown;
    atoms.forEach((atom) => (atom.plainAddress = false));
  }
}
