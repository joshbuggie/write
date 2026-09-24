/**
 * The note versions integrations have read, kept in memory (docs/design-decisions.md#d31). A harness
 * proposes against the version it read, and while it works the owner may keep editing, so the server
 * needs that version's text to tell the harness's changes from the owner's. Remembering it here means the
 * harness only sends the version back, not the whole text it read. After a restart, a proposal whose note
 * has also changed since is refused with a 409 that says to read the note again.
 */

/** Enough for several long runs at once, and bounded so a busy harness can't fill the server's memory. */
const MAX_ENTRIES = 64;
const MAX_CHARS = 32 * 1024 * 1024;

const store = globalThis as typeof globalThis & { __writeProposalBases?: Map<string, string> };
const bases = (store.__writeProposalBases ??= new Map<string, string>());

/** Remembers the text of a version an integration just read. The oldest go first once full. */
export function rememberBase(version: string, content: string): void {
  bases.delete(version); // re-insert: the Map's order doubles as least-recently-used
  bases.set(version, content);
  let total = 0;
  for (const text of bases.values()) total += text.length;
  for (const [key, text] of bases) {
    if (bases.size <= MAX_ENTRIES && total <= MAX_CHARS) break;
    bases.delete(key);
    total -= text.length;
  }
}

/** The text of a version an integration read, if it is still remembered. */
export function baseFor(version: string): string | null {
  return bases.get(version) ?? null;
}

/** Forgets every remembered version. Tests only. */
export function resetProposalBases(): void {
  bases.clear();
}
