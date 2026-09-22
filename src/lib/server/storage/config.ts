import path from "node:path";
import { StorageError } from "./errors";

/**
 * Absolute path of the notes root, read from WRITE_DATA_DIR on every call (tests and restarts can change
 * it; a relative value resolves against the server's cwd). Refuses anything inside a `.next/` build dir,
 * because the standalone server chdirs there and the next build would wipe the notes.
 */
export function getDataDir(): string {
  // The turbopackIgnore comment is load-bearing: without it Turbopack treats this as a dynamic fs path
  // and traces the whole project (including ./data) into the build output. An empty value means unset.
  const dir = path.resolve(/* turbopackIgnore: true */ process.env.WRITE_DATA_DIR || "data");
  if (`${dir}${path.sep}`.includes(`${path.sep}.next${path.sep}`)) {
    throw new StorageError(
      "storage_unavailable",
      `Refusing to use ${dir} as the data folder: it is inside a .next build directory and would be wiped by the next build. Set WRITE_DATA_DIR to a folder outside the app.`,
    );
  }
  return dir;
}
