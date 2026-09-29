import { describe, expect, it } from "vitest";
import { markdownHeadings } from "./markdown-headings";

describe("markdownHeadings", () => {
  it("finds levels 1 to 3 with where each line starts", () => {
    const file = "# Plan\n\nText\n## Beds\n### Bed 1 ##\n#### Too deep\n";
    expect(markdownHeadings(file)).toEqual([
      { offset: 0, level: 1, title: "Plan" },
      { offset: 13, level: 2, title: "Beds" },
      { offset: 21, level: 3, title: "Bed 1" },
    ]);
  });

  it("skips front matter, code blocks, empty headings and hashtags", () => {
    const file = "---\ntitle: x\n---\n#tag\n#\n```\n# not a heading\n```\n## Real\r\n";
    const [real] = markdownHeadings(file);
    expect(markdownHeadings(file)).toHaveLength(1);
    expect(real).toMatchObject({ level: 2, title: "Real" });
    expect(file.slice(real.offset).startsWith("## Real")).toBe(true);
  });

  it("keeps a fence open until one of the same kind and length closes it", () => {
    expect(markdownHeadings("````\n```\n# inside\n````\n# after")).toEqual([
      { offset: 23, level: 1, title: "after" },
    ]);
  });
});
