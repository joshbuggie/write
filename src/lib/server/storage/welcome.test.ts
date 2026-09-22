import { describe, expect, it } from "vitest";
import { createMarkdownManager } from "@/lib/markdown/extensions";
import { analyzeFidelity } from "@/lib/markdown/fidelity";
import { finalizeMarkdown } from "@/lib/markdown/file-format";
import { WELCOME_MARKDOWN } from "./welcome";

describe("WELCOME_MARKDOWN", () => {
  it("is not lossy, so the first note opens in the visual editor", () => {
    const manager = createMarkdownManager();
    const roundTripped = finalizeMarkdown(manager.serialize(manager.parse(WELCOME_MARKDOWN)));
    // Tiptap always writes a blank line before a table, so "normalized" is the best a table allows.
    expect(analyzeFidelity(WELCOME_MARKDOWN, roundTripped)).toEqual({ kind: "normalized" });
    expect(roundTripped.replace("\n\n\n|", "\n\n|")).toBe(WELCOME_MARKDOWN);
  });
});
