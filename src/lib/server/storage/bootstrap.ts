import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_FOLDER, NOTE_EXT } from "@/lib/constants";
import { uniqueName } from "@/lib/names";
import { getDataDir } from "./config";
import { StorageError } from "./errors";
import { STALE_AFTER_MS, removeStaleTemps } from "./cleanup";
import { atomicWrite, errorCode, mapFsError } from "./fs-utils";
import { withWriteLock } from "./mutex";
import { isVisibleName, readNames } from "./paths";
import { WELCOME_MARKDOWN } from "./welcome";

const WELCOME_NAME = "Welcome";
/** Last cleanup time per data dir; on globalThis so dev-mode HMR doesn't reset it. */
const holder = globalThis as typeof globalThis & { __writeTempCleanupAt?: Map<string, number> };
const lastCleanup = (holder.__writeTempCleanupAt ??= new Map());

/** True when the data dir is missing or has no visible folder to write into. */
async function needsBootstrap(dataDir: string): Promise<boolean> {
  try {
    const entries = await readdir(dataDir, { withFileTypes: true });
    return !entries.some((e) => e.isDirectory() && isVisibleName(e.name));
  } catch (err) {
    if (errorCode(err) === "ENOENT") return true;
    throw err;
  }
}

async function bootstrap(dataDir: string) {
  await mkdir(dataDir, { recursive: true });
  if (!(await needsBootstrap(dataDir))) return; // another request got here first
  const names = await readNames(dataDir);
  if (names.length === 0) {
    // Fresh install: greet the user with a note that explains where their files live.
    const folder = path.join(dataDir, DEFAULT_FOLDER);
    await mkdir(folder);
    await atomicWrite(path.join(folder, WELCOME_NAME + NOTE_EXT), Buffer.from(WELCOME_MARKDOWN, "utf8"));
  } else {
    // e.g. only .trash left after deleting the last folder: give the user somewhere to write again.
    await mkdir(path.join(dataDir, uniqueName(DEFAULT_FOLDER, names)));
  }
}

function toUnavailable(err: unknown, dataDir: string): StorageError {
  const mapped = mapFsError(err);
  if (mapped instanceof StorageError && mapped.code === "storage_unavailable") return mapped;
  const code = errorCode(err) ?? (err instanceof Error ? err.message : "unknown error");
  return new StorageError("storage_unavailable", `Cannot use ${dataDir} as the data folder (${code}).`);
}

/**
 * Makes sure there is always somewhere to write: creates the data dir, a "notebook" folder when no
 * visible folder exists, and a Welcome note on a completely empty data dir. Cheap enough (one readdir)
 * to call on every tree load. Any failure becomes storage_unavailable with a fix hint.
 */
export async function ensureBootstrap(): Promise<void> {
  const dataDir = getDataDir();
  try {
    if (await needsBootstrap(dataDir)) await withWriteLock(() => bootstrap(dataDir));
    if (Date.now() - (lastCleanup.get(dataDir) ?? 0) > STALE_AFTER_MS) {
      lastCleanup.set(dataDir, Date.now());
      await withWriteLock(() => removeStaleTemps(dataDir));
    }
  } catch (err) {
    throw toUnavailable(err, dataDir);
  }
}
