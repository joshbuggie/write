import type { JSONContent, MarkdownRendererHelpers } from "@tiptap/core";
import { findUnparseableDelimiter, type Piece } from "./flanking";
import { expelWhitespace, toAtoms, type Atom, type MarkJSON } from "./inline-atoms";
import { codeSpan, escapeLinkText, linkSuffix } from "./inline-syntax";
import { linkMarkName, readsBackAs } from "./read-back";

type Run = { first: number; last: number; text?: string; node?: JSONContent; marks: MarkJSON[] };
type OpenMark = { key: string; mark: MarkJSON; delimiter: string; start: number };

/** Preferred delimiter and the alternative used when it would touch a closing run of the same character. */
const DELIMITERS: Record<string, [string, string]> = {
  bold: ["**", "__"],
  italic: ["*", "_"],
  strike: ["~~", "~~"],
};
/** The same with `_` preferred for italic, tried when marked misreads nested `*` delimiters. */
const UNDERSCORE_ITALIC: Record<string, [string, string]> = { ...DELIMITERS, italic: ["_", "*"] };
/** Nesting preference when marks start and end together: links outermost, like Tiptap's mark ranks. */
const RANK = ["link", "bold", "italic", "strike"];

const markKey = (mark: MarkJSON) =>
  mark.type === "link" ? linkMarkName(mark.attrs?.href, mark.attrs?.title) : mark.type;
const isRendered = (mark: MarkJSON) => mark.type === "link" || mark.type in DELIMITERS;
const isCode = (run: Run) => run.marks.some((mark) => mark.type === "code");

const marksId = (marks: MarkJSON[]) => marks.map(markKey).sort().join("\n");

/** Consecutive text atoms with the same marks form one run; every inline node is a run of its own. */
function toRuns(atoms: Atom[]): Run[] {
  const runs: Run[] = [];
  atoms.forEach((atom, i) => {
    const last = runs.at(-1);
    const sameMarks = last?.marks === atom.marks || marksId(last?.marks ?? []) === marksId(atom.marks);
    if (atom.text !== undefined && last?.text !== undefined && sameMarks) {
      last.text += atom.text;
      last.last = i;
    } else runs.push({ first: i, last: i, text: atom.text, node: atom.node, marks: atom.marks });
  });
  return runs;
}

/** How many runs, starting at `from`, carry the mark: marks that last longer are opened first (outside). */
const extent = (runs: Run[], from: number, key: string) => {
  let end = from;
  while (end < runs.length && runs[end].marks.some((mark) => markKey(mark) === key)) end++;
  return end - from;
};

function renderRun(run: Run, h: MarkdownRendererHelpers, atoms: Atom[]): string {
  const index = atoms[run.first].index;
  if (run.node) return h.renderChild?.(run.node, index) ?? "";
  // The text goes through the manager's (patched) escaping; a code mark tells it not to escape.
  const text = h.renderChild?.({ type: "text", text: run.text, marks: run.marks }, index) ?? run.text ?? "";
  return isCode(run) ? codeSpan(text) : text;
}

/** Markdown pieces for the atoms, with every mark nested properly (a stack, closed and reopened at crossings). */
function renderPieces(atoms: Atom[], h: MarkdownRendererHelpers, delimiters: typeof DELIMITERS): Piece[] {
  const runs = toRuns(atoms);
  const pieces: Piece[] = [];
  const stack: OpenMark[] = [];

  const close = (lastAtom: number) => {
    const open = stack.pop()!;
    if (open.mark.type === "link") {
      escapeLinkText(pieces, open.start + 1);
      pieces.push({ md: linkSuffix(open.mark.attrs) });
    } else {
      pieces.push({ md: open.delimiter, delimiter: { role: "close", atom: lastAtom, mark: open.key } });
    }
  };

  const open = (mark: MarkJSON, firstAtom: number) => {
    const key = markKey(mark);
    if (mark.type === "link") {
      stack.push({ key, mark, delimiter: "[", start: pieces.length });
      pieces.push({ md: "[" });
      return;
    }
    const [preferred, alternative] = delimiters[mark.type];
    const previous = pieces.at(-1)?.delimiter?.role === "close" ? pieces.at(-1)!.md[0] : "";
    const delimiter = previous === preferred[0] ? alternative : preferred;
    stack.push({ key, mark, delimiter, start: pieces.length });
    pieces.push({ md: delimiter, delimiter: { role: "open", atom: firstAtom, mark: key } });
  };

  runs.forEach((run, r) => {
    const keys = new Set(run.marks.filter(isRendered).map(markKey));
    const keep = stack.findIndex((open) => !keys.has(open.key));
    while (keep !== -1 && stack.length > keep) close(runs[r - 1].last);
    const toOpen = run.marks
      .filter((mark) => isRendered(mark) && !stack.some((open) => open.key === markKey(mark)))
      .map((mark) => ({ mark, length: extent(runs, r, markKey(mark)), rank: RANK.indexOf(mark.type) }))
      .sort((a, b) => b.length - a.length || a.rank - b.rank);
    toOpen.forEach(({ mark }) => open(mark, run.first));
    pieces.push({ md: renderRun(run, h, atoms), text: run.text !== undefined && !isCode(run) });
  });
  while (stack.length) close(atoms.length - 1);
  return pieces;
}

/**
 * Gives up the shortest stretch of bold, italic or strikethrough, the least formatting to lose when marked
 * wouldn't read the markdown back as written. False when there is none left to give up.
 */
function dropShortestEmphasis(atoms: Atom[]): boolean {
  let shortest: { type: string; from: number; to: number } | null = null;
  for (const type of Object.keys(DELIMITERS)) {
    for (let from = 0; from < atoms.length; from++) {
      if (!atoms[from].marks.some((mark) => mark.type === type)) continue;
      let to = from;
      while (to + 1 < atoms.length && atoms[to + 1].marks.some((mark) => mark.type === type)) to++;
      if (!shortest || to - from < shortest.to - shortest.from) shortest = { type, from, to };
      from = to;
    }
  }
  if (!shortest) return false;
  for (let i = shortest.from; i <= shortest.to; i++) {
    atoms[i].marks = atoms[i].marks.filter((mark) => mark.type !== shortest.type);
  }
  return true;
}

/**
 * Renders the atoms, dropping a mark from the character next to any delimiter CommonMark can't open or
 * close there (mutating `atoms`), until every delimiter parses. Returns the markdown and how many marks
 * were dropped.
 */
function settle(atoms: Atom[], h: MarkdownRendererHelpers, delimiters: typeof DELIMITERS) {
  for (let dropped = 0; ; dropped++) {
    // Again after every drop, so the result doesn't depend on the order marks were given up in.
    expelWhitespace(atoms);
    const pieces = renderPieces(atoms, h, delimiters);
    const culprit = findUnparseableDelimiter(pieces);
    if (!culprit) {
      const markdown = pieces.map((piece) => piece.md).join("");
      return { markdown, dropped, hasDelimiters: pieces.some((piece) => piece.delimiter) };
    }
    const atom = atoms[culprit.atom];
    atom.marks = atom.marks.filter((mark) => markKey(mark) !== culprit.mark);
  }
}

/**
 * Inline content (text with marks, images, hard breaks) as markdown that re-opens as the same marks.
 * Overlapping marks are closed and reopened instead of falling back to HTML. Where CommonMark can't open
 * or close a delimiter (a mark edge between a letter and punctuation, like `これは「強調」です` or
 * `**Note:**do`), that mark is dropped from the character at the edge. The result is then read back with
 * marked; if marked's emphasis matching still gets it wrong ("**a *b*c**"), `_` italics are tried, and
 * failing that the shortest stretch of emphasis is dropped. The file may lose a little formatting that
 * way, never text, and never shows literal asterisks.
 * `singleLine` (headings, a task's text) writes newline characters as spaces; `inTable` too, for a cell.
 */
export function renderInlineMarkdown(
  content: JSONContent[],
  h: MarkdownRendererHelpers,
  { singleLine = false, inTable = false } = {},
): string {
  const atoms = toAtoms(content, singleLine || inTable);
  const readsBack = (markdown: string, from: Atom[]) =>
    readsBackAs(
      markdown,
      from.map((atom) => ({ text: atom.text, node: atom.node?.type, marks: atom.marks.map(markKey) })),
      inTable,
    );
  for (;;) {
    const plain = settle(atoms, h, DELIMITERS);
    if (!plain.hasDelimiters || readsBack(plain.markdown, atoms)) return plain.markdown;
    const copy = atoms.map((atom) => ({ ...atom }));
    const underscored = settle(copy, h, UNDERSCORE_ITALIC);
    if (underscored.dropped === 0 && readsBack(underscored.markdown, copy)) return underscored.markdown;
    if (!dropShortestEmphasis(atoms)) return plain.markdown;
  }
}
