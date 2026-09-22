/// <reference types="vite/types/importMeta.d.ts" />
import { describe, expect, it } from "vitest";
import { createMarkdownManager } from "./extensions";
import { analyzeFidelity, hasOversizedParagraph } from "./fidelity";
import { finalizeMarkdown } from "./file-format";

const manager = createMarkdownManager();
/** What serializeBody(editor) returns right after the editor loads `body`. */
const roundTrip = (body: string) => finalizeMarkdown(manager.serialize(manager.parse(body)));
const fidelityOf = (body: string) => analyzeFidelity(body, roundTrip(body));

describe("analyzeFidelity", () => {
  it.each([
    ["# Title\n\nSome **bold** text.\n"],
    ["- [ ] a\n  - [x] b\n"],
    ["Text without a final newline"],
    ["Trailing spaces   \n\n\n"],
    ["Pure math that round-trips: $\\frac{a}{b}$\n"],
    ["Use ``a`b`` here.\n"],
  ])("exact: %j", (body) => {
    expect(fidelityOf(body)).toEqual({ kind: "exact" });
  });

  it.each([
    ["setext headings", "Title\n=====\n\nSub\n---\n"],
    ["* bullets", "* one\n* two\n"],
    ["autolinks", "<https://example.com> and https://example.org\n"],
    ["tables", "| a | b |\n|---|---|\n| 1 | 2 |\n"],
    ["_em_", "_em_ and __strong__\n"],
    ["loose lists", "- a\n\n- b\n"],
    ["reference links", "[a][r]\n\n[r]: https://x.y\n"],
    ["tilde fences", "~~~\ncode\n~~~\n"],
    ["a definition used as [a]", "See [A].\n\n[a]: https://a.com\n"],
    ["prices, not math", "Cost $5 and $10, _cheap_\n"],
    ["math the round trip keeps", "Einstein: $E=mc^2$\n\n* famous\n"],
    ["live Obsidian syntax", "#tag [[Note]] ==hi== %%c%%\n\n* item\n"],
    ["escapes that stay", "\\# not a heading, \\[x](y) and *x*\n"],
    // A marker change starts a new list; the editor keeps both lists apart.
    ["adjacent lists with different markers", "* one\n* two\n+ three\n"],
  ])("normalized: %s", (_, body) => {
    expect(fidelityOf(body)).toEqual({ kind: "normalized" });
  });

  it.each([
    ["<details>", "<details>\n<summary>More</summary>\n\nHidden\n</details>\n", ["html"]],
    ["an HTML comment", "a\n\n<!-- private -->\n\nb\n", ["html"]],
    ["inline HTML", "Press <kbd>Ctrl</kbd> now.\n", ["html"]],
    ["a footnote definition", "Text[^1].\n\n[^1]: The definition.\n", ["footnotes"]],
    ["math the escaper would touch", "$\\frac{a*b}{c}$ and $x_1$\n", ["math"]],
    ["display math", "$$\n\\sum_i x_i\n$$\n\nThen *text*_\n", ["math"]],
    // Link reference definitions render as nothing, so only a textual check sees them disappear.
    ["a [//]: # comment", "Text\n\n[//]: # (This is a hidden comment)\n\nMore\n", ["references"]],
    ["a [comment]: <> comment", "Text\n\n[comment]: <> (hidden)\n", ["references"]],
    [
      "bookmark definitions",
      '# Links\n\n[home]: https://example.com\n[docs]: https://d.example "Docs"\n',
      ["references"],
    ],
    [
      "one unused definition",
      "See [a].\n\n[a]: https://a.com\n[unused]: https://secret.example/token\n",
      ["references"],
    ],
    ["a definition in a quote", "> Quote\n>\n> [x]: https://x.example\n", ["references"]],
    // Used definitions are fine (they become inline links); the linked badge itself is what breaks.
    [
      "a linked badge",
      "[![CI][b]][ci]\n\n[b]: https://ci.example/b.svg\n[ci]: https://ci.example\n",
      ["structure"],
    ],
    // Inline math is read verbatim by KaTeX/MathJax, so escapes added or removed inside it break it.
    ["math with subscripts", "Formula $x_{ij}$ and $a_{n+1} = a_n * 2$\n", ["math"]],
    ["math with stars", "Stars $a * b * c$ and $2*3$\n", ["math"]],
    ["math with ^ and _", "Formula $x^2_i + y_{j}$ here\n", ["math"]],
    ["math with escaped braces", "Set $\\{a\\}$\n", ["math"]],
    // Escapes GFM doesn't need but other tools do: dropping them makes the syntax live there.
    ["an escaped Obsidian comment", "Not comment \\%\\%x\\%\\%\n", ["escapes"]],
    ["an escaped tag", "Not a tag: \\#tag\n", ["escapes"]],
    ["an escaped wikilink", "Not a link: \\[\\[Note\\]\\]\n", ["escapes"]],
    ["an escaped highlight", "\\=\\=x\\=\\=\n", ["escapes"]],
    ["escaped dollars", "Price \\$5 and \\$10\n", ["escapes"]],
  ])("lossy: %s", (_, body, reasons) => {
    expect(fidelityOf(body)).toEqual({ kind: "lossy", reasons });
  });

  it("reports several reasons at once", () => {
    const body = "<b>x</b> $$y$$\n\n[^1]: z\n";
    expect(analyzeFidelity(body, "changed\n")).toEqual({
      kind: "lossy",
      reasons: ["html", "footnotes", "math"],
    });
  });

  it("ignores HTML, footnotes and math inside code", () => {
    const body = "`<div>` and `$\\alpha$`\n\n```\n<details>\n[^1]: x\n$$\n```\n\n* item\n";
    expect(fidelityOf(body)).toEqual({ kind: "normalized" });
  });

  it("compares code block content byte for byte", () => {
    const body = "```\nif x:\n    y\n```\n\n* item\n";
    expect(analyzeFidelity(body, "```\nif x:\n     y\n```\n\n- item\n")).toEqual({
      kind: "lossy",
      reasons: ["structure"],
    });
    expect(analyzeFidelity(body, "```\nif x:\n    y\n```\n\n- item\n")).toEqual({ kind: "normalized" });
  });

  it("compares structure, not just text", () => {
    expect(analyzeFidelity("# Title\n", "Title\n")).toEqual({ kind: "lossy", reasons: ["structure"] });
    expect(analyzeFidelity("*a*\n", "a\n")).toEqual({ kind: "lossy", reasons: ["structure"] });
  });

  it('stays fast on a long paragraph full of "$" and backslashes', () => {
    const body = "$\\a".repeat(30_000) + "\n";
    const start = performance.now();
    analyzeFidelity(body, "changed\n");
    expect(performance.now() - start).toBeLessThan(100);
  });
});

/**
 * Realistic notes the visual editor must not open: `__fixtures__/fidelity/<reason>.<case>.md` has to be
 * classified lossy with at least <reason>, so it opens in source mode instead of changing on first edit.
 */
const lossyFixtures = import.meta.glob("./__fixtures__/fidelity/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("lossy fixture notes", () => {
  const cases = Object.entries(lossyFixtures).map(([path, body]) => ({
    name: path.replace("./__fixtures__/fidelity/", ""),
    body: body as string,
  }));

  it("has fixtures", () => {
    expect(cases.length).toBeGreaterThan(3);
  });

  it.each(cases)("$name", ({ name, body }) => {
    const fidelity = fidelityOf(body);
    expect(fidelity.kind).toBe("lossy");
    expect(fidelity.kind === "lossy" && fidelity.reasons).toContain(name.split(".")[0]);
  });
});

describe("hasOversizedParagraph", () => {
  it("flags one huge paragraph, which marked parses in quadratic time", () => {
    expect(hasOversizedParagraph("# Log\n\n" + "x <1 _".repeat(3000) + "\n")).toBe(true);
  });

  it("accepts long notes made of normal paragraphs and long code blocks", () => {
    const prose = "A normal paragraph of prose. ".repeat(40);
    const code = "```\n" + "const x = 1;\n".repeat(5000) + "```\n";
    expect(hasOversizedParagraph(`${prose}\n\n`.repeat(200) + code)).toBe(false);
  });
});
