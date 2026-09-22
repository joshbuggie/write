import { describe, expect, it } from "vitest";
import { createMarkdownManager } from "@/lib/markdown/extensions";
import { analyzeFidelity } from "@/lib/markdown/fidelity";
import { finalizeMarkdown } from "@/lib/markdown/file-format";
import { WELCOME_MARKDOWN } from "./welcome";

describe("WELCOME_MARKDOWN", () => {
  it("is not lossy, so the first note opens in the visual editor", () => {
    const manager = createMarkdownManager();
    const roundTripped = finalizeMarkdown(manager.serialize(manager.parse(WELCOME_MARKDOWN)));
    expect(analyzeFidelity(WELCOME_MARKDOWN, roundTripped)).toEqual({ kind: "exact" });
    expect(roundTripped).toBe(WELCOME_MARKDOWN);
  });

  it("doesn't repeat the note title as a heading", () => {
    expect(WELCOME_MARKDOWN).not.toMatch(/^#\s/);
  });
});
