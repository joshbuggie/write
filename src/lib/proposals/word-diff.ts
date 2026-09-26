/**
 * Word-level differences between two versions of a section, for the review cards
 * (docs/design-decisions.md#d31). Myers' algorithm on words, spaces and punctuation, with a cap on the
 * work: a rewrite too different to show word by word shows as the old text struck out, then the new.
 * Isomorphic.
 */

export type DiffPart = { type: "same" | "del" | "ins"; text: string };

/** More tokens or edits than this and the diff isn't worth reading word by word. */
const MAX_TOKENS = 12_000;
const MAX_EDITS = 1_000;

/** Words, runs of whitespace, and single punctuation marks. */
const tokenize = (s: string) => s.match(/\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_'’]/gu) ?? [];

/** Adjacent parts of the same type merged, empty ones dropped. */
function merge(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const prev = out[out.length - 1];
    if (prev?.type === part.type) prev.text += part.text;
    else out.push({ ...part });
  }
  return out;
}

/**
 * The shortest edit script from `a` to `b` (Myers, "An O(ND) Difference Algorithm"), or null when it
 * needs more than `maxEdits` edits. Each step keeps only the diagonals it can reach, so memory grows with
 * the square of the edits, not with the length of the text.
 */
function myers(a: string[], b: string[], maxEdits: number): DiffPart[] | null {
  const n = a.length;
  const m = b.length;
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 1);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= Math.min(n + m, maxEdits); d++) {
    trace.push(v.slice(offset - d, offset + d + 1)); // the furthest x on each diagonal before step d
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]);
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, d);
    }
  }
  return null;
}

/** Walks the saved steps back from the end to recover the edits, in order. */
function backtrack(trace: Int32Array[], a: string[], b: string[], edits: number): DiffPart[] {
  const parts: DiffPart[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = edits; d > 0; d--) {
    const before = trace[d];
    const at = (k: number) => before[k + d];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const startX = down ? prevX : prevX + 1;
    for (let i = x - 1; i >= startX; i--) parts.push({ type: "same", text: a[i] });
    parts.push(down ? { type: "ins", text: b[prevY] } : { type: "del", text: a[prevX] });
    x = prevX;
    y = prevY;
  }
  for (let i = x - 1; i >= 0; i--) parts.push({ type: "same", text: a[i] });
  return parts.reverse();
}

/** A shared piece this small between two edits reads better as part of them ("a", "the", a space). */
const isCrumb = (text: string) => text.trim().length <= 3;

/**
 * Folds small shared pieces that sit between edits into those edits, so a rewritten sentence reads as
 * the old sentence then the new one instead of alternating word by word. Each run of edits becomes one
 * deletion followed by one insertion; both texts still rebuild exactly.
 */
function foldCrumbs(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  let del = "";
  let ins = "";
  const flush = () => {
    if (del) out.push({ type: "del", text: del });
    if (ins) out.push({ type: "ins", text: ins });
    del = ins = "";
  };
  parts.forEach((part, i) => {
    if (part.type === "del") del += part.text;
    else if (part.type === "ins") ins += part.text;
    else if ((del || ins) && i + 1 < parts.length && isCrumb(part.text)) {
      del += part.text;
      ins += part.text;
    } else {
      flush();
      out.push(part);
    }
  });
  flush();
  return out;
}

/** Share of the longer text, ignoring spaces, that stays the same. */
function keptShare(parts: DiffPart[]): number {
  const count = (type: DiffPart["type"]) =>
    parts.filter((p) => p.type === type).reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);
  const same = count("same");
  const longer = Math.max(same + count("del"), same + count("ins"));
  return longer === 0 ? 1 : same / longer;
}

/** Below this share kept, a section is a rewrite: shown as the old text struck out, then the new. */
const REWRITE_BELOW = 0.4;

/** The parts that turn `before` into `after`: unchanged text, deletions and insertions, in order. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA).join("");
  const midB = b.slice(start, endB).join("");
  const edits =
    (endA - start + endB - start <= MAX_TOKENS &&
      myers(a.slice(start, endA), b.slice(start, endB), MAX_EDITS)) ||
    [];
  let middle = foldCrumbs(merge(edits));
  // A rewrite between the shared start and end reads better whole: the old text, then the new.
  if (edits.length === 0 || keptShare(middle) < REWRITE_BELOW) {
    middle = [
      { type: "del", text: midA },
      { type: "ins", text: midB },
    ];
  }
  return foldCrumbs(
    merge([
      { type: "same", text: a.slice(0, start).join("") },
      ...middle,
      { type: "same", text: a.slice(endA).join("") },
    ]),
  );
}
