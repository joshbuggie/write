"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import type { EditorReady, SourceReason } from "./note-editor";

type SourceEditorProps = {
  /** The full file, front matter included: in source mode the user edits exactly what is on disk. */
  content: string;
  sourceReason: SourceReason;
  onReady: (ready: EditorReady) => void;
  onChange: () => void;
};

/** Sets the height to fit the text. Grow-only while typing, so the page never jumps when lines go. */
function fitHeight(el: HTMLTextAreaElement, allowShrink: boolean) {
  if (allowShrink) el.style.height = "auto";
  if (allowShrink || el.scrollHeight > el.clientHeight) el.style.height = `${el.scrollHeight}px`;
}

/**
 * Markdown source mode: a plain auto-growing textarea. Used for lossy notes (raw HTML, footnotes,
 * math), for notes too large for the visual editor, and when the user picks "Edit as Markdown".
 * It is uncontrolled so multi-megabyte notes don't re-render on every keystroke.
 */
export function SourceEditor({ content, sourceReason, onReady, onChange }: SourceEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const announceReady = useEffectEvent((el: HTMLTextAreaElement) => {
    // The handle holds the element itself (not the ref), so it still works during unmount.
    onReady({
      mode: "source",
      sourceReason,
      baseline: content,
      handle: {
        getContent: () => el.value,
        setEditable: (editable) => {
          el.readOnly = !editable;
        },
        focus: (at) => {
          const caret = at === "start" ? 0 : Math.min(at, el.value.length);
          el.focus({ preventScroll: at === "start" });
          el.setSelectionRange(caret, caret);
        },
        hasFocus: () => document.activeElement === el,
        getCaret: () => el.selectionStart,
      },
    });
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    fitHeight(el, true);
    announceReady(el);
  }, []);

  return (
    <textarea
      ref={ref}
      defaultValue={content}
      aria-label="Note body (Markdown)"
      spellCheck={false}
      autoCapitalize="sentences"
      onInput={(e) => {
        fitHeight(e.currentTarget, false);
        onChange();
      }}
      className="block w-full resize-none overflow-hidden bg-transparent pt-3 pb-[40vh] font-mono text-[16px] leading-[1.6] text-ink outline-none md:text-[15px]"
    />
  );
}
