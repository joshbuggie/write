import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDraft, moveDraft, readDraft, writeDraft, type Draft } from "./drafts";

/** In-memory Storage, enough for the drafts module. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.items.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

/** Storage that fails like Safari private mode / blocked site data / a full quota. */
class ThrowingStorage extends MemoryStorage {
  getItem(): string | null {
    throw new DOMException("denied", "SecurityError");
  }
  setItem(): void {
    throw new DOMException("full", "QuotaExceededError");
  }
  removeItem(): void {
    throw new DOMException("denied", "SecurityError");
  }
}

const ref = { folder: "notebook", name: "Groceries" };
const draft: Draft = { content: "# Milk\n", baseVersion: "abc123", savedAt: 1700000000000 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("drafts", () => {
  it("writes, reads and clears a draft", () => {
    const storage = new MemoryStorage();
    expect(readDraft(ref, storage)).toBeNull();
    writeDraft(ref, draft, storage);
    expect(readDraft(ref, storage)).toEqual(draft);
    clearDraft(ref, storage);
    expect(readDraft(ref, storage)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("keys drafts by an unambiguous [folder, name] tuple", () => {
    const storage = new MemoryStorage();
    writeDraft({ folder: "a b", name: "c" }, draft, storage);
    expect(storage.key(0)).toBe('write:draft:v1:["a b","c"]');
    expect(readDraft({ folder: "a", name: "b c" }, storage)).toBeNull();
  });

  it("ignores corrupt or foreign values", () => {
    const storage = new MemoryStorage();
    const key = 'write:draft:v1:["notebook","Groceries"]';
    for (const value of [
      "{not json",
      "null",
      '"text"',
      '{"content":"x"}',
      '{"content":1,"baseVersion":"v","savedAt":1}',
    ]) {
      storage.setItem(key, value);
      expect(readDraft(ref, storage)).toBeNull();
    }
  });

  it("moves a draft to a renamed note", () => {
    const storage = new MemoryStorage();
    const renamed = { folder: "Work", name: "Shopping" };
    writeDraft(ref, draft, storage);
    moveDraft(ref, renamed, storage);
    expect(readDraft(ref, storage)).toBeNull();
    expect(readDraft(renamed, storage)).toEqual(draft);
  });

  it("keeps the draft when moving onto the same ref", () => {
    const storage = new MemoryStorage();
    writeDraft(ref, draft, storage);
    moveDraft(ref, { ...ref }, storage);
    expect(readDraft(ref, storage)).toEqual(draft);
  });

  it("does nothing when there is no draft to move", () => {
    const storage = new MemoryStorage();
    moveDraft(ref, { folder: "x", name: "y" }, storage);
    expect(storage.length).toBe(0);
  });

  it("never throws when storage throws", () => {
    const storage = new ThrowingStorage();
    expect(() => writeDraft(ref, draft, storage)).not.toThrow();
    expect(readDraft(ref, storage)).toBeNull();
    expect(() => clearDraft(ref, storage)).not.toThrow();
    expect(() => moveDraft(ref, { folder: "x", name: "y" }, storage)).not.toThrow();
  });

  it("uses localStorage by default and no-ops without it", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    writeDraft(ref, draft);
    expect(readDraft(ref)).toEqual(draft);
    clearDraft(ref);
    expect(storage.length).toBe(0);

    vi.stubGlobal("localStorage", undefined);
    expect(() => writeDraft(ref, draft)).not.toThrow();
    expect(readDraft(ref)).toBeNull();
  });
});
