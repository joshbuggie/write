import { describe, expect, it } from "vitest";
import type { NoteRef } from "@/lib/types";
import { createFolder, deleteFolder } from "./folders";
import { latestJob, saveJob } from "./jobs";
import { createNote, deleteNote, discardIfEmpty, updateNote } from "./notes";
import { withTempDataDir } from "./test-utils";

/** "Send to…" conversations stay with their note, and never pass to a new note with the same name. */

const ref = { folder: "Essays", name: "Draft" };

const sendTo = (note: NoteRef) =>
  saveJob({
    id: "a".repeat(32),
    integrationId: "i1",
    kind: "hermes",
    note,
    instruction: "Revise",
    sections: [],
    ref: { sessionId: "old-session" },
    continued: false,
    createdAt: new Date().toISOString(),
  });

describe("jobs", () => {
  it("follow a renamed or moved note", () =>
    withTempDataDir(async () => {
      await createFolder("Essays");
      await createFolder("Other");
      await createNote({ ...ref, content: "x\n" });
      await sendTo(ref);
      await updateNote({ ref, newName: "Final", newFolder: "Other" });
      expect(await latestJob("i1", { folder: "Other", name: "Final" })).toMatchObject({
        ref: { sessionId: "old-session" },
      });
    }));

  it("go with a deleted or discarded note, so a new one under its name starts fresh", () =>
    withTempDataDir(async () => {
      await createFolder("Essays");
      await createNote({ ...ref, content: "Old.\n" });
      await sendTo(ref);
      await deleteNote(ref);
      await createNote({ ...ref, content: "Unrelated.\n" });
      expect(await latestJob("i1", ref)).toBeNull();

      await deleteNote(ref);
      await createNote({ ...ref, content: "" });
      await sendTo(ref);
      expect(await discardIfEmpty(ref)).toBe(true);
      await createNote({ ...ref, content: "Another.\n" });
      expect(await latestJob("i1", ref)).toBeNull();
    }));

  it("go with a deleted folder", () =>
    withTempDataDir(async () => {
      await createFolder("Essays");
      await createNote({ ...ref, content: "Old.\n" });
      await sendTo(ref);
      await deleteFolder("Essays");
      await createFolder("Essays");
      await createNote({ ...ref, content: "New.\n" });
      expect(await latestJob("i1", ref)).toBeNull();
    }));
});
