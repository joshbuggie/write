/// <reference types="vite/types/importMeta.d.ts" />
import { Editor, type JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { marked, Marked } from "marked";
import { afterEach, describe, expect, it } from "vitest";
import { patchMarkdownManager } from "./escape";
import { createExtensions, createMarkdownManager } from "./extensions";
import { analyzeFidelity } from "./fidelity";
import { finalizeMarkdown } from "./file-format";
import { serializeBody } from "./serialize";

/**
 * Fixture corpus: `__fixtures__/<case>.md` must round-trip byte for byte, unless `<case>.expected.md`
 * exists, in which case the output must equal that file (a documented normalization).
 * Adding a markdown extension? Add fixtures for it here.
 */
const files = import.meta.glob("./__fixtures__/*.md", { query: "?raw", import: "default", eager: true });
const fixture = (path: string) => files[path] as string | undefined;
const cases = Object.keys(files)
  .filter((path) => !path.endsWith(".expected.md"))
  .map((path) => ({
    name: path.replace("./__fixtures__/", "").replace(/\.md$/, ""),
    input: fixture(path) ?? "",
    expected: fixture(path.replace(/\.md$/, ".expected.md")),
  }));

const manager = createMarkdownManager();
const roundTrip = (md: string) => finalizeMarkdown(manager.serialize(manager.parse(md)));
const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});
const text = (value: string, marks: string[] = []): JSONContent =>
  marks.length
    ? { type: "text", text: value, marks: marks.map((type) => ({ type })) }
    : { type: "text", text: value };

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

describe("fixture corpus", () => {
  it("has fixtures", () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  describe.each(cases)("$name", ({ input, expected }) => {
    const want = expected ?? input;

    it(expected === undefined ? "round-trips exactly" : "normalizes to the .expected.md file", () => {
      expect(roundTrip(input)).toBe(want);
    });

    it("is idempotent", () => {
      expect(roundTrip(want)).toBe(want);
    });

    // Headless Tiptap parses empty content as HTML, which needs a DOM; browsers handle that case fine.
    it.skipIf(input === "")("serializes the same through a real editor (serializeBody)", () => {
      expect(serializeBody(headlessEditor(input))).toBe(want);
    });

    it(`is classified as ${expected === undefined ? "exact" : "normalized"}`, () => {
      expect(analyzeFidelity(input, roundTrip(input))).toEqual({
        kind: expected === undefined ? "exact" : "normalized",
      });
    });
  });
});

describe("typed look-alikes", () => {
  // Text typed in the visual editor must re-open as the same plain paragraph, never as markup.
  const lookAlikes = [
    "# not heading",
    "- not list",
    "1. not ordered",
    "> not quote",
    "---",
    "a < b > c & d",
    "C:\\Users",
    "x &amp; y",
    "snake_case",
    "[[wiki]]",
    "[x](y) literal",
    "*not em*",
    "_x_",
    "a * b",
    "2 ~ 3",
    "x*y",
    "* lead",
    "end *",
    "[[a]] [b]",
    "x [y] (z)",
    "[t](u)x",
    "a[1]: b",
  ];
  const moreLookAlikes = [
    "__init__ and __x",
    "1986. A great year",
    "+ plus",
    "===",
    "~~not struck~~",
    "```not a fence",
    "<div>not html</div>",
    "<!-- not a comment -->",
    "[^1]: not a footnote definition",
    "![not](an image)",
    "ends with a backslash \\",
    "    four leading spaces are not code",
    "\ttab is not code",
    "- [ ] not a task",
    "- [x] not done either",
    "x- [ ] not a task after a letter",
    "| a | b |",
    "Dr. Smith called",
    "a. apples",
    "iv) four",
    "12345678901. big number",
    "x\n- not a list after a hard break",
  ];

  it("covers the 22 look-alikes from the spec", () => {
    expect(lookAlikes).toHaveLength(22);
  });

  it.each([...lookAlikes, ...moreLookAlikes])("%j stays a plain paragraph", (typed) => {
    const reparsed = manager.parse(manager.serialize(paragraph(text(typed))));
    expect(reparsed.content).toHaveLength(1);
    expect(reparsed.content?.[0].type).toBe("paragraph");
    const texts = (reparsed.content?.[0].content ?? []).map((node) => {
      expect(node.marks ?? []).toEqual([]);
      return node.text;
    });
    // Leading indentation can't survive markdown; everything else must.
    expect(texts.join("")).toBe(typed.replace(/^[ \t]+/, ""));
  });

  it("keeps letter-marker lines as paragraphs, also inside ordered list items", () => {
    const item = (...texts: string[]) => ({
      type: "listItem",
      content: texts.map((value) => ({ type: "paragraph", content: [text(value)] })),
    });
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "orderedList", content: [item("first", "Dr. Smith called")] }],
    };
    expect(manager.parse(manager.serialize(doc))).toEqual(doc);
    expect(roundTrip("Q. Why?\n\nA. Because.\n\n- Dr. Smith\n")).toBe(
      "Q. Why?\n\nA. Because.\n\n- Dr. Smith\n",
    );
  });

  it("keeps a trailing backslash from escaping the next node's markup", () => {
    const doc = paragraph(text("a\\"), text("b", ["bold"]));
    expect(manager.parse(manager.serialize(doc))).toEqual(doc);
  });

  it("keeps a pipe typed in a table cell inside its cell", () => {
    const cell = (type: string, value: string, marks?: string[]): JSONContent => ({
      type,
      content: [{ type: "paragraph", content: [text(value, marks)] }],
    });
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [cell("tableHeader", "a|b"), cell("tableHeader", "x | y", ["code"])],
            },
            { type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", "C:\\|")] },
          ],
        },
      ],
    };
    const markdown = manager.serialize(doc);
    expect(markdown).toContain("a\\|b");
    expect(markdown).toContain("`x \\| y`");
    expect(manager.parse(markdown)).toEqual(doc);
  });
});

describe("typed text fuzz", () => {
  // Seeded, so any failure is reproducible. Mark contents start and end with letters: a mark edge next to
  // punctuation ("**a.**b") is a markdown limitation of the serializer, not something escaping can fix.
  const alphabet = [..."ab12 *_~[]()!<>&#-+=|\\`.;^:é\t"];
  const markSets = [[], ["bold"], ["italic"], ["strike"], ["code"], ["bold", "italic"]];
  let seed = 11;
  const random = () => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const randomText = (length: number) => Array.from({ length }, () => pick(alphabet)).join("");
  const marksKey = (node: JSONContent) =>
    (node.marks ?? [])
      .map((m) => m.type)
      .sort()
      .join();
  /** ProseMirror never keeps two adjacent text nodes with the same marks; neither may the generator. */
  const mergeLikeProseMirror = (nodes: JSONContent[]) =>
    nodes.reduce<JSONContent[]>((out, node) => {
      const last = out.at(-1);
      if (last?.type === "text" && node.type === "text" && marksKey(last) === marksKey(node)) {
        out[out.length - 1] = { ...last, text: (last.text ?? "") + (node.text ?? "") };
      } else out.push(node);
      return out;
    }, []);
  /** Comparable form of a paragraph's inline content. */
  const canonical = (nodes: JSONContent[]) =>
    mergeLikeProseMirror(nodes).map((node) =>
      node.type === "hardBreak"
        ? { text: "\n", marks: "br" }
        : { text: node.text ?? "", marks: marksKey(node) },
    );

  it("re-opens 5000 random formatted paragraphs unchanged", () => {
    for (let i = 0; i < 5000; i++) {
      const nodes: JSONContent[] = [text("a" + randomText(4))];
      for (let k = 0; k < 3; k++) {
        const marks = pick(markSets);
        if (random() < 0.15) nodes.push(text("y"), { type: "hardBreak" }, text("b" + randomText(3)));
        else if (marks.length)
          nodes.push(text("a" + randomText(4).replace(/`/g, "") + "b", marks), text(" " + randomText(3)));
        else nodes.push(text(randomText(5)));
      }
      nodes.push(text("z"));
      const markdown = manager.serialize(paragraph(...mergeLikeProseMirror(nodes)));
      const reparsed = manager.parse(markdown).content ?? [];
      expect({ markdown, blocks: reparsed.length, nodes: canonical(reparsed[0]?.content ?? []) }).toEqual({
        markdown,
        blocks: 1,
        nodes: canonical(nodes),
      });
    }
  });
});

describe("code is never escaped", () => {
  const raw = "a_b *c* [x](y) <div> & \\ ` # - > ~~";

  it("inside code blocks", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "codeBlock", attrs: { language: "js" }, content: [text(raw)] }],
    };
    expect(finalizeMarkdown(manager.serialize(doc))).toBe("```js\n" + raw + "\n```\n");
  });

  it("inside inline code", () => {
    const inline = "a_b *c* [x](y) <div> & \\";
    expect(finalizeMarkdown(manager.serialize(paragraph(text(inline, ["code"]))))).toBe("`" + inline + "`\n");
  });
});

describe("escape patch and marked isolation", () => {
  it("finds Tiptap's private encodeTextForMarkdown (fails loudly after an upgrade that removes it)", () => {
    const fresh = new MarkdownManager({ marked: new Marked() as unknown as typeof marked, extensions: [] });
    expect(patchMarkdownManager(fresh)).toBe(true);
  });

  it("serializeBody patches the editor's manager (headless editors never fire onCreate)", () => {
    const editor = headlessEditor("Tom & Jerry, snake_case");
    expect(serializeBody(editor)).toBe("Tom & Jerry, snake_case\n");
    expect(Object.getOwnPropertySymbols(editor.markdown)).toContain(Symbol.for("write.escapePatched"));
  });

  it("never registers extensions on the global marked instance", () => {
    for (let i = 0; i < 5; i++) createMarkdownManager().parse("- [ ] task\n\n| a |\n| - |\n| 1 |\n");
    headlessEditor("# hi");
    expect(marked.defaults.extensions).toBeNull();
  });

  it("gives every editor its own extension instances", () => {
    expect(createExtensions()).not.toBe(createExtensions());
    const markdownOptions = () =>
      createExtensions().find((extension) => extension.name === "markdown")?.options as { marked: unknown };
    expect(markdownOptions().marked).not.toBe(markdownOptions().marked);
  });
});
