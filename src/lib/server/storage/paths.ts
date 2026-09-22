import type { Stats } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { NOTE_EXT } from "@/lib/constants";
import { isSafeSegment } from "@/lib/names";
import type { NoteRef } from "@/lib/types";
import { StorageError } from "./errors";
import { errorCode, lstatOrNull } from "./fs-utils";

export const folderNotFound = () => new StorageError("not_found", "Folder not found.");
export const noteNotFound = () => new StorageError("not_found", "Note not found.");

/**
 * Names the app lists and touches. Hidden entries, unsafe names and names that weren't valid UTF-8 on
 * disk (Node decodes those to U+FFFD, so they can't be addressed reliably) are ignored.
 */
export const isVisibleName = (name: string) => isSafeSegment(name) && !name.includes("\uFFFD");

/** "Plan.md" → "Plan". Null for anything that isn't a visible note file name (only lowercase ".md"). */
export function noteStem(fileName: string): string | null {
  if (!fileName.endsWith(NOTE_EXT)) return null;
  const stem = fileName.slice(0, -NOTE_EXT.length);
  return isVisibleName(stem) && isSafeSegment(fileName) ? stem : null;
}

/**
 * Joins name segments under `base`, rejecting anything that could escape it ("..", separators, NUL,
 * hidden names like ".trash"). Unsafe input is reported as not_found so probing reveals nothing.
 */
export function safeJoin(base: string, ...segments: string[]): string {
  if (!segments.every(isSafeSegment)) throw new StorageError("not_found", "Not found.");
  const joined = path.join(base, ...segments);
  const rel = path.relative(base, joined);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new StorageError("not_found", "Not found.");
  return joined;
}

/** Entry names in a directory; empty if the directory doesn't exist. */
export async function readNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return [];
    throw err;
  }
}

/** Exact match first; otherwise the single candidate whose NFC form matches (NFD names from HFS+/rsync). */
function pickName(candidates: string[], wanted: string): string | null {
  if (candidates.includes(wanted)) return wanted;
  const nfc = wanted.normalize("NFC");
  const matches = candidates.filter((c) => c.normalize("NFC") === nfc);
  return matches.length === 1 ? matches[0] : null;
}

/** An existing entry, with its exact on-disk name. */
export type Resolved = { name: string; path: string; stats: Stats };

/** Finds an existing, real (non-symlink) folder. Missing → not_found. */
export async function resolveFolder(dataDir: string, folder: string): Promise<Resolved> {
  safeJoin(dataDir, folder);
  const name = pickName((await readNames(dataDir)).filter(isVisibleName), folder);
  if (!name) throw folderNotFound();
  const p = safeJoin(dataDir, name);
  const stats = await lstatOrNull(p);
  if (!stats?.isDirectory()) throw folderNotFound();
  return { name, path: p, stats };
}

/**
 * Looks up a note's file inside an already-resolved folder. Returns null only when nothing by that name
 * exists; returns the entry even if it is a symlink or directory so callers can refuse to touch it.
 */
export async function lookupNote(folderPath: string, name: string): Promise<Resolved | null> {
  safeJoin(folderPath, name + NOTE_EXT);
  const stems = (await readNames(folderPath)).map(noteStem).filter((s): s is string => s !== null);
  const stem = pickName(stems, name);
  if (!stem) return null;
  const p = safeJoin(folderPath, stem + NOTE_EXT);
  const stats = await lstatOrNull(p);
  return stats ? { name: stem, path: p, stats } : null;
}

/** Finds an existing note that is a regular file (symlinks are never followed). Missing → not_found. */
export async function resolveNote(
  dataDir: string,
  ref: NoteRef,
): Promise<{ folder: Resolved; note: Resolved }> {
  const folder = await resolveFolder(dataDir, ref.folder);
  const note = await lookupNote(folder.path, ref.name);
  if (!note?.stats.isFile()) throw noteNotFound();
  return { folder, note };
}
