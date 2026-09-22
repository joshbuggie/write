import { beforeEach, describe, expect, it } from "vitest";
import type { Note } from "@/lib/types";
import {
  expectHandover,
  forgetMove,
  isSavedHere,
  latestKnown,
  movedTo,
  recordDiskState,
  recordMove,
  resetKnownNotes,
  takeHandover,
} from "./known-notes";

const ref = { folder: "notebook", name: "Plain" };
const note = (version: string, content: string): Note => ({
  ...ref,
  version,
  content,
  updatedAt: "2026-09-22T12:00:00.000Z",
  size: content.length,
  readOnly: null,
});

beforeEach(() => resetKnownNotes());

describe("latestKnown", () => {
  it("opens from props the first time", () => {
    const first = note("v1", "one");
    expect(latestKnown(first)).toBe(first);
  });

  it("ignores stale props replayed by back/forward and opens from this tab's newest save", () => {
    latestKnown(note("v1", "one")); // first visit
    recordDiskState(ref, { content: "one two", version: "v2" }, { savedHere: true });
    recordDiskState(ref, { content: "one two three", version: "v3" }, { savedHere: true });
    const opened = latestKnown(note("v1", "one")); // the cached first-visit payload
    expect(opened).toMatchObject({ version: "v3", content: "one two three" });
  });

  it("takes props with a version this tab has never seen (edited elsewhere)", () => {
    latestKnown(note("v1", "one"));
    recordDiskState(ref, { content: "mine", version: "v2" }, { savedHere: true });
    const fresh = note("v9", "someone else's");
    expect(latestKnown(fresh)).toBe(fresh);
  });

  it("ignores a fetch that raced a save and returned the version before it", () => {
    latestKnown(note("v1", "one"));
    recordDiskState(ref, { content: "two", version: "v2" }, { savedHere: true });
    recordDiskState(ref, { content: "one", version: "v1" }); // GET sent before the PUT
    expect(latestKnown(note("v2", "two")).content).toBe("two");
  });

  it("accepts a save that undoes back to an old version's bytes", () => {
    latestKnown(note("v1", "one"));
    recordDiskState(ref, { content: "one!", version: "v2" }, { savedHere: true });
    recordDiskState(ref, { content: "one", version: "v1" }, { savedHere: true });
    expect(latestKnown(note("v2", "one!"))).toMatchObject({ version: "v1", content: "one" });
  });
});

describe("isSavedHere", () => {
  it("knows only the versions this tab's saves produced", () => {
    latestKnown(note("v1", "one"));
    recordDiskState(ref, { content: "two", version: "v2" }, { savedHere: true });
    expect(isSavedHere(ref, "v2")).toBe(true);
    expect(isSavedHere(ref, "v1")).toBe(false);
    expect(isSavedHere({ folder: "x", name: "y" }, "v2")).toBe(false);
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
    expectHandover(ref, 7);
    expect(takeHandover({ folder: "notebook", name: "Other" })).toBeNull();
    expect(takeHandover(ref)).toBe(7);
    expect(takeHandover(ref)).toBeNull();
  });
});
