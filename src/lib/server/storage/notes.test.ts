import { mkdir, readdir, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_NOTE_BYTES } from "@/lib/constants";
import {
  createNote,
  deleteNote,
  discardIfEmpty,
  mostRecentNote,
  readNote,
  readNoteFile,
  saveNote,
  StorageError,
  updateNote,
} from "./index";
import { withTempDataDir } from "./test-utils";
import { versionOf } from "./text";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const INVALID_UTF8 = Buffer.from([0x61, 0xff, 0xfe, 0x62]);
const NUL = String.fromCodePoint(0);

async function seed(dataDir: string, files: Record<string, string | Buffer>) {
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

const ref = (name: string, folder = "notebook") => ({ folder, name });
const disk = (dir: string, rel: string) => readFile(path.join(dir, rel));
const PAST = new Date("2020-01-01T00:00:00Z");

describe("createNote", () => {
  it("defaults to Untitled and auto-suffixes taken names, case-insensitively", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/untitled.md": "" });
      const note = await createNote({ folder: "notebook" });
      expect(note).toMatchObject({ folder: "notebook", name: "Untitled 2", content: "", readOnly: null });
      expect((await createNote({ folder: "notebook", name: "Plan.md" })).name).toBe("Plan");
      expect((await createNote({ folder: "notebook", name: "PLAN" })).name).toBe("PLAN 2");
      expect(note.version).toBe(versionOf(Buffer.alloc(0)));
    }));

  it("stores imported content with LF line endings", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "notebook"));
      await createNote({ folder: "notebook", name: "Imported", content: "a\r\nb\rc" });
      expect((await disk(dir, "notebook/Imported.md")).toString()).toBe("a\nb\nc");
    }));

  it("rejects invalid names, missing folders and oversized content", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "notebook"));
      expect(await codeOf(createNote({ folder: "notebook", name: "a/b" }))).toBe("invalid_name");
      expect(await codeOf(createNote({ folder: "missing" }))).toBe("not_found");
      const big = "x".repeat(MAX_NOTE_BYTES + 1);
      expect(await codeOf(createNote({ folder: "notebook", content: big }))).toBe("too_large");
    }));
});

describe("readNote", () => {
  it("strips the BOM and normalizes CRLF, versioning the raw bytes", () =>
    withTempDataDir(async (dir) => {
      const bytes = Buffer.concat([BOM, Buffer.from("# Hi\r\n\r\nText\r\n")]);
      await seed(dir, { "notebook/Win.md": bytes });
      expect(await readNote(ref("Win"))).toMatchObject({
        content: "# Hi\n\nText\n",
        version: versionOf(bytes),
        size: bytes.length,
        readOnly: null,
      });
    }));

  it("opens invalid UTF-8 and oversized files read-only", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, {
        "notebook/Binary.md": INVALID_UTF8,
        "notebook/Huge.md": Buffer.alloc(MAX_NOTE_BYTES + 1, 0x61),
      });
      expect(await readNote(ref("Binary"))).toMatchObject({
        readOnly: "not-utf8",
        content: "a\uFFFD\uFFFDb",
      });
      const huge = await readNote(ref("Huge"));
      expect(huge).toMatchObject({ readOnly: "too-large", content: "", size: MAX_NOTE_BYTES + 1 });
      expect(huge.version).toBe(versionOf(await disk(dir, "notebook/Huge.md")));
    }));

  it("reports missing notes and never follows symlinks", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/Real.md": "secret" });
      await symlink(path.join(dir, "notebook/Real.md"), path.join(dir, "notebook/Link.md"));
      expect(await codeOf(readNote(ref("Nope")))).toBe("not_found");
      expect(await codeOf(readNote(ref("Link")))).toBe("not_found");
      expect(await codeOf(readNote(ref("real")))).toBe("not_found");
    }));
});

describe("saveNote", () => {
  const setup = async (dir: string, content: string | Buffer = "old\n") => {
    await seed(dir, { "notebook/Plan.md": content });
    return (await readNote(ref("Plan"))).version;
  };

  it("writes and returns the new version", () =>
    withTempDataDir(async (dir) => {
      const base = await setup(dir);
      const saved = await saveNote({ ref: ref("Plan"), content: "new\n", baseVersion: base });
      expect(saved).toMatchObject({
        folder: "notebook",
        name: "Plan",
        size: 4,
        version: versionOf(Buffer.from("new\n")),
      });
      expect((await disk(dir, "notebook/Plan.md")).toString()).toBe("new\n");
    }));

  it("refuses a stale base version and returns the current note", () =>
    withTempDataDir(async (dir) => {
      await setup(dir);
      const err = await saveNote({ ref: ref("Plan"), content: "mine\n", baseVersion: "stale" }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(StorageError);
      expect(err).toMatchObject({ code: "version_conflict", current: { content: "old\n", name: "Plan" } });
    }));

  it("accepts a stale base version when the disk already has the same text", () =>
    withTempDataDir(async (dir) => {
      await setup(dir);
      const saved = await saveNote({ ref: ref("Plan"), content: "old\n", baseVersion: "stale" });
      expect(saved.version).toBe(versionOf(Buffer.from("old\n")));
    }));

  it("overwrites regardless of version with force", () =>
    withTempDataDir(async (dir) => {
      await setup(dir);
      await saveNote({ ref: ref("Plan"), content: "mine\n", baseVersion: "stale", force: true });
      expect((await disk(dir, "notebook/Plan.md")).toString()).toBe("mine\n");
    }));

  it("keeps the overwritten disk version in .trash when a forced save wasn't based on it", () =>
    withTempDataDir(async (dir) => {
      const base = await setup(dir);
      await saveNote({ ref: ref("Plan"), content: "mine\n", baseVersion: "stale", force: true });
      const [stamp] = await readdir(path.join(dir, ".trash"));
      expect((await disk(dir, `.trash/${stamp}/notebook/Plan.md`)).toString()).toBe("old\n");
      expect(await readdir(path.join(dir, ".trash", stamp, "notebook"))).toEqual(["Plan.md"]);

      // Based on the disk version (or nothing to change): no backup.
      const current = versionOf(Buffer.from("mine\n"));
      await saveNote({ ref: ref("Plan"), content: "again\n", baseVersion: current, force: true });
      await saveNote({ ref: ref("Plan"), content: "again\n", baseVersion: base, force: true });
      expect(await readdir(path.join(dir, ".trash"))).toEqual([stamp]);
    }));

  it("never rewrites identical bytes (mtime unchanged)", () =>
    withTempDataDir(async (dir) => {
      const base = await setup(dir);
      await utimes(path.join(dir, "notebook/Plan.md"), PAST, PAST);
      const saved = await saveNote({ ref: ref("Plan"), content: "old\n", baseVersion: base });
      expect(saved.version).toBe(base);
      expect((await stat(path.join(dir, "notebook/Plan.md"))).mtime).toEqual(PAST);
    }));

  it("treats a missing file as a conflict unless forced, then recreates it", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "notebook"));
      const err = await saveNote({ ref: ref("Gone"), content: "x", baseVersion: "v" }).catch((e) => e);
      expect(err).toMatchObject({ code: "version_conflict", current: null });
      await saveNote({ ref: ref("Gone"), content: "x", baseVersion: null, force: true });
      expect((await disk(dir, "notebook/Gone.md")).toString()).toBe("x");
    }));

  it("reports a missing folder as not_found", () =>
    withTempDataDir(async () => {
      expect(
        await codeOf(saveNote({ ref: ref("A", "missing"), content: "", baseVersion: null, force: true })),
      ).toBe("not_found");
    }));

  it("refuses to edit invalid UTF-8 without force", () =>
    withTempDataDir(async (dir) => {
      const base = await setup(dir, INVALID_UTF8);
      expect(await codeOf(saveNote({ ref: ref("Plan"), content: "x", baseVersion: base }))).toBe("read_only");
    }));

  it("rejects content over the size cap", () =>
    withTempDataDir(async (dir) => {
      const base = await setup(dir);
      const big = "x".repeat(MAX_NOTE_BYTES + 1);
      expect(await codeOf(saveNote({ ref: ref("Plan"), content: big, baseVersion: base }))).toBe("too_large");
    }));

  it("preserves CRLF line endings and the BOM", () =>
    withTempDataDir(async (dir) => {
      const base = await setup(dir, Buffer.concat([BOM, Buffer.from("a\r\nb\r\n")]));
      await saveNote({ ref: ref("Plan"), content: "a\nb\nc\n", baseVersion: base });
      expect(await disk(dir, "notebook/Plan.md")).toEqual(
        Buffer.concat([BOM, Buffer.from("a\r\nb\r\nc\r\n")]),
      );
    }));

  it("leaves no temp files behind", () =>
    withTempDataDir(async (dir) => {
      let version = await setup(dir);
      for (let i = 0; i < 5; i++) {
        version = (await saveNote({ ref: ref("Plan"), content: `v${i}`, baseVersion: version })).version;
      }
      await codeOf(
        saveNote({ ref: ref("Plan"), content: "x".repeat(MAX_NOTE_BYTES + 1), baseVersion: version }),
      );
      expect(await readdir(path.join(dir, "notebook"))).toEqual(["Plan.md"]);
    }));
});

describe("updateNote", () => {
  it("renames within a folder", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/Plan.md": "x" });
      expect(await updateNote({ ref: ref("Plan"), newName: "Roadmap" })).toMatchObject({
        name: "Roadmap",
        size: 1,
      });
      expect(await readdir(path.join(dir, "notebook"))).toEqual(["Roadmap.md"]);
    }));

  it("allows a case-only rename", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/plan.md": "x" });
      await updateNote({ ref: ref("plan"), newName: "Plan" });
      expect(await readdir(path.join(dir, "notebook"))).toEqual(["Plan.md"]);
    }));

  it("refuses to overwrite another note, including case variants", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/A.md": "a", "notebook/B.md": "b" });
      const err = await updateNote({ ref: ref("A"), newName: "b" }).catch((e) => e);
      expect(err).toMatchObject({
        code: "name_taken",
        message: 'A note named "b" already exists in notebook.',
      });
      expect((await disk(dir, "notebook/B.md")).toString()).toBe("b");
    }));

  it("moves across folders, optionally renaming", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/A.md": "a", "notebook/B.md": "b", "Work/B.md": "work" });
      expect(await updateNote({ ref: ref("A"), newFolder: "Work" })).toMatchObject({
        folder: "Work",
        name: "A",
      });
      expect(await codeOf(updateNote({ ref: ref("B"), newFolder: "Work" }))).toBe("name_taken");
      await updateNote({ ref: ref("B"), newFolder: "Work", newName: "B from notebook" });
      expect((await readdir(path.join(dir, "Work"))).sort()).toEqual(["A.md", "B from notebook.md", "B.md"]);
      expect(await readdir(path.join(dir, "notebook"))).toEqual([]);
    }));

  it("reports missing notes/folders and invalid names; no-op returns the summary", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/A.md": "a" });
      expect(await codeOf(updateNote({ ref: ref("Nope"), newName: "X" }))).toBe("not_found");
      expect(await codeOf(updateNote({ ref: ref("A"), newFolder: "Missing" }))).toBe("not_found");
      expect(await codeOf(updateNote({ ref: ref("A"), newName: "a:b" }))).toBe("invalid_name");
      expect(await updateNote({ ref: ref("A"), newName: "A.md" })).toMatchObject({
        folder: "notebook",
        name: "A",
      });
    }));
});

describe("deleteNote", () => {
  it("moves the file into .trash/<stamp>/<folder>/", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/Old.md": "keep me" });
      await deleteNote(ref("Old"));
      expect(await readdir(path.join(dir, "notebook"))).toEqual([]);
      const [stamp] = await readdir(path.join(dir, ".trash"));
      expect((await disk(dir, `.trash/${stamp}/notebook/Old.md`)).toString()).toBe("keep me");
      expect(await codeOf(deleteNote(ref("Old")))).toBe("not_found");
    }));
});

describe("discardIfEmpty", () => {
  it("permanently deletes empty and whitespace-only notes", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/Untitled.md": "", "notebook/Untitled 2.md": " \n\t\n" });
      expect(await discardIfEmpty(ref("Untitled"))).toBe(true);
      expect(await discardIfEmpty(ref("Untitled 2"))).toBe(true);
      expect(await readdir(dir)).toEqual(["notebook"]); // nothing in .trash
      expect(await readdir(path.join(dir, "notebook"))).toEqual([]);
    }));

  it("keeps notes with content or invalid UTF-8, and never throws for missing ones", () =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/Text.md": "x", "notebook/Binary.md": Buffer.from([0x20, 0xff]) });
      expect(await discardIfEmpty(ref("Text"))).toBe(false);
      expect(await discardIfEmpty(ref("Binary"))).toBe(false);
      expect(await discardIfEmpty(ref("Missing"))).toBe(false);
      expect(await discardIfEmpty(ref("x", "no-folder"))).toBe(false);
      expect(await discardIfEmpty(ref("../x"))).toBe(false);
      expect((await readdir(path.join(dir, "notebook"))).sort()).toEqual(["Binary.md", "Text.md"]);
    }));
});

describe("readNoteFile", () => {
  it("returns the exact bytes on disk", () =>
    withTempDataDir(async (dir) => {
      const bytes = Buffer.concat([BOM, Buffer.from("a\r\n")]);
      await seed(dir, { "notebook/Win.md": bytes });
      const file = await readNoteFile(ref("Win"));
      expect(Buffer.from(file.bytes)).toEqual(bytes);
      expect(file.mtime).toBeInstanceOf(Date);
      expect(await codeOf(readNoteFile(ref("Nope")))).toBe("not_found");
    }));
});

describe("mostRecentNote", () => {
  it("returns the most recently modified note, or null", () =>
    withTempDataDir(async (dir) => {
      expect(await mostRecentNote()).toBeNull();
      await seed(dir, { "a/Old.md": "", "b/New.md": "", "b/Older.md": "" });
      await utimes(path.join(dir, "a/Old.md"), PAST, new Date("2024-01-01"));
      await utimes(path.join(dir, "b/Older.md"), PAST, PAST);
      await utimes(path.join(dir, "b/New.md"), PAST, new Date("2025-01-01"));
      expect(await mostRecentNote()).toEqual({ folder: "b", name: "New" });
    }));
});

describe("path traversal", () => {
  it.each([
    ["..", "x"],
    ["notebook", "../Secret"],
    ["notebook", "a/b"],
    ["notebook", `a${NUL}b`],
    [".trash", "Old"],
    ["notebook", ".hidden"],
    [".hidden", "Secret"],
  ])("rejects folder %j / name %j", (folder, name) =>
    withTempDataDir(async (dir) => {
      await seed(dir, {
        "Secret.md": "root",
        "notebook/.hidden.md": "",
        "notebook/x.md": "",
        ".trash/Old.md": "",
        ".hidden/Secret.md": "",
      });
      const r = { folder, name };
      expect(await codeOf(readNote(r))).toBe("not_found");
      expect(await codeOf(readNoteFile(r))).toBe("not_found");
      expect(await codeOf(saveNote({ ref: r, content: "pwned", baseVersion: null, force: true }))).toBe(
        "not_found",
      );
      expect(await codeOf(deleteNote(r))).toBe("not_found");
      expect(await codeOf(updateNote({ ref: r, newName: "Moved" }))).toBe("not_found");
    }),
  );

  it.each(["..", ".trash", ".hidden", "a/b"])("refuses to move a note into %j", (folder) =>
    withTempDataDir(async (dir) => {
      await seed(dir, { "notebook/x.md": "", ".trash/keep": "", ".hidden/keep": "" });
      expect(await codeOf(updateNote({ ref: ref("x"), newFolder: folder }))).toBe("not_found");
      expect(await readdir(path.join(dir, "notebook"))).toEqual(["x.md"]);
    }),
  );
});
