import { useId } from "react";
import type React from "react";
import { cn } from "@/lib/cn";

export type TextAreaFieldProps = React.ComponentPropsWithRef<"textarea"> & {
  label: string;
  /** Right of the label, e.g. a "Reset to default" button. */
  action?: React.ReactNode;
  /** Help under the field, linked with aria-describedby. */
  hint?: React.ReactNode;
};

/**
 * Labelled multi-line input, styled like TextField, for text people edit as a whole (the AI
 * instructions, a quick action's prompt). Resizable vertically; phones get 16px text (see globals.css).
 */
export function TextAreaField({ label, action, hint, id, className, ...rest }: TextAreaFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <label htmlFor={fieldId} className="text-[13px] font-medium text-muted">
          {label}
        </label>
        {action}
      </div>
      <textarea
        id={fieldId}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
        className={cn(
          "w-full min-w-0 resize-y rounded-md border border-line-strong bg-surface px-2.5 py-2 text-base leading-relaxed",
          "text-ink transition-colors placeholder:text-subtle focus-visible:border-accent focus-visible:outline-offset-0",
          "md:text-[14px]",
          className,
        )}
      />
      {hint && (
        <p id={hintId} className="text-[12.5px] leading-relaxed text-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}
