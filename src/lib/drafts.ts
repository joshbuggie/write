/**
 * Crash-safety drafts: the unsaved text of a note, kept in localStorage until the server confirms a save.
 * Storage can be missing, full, or throw (private mode, disabled cookies), so every access is guarded
 * and failures degrade to "no draft" rather than breaking the editor.
 */
import type { NoteRef } from "@/lib/types";

export type Draft = { content: string; baseVersion: string; savedAt: number };

const KEY_PREFIX = "write:draft:v1:";

/** JSON-encoded tuple, so folder/name pairs can never collide however they are spelled. */
const draftKey = (ref: NoteRef) => KEY_PREFIX + JSON.stringify([ref.folder, ref.name]);

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
  try {
    const raw = resolveStorage(storage)?.getItem(draftKey(ref));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Best effort: a full or unavailable storage silently keeps no draft. */
export function writeDraft(ref: NoteRef, draft: Draft, storage?: Storage): void {
  try {
    resolveStorage(storage)?.setItem(draftKey(ref), JSON.stringify(draft));
  } catch {
    // Quota exceeded or storage disabled: nothing else we can do on this device.
  }
}

export function clearDraft(ref: NoteRef, storage?: Storage): void {
  try {
    resolveStorage(storage)?.removeItem(draftKey(ref));
  } catch {
    // Storage unavailable: there is no draft to clear.
  }
}

/** Follows a rename or move so an unsaved draft stays attached to the note. */
export function moveDraft(from: NoteRef, to: NoteRef, storage?: Storage): void {
  if (draftKey(from) === draftKey(to)) return;
  const draft = readDraft(from, storage);
  if (!draft) return;
  writeDraft(to, draft, storage);
  clearDraft(from, storage);
}
