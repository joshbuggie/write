import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { createMarkdownManager, createSchemaExtensions } from "./markdown/extensions";
import { countDocWords, countMarkdownWords, countWords } from "./word-count";

describe("countWords", () => {
  it("counts runs of non-space characters that have a letter or digit", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
    expect(countWords("The quick brown fox")).toBe(4);
    expect(countWords("  leading and\ttrailing\n\nspace  ")).toBe(4);
    expect(countWords("It's a well-known fact, 3.14 or 42%.")).toBe(7);
  });

  it("skips punctuation and symbols on their own", () => {
    expect(countWords("one — two - three ... * # |")).toBe(3);
  });

  it("counts a URL or an email address as one word", () => {
    expect(countWords("see https://example.com/a-b?c=d or me@example.com")).toBe(4);
  });

  it("counts letters with accents and non-Latin scripts that use spaces", () => {
    expect(countWords("café naïve Ελληνικά русский 한국어 문장")).toBe(6);
  });

  it("splits scripts written without spaces into words", () => {
    expect(countWords("東京に行きました")).toBeGreaterThan(1);
    expect(countWords("ภาษาไทยง่ายนิดเดียว")).toBeGreaterThan(1);
  });

  it("stays linear on a long run of punctuation", () => {
    const started = performance.now();
    expect(countWords("-".repeat(2_000_000) + " end")).toBe(1);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("countMarkdownWords", () => {
  it("doesn't count list markers, task boxes or a fence's language", () => {
    const md = [
      "1. first",
      "2) second",
      "- [x] done",
      "* [ ] open",
      "> 3. quoted",
      "```ts",
      "code",
      "```",
    ].join("\n");
    expect(countMarkdownWords(md)).toBe(6);
  });

  it("doesn't count HTML tags or link destinations", () => {
    expect(countMarkdownWords('Some <span class="x">red</span> text<br>')).toBe(3);
    expect(countMarkdownWords("Read [the docs](https://example.com/docs) and ![a cat](cat.png).")).toBe(6);
  });

  it("keeps emphasis, headings and a leading number that isn't a list marker", () => {
    expect(countMarkdownWords("# Title\n\n**Bold** and _em_ text\n\n2024 was long")).toBe(8);
  });
});

describe("countDocWords", () => {
  const schema = getSchema(createSchemaExtensions());
  const manager = createMarkdownManager();
  const docOf = (md: string) => schema.nodeFromJSON(manager.parse(md));

  it("keeps words in separate blocks apart", () => {
    const doc = docOf("# Heading\n\nFirst paragraph.\n\n- one\n- two\n\n| a | b |\n| - | - |\n| c | d |\n");
    expect(countDocWords(doc)).toBe(9);
  });

  it("counts only the words between two positions", () => {
    const doc = docOf("alpha beta gamma\n");
    // Position 1 is the start of the paragraph's text.
    expect(countDocWords(doc, 1, 1 + "alpha beta".length)).toBe(2);
  });

  it("agrees with the Markdown count for the same note", () => {
    const md = "## Plan\n\n1. Write [the intro](https://x.y)\n2. Edit it\n\n> A *quoted* line\n";
    expect(countDocWords(docOf(md))).toBe(countMarkdownWords(md));
  });
});
