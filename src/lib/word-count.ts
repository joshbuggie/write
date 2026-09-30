import type { Node as PMNode } from "@tiptap/pm/model";

/** What the word count bar shows: words in the note's body, and in the selection (null for a caret). */
export type WordCount = { total: number; selected: number | null };

/** Scripts written without spaces between words; a run of them is split by the browser's word segmenter. */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const WORDISH = /[\p{L}\p{N}]/u;

let segmenter: Intl.Segmenter | null | undefined;
function wordSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
  }
  return segmenter;
}

/**
 * Words of a run the segmenter splits (Chinese, Japanese, Thai…) that overlap `from`–`to`, offsets within
 * the run: each word-like segment counts.
 */
function unspacedWords(token: string, from: number, to: number): number {
  const seg = wordSegmenter();
  if (!seg) return 1;
  let n = 0;
  for (const s of seg.segment(token)) {
    if (s.isWordLike && s.index < to && s.index + s.segment.length > from) n++;
  }
  return n;
}

/**
 * Counts words the way word processors do (docs/design-decisions.md#d33): a word is a run of non-space
 * characters with at least one letter or digit, so "well-known", "don't" and a URL are one word each, and
 * a lone "—" or "#" is none. Chinese, Japanese and Thai don't put spaces between words, so runs in those
 * scripts are split by `Intl.Segmenter`. One linear pass, since source-mode notes can be megabytes.
 *
 * With `from`–`to`, counts the words of the whole text that the range covers a letter or digit of, so a
 * selection is counted in its context and never outnumbers the total.
 */
export function countWords(text: string, from = 0, to = text.length): number {
  if (from >= to) return 0;
  let start = from;
  while (start > 0 && !/\s/.test(text[start - 1])) start--; // back to the start of the word `from` is in
  let n = 0;
  const tokens = /\S+/g;
  tokens.lastIndex = start;
  for (let m = tokens.exec(text); m && m.index < to; m = tokens.exec(text)) {
    const token = m[0];
    const lo = Math.max(from - m.index, 0);
    const hi = Math.min(to - m.index, token.length);
    if (UNSPACED.test(token)) n += unspacedWords(token, lo, hi);
    else if (WORDISH.test(token.slice(lo, hi))) n++;
  }
  return n;
}

/** Words between two positions of an editor document; blocks and leaves (images, breaks) separate words. */
export function countDocWords(doc: PMNode, from = 0, to = doc.content.size): number {
  return countWords(doc.textBetween(from, to, "\n", " "));
}
