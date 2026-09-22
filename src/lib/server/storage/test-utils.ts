import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Runs `fn` against a brand-new, empty data dir (WRITE_DATA_DIR points at it), then deletes the dir and
 * restores the previous env value. Every server test uses this so tests never share or touch real notes.
 * The dir starts EMPTY: call ensureBootstrap() yourself if the test needs the default "notebook" folder.
 *
 * @example
 *   it("creates a folder", () => withTempDataDir(async (dir) => { await createFolder("Work"); … }));
 */
export async function withTempDataDir<T>(fn: (dataDir: string) => Promise<T> | T): Promise<T> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "write-test-"));
  const previous = process.env.WRITE_DATA_DIR;
  process.env.WRITE_DATA_DIR = dataDir;
  try {
    return await fn(dataDir);
  } finally {
    if (previous === undefined) delete process.env.WRITE_DATA_DIR;
    else process.env.WRITE_DATA_DIR = previous;
    await rm(dataDir, { recursive: true, force: true });
  }
}
