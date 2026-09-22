import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { mapFsError, randomHex } from "./fs-utils";

/** Soft-delete root inside the data dir. Hidden, so it is never listed, exported or addressable via the API. */
export const TRASH_DIR = ".trash";

/**
 * Moves a note file or a whole folder to `.trash/<timestamp>-<hex>/<relPath>` so a delete is always
 * recoverable by hand. Nothing is purged automatically.
 */
export async function moveToTrash(dataDir: string, src: string, relPath: string[]): Promise<void> {
  const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomHex(2)}`;
  const dest = path.join(dataDir, TRASH_DIR, stamp, ...relPath);
  try {
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(src, dest);
  } catch (err) {
    throw mapFsError(err);
  }
}
