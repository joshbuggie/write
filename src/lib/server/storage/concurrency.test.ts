import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createNote, readNote, saveNote, StorageError } from "./index";
import { withTempDataDir } from "./test-utils";

describe("write lock", () => {
  it("serializes 50 parallel saves from the same base version: one wins, the rest conflict", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "notebook"));
      const { name, version } = await createNote({ folder: "notebook", name: "Race" });
      const ref = { folder: "notebook", name };
      const results = await Promise.allSettled(
        Array.from({ length: 50 }, (_, i) =>
          saveNote({ ref, content: `writer ${i}\n`, baseVersion: version }),
        ),
      );
      const winners = results.filter((r) => r.status === "fulfilled");
      const conflicts = results.filter(
        (r) =>
          r.status === "rejected" && r.reason instanceof StorageError && r.reason.code === "version_conflict",
      );
      expect(winners).toHaveLength(1);
      expect(conflicts).toHaveLength(49);
      expect((await readNote(ref)).version).toBe(
        winners[0].status === "fulfilled" && winners[0].value.version,
      );
    }));

  it("applies 50 parallel forced saves one at a time, never interleaving bytes", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "notebook"));
      const { name } = await createNote({ folder: "notebook", name: "Race" });
      const ref = { folder: "notebook", name };
      const contents = Array.from({ length: 50 }, (_, i) => `writer ${i}\n`.repeat(2000));
      await Promise.all(
        contents.map((content) => saveNote({ ref, content, baseVersion: null, force: true })),
      );
      expect(contents).toContain(await readFile(path.join(dir, "notebook/Race.md"), "utf8"));
      expect(await readdir(path.join(dir, "notebook"))).toEqual(["Race.md"]);
    }));

  it("gives parallel creates distinct names", () =>
    withTempDataDir(async (dir) => {
      await mkdir(path.join(dir, "notebook"));
      const notes = await Promise.all(Array.from({ length: 20 }, () => createNote({ folder: "notebook" })));
      expect(new Set(notes.map((n) => n.name)).size).toBe(20);
      expect(await readdir(path.join(dir, "notebook"))).toHaveLength(20);
    }));
});
