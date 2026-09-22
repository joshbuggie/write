import type { Editor } from "@tiptap/core";
import {
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Table,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";

/** Buttons in the same group sit together; the toolbar draws a divider between groups. */
export type ToolbarGroup = "block" | "inline" | "list" | "insert" | "table" | "history";

/** Things a toolbar action may need beyond the editor itself. */
export type ToolbarContext = { openLinkDialog: () => void };

/**
 * One formatting action. This list is the single source of truth for the desktop toolbar and the
 * phone keyboard toolbar; to add a button, add an entry here.
 */
export type ToolbarItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  group: ToolbarGroup;
  /** Shown in the tooltip. The editor's own keymap implements it; this is documentation only. */
  shortcut?: string;
  /** Present only for toggles: drives aria-pressed and the pressed styling. */
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
  /** Hidden items take no space (e.g. table tools outside a table). Default: visible. */
  isVisible?: (editor: Editor) => boolean;
  run: (editor: Editor, ctx: ToolbarContext) => void;
};

const heading = (level: 1 | 2 | 3, icon: LucideIcon): ToolbarItem => ({
  id: `h${level}`,
  label: `Heading ${level}`,
  icon,
  group: "block",
  shortcut: `⌘⌥${level}`,
  isActive: (e) => e.isActive("heading", { level }),
  run: (e) => e.chain().focus().toggleHeading({ level }).run(),
});

const inTable = (e: Editor) => e.isActive("table");

export const TOOLBAR_ITEMS: ToolbarItem[] = [
  {
    id: "paragraph",
    label: "Text",
    icon: Pilcrow,
    group: "block",
    shortcut: "⌘⌥0",
    isActive: (e) => e.isActive("paragraph"),
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  heading(1, Heading1),
  heading(2, Heading2),
  heading(3, Heading3),
  {
    id: "bold",
    label: "Bold",
    icon: Bold,
    group: "inline",
    shortcut: "⌘B",
    isActive: (e) => e.isActive("bold"),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    id: "italic",
    label: "Italic",
    icon: Italic,
    group: "inline",
    shortcut: "⌘I",
    isActive: (e) => e.isActive("italic"),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    id: "strike",
    label: "Strikethrough",
    icon: Strikethrough,
    group: "inline",
    shortcut: "⌘⇧S",
    isActive: (e) => e.isActive("strike"),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    id: "code",
    label: "Inline code",
    icon: Code,
    group: "inline",
    shortcut: "⌘E",
    isActive: (e) => e.isActive("code"),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    id: "link",
    label: "Link",
    icon: Link,
    group: "inline",
    shortcut: "⌘K",
    isActive: (e) => e.isActive("link"),
    run: (_e, ctx) => ctx.openLinkDialog(),
  },
  {
    id: "bulletList",
    label: "Bulleted list",
    icon: List,
    group: "list",
    shortcut: "⌘⇧8",
    isActive: (e) => e.isActive("bulletList"),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: "orderedList",
    label: "Numbered list",
    icon: ListOrdered,
    group: "list",
    shortcut: "⌘⇧7",
    isActive: (e) => e.isActive("orderedList"),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "taskList",
    label: "Task list",
    icon: ListTodo,
    group: "list",
    shortcut: "⌘⇧9",
    isActive: (e) => e.isActive("taskList"),
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: "blockquote",
    label: "Quote",
    icon: Quote,
    group: "insert",
    shortcut: "⌘⇧B",
    isActive: (e) => e.isActive("blockquote"),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "codeBlock",
    label: "Code block",
    icon: SquareCode,
    group: "insert",
    shortcut: "⌘⌥C",
    isActive: (e) => e.isActive("codeBlock"),
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "divider",
    label: "Divider",
    icon: Minus,
    group: "insert",
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "table",
    label: "Insert table",
    icon: Table,
    group: "insert",
    isVisible: (e) => !inTable(e),
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: "addRow",
    label: "Add row",
    icon: BetweenHorizontalEnd,
    group: "table",
    isVisible: inTable,
    run: (e) => e.chain().focus().addRowAfter().run(),
  },
  {
    id: "addColumn",
    label: "Add column",
    icon: BetweenVerticalEnd,
    group: "table",
    isVisible: inTable,
    run: (e) => e.chain().focus().addColumnAfter().run(),
  },
  {
    id: "deleteTable",
    label: "Delete table",
    icon: Trash2,
    group: "table",
    isVisible: inTable,
    run: (e) => e.chain().focus().deleteTable().run(),
  },
  {
    id: "undo",
    label: "Undo",
    icon: Undo2,
    group: "history",
    shortcut: "⌘Z",
    isDisabled: (e) => !e.can().undo(),
    run: (e) => e.chain().focus().undo().run(),
  },
  {
    id: "redo",
    label: "Redo",
    icon: Redo2,
    group: "history",
    shortcut: "⌘⇧Z",
    isDisabled: (e) => !e.can().redo(),
    run: (e) => e.chain().focus().redo().run(),
  },
];
