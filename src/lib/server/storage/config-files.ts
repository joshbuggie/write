import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { StorageError } from "./errors";
import { atomicWrite, errorCode } from "./fs-utils";

/**
 * Reading and writing the small files in the config folder (account.json, settings.json,
 * integrations.json). They hold secrets, so the folder is created owner-only and every file is written 0600
 * (docs/design-decisions.md#d28).
 */

/** fs errors for the config folder. mapFsError's messages name the data folder, which would mislead here. */
export function configFsError(err: unknown, file: string): unknown {
  if (err instanceof StorageError) return err;
  const code = errorCode(err);
  if (code === "ENOSPC") return new StorageError("storage_unavailable", "Disk is full.");
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return new StorageError(
      "storage_unavailable",
      `Cannot use ${file} (${code}). In Docker, make sure the config volume is writable by uid 1000 (e.g. \`sudo chown -R 1000:1000 ./config\`).`,
    );
  }
  return code ? new StorageError("storage_unavailable", `Cannot use ${file} (${code}).`) : err;
}

/** The file's text, or null when it (or the config folder) doesn't exist yet. Never creates anything. */
export async function readConfigText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return null;
    throw configFsError(err, file);
  }
}

/**
 * Writes the file atomically with mode 0600, creating the folder with mode 0700. With `noClobber` an
 * existing file is never replaced: the write fails with name_taken instead.
 */
export async function writeConfigText(file: string, text: string, opts: { noClobber?: boolean } = {}) {
  const mapError = (err: unknown) => configFsError(err, file);
  try {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  } catch (err) {
    throw mapError(err);
  }
  await atomicWrite(file, Buffer.from(text, "utf8"), { mode: 0o600, mapError, noClobber: opts.noClobber });
}
