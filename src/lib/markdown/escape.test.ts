import { describe, expect, it } from "vitest";
import {
  encodeText,
  escapeBlockStarts,
  escapeLetterListMarker,
  escapeTagLikeSpans,
  patchMarkdownManager,
  withEscapedTablePipes,
} from "./escape";
import { createMarkdownManager } from "./extensions";

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

  it.each([
    ["an escaped backtick doesn't open code", "\\`<5 *x* >", "\\`\\<5 *x* >"],
    ["an escaped delimiter doesn't count", "<5 \\* > *x* >", "<5 \\* > *x* >"],
    ["an escaped > doesn't close", "<5 \\> *x* >", "\\<5 \\> *x* >"],
    ["a code span ends at the next backtick", "`a\\` <5 *x* >", "`a\\` \\<5 *x* >"],
    ["an unclosed backtick is a delimiter", "<5 ` x >", "\\<5 ` x >"],
  ])("%s", (_, input, output) => {
    expect(escapeTagLikeSpans(input)).toBe(output);
  });
});

describe("linear time on hostile paragraphs (runs on every save)", () => {
  const manager = createMarkdownManager();
  const serializeParagraph = (text: string) =>
    manager.serialize({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const elapsed = (run: () => unknown) => {
    const start = performance.now();
    run();
    return performance.now() - start;
  };

  it.each([
    ["'<'", "<".repeat(100_000)],
    ["'a <1 _'", "a <1 _".repeat(20_000)],
    ["'['", "[a ".repeat(40_000)],
  ])("serializes a 100 KB+ paragraph of %s in well under 100 ms", (_, text) => {
    expect(elapsed(() => serializeParagraph(text))).toBeLessThan(100);
  });

  it("escapeTagLikeSpans handles 200 KB of '<' and delimiters without a closing '>'", () => {
    expect(elapsed(() => escapeTagLikeSpans("x <1 _".repeat(35_000)))).toBeLessThan(100);
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
