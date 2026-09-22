import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFolder, deleteFolder, listTree, renameFolder, StorageError } from "./index";
import { withTempDataDir } from "./test-utils";

const COMBINING_ACUTE = String.fromCodePoint(0x301);

/** Creates files (and their parent dirs) relative to the data dir. */
async function seed(dataDir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dataDir, rel)), { recursive: true });
    await writeFile(path.join(dataDir, rel), content);
  }
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (err: unknown) => (err instanceof StorageError ? err.code : String(err)),
  );

const shape = async () =>
  (await listTree()).folders.map((f) => ({ name: f.name, notes: f.notes.map((n) => n.name) }));

describe("listTree", () => {
  it("lists visible folders and *.md notes, naturally sorted", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, {
        "work/Note 10.md": "",
        "work/note 2.md": "hi",
        "Archive/Old.md": "",
      });
      await mkdir(path.join(dir, "Empty"));
      expect(await shape()).toEqual([
        { name: "Archive", notes: ["Old"] },
        { name: "Empty", notes: [] },
        { name: "work", notes: ["note 2", "Note 10"] },
      ]);
      const [note] = (await listTree()).folders[2].notes;
      expect(note).toMatchObject({ folder: "work", name: "note 2", size: 2 });
      expect(new Date(note.updatedAt).toISOString()).toBe(note.updatedAt);
    }));

  it("ignores hidden entries, symlinks, non-.md files, nested dirs and root files", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, {
        "notebook/Real.md": "",
        "notebook/.hidden.md": "",
        "notebook/image.png": "",
        "notebook/Upper.MD": "",
        "notebook/nested/Deep.md": "",
        "Root.md": "",
        ".trash/stamp/notebook/Gone.md": "",
        ".hidden/Secret.md": "",
        "outside/Linked.md": "",
      });
      await symlink(path.join(dir, "outside"), path.join(dir, "linked-folder"));
      await symlink(path.join(dir, "outside/Linked.md"), path.join(dir, "notebook/Link.md"));
      expect(await shape()).toEqual([
        { name: "notebook", notes: ["Real"] },
        { name: "outside", notes: ["Linked"] },
      ]);
    }));

  it("works when the data dir itself is a symlink (e.g. into a sync folder)", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "real/notebook/Note.md": "" });
      await symlink(path.join(dir, "real"), path.join(dir, "link"));
      process.env.WRITE_DATA_DIR = path.join(dir, "link");
      expect(await shape()).toEqual([{ name: "notebook", notes: ["Note"] }]);
      await createFolder("Work");
      expect((await readdir(path.join(dir, "real"))).sort()).toEqual(["Work", "notebook"]);
    }));

  it("reads a missing data dir as empty", () =>
    withTempDataDir(async (dir) => {
      process.env.WRITE_DATA_DIR = path.join(dir, "missing");
      expect(await listTree()).toEqual({ folders: [] });
    }));
});

describe("createFolder", () => {
  it("creates an empty folder with the normalized name", () =>
    withTempDataDir(async (dir) => {
      expect(await createFolder("  Work  ")).toEqual({ name: "Work", notes: [] });
      expect(await readdir(dir)).toEqual(["Work"]);
    }));

  it.each(["", "a/b", ".hidden", "CON", "name."])("rejects %j as invalid_name", (name) =>
    withTempDataDir(async () => {
      expect(await codeOf(createFolder(name))).toBe("invalid_name");
    }),
  );

  it("rejects case and normalization variants of existing entries", () =>
    withTempDataDir(async (dir) => {
      await createFolder("Work");
      await seed(dir, { report: "a root file" });
      expect(await codeOf(createFolder("work"))).toBe("name_taken");
      expect(await codeOf(createFolder("REPORT"))).toBe("name_taken");
      await createFolder(`Cafe${COMBINING_ACUTE}`);
      expect(await codeOf(createFolder("café"))).toBe("name_taken");
    }));
});

describe("renameFolder", () => {
  it("renames and carries every file along, including ones the app ignores", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "Work/Plan.md": "x", "Work/photo.png": "p", "Work/sub/Deep.md": "d" });
      expect(await renameFolder("Work", "Projects")).toMatchObject({
        name: "Projects",
        notes: [{ name: "Plan" }],
      });
      expect((await readdir(path.join(dir, "Projects"))).sort()).toEqual(["Plan.md", "photo.png", "sub"]);
      expect(await readdir(dir)).toEqual(["Projects"]);
    }));

  it("allows a case-only rename", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "work/Plan.md": "x" });
      await renameFolder("work", "Work");
      expect(await readdir(dir)).toEqual(["Work"]);
      expect(await shape()).toEqual([{ name: "Work", notes: ["Plan"] }]);
    }));

  it("reports collisions, missing folders and invalid names", () =>
    withTempDataDir(async () => {
      await createFolder("A");
      await createFolder("B");
      expect(await codeOf(renameFolder("A", "b"))).toBe("name_taken");
      expect(await codeOf(renameFolder("Missing", "C"))).toBe("not_found");
      expect(await codeOf(renameFolder("A", "C:D"))).toBe("invalid_name");
      expect(await codeOf(renameFolder("A", "A"))).toBe("ok");
    }));

  it("finds folders stored with NFD names (HFS+, rsync)", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, `Cafe${COMBINING_ACUTE}`));
      expect(await codeOf(renameFolder("Café", "Bistro"))).toBe("ok");
      expect(await readdir(dir)).toEqual(["Bistro"]);
    }));
});

describe("deleteFolder", () => {
  it("moves the whole folder into .trash", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "Work/Plan.md": "x", "Work/photo.png": "p" });
      await deleteFolder("Work");
      expect(await readdir(dir)).toEqual([".trash"]);
      const [stamp] = await readdir(path.join(dir, ".trash"));
      expect(stamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[0-9a-f]{4}$/);
      expect((await readdir(path.join(dir, ".trash", stamp, "Work"))).sort()).toEqual([
        "Plan.md",
        "photo.png",
      ]);
    }));

  it("reports a missing folder", () =>
    withTempDataDir(async () => {
      expect(await codeOf(deleteFolder("Nope"))).toBe("not_found");
    }));
});

describe("path traversal", () => {
  it.each(["..", ".", "a/b", "a\\b", `a${String.fromCodePoint(0)}b`, ".trash", ".hidden", "../outside"])(
    "treats %j as not_found",
    (name) =>
      withTempDataDir(async (dir) => {
        await seed(dir, { ".trash/x/Old.md": "", ".hidden/Secret.md": "", "a/b/c.md": "" });
        expect(await codeOf(deleteFolder(name))).toBe("not_found");
        expect(await codeOf(renameFolder(name, "Stolen"))).toBe("not_found");
      }),
  );

  it("never follows a symlinked folder", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "real/Note.md": "" });
      await symlink(path.join(dir, "real"), path.join(dir, "link"));
      expect(await codeOf(deleteFolder("link"))).toBe("not_found");
    }));
});
