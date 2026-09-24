import { realpath } from "node:fs/promises";
import path from "node:path";
import { StorageError } from "./errors";

/** True for a folder inside a `.next` build dir, which the next build would wipe. */
const insideBuildDir = (dir: string) => `${dir}${path.sep}`.includes(`${path.sep}.next${path.sep}`);

/**
 * Absolute path of the notes root, read from WRITE_DATA_DIR on every call (tests and restarts can change
 * it; a relative value resolves against the server's cwd). Refuses anything inside a `.next/` build dir,
 * because the standalone server chdirs there and the next build would wipe the notes.
 */
export function getDataDir(): string {
  // The turbopackIgnore comment is load-bearing: without it Turbopack treats this as a dynamic fs path
  // and traces the whole project (including ./data) into the build output. An empty value means unset.
  const dir = path.resolve(/* turbopackIgnore: true */ process.env.WRITE_DATA_DIR || "data");
  if (insideBuildDir(dir)) {
    throw new StorageError(
      "storage_unavailable",
      `Refusing to use ${dir} as the data folder: it is inside a .next build directory and would be wiped by the next build. Set WRITE_DATA_DIR to a folder outside the app.`,
    );
  }
  return dir;
}

/** Whether `dir` is `parent` or inside it. Case-insensitive on macOS and Windows, like their filesystems. */
function isSameOrInside(dir: string, parent: string): boolean {
  const fold = (p: string) =>
    process.platform === "darwin" || process.platform === "win32" ? p.toLowerCase() : p;
  const rel = path.relative(fold(parent), fold(dir));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * `p` with symlinks resolved, for a folder that may not exist yet: its nearest existing ancestor is
 * resolved and the missing rest appended. Falls back to `p` when a part can't be read.
 */
async function realPathOf(p: string): Promise<string> {
  const missing: string[] = [];
  for (let dir = p; ; dir = path.dirname(dir)) {
    try {
      return path.join(await realpath(dir), ...missing);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== "ENOENT" && code !== "ENOTDIR") || path.dirname(dir) === dir) return p;
      missing.unshift(path.basename(dir));
    }
  }
}

/**
 * Absolute path of write's own settings folder (WRITE_CONFIG_DIR, default `./config`), read on every call
 * like getDataDir(). It holds API keys in plain text, so it must never sit with the notes, which may be
 * synced or shared (a folder there would also show up as a notebook): anything equal to or inside the data
 * dir is refused, as written or once symlinks are followed (a data folder linked into Dropbox, say), as is
 * anything inside `.next/` (see docs/design-decisions.md#d28). Separate Docker mounts of one host folder
 * can't be seen from here.
 */
export async function getConfigDir(): Promise<string> {
  // Load-bearing turbopackIgnore comment, as in getDataDir() (docs/design-decisions.md#d27).
  const dir = path.resolve(/* turbopackIgnore: true */ process.env.WRITE_CONFIG_DIR || "config");
  if (insideBuildDir(dir)) {
    throw new StorageError(
      "storage_unavailable",
      `Refusing to use ${dir} as the config folder: it is inside a .next build directory and would be wiped by the next build. Set WRITE_CONFIG_DIR to a folder outside the app.`,
    );
  }
  const dataDir = getDataDir();
  const [realDir, realData] = await Promise.all([realPathOf(dir), realPathOf(dataDir)]);
  if (isSameOrInside(dir, dataDir) || isSameOrInside(realDir, realData)) {
    throw new StorageError(
      "storage_unavailable",
      `Refusing to use ${dir} as the config folder: it holds API keys and must not be inside the notes folder ${dataDir} (symlinks followed), which may be synced or shared. Set WRITE_CONFIG_DIR to a folder outside ${dataDir}.`,
    );
  }
  return dir;
}

/**
 * Absolute path of a file in the config folder. Build every config-file path here: a literal filename
 * joined inline (`path.join(dir, "account.json")`) makes Turbopack copy that file, secrets included, into
 * the build output, and next.config.ts's tracing excludes don't reach the proxy (docs/design-decisions.md#d27).
 */
export async function configFile(name: string): Promise<string> {
  return path.join(/* turbopackIgnore: true */ await getConfigDir(), name);
}
