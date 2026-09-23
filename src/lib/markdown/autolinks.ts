import { Lexer } from "marked";

/**
 * GFM "autolink literals": marked turns bare URLs (`https://`, `http://`, `ftp://`, `www.`) and email
 * addresses in plain text into links. A URL runs up to the next space or "<", backslashes included, so
 * escaping must leave it alone, and a URL right before other syntax swallows it. Emails can't hold a
 * backslash or swallow syntax (they end at the first character that isn't part of a domain), so only
 * URLs need care; either kind of link is told apart from the editor's own links by isAutolinkLiteral.
 */

const RULES = Lexer.rules.inline.gfm;

/** Where marked tries a URL: its text scanning stops before every "http", "ftp://" and "www.". */
const URL_START = /[hH][tT][tT][pP][sS]?:\/\/|[fF][tT][pP]:\/\/|www\./g;
/**
 * Whether marked might link a bare URL somewhere in the text: looser than autolinkSpans (it doesn't
 * rule out URLs an email may swallow), for deciding whether to check how marked reads it.
 */
export const mayHaveBareUrl = (text: string) => new RegExp(URL_START.source).test(text);

/** An email address still going on right before a URL start, which then becomes part of the email. */
const INSIDE_EMAIL = /@[a-zA-Z0-9._-]*$/;

/**
 * How much of a URL match marked links: it "backpedals" trailing punctuation and cuts the link at an
 * unmatched "(", reading everything after that cut as ordinary markdown.
 */
function linkedLength(match: string): number {
  let linked = match;
  for (let previous = ""; previous !== linked;) {
    previous = linked;
    linked = RULES._backpedal.exec(linked)?.[0] ?? "";
  }
  return linked.length;
}

/**
 * The [start, end) spans of `text` that marked would read as bare URLs, as written: a trailing "." or
 * "_" that marked leaves out of the link is included, because a backslash written before it would end
 * up inside the link. A URL that marked cuts at an unmatched "(" ends there: marked reads the rest as
 * ordinary markdown, so it is escaped like other text (and may hold another URL).
 */
export function autolinkSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const { index } of text.matchAll(URL_START)) {
    if (index < (spans.at(-1)?.[1] ?? 0)) continue; // inside the previous URL
    if (INSIDE_EMAIL.test(text.slice(Math.max(0, index - 256), index))) continue;
    const match = RULES.url.exec(text.slice(index))?.[0] ?? "";
    if (!match) continue;
    const cut = match.indexOf("(", linkedLength(match));
    spans.push([index, index + (cut === -1 ? match.length : cut)]);
  }
  return spans;
}

/**
 * Whether a link token from marked is an autolink literal (a bare URL or email in the text), not
 * `[text](url)` or `<url>`: those always carry their brackets in `raw`.
 */
export const isAutolinkLiteral = (token: { type: string; raw: string; text?: string }) =>
  token.type === "link" && token.raw === token.text;

/**
 * Where a link marked would make starts: before the ":" of "://", the "." of "www." and the "@" of an
 * email. A backslash there ("https\://x.com", "www\.x.com", "me\@x.com") keeps marked from linking
 * the address, for a bare URL that would swallow the syntax right after it (marked reads it up to the
 * next space, "`code`" and "[links](u)" included). Splitting text here keeps the characters around
 * each split escaped as before: they are punctuation, which escaping looks at only for "_" and "*".
 */
export const LINK_START = /(?=:\/\/)|(?<=www)(?=\.)|(?=@)/;
