"use client";

import { useId } from "react";
import { ROLODEX_FRAME, rolodexSurface } from "@/components/note/rail/rolodex-surface";
import { cn } from "@/lib/cn";
import { type AppearanceSettings, RAIL_OPACITY } from "@/lib/appearance";

type AppearanceSectionProps = {
  value: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
};

/** Sample headings for the preview, in the order a note would have them. */
const SAMPLE = ["Getting started", "Headings and lists", "Keyboard shortcuts"];

/**
 * How write looks (docs/design-decisions.md#d32). The heading list only appears while scrubbing a note,
 * which the dialog covers, so a preview over sample text shows the chosen opacity as you drag.
 */
export function AppearanceSection({ value, onChange }: AppearanceSectionProps) {
  const headingId = useId();
  const sliderId = useId();
  return (
    <section aria-labelledby={headingId} className="mb-5 border-b border-line pb-5">
      <h3 id={headingId} className="text-[15px] font-semibold tracking-tight">
        Appearance
      </h3>
      <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
        Drag the rail at the right edge of a note to move through it quickly. A list of the note’s headings
        turns beside it as you go, and letting go lands on the nearest heading.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={sliderId} className="text-[13px] font-medium text-muted">
            Heading list opacity
          </label>
          <output htmlFor={sliderId} className="text-[13px] text-ink tabular-nums">
            {value.railOpacity}%
          </output>
        </div>
        <input
          id={sliderId}
          type="range"
          min={RAIL_OPACITY.min}
          max={RAIL_OPACITY.max}
          step={RAIL_OPACITY.step}
          value={value.railOpacity}
          onChange={(e) => onChange({ ...value, railOpacity: Number(e.target.value) })}
          className="w-full accent-accent pointer-coarse:h-11"
        />
        <div
          aria-hidden
          className="relative overflow-hidden rounded-md border border-line bg-canvas px-3 py-2.5 text-[13px] leading-relaxed text-ink"
        >
          <p>
            Every note is a Markdown file in your data folder. The headings you write become stops on the
            rail, so a long note is a few flicks from end to end, and landing on a heading puts it right under
            the toolbar where you can start reading.
          </p>
          <div
            style={rolodexSurface(value.railOpacity)}
            className={cn(ROLODEX_FRAME, "absolute top-1/2 right-3 flex w-44 -translate-y-1/2 flex-col py-1")}
          >
            {SAMPLE.map((title, i) => (
              <span
                key={title}
                className={cn(
                  "mx-[3px] flex h-6 items-center gap-[7px] rounded-[7px] px-2 text-[13px] whitespace-nowrap",
                  i === 1 ? "bg-accent/15 font-semibold text-ink" : "text-muted opacity-60",
                )}
              >
                <i className={cn("size-1 shrink-0 rounded-full", i === 1 ? "bg-accent" : "bg-line-strong")} />
                <span className="truncate">{title}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
