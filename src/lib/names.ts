import { MAX_NAME_BYTES, NOTE_EXT, UNTITLED } from "./constants";

export type NameKind = "note" | "folder";
export type NameProblem =
  "empty" | "too_long" | "invalid_char" | "control_char" | "leading_dot" | "trailing_dot" | "reserved";
export type NameCheck = { ok: true; name: string } | { ok: false; problem: NameProblem; message: string };

const FORBIDDEN = /[/\\:*?"<>|]/;
// C0/C1 controls, zero-width and bidi controls (blocks RLO spoofing), BOM.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const encoder = new TextEncoder();

export const NAME_MESSAGES: Record<NameProblem, string> = {
  empty: "Name can't be empty.",
  too_long: "Name is too long.",
  invalid_char: "Names can't contain / \\ : * ? \" < > |",
  control_char: "Name contains an invisible or control character.",
  leading_dot: "Names can't start with a dot.",
  trailing_dot: "Names can't end with a dot.",
  reserved: "That name is reserved on Windows.",
};

export const byteLength = (s: string) => encoder.encode(s).length;

/** NFC, collapse whitespace runs to one space, trim. For notes, strip one trailing ".md" (any case). */
export function normalizeName(input: string, kind: NameKind): string {
  let s = input.normalize("NFC").replace(/\s+/g, " ").trim();
  if (kind === "note" && s.toLowerCase().endsWith(NOTE_EXT)) s = s.slice(0, -NOTE_EXT.length).trim();
  return s;
}

/**
 * Strict, portable check for names the app is about to CREATE or RENAME TO.
 * Used live in the UI and authoritatively on the server. On success returns the normalized name.
 */
export function validateName(input: string, kind: NameKind): NameCheck {
  const name = normalizeName(input, kind);
  const fail = (problem: NameProblem): NameCheck => ({ ok: false, problem, message: NAME_MESSAGES[problem] });
  if (!name) return fail("empty");
  if (byteLength(name) > MAX_NAME_BYTES) return fail("too_long");
  if (CONTROL.test(name)) return fail("control_char");
  if (FORBIDDEN.test(name)) return fail("invalid_char");
  if (name.startsWith(".")) return fail("leading_dot");
  if (name.endsWith(".")) return fail("trailing_dot");
  if (RESERVED.test(name)) return fail("reserved");
  return { ok: true, name };
}

const FORBIDDEN_ALL = new RegExp(FORBIDDEN.source, "g");
const CONTROL_ALL = new RegExp(CONTROL.source, "g");
const RESERVED_STEM = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?=\.|$)/i;

/** Drop leading dots/whitespace and trailing dots/whitespace (hidden files, Windows trailing-dot rule). */
const trimDots = (s: string) => s.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");

/** Cut to at most `max` UTF-8 bytes without splitting a code point. */
function truncateBytes(s: string, max: number): string {
  let out = "";
  let bytes = 0;
  for (const ch of s) {
    bytes += byteLength(ch);
    if (bytes > max) break;
    out += ch;
  }
  return out;
}

/**
 * Best-effort conversion of an arbitrary external file name (e.g. an imported file) into a name that
 * passes validateName(…, kind), so imports never fail on naming. Guarantee:
 * validateName(toSafeName(x, k), k).ok === true for every string x.
 */
export function toSafeName(input: string, kind: NameKind): string {
  let s = normalizeName(input, kind).replace(FORBIDDEN_ALL, "-").replace(CONTROL_ALL, "-");
  s = trimDots(truncateBytes(trimDots(s), MAX_NAME_BYTES));
  // normalizeName may strip another ".md" and expose new trailing dots/spaces; settle that before checking.
  for (let i = 0; i < 3 && trimDots(normalizeName(s, kind)) !== s; i++) s = trimDots(normalizeName(s, kind));
  // "CON.txt" + "_" would still be reserved, so mark the device name itself: "CON_.txt".
  if (RESERVED.test(s)) s = s.replace(RESERVED_STEM, "$1_");
  const check = validateName(s, kind);
  return check.ok ? check.name : UNTITLED;
}

/**
 * Loose SAFETY check for EXISTING entries (possibly created by other tools, e.g. "a:b" on Linux).
 * Guards every filesystem access. Rejects empty, hidden (leading "."), "."/"..", separators, NUL, >255 bytes.
 */
export function isSafeSegment(s: string): boolean {
  return s.length > 0 && !s.startsWith(".") && !/[/\\\u0000]/.test(s) && byteLength(s) <= 255;
}

/** Collision identity. Two sibling names collide iff their keys are equal (on every OS). */
export const nameKey = (s: string) => s.normalize("NFC").toLowerCase();

/** `base` if free, else "base 2", "base 3", … (compared by nameKey). */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const keys = new Set(Array.from(taken, nameKey));
  if (!keys.has(nameKey(base))) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!keys.has(nameKey(candidate))) return candidate;
  }
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
/** Natural, case-insensitive order; ties broken by code unit order for determinism. */
export const compareNames = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
