"use client";

import type { KeyboardEvent, PointerEvent } from "react";
import { cn } from "@/lib/cn";
import type { AiScope } from "@/lib/ai/settings";

/** `detail` (a word count) is dropped on phones, where the two options and "What gets sent" share a row. */
export type ScopeOption = { value: AiScope; label: string; detail: string };

type ScopeToggleProps = {
  value: AiScope;
  options: ScopeOption[];
  onChange: (scope: AiScope) => void;
};

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Keeps focus (and the iPhone keyboard) in the request field while switching. */
const keepFocus = (e: PointerEvent) => e.preventDefault();

/**
 * What the request carries: the target or the whole note. A radio group (one Tab stop, arrow keys move
 * and select, WAI-ARIA radio pattern) drawn as a segmented control.
 */
export function ScopeToggle({ value, options, onChange }: ScopeToggleProps) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = STEP[e.key];
    if (!step) return;
    e.preventDefault();
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-scope="${next.value}"]`)?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Note text to send"
      onKeyDown={onKeyDown}
      className="flex min-w-0 rounded-md bg-hover p-0.5 pointer-coarse:p-0"
    >
      {options.map((option) => {
        const checked = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-scope={option.value}
            onPointerDown={keepFocus}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-6 min-w-0 truncate rounded px-2 text-[12.5px] pointer-coarse:h-11 pointer-coarse:px-3",
              "pointer-coarse:text-[14px]",
              checked ? "bg-surface text-ink ring-1 ring-line-strong" : "text-muted hover:text-ink",
            )}
          >
            {option.label}
            <span className="max-md:hidden">{option.detail}</span>
          </button>
        );
      })}
    </div>
  );
}
