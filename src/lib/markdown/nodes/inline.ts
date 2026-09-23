import type { JSONContent, MarkdownRendererHelpers } from "@tiptap/core";
import {
  fallBack,
  hasBareAddress,
  independentParts,
  MAY_BE_SYNTAX,
  mayMisread,
  resetWriting,
  simplifyNear,
  toAtoms,
  type Atom,
} from "./inline-atoms";
import { MAX_VISUAL_PARAGRAPH_CHARS } from "../oversized";
import { markKey, settle, STYLES, type Renderer, type Style, type StyleAt } from "./inline-render";
import { firstMisread } from "./read-back";

/** The escaping a paragraph's markdown gets after it's rendered (see renderInlineMarkdown). */
type AsWritten = (markdown: string) => string;

/** Where marked first misreads `markdown` as a rendering of `atoms` (see firstMisread), or null. */
const misreadOf = (markdown: string, atoms: Atom[], inTable: boolean, asWritten?: AsWritten) =>
  firstMisread(
    markdown,
    atoms.map((atom) => ({ text: atom.text, node: atom.node?.type, marks: atom.marks.map(markKey) })),
    inTable,
    asWritten,
  );

/**
 * Whether to read the markdown back: when it has emphasis delimiters or a bare address, which marked
 * reads in ways no rule predicts, or any syntax character at all. Only the first two for a paragraph
 * too long to re-open visually (see MAX_VISUAL_PARAGRAPH_CHARS): marked's inline lexing of a long
 * run full of "<" or "[" is slow, and the note opens as Markdown source anyway.
 */
function needsReadBack(plain: { markdown: string; hasDelimiters: boolean }, hasAddress: boolean) {
  if (plain.hasDelimiters || hasAddress) return true;
  return plain.markdown.length <= MAX_VISUAL_PARAGRAPH_CHARS && MAY_BE_SYNTAX.test(plain.markdown);
}

/**
 * How many times in a row a part is simplified where marked misread it (see simplifyNear) before the
 * safety net's next step (see fallBack) takes over. Each try renders and reads back the whole part, so
 * this keeps a part with many misreads (a URL before every code span) linear.
 */
const TARGETED_TRIES = 4;

/**
 * Settles the atoms and reads the markdown back with marked; if marked still gets it wrong ("**a *b*c**"),
 * the other styles are tried in order, and failing that the atoms are simplified where marked first
 * misread them (see simplifyNear), until it reads back. When that runs out, the safety net (fallBack)
 * writes the text so it can't misread. Returns the markdown, the style used, and whether formatting was
 * given up on the way.
 */
function writeReadably(
  atoms: Atom[],
  renderer: Renderer,
  inTable: boolean,
  styles: StyleAt[],
  asWritten?: AsWritten,
) {
  const [preferred, ...alternatives] = styles;
  const hasAddress = hasBareAddress(atoms);
  let gaveUp = false;
  for (let tries = 0; ;) {
    const plain = settle(atoms, renderer, preferred);
    gaveUp ||= plain.dropped > 0;
    const misread = needsReadBack(plain, hasAddress)
      ? misreadOf(plain.markdown, atoms, inTable, asWritten)
      : null;
    if (!misread) return { markdown: plain.markdown, style: preferred, gaveUp };
    for (const style of alternatives) {
      const copy = atoms.map((atom) => ({ ...atom }));
      const attempt = settle(copy, renderer, style);
      if (attempt.dropped === 0 && !misreadOf(attempt.markdown, copy, inTable, asWritten)) {
        return { markdown: attempt.markdown, style, gaveUp };
      }
    }
    let simplified: ReturnType<typeof fallBack> =
      tries < TARGETED_TRIES ? simplifyNear(atoms, misread) : null;
    tries = simplified ? tries + 1 : 0; // targeted tries start over after each step of the safety net
    simplified ??= fallBack(atoms);
    // Unreachable in practice: with everything escaped and no emphasis, marked reads back what's written.
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
    const { style, gaveUp } = writeReadably(atoms, renderer, inTable, STYLE_CHOICES);
    if (!gaveUp) return Array<Style>(atoms.length).fill(style(0));
    resetWriting(atoms);
  }
}

/**
 * In a table row, inline code can't hold a "|" after an odd number of backslashes ("a\|"): GFM needs
 * every "|" in a row escaped, code included, and one more backslash there would make the pair an
 * escaped backslash. Such a "|" is written as text next to the code instead, keeping the character.
 */
function freePipesFromCode(atoms: Atom[]): void {
  let backslashes = 0;
  atoms.forEach((atom, i) => {
    const code = atom.marks.some((mark) => mark.type === "code");
    const sameSpan = i > 0 && atoms[i - 1].marks.map(markKey).join() === atom.marks.map(markKey).join();
    if (!code || !sameSpan) backslashes = 0;
    if (code && atom.text === "|" && backslashes % 2 === 1) {
      atom.marks = atom.marks.filter((mark) => mark.type !== "code");
    }
    backslashes = code && atom.text === "\\" ? backslashes + 1 : 0;
  });
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
 * `asWritten`: the escaping the caller applies to the result, which the final read-back checks too
 * (only "<" before hidden delimiters when not given, see escapeTagLikeSpans).
 */
export function renderInlineMarkdown(
  content: JSONContent[],
  h: MarkdownRendererHelpers,
  {
    singleLine = false,
    inTable = false,
    asWritten,
  }: { singleLine?: boolean; inTable?: boolean; asWritten?: AsWritten } = {},
): string {
  const atoms = toAtoms(content, singleLine || inTable);
  if (inTable) freePipesFromCode(atoms);
  const renderer: Renderer = { h, escaped: new Map() };
  for (;;) {
    // Marks CommonMark can't open or close are given up first, so the parts are cut where they'll stay.
    settle(atoms, renderer, STYLE_CHOICES[0]);
    const styles = writePart(atoms, renderer, inTable);
    const whole = writeReadably(atoms, renderer, inTable, [(atom) => styles[atom]], asWritten);
    // The parts read the same together (see independentParts) unless escaping differs at a cut: rare,
    // and then the paragraph is written again from what's left, like the next save will.
    if (!whole.gaveUp) return whole.markdown;
    resetWriting(atoms);
  }
}
