import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensions, createMarkdownManager } from "./extensions";
import { serializeBody } from "./serialize";

/**
 * Round-trip property: whatever editing produces, the saved markdown re-opens as the same document, and
 * saving that again writes the same bytes. Documents are built headlessly with the commands the toolbar
 * uses and the real keymaps (Enter, Shift+Enter, Backspace, Tab), from a seeded generator, so a failure
 * is reproducible: the seed, the step log and the markdown are part of the assertion message.
 *
 * "The same document" is exact for blocks, text, links, code and line breaks, after the whitespace rules
 * markdown itself imposes (see canonical). Bold, italic and strikethrough are never invented; they may
 * only be given up where marked can't read them back (see renderInlineMarkdown), which must stay rare.
 */

function generator(seed: number) {
  let state = seed;
  const random = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(random() * max);
  const pick = <T>(items: readonly T[]) => items[int(items.length)];
  return { random, int, pick };
}

type Random = ReturnType<typeof generator>;
type Step = { name: string; run: (editor: Editor, rnd: Random) => unknown };

const WORDS = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "x",
  "note",
  "item",
  "code",
  "note:",
  "(see)",
  "「強調」",
  "重要。",
  "a_b",
  "2*3",
  "[x]",
];
const HREFS = ["https://example.com", "https://y.com/a)b", "notes/a b.md", "https://w.org/Foo_(bar)"];

/** Every word range in the document, as [from, to]; marks are applied to whole words (see below). */
function wordRanges(editor: Editor): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const match of (node.text ?? "").matchAll(/[a-z]+/g)) {
      ranges.push([pos + match.index, pos + match.index + match[0].length]);
    }
  });
  return ranges;
}

const select = (editor: Editor, from: number, to = from) =>
  editor.commands.command(({ tr }) => {
    const $from = tr.doc.resolve(Math.min(from, tr.doc.content.size));
    const $to = tr.doc.resolve(Math.min(to, tr.doc.content.size));
    tr.setSelection(from === to ? TextSelection.near($from) : TextSelection.between($from, $to));
    return true;
  });

/** Select from the start of one word to the end of another, so mark edges sit next to letters. */
function selectWords(editor: Editor, rnd: Random) {
  const ranges = wordRanges(editor);
  if (ranges.length === 0) return;
  const start = rnd.int(ranges.length);
  const end = Math.min(ranges.length - 1, start + rnd.int(3));
  select(editor, ranges[start][0], ranges[end][1]);
}

/**
 * Typing: inserted text takes the marks at the cursor, like keyboard input. A browser caret is always in
 * text, so nothing is typed while a command left the selection between blocks or table cells.
 */
const type = (editor: Editor, text: string) =>
  editor.commands.command(({ tr }) => {
    if (!tr.selection.$from.parent.inlineContent) return false;
    tr.insertText(text);
    return true;
  });

/**
 * A space typed without the marks around it. A formatted space at a mark's edge can't be written in
 * markdown ("**a **" doesn't parse), so the serializer leaves such spaces unformatted; see the unit tests.
 */
const typePlain = (editor: Editor, text: string) =>
  editor.commands.command(({ tr }) => {
    if (!tr.selection.$from.parent.inlineContent) return false;
    tr.setStoredMarks([]);
    tr.insertText(text);
    return true;
  });

const collapse = (editor: Editor) => select(editor, editor.state.selection.head);

/** A key press, handled by the editor's keymaps in plugin (priority) order, as in the browser. */
const press = (editor: Editor, key: string, shiftKey = false) => {
  const event = { key, shiftKey, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
  return editor.state.plugins.some((plugin) =>
    plugin.props.handleKeyDown?.call(plugin, editor.view, event as unknown as KeyboardEvent),
  );
};

const STEPS: Step[] = [
  { name: "type", run: (e, r) => type(e, r.pick(WORDS)) },
  { name: "type", run: (e, r) => type(e, r.pick(WORDS) + " " + r.pick(WORDS)) },
  { name: "space", run: (e) => typePlain(e, " ") },
  { name: "moveCursor", run: (e, r) => select(e, r.int(e.state.doc.content.size + 1)) },
  { name: "bold", run: (e, r) => (selectWords(e, r), e.commands.toggleBold()) },
  { name: "italic", run: (e, r) => (selectWords(e, r), e.commands.toggleItalic()) },
  { name: "strike", run: (e, r) => (selectWords(e, r), e.commands.toggleStrike()) },
  { name: "code", run: (e, r) => (selectWords(e, r), e.commands.toggleCode()) },
  { name: "link", run: (e, r) => (selectWords(e, r), e.commands.setLink({ href: r.pick(HREFS) })) },
  // Enter over a range hits a Tiptap splitBlock bug (it throws on some ranges), unrelated to markdown.
  { name: "enter", run: (e) => (collapse(e), press(e, "Enter")) },
  { name: "shiftEnter", run: (e) => press(e, "Enter", true) },
  { name: "backspace", run: (e) => press(e, "Backspace") },
  { name: "heading", run: (e, r) => e.commands.toggleHeading({ level: r.pick([1, 2, 3] as const) }) },
  { name: "paragraph", run: (e) => e.commands.setParagraph() },
  { name: "bulletList", run: (e) => e.commands.toggleBulletList() },
  { name: "orderedList", run: (e) => e.commands.toggleOrderedList() },
  { name: "taskList", run: (e) => e.commands.toggleTaskList() },
  { name: "check", run: (e) => e.commands.updateAttributes("taskItem", { checked: true }) },
  // Tab in a code block inserts text through the HTML parser, which needs a DOM.
  { name: "indent", run: (e) => !e.isActive("codeBlock") && press(e, "Tab") },
  { name: "outdent", run: (e) => press(e, "Tab", true) },
  { name: "quote", run: (e) => e.commands.toggleBlockquote() },
  { name: "codeBlock", run: (e) => e.commands.toggleCodeBlock() },
  { name: "divider", run: (e) => e.commands.setHorizontalRule() },
  { name: "table", run: (e) => e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true }) },
  { name: "addRow", run: (e) => e.commands.addRowAfter() },
];

const EMPHASIS = new Set(["bold", "italic", "strike"]);
const isCode = (node: JSONContent) => node.marks?.some((mark) => mark.type === "code") ?? false;

/** A line break's marks aren't saved; on a single-line block it is a space. */
const hardBreakAs = (node: JSONContent, singleLine: boolean): JSONContent => {
  if (node.type !== "hardBreak") return node;
  return singleLine ? { type: "text", text: " " } : { type: "hardBreak" };
};

/**
 * Inline content as markdown can hold it: no whitespace or line break at the start or end of a paragraph
 * or heading, no whitespace around a line break or two breaks in a row, and line breaks as spaces on
 * single-line blocks (headings, cells, a task's text), newline characters also in inline code.
 */
function canonicalInline(content: JSONContent[], singleLine: boolean): JSONContent[] {
  const chars = content.flatMap((node) =>
    node.type === "text"
      ? Array.from(node.text ?? "", (text) => ({
          ...node,
          text: (singleLine || isCode(node)) && text === "\n" ? " " : text,
        }))
      : [hardBreakAs(node, singleLine)],
  );
  const isBreak = (node?: JSONContent) => node?.type === "hardBreak";
  const isNewline = (node?: JSONContent) => node?.type === "text" && !isCode(node) && node.text === "\n";
  const isSpace = (node?: JSONContent) =>
    node?.type === "text" && !isCode(node) && /^[^\S\n]$/.test(node.text ?? "");
  const endsLine = (node?: JSONContent) => isBreak(node) || isNewline(node);
  // No whitespace at the start, the end or around a line break; no line break at the start or end, and
  // one line break at most in a row (a hard break wins over a newline character).
  const kept: JSONContent[] = [];
  for (const node of chars) {
    if (isSpace(node) && (kept.length === 0 || endsLine(kept.at(-1)))) continue;
    if (endsLine(node)) {
      while (isSpace(kept.at(-1))) kept.pop();
      if (kept.length === 0 || isBreak(kept.at(-1))) continue;
      if (isNewline(kept.at(-1))) kept.pop();
    }
    kept.push(node);
  }
  while (isSpace(kept.at(-1)) || endsLine(kept.at(-1))) kept.pop();
  // Emphasis on whitespace isn't compared: where formatting changes around a space (even inside a mark
  // that continues), markdown can't put a delimiter next to it ("**a **" doesn't parse).
  kept.forEach((node, i) => {
    if (isSpace(node)) kept[i] = { ...node, marks: node.marks?.filter((mark) => !EMPHASIS.has(mark.type)) };
  });
  // Merge back into text nodes the way ProseMirror does.
  return kept.reduce<JSONContent[]>((out, node) => {
    const last = out.at(-1);
    const sameMarks = JSON.stringify(last?.marks ?? []) === JSON.stringify(node.marks ?? []);
    if (last?.type === "text" && node.type === "text" && sameMarks) last.text += node.text ?? "";
    else out.push({ ...node, ...(node.marks?.length ? {} : { marks: undefined }) });
    return out;
  }, []);
}

const CONTAINERS = new Set(["listItem", "taskItem", "blockquote"]);
const isEmpty = (node?: JSONContent) => node?.type === "paragraph" && !node.content?.length;

/**
 * The document as markdown can hold it: see canonicalInline; empty paragraphs at the end of a quote or
 * list item (keeping its first child), and at the start and end of the note, aren't saved.
 */
function canonical(doc: JSONContent): JSONContent {
  const walk = (node: JSONContent, singleLine = false): JSONContent => {
    if (node.type === "paragraph" || node.type === "heading") {
      const content = canonicalInline(node.content ?? [], node.type === "heading" || singleLine);
      return { ...node, content: content.length ? content : undefined };
    }
    const cell = node.type === "tableCell" || node.type === "tableHeader";
    const content = node.content?.map((child, i) =>
      walk(child, cell || (node.type === "taskItem" && i === 0)),
    );
    if (content && CONTAINERS.has(node.type ?? "")) {
      while (content.length > 1 && isEmpty(content.at(-1))) content.pop();
    }
    return content ? { ...node, content } : node;
  };
  const content = (doc.content ?? []).map((child) => walk(child));
  while (isEmpty(content[0])) content.shift();
  while (isEmpty(content.at(-1))) content.pop();
  return JSON.parse(JSON.stringify({ ...doc, content }));
}

/** The document without bold, italic and strikethrough, to compare everything else exactly. */
function withoutEmphasis(node: JSONContent): JSONContent {
  const marks = node.marks?.filter((mark) => !EMPHASIS.has(mark.type));
  const content = node.content?.map(withoutEmphasis).reduce<JSONContent[]>((out, child) => {
    const last = out.at(-1);
    if (
      last?.type === "text" &&
      child.type === "text" &&
      JSON.stringify(last.marks) === JSON.stringify(child.marks)
    ) {
      last.text += child.text ?? "";
    } else out.push({ ...child });
    return out;
  }, []);
  return { ...node, marks: marks?.length ? marks : undefined, content };
}

/** The emphasis marks of every character, in document order. */
function emphasisByCharacter(node: JSONContent, out: Set<string>[] = []): Set<string>[] {
  if (node.type === "text") {
    const marks = (node.marks ?? []).map((mark) => mark.type).filter((type) => EMPHASIS.has(type));
    out.push(...Array.from(node.text ?? "", () => new Set(marks)));
  }
  node.content?.forEach((child) => emphasisByCharacter(child, out));
  return out;
}

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

function buildDocument(seed: number, steps: number) {
  const rnd = generator(seed);
  const editor = new Editor({
    element: null,
    extensions: createExtensions(),
    content: "start",
    contentType: "markdown",
  });
  editors.push(editor);
  // A headless editor has no view, which is what installs the plugins (table fixing, WriteHardBreak's
  // cleanup, keymaps...), so install them like a mounted editor would.
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const log: string[] = [];
  for (let i = 0; i < steps; i++) {
    const step = rnd.pick(STEPS);
    log.push(step.name);
    step.run(editor, rnd);
  }
  return { editor, log };
}

// FUZZ_SEEDS / FUZZ_STEPS run a deeper search locally, e.g. FUZZ_SEEDS=5000 FUZZ_STEPS=80.
const SEEDS = Array.from({ length: Number(process.env.FUZZ_SEEDS ?? 400) }, (_, seed) => seed);
const STEP_COUNT = Number(process.env.FUZZ_STEPS ?? 40);

describe("editing round-trip fuzz", () => {
  const manager = createMarkdownManager();
  const emphasis = { kept: 0, lost: 0 };

  it.each(SEEDS)("seed %i re-opens as the same document", (seed) => {
    const { editor, log } = buildDocument(seed, STEP_COUNT);
    const markdown = serializeBody(editor);
    const want = canonical(editor.state.doc.toJSON());
    const got = canonical(editor.schema.nodeFromJSON(manager.parse(markdown)).toJSON());
    const context = { seed, steps: log.join(" "), markdown };

    // Everything but emphasis exactly: blocks, text, links, code, line breaks.
    expect({ ...context, doc: withoutEmphasis(got) }).toEqual({ ...context, doc: withoutEmphasis(want) });
    // Emphasis is never invented, only given up where marked can't read it back (counted below).
    const wanted = emphasisByCharacter(want);
    const found = emphasisByCharacter(got);
    const invented = found.flatMap((marks, i) => [...marks].filter((mark) => !wanted[i].has(mark)));
    expect({ ...context, invented }).toEqual({ ...context, invented: [] });
    wanted.forEach((marks, i) =>
      marks.forEach((mark) => (found[i].has(mark) ? emphasis.kept++ : emphasis.lost++)),
    );

    // Saving the re-opened document writes the same bytes.
    editor.commands.setContent(markdown, { contentType: "markdown" });
    expect(serializeBody(editor)).toBe(markdown);
  });

  it("gives up emphasis only in the rare nestings marked can't read", () => {
    expect(emphasis.kept).toBeGreaterThan(1000);
    expect(emphasis.lost / (emphasis.kept + emphasis.lost)).toBeLessThan(0.02);
  });
});
