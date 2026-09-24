import { describe, expect, it } from "vitest";
import { findSectionKey, joinSections, splitSections } from "./sections";

describe("splitSections", () => {
  it("cuts at # and ## headings, keeping ### inside, and joins back exactly", () => {
    const body = "Intro line.\n\n# Title\n\nText.\n\n## Plan ##\n\n### Detail\n\nMore.\n";
    const sections = splitSections(body);
    expect(sections.map((s) => [s.key, s.heading])).toEqual([
      ["", null],
      ["1:title", "# Title"],
      ["2:plan", "## Plan ##"],
    ]);
    expect(sections[2].text).toBe("## Plan ##\n\n### Detail\n\nMore.\n");
    expect(joinSections(sections)).toBe(body);
  });

  it("always has the opening text first, even when empty", () => {
    expect(splitSections("")).toEqual([{ key: "", name: "", heading: null, text: "" }]);
    expect(splitSections("## A\nx").map((s) => s.text)).toEqual(["", "## A\nx"]);
  });

  it("ignores headings inside fenced code and lines that only look like headings", () => {
    const body =
      "## Real\n\n```sh\n# not a heading\n```\n\n#hashtag\n    # indented code\n~~~~\n## also code\n~~~~\n";
    expect(splitSections(body).map((s) => s.key)).toEqual(["", "2:real"]);
  });

  it("keeps a fence open until a closing run at least as long", () => {
    const body = "````\n```\n## inside\n````\n## Outside\n";
    expect(splitSections(body).map((s) => s.key)).toEqual(["", "2:outside"]);
  });

  it("numbers repeated headings, and matches case and spacing loosely", () => {
    const sections = splitSections("## Notes\na\n## notes\nb\n##   NOTES  \nc\n## Notes 2\n");
    expect(sections.map((s) => s.key)).toEqual(["", "2:notes", "2:notes\n2", "2:notes\n3", "2:notes 2"]);
    expect(findSectionKey(sections, "## Notes")).toBe("2:notes");
    expect(findSectionKey(sections, "notes 2")).toBe("2:notes 2");
    expect(findSectionKey(sections, null)).toBe("");
    expect(findSectionKey(sections, "Missing")).toBeNull();
  });
});
