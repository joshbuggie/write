import { beforeEach, describe, expect, it } from "vitest";
import type { Note } from "@/lib/types";
import {
  expectHandover,
  forgetFolder,
  forgetMove,
  forgetNote,
  isSameNote,
  isSavedHere,
  isStrictlyOlder,
  latestKnown,
  movedTo,
  newerState,
  noteCreated,
  noteRecreated,
  recordDiskState,
  recordMove,
  resetKnownNotes,
  stateKey,
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
  const known = {
    ...state("v2", "two", at(2)),
    seen: new Set([stateKey(state("v1", "", at(1))), stateKey(state("v2", "", at(2)))]),
  };

  it("keeps what is known over replayed props of a state it has seen", () => {
    expect(newerState(undefined, state("v1", "one", at(1)))).toMatchObject({ version: "v1" });
    expect(newerState(known, state("v1", "one", at(1)), "props")).toBe(known);
  });

  it("lets a state it has never seen win, whatever its mtime and source", () => {
    expect(newerState(known, state("x", "renamed here", at(1)), "props")).toMatchObject({ version: "x" });
    expect(newerState(known, state("v1", "one", at(3)), "props")).toMatchObject({ version: "v1" }); // an undo, saved elsewhere
    expect(newerState(known, state("v3", "three", at(2)), "fetched")).toMatchObject({ version: "v3" });
  });

  it("orders a fetched state it has seen by mtime (a GET that raced a save)", () => {
    expect(newerState(known, state("v1", "one", at(1)), "fetched")).toBe(known);
  });

  it("orders this tab's own saves by mtime alone", () => {
    expect(newerState(known, state("v1", "one", at(1)), "saved")).toBe(known);
    expect(newerState(known, state("v4", "four", at(3)), "saved")).toMatchObject({ version: "v4" });
  });
});

describe("latestKnown", () => {
  it("opens from props the first time", () => {
    const first = note("v1", "one", at(1));
    expect(latestKnown(first)).toBe(first);
  });

  it("ignores stale props replayed by back/forward and opens from this tab's newest save (DS-1)", () => {
    latestKnown(note("v1", "one", at(1))); // first visit
    recordDiskState(ref, state("v2", "one two", at(2)), "saved");
    recordDiskState(ref, state("v3", "one two three", at(3)), "saved");
    const opened = latestKnown(note("v1", "one", at(1))); // the cached first-visit payload
    expect(opened).toMatchObject({ version: "v3", content: "one two three", updatedAt: at(3) });
  });

  it("takes newer props (edited elsewhere after this tab's save)", () => {
    latestKnown(note("v1", "one", at(1)));
    recordDiskState(ref, state("v2", "mine", at(2)), "saved");
    const fresh = note("v9", "someone else's", at(5));
    expect(latestKnown(fresh)).toBe(fresh);
  });

  it("lets props with the same mtime win", () => {
    recordDiskState(ref, state("v2", "mine", at(2)), "saved");
    const same = note("v9", "theirs", at(2));
    expect(latestKnown(same)).toBe(same);
  });

  it("ignores a fetch that raced a save and returned the state before it", () => {
    latestKnown(note("v1", "one", at(1)));
    recordDiskState(ref, state("v2", "two", at(2)), "saved");
    recordDiskState(ref, state("v1", "one", at(1))); // GET sent before the PUT
    expect(latestKnown(note("v2", "two", at(2))).content).toBe("two");
  });

  it("accepts a save that undoes back to an old version's bytes", () => {
    latestKnown(note("v1", "one", at(1)));
    recordDiskState(ref, state("v2", "one!", at(2)), "saved");
    recordDiskState(ref, state("v1", "one", at(3)), "saved");
    expect(latestKnown(note("v2", "one!", at(2)))).toMatchObject({ version: "v1", content: "one" });
  });

  it("takes an external change this tab never saw, even with an older mtime (client-R4-1)", () => {
    // Another tab deleted this note and renamed an older one onto its name; a rename keeps the mtime.
    latestKnown(note("E", "", at(1)));
    recordDiskState(ref, state("S", "second note body", at(5)), "saved");
    const renamedOnto = note("W", "welcome text", at(3));
    expect(latestKnown(renamedOnto)).toBe(renamedOnto);
    // Also a file put there by hand or by a sync tool that keeps mtimes, and what a later fetch says.
    const synced = note("D1", "draft text", at(2));
    expect(latestKnown(synced)).toBe(synced);
    // A replay of the page from when S was current doesn't bring S back; a fetch that says S does.
    expect(latestKnown(note("S", "second note body", at(5))).content).toBe("draft text");
    expect(latestKnown(note("S", "second note body", at(5)), "fetched").content).toBe("second note body");
  });

  it("keeps an external change over a replayed page after back and forward (client-R4-1 follow-up)", () => {
    latestKnown(note("E", "", at(8))); // first visit
    recordDiskState(ref, state("S", "typed here", at(9)), "saved");
    expect(latestKnown(note("E", "", at(8))).version).toBe("S"); // Back replays the first visit
    const renamedOnto = note("W", "welcome text", at(7)); // the mount GET finds another file here now
    expect(latestKnown(renamedOnto, "fetched")).toBe(renamedOnto);
    expect(latestKnown(note("E", "", at(8))).version).toBe("W"); // Forward, then Back replays it again
    expect(latestKnown(note("S", "typed here", at(9))).version).toBe("W"); // or the page after the save
    expect(latestKnown(renamedOnto, "fetched")).toBe(renamedOnto); // and the next GET agrees
  });

  it("opens a new note that reuses a hash this tab saw replaced as itself (client-R3-1)", () => {
    // New note "Untitled" (empty, version E), typed into, saved; then a new empty note with that name.
    latestKnown(note("E", "", at(1)));
    recordDiskState(ref, state("V1", "secret old text", at(2)), "saved");
    const fresh = note("E", "", at(3));
    expect(latestKnown(fresh)).toBe(fresh);
  });

  it("opens an empty note deleted and recreated outside write as itself", () => {
    // Deleted in Finder (so this tab never forgot it) and recreated: a new file gets the current mtime.
    latestKnown(note("E", "", at(1)));
    recordDiskState(ref, state("V1", "old text", at(2)), "saved");
    const recreated = note("E", "", at(4));
    expect(latestKnown(recreated)).toBe(recreated);
  });

  it("keeps its newer text over an older version it saw, restored with its old mtime (accepted)", () => {
    // Put back from .trash by hand: indistinguishable from a replayed page. The tab keeps its text until
    // the next save's 409 offers the disk version, or a reload.
    latestKnown(note("v1", "one", at(1)));
    recordDiskState(ref, state("v2", "one two", at(2)), "saved");
    expect(latestKnown(note("v1", "one", at(1)))).toMatchObject({ version: "v2", content: "one two" });
  });
});

describe("forgetting", () => {
  const deletedThenRecreated = (forget: () => void, fresh: Note) => {
    latestKnown(note("E", "", at(1), fresh));
    recordDiskState(fresh, state("V1", "secret old text", at(5)), "saved");
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
    recordDiskState(other, state("O0", "older", at(1)));
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
    recordDiskState(ref, state("v2", "two", at(2)), "saved");
    expect(isSavedHere(ref, "v2")).toBe(true);
    expect(isSavedHere(ref, "v1")).toBe(false);
    expect(isSavedHere({ folder: "x", name: "y" }, "v2")).toBe(false);
  });

  it("remembers a save even when a newer state from elsewhere arrived first", () => {
    recordDiskState(ref, state("v3", "theirs", at(3)));
    recordDiskState(ref, state("v2", "mine", at(2)), "saved");
    expect(isSavedHere(ref, "v2")).toBe(true);
    expect(latestKnown(note("v2", "mine", at(2))).content).toBe("theirs");
  });
});

describe("noteRecreated", () => {
  it("opens the copy saved under a deleted note's name, not the old file's props (client-R4-2)", () => {
    latestKnown(note("v1", "old file", at(1)));
    const copy = note("C", "my text", at(5));
    forgetNote(ref); // what saveCopy did before: the old file is gone (sync.abandon)
    noteRecreated(copy, { version: "v1", updatedAt: at(1) });
    expect(latestKnown(note("v1", "old file", at(1)))).toMatchObject({ version: "C", content: "my text" });
    expect(isSavedHere(ref, "C")).toBe(true);
    const later = note("v9", "edited elsewhere", at(7));
    expect(latestKnown(later)).toBe(later);
  });

  it("clears a rename pointer left at that name", () => {
    recordMove(ref, { folder: "notebook", name: "Elsewhere" });
    noteRecreated(note("C", "my text", at(5)), { version: "v1", updatedAt: at(1) });
    expect(movedTo(ref)).toBeNull();
  });
});

describe("isSameNote", () => {
  it("compares folder and name", () => {
    expect(isSameNote(ref, { folder: "notebook", name: "Plain" })).toBe(true);
    expect(isSameNote(ref, { folder: "Work", name: "Plain" })).toBe(false);
    expect(isSameNote(ref, { folder: "notebook", name: "Plain 2" })).toBe(false);
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
