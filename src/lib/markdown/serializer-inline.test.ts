import { getSchema, type JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createExtensions, createMarkdownManager } from "./extensions";
import { analyzeFidelity } from "./fidelity";
import { finalizeMarkdown } from "./file-format";

/** Formatting inside a paragraph must re-open from the saved file as written, never as HTML or asterisks. */

const manager = createMarkdownManager();
const schema = getSchema(createExtensions());
type Mark = string | { type: string; attrs: Record<string, unknown> };
const text = (value: string, ...marks: Mark[]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks.length ? { marks: marks.map((mark) => (typeof mark === "string" ? { type: mark } : mark)) } : {}),
});
const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});
const link = (href: string) => ({ type: "link", attrs: { href } });
/** Both documents in the editor's schema, so mark order and default attributes don't matter. */
const same = (a: JSONContent, b: JSONContent) => schema.nodeFromJSON(a).eq(schema.nodeFromJSON(b));
const save = (doc: JSONContent) => finalizeMarkdown(manager.serialize(doc));

describe("overlapping marks", () => {
  it.each([
    [
      [text("x "), text("ab", "bold"), text("cd", "bold", "italic"), text("ef", "italic"), text(" y")],
      "x **ab*cd***_ef_ y",
    ],
    [
      [text("x "), text("ab", "italic"), text("cd", "italic", "bold"), text("ef", "bold"), text(" y")],
      "x *ab**cd***__ef__ y",
    ],
    [[text("ab", "strike"), text("cd", "strike", "bold"), text("ef", "bold")], "~~ab**cd**~~**ef**"],
    [[text("a "), text("b", link("u"), "bold"), text(" c", "bold")], "a **[b](u) c**"],
  ])("are nested and closed, not written as HTML", (content, markdown) => {
    const doc = paragraph(...content);
    expect(save(doc)).toBe(markdown + "\n");
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
    expect(analyzeFidelity(save(doc), save(manager.parse(save(doc))))).toEqual({ kind: "exact" });
  });
});

describe("mark edges next to punctuation", () => {
  // CommonMark can't open or close `**` between a letter and punctuation, so the punctuation at the edge
  // is left unformatted: the text survives and no asterisks show.
  it.each([
    [
      [text("これは"), text("「強調」", "bold"), text("です")],
      "これは「**強調**」です",
      [text("これは「"), text("強調", "bold"), text("」です")],
    ],
    [
      [text("中文"), text("重要。", "bold"), text("然后")],
      "中文**重要**。然后",
      [text("中文"), text("重要", "bold"), text("。然后")],
    ],
    [[text("Note:", "bold"), text("do this")], "**Note**:do this", [text("Note", "bold"), text(":do this")]],
    [[text("hi"), text("😀", "bold"), text("there")], "hi😀there", [text("hi😀there")]],
    [[text("file"), text(".txt", "italic")], "file.*txt*", [text("file."), text("txt", "italic")]],
  ])("%#: keeps the text and as much formatting as markdown can hold", (content, markdown, reopened) => {
    const md = save(paragraph(...content));
    expect(md).toBe(markdown + "\n");
    expect(same(manager.parse(md), paragraph(...reopened))).toBe(true);
    expect(save(manager.parse(md))).toBe(md);
  });

  it.each([
    [text("un"), text("believ", "bold"), text("able")],
    [text("say "), text("「強調」", "bold"), text(" twice")],
    [text("("), text("see", "italic"), text(")")],
  ])("leaves edges that can be written alone (%#)", (...content) => {
    const doc = paragraph(...content);
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });
});

describe("inline fuzz with punctuation at mark edges", () => {
  // Seeded, like the typed text fuzz in roundtrip.test.ts, but marks may start and end on anything.
  const alphabet = [..."ab 。「」:、😀.*_~[]()<`\\é"];
  const markSets = [["bold"], ["italic"], ["strike"], ["code"], ["bold", "italic"], ["italic", "strike"]];
  let seed = 7;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const word = () => Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(alphabet)).join("");
  const chars = (doc: JSONContent) =>
    (doc.content?.[0]?.content ?? []).flatMap((node) =>
      Array.from(node.text ?? "", (char) => ({
        char,
        marks: (node.marks ?? []).map((mark) => mark.type).sort(),
      })),
    );

  it("keeps every character, never invents formatting, and saves the same bytes twice", () => {
    for (let i = 0; i < 3000; i++) {
      const content = Array.from({ length: 4 }, () =>
        random() < 0.5 ? text(word(), ...pick(markSets)) : text(word()),
      );
      const doc = schema.nodeFromJSON(paragraph(...content)).toJSON() as JSONContent; // merged like the editor
      const markdown = save(doc);
      const reopened = manager.parse(markdown);
      expect(markdown).not.toMatch(/<\/?(?:em|strong|del|s)>/);
      const before = chars(doc);
      const after = chars(reopened);
      // Whitespace at the paragraph's edges is markdown's to drop; compare what's between.
      const trimmed = (list: typeof before) =>
        list
          .map((c) => c.char)
          .join("")
          .trim();
      expect({ markdown, text: trimmed(after) }).toEqual({ markdown, text: trimmed(before) });
      const offset = before.findIndex((c) => !/\s/.test(c.char)) - after.findIndex((c) => !/\s/.test(c.char));
      after.forEach((c, k) => {
        const invented = c.marks.filter((mark) => !before[k + offset]?.marks.includes(mark));
        expect({ markdown, at: k, invented }).toEqual({ markdown, at: k, invented: [] });
      });
      expect(save(reopened)).toBe(markdown);
    }
  });
});

describe("links", () => {
  it.each([
    ["a]b", "https://y.com", "[a\\]b](https://y.com)"],
    ["a[b", "https://y.com", "[a\\[b](https://y.com)"],
    ["x", "https://y.com/a)b", "[x](<https://y.com/a)b>)"],
    ["x", "notes/a b.md", "[x](<notes/a b.md>)"],
    ["[x](y)", "https://y.com", "[\\[x\\]\\(y)](https://y.com)"],
    ["Foo", "https://en.wikipedia.org/wiki/Foo_(bar)", "[Foo](https://en.wikipedia.org/wiki/Foo_(bar))"],
    ["[b]", "https://y.com", "[[b]](https://y.com)"],
  ])("%j → %s re-opens as the same link", (label, href, markdown) => {
    const doc = paragraph(text(label, link(href)));
    expect(save(doc)).toBe(markdown + "\n");
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });

  it.each([
    ["a]b", "x.png", "![a\\]b](x.png)"],
    ["cat", "photos/my cat.png", "![cat](<photos/my cat.png>)"],
    ["x", "a(b.png", "![x](<a(b.png>)"],
  ])("image %j from %j is written %s and re-opens the same", (alt, src, markdown) => {
    const doc = paragraph({ type: "image", attrs: { alt, src } });
    expect(save(doc)).toBe(markdown + "\n");
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });

  it("escapes a title's quotes", () => {
    const doc = paragraph(text("x", { type: "link", attrs: { href: "u", title: 'say "hi"' } }));
    expect(save(doc)).toBe('[x](u "say \\"hi\\"")\n');
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });
});

describe("code spans and line breaks", () => {
  it.each([
    ["a`b", "``a`b``"],
    ["`x", "`` `x ``"],
    [" y ", "`  y  `"],
    ["  ", "`  `"],
  ])("code %j is fenced so it re-opens unchanged", (code, markdown) => {
    const doc = paragraph(text("see "), text(code, "code"));
    expect(save(doc)).toBe(`see ${markdown}\n`);
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });

  it("keeps a newline in text as one line break, never as a paragraph break", () => {
    expect(save(paragraph(text("a\n\n  b")))).toBe("a\nb\n");
    expect(manager.parse("a\nb\n").content).toHaveLength(1);
  });
});
