import { Extension, type AnyExtension } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { OrderedList, TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { Marked, type marked } from "marked";
import { patchMarkdownManager } from "./escape";
import { MarkdownPaste } from "./markdown-paste";
import { WriteParagraph } from "./write-paragraph";

const INDENTATION = { style: "space", size: 2 } as const;

/**
 * A fresh marked instance. Tiptap registers its tokenizers with `.use()` on whatever instance it gets,
 * so sharing the global `marked` would leak extensions between editors (and into anything else using marked).
 */
const freshMarked = () => new Marked() as unknown as typeof marked;

const upstreamOrderedListTokenizer = OrderedList.config.markdownTokenizer;

/**
 * Tiptap's ordered-list tokenizer also reads letters and roman numerals as list markers, so ordinary lines
 * like "Dr. Smith called", "Q. Why?" or "OK. Fine" would open as lists. CommonMark lists are numeric only,
 * so the upstream tokenizer only gets lines that start with a number; everything else is a paragraph.
 */
const NumericOrderedList = OrderedList.extend({
  markdownTokenizer: upstreamOrderedListTokenizer && {
    ...upstreamOrderedListTokenizer,
    tokenize: (src, tokens, lexer) =>
      /^\s*\d+[.)]\s/.test(src) ? upstreamOrderedListTokenizer.tokenize(src, tokens, lexer) : undefined,
  },
});

/** The document schema: every node and mark a note can contain, plus how each maps to markdown. */
function createSchemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false, // serializes as ++x++ (non-portable; also ate a space in "C++ … C++")
      paragraph: false, // replaced by WriteParagraph
      orderedList: false, // replaced by NumericOrderedList
      link: {
        openOnClick: false,
        enableClickSelection: true,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
      },
      codeBlock: { enableTabIndentation: true, tabSize: 2 },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    WriteParagraph,
    NumericOrderedList,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }), // column widths can't live in markdown
    Image.configure({ inline: true, allowBase64: false }), // markdown images are inline; lone ones kept by WriteParagraph
  ];
}

/** NEW array per editor instance (contains a fresh `new Marked()`); never share between editors. */
export function createExtensions(opts: { placeholder?: string } = {}): AnyExtension[] {
  return [
    ...createSchemaExtensions(),
    Placeholder.configure({ placeholder: opts.placeholder ?? "Start writing…" }),
    MarkdownPaste,
    Markdown.configure({ marked: freshMarked(), indentation: INDENTATION }),
    Extension.create({
      name: "writeEscapes",
      onCreate() {
        patchMarkdownManager(this.editor.markdown);
      },
    }),
  ];
}

/** Headless manager with the same schema + escape patch (tests, fidelity checks without an editor). */
export function createMarkdownManager(): MarkdownManager {
  const manager = new MarkdownManager({
    marked: freshMarked(),
    indentation: INDENTATION,
    extensions: createSchemaExtensions(),
  });
  patchMarkdownManager(manager);
  return manager;
}
