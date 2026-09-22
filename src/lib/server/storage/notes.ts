import type { Stats } from "node:fs";
import { createReadStream } from "node:fs";
import { lstat, readFile, unlink } from "node:fs/promises";
import { MAX_NOTE_BYTES, NOTE_EXT, UNTITLED } from "@/lib/constants";
import { nameKey, uniqueName, validateName } from "@/lib/names";
import type { Note, NoteRef, NoteSummary, SavedNote } from "@/lib/types";
import { getDataDir } from "./config";
import { StorageError } from "./errors";
import { atomicWrite, mapFsError, renameCaseOnly, renameNoClobber } from "./fs-utils";
import { listTree, toSummary } from "./folders";
import { withWriteLock } from "./mutex";
import {
  lookupNote,
  noteNotFound,
  readNames,
  type Resolved,
  resolveFolder,
  resolveNote,
  safeJoin,
} from "./paths";
import { decode, encode, type Eol, toLf, versionOf, versionOfStream } from "./text";
import { moveToTrash } from "./trash";

const tooLarge = () => new StorageError("too_large", "This note is larger than 5 MB, the maximum note size.");

/** The editor's view of a note file: decoded text plus the version the next save must be based on. */
function noteFromBytes(folder: string, name: string, stats: Stats, bytes: Uint8Array): Note {
  const { text, utf8Ok } = decode(bytes);
  return {
    ...toSummary(folder, name, stats),
    size: bytes.length,
    content: text,
    version: versionOf(bytes),
    readOnly: utf8Ok ? null : "not-utf8",
  };
}

async function loadNote(folder: string, note: Resolved): Promise<Note> {
  if (note.stats.size > MAX_NOTE_BYTES) {
    const version = await versionOfStream(createReadStream(note.path));
    return { ...toSummary(folder, note.name, note.stats), content: "", version, readOnly: "too-large" };
  }
  return noteFromBytes(folder, note.name, note.stats, await readFile(note.path));
}

/** Encodes in the file's original style and enforces the size cap. */
function encodeChecked(text: string, style: { eol: Eol; bom: boolean }): Buffer {
  const bytes = encode(text, style);
  if (bytes.length > MAX_NOTE_BYTES) throw tooLarge();
  return bytes;
}

function checkedNoteName(name: string): string {
  const check = validateName(name, "note");
  if (!check.ok) throw new StorageError("invalid_name", check.message);
  return check.name;
}

/** Stems of every *.md entry in a folder (any kind, any case of ".md"), for collision checks. */
async function takenNoteNames(folderPath: string, exceptFile?: string): Promise<string[]> {
  return (await readNames(folderPath))
    .filter((n) => n !== exceptFile && nameKey(n).endsWith(NOTE_EXT))
    .map((n) => n.slice(0, -NOTE_EXT.length));
}

/** Reads a note for the editor. Oversized or non-UTF-8 files come back read-only instead of failing. */
export async function readNote(ref: NoteRef): Promise<Note> {
  try {
    const { folder, note } = await resolveNote(getDataDir(), ref);
    return await loadNote(folder.name, note);
  } catch (err) {
    throw mapFsError(err, "Note not found.");
  }
}

/** Creates a note, auto-suffixing a taken name ("Untitled 2") so "New note" never fails on a collision. */
export async function createNote(input: { folder: string; name?: string; content?: string }): Promise<Note> {
  const name = input.name === undefined ? UNTITLED : checkedNoteName(input.name);
  const bytes = encodeChecked(toLf(input.content ?? ""), { eol: "lf", bom: false });
  return withWriteLock(async () => {
    try {
      const folder = await resolveFolder(getDataDir(), input.folder);
      const finalName = uniqueName(name, await takenNoteNames(folder.path));
      const file = safeJoin(folder.path, finalName + NOTE_EXT);
      await atomicWrite(file, bytes, { noClobber: true });
      return noteFromBytes(folder.name, finalName, await lstat(file), bytes);
    } catch (err) {
      throw mapFsError(err, "Folder not found.");
    }
  });
}

/**
 * Autosave target (spec §6.5). Refuses to overwrite a newer disk version unless `force`, never rewrites
 * identical bytes (so sync tools and mtimes don't churn), and keeps the file's EOL style and BOM.
 */
export async function saveNote(input: {
  ref: NoteRef;
  content: string;
  baseVersion: string | null;
  force?: boolean;
}): Promise<SavedNote> {
  const { ref, baseVersion, force = false } = input;
  const text = toLf(input.content);
  return withWriteLock(async () => {
    try {
      const folder = await resolveFolder(getDataDir(), ref.folder);
      const existing = await lookupNote(folder.path, ref.name);
      if (existing && !existing.stats.isFile()) throw noteNotFound();

      if (!existing) {
        if (!force) throw new StorageError("version_conflict", "This note no longer exists on disk.", null);
        const bytes = encodeChecked(text, { eol: "lf", bom: false });
        const file = safeJoin(folder.path, ref.name + NOTE_EXT);
        await atomicWrite(file, bytes, { noClobber: true });
        return { ...toSummary(folder.name, ref.name, await lstat(file)), version: versionOf(bytes) };
      }

      const current = await readFile(existing.path);
      const decoded = decode(current);
      const currentVersion = versionOf(current);
      const unchanged = {
        ...toSummary(folder.name, existing.name, existing.stats),
        size: current.length,
        version: currentVersion,
      };
      if (!force && current.length > MAX_NOTE_BYTES) {
        throw new StorageError("read_only", "This note is too large to edit here.");
      }
      if (!force && !decoded.utf8Ok) {
        throw new StorageError("read_only", "This file isn't valid UTF-8, so it can't be edited here.");
      }
      if (!force && baseVersion !== currentVersion) {
        if (decoded.text === text) return unchanged;
        const note = noteFromBytes(folder.name, existing.name, existing.stats, current);
        throw new StorageError("version_conflict", "This note changed on disk since you opened it.", note);
      }

      const bytes = encodeChecked(text, decoded);
      if (bytes.equals(current)) return unchanged;
      await atomicWrite(existing.path, bytes);
      return {
        ...toSummary(folder.name, existing.name, await lstat(existing.path)),
        version: versionOf(bytes),
      };
    } catch (err) {
      throw mapFsError(err, "Note not found.");
    }
  });
}

/** Renames and/or moves a note without ever overwriting another file. Case-only renames work. */
export async function updateNote(input: {
  ref: NoteRef;
  newName?: string;
  newFolder?: string;
}): Promise<NoteSummary> {
  const newName = input.newName === undefined ? undefined : checkedNoteName(input.newName);
  return withWriteLock(async () => {
    const dataDir = getDataDir();
    try {
      const { folder, note } = await resolveNote(dataDir, input.ref);
      const target = input.newFolder === undefined ? folder : await resolveFolder(dataDir, input.newFolder);
      const name = newName ?? note.name;
      const sameFolder = target.path === folder.path;
      if (sameFolder && name === note.name) return toSummary(folder.name, note.name, note.stats);

      const taken = await takenNoteNames(target.path, sameFolder ? note.name + NOTE_EXT : undefined);
      if (taken.some((t) => nameKey(t) === nameKey(name))) {
        throw new StorageError("name_taken", `A note named "${name}" already exists in ${target.name}.`);
      }
      const dest = safeJoin(target.path, name + NOTE_EXT);
      if (sameFolder && nameKey(name) === nameKey(note.name)) await renameCaseOnly(note.path, dest);
      else await renameNoClobber(note.path, dest);
      return toSummary(target.name, name, await lstat(dest));
    } catch (err) {
      throw mapFsError(err, "Note not found.");
    }
  });
}

/** Soft-deletes a note into .trash, keeping its folder name so it's easy to find and restore by hand. */
export async function deleteNote(ref: NoteRef): Promise<void> {
  return withWriteLock(async () => {
    const dataDir = getDataDir();
    try {
      const { folder, note } = await resolveNote(dataDir, ref);
      await moveToTrash(dataDir, note.path, [folder.name, note.name + NOTE_EXT]);
    } catch (err) {
      throw mapFsError(err, "Note not found.");
    }
  });
}

/**
 * Cleans up an abandoned "New note": permanently deletes it only if its text is whitespace-only (nothing
 * to lose, keeps .trash clean). Returns whether it deleted. Missing or non-empty notes are left alone.
 */
export async function discardIfEmpty(ref: NoteRef): Promise<boolean> {
  return withWriteLock(async () => {
    try {
      const { note } = await resolveNote(getDataDir(), ref);
      if (note.stats.size > MAX_NOTE_BYTES) return false;
      const { text, utf8Ok } = decode(await readFile(note.path));
      if (!utf8Ok || text.trim() !== "") return false;
      await unlink(note.path);
      return true;
    } catch (err) {
      const mapped = mapFsError(err, "Note not found.");
      if (mapped instanceof StorageError && mapped.code === "not_found") return false;
      throw mapped;
    }
  });
}

/** The exact bytes on disk, for downloads (no decoding, no EOL changes). */
export async function readNoteFile(ref: NoteRef): Promise<{ bytes: Uint8Array; mtime: Date }> {
  try {
    const { note } = await resolveNote(getDataDir(), ref);
    return { bytes: await readFile(note.path), mtime: note.stats.mtime };
  } catch (err) {
    throw mapFsError(err, "Note not found.");
  }
}

/** Where "/" lands: the most recently modified note in any folder, or null if there are none. */
export async function mostRecentNote(): Promise<NoteRef | null> {
  let best: NoteSummary | null = null;
  for (const folder of (await listTree()).folders) {
    for (const note of folder.notes) if (!best || note.updatedAt > best.updatedAt) best = note;
  }
  return best && { folder: best.folder, name: best.name };
}
