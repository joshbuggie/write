import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { Marked } from "marked";
import { isAutolinkLiteral } from "./autolinks";
import { createExtensions, createMarkdownManager } from "./extensions";
import { finalizeMarkdown } from "./file-format";
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
 * A bare URL or email typed as plain text re-opens as a link (GFM autolinks it), and the next save
 * writes that link; nothing else may change on a second save.
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
  // Bare addresses, which marked links on re-open (accepted: see withoutAutolinks).
  "https://x.com/docs",
  "https://x.com/~u/a_b_",
  "www.x.com",
  "www.x.com/a*b",
  "me@x.com",
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
  { name: "enter", run: (e) => (collapse(e), press(e, "Enter")) },
  // Over a range that may span blocks, it deletes the range first (see EnterOverSelection).
  { name: "enterOverWords", run: (e, r) => (selectWords(e, r), press(e, "Enter")) },
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

/** Whether a link is one GFM makes from bare text: the address itself, "www." or an email. */
const isAutolink = (text: string, href: unknown) =>
  href === text || href === `http://${text}` || href === `mailto:${text}`;

const hrefOf = (node: JSONContent) => node.marks?.find((mark) => mark.type === "link")?.attrs?.href;

/**
 * How many characters at the start of a link's text GFM linked by itself: all of them for a bare URL
 * or email, or the address (once or more) at the start of a link it merged into (ProseMirror joins
 * adjacent links to the same address: "me@x.com" before a link to mailto:me@x.com).
 */
function autolinkedLength(text: string, href: unknown): number {
  if (isAutolink(text, href)) return text.length;
  const address = String(href).replace(/^(?:mailto:|http:\/\/)/, "");
  if (!isAutolink(address, href)) return 0;
  // The same address typed twice in a row re-opens as two links to it, which merge too.
  let length = 0;
  while (address && text.startsWith(address, length)) length += address.length;
  return length;
}

/**
 * The document without the links GFM adds to bare URLs and emails (and the editor adds while typing).
 * A link's text may span several text nodes (formatting changes inside it), so they're judged together.
 */
function withoutAutolinks(node: JSONContent): JSONContent {
  const content = node.content?.map(withoutAutolinks);
  if (!content) return node;
  const out: JSONContent[] = [];
  for (let start = 0; start < content.length;) {
    const href = hrefOf(content[start]);
    let end = start + 1;
    while (href !== undefined && end < content.length && hrefOf(content[end]) === href) end++;
    const linked = content.slice(start, end);
    let unlink =
      href === undefined ? 0 : autolinkedLength(linked.map((child) => child.text ?? "").join(""), href);
    for (const child of linked) {
      const text = child.text ?? "";
      const cut = Math.min(unlink, text.length);
      const marks = child.marks?.filter((mark) => mark.type !== "link");
      if (cut > 0) out.push({ ...child, text: text.slice(0, cut), marks: marks?.length ? marks : undefined });
      if (cut < text.length || !child.text) out.push(cut > 0 ? { ...child, text: text.slice(cut) } : child);
      unlink -= cut;
    }
    start = end;
  }
  return { ...node, content: out };
}

/** Whether marked links a bare URL or email somewhere in the markdown. */
function hasBareAddress(markdown: string): boolean {
  const marked = new Marked({ gfm: true });
  let found = false;
  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (isAutolinkLiteral(token)) found = true;
  });
  return found;
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

/**
 * Asserts that `got` is `want` exactly but for emphasis, which may only be given up, never invented.
 * Returns how many characters kept or lost a bold, italic or strikethrough mark.
 */
function expectSameDocument(context: object, got: JSONContent, want: JSONContent) {
  // Everything but emphasis exactly: blocks, text, links, code, line breaks.
  expect({ ...context, doc: withoutEmphasis(got) }).toEqual({ ...context, doc: withoutEmphasis(want) });
  // Emphasis is never invented, only given up where marked can't read it back (counted by the caller).
  const wanted = emphasisByCharacter(want);
  const found = emphasisByCharacter(got);
  const invented = found.flatMap((marks, i) => [...marks].filter((mark) => !wanted[i].has(mark)));
  expect({ ...context, invented }).toEqual({ ...context, invented: [] });
  const count = { kept: 0, lost: 0 };
  wanted.forEach((marks, i) => marks.forEach((mark) => (found[i].has(mark) ? count.kept++ : count.lost++)));
  return count;
}

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

/**
 * An editor opened on the markdown, as the app opens a note: from initial content, so the link
 * extension's autolinking (which runs on edits, setContent included) doesn't touch it.
 */
function openNote(markdown: string) {
  const editor = new Editor({
    element: null,
    extensions: createExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
}

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
    const reopen = (md: string) =>
      withoutAutolinks(canonical(editor.schema.nodeFromJSON(manager.parse(md)).toJSON()));
    const want = withoutAutolinks(canonical(editor.state.doc.toJSON()));
    const got = reopen(markdown);
    const context = { seed, steps: log.join(" "), markdown };

    const { kept, lost } = expectSameDocument(context, got, want);
    emphasis.kept += kept;
    emphasis.lost += lost;

    // Saving the re-opened document writes the same bytes, but for bare URLs, which are links now: the
    // next save writes them as links (the same document, but a link may give up formatting at its
    // edges), which can let another URL be written bare. That settles within a few saves.
    let saved = markdown;
    let doc = got;
    for (let round = 0; round < 4; round++) {
      const resaved = serializeBody(openNote(saved));
      if (resaved === saved) break;
      expect({ ...context, saved, bareUrl: hasBareAddress(saved) }).toEqual({
        ...context,
        saved,
        bareUrl: true,
      });
      const next = reopen(resaved);
      expectSameDocument({ ...context, resaved }, next, doc);
      [saved, doc] = [resaved, next];
    }
    expect(serializeBody(openNote(saved))).toBe(saved);
  });

  it("gives up emphasis only in the rare nestings marked can't read", () => {
    expect(emphasis.kept).toBeGreaterThan(1000);
    expect(emphasis.lost / (emphasis.kept + emphasis.lost)).toBeLessThan(0.02);
  });
});

/**
 * The same property for inline content the editing steps above rarely produce: typed text full of
 * syntax (URLs with parentheses, pipes, "<" and "!", emails, entities, backslashes, CJK) under random
 * marks, links and code, in every block that holds inline content. Documents are built directly, so each
 * seed tries many paragraphs; the checks are the ones above.
 */
describe("inline syntax round-trip fuzz", () => {
  const manager = createMarkdownManager();
  const schema = getSchema(createExtensions());
  const PIECES = [
    "https://x.com/(a",
    "https://x.com/(*a* now",
    "https://x.com/a|b",
    "https://x.com/docs",
    "<https://x.com>",
    "www.x.com/(\\[x]",
    "ftp://a.b",
    "me@x.com",
    "see!",
    "!",
    "![x](y)",
    "<",
    "<b>",
    ">",
    "&amp;",
    "&",
    "|",
    "\\",
    "\\|",
    "*",
    "**",
    "_",
    "~",
    "`",
    "[",
    "]",
    "(",
    ")",
    ":",
    "#",
    "- ",
    "1. ",
    "「強調」",
    "中文。",
    "é",
    "a",
    "word",
    " ",
    " ",
  ];
  // Not the addresses above: a bare URL next to a link to itself would merge into it on re-open.
  const LINK_HREFS = [
    "https://e.com",
    "https://e.com/a|b",
    "https://e.com/a)b",
    "notes/a b.md",
    "https://w.org/Foo_(bar)",
  ];
  const EMPHASIS_SETS = [[], [], ["bold"], ["italic"], ["strike"], ["bold", "italic"], ["italic", "strike"]];

  function inlineContent(rnd: Random, inCell: boolean): JSONContent[] {
    return Array.from({ length: 1 + rnd.int(6) }, (): JSONContent => {
      const text = Array.from({ length: 1 + rnd.int(3) }, () => rnd.pick(PIECES)).join("");
      const kind = rnd.random();
      if (kind < 0.12) {
        // Code can't hold a "|" after a backslash in a table row (it's written next to the code, which
        // the serializer tests cover), and adjacent code pieces merge: no backslashes in cells.
        const code = inCell ? text.replace(/\\/g, "/") : text;
        return { type: "text", text: code, marks: [{ type: "code" }] };
      }
      const marks: JSONContent["marks"] = rnd.pick(EMPHASIS_SETS).map((type) => ({ type }));
      if (kind < 0.3) marks.push({ type: "link", attrs: { href: rnd.pick(LINK_HREFS) } });
      return { type: "text", text, ...(marks.length ? { marks } : {}) };
    });
  }

  const paragraphOf = (content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
  const cell = (type: string, content: JSONContent[]): JSONContent => ({
    type,
    content: [paragraphOf(content)],
  });

  /** One block of each kind that holds inline content, each with random content. */
  function blocks(rnd: Random): JSONContent[] {
    const content = (inCell = false) => inlineContent(rnd, inCell);
    return [
      paragraphOf(content()),
      { type: "heading", attrs: { level: 2 }, content: content() },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [cell("tableHeader", content(true)), cell("tableHeader", content(true))],
          },
          { type: "tableRow", content: [cell("tableCell", content(true)), cell("tableCell", content(true))] },
        ],
      },
      { type: "bulletList", content: [{ type: "listItem", content: [paragraphOf(content())] }] },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraphOf(content())] }],
      },
      { type: "blockquote", content: [paragraphOf(content())] },
    ];
  }

  const emphasis = { kept: 0, lost: 0 };
  it.each(SEEDS)("seed %i re-opens every block's text, links and code as saved", (seed) => {
    const rnd = generator(seed * 7919 + 1);
    for (const block of blocks(rnd)) {
      // Through the schema, so adjacent text nodes merge and empty ones go, as in the editor.
      const doc = schema.nodeFromJSON({ type: "doc", content: [block] }).toJSON() as JSONContent;
      const markdown = finalizeMarkdown(manager.serialize(doc));
      const reopen = (md: string) =>
        withoutAutolinks(canonical(schema.nodeFromJSON(manager.parse(md)).toJSON()));
      const got = reopen(markdown);
      const context = { seed, markdown };
      const { kept, lost } = expectSameDocument(context, got, withoutAutolinks(canonical(doc)));
      emphasis.kept += kept;
      emphasis.lost += lost;

      // Saving again writes the same bytes, but for bare URLs, which re-open as links (see above).
      let saved = markdown;
      let current = got;
      for (let round = 0; round < 4; round++) {
        const resaved = finalizeMarkdown(manager.serialize(manager.parse(saved)));
        if (resaved === saved) break;
        expect({ ...context, saved, bareUrl: hasBareAddress(saved) }).toEqual({
          ...context,
          saved,
          bareUrl: true,
        });
        const next = reopen(resaved);
        expectSameDocument({ ...context, resaved }, next, current);
        [saved, current] = [resaved, next];
      }
      expect(finalizeMarkdown(manager.serialize(manager.parse(saved)))).toBe(saved);
    }
  });

  it("gives up little emphasis", () => {
    expect(emphasis.kept).toBeGreaterThan(500);
    expect(emphasis.lost / (emphasis.kept + emphasis.lost)).toBeLessThan(0.1);
  });
});
