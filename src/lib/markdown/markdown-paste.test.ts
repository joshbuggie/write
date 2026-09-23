import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensions, createMarkdownManager } from "./extensions";
import { looksLikeMarkdown, parsePastedMarkdown } from "./markdown-paste";
import { serializeBody } from "./serialize";

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

  it.each([
    ["unclosed brackets", "[a ".repeat(35_000)],
    ["link starts without a closing parenthesis", "[a](x".repeat(50_000)],
    ["bold starts", "**a".repeat(80_000)],
  ])("stays fast on 100 KB+ of %s", (_, text) => {
    const start = performance.now();
    looksLikeMarkdown(text);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("parsePastedMarkdown on large pastes", () => {
  it("pastes more than a note can open visually as text, without parsing it", () => {
    const manager = createMarkdownManager();
    const text = "# Log\n\n" + "- item\n".repeat(40_000); // 280 KB of short lines
    const start = performance.now();
    expect(parsePastedMarkdown(manager, text)).toBeNull();
    expect(performance.now() - start).toBeLessThan(150);
  });
});

describe("parsePastedMarkdown", () => {
  const manager = createMarkdownManager();
  const editors: Editor[] = [];
  afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

  /** What the note holds after pasting `text` at the end of a note containing "start". */
  function pasteAtEnd(text: string): string {
    const editor = new Editor({
      element: null,
      extensions: createExtensions(),
      content: "start",
      contentType: "markdown",
    });
    editors.push(editor);
    const content = parsePastedMarkdown(editor.markdown!, text);
    if (!content) throw new Error("expected markdown the editor can keep");
    editor.chain().setTextSelection(editor.state.doc.content.size).insertContent(content).run();
    return serializeBody(editor);
  }

  it.each([
    ["# Title\n\nSome **bold** and a [link](https://example.com).\n"],
    ["* one\n* two\n"],
    ["- a\n\n  ```sh\n  npm i\n  ```\n"],
    ["See [docs].\n\n[docs]: https://docs.example\n"],
    ["1. a\n   - b\n     ```\n     x\n     ```\n"],
  ])("inserts markdown the editor keeps: %j", (text) => {
    expect(parsePastedMarkdown(manager, text)).not.toBeNull();
  });

  it("inserts the parsed markdown like before", () => {
    expect(pasteAtEnd("## Heading\n\n- a\n- b\n")).toBe("start\n\n## Heading\n\n- a\n- b\n");
  });

  it.each([
    ["fenced code in a list item indented 3 spaces", "* Install\n   ```sh\n   npm i\n   ```\n* Run\n"],
    ["fenced code in a list item indented 4 spaces", "- Install:\n\n    ```sh\n    npm i\n    ```\n"],
    ["a linked badge", "[![CI](https://ci.example/badge.svg)](https://ci.example/run)\n"],
    ["HTML", "## Setup\n\n<details>\n<summary>More</summary>\n\nHidden\n</details>\n"],
    ["an unused reference definition", "# Links\n\n[home]: https://example.com\n"],
    ["a huge paragraph", "# Log\n\n" + "x <1 _".repeat(3000)],
  ])("returns null (paste as plain text) for %s", (_, text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
    expect(parsePastedMarkdown(manager, text)).toBeNull();
  });
});
