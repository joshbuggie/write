"use client";

import { Check, TriangleAlert, X } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/cn";
import type { ProposalChange } from "@/lib/proposals/types";
import { changeTitle, conflictNote, KIND_LABELS, type Decision } from "./review-labels";
import { SectionDiff } from "./section-diff";

type ChangeCardProps = {
  change: ProposalChange;
  source: string;
  decision: Decision | undefined;
  onDecide: (decision: Decision | undefined) => void;
};

const toggle =
  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium pointer-coarse:h-11";

/**
 * One section-level change: what it is, why (if the harness said), a warning when you changed the same
 * section, the words that would change, and Accept / Reject. Pressing the chosen one again un-decides it.
 */
export function ChangeCard({ change, source, decision, onDecide }: ChangeCardProps) {
  const titleId = useId();
  const warning = conflictNote(change, source);
  const pick = (d: Decision) => onDecide(decision === d ? undefined : d);
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-lg border border-line bg-canvas px-3 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 id={titleId} className="min-w-0 truncate text-[14px] font-semibold text-ink">
          {changeTitle(change)}
        </h4>
        <span className="text-[12.5px] text-muted">{KIND_LABELS[change.kind]}</span>
      </div>
      {change.reason && <p className="text-[13px] leading-relaxed text-muted">{change.reason}</p>}
      {warning && (
        <p className="flex gap-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-[13px] leading-relaxed text-ink">
          <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-warning" />
          {warning}
        </p>
      )}
      <SectionDiff before={change.current ?? ""} after={change.proposed ?? ""} />
      <div role="group" aria-label={`Decision for ${changeTitle(change)}`} className="flex gap-2">
        <button
          type="button"
          aria-pressed={decision === "accept"}
          onClick={() => pick("accept")}
          className={cn(
            toggle,
            decision === "accept"
              ? "border-accent bg-accent text-accent-ink"
              : "border-line-strong bg-surface text-ink hover:bg-hover",
          )}
        >
          <Check aria-hidden strokeWidth={1.75} className="size-4" />
          Accept
        </button>
        <button
          type="button"
          aria-pressed={decision === "reject"}
          onClick={() => pick("reject")}
          className={cn(
            toggle,
            decision === "reject"
              ? "border-line-strong bg-active text-ink"
              : "border-line-strong bg-surface text-ink hover:bg-hover",
          )}
        >
          <X aria-hidden strokeWidth={1.75} className="size-4" />
          Reject
        </button>
      </div>
    </section>
  );
}
