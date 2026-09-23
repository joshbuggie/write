import type { JSONContent, MarkdownRendererHelpers } from "@tiptap/core";
import { withEverythingEscaped, withPlainAddresses } from "../escape";
import { findUnparseableDelimiters, type Culprit, type Piece } from "./flanking";
import { expelWhitespace, type Atom, type MarkJSON } from "./inline-atoms";
import { codeSpan, escapeLinkText, linkSuffix } from "./inline-syntax";
import { linkMarkName } from "./read-back";

/**
 * Rendering atoms (see inline-atoms.ts) as inline markdown: runs of equally formatted text, marks nested
 * with delimiters, and the settling pass that gives up marks CommonMark can't open or close where they
 * are. inline.ts decides which style to use and checks the result with marked.
 */

type Run = {
  first: number;
  last: number;
  text?: string;
  node?: JSONContent;
  marks: MarkJSON[];
  /** The marks written as syntax (links and emphasis), by markKey. */
  keys: Set<string>;
  plainAddress?: boolean;
  escapeAll?: boolean;
};
type OpenMark = { key: string; mark: MarkJSON; delimiter: string; start: number };

/**
 * How marks are written: per mark type, the preferred delimiter and the alternative for when it would
 * touch a closing run of the same character; and which mark goes outside when marks start and end
 * together.
 */
export type Style = { delimiters: Record<string, [string, string]>; rank: string[] };
/** The style for marks that open at an atom (parts of a paragraph may choose differently). */
export type StyleAt = (atom: number) => Style;

const DELIMITERS = { bold: ["**", "__"], italic: ["*", "_"], strike: ["~~", "~~"] } as Style["delimiters"];
/** Links outermost, like Tiptap's mark ranks. */
const RANK = ["link", "bold", "italic", "strike"];

/**
 * The default style first, then the alternatives tried when marked misreads it: `_` italics (for nested
 * `*` runs, "**a *b*c**") and strikethrough outside bold and italic (marked misreads "**~~a~~**" before
 * some punctuation, but not "~~**a**~~").
 */
export const STYLES: Style[] = [
  { delimiters: DELIMITERS, rank: RANK },
  { delimiters: { ...DELIMITERS, italic: ["_", "*"] }, rank: RANK },
  { delimiters: DELIMITERS, rank: ["link", "strike", "bold", "italic"] },
  { delimiters: { ...DELIMITERS, italic: ["_", "*"] }, rank: ["link", "strike", "bold", "italic"] },
];

export const markKey = (mark: MarkJSON) =>
  mark.type === "link" ? linkMarkName(mark.attrs?.href, mark.attrs?.title) : mark.type;
const isRendered = (mark: MarkJSON) => mark.type === "link" || mark.type in DELIMITERS;
const isCode = (run: Run) => run.marks.some((mark) => mark.type === "code");

/** Whether two atoms' marks are the same set (order differs between text nodes). */
const sameMarks = (a: MarkJSON[], b: MarkJSON[]) =>
  a === b ||
  (a.length === b.length && a.every((mark) => b.some((other) => markKey(other) === markKey(mark))));

/**
 * What rendering a paragraph needs: the manager's helpers, and the text already escaped for this
 * paragraph (settling renders the same runs pass after pass, and escaping is the costly part).
 */
export type Renderer = { h: MarkdownRendererHelpers; escaped: Map<string, string> };

/** Consecutive text atoms with the same marks form one run; every inline node is a run of its own. */
function toRuns(atoms: Atom[]): Run[] {
  const runs: Run[] = [];
  atoms.forEach((atom, i) => {
    const last = runs.at(-1);
    if (atom.text !== undefined && last?.text !== undefined && sameMarks(last.marks, atom.marks)) {
      last.text += atom.text;
      last.last = i;
      last.plainAddress ||= atom.plainAddress;
      last.escapeAll ||= atom.escapeAll;
    } else {
      const keys = new Set(atom.marks.filter(isRendered).map(markKey));
      const { text, node, marks, plainAddress, escapeAll } = atom;
      runs.push({ first: i, last: i, text, node, marks, keys, plainAddress, escapeAll });
    }
  });
  return runs;
}

/**
 * How many runs, starting at a given one, carry a mark: marks that last longer are opened first
 * (outside). Remembered for every run it passes, so a long mark reopened at many crossings (or many
 * links) isn't rescanned each time.
 */
function extents(runs: Run[]) {
  const ends = new Map<string, Map<number, number>>();
  return (from: number, key: string) => {
    let known = ends.get(key);
    if (!known) ends.set(key, (known = new Map()));
    if (!known.has(from)) {
      let end = from;
      while (end < runs.length && runs[end].keys.has(key)) end++;
      for (let r = from; r < end; r++) known.set(r, end);
    }
    return known.get(from)! - from;
  };
}

function renderRun(run: Run, { h, escaped }: Renderer, atoms: Atom[]): string {
  const index = atoms[run.first].index;
  if (run.node) return h.renderChild?.(run.node, index) ?? "";
  // The text goes through the manager's (patched) escaping, which only depends on the text and the
  // mark types; a code mark tells it not to escape.
  const mode = run.escapeAll ? "all" : run.plainAddress ? "plain" : "";
  const key = `${mode} ${run.marks.map((mark) => mark.type).join(" ")}\n${run.text}`;
  if (!escaped.has(key)) {
    const render = () => h.renderChild?.({ type: "text", text: run.text, marks: run.marks }, index);
    const markdown = run.escapeAll
      ? withEverythingEscaped(render)
      : run.plainAddress
        ? withPlainAddresses(render)
        : render();
    escaped.set(key, markdown ?? run.text ?? "");
  }
  return isCode(run) ? codeSpan(escaped.get(key)!) : escaped.get(key)!;
}

/** Text ending in a "!" that isn't escaped already (after an even number of backslashes). */
const LIVE_BANG_AT_END = /(?:^|[^\\])(?:\\\\)*!$/;

/** A "!" written right before a link's "[" would make it an image, so it is escaped: "Wow\![here](u)". */
function escapeBangBeforeLink(pieces: Piece[]): void {
  const last = pieces.at(-1);
  if (last?.text && LIVE_BANG_AT_END.test(last.md)) {
    pieces[pieces.length - 1] = { ...last, md: last.md.slice(0, -1) + "\\!" };
  }
}

/** Markdown pieces for the atoms, with every mark nested properly (a stack, closed and reopened at crossings). */
function renderPieces(atoms: Atom[], renderer: Renderer, styleAt: StyleAt): Piece[] {
  const runs = toRuns(atoms);
  const extent = extents(runs);
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
      escapeBangBeforeLink(pieces);
      stack.push({ key, mark, delimiter: "[", start: pieces.length });
      pieces.push({ md: "[" });
      return;
    }
    const [preferred, alternative] = styleAt(firstAtom).delimiters[mark.type];
    const previous = pieces.at(-1)?.delimiter?.role === "close" ? pieces.at(-1)!.md[0] : "";
    const delimiter = previous === preferred[0] ? alternative : preferred;
    stack.push({ key, mark, delimiter, start: pieces.length });
    pieces.push({ md: delimiter, delimiter: { role: "open", atom: firstAtom, mark: key } });
  };

  runs.forEach((run, r) => {
    const keep = stack.findIndex((open) => !run.keys.has(open.key));
    while (keep !== -1 && stack.length > keep) close(runs[r - 1].last);
    const toOpen = run.marks
      .filter((mark) => isRendered(mark) && !stack.some((open) => open.key === markKey(mark)))
      .map((mark) => {
        const rank = styleAt(run.first).rank.indexOf(mark.type);
        return { mark, length: extent(r, markKey(mark)), rank };
      })
      .sort((a, b) => b.length - a.length || a.rank - b.rank);
    toOpen.forEach(({ mark }) => open(mark, run.first));
    pieces.push({ md: renderRun(run, renderer, atoms), text: run.text !== undefined && !isCode(run) });
  });
  while (stack.length) close(atoms.length - 1);
  return pieces;
}

/** Culprits closer than this (in characters) are given up one at a time: one may fix the other. */
const CULPRIT_REACH = 8;

/**
 * The culprits to give up together: the first, and each later one far enough from the last one taken
 * that giving that up only changes the markdown around it. The rest wait for the next pass.
 */
function separateCulprits(culprits: Culprit[]): Culprit[] {
  const taken: Culprit[] = [];
  for (const culprit of culprits) {
    if (!taken.length || culprit.atom - taken.at(-1)!.atom > CULPRIT_REACH) taken.push(culprit);
  }
  return taken;
}

/**
 * Renders the atoms, dropping a mark from the character next to any delimiter CommonMark can't open or
 * close there (mutating `atoms`), until every delimiter parses. Culprits far apart are dropped in the
 * same pass, so a paragraph full of them doesn't take a pass each. Returns the markdown and how many
 * marks were dropped.
 */
export function settle(atoms: Atom[], renderer: Renderer, styleAt: StyleAt) {
  for (let dropped = 0; ;) {
    // Again after every drop, so the result doesn't depend on the order marks were given up in.
    expelWhitespace(atoms);
    const pieces = renderPieces(atoms, renderer, styleAt);
    const culprits = separateCulprits(findUnparseableDelimiters(pieces));
    if (culprits.length === 0) {
      const markdown = pieces.map((piece) => piece.md).join("");
      return { markdown, dropped, hasDelimiters: pieces.some((piece) => piece.delimiter) };
    }
    for (const { atom, mark } of culprits) {
      atoms[atom].marks = atoms[atom].marks.filter((candidate) => markKey(candidate) !== mark);
    }
    dropped += culprits.length;
  }
}
