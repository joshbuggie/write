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

/** Words in a run the segmenter splits (Chinese, Japanese, Thai…): each word-like segment counts. */
function unspacedWords(token: string): number {
  const seg = wordSegmenter();
  if (!seg) return 1;
  let n = 0;
  for (const s of seg.segment(token)) if (s.isWordLike) n++;
  return n;
}

/**
 * Counts words the way word processors do (docs/design-decisions.md#d33): a word is a run of non-space
 * characters with at least one letter or digit, so "well-known", "don't" and a URL are one word each, and
 * a lone "—" or "#" is none. Chinese, Japanese and Thai don't put spaces between words, so runs in those
 * scripts are split by `Intl.Segmenter`. One linear pass, since source-mode notes can be megabytes.
 */
export function countWords(text: string): number {
  let n = 0;
  const tokens = /\S+/g;
  for (let m = tokens.exec(text); m; m = tokens.exec(text)) {
    const token = m[0];
    if (UNSPACED.test(token)) n += unspacedWords(token);
    else if (WORDISH.test(token)) n++;
  }
  return n;
}

/**
 * Line-start syntax that has letters or digits, so it would count as a word: numbered list markers
 * (`1.`), task boxes (`[x]`) and a code fence's language (```` ```ts ````). Bullets, `#`, `>` and table
 * pipes have none and are skipped by countWords anyway.
 */
const LINE_SYNTAX = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|(?:```|~~~)\S*)/gm;
/** HTML tags, which the visual editor never shows as text. */
const TAGS = /<\/?[A-Za-z][^<>\n]*>/g;

/**
 * Words in Markdown source as the visual editor would count them. Link destinations need no stripping:
 * `[text](url)` is one run of non-space characters with its last word.
 */
export function countMarkdownWords(markdown: string): number {
  return countWords(markdown.replace(LINE_SYNTAX, " ").replace(TAGS, " "));
}

/** Words between two positions of an editor document; blocks and leaves (images, breaks) separate words. */
export function countDocWords(doc: PMNode, from = 0, to = doc.content.size): number {
  return countWords(doc.textBetween(from, to, "\n", " "));
}
