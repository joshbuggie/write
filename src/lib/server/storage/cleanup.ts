import { readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { NOTE_EXT } from "@/lib/constants";
import { nameKey, uniqueName } from "@/lib/names";
import { renameNoClobber } from "./fs-utils";
import { isVisibleName, readNames, safeJoin } from "./paths";
import { moveToTrash } from "./trash";

/** Leftovers of an interrupted atomicWrite: only ever a partial copy, so safe to delete once old. */
const STALE_TEMP = /^\.write-.+\.tmp$/;
/** Leftover of a case-only rename interrupted between its two steps: the ONLY copy of a note or folder. */
const STRANDED_RENAME = /^\.write-rename-[0-9a-f]+$/;
/** Temp files younger than this may still be in use by a write in progress. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Gives a stranded case-only rename back to the user under a visible name ("Recovered note" in its
 * folder, "Recovered folder" in the data dir), since the original name is unknown. Anything of an
 * unexpected kind goes to .trash instead. Never deletes.
 */
async function recoverStrandedRename(dataDir: string, dir: string, name: string, isDir: boolean) {
  const src = path.join(dir, name);
  const names = await readNames(dir);
  const inRoot = dir === dataDir;
  let recovered: string;
  if (inRoot && isDir) {
    recovered = uniqueName("Recovered folder", names);
    await rename(src, safeJoin(dir, recovered)); // free name + write lock held: nothing gets replaced
  } else if (!inRoot && !isDir) {
    const stems = names.filter((n) => nameKey(n).endsWith(NOTE_EXT)).map((n) => n.slice(0, -NOTE_EXT.length));
    recovered = uniqueName("Recovered note", stems) + NOTE_EXT;
    await renameNoClobber(src, safeJoin(dir, recovered));
  } else {
    recovered = ".trash";
    await moveToTrash(dataDir, src, inRoot ? [name] : [path.basename(dir), name]);
  }
  console.warn(`[write] Recovered an interrupted rename: ${path.relative(dataDir, src)} → ${recovered}`);
}

/**
 * Crash cleanup for the data dir and its visible folders: deletes partial writes older than an hour and
 * recovers stranded case-only renames (whatever their age, because rename keeps the old mtime). The
 * caller must hold the write lock, so no rename or write is in flight. A failure on one entry is logged
 * and never blocks loading the tree.
 */
export async function removeStaleTemps(dataDir: string, now = Date.now()): Promise<void> {
  const entries = await readdir(dataDir, { withFileTypes: true });
  const dirs = [
    dataDir,
    ...entries.filter((e) => e.isDirectory() && isVisibleName(e.name)).map((e) => path.join(dataDir, e.name)),
  ];
  for (const dir of dirs) {
    for (const name of await readNames(dir)) {
      const isTemp = STALE_TEMP.test(name);
      if (!isTemp && !STRANDED_RENAME.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const info = await stat(file);
        if (!isTemp) await recoverStrandedRename(dataDir, dir, name, info.isDirectory());
        else if (info.isFile() && now - info.mtimeMs > STALE_AFTER_MS) await rm(file, { force: true });
      } catch (err) {
        console.error(`[write] Couldn't clean up ${path.relative(dataDir, file)}:`, err);
      }
    }
  }
}
