import { describe, expect, it } from "vitest";
import { composeFile, finalizeMarkdown, joinFile, splitFrontmatter } from "./file-format";

describe("splitFrontmatter", () => {
  it("splits YAML front matter including the blank lines after it", () => {
    const file = "---\ntitle: Hello\ntags: [a, b]\n---\n\n\n# Body\n";
    expect(splitFrontmatter(file)).toEqual({
      frontmatter: "---\ntitle: Hello\ntags: [a, b]\n---\n\n\n",
      body: "# Body\n",
    });
  });

  it("accepts the YAML `...` terminator", () => {
    expect(splitFrontmatter("---\na: 1\n...\nBody\n")).toEqual({
      frontmatter: "---\na: 1\n...\n",
      body: "Body\n",
    });
  });

  it("splits TOML front matter", () => {
    expect(splitFrontmatter('+++\ntitle = "x"\n+++\n\nBody\n')).toEqual({
      frontmatter: '+++\ntitle = "x"\n+++\n\n',
      body: "Body\n",
    });
  });

  it("does not close TOML with a YAML fence", () => {
    expect(splitFrontmatter("+++\na = 1\n---\nBody\n").frontmatter).toBe("");
  });

  it("handles CRLF line endings", () => {
    const file = "---\r\na: 1\r\n---\r\n\r\nBody\r\n";
    expect(splitFrontmatter(file)).toEqual({ frontmatter: "---\r\na: 1\r\n---\r\n\r\n", body: "Body\r\n" });
  });

  it("accepts front matter that ends the file", () => {
    expect(splitFrontmatter("---\na: 1\n---")).toEqual({ frontmatter: "---\na: 1\n---", body: "" });
  });

  it.each([
    ["a leading thematic break", "---\n\nParagraph\n\n---\n"],
    ["a blank line after the opening fence", "---\n\na: 1\n---\n"],
    ["no closing fence", "---\na: 1\nno end\n"],
    ["a fence that isn't on the first line", "\n---\na: 1\n---\n"],
    ["no front matter at all", "# Title\n\ntext\n"],
    ["an empty file", ""],
  ])("finds no front matter with %s", (_, file) => {
    expect(splitFrontmatter(file)).toEqual({ frontmatter: "", body: file });
  });
});

describe("joinFile", () => {
  // Deterministic PRNG so failures are reproducible.
  function mulberry32(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pieces = [
    "---",
    "+++",
    "...",
    "\n",
    "\r\n",
    " ",
    "\t",
    "a: 1",
    "title",
    "#",
    "é",
    "🎉",
    "",
    "-",
    "+",
    ".",
  ];

  it("reassembles 200 random strings exactly", () => {
    const random = mulberry32(42);
    let withFrontmatter = 0;
    for (let i = 0; i < 200; i++) {
      const length = Math.floor(random() * 20);
      let file = random() < 0.5 ? "---\n" : "";
      for (let j = 0; j < length; j++) file += pieces[Math.floor(random() * pieces.length)];
      const parts = splitFrontmatter(file);
      if (parts.frontmatter) withFrontmatter++;
      expect(joinFile(parts)).toBe(file);
    }
    expect(withFrontmatter).toBeGreaterThan(0);
  });
});

describe("finalizeMarkdown", () => {
  it.each([
    ["", ""],
    ["\n\n", ""],
    ["&nbsp;", ""],
    ["\u00a0\n", ""],
    ["text", "text\n"],
    ["\n\ntext\n\n\n", "text\n"],
    ["text   \n", "text\n"],
    ["a\n\n&nbsp;\n\n&nbsp;\n", "a\n"],
    ["a\n\n&nbsp;\n\nb", "a\n\n&nbsp;\n\nb\n"],
    ["  indented first line", "  indented first line\n"],
  ])("%j → %j", (input, output) => {
    expect(finalizeMarkdown(input)).toBe(output);
  });
});

describe("composeFile", () => {
  it("joins verbatim front matter and the finalized body", () => {
    expect(composeFile("---\na: 1\n---\n\n", "\n# Hi\n\n")).toBe("---\na: 1\n---\n\n# Hi\n");
  });

  it("returns only the front matter when the body is empty", () => {
    expect(composeFile("---\na: 1\n---\n", "")).toBe("---\na: 1\n---\n");
  });

  it("keeps new body text off the closing fence when the front matter had no final newline", () => {
    expect(composeFile("---\na: 1\n---", "Hello")).toBe("---\na: 1\n---\nHello\n");
  });

  it("works without front matter", () => {
    expect(composeFile("", "Hello")).toBe("Hello\n");
  });
});
