"use client";

import { useEffect, useState } from "react";
import { TEXT_COLUMN } from "@/components/editor/editor-skeleton";
import type { EditorHandle } from "@/components/editor/note-editor";
import { cn } from "@/lib/cn";
import type { WordCount } from "@/lib/word-count";
import { useEditingOnTouch } from "./rail/use-editing-on-touch";

/** How long typing has to pause before the whole note is counted again. */
const SETTLE_MS = 200;

const words = (n: number) => (n === 1 ? "word" : "words");

/** "1,234 words", or "56 of 1,234 words" while a passage is selected. */
export function wordCountLabel({ total, selected }: WordCount): string {
  const all = `${total.toLocaleString()} ${words(total)}`;
  return selected === null ? all : `${selected.toLocaleString()} of ${all}`;
}

type WordCountBarProps = {
  /** The note's column, watched for edits and a newly mounted editor. */
  root: HTMLElement | null;
  /** The mounted editor, which does the counting (see docs/design-decisions.md#d33). */
  editor: () => EditorHandle | null;
};

/**
 * The bar at the bottom of a note with its word count, and the selection's while the body has a selection.
 * The whole note is recounted when typing pauses and a selection as soon as it changes, while a caret
 * moving as you type keeps the last total. It only reads the editor, so it never touches the note.
 */
export function WordCountBar({ root, editor }: WordCountBarProps) {
  const editingOnTouch = useEditingOnTouch();
  const [count, setCount] = useState<WordCount | null>(null);

  useEffect(() => {
    if (!root) return;
    let timer = 0;
    let frame = 0;
    let withTotal = false;
    let last: WordCount | null = null;
    const recount = (total: boolean) => {
      withTotal ||= total;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const handle = editor();
        if (!handle) return settle(); // the editor is still loading, or remounting in the other mode
        const selected = handle.hasFocus() ? handle.countSelectedWords() : null;
        // A selection is always compared with the current text, so it can't outnumber a stale total.
        const next = {
          total: withTotal || selected !== null || !last ? handle.countWords() : last.total,
          selected,
        };
        withTotal = false;
        if (last?.total === next.total && last.selected === next.selected) return;
        last = next;
        setCount(next);
      });
    };
    const settle = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => recount(true), SETTLE_MS);
    };
    const onSelect = () => recount(false);

    recount(true);
    const mutations = new MutationObserver(settle);
    mutations.observe(root, { subtree: true, childList: true, characterData: true });
    root.addEventListener("input", settle); // a textarea's text changes without DOM mutations
    document.addEventListener("selectionchange", onSelect);
    // The selection only counts while the body has focus; elsewhere it isn't highlighted.
    document.addEventListener("focusin", onSelect);
    document.addEventListener("focusout", onSelect);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      mutations.disconnect();
      root.removeEventListener("input", settle);
      document.removeEventListener("selectionchange", onSelect);
      document.removeEventListener("focusin", onSelect);
      document.removeEventListener("focusout", onSelect);
    };
  }, [root, editor]);

  // On a touch screen the keyboard and the docked toolbar take the bottom of the screen while typing.
  if (editingOnTouch) return null;
  return (
    <div className="sticky bottom-0 z-10 mt-auto border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {/* Phones keep the count clear of the rail's marks, like the text above it. */}
      <div
        data-word-count
        className={cn(
          TEXT_COLUMN,
          "flex h-8 items-center justify-end text-[12px] text-muted tabular-nums max-md:pr-8",
        )}
      >
        {count && wordCountLabel(count)}
      </div>
    </div>
  );
}
