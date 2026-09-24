import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensions } from "@/lib/markdown/extensions";
import { serializeBody } from "@/lib/markdown/serialize";
import { captureTarget, hideHighlight, setHighlightVisible, showHighlight } from "./ai-target";
import { insertBelow, keepsFormatting, replaceNote, replaceTarget } from "./apply-reply";

const editors: Editor[] = [];
function headlessEditor(markdown: string): Editor {
  const editor = new Editor({
    element: null,
    extensions: createExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

/** Document position just inside the first text node containing `needle`, plus `offset` characters. */
function posOf(editor: Editor, needle: string, offset = 0): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return;
    const i = node.text?.indexOf(needle) ?? -1;
    if (i >= 0) found = pos + i + offset;
  });
  if (found < 0) throw new Error(`"${needle}" not found`);
  return found;
}

/** Selects from the start of `start` to the end of `end` and captures the target. */
function selectionTarget(editor: Editor, start: string, end: string) {
  editor.commands.setTextSelection({ from: posOf(editor, start), to: posOf(editor, end, end.length) });
  return captureTarget(editor);
}

/** Puts the caret inside `needle` (nothing selected) and captures the prompt window's target there. */
function targetAt(editor: Editor, needle: string) {
  editor.commands.setTextSelection(posOf(editor, needle, 1));
  return captureTarget(editor);
}

describe("captureTarget", () => {
  it("captures the paragraph at the caret as Markdown, so links and code survive a rewrite", () => {
    const editor = headlessEditor("See [the docs](https://x.com) and `code` here.\n");
    const target = targetAt(editor, "here");
    expect(target.kind).toBe("paragraph");
    expect(target.text).toBe("See [the docs](https://x.com) and `code` here.\n");
  });

  it("treats an empty line as the caret only, with no note text", () => {
    const editor = headlessEditor("First.\n");
    editor.view.dispatch(
      editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodes.paragraph.create()),
    );
    editor.commands.setTextSelection(editor.state.doc.content.size - 1); // inside the new empty paragraph
    expect(captureTarget(editor)).toMatchObject({ kind: "cursor", text: "" });
  });

  it("fills an empty line with the reply, without leaving blank paragraphs around it", () => {
    const editor = headlessEditor("First.\n");
    editor.view.dispatch(
      editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodes.paragraph.create()),
    );
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    replaceTarget(editor, captureTarget(editor), "- one\n- two");
    expect(serializeBody(editor)).toBe("First.\n\n- one\n- two\n");
  });

  it("reads a code block as raw text", () => {
    const editor = headlessEditor("```py\ndef __init__(self):\n```\n");
    const target = targetAt(editor, "def");
    expect(target).toMatchObject({ kind: "paragraph", code: true, text: "def __init__(self):" });
  });
});

describe("replaceTarget", () => {
  it("doesn't spread the target's first marks over a plain reply", () => {
    const editor = headlessEditor("**Note:** this is really good.\n");
    replaceTarget(editor, targetAt(editor, "this"), "Note: this is good.");
    expect(serializeBody(editor)).toBe("Note: this is good.\n");
  });

  it("doesn't turn a plain reply into a link when the paragraph starts with one", () => {
    const editor = headlessEditor("[Docs](https://x.com) say this is really good.\n");
    replaceTarget(editor, targetAt(editor, "say"), "They say this is good.");
    expect(serializeBody(editor)).toBe("They say this is good.\n");
  });

  it("keeps the reply's own formatting", () => {
    const editor = headlessEditor("**Note:** this is really good.\n\nNext.\n");
    replaceTarget(editor, targetAt(editor, "this"), "**Note:** this is good.");
    expect(serializeBody(editor)).toBe("**Note:** this is good.\n\nNext.\n");
  });

  it("replaces a paragraph with several blocks where the container can hold them", () => {
    const editor = headlessEditor("Before.\n\nOld text.\n\nAfter.\n");
    replaceTarget(editor, targetAt(editor, "Old"), "- one\n- two");
    expect(serializeBody(editor)).toBe("Before.\n\n- one\n- two\n\nAfter.\n");
  });

  it("joins a block reply into one line inside a table cell instead of splitting the table", () => {
    const editor = headlessEditor("| A | B |\n| --- | --- |\n| cell text | x |\n");
    replaceTarget(editor, targetAt(editor, "cell"), "- first thing\n- second thing");
    expect(serializeBody(editor)).toBe(
      "| A                        | B   |\n" +
        "| ------------------------ | --- |\n" +
        "| first thing second thing | x   |\n",
    );
  });

  it("keeps a list item a list item when a list reply can't nest there", () => {
    const editor = headlessEditor("- one item here\n- two\n");
    replaceTarget(editor, targetAt(editor, "item"), "- first\n- second");
    expect(serializeBody(editor)).toBe("- first second\n- two\n");
  });

  it("puts a reply into a code block verbatim, without the fence a model may add", () => {
    const editor = headlessEditor("```py\ndef init(self):\n```\n");
    replaceTarget(editor, targetAt(editor, "def"), "```python\ndef __init__(self, *args, **kwargs):\n```");
    expect(serializeBody(editor)).toBe("```py\ndef __init__(self, *args, **kwargs):\n```\n");
  });
  // One undo step is checked in the browser: history doesn't run in a headless (element: null) editor.
});

describe("insertBelow and replaceNote", () => {
  it("inserts after the whole list, not inside the item", () => {
    const editor = headlessEditor("- one\n- two\n\nAfter.\n");
    insertBelow(editor, targetAt(editor, "one"), "A new paragraph.");
    expect(serializeBody(editor)).toBe("- one\n- two\n\nA new paragraph.\n\nAfter.\n");
  });

  it("inserts a reply to a code block as a new code block in the same language", () => {
    const editor = headlessEditor("```js\nconst a = 1;\n```\n");
    insertBelow(editor, targetAt(editor, "const"), "const b = 2;");
    expect(serializeBody(editor)).toBe("```js\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```\n");
  });

  it("replaces the whole body once, instead of pasting the whole note over one paragraph", () => {
    const editor = headlessEditor("# Plan\n\nfirst i think this.\n\nsecond para here.\n");
    targetAt(editor, "first");
    replaceNote(editor, "# Plan\n\nFirst I think this.\n\nSecond para here.");
    expect(serializeBody(editor)).toBe("# Plan\n\nFirst I think this.\n\nSecond para here.\n");
  });
});

describe("the target highlight", () => {
  it("never counts as an edit, so opening and closing the window can't trigger a save", () => {
    const editor = headlessEditor("Some text here.\n");
    let updates = 0;
    editor.on("update", () => updates++);
    const target = targetAt(editor, "text");
    showHighlight(editor, target);
    setHighlightVisible(editor, false);
    setHighlightVisible(editor, true);
    hideHighlight(editor);
    expect(updates).toBe(0);
    expect(serializeBody(editor)).toBe("Some text here.\n");
  });

  it("follows the target when the note changes while the window is open", () => {
    const editor = headlessEditor("Intro.\n\nTarget text.\n");
    const target = targetAt(editor, "Target");
    showHighlight(editor, target);
    editor.view.dispatch(editor.state.tr.insertText("New ", posOf(editor, "Intro")));
    replaceTarget(editor, target, "Replaced.");
    expect(serializeBody(editor)).toBe("New Intro.\n\nReplaced.\n");
  });
});

describe("selections across blocks", () => {
  it("keeps selected list items as separate items when the reply is a list", () => {
    const editor = headlessEditor("Intro.\n\n- item one\n- item two\n- item three\n\nAfter.\n");
    const target = selectionTarget(editor, "item one", "item three");
    expect(target).toMatchObject({ wholeBlocks: true, text: "- item one\n- item two\n- item three\n" });
    replaceTarget(editor, target, "- Item one.\n- Item two.\n- Item three.");
    expect(serializeBody(editor)).toBe("Intro.\n\n- Item one.\n- Item two.\n- Item three.\n\nAfter.\n");
  });

  it("keeps tasks and their checked state", () => {
    const editor = headlessEditor("- [ ] buy milk\n- [x] call bob\n");
    replaceTarget(editor, selectionTarget(editor, "buy", "bob"), "- [ ] Buy milk.\n- [x] Call Bob.");
    expect(serializeBody(editor)).toBe("- [ ] Buy milk.\n- [x] Call Bob.\n");
  });

  it("grows a selection from a paragraph into a list to the whole blocks, and replaces exactly those", () => {
    const editor = headlessEditor("Intro.\n\n- one\n- two\n\nOutro.\n");
    const target = selectionTarget(editor, "Intro", "one");
    expect(target.text).toBe("Intro.\n\n- one\n- two\n");
    replaceTarget(editor, target, "Intro, fixed.\n\n- One\n- Two");
    expect(serializeBody(editor)).toBe("Intro, fixed.\n\n- One\n- Two\n\nOutro.\n");
  });

  it("treats a selection that starts in a code block and ends after it as blocks, not code", () => {
    const editor = headlessEditor("```js\nconst a = 1;\n```\n\n# Heading\n\nSome paragraph.\n");
    const target = selectionTarget(editor, "const", "paragraph");
    expect(target).toMatchObject({ code: false, wholeBlocks: true });
    replaceTarget(editor, target, "```js\nconst a = 2;\n```\n\n# Heading\n\nSome paragraph, fixed.");
    expect(serializeBody(editor)).toBe("```js\nconst a = 2;\n```\n\n# Heading\n\nSome paragraph, fixed.\n");
  });

  it("makes a selection of table cells about the whole table", () => {
    const editor = headlessEditor("| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n");
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[3])),
    );
    const target = captureTarget(editor);
    expect(target).toMatchObject({ name: "Table", wholeBlocks: true });
    expect(target.text).toContain("one");
    expect(target.text).toContain("four");
  });
});

describe("lines that only look empty", () => {
  it("treats a line holding just an image as a paragraph, so Insert can't delete the image", () => {
    const editor = headlessEditor("Intro.\n\n![diagram](img.png)\n\nOutro.\n");
    let image = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") image = pos;
    });
    editor.commands.setTextSelection(image + 1);
    const target = captureTarget(editor);
    expect(target.kind).toBe("paragraph");
    insertBelow(editor, target, "- one\n- two");
    expect(serializeBody(editor)).toBe("Intro.\n\n![diagram](img.png)\n\n- one\n- two\n\nOutro.\n");
  });

  it("keeps text typed on the empty line after the window opened", () => {
    const editor = headlessEditor("First.\n");
    editor.view.dispatch(
      editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodes.paragraph.create()),
    );
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const target = captureTarget(editor);
    showHighlight(editor, target);
    editor.view.dispatch(editor.state.tr.insertText("My own sentence.", target.from));
    replaceTarget(editor, target, "## Intro\n\nGenerated.");
    expect(serializeBody(editor)).toContain("My own sentence.");
    expect(serializeBody(editor)).toContain("Generated.");
  });
});

describe("keepsFormatting", () => {
  it("is false for Markdown the editor would drop, which then goes in as plain text", () => {
    expect(keepsFormatting("## Summary\n\n- **one**\n- two")).toBe(true);
    expect(keepsFormatting("- one<br>two")).toBe(false);
  });
});
