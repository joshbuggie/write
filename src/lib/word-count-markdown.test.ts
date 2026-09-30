import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createMarkdownManager, createSchemaExtensions } from "./markdown/extensions";
import { countDocWords } from "./word-count";
import { countMarkdownWords, maskMarkdown } from "./word-count-markdown";

const schema = getSchema(createSchemaExtensions());
const manager = createMarkdownManager();
const visualCount = (md: string) => countDocWords(schema.nodeFromJSON(manager.parse(md)));

/** Notes and how many words the visual editor shows for each; source mode must agree. */
const NOTES: [string, number][] = [
  ["# Title\n\n**Bold** and _em_ text\n\n2024 was long", 8],
  ["1. first\n2) second\n- [x] done\n* [ ] open\n> 3. quoted\n", 5],
  ["<https://example.com> and <me@example.com>", 3],
  ["```ts\n1. example\n- [x] task\n<div>&amp;</div>\n```\n", 5],
  ["```typescript\n```\n", 0],
  ["> ```\n> 1. quoted code\n> ```\n", 3],
  ["Para\n\n    1. indented code\n", 4],
  ["1. item\n\n    continued para\n", 3],
  ["Read ![a cat](cat.png).", 1],
  ['Read [the docs](https://example.com/docs "Docs title") now.', 4],
  ['[ref][id] here\n\n[id]: https://x.y "Title"\n', 2],
  ["AT&amp;T and &amp; here", 3],
  ["x &lt; y &gt; z &quot;q&quot; &amp;amp;", 5],
  // Other entities show as their literal text (such notes open in source mode unless the user insists).
  ["&#65; and caf&eacute; &mdash; it&#39;s", 5],
  ["- &nbsp;\n- b\n", 1],
  ["&nbsp;\n\ntext\n\n> &nbsp;\n", 1],
  ["a &nbsp; b", 3],
  ["Use `<div>` and `1.` and `[x]` here", 7],
  ["\\<div> text", 2],
  ["| a | b |\n| - | - |\n| c | d |\n", 4],
];

describe("countMarkdownWords", () => {
  it.each(NOTES)("counts %j as the visual editor does", (md, words) => {
    expect(visualCount(md)).toBe(words);
    expect(countMarkdownWords(md)).toBe(words);
  });

  it("doesn't count front matter", () => {
    expect(countMarkdownWords("---\ntitle: Some words\n---\nBody text\n")).toBe(2);
  });

  it("counts HTML tags' text but not the tags", () => {
    expect(countMarkdownWords('Some <span class="x">red</span> text<br>')).toBe(3);
  });
});

describe("countMarkdownWords in a selection", () => {
  const select = (md: string, part: string) => {
    const from = md.indexOf(part);
    return countMarkdownWords(md, from, from + part.length);
  };

  it("keeps a fence's context", () => {
    const md = "```typescript\n```\n";
    expect(select(md, "typescript")).toBe(0);
    expect(select("```\n1. example\n```\n", "1. example")).toBe(2);
  });

  it("keeps a list item's and a link's context", () => {
    expect(select("1. first\n", "1.")).toBe(0);
    expect(select('[the docs](https://x.y "Docs title")', 'https://x.y "Docs title")')).toBe(0);
  });

  it("doesn't count front matter", () => {
    const md = "---\ntitle: Some words\n---\nBody text\n";
    expect(countMarkdownWords(md, 0, md.length)).toBe(2);
    expect(select(md, "title: Some words")).toBe(0);
  });

  it("never outnumbers the total", () => {
    for (const [md] of NOTES) {
      const total = countMarkdownWords(md);
      for (let from = 0; from < md.length; from++) {
        for (let to = from + 1; to <= md.length; to++) {
          expect(countMarkdownWords(md, from, to)).toBeLessThanOrEqual(total);
        }
      }
    }
  });
});

describe("maskMarkdown", () => {
  it("keeps the text's length and where its words break", () => {
    for (const [md] of NOTES) {
      const masked = maskMarkdown(md);
      expect(masked).toHaveLength(md.length);
      expect(masked.replace(/\S/g, "x")).toBe(md.replace(/\S/g, "x"));
    }
  });

  it("stays fast on a large note", () => {
    const para = "The quick [brown](https://x.y) fox `<b>` &amp; ![img](a.png)\n1. item\n- [x] task\n\n";
    const big = para.repeat(Math.ceil(5_000_000 / para.length));
    const started = performance.now();
    countMarkdownWords(big);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
