import type { Stats } from "node:fs";
import { lstat, mkdir, readdir, rename } from "node:fs/promises";
import { compareNames, nameKey, validateName } from "@/lib/names";
import type { FolderSummary, NoteSummary, Tree } from "@/lib/types";
import { getDataDir } from "./config";
import { StorageError } from "./errors";
import { errorCode, exists, mapFsError, renameCaseOnly } from "./fs-utils";
import { dropFolderScope, followFolderRename } from "./integrations";
import { jobsFollowNote } from "./jobs";
import { orphanProposals, proposalsFollowFolder } from "./proposals";
import { withWriteLock } from "./mutex";
import { isVisibleName, noteStem, readNames, resolveFolder, safeJoin } from "./paths";
import { moveToTrash } from "./trash";

/** Builds the list-row view of a note from its lstat. */
export const toSummary = (folder: string, name: string, stats: Stats): NoteSummary => ({
  folder,
  name,
  updatedAt: stats.mtime.toISOString(),
  size: stats.size,
});

/** Visible notes (regular *.md files, never symlinks) directly inside a folder, sorted by name. */
export async function listFolderNotes(folderPath: string, folder: string): Promise<NoteSummary[]> {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const notes = await Promise.all(
    entries.map(async (entry) => {
      const name = entry.isFile() ? noteStem(entry.name) : null;
      if (name === null) return null;
      try {
        return toSummary(folder, name, await lstat(safeJoin(folderPath, entry.name)));
      } catch {
        return null; // deleted between readdir and lstat
      }
    }),
  );
  return notes.filter((n): n is NoteSummary => n !== null).sort((a, b) => compareNames(a.name, b.name));
}

/**
 * Every visible folder (real directories, not symlinks) with its notes. Anything else in the data dir is
 * ignored and never touched. A missing data dir reads as empty (bootstrap creates it).
 */
export async function listTree(): Promise<Tree> {
  const dataDir = getDataDir();
  try {
    const entries = await readdir(dataDir, { withFileTypes: true });
    const folders = entries.filter((e) => e.isDirectory() && isVisibleName(e.name));
    const summaries = await Promise.all(
      folders.map(async (e) => ({
        name: e.name,
        notes: await listFolderNotes(safeJoin(dataDir, e.name), e.name),
      })),
    );
    return { folders: summaries.sort((a, b) => compareNames(a.name, b.name)) };
  } catch (err) {
    if (errorCode(err) === "ENOENT") return { folders: [] };
    throw mapFsError(err);
  }
}

function checkedFolderName(name: string): string {
  const check = validateName(name, "folder");
  if (!check.ok) throw new StorageError("invalid_name", check.message);
  return check.name;
}

/** Rejects `name` if any other root entry (of any kind) collides with it on a case-insensitive OS. */
async function assertFolderNameFree(dataDir: string, name: string, self?: string) {
  const key = nameKey(name);
  const clash = (await readNames(dataDir)).some((n) => n !== self && nameKey(n) === key);
  if (clash) throw new StorageError("name_taken", `A folder named "${name}" already exists.`);
}

/** Creates an empty folder. The name must pass the strict portable rules; collisions are name_taken. */
export async function createFolder(name: string): Promise<FolderSummary> {
  const folder = checkedFolderName(name);
  return withWriteLock(async () => {
    const dataDir = getDataDir();
    try {
      await mkdir(dataDir, { recursive: true });
      await assertFolderNameFree(dataDir, folder);
      await mkdir(safeJoin(dataDir, folder));
    } catch (err) {
      if (errorCode(err) === "EEXIST")
        throw new StorageError("name_taken", `A folder named "${folder}" already exists.`);
      throw mapFsError(err);
    }
    return { name: folder, notes: [] };
  });
}

/**
 * Renames a folder and everything in it (including files the app ignores). Case-only renames work.
 * Integrations that could read it keep reading it under the new name (docs/design-decisions.md#d31).
 */
export async function renameFolder(name: string, newName: string): Promise<FolderSummary> {
  const target = checkedFolderName(newName);
  return withWriteLock(async () => {
    const dataDir = getDataDir();
    try {
      const current = await resolveFolder(dataDir, name);
      const dest = safeJoin(dataDir, target);
      if (current.name !== target) {
        await assertFolderNameFree(dataDir, target, current.name);
        if (nameKey(current.name) === nameKey(target)) {
          await renameCaseOnly(current.path, dest);
        } else {
          if (await exists(dest))
            throw new StorageError("name_taken", `A folder named "${target}" already exists.`);
          await rename(current.path, dest);
        }
        await followFolderRename(current.name, target);
        await proposalsFollowFolder(current.name, target);
        const from = current.name.normalize("NFC");
        await jobsFollowNote((n) => (n.folder.normalize("NFC") === from ? { ...n, folder: target } : null));
      }
      return { name: target, notes: await listFolderNotes(dest, target) };
    } catch (err) {
      throw mapFsError(err, "Folder not found.");
    }
  });
}

/**
 * Soft-deletes a folder with all its contents into .trash. Bootstrap recreates "notebook" if it was the last.
 * The folder leaves every integration's list (docs/design-decisions.md#d31).
 */
export async function deleteFolder(name: string): Promise<void> {
  return withWriteLock(async () => {
    const dataDir = getDataDir();
    try {
      const folder = await resolveFolder(dataDir, name);
      await moveToTrash(dataDir, folder.path, [folder.name]);
      await dropFolderScope(folder.name);
      await orphanProposals((p) => p.folder.normalize("NFC") === folder.name.normalize("NFC"));
    } catch (err) {
      throw mapFsError(err, "Folder not found.");
    }
  });
}
