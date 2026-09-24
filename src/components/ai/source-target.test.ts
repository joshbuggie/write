import { describe, expect, it } from "vitest";
import { asBlock, captureSourceTarget, edgesOf } from "./source-target";

/** The parts of a textarea the capture reads: its text and selection. */
const textarea = (value: string, start: number, end = start) =>
  ({ value, selectionStart: start, selectionEnd: end }) as HTMLTextAreaElement;

describe("captureSourceTarget", () => {
  const note = "# Title\n\nFirst line\nsecond line.\n\nLast paragraph.\n";

  it("takes the selection as written", () => {
    const at = note.indexOf("second");
    expect(captureSourceTarget(textarea(note, at, at + 6))).toMatchObject({
      kind: "selection",
      text: "second",
      from: at,
      to: at + 6,
    });
  });

  it("takes the lines around the caret up to the nearest blank lines", () => {
    const target = captureSourceTarget(textarea(note, note.indexOf("line\nsecond")));
    expect(target).toMatchObject({ kind: "paragraph", text: "First line\nsecond line." });
    expect(note.slice(target.from, target.to)).toBe("First line\nsecond line.");
  });

  it("reaches the start and end of the file", () => {
    expect(captureSourceTarget(textarea(note, 2)).text).toBe("# Title");
    expect(captureSourceTarget(textarea(note, note.indexOf("paragraph"))).text).toBe("Last paragraph.");
  });

  it("is just the caret on a blank line", () => {
    const blank = "One.\n\n\n\nTwo.\n";
    expect(captureSourceTarget(textarea(blank, 6))).toMatchObject({
      kind: "cursor",
      text: "",
      from: 6,
      to: 6,
    });
  });
});

describe("captureSourceTarget on blank lines", () => {
  it("is just the caret on the single blank line between two paragraphs", () => {
    expect(captureSourceTarget(textarea("One.\n\nTwo.\n", 5))).toMatchObject({ kind: "cursor", from: 5 });
  });

  it("takes a paragraph from the middle of the file, lines and all", () => {
    const note = "A.\n\nB one\nB two\n\nC.\n";
    expect(captureSourceTarget(textarea(note, note.indexOf("two"))).text).toBe("B one\nB two");
  });
});

describe("asBlock and edgesOf", () => {
  it("adds only the blank lines Markdown needs around a new block", () => {
    expect(asBlock("One.\n", "NEW", "\nTwo.")).toBe("\nNEW\n");
    expect(asBlock("One.\n\n", "NEW", "")).toBe("NEW");
    expect(asBlock("", "NEW", "Two.")).toBe("NEW\n\n");
  });

  it("keeps a selection's edge line breaks, and none for a whitespace-only selection", () => {
    expect(edgesOf("\nLine one.\nLine two.\n")).toEqual(["\n", "\n"]);
    expect(edgesOf("word")).toEqual(["", ""]);
    expect(edgesOf("\n\n")).toEqual(["", ""]);
  });
});
