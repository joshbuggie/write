import { describe, expect, it } from "vitest";
import { looksLikeMarkdown } from "./markdown-paste";

describe("looksLikeMarkdown", () => {
  it.each([
    "# Heading",
    "intro\n## Section",
    "- item",
    "* item",
    "1. first",
    "2) second",
    "> quote",
    "```js\ncode\n```",
    "| a | b |",
    "some **bold** text",
    "a [link](https://example.com) inline",
  ])("detects %j", (text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    "Just a sentence.",
    "Two lines\nof prose",
    "https://example.com",
    "5 * 3 = 15",
    "#hashtag",
    "C:\\Users\\me",
    "",
  ])("leaves plain text %j alone", (text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});
