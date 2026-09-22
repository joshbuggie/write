import { chmod, mkdir, readdir, readFile, rename, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { removeStaleTemps } from "./cleanup";
import { deleteFolder, ensureBootstrap, getDataDir, listTree, StorageError } from "./index";
import { withTempDataDir } from "./test-utils";
import { WELCOME_MARKDOWN } from "./welcome";

const isRoot = process.getuid?.() === 0;
const HOURS_AGO = new Date(Date.now() - 2 * 60 * 60 * 1000);

describe("ensureBootstrap", () => {
  it("fills a fresh, empty data dir with notebook/Welcome.md", () =>
    withTempDataDir(async (dir) => {
      await ensureBootstrap();
      expect(await readdir(dir)).toEqual(["notebook"]);
      expect(await readFile(path.join(dir, "notebook/Welcome.md"), "utf8")).toBe(WELCOME_MARKDOWN);
    }));

  it("creates a missing data dir", () =>
    withTempDataDir(async (dir) => {
      process.env.WRITE_DATA_DIR = path.join(dir, "nested/data");
      await ensureBootstrap();
      expect(await readdir(path.join(dir, "nested/data/notebook"))).toEqual(["Welcome.md"]);
    }));

  it("creates an empty notebook (no Welcome) when only .trash is left", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, ".trash/2026-01-01/Old"), { recursive: true });
      await ensureBootstrap();
      expect((await readdir(dir)).sort()).toEqual([".trash", "notebook"]);
      expect(await readdir(path.join(dir, "notebook"))).toEqual([]);
    }));

  it("recreates notebook after the last folder is deleted", () =>
    withTempDataDir(async () => {
      await ensureBootstrap();
      await deleteFolder("notebook");
      expect((await listTree()).folders).toEqual([]);
      await ensureBootstrap();
      expect((await listTree()).folders).toEqual([{ name: "notebook", notes: [] }]);
    }));

  it("leaves a data dir with folders alone, and never clobbers a root file", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "Work"));
      await ensureBootstrap();
      expect(await readdir(dir)).toEqual(["Work"]);
      await mkdir(path.join(dir, "other"));
      await deleteFolder("Work");
      await deleteFolder("other");
      await writeFile(path.join(dir, "notebook"), "a file, not a folder");
      await ensureBootstrap();
      expect((await listTree()).folders.map((f) => f.name)).toEqual(["notebook 2"]);
    }));

  it.skipIf(isRoot)("reports an unwritable data dir as storage_unavailable with a fix hint", () =>
    withTempDataDir(async (dir) => {
      await chmod(dir, 0o500);
      try {
        const err = await ensureBootstrap().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(StorageError);
        expect(err).toMatchObject({ code: "storage_unavailable" });
        expect((err as Error).message).toContain("chown -R 1000:1000");
      } finally {
        await chmod(dir, 0o700);
      }
    }),
  );
});

describe("removeStaleTemps", () => {
  it("removes only old .write-*.tmp files", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "notebook"));
      const files = {
        "notebook/.write-0123abcd.tmp": HOURS_AGO,
        "notebook/.write-fresh.tmp": new Date(),
        "notebook/.writer.tmp": HOURS_AGO,
        "notebook/Note.md": HOURS_AGO,
        ".write-health-1a2b.tmp": HOURS_AGO,
      };
      for (const [rel, mtime] of Object.entries(files)) {
        await writeFile(path.join(dir, rel), "");
        await utimes(path.join(dir, rel), mtime, mtime);
      }
      await removeStaleTemps(dir);
      expect((await readdir(path.join(dir, "notebook"))).sort()).toEqual([
        ".write-fresh.tmp",
        ".writer.tmp",
        "Note.md",
      ]);
      expect(await readdir(dir)).toEqual(["notebook"]);
    }));

  it("recovers a folder stranded mid case-only rename instead of deleting it", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "work"));
      await writeFile(path.join(dir, "work/Q3 plan.md"), "plan");
      await utimes(path.join(dir, "work"), HOURS_AGO, HOURS_AGO);
      await rename(path.join(dir, "work"), path.join(dir, ".write-rename-1a2b3c4d")); // crash state
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await removeStaleTemps(dir);
      expect(await readdir(dir)).toEqual(["Recovered folder"]);
      expect(await readFile(path.join(dir, "Recovered folder/Q3 plan.md"), "utf8")).toBe("plan");
    }));

  it("recovers a note stranded mid case-only rename under a free name", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "notebook"));
      await writeFile(path.join(dir, "notebook/Recovered note.md"), "older");
      await writeFile(path.join(dir, "notebook/.write-rename-deadbeef"), "only copy");
      await utimes(path.join(dir, "notebook/.write-rename-deadbeef"), HOURS_AGO, HOURS_AGO);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await removeStaleTemps(dir);
      expect((await readdir(path.join(dir, "notebook"))).sort()).toEqual([
        "Recovered note 2.md",
        "Recovered note.md",
      ]);
      expect(await readFile(path.join(dir, "notebook/Recovered note 2.md"), "utf8")).toBe("only copy");
    }));

  it("moves a stranded rename of an unexpected kind to .trash", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "notebook/.write-rename-ab12"), { recursive: true });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await removeStaleTemps(dir);
      expect(await readdir(path.join(dir, "notebook"))).toEqual([]);
      const [stamp] = await readdir(path.join(dir, ".trash"));
      expect(await readdir(path.join(dir, ".trash", stamp, "notebook"))).toEqual([".write-rename-ab12"]);
    }));
});

describe("getDataDir", () => {
  it("resolves WRITE_DATA_DIR (default ./data) against the cwd", () =>
    withTempDataDir(async (dir) => {
      expect(getDataDir()).toBe(dir);
      process.env.WRITE_DATA_DIR = "notes";
      expect(getDataDir()).toBe(path.resolve("notes"));
      process.env.WRITE_DATA_DIR = "";
      expect(getDataDir()).toBe(path.resolve("data"));
    }));

  it("refuses a data dir inside a .next build directory", () =>
    withTempDataDir(async () => {
      process.env.WRITE_DATA_DIR = "/app/.next/standalone/data";
      expect(() => getDataDir()).toThrow(StorageError);
      process.env.WRITE_DATA_DIR = "/app/.next";
      expect(() => getDataDir()).toThrow(/\.next/);
      process.env.WRITE_DATA_DIR = "/app/.nextcloud/data";
      expect(getDataDir()).toBe("/app/.nextcloud/data");
    }));
});
