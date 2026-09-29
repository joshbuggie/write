/**
 * The note rail's math (docs/design-decisions.md#d32): where the page scrolls to for each heading, and which
 * heading a scroll position is at. A position between two headings is a fractional index (2.5 is halfway
 * from the third heading to the fourth), which is what lets the heading list turn smoothly while scrubbing.
 * Framework-free, so it is tested without a browser.
 */

export const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));

/**
 * The scroll position that puts each heading just below the sticky header (`inset`), clamped to what the
 * page can scroll (`max`). The first entry is the note's title, at the very top. Never decreasing, so
 * headings near the end, which can't reach the top, share the bottom position.
 */
export function railStops(tops: number[], inset: number, max: number): number[] {
  let previous = 0;
  return tops.map((top, i) => {
    previous = i === 0 ? 0 : Math.max(previous, clamp(top - inset, 0, max));
    return previous;
  });
}

/** The fractional heading index at scroll position `s`: the last stop reached, plus progress to the next. */
export function indexAt(stops: number[], s: number): number {
  let i = 0;
  while (i + 1 < stops.length && stops[i + 1] <= s + 0.5) i++;
  if (i === stops.length - 1) return i;
  const gap = stops[i + 1] - stops[i];
  return gap > 0 ? i + clamp((s - stops[i]) / gap, 0, 0.999) : i;
}

/**
 * The heading one step from fractional index `f`. Going back from partway into a section lands on that
 * section's own heading first, the way "previous" works in a document outline.
 */
export function stepFrom(f: number, dir: 1 | -1): number {
  const i = Math.floor(f);
  if (dir > 0) return i + 1;
  return f - i > 0.05 ? i : i - 1;
}

/**
 * The thumb's height on a rail `track` px tall: proportional to how much of the note is `visible`, like a
 * scrollbar, but kept between 28 and 52 px so it stays phone-sized on a tall desktop window.
 */
export const thumbSize = (visible: number, total: number, track: number) =>
  clamp((visible / Math.max(1, total)) * track, 28, Math.max(28, Math.min(52, track / 3)));
