import { readFile } from "node:fs/promises";
import { zipSync, type Zippable } from "fflate";
import { NOTE_EXT } from "@/lib/constants";
import { uniqueName } from "@/lib/names";
import type { FolderSummary } from "@/lib/types";
import { getDataDir } from "./config";
import { StorageError } from "./errors";
import { errorCode, mapFsError } from "./fs-utils";
import { listFolderNotes, listTree } from "./folders";
import { resolveFolder, safeJoin } from "./paths";

// Zip timestamps are DOS dates; fflate throws outside 1980–2099, so clamp (with a day of margin for time zones).
const MIN_MTIME = new Date(1980, 0, 2).getTime();
const MAX_MTIME = new Date(2099, 11, 30).getTime();
const clampMtime = (ms: number) => new Date(Math.min(MAX_MTIME, Math.max(MIN_MTIME, ms)));

/**
 * A note's bytes, or null if it was deleted or moved while zipping. Any other failure stops the download:
 * a backup that silently leaves notes out looks complete when it isn't.
 */
async function readForZip(file: string, label: string): Promise<Uint8Array | null> {
  try {
    return await readFile(file);
  } catch (err) {
    const code = errorCode(err);
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    if (code === "EACCES" || code === "EPERM") {
      throw new StorageError(
        "storage_unavailable",
        `Couldn't read “${label}” (permission denied), so nothing was downloaded.`,
      );
    }
    throw err; // EIO and friends: a 500, logged server-side (docs/design-decisions.md#d3)
  }
}

/**
 * Zip entries for one folder: every visible note as "<name>.md" with its real mtime. Names are NFC so the
 * archive unzips the same everywhere; two names that would clash after that get a " 2" suffix instead of
 * silently overwriting each other. An empty folder still becomes a directory entry.
 */
async function folderEntries(dataDir: string, folder: FolderSummary): Promise<Zippable> {
  const entries: Zippable = {};
  const used: string[] = [];
  for (const note of folder.notes) {
    const file = safeJoin(dataDir, folder.name, note.name + NOTE_EXT);
    const bytes = await readForZip(file, `${folder.name}/${note.name}${NOTE_EXT}`);
    if (!bytes) continue;
    const name = uniqueName(note.name.normalize("NFC"), used);
    used.push(name);
    entries[name + NOTE_EXT] = [bytes, { mtime: clampMtime(Date.parse(note.updatedAt)) }];
  }
  return entries;
}

/** Server-local date as YYYY-MM-DD, for archive names. */
function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Everything the sidebar shows, under one root dir: "write-notes-YYYY-MM-DD/<folder>/<name>.md". */
export async function zipAll(): Promise<{ bytes: Uint8Array; filename: string }> {
  const dataDir = getDataDir();
  const root = `write-notes-${localDate()}`;
  // No prototype: on a plain object, `folders["__proto__"] = …` would replace the prototype, and fflate's
  // for…in would then put that folder's notes at the archive root.
  const folders: Zippable = Object.create(null);
  for (const folder of (await listTree()).folders) {
    const name = uniqueName(folder.name.normalize("NFC"), Object.keys(folders));
    folders[name] = await folderEntries(dataDir, folder);
  }
  return { bytes: zipSync({ [root]: folders }, { level: 6 }), filename: `${root}.zip` };
}

/** One folder as "<folder>.zip" with entries under "<folder>/". Missing folder → not_found. */
export async function zipFolder(name: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const dataDir = getDataDir();
  try {
    const folder = await resolveFolder(dataDir, name);
    const summary = { name: folder.name, notes: await listFolderNotes(folder.path, folder.name) };
    const root = folder.name.normalize("NFC");
    const bytes = zipSync({ [root]: await folderEntries(dataDir, summary) }, { level: 6 });
    return { bytes, filename: `${root}.zip` };
  } catch (err) {
    throw mapFsError(err, "Folder not found.");
  }
}
