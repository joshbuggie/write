import { describe, expect, it } from "vitest";
import { applyChanges, proposedFromSections } from "./apply";
import { buildChanges, reordersSections } from "./review";

const base = "Intro.\n\n## A\n\nAlpha.\n\n## B\n\nBeta.\n\n## C\n\nGamma.\n";

describe("buildChanges", () => {
  it("finds modified, added and removed sections; a removal follows the section it came after", () => {
    const proposed = "Intro.\n\n## A\n\nAlpha, better.\n\n## New\n\nFresh.\n\n## C\n\nGamma.\n";
    const changes = buildChanges(base, proposed, base, { A: "clearer" });
    expect(changes.map((c) => [c.key, c.kind, c.state, c.reason])).toEqual([
      ["2:a", "modified", "clean", "clearer"],
      ["2:b", "removed", "clean", null],
      ["2:new", "added", "clean", null],
    ]);
  });

  it("marks a section you changed too as a conflict, and one you removed as gone", () => {
    const proposed = base.replace("Alpha.", "Alpha!").replace("Beta.", "Beta!");
    const current = base.replace("Alpha.", "Alpha?").replace("## B\n\nBeta.\n\n", "");
    const changes = buildChanges(base, proposed, current);
    expect(changes.map((c) => [c.key, c.state])).toEqual([
      ["2:a", "conflict"],
      ["2:b", "gone"],
    ]);
  });

  it("leaves out changes already in the note and ignores trailing whitespace", () => {
    const proposed = base.replace("Alpha.", "Alpha!");
    expect(buildChanges(base, proposed, proposed)).toEqual([]);
    expect(buildChanges(base, base.replace("Gamma.\n", "Gamma.\n\n\n"), base)).toEqual([]);
  });

  it("never proposes front matter changes", () => {
    const withFm = "---\ntitle: x\n---\n" + base;
    const proposed = "---\ntitle: changed\n---\n" + base;
    expect(buildChanges(withFm, proposed, withFm)).toEqual([]);
  });
});

describe("applyChanges", () => {
  it("applies only accepted changes and keeps untouched sections byte for byte", () => {
    const proposed = "Intro.\n\n## A\n\nAlpha, better.\n\n## New\n\nFresh.\n\n## C\n\nGamma.\n";
    const current = base.replace("Gamma.", "Gamma (mine).");
    const changes = buildChanges(base, proposed, current);
    const onlyA = applyChanges(
      current,
      proposed,
      changes.filter((c) => c.key === "2:a"),
    );
    expect(onlyA).toBe(current.replace("Alpha.", "Alpha, better."));
    const all = applyChanges(current, proposed, changes);
    expect(all).toBe("Intro.\n\n## A\n\nAlpha, better.\n\n## New\n\nFresh.\n\n## C\n\nGamma (mine).\n");
  });

  it("puts a new section at the end with a blank line before it, and keeps front matter", () => {
    const current = "---\ntags: [a]\n---\n## A\n\nAlpha.\n";
    const proposed = "## A\n\nAlpha.\n\n## Z\n\nLast.";
    const changes = buildChanges(current, proposed, current);
    expect(applyChanges(current, proposed, changes)).toBe(
      "---\ntags: [a]\n---\n## A\n\nAlpha.\n\n## Z\n\nLast.\n",
    );
  });

  it("returns the same string when nothing is accepted", () => {
    expect(applyChanges(base, base, [])).toBe(base);
  });

  it("brings back a section you removed after the nearest earlier section still in the note", () => {
    const proposed = base.replace("Beta.", "Beta!");
    const current = base.replace("## B\n\nBeta.\n\n", "");
    const changes = buildChanges(base, proposed, current);
    expect(applyChanges(current, proposed, changes)).toBe(proposed);
  });
});

describe("proposedFromSections", () => {
  it("replaces named sections, removes emptied ones and appends new ones", () => {
    const proposed = proposedFromSections(base, [
      { heading: "## A", content: "## A\n\nAlpha, better.\n" },
      { heading: "B", content: "" },
      { heading: "## D", content: "## D\n\nDelta." },
      { heading: null, content: "New intro.\n" },
    ]);
    expect(proposed).toEqual({
      ok: true,
      file: "New intro.\n\n## A\n\nAlpha, better.\n\n## C\n\nGamma.\n\n## D\n\nDelta.\n",
    });
  });
});

describe("reordersSections", () => {
  const base = "Intro.\n\n## A\n\nAlpha.\n\n## B\n\nBeta.\n\n## A\n\nAgain.\n";
  it("sees shared sections in another order, not additions, removals or edits", () => {
    expect(reordersSections(base, "Intro.\n\n## B\n\nBeta.\n\n## A\n\nAlpha.\n\n## A\n\nAgain.\n")).toBe(
      true,
    );
    expect(reordersSections(base, "Intro.\n\n## A\n\nAlpha.\n\n## A\n\nAgain.\n\n## B\n\nBeta.\n")).toBe(
      true,
    );
    expect(reordersSections(base, "Intro.\n\n## A\n\nNew.\n\n## C\n\nC.\n\n## A\n\nAgain.\n")).toBe(false);
    expect(reordersSections(base, "---\nx: 1\n---\nIntro 2.\n\n## B\n\nBeta.\n")).toBe(false);
  });
});
