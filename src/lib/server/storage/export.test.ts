import { chmod, mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { StorageError, zipAll, zipFolder } from "./index";
import { withTempDataDir } from "./test-utils";

async function seed(dataDir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dataDir, rel)), { recursive: true });
    await writeFile(path.join(dataDir, rel), content);
  }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("zipAll", () => {
  it("zips every visible note under one root dir, with empty folders as dir entries", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, {
        "notebook/Welcome.md": "# Hi\r\n",
        "Work/Plan.md": "plan",
        "Work/photo.png": "not a note",
        "Work/.hidden.md": "",
        ".trash/stamp/Old/Gone.md": "",
        "Root.md": "",
      });
      await mkdir(path.join(dir, "Empty"));
      const { bytes, filename } = await zipAll();
      const root = `write-notes-${today()}`;
      expect(filename).toBe(`${root}.zip`);
      const files = unzipSync(bytes);
      expect(Object.keys(files).sort()).toEqual(
        [
          `${root}/`,
          `${root}/Empty/`,
          `${root}/Work/`,
          `${root}/Work/Plan.md`,
          `${root}/notebook/`,
          `${root}/notebook/Welcome.md`,
        ].sort(),
      );
      expect(strFromU8(files[`${root}/notebook/Welcome.md`])).toBe("# Hi\r\n");
    }));

  it("clamps pre-1980 mtimes instead of failing", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/Old.md": "old" });
      await utimes(path.join(dir, "notebook/Old.md"), new Date(0), new Date(0));
      const files = unzipSync((await zipAll()).bytes);
      expect(strFromU8(files[`write-notes-${today()}/notebook/Old.md`])).toBe("old");
    }));

  // Root reads every file whatever its mode, so the permission error can't be staged there.
  it.skipIf(process.getuid?.() === 0)("fails instead of leaving out a note it can't read", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "Work/Plan.md": "plan", "Work/Secret.md": "secret" });
      await chmod(path.join(dir, "Work/Secret.md"), 0o000);
      const err = await zipAll().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect(err).toMatchObject({ code: "storage_unavailable" });
      expect((err as Error).message).toContain("Work/Secret.md");
    }),
  );

  it("NFC-normalizes entry names", () =>
    withTempDataDir(async (dir) => {
      const nfd = `Cafe${String.fromCodePoint(0x301)}`;
      await seed(dir, { [`${nfd}/${nfd}.md`]: "x" });
      const names = Object.keys(unzipSync((await zipAll()).bytes));
      expect(names).toContain(`write-notes-${today()}/Café/Café.md`);
    }));

  it("keeps folders named like Object.prototype keys", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "__proto__/Plan.md": "a", "constructor/Note.md": "b", "Work/Other.md": "c" });
      const root = `write-notes-${today()}`;
      const files = unzipSync((await zipAll()).bytes);
      expect(Object.keys(files).sort()).toEqual(
        [
          `${root}/`,
          `${root}/Work/`,
          `${root}/Work/Other.md`,
          `${root}/__proto__/`,
          `${root}/__proto__/Plan.md`,
          `${root}/constructor/`,
          `${root}/constructor/Note.md`,
        ].sort(),
      );
      expect(strFromU8(files[`${root}/__proto__/Plan.md`]!)).toBe("a");
    }));
});

describe("zipFolder", () => {
  it("zips one folder under <folder>/", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "Work/Plan.md": "plan", "Work/notes.txt": "", "Other/X.md": "" });
      const { bytes, filename } = await zipFolder("Work");
      expect(filename).toBe("Work.zip");
      const files = unzipSync(bytes);
      expect(Object.keys(files).sort()).toEqual(["Work/", "Work/Plan.md"]);
      expect(strFromU8(files["Work/Plan.md"])).toBe("plan");
    }));

  it("keeps an empty folder as a directory entry", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "Empty"));
      expect(Object.keys(unzipSync((await zipFolder("Empty")).bytes))).toEqual(["Empty/"]);
    }));

  it.each(["Missing", ".trash", ".."])("reports %j as not_found", (name) =>
    withTempDataDir(async (dir) => {
      await seed(dir, { ".trash/x/Old.md": "" });
      const err = await zipFolder(name).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect(err).toMatchObject({ code: "not_found" });
    }),
  );
});
