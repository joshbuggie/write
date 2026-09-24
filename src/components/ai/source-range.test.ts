import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureSourceTarget, insertSourceBelow, replaceSource } from "./source-target";
import { changedSpan, mapRange, trackSourceRange } from "./source-range";

/**
 * The parts of a textarea the tracker and the apply functions use, as an EventTarget so edits fire the
 * same beforeinput and input events a browser's do.
 */
class FakeTextarea extends EventTarget {
  selectionStart = 0;
  selectionEnd = 0;
  constructor(public value: string) {
    super();
  }
  focus() {}
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  setRangeText(text: string, start: number, end: number) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.setSelectionRange(start + text.length, start + text.length);
  }
  /** Typing `text` over start..end, or deleting it when `text` is empty, the way a user edit arrives. */
  type(start: number, end: number, text: string) {
    this.setSelectionRange(start, end);
    this.dispatchEvent(new Event("beforeinput"));
    this.setRangeText(text, start, end);
    this.dispatchEvent(new Event("input"));
  }
  /** A backspace at `at`: the caret was after the deleted character, and ends up before it. */
  backspace(at: number) {
    this.setSelectionRange(at, at);
    this.dispatchEvent(new Event("beforeinput"));
    this.value = this.value.slice(0, at - 1) + this.value.slice(at);
    this.setSelectionRange(at - 1, at - 1);
    this.dispatchEvent(new Event("input"));
  }
}

const textarea = (value: string, start: number, end = start) => {
  const el = new FakeTextarea(value);
  el.setSelectionRange(start, end);
  return el as FakeTextarea & HTMLTextAreaElement;
};

/** Opens the prompt window over el's selection: its target, and the tracker SourceAssist keeps. */
function open(el: FakeTextarea & HTMLTextAreaElement) {
  const target = captureSourceTarget(el);
  return { target, tracker: trackSourceRange(el, target) };
}

beforeEach(() => {
  vi.stubGlobal("document", { execCommand: () => false }); // no execCommand: the setRangeText fallback
});

describe("changedSpan", () => {
  it("finds a single edit", () => {
    expect(changedSpan("one two", "one 2 two")).toEqual({ start: 4, oldEnd: 4, newEnd: 6 });
  });

  it("places an edit inside repeated text where the hint says it happened", () => {
    // "foo" typed in front of "foo": without the hint it reads as typed after it.
    expect(changedSpan("foo", "foofoo")).toEqual({ start: 3, oldEnd: 3, newEnd: 6 });
    expect(changedSpan("foo", "foofoo", { start: 0, end: 3 })).toEqual({ start: 0, oldEnd: 0, newEnd: 3 });
  });
});

describe("mapRange", () => {
  const range = { from: 4, to: 7 };

  it("keeps a range an edit after it doesn't touch, and shifts it for one before it", () => {
    expect(mapRange(range, "aaa bbb ccc", "aaa bbb cc")).toEqual(range);
    expect(mapRange(range, "aaa bbb ccc", "aaaaa bbb ccc")).toEqual({ from: 6, to: 9 });
    expect(mapRange(range, "aaa bbb ccc", "a bbb ccc")).toEqual({ from: 2, to: 5 });
  });

  it("gives up on a range an edit touches", () => {
    expect(mapRange(range, "aaa bbb ccc", "aaa bXb ccc")).toBeNull();
    expect(mapRange(range, "aaa bbb ccc", "aaa ccc")).toBeNull();
  });
});

describe("applying a reply after edits in the source editor", () => {
  it("never replaces an equal passage when the targeted one was changed", () => {
    const el = textarea("foo\n\nfoo\n", 0, 3);
    const { target, tracker } = open(el);
    el.type(0, 3, "bar");
    expect(replaceSource(el, target, tracker.rangeIn(el), "REPLY")).toBe(false);
    expect(insertSourceBelow(el, target, tracker.rangeIn(el), "REPLY")).toBe(false);
    expect(el.value).toBe("bar\n\nfoo\n");
  });

  it("follows the target past edits made before it, even ones that repeat its text", () => {
    const el = textarea("foo\n\nfoo\n", 5, 8);
    const { target, tracker } = open(el);
    el.type(0, 0, "foo\n\n"); // the same text again, in front of the target
    el.backspace(2);
    expect(replaceSource(el, target, tracker.rangeIn(el), "REPLY")).toBe(true);
    expect(el.value).toBe("fo\n\nfoo\n\nREPLY\n");
  });

  it("replaces the first of two equal passages when the edit was after it", () => {
    const el = textarea("foo\n\nfoo\n", 0, 3);
    const { target, tracker } = open(el);
    el.type(9, 9, "More.\n");
    expect(replaceSource(el, target, tracker.rangeIn(el), "REPLY")).toBe(true);
    expect(el.value).toBe("REPLY\n\nfoo\nMore.\n");
  });

  it("inserts below the target it followed, not below an equal passage", () => {
    const note = "Same.\n\nSame.\n";
    const el = textarea(note, 1); // the first paragraph
    const { target, tracker } = open(el);
    el.type(0, 0, "# Title\n\n");
    expect(insertSourceBelow(el, target, tracker.rangeIn(el), "REPLY")).toBe(true);
    expect(el.value).toBe("# Title\n\nSame.\n\nREPLY\n\nSame.\n");
  });

  it("refuses once the target was deleted, and after a change made without an input event", () => {
    const el = textarea("keep\n\ngone\n", 6, 10);
    const { target, tracker } = open(el);
    el.type(6, 11, "");
    expect(replaceSource(el, target, tracker.rangeIn(el), "REPLY")).toBe(false);

    const reloaded = textarea("one two", 4, 7);
    const opened = open(reloaded);
    reloaded.value = "one too"; // the note reloaded from disk: no events
    expect(replaceSource(reloaded, opened.target, opened.tracker.rangeIn(reloaded), "X")).toBe(false);
    expect(reloaded.value).toBe("one too");
  });

  it("stops following once stopped", () => {
    const el = textarea("abc def", 4, 7);
    const { tracker } = open(el);
    tracker.stop();
    el.type(0, 0, "zz ");
    // Without the input events, the edit is mapped only on read, and still correctly: it's before the target.
    expect(tracker.rangeIn(el)).toEqual({ from: 7, to: 10 });
  });
});
