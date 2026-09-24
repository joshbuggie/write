"use client";

import { useMemo } from "react";
import { wordDiff } from "@/lib/proposals/word-diff";

/**
 * A section's Markdown with what accepting would change marked word by word: struck-out text goes,
 * highlighted text comes. Uses <del> and <ins>, so screen readers announce them too.
 */
export function SectionDiff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => wordDiff(before.trimEnd(), after.trimEnd()), [before, after]);
  return (
    <div className="max-h-80 overflow-y-auto rounded-md border border-line bg-surface px-3 py-2 text-[14px] leading-[1.6] break-words whitespace-pre-wrap text-ink">
      {parts.map((part, i) =>
        part.type === "same" ? (
          <span key={i}>{part.text}</span>
        ) : part.type === "del" ? (
          <del key={i} className="rounded-sm bg-danger-soft text-muted decoration-danger/60">
            {part.text}
          </del>
        ) : (
          <ins key={i} className="rounded-sm bg-accent-soft no-underline">
            {part.text}
          </ins>
        ),
      )}
    </div>
  );
}
