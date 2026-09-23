/**
 * CommonMark's rule for when `*`, `_` and `~` delimiter runs may open or close emphasis ("flanking"),
 * with marked's GFM character classes, so the serializer can check its own output before writing it.
 */

/** A piece of rendered inline markdown; `delimiter` is set for emphasis/strike delimiters. */
export type Piece = {
  md: string;
  /** Escapable text (not code, images or syntax), used to escape brackets inside link text. */
  text?: boolean;
  delimiter?: { role: "open" | "close"; atom: number; mark: string };
};

const isWhitespace = (char: string) => char === "" || /\s/u.test(char);
// marked's GFM mode treats "~" as a letter here, so "**~~x~~**" still opens and closes.
const isPunctuation = (char: string) => char !== "~" && /[\p{P}\p{S}]/u.test(char);

const lastChar = (text: string) => Array.from(text.slice(-2)).at(-1) ?? "";
const firstChar = (text: string) => Array.from(text.slice(0, 2))[0] ?? "";

const leftFlanking = (before: string, after: string) =>
  !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
const rightFlanking = (before: string, after: string) =>
  !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));

/** Whether a run can open (or close) emphasis, by CommonMark's flanking rules (`_` is stricter). */
function canDo(role: "open" | "close", char: string, before: string, after: string) {
  const left = leftFlanking(before, after);
  const right = rightFlanking(before, after);
  if (role === "open") return left && (char !== "_" || !right || isPunctuation(before));
  return right && (char !== "_" || !left || isPunctuation(after));
}

/** A delimiter marked would not read as intended: the atom and mark to give up so it parses next time. */
export type Culprit = { atom: number; mark: string };

/**
 * Every delimiter run that marked would not read as intended, in order, each as the atom and mark to give
 * up so the next attempt parses; empty when every delimiter run can do its job. Adjacent delimiters with
 * the same character form one run, so a run that must both close and open is always a culprit. One pass,
 * so a paragraph full of mark edges next to punctuation isn't rescanned once per culprit.
 */
export function findUnparseableDelimiters(pieces: Piece[]): Culprit[] {
  const culprits: Culprit[] = [];
  let before = ""; // the last character written so far
  for (let i = 0; i < pieces.length;) {
    const char = pieces[i].delimiter ? pieces[i].md[0] : "";
    if (!char) {
      before = lastChar(pieces[i++].md) || before;
      continue;
    }
    let end = i;
    while (end < pieces.length && pieces[end].delimiter && pieces[end].md[0] === char) end++;
    let next = end;
    while (next < pieces.length && !pieces[next].md) next++;
    const after = firstChar(pieces[next]?.md ?? "");
    const run = pieces.slice(i, end);
    const openers = run.filter((piece) => piece.delimiter!.role === "open");
    const closers = run.filter((piece) => piece.delimiter!.role === "close");
    if (openers.length && (closers.length || !canDo("open", char, before, after))) {
      culprits.push(openers.at(-1)!.delimiter!);
    } else if (closers.length && !canDo("close", char, before, after)) {
      culprits.push(closers[0].delimiter!);
    }
    before = char;
    i = end;
  }
  return culprits;
}
