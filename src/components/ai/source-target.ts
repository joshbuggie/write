import { splitFrontmatter } from "@/lib/markdown/file-format";
import type { Target } from "./ai-target";

const base = { wholeBlocks: false, code: false };

/** Start and end of the line holding `pos` (the end is the "\n" after it, or the end of the text). */
function lineAt(value: string, pos: number): [number, number] {
  const start = value.lastIndexOf("\n", pos - 1) + 1;
  const next = value.indexOf("\n", pos);
  return [start, next === -1 ? value.length : next];
}

const isBlank = (value: string, [start, end]: [number, number]) => !value.slice(start, end).trim();

/**
 * The prompt window's target in the Markdown source editor (a textarea): the selection, else the lines
 * around the caret up to the nearest blank lines, else (the caret is on a blank line) just the caret. The
 * text is the Markdown as written, so nothing needs serializing.
 */
export function captureSourceTarget(el: HTMLTextAreaElement): Target {
  const { value, selectionStart: start, selectionEnd: end } = el;
  if (start !== end) {
    return {
      ...base,
      kind: "selection",
      name: "Selection",
      from: start,
      to: end,
      text: value.slice(start, end),
    };
  }
  const line = lineAt(value, start);
  if (isBlank(value, line)) {
    return { ...base, kind: "cursor", name: "At cursor", from: start, to: start, text: "" };
  }
  let [from, to] = line;
  while (from > 0 && !isBlank(value, lineAt(value, from - 1))) from = lineAt(value, from - 1)[0];
  while (to < value.length && !isBlank(value, lineAt(value, to + 1))) to = lineAt(value, to + 1)[1];
  return { ...base, kind: "paragraph", name: "Paragraph", from, to, text: value.slice(from, to) };
}

/**
 * Replaces from..to with `text` the way typing would: execCommand keeps the textarea's own undo stack (so
 * ⌘Z undoes it) and fires the input event the editor saves on. Falls back to setRangeText + an input event.
 */
function replaceRange(el: HTMLTextAreaElement, from: number, to: number, text: string) {
  el.focus({ preventScroll: true });
  el.setSelectionRange(from, to);
  if (document.execCommand("insertText", false, text)) return;
  el.setRangeText(text, from, to, "end");
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Where the target is now. Edits made while the window was open may have moved it, so it is looked up by
 * its text; null when it can't be found (then nothing is replaced, rather than the wrong text).
 */
function locate(el: HTMLTextAreaElement, target: Target): { from: number; to: number } | null {
  const caret = Math.min(target.from, el.value.length);
  if (target.kind === "cursor") return { from: caret, to: caret };
  if (el.value.slice(target.from, target.to) === target.text) return { from: target.from, to: target.to };
  const at = el.value.indexOf(target.text);
  return at === -1 || el.value.indexOf(target.text, at + 1) !== -1
    ? null
    : { from: at, to: at + target.text.length };
}

const tidy = (reply: string) => reply.replace(/^\n+|\s+$/g, "");

/** The blank lines Markdown needs between `before`, a new block, and `after`, so it stays its own block. */
export function asBlock(before: string, block: string, after: string): string {
  const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  return lead + block + trail;
}

/** A selection's own leading and trailing whitespace: selecting whole lines takes their "\n" along. */
export function edgesOf(text: string): [string, string] {
  if (!text.trim()) return ["", ""];
  return [/^\s*/.exec(text)?.[0] ?? "", /\s*$/.exec(text)?.[0] ?? ""];
}

/**
 * Replace: the target becomes the reply, keeping a selection's edge whitespace so the next line isn't
 * joined onto it. On a blank line, the reply goes in at the caret as its own block.
 */
export function replaceSource(el: HTMLTextAreaElement, target: Target, reply: string): boolean {
  const at = locate(el, target);
  const text = tidy(reply);
  if (!at || !text) return false;
  if (target.kind === "cursor") {
    replaceRange(el, at.from, at.to, asBlock(el.value.slice(0, at.from), text, el.value.slice(at.to)));
    return true;
  }
  const [lead, trail] = edgesOf(target.text);
  replaceRange(el, at.from, at.to, lead + text + trail);
  return true;
}

/** Insert below: the reply as a new block after the whole block the target ends in (on a blank line, at the caret). */
export function insertSourceBelow(el: HTMLTextAreaElement, target: Target, reply: string): boolean {
  if (target.kind === "cursor") return replaceSource(el, target, reply);
  const at = locate(el, target);
  const text = tidy(reply);
  if (!at || !text) return false;
  const blank = el.value.indexOf("\n\n", Math.max(at.from, at.to - 1));
  const end = blank === -1 ? el.value.trimEnd().length : blank;
  replaceRange(el, end, end, `\n\n${text}`);
  return true;
}

/** Replace note: everything after the front matter becomes the reply; the front matter stays byte for byte. */
export function replaceSourceNote(el: HTMLTextAreaElement, reply: string): boolean {
  if (!tidy(reply)) return false;
  const { frontmatter } = splitFrontmatter(el.value);
  replaceRange(el, frontmatter.length, el.value.length, `${tidy(reply)}\n`);
  return true;
}
