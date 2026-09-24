/** A span of the Markdown source textarea's text. */
export type SourceRange = { from: number; to: number };

/** One edit: `before[start..oldEnd)` became `after[start..newEnd)`. */
type Span = { start: number; oldEnd: number; newEnd: number };

/**
 * The span an edit replaced, found by trimming what both texts share at each end. Text alone can't say
 * where an edit inside a run of repeated characters happened ("foo" typed in front of "foo" looks like
 * "foo" typed after it), so `hint` pins it: the edit started at or before `hint.start` and its new text
 * ends at `hint.end`. A wrong hint still gives a span that explains the edit, just not the smallest one.
 */
export function changedSpan(before: string, after: string, hint?: { start: number; end: number }): Span {
  const shortest = Math.min(before.length, after.length);
  const startLimit = Math.min(shortest, hint?.start ?? shortest);
  let start = 0;
  while (start < startLimit && before[start] === after[start]) start++;
  const endLimit = Math.min(shortest - start, hint ? Math.max(0, after.length - hint.end) : shortest);
  let end = 0;
  while (end < endLimit && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { start, oldEnd: before.length - end, newEnd: after.length - end };
}

/**
 * `range` after the edit that turned `before` into `after`: kept by an edit after it, shifted by one
 * before it, and null once an edit touches it, because then it is no longer the passage the prompt was
 * about. Never guessed back from its text: an equal passage elsewhere isn't the same passage.
 */
export function mapRange(
  range: SourceRange | null,
  before: string,
  after: string,
  hint?: { start: number; end: number },
): SourceRange | null {
  if (!range || before === after) return range;
  const { start, oldEnd, newEnd } = changedSpan(before, after, hint);
  if (start >= range.to) return range;
  if (oldEnd <= range.from) {
    const shift = newEnd - oldEnd;
    return { from: range.from + shift, to: range.to + shift };
  }
  return null;
}

/** Follows a range of a textarea through the edits made to it; see trackSourceRange. */
export type RangeTracker = {
  /** Where the range is in `el` now, or null once an edit touched it (or `el` isn't the tracked textarea). */
  rangeIn(el: HTMLTextAreaElement): SourceRange | null;
  stop(): void;
};

/**
 * Keeps `range` current while the prompt window is open and the note stays editable. Each edit is mapped
 * as it happens, with the selection before it (from beforeinput) and the caret after it as the hint, so
 * typing, pasting and deleting are placed exactly. A change made without an input event (the note
 * reloaded from disk) is mapped when the range is read.
 */
export function trackSourceRange(el: HTMLTextAreaElement, initial: SourceRange): RangeTracker {
  let range: SourceRange | null = initial;
  let value = el.value;
  let editStart: number | null = null;
  const onBeforeInput = () => {
    editStart = el.selectionStart;
  };
  const onInput = () => {
    const caret = el.selectionEnd;
    const hint = { start: Math.min(editStart ?? caret, caret), end: caret };
    range = mapRange(range, value, el.value, hint);
    value = el.value;
    editStart = null;
  };
  el.addEventListener("beforeinput", onBeforeInput);
  el.addEventListener("input", onInput);
  return {
    rangeIn(current) {
      if (current !== el) return null;
      range = mapRange(range, value, el.value);
      value = el.value;
      return range;
    },
    stop() {
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("input", onInput);
    },
  };
}
