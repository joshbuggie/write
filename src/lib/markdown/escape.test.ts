import { describe, expect, it } from "vitest";
import {
  encodeText,
  escapeBlockStarts,
  escapeLetterListMarker,
  escapeTagLikeSpans,
  patchMarkdownManager,
  withEscapedTablePipes,
} from "./escape";

describe("encodeText", () => {
  it.each([
    ["Tom & Jerry < 3 > 2", "Tom & Jerry < 3 > 2"],
    ["C:\\Users\\me", "C:\\Users\\me"],
    ["snake_case and a_b_c", "snake_case and a_b_c"],
    ["[[Wiki]] and [^1]", "[[Wiki]] and [^1]"],
    ["5 * 3 and 2 ~ 3", "5 * 3 and 2 ~ 3"],
    ["café, 日本語, 🎉", "café, 日本語, 🎉"],
  ])("leaves plain prose %j untouched", (input, output) => {
    expect(encodeText(input)).toBe(output);
  });

  it.each([
    ["*em*", "\\*em\\*"],
    ["_em_", "\\_em\\_"],
    ["__init__", "\\_\\_init\\_\\_"],
    ["~~s~~", "\\~\\~s\\~\\~"],
    ["`code`", "\\`code\\`"],
    ["[t](u)", "\\[t\\](u)"],
    ["[ref]: x", "\\[ref\\]: x"],
    ["<div>", "&lt;div>"],
    ["<!-- c -->", "&lt;!-- c -->"],
    ["&amp; &#123;", "&amp;amp; &amp;#123;"],
    ["a\\*b", "a\\\\\\*b"],
    ["ends with \\", "ends with \\\\"],
    ["x*y", "x\\*y"],
  ])("escapes %j where it could parse as markup", (input, output) => {
    expect(encodeText(input)).toBe(output);
  });
});

describe("escapeBlockStarts", () => {
  it.each([
    ["# not heading", "\\# not heading"],
    ["###### six", "\\###### six"],
    ["- not list", "\\- not list"],
    ["+ not list", "\\+ not list"],
    ["* not list", "\\* not list"],
    ["1. not ordered", "1\\. not ordered"],
    ["1) not ordered", "1\\) not ordered"],
    ["> not quote", "\\> not quote"],
    ["---", "\\---"],
    ["===", "\\==="],
    ["- [ ] not a task", "\\- \\[ ] not a task"],
    ["x- [x] not a task", "x- \\[x] not a task"],
    ["    not code", "not code"],
    ["\tnot code", "not code"],
  ])("escapes %j", (input, output) => {
    expect(escapeBlockStarts(input)).toBe(output);
  });

  it("escapes every line of a paragraph with hard breaks", () => {
    expect(escapeBlockStarts("a  \n# b  \n- c")).toBe("a  \n\\# b  \n\\- c");
  });

  it.each(["#hashtag", "-dash", "1.5 liters", "a - b", "2024-01-01", "text > more"])(
    "leaves %j alone",
    (line) => {
      expect(escapeBlockStarts(line)).toBe(line);
    },
  );
});

describe("escapeLetterListMarker", () => {
  it.each([
    ["a. apples", "a\\. apples"],
    ["Dr. Smith", "Dr\\. Smith"],
    ["iv) four", "iv\\) four"],
  ])("escapes %j", (input, output) => {
    expect(escapeLetterListMarker(input)).toBe(output);
  });

  it.each(["abc. three letters", "a.b", "Dr.Smith", "plain text"])("leaves %j alone", (input) => {
    expect(escapeLetterListMarker(input)).toBe(input);
  });
});

describe("escapeTagLikeSpans", () => {
  it.each([
    ["x <5 **c** y> z", "x \\<5 **c** y> z"],
    ["a<<\\b*;<5 *d*>", "a\\<\\<\\b*;\\<5 *d*>"],
    ["x <5 ~~c~~ y> z", "x \\<5 ~~c~~ y> z"],
    ["a<= `b>c` ~~d~~", "a\\<= `b>c` ~~d~~"],
  ])("escapes %j", (input, output) => {
    expect(escapeTagLikeSpans(input)).toBe(output);
  });

  it.each([
    "a < b **c** d > e", // "< " never starts a tag
    "Tom & Jerry < 3 > 2",
    "x <5 and y> z",
    "x <5 \\*c\\* y> z",
    "x <5 **c** and no closing bracket",
    "`<5 *code* y>` stays code",
    "x <5 y> `code`",
    "<em>a</em> *b* >",
  ])("leaves %j alone", (input) => {
    expect(escapeTagLikeSpans(input)).toBe(input);
  });
});

describe("patchMarkdownManager", () => {
  function fakeManager() {
    return {
      calls: 0,
      encodeTextForMarkdown(text: string, node: { marks?: string[] }) {
        this.calls++;
        return node.marks?.includes("code") ? text : `upstream(${text})`;
      },
    };
  }

  it("returns false when Tiptap's private method is missing", () => {
    expect(patchMarkdownManager(undefined)).toBe(false);
    expect(patchMarkdownManager(null)).toBe(false);
    expect(patchMarkdownManager({})).toBe(false);
  });

  it("replaces the escaping outside code and keeps code verbatim", () => {
    const manager = fakeManager();
    expect(patchMarkdownManager(manager)).toBe(true);
    expect(manager.encodeTextForMarkdown("a_b & [x](y)", {})).toBe("a_b & \\[x\\](y)");
    expect(manager.encodeTextForMarkdown("*raw*", { marks: ["code"] })).toBe("*raw*");
  });

  it("is idempotent", () => {
    const manager = fakeManager();
    patchMarkdownManager(manager);
    const patched = manager.encodeTextForMarkdown;
    expect(patchMarkdownManager(manager)).toBe(true);
    expect(manager.encodeTextForMarkdown).toBe(patched);
  });

  it("escapes pipes (code included) only while rendering table cells", () => {
    const manager = fakeManager();
    patchMarkdownManager(manager);
    expect(manager.encodeTextForMarkdown("a|b", {})).toBe("a|b");
    expect(withEscapedTablePipes(() => manager.encodeTextForMarkdown("a|b", {}))).toBe("a\\|b");
    expect(withEscapedTablePipes(() => manager.encodeTextForMarkdown("x|y", { marks: ["code"] }))).toBe(
      "x\\|y",
    );
    expect(manager.encodeTextForMarkdown("a|b", {})).toBe("a|b");
  });
});
