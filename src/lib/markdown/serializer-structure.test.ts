import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import { Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { dropPoint } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it } from "vitest";
import { TOOLBAR_ITEMS } from "@/components/editor/toolbar-items";
import { createExtensions, createMarkdownManager } from "./extensions";
import { analyzeFidelity } from "./fidelity";
import { finalizeMarkdown } from "./file-format";
import { serializeBody } from "./serialize";

/** Block structure the editor can create must re-open from the saved file as the same structure. */

const manager = createMarkdownManager();
const schema = getSchema(createExtensions());
/** JSON with every attribute filled in, as the editor holds it, so parsed and built documents compare. */
const normalized = (doc: JSONContent) => schema.nodeFromJSON(doc).toJSON();
const roundTrip = (md: string) => finalizeMarkdown(manager.serialize(manager.parse(md)));
const text = (value: string): JSONContent => ({ type: "text", text: value });
const paragraph = (value?: string): JSONContent => ({
  type: "paragraph",
  content: value ? [text(value)] : [],
});

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

/** A headless editor with its plugins installed (keymaps, cleanups), as a mounted editor has them. */
function editorWith(markdown: string): Editor {
  const editor = new Editor({
    element: null,
    extensions: createExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  editors.push(editor);
  return editor;
}

/** The position right after the first occurrence of `after` in the document text. */
function positionAfter(editor: Editor, after: string): number {
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text ?? "").indexOf(after) : -1;
    if (target === -1 && index !== -1) target = pos + index + after.length;
  });
  return target;
}

/** Puts the caret right after the first occurrence of `after` in the document text. */
function caretAfter(editor: Editor, after: string): void {
  const target = positionAfter(editor, after);
  editor.commands.command(({ tr }) => (tr.setSelection(TextSelection.create(tr.doc, target)), true));
}

function press(editor: Editor, key: string, shiftKey = false): boolean {
  const event = { key, shiftKey, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
  return editor.state.plugins.some((plugin) =>
    plugin.props.handleKeyDown?.call(plugin, editor.view, event as unknown as KeyboardEvent),
  );
}

/** The document the saved markdown re-opens as, in the editor's schema. */
const reopened = (editor: Editor) => editor.schema.nodeFromJSON(manager.parse(serializeBody(editor)));

const codeText = (markdown: string) =>
  JSON.stringify(manager.parse(markdown)).match(/"codeBlock".*?"text":"(.*?)"/)?.[1];

describe("ordered lists are read by marked's list tokenizer", () => {
  it.each([
    ["1. Add:\n   ```yaml\n     server:\n       port: 80\n   ```\n", "  server:\\n    port: 80"],
    ["1. Run:\n   ```\n   npm i\n   ```\n", "npm i"],
    ["1. Run:\n   ```\n\n   npm i\n   ```\n", "\\nnpm i"],
    ["10. Run:\n    ```\n    npm i\n    ```\n", "npm i"],
    ["> 1. Run:\n>    ```\n>    npm i\n>    ```\n", "npm i"],
    ["- a\n  1. b\n     ```\n     npm i\n     ```\n", "npm i"],
  ])("keeps the code under %j exactly, save after save", (markdown, code) => {
    expect(codeText(markdown)).toBe(code);
    const saves = [roundTrip(markdown)];
    saves.push(roundTrip(saves[0]), roundTrip(roundTrip(saves[0])));
    expect(saves).toEqual([markdown, markdown, markdown]);
  });

  it("reads a 1) list the same way (written back with dots)", () => {
    expect(roundTrip("1) Run:\n   ```\n   npm i\n   ```\n")).toBe("1. Run:\n   ```\n   npm i\n   ```\n");
  });

  it("keeps the code exact when pasted as markdown", () => {
    const editor = editorWith("start");
    editor.commands.insertContent("1. Install:\n   ```sh\n   npm install\n   ```\n2. Run", {
      contentType: "markdown",
    });
    expect(serializeBody(editor)).toContain("   ```sh\n   npm install\n   ```\n2. Run");
  });

  it("keeps a task list under a numbered item", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { start: 1, type: null },
          content: [
            {
              type: "listItem",
              content: [
                paragraph("one"),
                {
                  type: "taskList",
                  content: [
                    { type: "taskItem", attrs: { checked: true }, content: [paragraph("a")] },
                    { type: "taskItem", attrs: { checked: false }, content: [paragraph("b")] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(manager.serialize(doc)).toBe("1. one\n   - [x] a\n   - [ ] b");
    expect(normalized(manager.parse(manager.serialize(doc)))).toEqual(normalized(doc));
  });

  it("keeps a typed [ ] at the start of a numbered or bulleted item as text, not a checkbox", () => {
    expect(roundTrip("1. [ ] b\n")).toBe("1. \\[ ] b\n");
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph("[x] done")] }] }],
    };
    expect(manager.serialize(doc)).toBe("- \\[x] done");
    expect(normalized(manager.parse(manager.serialize(doc)))).toEqual(normalized(doc));
  });

  it("nests a four-space list under its item instead of under the previous bullet", () => {
    const md = "1. a\n    - b\n    - c\n";
    expect(roundTrip(md)).toBe("1. a\n   - b\n   - c\n");
    expect(analyzeFidelity(md, roundTrip(md))).toEqual({ kind: "normalized" });
  });
});

describe("code fences", () => {
  const codeBlock = (code: string, language: string | null = null): JSONContent => ({
    type: "doc",
    content: [{ type: "codeBlock", attrs: { language }, content: [text(code)] }],
  });

  it("outlast a ``` line inside the code", () => {
    const doc = codeBlock("# Example\n```js\nx\n```\nafter", "md");
    const markdown = manager.serialize(doc);
    expect(markdown).toBe("````md\n# Example\n```js\nx\n```\nafter\n````");
    expect(manager.parse(markdown)).toEqual(doc);
    expect(roundTrip(markdown)).toBe(finalizeMarkdown(markdown));
  });

  it("switch to tildes for an info string with a backtick", () => {
    const doc = codeBlock("x", "a`b");
    expect(manager.serialize(doc)).toBe("~~~a`b\nx\n~~~");
    expect(normalized(manager.parse(manager.serialize(doc)))).toEqual(normalized(doc));
  });
});

describe("dividers inside lists and quotes", () => {
  it.each([
    ["- first\n- second\n", "- first\n\n  ---\n- second\n"],
    ["1. one\n2. two\n", "1. one\n\n   ---\n2. two\n"],
    ["- [ ] task\n", "- [ ] task\n\n  ---\n"],
    ["> quote\n", "> quote\n>\n> ---\n"],
  ])("after the text of %j stay dividers, not a heading underline", (markdown, saved) => {
    const editor = editorWith(markdown);
    caretAfter(editor, markdown.match(/[a-z]+/)![0]);
    expect(editor.commands.setHorizontalRule()).toBe(true);
    expect(serializeBody(editor)).toBe(saved);
    expect(JSON.stringify(reopened(editor).toJSON())).not.toContain("heading");
    expect(JSON.stringify(reopened(editor).toJSON())).toContain("horizontalRule");
  });

  it("leaves a top-level divider as ---", () => {
    expect(roundTrip("a\n\n---\n\nb\n")).toBe("a\n\n---\n\nb\n");
  });
});

describe("table cells hold one line of text", () => {
  const table = "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n";
  const inCell = () => {
    const editor = editorWith(table);
    caretAfter(editor, "1");
    return editor;
  };

  it.each([
    ["splitBlock", (e: Editor) => e.commands.splitBlock()],
    ["setHardBreak", (e: Editor) => e.commands.setHardBreak()],
    ["toggleBulletList", (e: Editor) => e.commands.toggleBulletList()],
    ["toggleOrderedList", (e: Editor) => e.commands.toggleOrderedList()],
    ["toggleTaskList", (e: Editor) => e.commands.toggleTaskList()],
    ["toggleHeading", (e: Editor) => e.commands.toggleHeading({ level: 2 })],
    ["toggleBlockquote", (e: Editor) => e.commands.toggleBlockquote()],
    ["toggleCodeBlock", (e: Editor) => e.commands.toggleCodeBlock()],
    ["setHorizontalRule", (e: Editor) => e.commands.setHorizontalRule()],
    ["insertTable", (e: Editor) => e.commands.insertTable()],
  ])("%s is refused and the table is unchanged", (_, run) => {
    const editor = inCell();
    expect(run(editor)).toBe(false);
    expect(serializeBody(editor)).toBe(table);
  });

  it("disables the toolbar's block actions there", () => {
    const editor = inCell();
    const disabled = TOOLBAR_ITEMS.filter((item) => item.isDisabled?.(editor)).map((item) => item.id);
    expect(disabled).toEqual(
      expect.arrayContaining(["h1", "bulletList", "taskList", "blockquote", "codeBlock", "divider"]),
    );
    expect(disabled).not.toContain("bold");
  });

  it("moves to the next cell on Enter, and ignores Shift+Enter", () => {
    const editor = inCell();
    expect(press(editor, "Enter")).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe("2");
    press(editor, "Enter", true);
    expect(serializeBody(editor)).toBe(table);
  });

  it("turns a line break that arrives anyway into a space, and pastes blocks as one line", () => {
    const editor = inCell();
    editor.commands.insertContent([{ type: "hardBreak" }, text("x")]);
    expect(serializeBody(editor)).toBe("| a   | b   |\n| --- | --- |\n| 1 x | 2   |\n");
    const paste = editor.state.plugins.find((plugin) => plugin.props.transformPasted)!;
    const blocks = Slice.maxOpen(
      editor.schema.nodeFromJSON({ type: "doc", content: [paragraph("p"), paragraph("q")] }).content,
    );
    const pasted = paste.props.transformPasted!.call(paste, blocks, editor.view, false);
    expect(pasted.content.childCount).toBe(1);
    expect(pasted.content.firstChild?.textContent).toBe("p q");
  });

  /**
   * Drops `blocks` at `pos` the way ProseMirror does: the drop event first, then transformPasted, then
   * the slice goes where it fits. A headless editor has no layout, so the view answers with `pos`.
   */
  function drop(editor: Editor, pos: number, blocks: JSONContent[]) {
    const view = { state: editor.state, posAtCoords: () => ({ pos, inside: -1 }) } as unknown as EditorView;
    const input = editor.state.plugins.find((plugin) => plugin.props.handleDOMEvents?.drop)!;
    input.props.handleDOMEvents!.drop!.call(input, view, { clientX: 0, clientY: 0 } as DragEvent);
    const doc = editor.schema.nodeFromJSON({ type: "doc", content: blocks });
    const slice = input.props.transformPasted!.call(input, Slice.maxOpen(doc.content), view, false);
    const at = dropPoint(editor.state.doc, pos, slice) ?? pos;
    editor.view.dispatch(editor.state.tr.replaceRange(at, at, slice));
  }

  it("drops blocks into a cell as one line, wherever the caret is", () => {
    const editor = editorWith(table + "\nPara two\n");
    caretAfter(editor, "Para two");
    drop(editor, positionAfter(editor, "1"), [paragraph("p"), paragraph("q")]);
    expect(serializeBody(editor)).toBe("| a    | b   |\n| ---- | --- |\n| 1p q | 2   |\n\nPara two\n");
  });

  /**
   * Drops `blocks` the way ProseMirror's drop handler does, where the pointer resolves to `pos`: the drop
   * event, transformPasted, then handleDrop, and only when no plugin handled it the default insertion.
   */
  function dropLikeProseMirror(editor: Editor, pos: number, blocks: JSONContent[]) {
    const view = Object.create(editor.view, {
      posAtCoords: { value: () => ({ pos, inside: -1 }) },
      focus: { value: () => {} },
    }) as EditorView;
    const event = { clientX: 0, clientY: 0 } as DragEvent;
    const input = editor.state.plugins.find((plugin) => plugin.props.handleDOMEvents?.drop)!;
    input.props.handleDOMEvents!.drop!.call(input, view, event);
    const doc = editor.schema.nodeFromJSON({ type: "doc", content: blocks });
    const slice = input.props.transformPasted!.call(input, Slice.maxOpen(doc.content), view, false);
    if (input.props.handleDrop?.call(input, view, event, slice, false)) return;
    const at = dropPoint(editor.state.doc, pos, slice) ?? pos;
    editor.view.dispatch(editor.state.tr.replaceRange(at, at, slice));
  }

  /** The position of the table part `name` (cell, row) holding `text`, plus `offset`. */
  function positionIn(editor: Editor, name: string, text: string, offset: (node: ProseMirrorNode) => number) {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (found === -1 && node.type.name === name && node.textContent === text) found = pos + offset(node);
    });
    return found;
  }

  /** Where a drop lands: the table part holding some text, and the offset into it. */
  const dropSpots: Array<[string, string, string, (node: ProseMirrorNode) => number, string]> = [
    ["the top padding of a cell (before its text)", "tableCell", "1", () => 1, "| r s1 | 2   |"],
    [
      "the bottom padding of a cell (after its text)",
      "tableCell",
      "1",
      (node) => node.nodeSize - 1,
      "| 1r s | 2   |",
    ],
    [
      "the border between two cells",
      "tableRow",
      "12",
      (node) => 1 + node.firstChild!.nodeSize,
      "| 1r s | 2   |",
    ],
    ["the start of a row", "tableRow", "12", () => 1, "| r s1 | 2   |"],
  ];

  it.each(dropSpots)(
    "drops blocks on %s into the cell's text, keeping the columns",
    (_, name, text, offset, row) => {
      const editor = editorWith(table + "\nPara two\n");
      caretAfter(editor, "Para two");
      dropLikeProseMirror(editor, positionIn(editor, name, text, offset), [paragraph("r"), paragraph("s")]);
      expect(serializeBody(editor)).toBe(`| a    | b   |\n| ---- | --- |\n${row}\n\nPara two\n`);
    },
  );

  it("drops one line on a cell's padding into its text, not a new cell", () => {
    const editor = editorWith(table);
    dropLikeProseMirror(
      editor,
      positionIn(editor, "tableCell", "2", () => 1),
      [paragraph("zz")],
    );
    expect(serializeBody(editor)).toBe("| a   | b   |\n| --- | --- |\n| 1   | zz2 |\n");
  });

  it("keeps blocks dropped outside the table as blocks, even with the caret in a cell", () => {
    const editor = editorWith(table + "\nPara two\n");
    caretAfter(editor, "1");
    drop(editor, positionAfter(editor, "Para two"), [paragraph("p"), paragraph("q")]);
    expect(serializeBody(editor)).toBe(table + "\nPara twop\n\nq\n");
  });

  it("keeps the first row as the header row", () => {
    const editor = inCell();
    editor.commands.command(({ tr, state }) => {
      state.doc.descendants((node, pos) => {
        if (node.type.name === "tableCell") tr.setNodeMarkup(pos, state.schema.nodes.tableHeader);
      });
      return true;
    });
    const cellTypes: string[] = [];
    editor.state.doc.descendants(
      (node) => void (node.type.spec.tableRole?.includes("cell") && cellTypes.push(node.type.name)),
    );
    expect(cellTypes).toEqual(["tableHeader", "tableHeader", "tableCell", "tableCell"]);
  });
});

describe("headings are one line", () => {
  it("refuses a line break (Shift+Enter)", () => {
    const editor = editorWith("## Title\n");
    caretAfter(editor, "Ti");
    expect(editor.can().setHardBreak()).toBe(false);
    press(editor, "Enter", true);
    expect(serializeBody(editor)).toBe("## Title\n");
  });

  it("turns line breaks into spaces when a paragraph becomes a heading", () => {
    const editor = editorWith("a  \nb\n");
    editor.commands.toggleHeading({ level: 2 });
    expect(serializeBody(editor)).toBe("## a b\n");
  });
});

describe("empty list items", () => {
  it.each([
    ["- first\n- second\n", "first", "-\n- first\n- second\n"],
    ["1. first\n2. second\n", "first", "1.\n2. first\n3. second\n"],
  ])("Enter at the start of the first item of %j saves a bare marker", (markdown, word, saved) => {
    const editor = editorWith(markdown);
    caretAfter(editor, word);
    editor.commands.command(
      ({ tr }) => (tr.setSelection(TextSelection.create(tr.doc, tr.selection.from - word.length)), true),
    );
    expect(press(editor, "Enter")).toBe(true);
    expect(serializeBody(editor)).toBe(saved);
    // The list re-opens as it is (the editor also keeps an empty paragraph after it, which isn't saved).
    expect(reopened(editor).firstChild?.toJSON()).toEqual(editor.state.doc.firstChild?.toJSON());
  });

  it.each([
    "1. first\n2. second\n3.\n",
    "1. first\n2.\n3. second\n",
    "- first\n-\n- second\n",
    "- [ ] first\n- [ ]\n",
  ])("%j re-opens with its empty item", (markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
    expect(analyzeFidelity(markdown, roundTrip(markdown))).toEqual({ kind: "exact" });
  });

  it("keeps an empty item's nested blocks under it", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "bulletList", content: [{ type: "listItem", content: [paragraph(), paragraph("x")] }] },
      ],
    };
    expect(manager.serialize(doc)).toBe("- &nbsp;\n\n  x");
    expect(normalized(manager.parse(manager.serialize(doc)))).toEqual(normalized(doc));
  });
});

describe("Enter over a selection that spans blocks", () => {
  it.each([
    ["- alpha\n- beta\n", "- al\n- ta\n"],
    ["1. alpha\n2. beta\n", "1. al\n2. ta\n"],
    ["- [ ] alpha\n- [ ] beta\n", "- [ ] al\n- [ ] ta\n"],
    ["# alpha\n\nbeta\n", "# al\n\n# ta\n"],
  ])("deletes the selection in %j, then splits at the caret", (markdown, saved) => {
    const editor = editorWith(markdown);
    const [from, to] = [positionAfter(editor, "al"), positionAfter(editor, "be")];
    editor.commands.command(({ tr }) => (tr.setSelection(TextSelection.create(tr.doc, from, to)), true));
    expect(press(editor, "Enter")).toBe(true);
    expect(serializeBody(editor)).toBe(saved);
  });

  it.each([
    "- alpha\n  - beta\n    - gamma\n",
    "- [ ] alpha\n  - [ ] beta\n- [x] gamma\n",
    "1. alpha\n   - beta\n2. gamma\n",
    "> - alpha\n> - beta\n\npara\n",
    "# head\n\n- alpha\n- beta\n",
    "- a\n\n  ```\n  code\n  ```\n- b\n",
  ])("never throws for any range of %j, and what it saves re-opens the same", (markdown) => {
    const editor = editorWith(markdown);
    const initial = editor.state;
    const size = initial.doc.content.size;
    for (let from = 0; from < size; from++) {
      for (let to = from + 1; to <= size; to++) {
        editor.view.updateState(initial);
        editor.commands.command(({ tr }) => {
          tr.setSelection(TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)));
          return true;
        });
        expect(() => press(editor, "Enter")).not.toThrow();
        expect(roundTrip(serializeBody(editor))).toBe(serializeBody(editor));
      }
    }
  });
});
