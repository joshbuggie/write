import { describe, expect, it } from "vitest";
import { createMarkdownManager } from "./extensions";
import { analyzeFidelity } from "./fidelity";
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
    ["adjacent lists that merge", "* one\n* two\n+ three\n", ["structure"]],
    ["inline code containing a backtick", "Use ``a`b`` here.\n", ["structure"]],
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

  it("compares structure, not just text", () => {
    expect(analyzeFidelity("# Title\n", "Title\n")).toEqual({ kind: "lossy", reasons: ["structure"] });
    expect(analyzeFidelity("*a*\n", "a\n")).toEqual({ kind: "lossy", reasons: ["structure"] });
  });
});
