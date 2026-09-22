/**
 * What this tab knows about each note's file, kept in memory for the life of the page.
 *
 * The App Router replays its cached RSC payload on back/forward, so a note screen can mount with props
 * that are older than what this tab saved moments ago. Opening the editor from those props would show
 * old text and base the next save on an old version: a false conflict, where "Keep mine" would then
 * overwrite the user's own newer save. So every save, fetch and page prop is recorded here, and the note
 * screen opens from the newest state this tab has seen.
 *
 * Versions are content hashes with no order, so "newer" is decided by history: a version this tab has
 * already seen replaced is stale when it shows up again in props or a fetch. The one exception is a
 * successful save, which is always the newest state (undoing back to the original text legitimately
 * brings an old hash back).
 */
import type { Note, NoteRef } from "@/lib/types";

type DiskState = { content: string; version: string };
type Entry = DiskState & { seen: Set<string>; savedHere: Set<string> };

/** Plenty for one session's back/forward history; older notes simply fall back to their props. */
const MAX_ENTRIES = 50;

const entries = new Map<string, Entry>();
const moves = new Map<string, NoteRef>();
const handovers = new Map<string, number>();

const keyOf = (ref: NoteRef) => JSON.stringify([ref.folder, ref.name]);

/**
 * Records a state of the file. `savedHere` marks the result of this tab's own successful save, which
 * always wins; anything else is ignored when it is a version this tab has already seen replaced.
 */
export function recordDiskState(ref: NoteRef, state: DiskState, opts: { savedHere?: boolean } = {}): void {
  const key = keyOf(ref);
  const entry = entries.get(key);
  if (!opts.savedHere && entry && entry.version !== state.version && entry.seen.has(state.version)) return;
  const next: Entry = {
    content: state.content,
    version: state.version,
    seen: entry?.seen ?? new Set(),
    savedHere: entry?.savedHere ?? new Set(),
  };
  next.seen.add(state.version);
  if (opts.savedHere) next.savedHere.add(state.version);
  entries.delete(key); // re-insert: the Map's order doubles as least-recently-used
  entries.set(key, next);
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

/** `note` with the newest content and version this tab knows for it (recording `note` itself first). */
export function latestKnown(note: Note): Note {
  recordDiskState(note, note);
  const entry = entries.get(keyOf(note))!;
  return entry.version === note.version ? note : { ...note, content: entry.content, version: entry.version };
}

/** True when `version` came from a save made in this tab: a 409 naming it is not someone else's edit. */
export function isSavedHere(ref: NoteRef, version: string): boolean {
  return entries.get(keyOf(ref))?.savedHere.has(version) ?? false;
}

/** Remembers a rename or move, so a cached page of the old name can point to the new one. */
export function recordMove(from: NoteRef, to: NoteRef): void {
  moves.delete(keyOf(to)); // a note lives there now
  moves.set(keyOf(from), to);
}

/** Where this tab moved the note, if it did. */
export function movedTo(ref: NoteRef): NoteRef | null {
  return moves.get(keyOf(ref)) ?? null;
}

/** The name exists on disk again (a new note took it), so it no longer points elsewhere. */
export function forgetMove(ref: NoteRef): void {
  moves.delete(keyOf(ref));
}

/**
 * A rename landed while the user was writing in the body. The page remounts under the new name, and its
 * editor should take the focus back at `caret`, whatever the pointer type. One-shot.
 */
export function expectHandover(to: NoteRef, caret: number): void {
  handovers.set(keyOf(to), caret);
}

/** The caret of a pending handover for this note (see expectHandover), consuming it; null if none. */
export function takeHandover(ref: NoteRef): number | null {
  const key = keyOf(ref);
  const caret = handovers.get(key) ?? null;
  handovers.delete(key);
  return caret;
}

/** Test helper: forget everything. */
export function resetKnownNotes(): void {
  entries.clear();
  moves.clear();
  handovers.clear();
}
