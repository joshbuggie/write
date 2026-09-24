"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatShortcut, shortcutConflict, shortcutFromEvent } from "@/lib/ai/shortcut";
import { cn } from "@/lib/cn";

type ShortcutFieldProps = { value: string; onChange: (shortcut: string) => void };

/**
 * The prompt window's shortcut. "Change" records the next key combination; Esc cancels. A combination
 * the editor or the browser already uses is refused by name, so ⌘K keeps adding links. Plain Tab, Enter
 * and Space still work while recording, so the Cancel button stays usable from the keyboard.
 */
export function ShortcutField({ value, onChange }: ShortcutFieldProps) {
  const labelId = useId();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      if (plain && ["Tab", "Enter", " "].includes(e.key)) {
        if (e.key === "Tab") setRecording(false);
        return;
      }
      e.preventDefault();
      e.stopPropagation(); // Esc cancels recording, not the dialog
      if (e.key === "Escape") return setRecording(false);
      const shortcut = shortcutFromEvent(e);
      if (!shortcut) {
        if (!["Meta", "Control", "Alt", "Shift"].includes(e.key))
          setError("Include ⌘ (or Ctrl) in the shortcut.");
        return;
      }
      const taken = shortcutConflict(shortcut);
      if (taken) return setError(`${formatShortcut(shortcut)} is already used for ${taken}.`);
      setError(null);
      setRecording(false);
      onChange(shortcut);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onChange]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p id={labelId} className="text-[13px] font-medium text-muted">
            Shortcut
          </p>
          <p className="text-[12.5px] text-subtle">
            {recording
              ? "Press the new shortcut, or Esc to cancel."
              : "Opens the prompt window at the cursor."}
          </p>
        </div>
        <kbd
          aria-labelledby={labelId}
          className={cn(
            "inline-flex h-8 min-w-14 items-center justify-center rounded-md border px-2.5 font-sans text-[14px]",
            recording ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-canvas text-ink",
          )}
        >
          {recording ? "Press keys…" : formatShortcut(value)}
        </kbd>
        <Button
          size="sm"
          aria-pressed={recording}
          onClick={() => {
            setError(null);
            setRecording((r) => !r);
          }}
        >
          {recording ? "Cancel" : "Change"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
