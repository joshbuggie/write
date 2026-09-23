import { beforeEach, describe, expect, it } from "vitest";
import type { Note } from "@/lib/types";
import {
  expectHandover,
  forgetFolder,
  forgetMove,
  forgetNote,
  isSavedHere,
  isStrictlyOlder,
  latestKnown,
  movedTo,
  newerState,
  noteCreated,
  recordDiskState,
  recordMove,
  resetKnownNotes,
  takeHandover,
} from "./known-notes";

const ref = { folder: "notebook", name: "Plain" };
/** The server's mtime for the nth write of the test's story, one second apart. */
const at = (n: number) => new Date(Date.UTC(2026, 8, 22, 12, 0, n)).toISOString();
const note = (version: string, content: string, updatedAt: string, where = ref): Note => ({
  ...where,
  version,
  content,
  updatedAt,
  size: content.length,
  readOnly: null,
});
const state = (version: string, content: string, updatedAt: string) => ({ version, content, updatedAt });

beforeEach(() => resetKnownNotes());

describe("isStrictlyOlder", () => {
  it("orders server mtimes, and treats equal or unreadable ones as not older", () => {
    expect(isStrictlyOlder(at(1), at(2))).toBe(true);
    expect(isStrictlyOlder(at(2), at(1))).toBe(false);
    expect(isStrictlyOlder(at(1), at(1))).toBe(false);
    expect(isStrictlyOlder("2026-09-22T12:00:00.001Z", "2026-09-22T12:00:00.002Z")).toBe(true);
    expect(isStrictlyOlder("garbage", at(2))).toBe(false);
    expect(isStrictlyOlder(at(1), "")).toBe(false);
  });
});

describe("newerState", () => {
  it("keeps what is known only when the incoming state is strictly older", () => {
    const known = state("v2", "two", at(2));
    expect(newerState(undefined, state("v1", "one", at(1)))).toMatchObject({ version: "v1" });
    expect(newerState(known, state("v1", "one", at(1)))).toBe(known);
    expect(newerState(known, state("v3", "three", at(2)))).toMatchObject({ version: "v3" });
    expect(newerState(known, state("v4", "four", at(3)))).toMatchObject({ version: "v4" });
  });
});

describe("latestKnown", () => {
  it("opens from props the first time", () => {
    const first = note("v1", "one", at(1));
    expect(latestKnown(first)).toBe(first);
  });

  it("ignores stale props replayed by back/forward and opens from this tab's newest save", () => {
    latestKnown(note("v1", "one", at(1))); // first visit
    recordDiskState(ref, state("v2", "one two", at(2)), { savedHere: true });
    recordDiskState(ref, state("v3", "one two three", at(3)), { savedHere: true });
    const opened = latestKnown(note("v1", "one", at(1))); // the cached first-visit payload
    expect(opened).toMatchObject({ version: "v3", content: "one two three", updatedAt: at(3) });
  });

  it("takes newer props (edited elsewhere after this tab's save)", () => {
    latestKnown(note("v1", "one", at(1)));
    recordDiskState(ref, state("v2", "mine", at(2)), { savedHere: true });
    const fresh = note("v9", "someone else's", at(5));
    expect(latestKnown(fresh)).toBe(fresh);
  });

  it("lets props with the same mtime win", () => {
    recordDiskState(ref, state("v2", "mine", at(2)), { savedHere: true });
    const same = note("v9", "theirs", at(2));
    expect(latestKnown(same)).toBe(same);
  });

  it("ignores a fetch that raced a save and returned the state before it", () => {
    latestKnown(note("v1", "one", at(1)));
    recordDiskState(ref, state("v2", "two", at(2)), { savedHere: true });
    recordDiskState(ref, state("v1", "one", at(1))); // GET sent before the PUT
    expect(latestKnown(note("v2", "two", at(2))).content).toBe("two");
  });

  it("accepts a save that undoes back to an old version's bytes", () => {
    latestKnown(note("v1", "one", at(1)));
    recordDiskState(ref, state("v2", "one!", at(2)), { savedHere: true });
    recordDiskState(ref, state("v1", "one", at(3)), { savedHere: true });
    expect(latestKnown(note("v2", "one!", at(2)))).toMatchObject({ version: "v1", content: "one" });
  });

  it("opens a new note that reuses a hash this tab saw replaced as itself (client-R3-1)", () => {
    // New note "Untitled" (empty, version E), typed into, saved; then a new empty note with that name.
    latestKnown(note("E", "", at(1)));
    recordDiskState(ref, state("V1", "secret old text", at(2)), { savedHere: true });
    const fresh = note("E", "", at(3));
    expect(latestKnown(fresh)).toBe(fresh);
  });
});

describe("forgetting", () => {
  const deletedThenRecreated = (forget: () => void, fresh: Note) => {
    latestKnown(note("E", "", at(1), fresh));
    recordDiskState(fresh, state("V1", "secret old text", at(5)), { savedHere: true });
    forget();
    return latestKnown(fresh);
  };

  it("forgets a deleted or discarded note, even if the next file with its name looks older", () => {
    // An older mtime is possible for a file put there by a sync tool or a rename; the entry must be gone.
    const fresh = note("E", "", at(1));
    expect(deletedThenRecreated(() => forgetNote(ref), fresh)).toBe(fresh);
    expect(isSavedHere(ref, "V1")).toBe(false);
  });

  it("forgets the name a new note was created under, and its rename pointer", () => {
    recordMove(ref, { folder: "notebook", name: "Probe C" });
    const fresh = note("E", "", at(1));
    expect(deletedThenRecreated(() => noteCreated(ref), fresh)).toBe(fresh);
    expect(movedTo(ref)).toBeNull();
  });

  it("forgets both names on a rename or move", () => {
    const to = { folder: "Work", name: "Probe C" };
    recordDiskState(to, state("X1", "an old note at the target name", at(9)));
    const fresh = note("E", "", at(1));
    expect(deletedThenRecreated(() => recordMove(ref, to), fresh)).toBe(fresh);
    const renamed = note("V1", "secret old text", at(5), to); // a rename keeps the mtime
    expect(latestKnown(renamed)).toBe(renamed);
  });

  it("forgets every note of a deleted or renamed folder, and pointers into it", () => {
    const other = { folder: "Other", name: "Plain" };
    recordDiskState(other, state("O1", "other folder", at(9)));
    recordMove({ folder: "Other", name: "Old" }, { folder: "notebook", name: "Somewhere" });
    const fresh = note("E", "", at(1));
    expect(deletedThenRecreated(() => forgetFolder("notebook"), fresh)).toBe(fresh);
    expect(movedTo({ folder: "Other", name: "Old" })).toBeNull();
    expect(latestKnown(note("O0", "older", at(1), other)).content).toBe("other folder"); // untouched
  });

  it("drops a handover waiting for a note that went away", () => {
    expectHandover(ref, { snapshot: { content: "x", caret: 0 }, focus: false });
    forgetNote(ref);
    expect(takeHandover(ref)).toBeNull();
  });
});

describe("isSavedHere", () => {
  it("knows only the versions this tab's saves produced", () => {
    latestKnown(note("v1", "one", at(1)));
    recordDiskState(ref, state("v2", "two", at(2)), { savedHere: true });
    expect(isSavedHere(ref, "v2")).toBe(true);
    expect(isSavedHere(ref, "v1")).toBe(false);
    expect(isSavedHere({ folder: "x", name: "y" }, "v2")).toBe(false);
  });

  it("remembers a save even when a newer state from elsewhere arrived first", () => {
    recordDiskState(ref, state("v3", "theirs", at(3)));
    recordDiskState(ref, state("v2", "mine", at(2)), { savedHere: true });
    expect(isSavedHere(ref, "v2")).toBe(true);
    expect(latestKnown(note("v1", "one", at(1))).content).toBe("theirs");
  });
});

describe("moves", () => {
  it("points an old name to the new one until a note takes the old name again", () => {
    const to = { folder: "notebook", name: "Groceries" };
    recordMove(ref, to);
    expect(movedTo(ref)).toEqual(to);
    expect(movedTo(to)).toBeNull();
    forgetMove(ref);
    expect(movedTo(ref)).toBeNull();
  });

  it("clears the pointer when a note is renamed back", () => {
    const to = { folder: "notebook", name: "Groceries" };
    recordMove(ref, to);
    recordMove(to, ref);
    expect(movedTo(ref)).toBeNull();
    expect(movedTo(to)).toEqual(ref);
  });
});

describe("handovers", () => {
  it("is consumed once, by the note it was meant for", () => {
    const handover = { snapshot: { content: "Line one", caret: 7 }, focus: true };
    expectHandover(ref, handover);
    expect(takeHandover({ folder: "notebook", name: "Other" })).toBeNull();
    expect(takeHandover(ref)).toBe(handover);
    expect(takeHandover(ref)).toBeNull();
  });
});
