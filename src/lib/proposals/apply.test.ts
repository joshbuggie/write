import { describe, expect, it } from "vitest";
import { applyChanges, proposedFromSections } from "./apply";
import { buildChanges } from "./review";
import { matchSection, splitSections } from "./sections";
import { bodySections } from "./review";

describe("untouched sections keep their exact bytes", () => {
  it("accepting a change to A leaves the last section B as it was, trailing spaces and blank lines included", () => {
    const current = "## A\n\nAlpha.\n\n## B\n\nBeta.   \n\n\n";
    const proposed = "## A\n\nAlpha, better.\n\n## B\n\nBeta.\n";
    const changes = buildChanges(current, proposed, current);
    expect(changes.map((c) => c.key)).toEqual(["2:a"]);
    expect(applyChanges(current, proposed, changes)).toBe("## A\n\nAlpha, better.\n\n## B\n\nBeta.   \n\n\n");
  });

  it("adding a section after the last one doesn't rewrite that last one", () => {
    const current = "## A\n\nAlpha.  ";
    const proposed = "## A\n\nAlpha.\n\n## Z\n\nNew.\n";
    const changes = buildChanges(current, proposed, current);
    expect(applyChanges(current, proposed, changes)).toBe("## A\n\nAlpha.  \n\n## Z\n\nNew.\n");
  });
});

describe("section edits keep the heading level", () => {
  const base = "# Summary\n\nTop.\n\n## Summary\n\nSub.\n";

  it("targets the section with the level given", () => {
    const result = proposedFromSections(base, [
      { heading: "## Summary", content: "## Summary\n\nSub, better.\n" },
    ]);
    expect(result).toEqual({ ok: true, file: "# Summary\n\nTop.\n\n## Summary\n\nSub, better.\n" });
  });

  it("refuses a heading that matches more than one section", () => {
    const result = proposedFromSections(base, [{ heading: "Summary", content: "## Summary\n\nX\n" }]);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("# Summary") });
    const twice = proposedFromSections("## Notes\n\na\n\n## Notes\n\nb\n", [
      { heading: "## Notes", content: "## Notes\n\nc\n" },
    ]);
    expect(twice.ok).toBe(false);
  });

  it("matches by level and text, and says when nothing matches", () => {
    const sections = splitSections(base);
    expect(matchSection(sections, "# summary")).toEqual({ key: "1:summary" });
    expect(matchSection(sections, "## Summary")).toEqual({ key: "2:summary" });
    expect(matchSection(sections, "Summary")).toMatchObject({ ambiguous: ["# Summary", "## Summary"] });
    expect(matchSection(sections, "## Other")).toEqual({ missing: true });
    expect(matchSection(sections, null)).toEqual({ key: "" });
  });
});

describe("byte preservation, randomized", () => {
  it("keeps every untouched section exactly, whatever is accepted", () => {
    let seed = 11;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
    const endings = ["\n", "\n\n", "  \n\n\n", "\t\n", ""];
    for (let run = 0; run < 300; run++) {
      const count = 1 + Math.floor(random() * 5);
      const names = Array.from({ length: count }, (_, i) => `S${i}`);
      const current = names
        .map((n, i) => `## ${n}\n\nText ${n}.${i === count - 1 ? pick(endings) : pick(endings.slice(0, 4))}`)
        .join("");
      const proposed = names
        .filter(() => random() > 0.2)
        .map((n) => `## ${n}\n\n${random() > 0.5 ? `New ${n}.` : `Text ${n}.`}\n\n`)
        .concat(random() > 0.5 ? ["## Added\n\nFresh.\n"] : [])
        .join("");
      const changes = buildChanges(current, proposed, current);
      const accepted = changes.filter(() => random() > 0.5);
      const result = applyChanges(current, proposed, accepted);
      const touched = new Set(accepted.map((c) => c.key));
      for (const section of bodySections(current)) {
        if (touched.has(section.key) || section.key === "" || !section.text) continue;
        expect(
          result.includes(section.text),
          `run ${run}: ${JSON.stringify(section.text)} in ${JSON.stringify(result)}`,
        ).toBe(true);
      }
    }
  });
});
