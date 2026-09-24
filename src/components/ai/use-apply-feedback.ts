"use client";

import { useToast } from "@/components/ui/toast";
import type { ApplyMode } from "@/lib/ai/settings";

/** What was applied, for the toast: the target, the whole note, or an insertion. */
export type Applied = { mode: ApplyMode; wholeNote: boolean; atCursor: boolean };

/**
 * The toasts both editors show after a reply is used: what happened, with Undo (the editor's own undo, so
 * it matches ⌘Z), or why nothing happened. Copy goes through the clipboard with its own toast.
 */
export function useApplyFeedback() {
  const toast = useToast();

  function applied(ok: boolean, what: Applied, undo: () => void, note = "") {
    if (!ok) {
      toast.show({
        message: "Couldn't put the reply into the note there. The text may have changed; try again.",
        tone: "error",
      });
      return;
    }
    const replaced = what.mode === "replace" && !what.atCursor;
    const done = what.wholeNote
      ? "Replaced the note"
      : replaced
        ? "Replaced with the reply"
        : "Inserted the reply";
    toast.show({ message: done + note, action: { label: "Undo", onClick: undo } });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: "Copied" });
    } catch {
      toast.show({ message: "Couldn't copy: the browser blocked the clipboard.", tone: "error" });
    }
  }

  return { applied, copy };
}
