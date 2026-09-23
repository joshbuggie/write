/**
 * What this tab knows about each note's file, kept in memory for the life of the page.
 *
 * The App Router replays its cached RSC payload on back/forward, so a note screen can mount with props
 * that are older than what this tab saved moments ago. Opening the editor from those props would show
 * old text and base the next save on an old version: a false conflict, where "Keep mine" would then
 * overwrite the user's own newer save. So every save, fetch and page prop is recorded here, and the note
 * screen opens from the newest state this tab has seen.
 *
 * What this tab knows is kept over an incoming state only when BOTH are true:
 *
 * 1. The incoming state is strictly older by `updatedAt` (the file's mtime, from the server's clock).
 * 2. Its version is one this tab has already recorded for this file (`seen`): an earlier state it has
 *    since moved past, which is exactly what a replayed page or a fetch that raced a save looks like.
 *
 * Neither is enough alone. Versions are content hashes, so they repeat (an undo, two empty "Untitled"
 * notes) and can't order states by themselves. And an mtime is not a write order: a rename keeps the
 * file's mtime, and so do a restore from .trash and sync tools like Syncthing or `rsync -t`. So a version
 * this tab has never seen is new information and always wins, whatever its mtime; equal or newer states
 * always win too.
 *
 * Accepted limit: a file put back to an older version this tab has seen, with that version's old mtime
 * (say, restored by hand from .trash), looks exactly like a replay, so the tab keeps showing its newer
 * text. Nothing is lost: the next save gets a 409 and the conflict banner offers the disk version, and a
 * reload shows the file as it is.
 *
 * An entry describes one file. When that file goes away (deleted, discarded, renamed or moved, its folder
 * renamed or deleted) or a new note takes its name, the entry is forgotten, so the next note under that
 * name never opens with the old note's text.
 */
import type { EditorSnapshot } from "@/components/editor/note-editor";
import type { Note, NoteRef } from "@/lib/types";

/** A state of a note's file: its text, its version and its mtime (ISO 8601, from the server). */
export type DiskState = { content: string; version: string; updatedAt: string };
/** The newest state this tab knows for a file, and every version it has recorded for it (see above). */
export type KnownState = DiskState & { seen: ReadonlySet<string> };
type Entry = DiskState & { seen: Set<string>; savedHere: Set<string> };
/** What the editor under a note's new name takes over from the one that renamed it. */
export type Handover = { snapshot: EditorSnapshot; focus: boolean };

/** Plenty for one session's back/forward history; older notes simply fall back to their props. */
const MAX_ENTRIES = 50;

const entries = new Map<string, Entry>();
const moves = new Map<string, NoteRef>();
const handovers = new Map<string, Handover>();

const keyOf = (ref: NoteRef) => JSON.stringify([ref.folder, ref.name]);
const folderOfKey = (key: string) => (JSON.parse(key) as [string, string])[0];

/**
 * True only when `a` is strictly older than `b` (both ISO 8601 mtimes from the server). A timestamp that
 * can't be read is never "older", so a state with one always wins over what this tab knows.
 */
export function isStrictlyOlder(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return !Number.isNaN(ta) && !Number.isNaN(tb) && ta < tb;
}

/**
 * The state to keep: `incoming`, unless it is a version this tab has already seen for this file and it is
 * strictly older than what this tab knows (see the two conditions above).
 */
export function newerState(known: KnownState | undefined, incoming: DiskState): DiskState {
  if (!known || !known.seen.has(incoming.version)) return incoming;
  return isStrictlyOlder(incoming.updatedAt, known.updatedAt) ? known : incoming;
}

/**
 * Records a state of the file, unless this tab already knows a newer one (a fetch that raced a save,
 * props replayed from the router cache). `savedHere` marks the result of this tab's own successful save,
 * so a later 409 naming that version is recognized as this tab's text. This tab wrote that version, so it
 * is never news here: it is ordered by its mtime alone (a newer state from elsewhere may have come first).
 */
export function recordDiskState(ref: NoteRef, state: DiskState, opts: { savedHere?: boolean } = {}): void {
  const key = keyOf(ref);
  const entry = entries.get(key);
  const seen = entry?.seen ?? new Set<string>();
  const savedHere = entry?.savedHere ?? new Set<string>();
  if (opts.savedHere) {
    seen.add(state.version);
    savedHere.add(state.version);
  }
  const kept = newerState(entry, state);
  seen.add(state.version); // 16-character hashes, one per save: small enough to keep for the session
  const next: Entry = {
    content: kept.content,
    version: kept.version,
    updatedAt: kept.updatedAt,
    seen,
    savedHere,
  };
  entries.delete(key); // re-insert: the Map's order doubles as least-recently-used
  entries.set(key, next);
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

/** `note` with the newest content and version this tab knows for it (recording `note` itself first). */
export function latestKnown(note: Note): Note {
  recordDiskState(note, note);
  const entry = entries.get(keyOf(note))!;
  if (entry.version === note.version) return note;
  return { ...note, content: entry.content, version: entry.version, updatedAt: entry.updatedAt };
}

/** True when `version` came from a save made in this tab: a 409 naming it is not someone else's edit. */
export function isSavedHere(ref: NoteRef, version: string): boolean {
  return entries.get(keyOf(ref))?.savedHere.has(version) ?? false;
}

/**
 * The file at `ref` is gone (deleted, discarded, closed for good after a deletion elsewhere) or no longer
 * lives under this name: forget its state and any handover waiting for it.
 */
export function forgetNote(ref: NoteRef): void {
  entries.delete(keyOf(ref));
  handovers.delete(keyOf(ref));
}

/**
 * A folder was deleted, or renamed from or to this name: forget every note in it, and every rename
 * pointer that leads into it (the note it pointed to is no longer there).
 */
export function forgetFolder(folder: string): void {
  for (const map of [entries, handovers])
    for (const key of [...map.keys()]) if (folderOfKey(key) === folder) map.delete(key);
  for (const [key, to] of [...moves]) if (to.folder === folder) moves.delete(key);
}

/** A new note was just created at `ref`: nothing this tab knew about that name applies to it. */
export function noteCreated(ref: NoteRef): void {
  forgetNote(ref);
  forgetMove(ref);
}

/**
 * Remembers a rename or move, so a cached page of the old name can point to the new one. The file left
 * `from` and replaced whatever this tab knew at `to`, so what was known under both names is forgotten.
 */
export function recordMove(from: NoteRef, to: NoteRef): void {
  forgetNote(from);
  forgetNote(to);
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
 * A rename landed while the note stayed open. The page remounts under the new name, and its editor should
 * show exactly what the old one had (see EditorSnapshot) and, with `focus` (the user was writing in the
 * body), take the focus back at the same caret, whatever the pointer type. One-shot.
 */
export function expectHandover(to: NoteRef, handover: Handover): void {
  handovers.set(keyOf(to), handover);
}

/** The pending handover for this note (see expectHandover), consuming it; null if none. */
export function takeHandover(ref: NoteRef): Handover | null {
  const key = keyOf(ref);
  const handover = handovers.get(key) ?? null;
  handovers.delete(key);
  return handover;
}

/** True when `a` and `b` name the same file. */
export function isSameNote(a: NoteRef, b: NoteRef): boolean {
  return a.folder === b.folder && a.name === b.name;
}

/**
 * "Save as new note" after the file went away put this tab's text in a new file under the note's own name.
 * The note screen reopens on it at the same URL, while the page props still describe the old file. The
 * copy is recorded as this tab's save, and the old file's `replacedVersion` as a version it has seen and
 * moved past, so those props lose to the copy (see the two conditions above).
 */
export function noteRecreated(copy: Note, replacedVersion: string): void {
  noteCreated(copy);
  recordDiskState(copy, copy, { savedHere: true });
  entries.get(keyOf(copy))!.seen.add(replacedVersion);
}

/** Test helper: forget everything. */
export function resetKnownNotes(): void {
  entries.clear();
  moves.clear();
  handovers.clear();
}
