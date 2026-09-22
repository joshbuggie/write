"use client";

import { useMemo } from "react";
import { VISUAL_EDITOR_MAX_BYTES } from "@/lib/constants";
import type { LossReason } from "@/lib/markdown/fidelity";
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
 * conflict handling independent of Tiptap vs. textarea.
 */
export type EditorHandle = {
  /** Full file text to save: front matter + body. */
  getContent(): string;
  /** Replace the whole file text without counting it as an edit (draft restore). */
  setContent(fileText: string): void;
  setEditable(editable: boolean): void;
  focusStart(): void;
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
 * Picks visual or source mode for a note (§8.3). Default export because the note screen loads it with
 * next/dynamic ({ ssr: false }), which keeps Tiptap out of the shell's bundle.
 */
export default function NoteEditor({ content, request, toolbarSlot, onReady, onChange }: NoteEditorProps) {
  const tooLarge = useMemo(() => byteLength(content) > VISUAL_EDITOR_MAX_BYTES, [content]);

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
