import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, mapFsError, randomHex } from "./fs-utils";

/** Soft-delete root inside the data dir. Hidden, so it is never listed, exported or addressable via the API. */
export const TRASH_DIR = ".trash";

/** A fresh `.trash/<timestamp>-<hex>/<relPath>` path; its parent directories are created. */
async function newTrashPath(dataDir: string, relPath: string[]): Promise<string> {
  const stamp = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomHex(2)}`;
  const dest = path.join(dataDir, TRASH_DIR, stamp, ...relPath);
  await mkdir(path.dirname(dest), { recursive: true });
  return dest;
}

/**
 * Moves a note file or a whole folder to `.trash/<timestamp>-<hex>/<relPath>` so a delete is always
 * recoverable by hand. Nothing is purged automatically.
 */
export async function moveToTrash(dataDir: string, src: string, relPath: string[]): Promise<void> {
  try {
    await rename(src, await newTrashPath(dataDir, relPath));
  } catch (err) {
    throw mapFsError(err);
  }
}

/**
 * Stores a copy of bytes that are about to be overwritten (e.g. a conflict resolved with "Keep mine") in
 * the trash, durably, so the other version can still be recovered by hand.
 */
export async function copyToTrash(dataDir: string, bytes: Uint8Array, relPath: string[]): Promise<void> {
  try {
    await atomicWrite(await newTrashPath(dataDir, relPath), bytes, { noClobber: true });
  } catch (err) {
    throw mapFsError(err);
  }
}
