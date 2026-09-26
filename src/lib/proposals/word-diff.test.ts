import { describe, expect, it } from "vitest";
import { wordDiff, type DiffPart } from "./word-diff";

const before = (parts: DiffPart[]) =>
  parts
    .filter((p) => p.type !== "ins")
    .map((p) => p.text)
    .join("");
const after = (parts: DiffPart[]) =>
  parts
    .filter((p) => p.type !== "del")
    .map((p) => p.text)
    .join("");

describe("wordDiff", () => {
  it("marks the words that changed", () => {
    expect(wordDiff("The quick brown fox.", "The slow brown fox!")).toEqual([
      { type: "same", text: "The " },
      { type: "del", text: "quick" },
      { type: "ins", text: "slow" },
      { type: "same", text: " brown fox" },
      { type: "del", text: "." },
      { type: "ins", text: "!" },
    ]);
  });

  it("shows a rewrite as the old text, then the new, instead of word soup", () => {
    const parts = wordDiff(
      "Tide pools are small worlds that fill and empty twice a day.",
      "Twice a day the sea pulls back and leaves small worlds behind in the rocks.",
    );
    expect(parts.map((p) => p.type)).toEqual(["del", "ins", "same"]); // the shared final "."
    expect(parts[2].text).toBe(".");
  });

  it("folds small shared words between edits into the edits", () => {
    expect(wordDiff("one red fish swam here today", "one blue a cat swam here today")).toEqual([
      { type: "same", text: "one " },
      { type: "del", text: "red fish" },
      { type: "ins", text: "blue a cat" },
      { type: "same", text: " swam here today" },
    ]);
  });

  it("handles empty sides", () => {
    expect(wordDiff("", "new text")).toEqual([{ type: "ins", text: "new text" }]);
    expect(wordDiff("old", "")).toEqual([{ type: "del", text: "old" }]);
    expect(wordDiff("", "")).toEqual([]);
  });

  it("always rebuilds both texts exactly", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const words = ["a", "b", "cat", "dog", " ", "\n", ".", "é", "don't"];
    const text = () =>
      Array.from(
        { length: Math.floor(random() * 40) },
        () => words[Math.floor(random() * words.length)],
      ).join("");
    for (let i = 0; i < 500; i++) {
      const a = text();
      const b = text();
      const parts = wordDiff(a, b);
      expect(before(parts)).toBe(a);
      expect(after(parts)).toBe(b);
    }
  });

  it("falls back to old-then-new for a rewrite too different to diff word by word", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(" ");
    const b = Array.from({ length: 3000 }, (_, i) => `v${i}`).join(" ");
    const parts = wordDiff(a, b);
    expect(before(parts)).toBe(a);
    expect(after(parts)).toBe(b);
    expect(parts.length).toBeLessThanOrEqual(3);
  });
});
