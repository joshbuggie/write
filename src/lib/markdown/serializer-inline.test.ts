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

describe("bare URLs, www. addresses and emails", () => {
  // marked links them on re-open (GFM autolinks), which is accepted: the next save writes the link.
  it.each([
    [
      [
        text("see "),
        text("important", "bold"),
        text(" and "),
        text("this", "italic"),
        text(" at https://x.com/docs"),
      ],
      "see **important** and *this* at https://x.com/docs",
    ],
    [[text("see "), text("important", "bold"), text(" at www.x.com")], "see **important** at www.x.com"],
    [[text("email me@x.com or "), text("bold", "bold")], "email me@x.com or **bold**"],
    [
      [text("Read "), text("this", "bold"), text(" at https://x.com/docs today")],
      "Read **this** at https://x.com/docs today",
    ],
  ])("don't cost the paragraph its formatting (%#)", (content, markdown) => {
    const md = save(paragraph(...content));
    expect(md).toBe(markdown + "\n");
    const reopened = manager.parse(md);
    const withoutLinks = (nodes: JSONContent[] = []) =>
      nodes.map((node) => ({ ...node, marks: node.marks?.filter((mark) => mark.type !== "link") }));
    expect(
      same(
        {
          ...reopened,
          content: [{ type: "paragraph", content: withoutLinks(reopened.content?.[0]?.content) }],
        },
        paragraph(...content),
      ),
    ).toBe(true);
  });

  it.each([
    ["see https://x.com/~u/ now", "https://x.com/~u/"],
    ["https://x.com/a*b*c", "https://x.com/a*b*c"],
    ["https://x.com/a__b__c", "https://x.com/a__b__c"],
    ["www.x.com/a_b_ now", "http://www.x.com/a_b"],
  ])("keep their characters: %j is written as typed and links to %s", (typed, href) => {
    const md = save(paragraph(text(typed)));
    expect(md).toBe(typed + "\n");
    const nodes = manager.parse(md).content?.[0]?.content ?? [];
    expect(nodes.map((node) => node.text).join("")).toBe(typed);
    expect(nodes.flatMap((node) => node.marks ?? []).map((mark) => mark.attrs?.href)).toEqual([href]);
  });

  it("are escaped as usual inside a link's text, where marked doesn't link them", () => {
    const doc = paragraph(text("https://x.com/a*b*c", link("https://z.com")));
    expect(save(doc)).toBe("[https://x.com/a\\*b\\*c](https://z.com)\n");
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });

  it.each([
    [[text("see www.x."), text("com", "code"), text(" now")], "see www\\.x.`com` now"],
    [[text("see https://x.com/"), text("docs", "bold"), text(" now")], "see https\\://x.com/**docs** now"],
    [
      [text("see https://x.com/"), text("docs", link("https://y.com")), text(" now")],
      "see https\\://x.com/[docs](https://y.com) now",
    ],
  ])("aren't linked where they would swallow the syntax after them (%#)", (content, markdown) => {
    const doc = paragraph(...content);
    expect(save(doc)).toBe(markdown + "\n");
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
    expect(save(manager.parse(save(doc)))).toBe(save(doc));
  });

  it("gives up only the formatting marked misreads, not the rest of the paragraph", () => {
    // marked can't read "**a *b*c**" (nor with "_"), so the italic goes; the other bold stays.
    const doc = paragraph(
      text("x "),
      text("a ", "bold"),
      text("b", "bold", "italic"),
      text("c", "bold"),
      text(" y "),
      text("far", "bold"),
    );
    expect(save(doc)).toBe("x **a bc** y **far**\n");
  });
});

describe("inline fuzz with bare addresses", () => {
  // Seeded, like the fuzz above, with URLs, www. addresses and emails among the formatted pieces.
  const pieces = [
    "https://x.com/docs",
    "www.x.com",
    "me@x.com",
    "https://x.com/~u/a_b_",
    "a",
    " ",
    "。",
    "*",
    "_",
    "`",
    ".",
    "/",
  ];
  const markSets = [["bold"], ["italic"], ["strike"], ["code"], ["bold", "italic"]];
  let seed = 23;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  /** Each character with its emphasis and code marks; links are what GFM adds on re-open. */
  const chars = (doc: JSONContent) =>
    (doc.content?.[0]?.content ?? []).flatMap((node) =>
      Array.from(node.text ?? "", (char) => ({
        char,
        marks: (node.marks ?? [])
          .map((mark) => mark.type)
          .filter((type) => type !== "link")
          .sort(),
      })),
    );
  const trimmed = (list: ReturnType<typeof chars>) =>
    list
      .map((c) => c.char)
      .join("")
      .trim();

  it("keeps every character, never invents formatting, and settles within a few saves", () => {
    let kept = 0;
    let total = 0;
    for (let i = 0; i < 1500; i++) {
      const content = Array.from({ length: 5 }, () => {
        const piece = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(pieces)).join("");
        return random() < 0.5 ? text(piece, ...pick(markSets)) : text(piece);
      });
      const doc = schema.nodeFromJSON(paragraph(...content)).toJSON() as JSONContent;
      const markdown = save(doc);
      const reopened = manager.parse(markdown);
      const [before, after] = [chars(doc), chars(reopened)];
      expect({ markdown, text: trimmed(after) }).toEqual({ markdown, text: trimmed(before) });
      const offset = before.findIndex((c) => !/\s/.test(c.char)) - after.findIndex((c) => !/\s/.test(c.char));
      after.forEach((c, k) => {
        const invented = c.marks.filter((mark) => !before[k + offset]?.marks.includes(mark));
        expect({ markdown, at: k, invented }).toEqual({ markdown, at: k, invented: [] });
      });
      before.forEach((c, k) => {
        if (/\s/.test(c.char)) return; // formatting on spaces at a mark's edge can't be written
        total += c.marks.length;
        kept += c.marks.filter((mark) => after[k - offset]?.marks.includes(mark)).length;
      });
      // A bare URL is a link once re-opened, so the next save writes it as one, which can let another
      // URL be written bare; that settles within a few saves, keeping the text.
      let saved = markdown;
      for (let round = 0; round < 4 && save(manager.parse(saved)) !== saved; round++) {
        saved = save(manager.parse(saved));
        expect({ saved, text: trimmed(chars(manager.parse(saved))) }).toEqual({
          saved,
          text: trimmed(before),
        });
      }
      expect(save(manager.parse(saved))).toBe(saved);
    }
    expect(kept / total).toBeGreaterThan(0.9);
  });
});

describe("near-linear time on paragraphs full of formatting (runs on every save)", () => {
  /** `runs` text runs of 1–4 pieces each, with random bold, italic and strikethrough (or none). */
  function formattedParagraph(runs: number, pieces: string[]): JSONContent {
    let seed = 1;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
    const markSets = [[], ["bold"], ["italic"], ["strike"], ["bold", "italic"]];
    return paragraph(
      ...Array.from({ length: runs }, () =>
        text(
          Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(pieces)).join(""),
          ...pick(markSets),
        ),
      ),
    );
  }

  it.each([
    ["punctuation and spaces", ["a", "。", "「x」", ":", "*", "b c", "."]],
    ["CJK text without spaces", ["中文", "。", "「強調」", "、", "重要"]],
  ])("writes a paragraph with about 2,000 mark edges in %s quickly", (_, pieces) => {
    const doc = formattedParagraph(2000, pieces);
    const start = performance.now();
    save(doc);
    // About 30 ms on a laptop; this bound only catches a return of the quadratic behavior (minutes).
    expect(performance.now() - start).toBeLessThan(750);
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
    // marked reads one level of brackets in link text, so deeper pairs are escaped.
    ["a [[x] y] z", "https://y.com", "[a [\\[x\\] y] z](https://y.com)"],
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
