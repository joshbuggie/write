import { Info, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import type { SourceReason } from "@/components/editor/note-editor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { LossReason } from "@/lib/markdown/fidelity";

type NoticeProps = {
  /** "warning" for things that limit editing (lossy, read-only); "neutral" for plain information. */
  tone?: "neutral" | "warning";
  children: ReactNode;
  /** Buttons shown under the message. */
  actions?: ReactNode;
  onDismiss?: () => void;
};

/**
 * Inline message at the top of the note column: fidelity ("opened as Markdown"), restored drafts,
 * read-only files. Quiet by design; the text column stays the hero.
 */
export function Notice({ tone = "neutral", children, actions, onDismiss }: NoticeProps) {
  const Icon = tone === "warning" ? TriangleAlert : Info;
  return (
    <div
      role="note"
      className={cn(
        "mt-4 flex gap-3 rounded-lg px-3 py-2.5 text-[14px] leading-[1.5]",
        tone === "warning" ? "bg-warning-soft text-ink" : "border border-line bg-sidebar text-ink",
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={1.75}
        className={cn("mt-0.5 size-[18px] shrink-0", tone === "warning" ? "text-warning" : "text-muted")}
      />
      <div className="min-w-0 flex-1">
        <div>{children}</div>
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={onDismiss}
          className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink pointer-coarse:size-11"
        >
          <X aria-hidden strokeWidth={1.75} className="size-4" />
        </button>
      )}
    </div>
  );
}

const LOSS_LABELS: Record<LossReason, string> = {
  html: "HTML",
  footnotes: "footnotes",
  math: "math",
  references: "link reference definitions",
  escapes: "backslash escapes",
  structure: "formatting",
};

type SourceModeNoticeProps = { reason: NonNullable<SourceReason>; onEditVisually: () => void };

/**
 * Explains why a note opened as Markdown source although the user didn't ask for it (see
 * docs/design-decisions.md#d16).
 */
export function SourceModeNotice({ reason, onEditVisually }: SourceModeNoticeProps) {
  if (reason.kind === "large") return <Notice>Large note, opened as Markdown.</Notice>;
  const what = reason.reasons.map((r) => LOSS_LABELS[r]).join(", ");
  return (
    <Notice
      tone="warning"
      actions={
        <Button size="sm" onClick={onEditVisually}>
          Edit visually anyway
        </Button>
      }
    >
      This note uses {what} that the visual editor can’t keep, so it opened as Markdown to keep your file
      intact.
    </Notice>
  );
}
