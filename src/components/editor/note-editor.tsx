"use client";

import { useMemo } from "react";
import { VISUAL_EDITOR_MAX_BYTES } from "@/lib/constants";
import { hasOversizedParagraph, type LossReason } from "@/lib/markdown/fidelity";
import { byteLength } from "@/lib/names";
import { SourceEditor } from "./source-editor";
import { VisualEditor } from "./visual-editor";

/** What the note screen asks for: decide automatically, force Markdown source, or visual even if lossy. */
export type EditorRequest = "auto" | "source" | "visual";
export type EditorMode = "visual" | "source";
/** Why a note opened in source mode although the user didn't ask for it (null otherwise). */
export type SourceReason = { kind: "large" } | { kind: "lossy"; reasons: LossReason[] } | null;

/**
 * The few things the note screen needs from whichever editor is mounted. Keeps autosave, rename and
 * conflict handling independent of Tiptap vs. textarea. There is deliberately no setContent: other text
 * (a draft, the disk version) is loaded by remounting, so it passes the same fidelity check as a file.
 */
export type EditorHandle = {
  /** Full file text to save: front matter + body. */
  getContent(): string;
  setEditable(editable: boolean): void;
  /**
   * Focuses the body with the caret at its start, or at a position from getCaret(). Synchronous, so a
   * key typed right after Enter in the title can't land in the title.
   */
  focus(at: "start" | number): void;
  hasFocus(): boolean;
  /** The caret position, so it can be put back after the editor remounts (e.g. under a new name). */
  getCaret(): number;
};

export type EditorReady = {
  handle: EditorHandle;
  /** The file text that counts as "unchanged" right after opening; saves happen only when it differs. */
  baseline: string;
  mode: EditorMode;
  sourceReason: SourceReason;
};

export type NoteEditorProps = {
  /** File text to open. The note screen remounts this component (by key) to load different text. */
  content: string;
  request: EditorRequest;
  toolbarSlot: HTMLElement | null;
  /** Called once per mount, after the editor exists. */
  onReady: (ready: EditorReady) => void;
  /** Called on every user edit (feeds the autosaver's markDirty). */
  onChange: () => void;
};

/**
 * Picks visual or source mode for a note (see docs/design-decisions.md#d18). Default export because the note
 * screen loads it with next/dynamic ({ ssr: false }), which keeps Tiptap out of the shell's bundle.
 */
export default function NoteEditor({ content, request, toolbarSlot, onReady, onChange }: NoteEditorProps) {
  // A huge paragraph is as slow to parse as a huge file (marked is quadratic on unclosed emphasis), so
  // both open in source mode, before Tiptap ever parses them.
  const tooLarge = useMemo(
    () => byteLength(content) > VISUAL_EDITOR_MAX_BYTES || hasOversizedParagraph(content),
    [content],
  );

  if (tooLarge || request === "source") {
    return (
      <SourceEditor
        content={content}
        sourceReason={tooLarge ? { kind: "large" } : null}
        onReady={onReady}
        onChange={onChange}
      />
    );
  }
  return (
    <VisualEditor
      content={content}
      allowLossy={request === "visual"}
      toolbarSlot={toolbarSlot}
      onReady={onReady}
      onChange={onChange}
    />
  );
}
