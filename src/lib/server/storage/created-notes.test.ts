import { describe, expect, it } from "vitest";
import { createdRecordFor, createNoteFor, dismissCreatedRecord } from "./created-notes";
import { createFolder, deleteFolder, renameFolder } from "./folders";
import { createNote, deleteNote, updateNote } from "./notes";
import { withTempDataDir } from "./test-utils";

/** "Created by" records follow their note, and never pass to a later note with the same name. */

const make = (name: string) =>
  createNoteFor({
    integrationId: "i1",
    source: "Hermes",
    requestId: null,
    ref: { folder: "Essays", name },
    content: "Hi.\n",
    canRead: () => true,
  });

describe("created-note records", () => {
  it("follow the note through renames and folder renames", () =>
    withTempDataDir(async () => {
      await createFolder("Essays");
      await make("A");
      await updateNote({ ref: { folder: "Essays", name: "A" }, newName: "B" });
      expect(await createdRecordFor({ folder: "Essays", name: "A" })).toBeNull();
      expect(await createdRecordFor({ folder: "Essays", name: "B" })).toMatchObject({ source: "Hermes" });
      await renameFolder("Essays", "Writing");
      expect(await createdRecordFor({ folder: "Writing", name: "B" })).not.toBeNull();
    }));

  it("go with a deleted note or folder, so a new note with that name doesn't inherit them", () =>
    withTempDataDir(async () => {
      await createFolder("Essays");
      await make("A");
      await deleteNote({ folder: "Essays", name: "A" });
      await createNote({ folder: "Essays", name: "A" });
      expect(await createdRecordFor({ folder: "Essays", name: "A" })).toBeNull();

      await make("C");
      await deleteFolder("Essays");
      await createFolder("Essays");
      await createNote({ folder: "Essays", name: "C" });
      expect(await createdRecordFor({ folder: "Essays", name: "C" })).toBeNull();
    }));

  it("stop showing once dismissed", () =>
    withTempDataDir(async () => {
      await createFolder("Essays");
      await make("A");
      const record = await createdRecordFor({ folder: "Essays", name: "A" });
      await dismissCreatedRecord(record!.id);
      expect(await createdRecordFor({ folder: "Essays", name: "A" })).toBeNull();
      await dismissCreatedRecord("gone"); // already gone is fine
    }));
});
