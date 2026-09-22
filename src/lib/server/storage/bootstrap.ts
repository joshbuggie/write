import { mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_FOLDER, NOTE_EXT } from "@/lib/constants";
import { uniqueName } from "@/lib/names";
import { getDataDir } from "./config";
import { StorageError } from "./errors";
import { atomicWrite, errorCode, mapFsError, randomHex } from "./fs-utils";
import { withWriteLock } from "./mutex";
import { isVisibleName, readNames } from "./paths";
import { WELCOME_MARKDOWN } from "./welcome";

const WELCOME_NAME = "Welcome";
/** Leftovers of interrupted atomic writes and case-only renames. Only these exact patterns are removed. */
const STALE_TEMP = /^\.write-(.+\.tmp|rename-[0-9a-f]+)$/;
const STALE_AFTER_MS = 60 * 60 * 1000;
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

/** Removes temp files older than an hour (left by a crash mid-write) from the data dir and its visible folders. */
export async function removeStaleTemps(dataDir: string, now = Date.now()) {
  const entries = await readdir(dataDir, { withFileTypes: true });
  const dirs = [
    dataDir,
    ...entries.filter((e) => e.isDirectory() && isVisibleName(e.name)).map((e) => path.join(dataDir, e.name)),
  ];
  for (const dir of dirs) {
    for (const name of (await readNames(dir)).filter((n) => STALE_TEMP.test(n))) {
      const file = path.join(dir, name);
      const info = await stat(file).catch(() => null);
      if (info && now - info.mtimeMs > STALE_AFTER_MS)
        await rm(file, { force: true, recursive: info.isDirectory() });
    }
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
      await removeStaleTemps(dataDir);
    }
  } catch (err) {
    throw toUnavailable(err, dataDir);
  }
}

/** Writability probe for /api/health and the Docker HEALTHCHECK. Never throws; details go to the server log. */
export async function checkHealth(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dataDir = getDataDir();
    await mkdir(dataDir, { recursive: true });
    const probe = path.join(dataDir, `.write-health-${randomHex(4)}.tmp`);
    await atomicWrite(probe, Buffer.from("ok"));
    await unlink(probe);
    return { ok: true };
  } catch (err) {
    console.error("[write] Storage health check failed:", err);
    return { ok: false, error: "storage unavailable" };
  }
}
