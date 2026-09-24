import type { Editor, JSONContent } from "@tiptap/core";
import type { MarkdownManager } from "@tiptap/markdown";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { createMarkdownManager } from "@/lib/markdown/extensions";
import { parsePastedMarkdown } from "@/lib/markdown/markdown-paste";
import { currentRange, type Target } from "./ai-target";

/**
 * Putting a reply into the note. Every function is one transaction, so one ⌘Z undoes it, and each one
 * builds the nodes itself (tr.replaceWith) instead of going through insertContent, which would give a
 * plain reply the marks of the text it replaces (a bold first word would make the whole reply bold).
 */

function plainParagraphs(text: string): JSONContent[] {
  return text
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p.trim() }] }));
}

/** A reply as note content, parsed like a Markdown paste (docs/design-decisions.md#d22). */
function parseReply(manager: MarkdownManager | undefined, markdown: string) {
  const parsed = manager ? parsePastedMarkdown(manager, markdown) : null;
  return parsed
    ? { blocks: parsed.content ?? [], plain: false }
    : { blocks: plainParagraphs(markdown), plain: true };
}

let checker: MarkdownManager | null = null;

/**
 * False when the editor can't keep all of a reply's Markdown (raw HTML, footnotes…): like such a paste, it
 * then goes in as plain text. The prompt window says so, and previews it that way, before anything is applied.
 */
export function keepsFormatting(markdown: string): boolean {
  checker ??= createMarkdownManager();
  return !parseReply(checker, markdown).plain;
}

const replyNodes = (editor: Editor, markdown: string): PMNode[] =>
  parseReply(editor.markdown, markdown).blocks.map((json) => editor.schema.nodeFromJSON(json));

/** A model often wraps code in a fence even when asked not to; inside a code block that fence is noise. */
const unfence = (text: string) =>
  text.replace(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/, "$1").replace(/\n$/, "");

/** One line of text, for places that hold one paragraph (a table cell), the way a paste is flattened there. */
const oneLine = (blocks: PMNode[]) =>
  blocks
    .map((b) => b.textBetween(0, b.content.size, " ", " ").trim())
    .filter(Boolean)
    .join(" ");

/** Runs one edit as a single undoable, focused, scrolled-to transaction. `edit` changes tr only when it returns true. */
function apply(editor: Editor, edit: (tr: Transaction) => boolean): boolean {
  return editor
    .chain()
    .focus()
    .command(({ tr }) => edit(tr) && Boolean(tr.scrollIntoView()))
    .run();
}

/**
 * Swaps whole blocks (children of one parent) for the reply's blocks. Into a list, a list reply gives
 * its items, and plain paragraphs become items, so selected list items stay separate items.
 */
function replaceBlocks(tr: Transaction, from: number, to: number, blocks: PMNode[]): boolean {
  const $from = tr.doc.resolve(from);
  const $to = tr.doc.resolve(to);
  if (!$from.sameParent($to)) return false;
  const parent = $from.parent;
  const item = parent.type.contentMatch.defaultType;
  const candidates = [Fragment.from(blocks)];
  if (blocks.length === 1 && !blocks[0].isTextblock) candidates.push(blocks[0].content);
  if (item && blocks.every((b) => b.type.name === "paragraph")) {
    const items = blocks.map((b) => item.createAndFill(null, b));
    if (items.every(Boolean)) candidates.push(Fragment.fromArray(items as PMNode[]));
  }
  const fit = candidates.find((c) => parent.canReplace($from.index(), $to.index(), c));
  if (!fit) return false;
  tr.replaceWith(from, to, fit);
  return true;
}

/** An empty line gets the reply; if the line has content by now, the reply goes at the caret, and nothing is lost. */
function fillLine(editor: Editor, tr: Transaction, $pos: ResolvedPos, blocks: PMNode[]): boolean {
  if (blocks.length === 1 && blocks[0].type.name === "paragraph") {
    tr.insert($pos.pos, blocks[0].content);
    return true;
  }
  const container = $pos.node(-1);
  const index = $pos.index(-1);
  const all = Fragment.from(blocks);
  if ($pos.parent.content.size === 0 && container.canReplace(index, index + 1, all)) {
    tr.replaceWith($pos.before(), $pos.after(), all);
  } else if (container.canReplace(index + 1, index + 1, all)) {
    tr.insert($pos.after(), all);
  } else {
    const line = oneLine(blocks);
    if (!line) return false;
    tr.insert($pos.pos, editor.schema.text(line));
  }
  return true;
}

/**
 * Replaces the target with the reply (on an empty line: fills it). One paragraph replaces inline, so part
 * of a sentence stays in its paragraph. Several blocks go in only where the container can hold them;
 * elsewhere (a table cell) they are joined into one line.
 */
export function replaceTarget(editor: Editor, target: Target, markdown: string): boolean {
  const { from, to } = currentRange(editor, target);
  if (target.code) {
    const text = unfence(markdown);
    return apply(editor, (tr) => Boolean(text) && Boolean(tr.insertText(text, from, to)));
  }
  const blocks = replyNodes(editor, markdown);
  return apply(editor, (tr) => {
    if (blocks.length === 0) return false;
    if (target.wholeBlocks) return replaceBlocks(tr, from, to, blocks);
    const $from = tr.doc.resolve(from);
    if (target.kind === "cursor") return fillLine(editor, tr, $from, blocks);
    if (blocks.length === 1 && blocks[0].type.name === "paragraph") {
      tr.replaceWith(from, to, blocks[0].content);
      return true;
    }
    const index = $from.index(-1);
    if ($from.node(-1).canReplace(index, index + 1, Fragment.from(blocks))) {
      tr.replaceRange(from, to, new Slice(Fragment.from(blocks), 0, 0));
      return true;
    }
    const line = oneLine(blocks);
    if (!line) return false;
    tr.replaceWith(from, to, editor.schema.text(line));
    return true;
  });
}

/** Inserts the reply after the top-level block the target ends in (on an empty line: fills it). */
export function insertBelow(editor: Editor, target: Target, markdown: string): boolean {
  if (target.kind === "cursor") return replaceTarget(editor, target, markdown);
  const { to } = currentRange(editor, target);
  return apply(editor, (tr) => {
    const $to = tr.doc.resolve(to);
    const after = $to.depth > 0 ? $to.after(1) : to; // at depth 0, `to` is already between blocks
    const text = unfence(markdown);
    const nodes = target.code
      ? text
        ? [editor.schema.nodes.codeBlock.create($to.parent.attrs, editor.schema.text(text))]
        : []
      : replyNodes(editor, markdown);
    if (nodes.length === 0) return false;
    tr.insert(after, nodes);
    return true;
  });
}

/** Replaces the whole body with the reply ("Whole note" + Replace). Front matter is kept apart and untouched. */
export function replaceNote(editor: Editor, markdown: string): boolean {
  const blocks = replyNodes(editor, markdown);
  return apply(editor, (tr) => {
    if (blocks.length === 0) return false;
    tr.replaceWith(0, tr.doc.content.size, blocks);
    return true;
  });
}
