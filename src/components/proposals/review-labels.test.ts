import { describe, expect, it } from "vitest";
import type { ProposalChange } from "@/lib/proposals/types";
import { applyLabel, appliedMessage, bannerText, changeTitle, conflictNote } from "./review-labels";

const change = (patch: Partial<ProposalChange>): ProposalChange => ({
  key: "2:a",
  kind: "modified",
  heading: "## A",
  state: "clean",
  reason: null,
  base: "",
  current: "",
  proposed: "",
  ...patch,
});

describe("review labels", () => {
  it("names sections by their heading text", () => {
    expect(changeTitle({ heading: "## Plan ##" })).toBe("Plan");
    expect(changeTitle({ heading: null })).toBe("Opening text");
    expect(changeTitle({ heading: "##" })).toBe("Untitled section");
  });

  it("explains what accepting does to a section the owner changed too", () => {
    expect(conflictNote(change({}), "Turnstone")).toBeNull();
    expect(conflictNote(change({ state: "conflict" }), "Turnstone")).toContain("replaces your version");
    expect(conflictNote(change({ state: "gone" }), "Turnstone")).toContain("adds it back");
    expect(conflictNote(change({ state: "conflict", kind: "removed" }), "Hermes")).toContain(
      "removes it, with your edits",
    );
  });

  it("counts sections and conflicts for the banner", () => {
    const summary = { id: "x", source: "Turnstone", createdAt: "", summary: "", changes: 3, conflicts: 1 };
    expect(bannerText(summary)).toBe("Turnstone proposed changes to 3 sections, 1 of which you also edited.");
    expect(bannerText({ ...summary, changes: 1, conflicts: 0 })).toBe(
      "Turnstone proposed changes to 1 section.",
    );
  });

  it("labels the Apply button by what will happen", () => {
    expect(applyLabel({})).toBeNull();
    expect(applyLabel({ a: "accept", b: "accept" })).toBe("Apply 2 changes");
    expect(applyLabel({ a: "reject" })).toBe("Reject 1 change");
    expect(applyLabel({ a: "accept", b: "reject" })).toBe("Apply 1, reject 1");
    expect(appliedMessage(2, 1)).toBe("Applied 2 changes. 1 change still waiting.");
    expect(appliedMessage(0, 0)).toBe("Rejected the changes.");
    expect(appliedMessage(1, 1, 1)).toBe(
      "Applied 1 change, but write couldn't record your decisions, so 1 change you rejected will be offered again.",
    );
  });
});
