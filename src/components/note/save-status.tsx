"use client";

import { Check, CloudOff, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import type { SaveState } from "@/lib/autosave";
import { cn } from "@/lib/cn";

type SaveStatusProps = {
  state: SaveState;
  onRetry: () => void;
  /** Scrolls to the conflict banner, where the actual choices are. */
  onShowConflict: () => void;
};

/** Saves usually finish in well under 300 ms; showing "Saving…" for those would only flicker. */
const SAVING_DELAY_MS = 300;

const formatTime = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const ICON = "size-5 shrink-0 md:size-[18px]";

/** On phones only the icon shows; the text stays available to screen readers. */
function Label({ children }: { children: ReactNode }) {
  return <span className="text-[13px] whitespace-nowrap max-md:sr-only">{children}</span>;
}

/**
 * The header's save indicator (§10.7). Calm when things are fine, specific when they are not. Only
 * offline, error and conflict are announced to screen readers; routine saves would be noise.
 */
export function SaveStatus({ state, onRetry, onShowConflict }: SaveStatusProps) {
  // Remember which save became slow (state objects are immutable snapshots), so no reset is needed.
  const [slowSave, setSlowSave] = useState<SaveState | null>(null);
  useEffect(() => {
    if (state.kind !== "saving") return;
    const timer = setTimeout(() => setSlowSave(state), SAVING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const announcement =
    state.kind === "offline"
      ? "Offline. Changes are kept on this device."
      : state.kind === "error"
        ? `Not saved. ${state.message}`
        : state.kind === "conflict"
          ? "Conflict: this note changed elsewhere."
          : "";

  return (
    <div className="flex min-w-0 items-center">
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {renderState(state, slowSave === state, onRetry, onShowConflict)}
    </div>
  );
}

function renderState(state: SaveState, slow: boolean, onRetry: () => void, onShowConflict: () => void) {
  const quiet = "flex h-11 items-center gap-1.5 px-2 text-muted md:h-8";
  switch (state.kind) {
    case "saved": {
      const title = state.at ? `Saved ${formatTime(state.at)}` : "Saved";
      return (
        <span className={quiet} title={title}>
          <Check aria-hidden strokeWidth={1.75} className={ICON} />
          <Label>Saved</Label>
        </span>
      );
    }
    case "dirty":
    case "saving":
      if (state.kind === "saving" && slow) {
        return (
          <span className={quiet}>
            <Spinner className={ICON} />
            <Label>Saving…</Label>
          </span>
        );
      }
      return (
        <span className={quiet} title="Edited">
          <span aria-hidden className="flex size-5 items-center justify-center md:size-auto">
            <span className="size-1.5 rounded-full bg-subtle" />
          </span>
          <Label>Edited</Label>
        </span>
      );
    case "offline":
      return (
        <span className={cn(quiet, "text-warning")}>
          <CloudOff aria-hidden strokeWidth={1.75} className={ICON} />
          <Label>Offline · kept on this device</Label>
        </span>
      );
    case "error":
      return (
        <button
          type="button"
          onClick={onRetry}
          title={state.message}
          className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-danger hover:bg-danger-soft md:h-8 md:min-w-0"
        >
          <TriangleAlert aria-hidden strokeWidth={1.75} className={ICON} />
          <Label>Not saved · Retry</Label>
        </button>
      );
    case "conflict":
      return (
        <button
          type="button"
          onClick={onShowConflict}
          className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-warning hover:bg-warning-soft md:h-8 md:min-w-0"
        >
          <TriangleAlert aria-hidden strokeWidth={1.75} className={ICON} />
          <Label>Conflict</Label>
        </button>
      );
  }
}
