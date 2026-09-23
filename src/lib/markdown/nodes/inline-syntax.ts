import type { Piece } from "./flanking";

/**
 * A code span that re-opens with exactly this content: the fence is longer than any backtick run inside,
 * and a space pads content that starts or ends with a backtick or that marked would otherwise trim.
 */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const trimmedByParser = /^ [\s\S]* $/.test(text) && /[^ ]/.test(text);
  const pad = /^`|`$/.test(text) || trimmedByParser ? " " : "";
  return fence + pad + text + pad + fence;
}

/**
 * Escape `[`/`]` that aren't part of a balanced pair in the text pieces from `from` on (code and images
 * keep theirs), so they can't end a link's text early ("a]b") or start a new link ("a[b"). Pairs nested
 * inside another pair are escaped too: marked reads one level of brackets in link text, not "[[x] y]".
 */
function escapeUnbalancedBrackets(pieces: Piece[], from: number): void {
  const open: Array<[piece: number, offset: number]> = [];
  const unbalanced: Array<[piece: number, offset: number]> = [];
  for (let p = from; p < pieces.length; p++) {
    const piece = pieces[p];
    if (!piece.text) continue;
    for (let i = 0; i < piece.md.length; i++) {
      const char = piece.md[i];
      if (char === "\\") i++;
      else if (char === "[") open.push([p, i]);
      else if (char === "]") {
        const opening = open.pop();
        if (!opening || open.length) unbalanced.push([p, i]);
        if (opening && open.length) unbalanced.push(opening);
      }
    }
  }
  // Insert from the end so earlier offsets stay valid.
  [...unbalanced, ...open]
    .sort(([pa, oa], [pb, ob]) => pb - pa || ob - oa)
    .forEach(([p, offset]) => {
      const md = pieces[p].md;
      pieces[p] = { ...pieces[p], md: md.slice(0, offset) + "\\" + md.slice(offset) };
    });
}

/** A bracket after a literal (escaped) backslash: an even run of backslashes before it. */
const BRACKET_AFTER_BACKSLASH = /(?<!\\)((?:\\\\)+)(?=[[\]])/g;

/**
 * Escape link text so it stays the link's text: unbalanced brackets (see escapeUnbalancedBrackets).
 * marked also un-escapes brackets in link text before reading it, so a "(" right after "]" is escaped
 * ("[x](y)" typed in link text isn't a link), and so is a bracket after a typed backslash ("\\[" would
 * lose the backslash).
 */
export function escapeLinkText(pieces: Piece[], from: number): void {
  const escapeText = (escape: (md: string) => string) => {
    for (let p = from; p < pieces.length; p++) {
      if (pieces[p].text) pieces[p] = { ...pieces[p], md: escape(pieces[p].md) };
    }
  };
  // First, so the brackets it escapes no longer count toward balancing the others.
  escapeText((md) => md.replace(BRACKET_AFTER_BACKSLASH, "$1\\"));
  escapeUnbalancedBrackets(pieces, from);
  escapeText((md) => md.replace(/\](?=\()/g, "]\\"));
}

/** An image's alt text; marked un-escapes brackets in it and keeps every other backslash as written. */
export function escapeAltText(alt: string): string {
  const pieces: Piece[] = [{ md: alt, text: true }];
  escapeUnbalancedBrackets(pieces, 0);
  return pieces[0].md;
}

/**
 * A backslash marked removes from a destination: before any punctuation or symbol (marked unescapes
 * Unicode ones too, "\\「"), or at the end, where the ")" or ">" closing the destination follows. A
 * literal one there is doubled.
 */
const BACKSLASH_BEFORE_PUNCTUATION = /\\(?=[\p{P}\p{S}]|$)/gu;

function parenthesesBalance(href: string): boolean {
  let depth = 0;
  for (const char of href) {
    if (char === "(") depth++;
    else if (char === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

/**
 * A link or image destination that re-opens as the same href: bare when that's unambiguous, otherwise
 * in `<…>` (spaces, unbalanced parentheses, angle brackets), which keeps Wikipedia-style `Foo_(bar)` bare.
 * A backtick is escaped: in a table row, Tiptap would pair it with one in another cell (and marked
 * removes the backslash again).
 */
export function linkDestination(href: string): string {
  const escaped = href.replace(BACKSLASH_BEFORE_PUNCTUATION, "\\\\").replace(/`/g, "\\`");
  const bare = href !== "" && !/[\s<>\p{Cc}]/u.test(href) && parenthesesBalance(href);
  return bare ? escaped : `<${escaped.replace(/[<>]/g, "\\$&")}>`;
}

/** `](destination "title")`, the end of a link whose text has just been written. */
export function linkSuffix(attrs: Record<string, unknown> = {}): string {
  const href = typeof attrs.href === "string" ? attrs.href : "";
  const title = typeof attrs.title === "string" && attrs.title ? attrs.title : "";
  const titlePart = title ? ` "${title.replace(/["\\`]/g, "\\$&")}"` : "";
  return `](${linkDestination(href)}${titlePart})`;
}
