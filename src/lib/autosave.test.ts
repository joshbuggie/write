import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody, ErrorCode } from "./api-contract";
import { ApiError } from "./api-client";
import { createAutosaver, SIGNED_OUT_MESSAGE, type AutosaverDeps, type AutosaverOptions } from "./autosave";
import { KEEPALIVE_MAX_BYTES } from "./constants";
import type { Note, SavedNote } from "./types";

type SaveInput = Parameters<AutosaverDeps["save"]>[0];

const savedNote = (version: string): SavedNote => ({
  folder: "notebook",
  name: "Note",
  updatedAt: "2026-09-22T12:00:00.000Z",
  size: 10,
  version,
});

const diskNote: Note = { ...savedNote("disk"), content: "theirs\n", readOnly: null };

function apiError(
  code: ErrorCode | "network",
  message = `failed: ${code}`,
  body: ApiErrorBody | null = null,
) {
  return new ApiError(code === "network" ? 0 : 500, code, message, body);
}

/** An autosaver whose save() calls stay pending until the test resolves or rejects them. */
function setup(options: Partial<AutosaverOptions> = {}) {
  let content = "base\n";
  let online = true;
  let versionCounter = 1;
  const pending: Array<{ resolve: (n: SavedNote) => void; reject: (e: unknown) => void }> = [];
  const save = vi.fn(
    (input: SaveInput, opts: { keepalive: boolean }) =>
      new Promise<SavedNote>((resolve, reject) => {
        void input;
        void opts;
        pending.push({ resolve, reject });
      }),
  );
  const drafts = { write: vi.fn(), clear: vi.fn() };
  const saver = createAutosaver(
    { getContent: () => content, save, drafts, isOnline: () => online },
    { baseline: "base\n", version: "v1", ...options },
  );
  const settle = () => vi.advanceTimersByTimeAsync(0);
  return {
    saver,
    save,
    drafts,
    edit(next: string) {
      content = next;
      saver.markDirty();
    },
    setOnline(value: boolean) {
      online = value;
    },
    async resolveSave(version = `v${++versionCounter}`) {
      pending.shift()?.resolve(savedNote(version));
      await settle();
      return version;
    },
    async rejectSave(error: unknown) {
      pending.shift()?.reject(error);
      await settle();
    },
    settle,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("debounce and max wait", () => {
  it("saves 750 ms after the last edit, based on the open version", async () => {
    const t = setup();
    t.edit("one\n");
    expect(t.saver.getState()).toEqual({ kind: "dirty" });
    await vi.advanceTimersByTimeAsync(500);
    t.edit("two\n");
    await vi.advanceTimersByTimeAsync(749);
    expect(t.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.save).toHaveBeenCalledWith(
      { content: "two\n", baseVersion: "v1", force: false },
      { keepalive: false },
    );
    expect(t.saver.getState()).toEqual({ kind: "saving" });
    const version = await t.resolveSave();
    expect(t.saver.getState()).toEqual({ kind: "saved", at: Date.now() });
    expect(t.saver.getVersion()).toBe(version);
  });

  it("never waits longer than maxWait while typing continuously", async () => {
    const t = setup();
    for (let i = 0; i < 10; i++) {
      t.edit(`typing ${i}\n`);
      if (i < 9) await vi.advanceTimersByTimeAsync(500);
    }
    // Now at 4.5 s with an edit just made: debounce alone would wait until 5.25 s.
    await vi.advanceTimersByTimeAsync(499);
    expect(t.save).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.save).toHaveBeenCalledTimes(1);
  });

  it("does not PUT when the content equals the baseline", async () => {
    const t = setup();
    t.edit("changed\n");
    t.edit("base\n"); // typed, then undone
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.save).not.toHaveBeenCalled();
    expect(t.saver.getState()).toEqual({ kind: "saved", at: null });
    expect(t.saver.hasUnsavedChanges()).toBe(false);
  });

  it("notifies subscribers on state changes only", async () => {
    const t = setup();
    const listener = vi.fn();
    const unsubscribe = t.saver.subscribe(listener);
    t.edit("a\n");
    t.edit("ab\n");
    t.edit("abc\n");
    expect(listener).toHaveBeenCalledTimes(1); // saved → dirty
    unsubscribe();
    await vi.advanceTimersByTimeAsync(750);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("single flight", () => {
  it("runs at most one save and exactly one follow-up for edits made meanwhile", async () => {
    const t = setup();
    t.edit("first\n");
    await vi.advanceTimersByTimeAsync(750);
    t.edit("second\n");
    t.edit("third\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.save).toHaveBeenCalledTimes(1);

    const v2 = await t.resolveSave();
    expect(t.saver.getState()).toEqual({ kind: "dirty" });
    await vi.advanceTimersByTimeAsync(750);
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.save.mock.calls[1][0]).toEqual({ content: "third\n", baseVersion: v2, force: false });

    await t.resolveSave();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.saver.getState().kind).toBe("saved");
  });

  it("knows every version it produced", async () => {
    const t = setup();
    t.edit("x\n");
    await vi.advanceTimersByTimeAsync(750);
    const v2 = await t.resolveSave();
    expect(t.saver.isKnownVersion("v1")).toBe(true);
    expect(t.saver.isKnownVersion(v2)).toBe(true);
    expect(t.saver.isKnownVersion("someone-else")).toBe(false);
  });
});

describe("drafts", () => {
  it("writes the draft before every PUT and clears it after a clean 200", async () => {
    const t = setup();
    t.edit("draft me\n");
    await vi.advanceTimersByTimeAsync(750);
    expect(t.drafts.write).toHaveBeenCalledWith("draft me\n", "v1");
    expect(t.drafts.write.mock.invocationCallOrder[0]).toBeLessThan(t.save.mock.invocationCallOrder[0]);
    await t.resolveSave();
    expect(t.drafts.clear).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft when the content changed while the PUT was in flight", async () => {
    const t = setup();
    t.edit("one\n");
    await vi.advanceTimersByTimeAsync(750);
    t.edit("two\n");
    await t.resolveSave();
    expect(t.drafts.clear).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(750);
    await t.resolveSave();
    expect(t.drafts.clear).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft when the save fails", async () => {
    const t = setup();
    t.edit("one\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("internal"));
    expect(t.drafts.clear).not.toHaveBeenCalled();
  });

  it("drops a failed save's draft when a retry finds the edit undone", async () => {
    const t = setup();
    t.edit("edited\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("internal"));
    t.edit("base\n");
    await vi.advanceTimersByTimeAsync(1000); // the retry has nothing to send
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.drafts.clear).toHaveBeenCalledTimes(1);
    expect(t.saver.getState().kind).toBe("saved");
  });
});

describe("error mapping", () => {
  it.each<[ErrorCode | "network", boolean, unknown]>([
    ["network", true, { kind: "error", message: "failed: network", retrying: true }],
    ["network", false, { kind: "offline" }],
    ["internal", true, { kind: "error", message: "failed: internal", retrying: true }],
    ["storage_unavailable", true, { kind: "error", message: "failed: storage_unavailable", retrying: true }],
    ["unauthorized", true, { kind: "error", message: SIGNED_OUT_MESSAGE, retrying: false }],
    ["too_large", true, { kind: "error", message: "failed: too_large", retrying: false }],
    ["read_only", true, { kind: "error", message: "failed: read_only", retrying: false }],
    ["bad_request", true, { kind: "error", message: "failed: bad_request", retrying: false }],
    ["invalid_name", true, { kind: "error", message: "failed: invalid_name", retrying: false }],
    ["forbidden", true, { kind: "error", message: "failed: forbidden", retrying: false }],
    [
      "unsupported_media_type",
      true,
      { kind: "error", message: "failed: unsupported_media_type", retrying: false },
    ],
    ["not_found", true, { kind: "conflict", current: null }],
  ])("%s (online: %s) → %j", async (code, online, expected) => {
    const t = setup();
    t.setOnline(online);
    t.edit("mine\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError(code));
    expect(t.saver.getState()).toEqual(expected);
    expect(t.saver.hasUnsavedChanges()).toBe(true);
  });

  it("version_conflict carries the note on disk", async () => {
    const t = setup();
    t.edit("mine\n");
    await vi.advanceTimersByTimeAsync(750);
    const body: ApiErrorBody = { error: { code: "version_conflict", message: "changed" }, current: diskNote };
    await t.rejectSave(apiError("version_conflict", "changed", body));
    expect(t.saver.getState()).toEqual({ kind: "conflict", current: diskNote });
  });

  it("treats unexpected exceptions as retryable errors", async () => {
    const t = setup();
    t.edit("mine\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(new TypeError("boom"));
    expect(t.saver.getState()).toMatchObject({ kind: "error", retrying: true });
  });

  it("stops saving in conflict until the user decides", async () => {
    const t = setup();
    t.edit("mine\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("not_found"));
    t.edit("more\n");
    t.saver.retry();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.save).toHaveBeenCalledTimes(1);
  });

  it("tries again after the next edit when the error doesn't retry by itself", async () => {
    const t = setup();
    t.edit("x".repeat(10) + "\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("too_large", "Note is too large."));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.save).toHaveBeenCalledTimes(1);
    t.edit("smaller\n");
    expect(t.saver.getState()).toEqual({ kind: "dirty" });
    await vi.advanceTimersByTimeAsync(750);
    expect(t.save).toHaveBeenCalledTimes(2);
  });
});

describe("retries", () => {
  it("backs off 1s, 2s, 5s, 10s, 30s, 30s… and resets after a success", async () => {
    const t = setup();
    t.edit("mine\n");
    await vi.advanceTimersByTimeAsync(750);
    for (const delay of [1000, 2000, 5000, 10_000, 30_000, 30_000]) {
      await t.rejectSave(apiError("storage_unavailable"));
      const calls = t.save.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(t.save).toHaveBeenCalledTimes(calls);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.save).toHaveBeenCalledTimes(calls + 1);
    }
    await t.resolveSave();
    expect(t.saver.getState().kind).toBe("saved");

    t.edit("again\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("internal"));
    const calls = t.save.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.save).toHaveBeenCalledTimes(calls + 1);
  });

  it("retries offline saves when the browser comes back online", async () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const t = setup();
    t.setOnline(false);
    t.edit("offline edit\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("network"));
    expect(t.saver.getState()).toEqual({ kind: "offline" });

    t.setOnline(true);
    win.dispatchEvent(new Event("online"));
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.save.mock.calls[1][0].content).toBe("offline edit\n");
    await t.resolveSave();
    expect(t.saver.getState().kind).toBe("saved");
  });

  it("stops listening for online events after dispose", async () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const t = setup();
    t.setOnline(false);
    t.edit("offline edit\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("network"));
    t.saver.dispose();
    win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.save).toHaveBeenCalledTimes(1);
  });
});

describe("flush", () => {
  it("saves immediately and resolves once clean", async () => {
    const t = setup();
    t.edit("now\n");
    const flushed = t.saver.flush();
    expect(t.save).toHaveBeenCalledTimes(1);
    await t.resolveSave();
    await expect(flushed).resolves.toBeUndefined();
    expect(t.saver.getState().kind).toBe("saved");
  });

  it("is a no-op when nothing changed", async () => {
    const t = setup();
    await t.saver.flush();
    expect(t.save).not.toHaveBeenCalled();
  });

  it("waits for the save in flight, then saves newer edits", async () => {
    const t = setup();
    t.edit("one\n");
    await vi.advanceTimersByTimeAsync(750);
    t.edit("two\n");
    const flushed = t.saver.flush();
    const v2 = await t.resolveSave();
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.save.mock.calls[1][0]).toEqual({ content: "two\n", baseVersion: v2, force: false });
    await t.resolveSave();
    await expect(flushed).resolves.toBeUndefined();
  });

  it("rejects with the ApiError when the save fails", async () => {
    const t = setup();
    t.edit("now\n");
    const flushed = t.saver.flush();
    const error = apiError("read_only", "This note is read-only.");
    const assertion = expect(flushed).rejects.toBe(error);
    await t.rejectSave(error);
    await assertion;
  });

  it("rejects without saving while in conflict", async () => {
    const t = setup();
    t.edit("now\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("not_found"));
    await expect(t.saver.flush()).rejects.toMatchObject({ code: "not_found" });
    expect(t.save).toHaveBeenCalledTimes(1);
  });
});

describe("conflict resolution", () => {
  it("keepMine force-saves the current content", async () => {
    const t = setup();
    t.edit("mine\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("version_conflict"));
    const kept = t.saver.keepMine();
    await t.settle();
    expect(t.save).toHaveBeenLastCalledWith(
      { content: "mine\n", baseVersion: "v1", force: true },
      { keepalive: false },
    );
    const version = await t.resolveSave();
    await expect(kept).resolves.toBeUndefined();
    expect(t.saver.getState().kind).toBe("saved");
    expect(t.saver.getVersion()).toBe(version);
  });

  it("keepMine rejects when the forced save fails", async () => {
    const t = setup();
    t.edit("mine\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("version_conflict"));
    const kept = t.saver.keepMine();
    await t.settle();
    const assertion = expect(kept).rejects.toMatchObject({ code: "forbidden" });
    await t.rejectSave(apiError("forbidden"));
    await assertion;
  });

  it("adopt resets to the new baseline and version", async () => {
    const t = setup();
    t.edit("mine\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("version_conflict"));

    t.edit("theirs\n"); // the UI puts the disk content into the editor…
    t.saver.adopt("theirs\n", "disk"); // …and adopts it
    expect(t.saver.getState()).toEqual({ kind: "saved", at: null });
    expect(t.saver.getVersion()).toBe("disk");
    expect(t.saver.isKnownVersion("disk")).toBe(true);
    expect(t.drafts.clear).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.save).toHaveBeenCalledTimes(1);

    t.edit("theirs, edited\n");
    await vi.advanceTimersByTimeAsync(750);
    expect(t.save).toHaveBeenLastCalledWith(
      { content: "theirs, edited\n", baseVersion: "disk", force: false },
      { keepalive: false },
    );
  });

  it("ignores a save that finishes after adopt, but still saves edits made since", async () => {
    const t = setup();
    t.edit("mine\n");
    await vi.advanceTimersByTimeAsync(750);
    t.saver.adopt("base\n", "disk");
    t.edit("new edit\n");
    await vi.advanceTimersByTimeAsync(750); // the stale save is still in flight
    expect(t.save).toHaveBeenCalledTimes(1);
    await t.resolveSave("stale");
    expect(t.saver.getVersion()).toBe("disk");
    await vi.advanceTimersByTimeAsync(750);
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.save.mock.calls[1][0]).toEqual({ content: "new edit\n", baseVersion: "disk", force: false });
  });
});

describe("flushKeepalive", () => {
  it("writes the draft, then sends a keepalive PUT", () => {
    const t = setup();
    t.edit("closing\n");
    t.saver.flushKeepalive();
    expect(t.drafts.write).toHaveBeenCalledWith("closing\n", "v1");
    expect(t.save).toHaveBeenCalledWith(
      { content: "closing\n", baseVersion: "v1", force: false },
      { keepalive: true },
    );
    expect(t.drafts.write.mock.invocationCallOrder[0]).toBeLessThan(t.save.mock.invocationCallOrder[0]);
  });

  // The default body size is the JSON of { content, baseVersion, force }.
  const envelope = JSON.stringify({ content: "", baseVersion: "v1", force: false }).length;

  it("sends a request body of exactly KEEPALIVE_MAX_BYTES", () => {
    const t = setup();
    t.edit("x".repeat(KEEPALIVE_MAX_BYTES - envelope));
    t.saver.flushKeepalive();
    expect(t.save).toHaveBeenCalledTimes(1);
  });

  it("only writes the draft when the body is above KEEPALIVE_MAX_BYTES (counted in UTF-8 bytes)", () => {
    const t = setup();
    const big = "é".repeat((KEEPALIVE_MAX_BYTES - envelope) / 2 + 1); // 2 bytes each
    t.edit(big);
    t.saver.flushKeepalive();
    expect(t.save).not.toHaveBeenCalled();
    expect(t.drafts.write).toHaveBeenCalledWith(big, "v1");
  });

  it("measures the escaped JSON body, not the note text", () => {
    const t = setup();
    // 55 KiB of checklist lines: well under the limit as text, but every quote, tab and newline
    // doubles in JSON, which pushes the body past the browser's keepalive quota.
    const line = '- [ ] "item"\tx\n';
    const text = line.repeat(Math.floor((55 * 1024) / line.length));
    expect(new TextEncoder().encode(text).length).toBeLessThan(KEEPALIVE_MAX_BYTES);
    t.edit(text);
    t.saver.flushKeepalive();
    expect(t.save).not.toHaveBeenCalled();
    expect(t.drafts.write).toHaveBeenCalledWith(text, "v1");
  });

  it("sizes the body with the injected bodyBytes (folder and name count too)", () => {
    const bodyBytes = vi.fn(() => KEEPALIVE_MAX_BYTES + 1);
    const save = vi.fn(async () => savedNote("v2"));
    const saver = createAutosaver(
      { getContent: () => "small\n", save, bodyBytes },
      { baseline: "base\n", version: "v1" },
    );
    saver.markDirty();
    saver.flushKeepalive();
    expect(bodyBytes).toHaveBeenCalledWith({ content: "small\n", baseVersion: "v1", force: false });
    expect(save).not.toHaveBeenCalled();
    saver.dispose();
  });

  it("does nothing when the content is already saved", () => {
    const t = setup();
    t.saver.flushKeepalive();
    expect(t.save).not.toHaveBeenCalled();
    expect(t.drafts.write).not.toHaveBeenCalled();
  });

  it("only writes the draft while another save is in flight", async () => {
    const t = setup();
    t.edit("one\n");
    await vi.advanceTimersByTimeAsync(750);
    t.edit("two\n");
    t.saver.flushKeepalive();
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.drafts.write).toHaveBeenLastCalledWith("two\n", "v1");
  });

  it("rebases the draft onto the version of the save that was in flight, even after dispose", async () => {
    const t = setup();
    t.edit("base + A\n");
    await vi.advanceTimersByTimeAsync(800); // PUT #1 in flight, based on v1
    t.edit("base + A + B\n");
    t.saver.flushKeepalive(); // the page is going away: draft only
    t.saver.dispose();
    await t.resolveSave("v2"); // PUT #1 still lands
    expect(t.drafts.write).toHaveBeenLastCalledWith("base + A + B\n", "v2");
    expect(t.drafts.clear).not.toHaveBeenCalled();
  });

  it("leaves the draft on the old version when the save in flight fails", async () => {
    const t = setup();
    t.edit("base + A\n");
    await vi.advanceTimersByTimeAsync(800);
    t.edit("base + A + B\n");
    t.saver.flushKeepalive();
    t.saver.dispose();
    await t.rejectSave(apiError("network"));
    expect(t.drafts.write).toHaveBeenLastCalledWith("base + A + B\n", "v1");
  });

  it("keeps an undo made while a save is in flight, even back to the text on disk", async () => {
    const t = setup();
    t.edit("edited\n");
    await vi.advanceTimersByTimeAsync(750); // PUT of "edited" in flight, based on v1
    t.edit("base\n"); // undone back to the open text
    t.saver.flushKeepalive(); // the tab closes
    t.saver.dispose();
    await t.resolveSave("v2"); // "edited" still lands on disk
    expect(t.drafts.write).toHaveBeenLastCalledWith("base\n", "v2"); // reopening restores the undo
    expect(t.drafts.clear).not.toHaveBeenCalled();
  });

  it("drops a failed save's draft when the edit was undone before closing", async () => {
    const t = setup();
    t.edit("edited\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.rejectSave(apiError("unauthorized")); // the draft keeps "edited"
    t.edit("base\n");
    t.saver.flushKeepalive();
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.drafts.clear).toHaveBeenCalledTimes(1);
  });

  it("clears the draft even when the note closed before the keepalive PUT returned", async () => {
    const t = setup();
    t.edit("closing\n");
    t.saver.flushKeepalive();
    t.saver.dispose();
    await t.resolveSave();
    expect(t.drafts.clear).toHaveBeenCalledTimes(1);
  });
});

describe("unsavedContent", () => {
  it("is the editor text while it differs from what is on disk, also after dispose", async () => {
    const t = setup();
    expect(t.saver.unsavedContent()).toBeNull();
    t.edit("typed\n");
    await vi.advanceTimersByTimeAsync(750);
    await t.resolveSave();
    expect(t.saver.unsavedContent()).toBeNull();
    t.edit("typed more\n");
    t.saver.dispose();
    expect(t.saver.unsavedContent()).toBe("typed more\n");
  });
});

describe("dispose", () => {
  it("cancels pending saves", async () => {
    const t = setup();
    t.edit("pending\n");
    t.saver.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.save).not.toHaveBeenCalled();
    t.saver.markDirty();
    await t.saver.flush();
    expect(t.save).not.toHaveBeenCalled();
  });
});

describe("defaults", () => {
  it("uses injected clocks and timers when given", async () => {
    const timers: Array<() => void> = [];
    const save = vi.fn(async () => savedNote("v2"));
    const saver = createAutosaver(
      {
        getContent: () => "changed\n",
        save,
        now: () => 42,
        setTimeout: (fn) => timers.push(fn),
        clearTimeout: () => {},
      },
      { baseline: "base\n", version: "v1" },
    );
    saver.markDirty();
    expect(timers).toHaveLength(1);
    timers[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saver.getState()).toEqual({ kind: "saved", at: 42 });
  });
});
