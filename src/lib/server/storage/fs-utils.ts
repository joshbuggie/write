import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { link, lstat, open, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./config";
import { StorageError } from "./errors";

/** Node fs errors carry a POSIX code such as "ENOENT". */
export const errorCode = (err: unknown): string | undefined =>
  err instanceof Error && "code" in err && typeof err.code === "string" ? err.code : undefined;

/** Random hex for temp/trash names (collision-free enough for one process). */
export const randomHex = (bytes: number) => randomBytes(bytes).toString("hex");

/** The message users see when the data dir isn't writable, most often a Docker volume owned by root. */
export function unwritableMessage(): string {
  let dir = "the data folder";
  try {
    dir = getDataDir();
  } catch {
    /* keep the generic wording */
  }
  return `Cannot write to ${dir}. In Docker, make sure the volume is writable by uid 1000 (e.g. \`sudo chown -R 1000:1000 ./data\`).`;
}

/**
 * Translates fs errors into StorageErrors the HTTP layer can show. Unknown errors pass through unchanged
 * (they become a 500 with the details logged server-side).
 */
export function mapFsError(err: unknown, notFoundMessage = "Not found."): unknown {
  if (err instanceof StorageError) return err;
  const code = errorCode(err);
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return new StorageError("storage_unavailable", unwritableMessage());
  }
  if (code === "ENOSPC") return new StorageError("storage_unavailable", "Disk is full.");
  if (code === "ENOENT") return new StorageError("not_found", notFoundMessage);
  return err;
}

/** lstat that returns null for a missing path (never follows symlinks). */
export async function lstatOrNull(p: string): Promise<Stats | null> {
  try {
    return await lstat(p);
  } catch (err) {
    if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return null;
    throw err;
  }
}

export const exists = async (p: string) => (await lstatOrNull(p)) !== null;

/** Options for atomicWrite; the defaults suit notes. */
export interface AtomicWriteOptions {
  /** Refuse to replace an existing entry (name_taken) instead of overwriting it. */
  noClobber?: boolean;
  /** Permissions for the file, even if it exists with others (0o600 for secrets). Default: keep them. */
  mode?: number;
  /** How to translate an fs error. Default: mapFsError, whose messages name the data folder. */
  mapError?: (err: unknown) => unknown;
}

/**
 * Crash-safe write: temp file in the same directory → fsync → rename over the target, so readers and
 * sync tools never see a half-written note. Keeps the existing file's permissions unless `mode` is given.
 * With `noClobber`, the final step refuses to replace an existing entry (name_taken) instead of
 * overwriting it.
 */
export async function atomicWrite(file: string, bytes: Uint8Array, opts: AtomicWriteOptions = {}) {
  const tmp = path.join(path.dirname(file), `.write-${randomHex(8)}.tmp`);
  try {
    const existing = opts.mode === undefined ? await lstatOrNull(file) : null;
    const fh = await open(tmp, "wx", opts.mode ?? (existing?.isFile() ? existing.mode & 0o777 : 0o644));
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (opts.noClobber) await renameNoClobber(tmp, file);
    else await rename(tmp, file);
    await syncDir(path.dirname(file));
  } catch (err) {
    await rm(tmp, { force: true });
    throw opts.mapError ? opts.mapError(err) : mapFsError(err, "Folder not found.");
  }
}

/** Best effort: persist the rename itself. Some platforms can't fsync a directory; the data is safe anyway. */
async function syncDir(dir: string) {
  try {
    const fh = await open(dir, "r");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    /* EISDIR / EPERM / EINVAL on some filesystems: ignore */
  }
}

const NO_HARDLINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV", "EMLINK"]);

/**
 * Renames a FILE without ever replacing an existing one: link(src, dst) fails atomically with EEXIST.
 * Filesystems without hard links fall back to check-then-rename (safe because callers hold the write lock).
 */
export async function renameNoClobber(src: string, dst: string) {
  try {
    await link(src, dst);
  } catch (err) {
    const code = errorCode(err);
    if (code === "EEXIST") throw new StorageError("name_taken", "That name is already taken.");
    if (!code || !NO_HARDLINKS.has(code)) throw err;
    if (await exists(dst)) throw new StorageError("name_taken", "That name is already taken.");
    await rename(src, dst);
    return;
  }
  await unlink(src);
}

/**
 * Renames a file or directory to a name that differs only in case or Unicode normalization. On
 * case-insensitive filesystems (APFS, NTFS) src and dst are the "same" entry, so go through a temp name.
 * A crash between the two steps leaves the entry at the temp name; cleanup.ts gives it back to the user.
 */
export async function renameCaseOnly(src: string, dst: string) {
  const tmp = path.join(path.dirname(src), `.write-rename-${randomHex(4)}`);
  await rename(src, tmp);
  await rename(tmp, dst);
}
