import { Extension, type AnyExtension } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { Marked, type marked } from "marked";
import { patchMarkdownManager } from "./escape";
import { MarkdownPaste } from "./markdown-paste";
import { WriteCodeBlock } from "./nodes/code-block";
import { WriteBlockquote, WriteDocument, WriteTable } from "./nodes/containers";
import { WriteHardBreak } from "./nodes/hard-break";
import { WriteHeading } from "./nodes/heading";
import { WriteHorizontalRule } from "./nodes/horizontal-rule";
import { WriteImage } from "./nodes/image";
import { WriteBulletList, WriteListItem, WriteOrderedList } from "./nodes/lists";
import { WriteTableCell, WriteTableHeader } from "./nodes/table-cells";
import { WriteTaskItem, WriteTaskList } from "./nodes/tasks";
import { WriteParagraph } from "./write-paragraph";

const INDENTATION = { style: "space", size: 2 } as const;

/**
 * A fresh marked instance. Tiptap registers its tokenizers with `.use()` on whatever instance it gets,
 * so sharing the global `marked` would leak extensions between editors (and into anything else using marked).
 */
const freshMarked = () => new Marked() as unknown as typeof marked;

/**
 * The document schema: every node and mark a note can contain, plus how each maps to markdown.
 * The Write* nodes (./nodes) only allow structure markdown can store, so what the editor shows is what
 * re-opens from the file.
 * Shared by the editor (createExtensions) and the headless createMarkdownManager() that the fixture tests
 * and fidelity checks use. New markdown syntax goes HERE; createExtensions() only adds editor-only behavior.
 */
export function createSchemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false, // serializes as ++x++ (non-portable; also ate a space in "C++ … C++")
      // Replaced by the Write* versions below:
      document: false,
      paragraph: false,
      blockquote: false,
      heading: false,
      codeBlock: false,
      hardBreak: false,
      horizontalRule: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      link: {
        openOnClick: false,
        enableClickSelection: true,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
      },
    }),
    WriteDocument,
    WriteParagraph,
    WriteBlockquote,
    WriteHeading.configure({ levels: [1, 2, 3, 4, 5, 6] }),
    WriteCodeBlock.configure({ enableTabIndentation: true, tabSize: 2 }),
    WriteHardBreak,
    WriteHorizontalRule,
    WriteBulletList,
    WriteOrderedList,
    WriteListItem,
    WriteTaskList,
    WriteTaskItem.configure({ nested: true }),
    // Column widths can't live in markdown.
    TableKit.configure({ table: false, tableCell: false, tableHeader: false }),
    WriteTable.configure({ resizable: false }),
    WriteTableCell,
    WriteTableHeader,
    WriteImage.configure({ inline: true, allowBase64: false }), // markdown images are inline; lone ones kept by WriteParagraph
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
