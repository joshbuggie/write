/**
 * Crash-safety drafts: the unsaved text of a note, kept in localStorage until the server confirms a save.
 * Storage can be missing, full, or throw (private mode, disabled cookies), so every access is guarded
 * and failures degrade to "no draft" rather than breaking the editor.
 */
import type { NoteRef } from "@/lib/types";

export type Draft = { content: string; baseVersion: string; savedAt: number };

const KEY_PREFIX = "write:draft:v1:";
/**
 * A draft found at open that is based on an older version of the file waits here until the user picks a
 * conflict-banner option. Autosave writes and clears the regular key on every save, so a pending choice
 * kept there would be erased by the next keystroke.
 */
const CONFLICT_KEY_PREFIX = "write:draft-conflict:v1:";

/** JSON-encoded tuple, so folder/name pairs can never collide however they are spelled. */
const draftKey = (ref: NoteRef, prefix = KEY_PREFIX) => prefix + JSON.stringify([ref.folder, ref.name]);

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // Accessing localStorage itself throws when site data is blocked.
  }
}

function isDraft(value: unknown): value is Draft {
  const d = value as Partial<Draft> | null;
  return (
    typeof d === "object" &&
    d !== null &&
    typeof d.content === "string" &&
    typeof d.baseVersion === "string" &&
    typeof d.savedAt === "number"
  );
}

/** The saved draft for a note, or null if there is none (or it is unreadable). */
export function readDraft(ref: NoteRef, storage?: Storage): Draft | null {
  return readKey(draftKey(ref), storage);
}

function readKey(key: string, storage?: Storage): Draft | null {
  try {
    const raw = resolveStorage(storage)?.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Best effort: a full or unavailable storage silently keeps no draft. */
export function writeDraft(ref: NoteRef, draft: Draft, storage?: Storage): void {
  writeKey(draftKey(ref), draft, storage);
}

function writeKey(key: string, draft: Draft, storage?: Storage): void {
  try {
    resolveStorage(storage)?.setItem(key, JSON.stringify(draft));
  } catch {
    // Quota exceeded or storage disabled: nothing else we can do on this device.
  }
}

/** Drops the regular draft once the server has the text (or the user discarded it). */
export function clearDraft(ref: NoteRef, storage?: Storage): void {
  clearKey(draftKey(ref), storage);
}

function clearKey(key: string, storage?: Storage): void {
  try {
    resolveStorage(storage)?.removeItem(key);
  } catch {
    // Storage unavailable: there is no draft to clear.
  }
}

/**
 * What to do with a draft found when a note opens: drop it when the file already has that text, restore
 * it when it was written on top of the version on disk, or ask the user when the file has moved on since.
 * `baseline` is the file as the opened editor serializes it.
 */
export function draftAction(
  draft: Draft,
  disk: { content: string; baseline: string; version: string },
): "drop" | "restore" | "conflict" {
  if (draft.content === disk.content || draft.content === disk.baseline) return "drop";
  return draft.baseVersion === disk.version ? "restore" : "conflict";
}

/** The draft waiting on a conflict-banner choice (see CONFLICT_KEY_PREFIX), or null. */
export function readDraftConflict(ref: NoteRef, storage?: Storage): Draft | null {
  return readKey(draftKey(ref, CONFLICT_KEY_PREFIX), storage);
}

/** Parks a draft based on an older version until the user resolves it; autosave never touches it. */
export function writeDraftConflict(ref: NoteRef, draft: Draft, storage?: Storage): void {
  writeKey(draftKey(ref, CONFLICT_KEY_PREFIX), draft, storage);
}

/**
 * The pending draft was resolved: a conflict-banner choice, or on open it matched the file. A note that
 * goes away uses forgetDrafts instead.
 */
export function clearDraftConflict(ref: NoteRef, storage?: Storage): void {
  clearKey(draftKey(ref, CONFLICT_KEY_PREFIX), storage);
}

/**
 * The note is gone (deleted, discarded, closed for good) or its drafts already moved to its new name:
 * drop both its regular draft and any pending draft conflict. A parked conflict left behind would show
 * the conflict banner on the next note created with the same name (often "Untitled"), and "Keep mine"
 * would replace that new note with the old note's text.
 */
export function forgetDrafts(ref: NoteRef, storage?: Storage): void {
  clearDraft(ref, storage);
  clearDraftConflict(ref, storage);
}

/** A folder was deleted: forget the drafts of every note that was in it (see forgetDrafts). */
export function forgetFolderDrafts(folder: string, storage?: Storage): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
    for (const key of keys) {
      const ref = refOfKey(key);
      if (ref?.folder === folder) forgetDrafts(ref, store);
    }
  } catch {
    // Storage unavailable: there are no drafts to forget.
  }
}

/** The note a draft key belongs to, or null for keys that aren't drafts. */
function refOfKey(key: string | null): NoteRef | null {
  const prefix = [KEY_PREFIX, CONFLICT_KEY_PREFIX].find((p) => key?.startsWith(p));
  if (!key || !prefix) return null;
  try {
    const parsed: unknown = JSON.parse(key.slice(prefix.length));
    if (!Array.isArray(parsed) || typeof parsed[0] !== "string" || typeof parsed[1] !== "string") return null;
    return { folder: parsed[0], name: parsed[1] };
  } catch {
    return null;
  }
}

/** Follows a rename or move so unsaved drafts (regular and pending-conflict) stay attached to the note. */
export function moveDraft(from: NoteRef, to: NoteRef, storage?: Storage): void {
  for (const prefix of [KEY_PREFIX, CONFLICT_KEY_PREFIX]) {
    const [fromKey, toKey] = [draftKey(from, prefix), draftKey(to, prefix)];
    if (fromKey === toKey) continue;
    const draft = readKey(fromKey, storage);
    if (!draft) continue;
    writeKey(toKey, draft, storage);
    clearKey(fromKey, storage);
  }
}
