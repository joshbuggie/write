import { Lexer, type Token, type Tokens } from "marked";
import { describe, expect, it } from "vitest";
import { looksLikeMarkdown } from "./markdown-paste";
import { hasOversizedParagraph, scanBlocks } from "./oversized";
import { budget } from "./test-timing";

const K = 1024;
/** `make(i)` repeated until the text is `size` characters long. */
const upTo = (size: number, make: (i: number) => string) => {
  let text = "";
  for (let i = 0; text.length < size; i++) text += make(i);
  return text.slice(0, size);
};
const elapsed = (run: () => unknown) => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

describe("hasOversizedParagraph on note open and paste", () => {
  // Shapes marked's block lexer is super-linear on (it froze the tab for seconds), and others that
  // stress the scan; all as large as a note that opens visually can be.
  const hostile: Array<[string, string]> = [
    [
      "a list item with indented log lines",
      "- Log output:\n" + upTo(256 * K, (i) => `    ${`log ${i} `.padEnd(80, "x")}\n`),
    ],
    ["quotes whose depth changes on every line", upTo(256 * K, (i) => ">".repeat(1 + (i % 8)) + " x\n")],
    ["quotes cycling to 30 deep", upTo(256 * K, (i) => "> ".repeat(1 + (i % 30)) + "x\n")],
    ["lists cycling to 30 deep", upTo(256 * K, (i) => "  ".repeat(i % 30) + "- x\n")],
    ["a list item with 30,000 continuation lines", "- item\n" + upTo(256 * K, () => "  more\n")],
    ["fences opening and closing", upTo(256 * K, (i) => (i % 3 ? "x\n" : "```\n"))],
    ["table headers and delimiter rows", upTo(256 * K, (i) => (i % 2 ? "a | b\n" : "--- | ---\n"))],
    [
      "mixed containers",
      upTo(256 * K, (i) => ["> - a\n", ">     b\n", "- > c\n", "   1. d\n", "e\n"][i % 5]),
    ],
    ["HTML block starts", upTo(256 * K, (i) => (i % 2 ? "<div>\n" : "<!-- x\n"))],
    ["one line", "x".repeat(256 * K)],
    ["one line of table and heading syntax", "|- :".repeat(64 * K)],
    [
      "quoted headings, each with lazy lines",
      upTo(256 * K, (i) => ["> ## h\n", "text\n", "-\n", "\tx\n"][i % 4]),
    ],
    ["tabs after list markers opening fences", upTo(256 * K, (i) => (i % 2 ? "-\t```\n" : "x\n"))],
    ["list items with tabs, all heading text", "a\n" + upTo(256 * K, () => "-\tb\n") + "\n---\n"],
    // A line indented as code before a delimiter row ("| - |") is lazy paragraph text, not a table
    // header, so the rows after it are one paragraph (with emphasis, the slowest kind to parse).
    [
      "a lazy code line over a delimiter row, then emphasis",
      "a\n     b\n| - |\n" + upTo(256 * K, () => "*a **b _c [d](e ".repeat(5) + "\n"),
    ],
  ];

  it.each(hostile)("decides %s in well under 150 ms", (_, markdown) => {
    hasOversizedParagraph(markdown); // warm up
    // A few milliseconds on a laptop; the bound only catches a return of super-linear time.
    expect(elapsed(() => hasOversizedParagraph(markdown))).toBeLessThan(budget(150));
  });

  it("still sends the long runs among them to source mode", () => {
    const [logItem, quoteCycle, , , continuation] = hostile.map(([, markdown]) => markdown);
    const lazyTableHeader = hostile.at(-1)![1];
    for (const markdown of [logItem, quoteCycle, continuation, lazyTableHeader])
      expect(hasOversizedParagraph(markdown)).toBe(true);
  });

  // Each line before the rows is lazy text in marked (indented as code in its container), so the rows
  // are one long paragraph, not a table.
  it.each([
    ["a line indented 5", "a\n     b\n| - |\n"],
    ["a line indented 4", "a\n    x | y\n--- | ---\n"],
    ["a tab-indented line", "a\n\tb | c\n- | -\n"],
    ["a list item's line indented 4 more", "- a\n      b\n  | - |\n"],
    ["a quote's lazy line in a list item", "- > a\n      b\n  | - |\n"],
  ])("sends rows after %s over a delimiter row to source mode", (_, start) => {
    const markdown = start + "w".repeat(78).concat("\n").repeat(400);
    expect(hasOversizedParagraph(markdown)).toBe(true);
  });

  // marked reads everything after each of these as one paragraph (or a list item's text): a tab after a
  // marker goes to the next tab stop, so "-\t```" is an item whose fence ends at the next line; closing
  // tags of script, pre, style and textarea aren't HTML blocks; a setext heading wins over the table
  // below it; and a quote takes the lines after any quoted line lazily, reading "-" there as text.
  it.each([
    ["-\t```\nx\n", ""],
    ["*\t```\n", ""],
    ["1.\t```\n", ""],
    ["-\t~~~~\n:-: | --\n", ""],
    ["-\t```\n-|-\n", ""],
    ["*\t```\n", "  "],
    ["> ## h\ntext\n-\n", "      "],
    ["> ---\ntext\n-\n", "      "],
    ["> ## h\n-->\n==\n", "      "],
    [">\t\n]]>\n-\n", "      "],
    ["><!--\nwwwwwwww\n-\n", "      "],
    ["> > <span>\n-->\n-\n", "      "],
    ["><table>\n-->\n  --\n", "      "],
    ["> </pre>\nwwwwwwww\n-\n", "      "],
    ["</pre>\n\t\n", "      "],
    ["a\n==\n| - |\n", ""],
    ["1. \t\n    </script>\n-\t\n      ~~~~\n", "      "],
    ["a\n-\t```\n", ""],
  ])("sends a long run after %j to source mode", (start, indent) => {
    const markdown = start + (indent + "w".repeat(78) + "\n").repeat(400);
    expect(hasOversizedParagraph(markdown)).toBe(true);
  });

  it("checks pasted text quickly too, before any parsing", () => {
    for (const text of ["[a](x".repeat(50_000), "[a](".repeat(64 * K), "**a".repeat(80_000)]) {
      expect(elapsed(() => looksLikeMarkdown(text) && hasOversizedParagraph(text))).toBeLessThan(budget(150));
    }
  });
});

describe("the nesting guard", () => {
  it.each([
    ["a separator line in fenced code", "```\n" + ">".repeat(40) + "\n```\n"],
    ["a separator line in indented code", "Text\n\n    " + ">".repeat(40) + "\n"],
    ["a spaced thematic break", "- ".repeat(40).trim() + "\n"],
    ["a list separator line in code in a list item", "- item\n\n  ```\n  " + "- ".repeat(40) + "\n  ```\n"],
  ])("ignores %s", (_, markdown) => {
    expect(hasOversizedParagraph(markdown)).toBe(false);
  });

  it.each([
    ["quotes", "> ".repeat(40) + "x\n"],
    ["lists", "- ".repeat(40) + "x\n"],
    ["empty quotes", ">".repeat(40) + "\n"],
    ["quotes right after a fence closes", "```\ncode\n```\n" + ">".repeat(40) + " x\n"],
  ])("still flags %s nested too deep", (_, markdown) => {
    expect(hasOversizedParagraph(markdown)).toBe(true);
  });
});

describe("scanBlocks", () => {
  const lines = (count: number, line: (i: number) => string) =>
    Array.from({ length: count }, (_, i) => line(i)).join("\n") + "\n";

  it.each([
    ["a long nested list", lines(1500, (i) => `${"  ".repeat(i % 4)}- item ${i}`)],
    ["a long numbered list", lines(1500, (i) => `${i + 1}. step ${i}`)],
    ["a long table in a quote", "> | a | b |\n> | --- | --- |\n" + lines(1200, (i) => `> | row ${i} | v |`)],
    [
      "code fenced in a nested list",
      "- a\n  - b\n\n    ```\n" + lines(3000, () => "    const x = 1;") + "    ```\n",
    ],
  ])("measures %s as short runs", (_, markdown) => {
    expect(markdown.length).toBeGreaterThan(16 * K);
    expect(scanBlocks(markdown).longestRun).toBeLessThan(200);
  });

  it("doesn't take a fence inside an HTML comment for code", () => {
    const paragraph = lines(2000, () => "note text");
    expect(scanBlocks("<!--\n```\n-->\n\n" + paragraph).longestRun).toBeGreaterThan(16 * K);
  });

  /** The longest run marked reads, in characters other than whitespace (marked re-indents some lines). */
  function longestRun(markdown: string): number {
    let longest = 0;
    const measure = (text: string) => (longest = Math.max(longest, text.replace(/\s/g, "").length));
    const visit = (tokens: Token[]) =>
      tokens.forEach((token) => {
        if (token.type === "paragraph" || token.type === "text" || token.type === "heading")
          measure(token.text);
        if (token.type === "table") {
          ([token.header, ...token.rows].flat() as Tokens.TableCell[]).forEach((cell) => measure(cell.text));
        }
        if (token.type === "list") (token as Tokens.List).items.forEach((item) => visit(item.tokens));
        if (token.type === "blockquote") visit(token.tokens ?? []);
      });
    visit(new Lexer({ gfm: true }).blockTokens(markdown));
    return longest;
  }

  it("never measures less than marked reads (a seeded search over mixed block syntax)", () => {
    let seed = 5;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
    const words = () => "w".repeat(1 + Math.floor(random() * 6));
    const kinds = [
      ...[
        "",
        "- ",
        "  - ",
        "    - ",
        "1. ",
        "5. ",
        "* ",
        "> ",
        ">> ",
        "> - ",
        "- > ",
        "    ",
        "     ",
        "      ",
        "\t",
        " \t",
        "  ",
        "# ",
      ].map((prefix) => () => prefix + words()),
      ...["", "```", "  ```", "~~~", "---", "- - -", "===", "-", "<div>", "| a | b |", "| --- | --- |"].map(
        (line) => () => line,
      ),
      ...["a | b", "--- | ---", "| - |", "  | - |", "- | -", "    x | y", "\tb | c"].map(
        (line) => () => line,
      ),
      // Lines marked reads unlike CommonMark: "- " starts no list, a tab keeps a paragraph going.
      ...["- ", "1. ", "\t", "> \t", ">     ", "<!-- x", "-->", "<span>"].map((line) => () => line),
      // A tab after a list marker (to the next tab stop), closing tags marked doesn't read as HTML,
      // and quoted lines of any block, which take the lines after them lazily (a "-" there is text).
      ...["-\t```", "*\t```", "1.\t```", "-\t~~~~", "*\t\t", "-\t", "</pre>", "</script>", "]]>"].map(
        (line) => () => line,
      ),
      ...["> ## h", "> ---", "><!--", "> > <span>", "><table>", "> </pre>", ">\t", "  --", "==", "-|-"].map(
        (line) => () => line,
      ),
      ...["      ", ":-: | --"].map((prefix) => () => prefix + words()),
    ];
    const misses: string[] = [];
    for (let n = 0; n < 20_000; n++) {
      const markdown =
        Array.from({ length: 2 + Math.floor(random() * 12) }, () => pick(kinds)()).join("\n") + "\n";
      // marked rewrites a few lazy lines by a character or two; a missed paragraph would be far more.
      if (scanBlocks(markdown).longestRun + 8 < longestRun(markdown)) misses.push(markdown);
    }
    expect(misses).toEqual([]);
  });
});
