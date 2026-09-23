import { getSchema, type JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createExtensions, createMarkdownManager } from "./extensions";
import { analyzeFidelity } from "./fidelity";
import { finalizeMarkdown } from "./file-format";
import { readsAsParagraph } from "./nodes/read-back";

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

  // Alt text marked can't read back as written (it keeps backslashes), only possible from pasted HTML:
  // it's written as close as it can be, then re-opens and saves the same.
  it.each([
    ["C:\\", "![C:\\ ](x.png)", "C:\\ "],
    ["a\n1. x", "![a 1. x](x.png)", "a 1. x"],
    ["a\n> b\nc", "![a > b\nc](x.png)", "a > b\nc"],
    // A newline before anything but a letter or digit could end the paragraph or start a block.
    ["a\n\nb", "![a \nb](x.png)", "a \nb"],
    ["a\n<div>", "![a <div>](x.png)", "a <div>"],
    ["a\n~~~", "![a ~~~](x.png)", "a ~~~"],
    // marked ends the alt text at a backtick with nothing to pair with.
    ["a`b", "![a\\`b](x.png)", "a\\`b"],
    ["`a` b`", "![`a` b\\`](x.png)", "`a` b\\`"],
  ])("image alt %j is written %s and stays an image", (alt, markdown, reopened) => {
    const doc = paragraph({ type: "image", attrs: { alt, src: "x.png" } });
    expect(save(doc)).toBe(markdown + "\n");
    const back = manager.parse(save(doc));
    expect(same(back, paragraph({ type: "image", attrs: { alt: reopened, src: "x.png" } }))).toBe(true);
    expect(save(back)).toBe(save(doc));
  });

  it("keeps a wrapped alt text from a file as it is", () => {
    expect(save(manager.parse("![a long\ndescription](x.png)\n"))).toBe("![a long\ndescription](x.png)\n");
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

  it("reads back what's written after a line's block-start escape, never showing asterisks", () => {
    // "**<\n\>**>": the escape on the second line keeps marked from closing the bold, so it's given up.
    const doc = paragraph(text("<\n>", "bold"), text(">"));
    expect(save(doc)).toBe("<\n\\>>\n");
    expect(same(manager.parse(save(doc)), paragraph(text("<\n>>")))).toBe(true);
  });
});

describe("block syntax formed by a paragraph's lines", () => {
  const br: JSONContent = { type: "hardBreak" };

  // Each line would make the one above it a table header or a setext heading, or be a thematic break.
  it.each([
    [[text("-- -")], "\\-- -"],
    [[text("--- -")], "\\--- -"],
    [[text("a\n-- -")], "a\n\\-- -"],
    [[text("a"), br, text("|-")], "a  \n\\|-"],
    [[text("a\n-|")], "a\n\\-|"],
    [[text("Total\n| --- |")], "Total\n\\| --- |"],
    [[text("a b\n:-")], "a b\n\\:-"],
    [[text("a"), br, text("==")], "a  \n\\=="],
  ])("%j is escaped and re-opens as the same paragraph", (content, markdown) => {
    const doc = paragraph(...content);
    expect(save(doc)).toBe(markdown + "\n");
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });

  it("escapes every punctuation character when the paragraph would still read as another block", () => {
    // Code hides the "]" from the bracket escaping, so marked would read a link reference definition.
    const doc = paragraph(text("[a"), text("]: b", "code"));
    expect(save(doc)).toBe("\\[a`]: b`\n");
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
    expect(save(manager.parse(save(doc)))).toBe(save(doc));
  });

  it("readsAsParagraph sees block syntax the inline read-back can't", () => {
    expect(readsAsParagraph("a\n-|")).toBe(false);
    expect(readsAsParagraph("[a`]: b`")).toBe(false);
    expect(readsAsParagraph("a\n\\-|")).toBe(true);
    expect(readsAsParagraph("plain\ntext")).toBe(true);
  });
});

describe("saving again writes the same bytes", () => {
  it.each([
    ["an escaped '<' before code with '>'", [text("\\\n<"), text(">", "code")]],
    [
      "a path, then '<' before an arrow in code",
      [text("Saved to C:\\\nif n <5 use "), text("a->b", "code"), text(" instead.")],
    ],
    [
      "an image alt with '<' before bold and '>'",
      [{ type: "image", attrs: { alt: "a<5", src: "x.png" } }, text(" "), text("b", "bold"), text(" >")],
    ],
  ])("%s, five saves in a row", (_, content) => {
    const doc = paragraph(...(content as JSONContent[]));
    const first = save(doc);
    let markdown = first;
    for (let round = 0; round < 5; round++) markdown = save(manager.parse(markdown));
    expect(markdown).toBe(first);
  });

  it("re-opens an escaped '<' as the text it was", () => {
    const doc = paragraph(text("\\\n<"), text(">", "code"));
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });
});

describe("typed text that looks like syntax around addresses and links", () => {
  /** The text of every block, and every mark but the links GFM makes from bare addresses. */
  function readBack(doc: JSONContent) {
    const texts: string[] = [];
    const marks: string[] = [];
    const visit = (node: JSONContent) => {
      if (node.type === "text") {
        texts.push(node.text ?? "");
        for (const mark of node.marks ?? []) {
          const href = mark.attrs?.href;
          const autolink = [node.text, `http://${node.text}`, `mailto:${node.text}`].includes(href);
          if (!(mark.type === "link" && autolink)) marks.push(`${mark.type} ${href ?? ""} on ${node.text}`);
        }
      }
      if (node.type === "image") marks.push(`image ${node.attrs?.src}`);
      node.content?.forEach(visit);
      if (node.type === "paragraph" || node.type === "heading") texts.push("\n");
    };
    visit(doc);
    return { text: texts.join(""), marks };
  }

  /** Saves, re-opens and saves again until the bytes settle (a bare URL re-opens as a link). */
  function saveAndReopen(doc: JSONContent) {
    let markdown = save(doc);
    for (let round = 0; round < 3 && save(manager.parse(markdown)) !== markdown; round++) {
      expect(readBack(manager.parse(markdown))).toEqual(readBack(doc));
      markdown = save(manager.parse(markdown));
    }
    expect(save(manager.parse(markdown))).toBe(markdown);
    return { markdown, reopened: manager.parse(markdown) };
  }

  it.each([
    ["Docs: <https://x.com/docs> here", "Docs: &lt;https://x.com/docs> here"],
    ["mail <ftp://x.com> now", "mail &lt;ftp://x.com> now"],
    ["see https://x.com/(*a* now", "see https://x.com/(\\*a\\* now"],
    ["see https://x.com/(**important** now", "see https://x.com/(\\*\\*important\\*\\* now"],
    ["see https://x.com/(`code` now", "see https://x.com/(\\`code\\` now"],
    ["see www.x.com/(\\[x] now", "see www.x.com/(\\\\[x] now"],
  ])("%j is written %j and re-opens as the same text, unformatted", (typed, markdown) => {
    const doc = paragraph(text(typed));
    expect(save(doc)).toBe(markdown + "\n");
    const { reopened } = saveAndReopen(doc);
    expect(readBack(reopened)).toEqual({ text: typed + "\n", marks: [] });
  });

  it.each([
    [[text("Wow!"), text("here", link("https://e.com"))], "Wow\\![here](https://e.com)"],
    [[text("Wow!", "bold"), text("here", link("https://e.com"), "bold")], "**Wow\\![here](https://e.com)**"],
    [[text("Wow\\!"), text("here", link("https://e.com"))], "Wow\\\\\\![here](https://e.com)"],
    [[text("here", link("https://e.com")), text("!")], "[here](https://e.com)!"],
  ])("a '!' right before a link stays text, not an image (%#)", (content, markdown) => {
    const doc = paragraph(...content);
    expect(save(doc)).toBe(markdown + "\n");
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });

  it("a link at the start of a list item's text, after a typed '- ', stays a link", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [paragraph(text("- "), text(" ", link("https://e.com")), text("x")).content![0]],
            },
          ],
        },
      ],
    };
    expect(save(doc)).toBe("- \\- [ ](https://e.com)x\n");
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });

  it("a '!' before a bare URL stays text once the URL re-opens as a link", () => {
    const { markdown, reopened } = saveAndReopen(paragraph(text("see!https://x.com/a now")));
    expect(markdown).toBe("see\\![https://x.com/a](https://x.com/a) now\n");
    expect(readBack(reopened)).toEqual({ text: "see!https://x.com/a now\n", marks: [] });
  });

  it.each([
    ["a backslash before a bracket", "a\\[b]", "https://e.com", "[a\\\\\\[b\\]](https://e.com)"],
    ["a backslash at the end of the address", "x", "https://e.com/a\\", "[x](https://e.com/a\\\\)"],
    ["a backslash before CJK punctuation", "x", "https://e.com/a\\「b」", "[x](https://e.com/a\\\\「b」)"],
    ["a backtick in the address", "x", "https://e.com/a`b", "[x](https://e.com/a\\`b)"],
  ])("a link with %s re-opens the same", (_, label, href, markdown) => {
    const doc = paragraph(text(label, link(href)));
    expect(save(doc)).toBe(markdown + "\n");
    expect(same(manager.parse(save(doc)), doc)).toBe(true);
  });

  const table = (...cells: JSONContent[][]): JSONContent => ({
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          { type: "tableRow", content: ["h", "i"].map((label) => cell("tableHeader", [text(label)])) },
          { type: "tableRow", content: cells.map((content) => cell("tableCell", content)) },
        ],
      },
    ],
  });
  const cell = (type: string, content: JSONContent[]): JSONContent => ({
    type,
    content: [{ type: "paragraph", content }],
  });

  it.each([
    ["a bare URL with a pipe", [text("see https://x.com/a|b now")]],
    ["a link to an address with a pipe", [text("x"), text("link", link("https://x.com/a|b"))]],
    ["an image from a path with a pipe", [{ type: "image", attrs: { src: "img/a|b.png", alt: "a|b" } }]],
    ["a bare URL ending in a backtick", [text("https://x.com/a`")]],
  ])("a table cell with %s keeps its row and the next cell", (_, content) => {
    const doc = table(content, [text("z `y`")]);
    const { markdown, reopened } = saveAndReopen(doc);
    expect(markdown.split("\n")[2].match(/(?<!\\)\|/g)).toHaveLength(3); // | cell | cell |
    expect(readBack(reopened)).toEqual(readBack(doc));
  });

  it("code with a backslash before a pipe in a cell keeps its text, the pipe beside the code", () => {
    const doc = table([text("a\\|b", "code")], [text("z")]);
    expect(save(doc).split("\n")[2]).toBe("| `a\\`\\|`b` | z   |");
    expect(readBack(manager.parse(save(doc))).text).toBe("h\ni\na\\|b\nz\n");
  });

  it("writes a paragraph where every URL runs into code in linear time", () => {
    // Each URL would swallow the code span after it; giving them up one save pass at a time was
    // quadratic (seconds at 400 URLs).
    const content = Array.from({ length: 400 }, (_, i) => [
      text(`https://x.com/a${i}`, "italic"),
      text("c", "italic", "code"),
      text(" ", "italic"),
    ]).flat();
    const doc = paragraph(...content);
    const start = performance.now();
    const markdown = save(doc);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(readBack(manager.parse(markdown)).text).toBe(readBack(doc).text.replace(/ \n$/, "\n"));
  });
});

describe("text that Tiptap's own block tokenizers would pick up", () => {
  const bulletItem = (...content: JSONContent[]): JSONContent => ({
    type: "doc",
    content: [
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content }] }] },
    ],
  });

  it.each([
    ["a paragraph", paragraph(text("- [ ] task", "code"), text(" makes a checkbox"))],
    ["a bullet item", bulletItem(text("* [x] done", "code"), text(" is a checked one"))],
    ["a paragraph, with a leading space", paragraph(text(" - [ ] x", "code"), text(" y"))],
  ])("keeps a code span that starts like a task item as code in %s, without a backslash", (_, doc) => {
    const markdown = save(doc);
    expect(markdown).not.toContain("\\[");
    expect(same(manager.parse(markdown), doc)).toBe(true);
    expect(save(manager.parse(markdown))).toBe(markdown);
  });

  it.each([
    ["a | b", "-|-"],
    ["Price | Qty", "--|:-"],
    ["x|", "- | -"],
  ])("escapes a line Tiptap's table tokenizer takes for a delimiter row (%s / %s)", (first, second) => {
    const doc = paragraph(text(first), { type: "hardBreak" }, text(second));
    const markdown = save(doc);
    expect(same(manager.parse(markdown), doc)).toBe(true);
    expect(save(manager.parse(markdown))).toBe(markdown);
  });
});
