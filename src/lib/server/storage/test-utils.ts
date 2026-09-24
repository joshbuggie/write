import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Sets an env var, or removes it for `undefined` (assigning undefined would store the string "undefined"). */
function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/**
 * Runs `fn` against a brand-new, empty data dir (WRITE_DATA_DIR points at it) and a separate, empty config
 * dir (WRITE_CONFIG_DIR), then deletes both and restores the previous env values. Every server test uses
 * this so tests never share or touch real notes or real settings (API keys). The data dir starts EMPTY:
 * call ensureBootstrap() yourself if the test needs the default "notebook" folder. The config dir is
 * `process.env.WRITE_CONFIG_DIR` (or getConfigDir()); a test may repoint it, it is restored afterwards.
 *
 * @example
 *   it("creates a folder", () => withTempDataDir(async (dir) => { await createFolder("Work"); … }));
 */
export async function withTempDataDir<T>(fn: (dataDir: string) => Promise<T> | T): Promise<T> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "write-test-"));
  const configDir = await mkdtemp(path.join(tmpdir(), "write-test-config-"));
  const previous = { data: process.env.WRITE_DATA_DIR, config: process.env.WRITE_CONFIG_DIR };
  process.env.WRITE_DATA_DIR = dataDir;
  process.env.WRITE_CONFIG_DIR = configDir;
  try {
    return await fn(dataDir);
  } finally {
    setEnv("WRITE_DATA_DIR", previous.data);
    setEnv("WRITE_CONFIG_DIR", previous.config);
    await rm(dataDir, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  }
}

/** Writes a file into the current test's config dir, e.g. a broken account.json. Only inside withTempDataDir. */
export async function writeTestConfigFile(name: string, text: string): Promise<void> {
  const dir = process.env.WRITE_CONFIG_DIR;
  if (!dir) throw new Error("writeTestConfigFile: call it inside withTempDataDir()");
  await writeFile(path.join(dir, name), text);
}
