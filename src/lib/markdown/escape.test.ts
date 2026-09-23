import { describe, expect, it } from "vitest";
import {
  encodeText,
  escapeBlockStarts,
  escapeEverything,
  escapeLetterListMarker,
  escapeTablePipes,
  escapeTagLikeSpans,
  patchMarkdownManager,
  withEverythingEscaped,
} from "./escape";
import { createMarkdownManager } from "./extensions";
import { firstMisread } from "./nodes/read-back";

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

describe("encodeText and bare URLs", () => {
  it.each([
    ["Docs: <https://x.com/docs> here", "Docs: &lt;https://x.com/docs> here"],
    ["see https://x.com/(*a* now", "see https://x.com/(\\*a\\* now"],
    ["see https://x.com/a.(b_c_ now", "see https://x.com/a.(b_c\\_ now"],
    ["https://x.com/(a(b) *c*", "https://x.com/(a(b) \\*c\\*"],
  ])("escapes what marked reads outside the URL in %j", (input, output) => {
    expect(encodeText(input)).toBe(output);
  });

  it.each([
    ["see https://x.com/~u/ now", "see https://x.com/~u/ now"],
    ["https://x.com/a*b*c", "https://x.com/a*b*c"],
    ["https://x.com/a__b__c and a_b", "https://x.com/a__b__c and a_b"],
    ["www.x.com/a_b_ now", "www.x.com/a_b_ now"],
    ["*x* https://x.com/~u", "\\*x\\* https://x.com/~u"],
  ])("leaves the URL in %j as typed: marked links it backslashes and all", (input, output) => {
    expect(encodeText(input)).toBe(output);
  });

  it("escapes a URL like other text inside a link's text, where marked doesn't link it", () => {
    expect(encodeText("https://x.com/a*b*c", { inLink: true })).toBe("https://x.com/a\\*b\\*c");
  });

  it("escapes a URL like other text and keeps marked from linking it, when asked", () => {
    expect(encodeText("see https://x.com/a*b and www.x.com, me@x.com", { plainAddresses: true })).toBe(
      "see https\\://x.com/a\\*b and www\\.x.com, me\\@x.com",
    );
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
    ["-- -", "\\-- -"],
    ["--- -", "\\--- -"],
    ["_ __", "\\_ __"],
    ["- [ ] not a task", "\\- \\[ ] not a task"],
    ["- [x](https://e.com) a link, not a task", "\\- [x](https://e.com) a link, not a task"],
    ["x- [x] not a task", "x- \\[x] not a task"],
    ["    not code", "not code"],
    ["\tnot code", "not code"],
  ])("escapes %j", (input, output) => {
    expect(escapeBlockStarts(input)).toBe(output);
  });

  it("escapes every line of a paragraph with hard breaks", () => {
    expect(escapeBlockStarts("a  \n# b  \n- c")).toBe("a  \n\\# b  \n\\- c");
  });

  it.each([
    ["a\n-|", "a\n\\-|"],
    ["a  \n|-", "a  \n\\|-"],
    ["Total\n| --- |", "Total\n\\| --- |"],
    ["a b\n:-", "a b\n\\:-"],
    ["a\n-- -", "a\n\\-- -"],
  ])("escapes a line that would make the one above it a table header or rule: %j", (input, output) => {
    expect(escapeBlockStarts(input)).toBe(output);
  });

  it.each(["|-", ":-", "a\n:-) smile", "a\n-> arrow", "a\n| cell |"])("leaves %j alone", (text) => {
    expect(escapeBlockStarts(text)).toBe(text);
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
    ["a longer code span holds a single backtick", "``x<`y`` *b* >", "``x<`y`` *b* >"],
    ["a code span closes at a run of its own length", "`a``<5 *x*`` >` z", "`a``<5 *x*`` >` z"],
    ["an escaped backtick only makes the first of its run literal", "\\```x<5`` *b* >", "\\```x<5`` *b* >"],
    // Another backslash would turn "\<" into a literal backslash and a "<", one more on every save.
    ["an escaped < isn't escaped again", "\\\\\n\\<`>`", "\\\\\n\\<`>`"],
    [
      "an escaped < after a literal backslash",
      "C\\:\\\\\nif n \\<5 use `a->b`",
      "C\\:\\\\\nif n \\<5 use `a->b`",
    ],
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

  it("leaves pipes to the table row, and escapes everything only when asked", () => {
    const manager = fakeManager();
    patchMarkdownManager(manager);
    expect(manager.encodeTextForMarkdown("a|b", {})).toBe("a|b");
    expect(withEverythingEscaped(() => manager.encodeTextForMarkdown("a*b|c", {}))).toBe("a\\*b|c");
    expect(withEverythingEscaped(() => manager.encodeTextForMarkdown("x*y", { marks: ["code"] }))).toBe(
      "x*y",
    );
    expect(manager.encodeTextForMarkdown("a*b", {})).toBe("a\\*b");
  });
});

describe("escapeTablePipes", () => {
  it("escapes every pipe in a cell, code spans and link destinations included", () => {
    expect(escapeTablePipes("a|b `x|y` [l](https://x.com/a|b)")).toBe(
      "a\\|b `x\\|y` [l](https://x.com/a\\|b)",
    );
  });
});

describe("escapeEverything", () => {
  it("escapes all ASCII punctuation but the table pipe, and nothing else", () => {
    expect(escapeEverything("<https://x.com> me@x.com www.x.com ![a](b) &amp; 5 * 3 | é「」")).toBe(
      "\\<https\\:\\/\\/x\\.com\\> me\\@x\\.com www\\.x\\.com \\!\\[a\\]\\(b\\) \\&amp\\; 5 \\* 3 | é「」",
    );
  });
});

describe("escapeEverything, the inline serializer's safety net", () => {
  it("reads back as the literal text, whatever the text (seeded search)", () => {
    let seed = 11;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
    const pieces = [
      ...ascii,
      "https://",
      "www.",
      "me@x.com",
      "&amp;",
      "<b>",
      "![x](y)",
      "「強調」",
      "é",
      "\\\\",
    ];
    for (let n = 0; n < 5000; n++) {
      const typed = Array.from(
        { length: 1 + Math.floor(random() * 12) },
        () => pieces[Math.floor(random() * pieces.length)],
      )
        .join("")
        .trim();
      if (!typed) continue;
      const units = Array.from(typed, (char) => ({ text: char, marks: [] }));
      const inTable = random() < 0.5;
      expect({ typed, misread: firstMisread(escapeEverything(typed), units, inTable) }).toEqual({
        typed,
        misread: null,
      });
    }
  });
});
