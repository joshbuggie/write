import { useId } from "react";
import type React from "react";
import { cn } from "@/lib/cn";

export type TextFieldProps = React.ComponentPropsWithRef<"input"> & { label?: string; error?: string | null };

/**
 * Labelled single-line input with an inline, announced error message.
 * When `aria-label` is given the visible label is dropped (the input is already named).
 * `className` styles the <input>. Phones get 16px text so iOS doesn't zoom in (see globals.css);
 * to override a base utility (height, background) use Tailwind's `!` suffix, e.g. `h-8!`.
 */
export function TextField({ label, error, id, className, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const describedBy = [rest["aria-describedby"], error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label && !rest["aria-label"] && (
        <label htmlFor={inputId} className="text-[13px] font-medium text-muted">
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...rest}
        aria-invalid={error ? true : rest["aria-invalid"]}
        aria-describedby={describedBy || undefined}
        className={cn(
          "h-9 w-full min-w-0 rounded-md border border-line-strong bg-surface px-2.5 text-base text-ink",
          "transition-colors placeholder:text-subtle focus-visible:border-accent focus-visible:outline-offset-0",
          "disabled:opacity-60 aria-invalid:border-danger md:text-[14px] pointer-coarse:h-11",
          className,
        )}
      />
      {error && (
        <p id={errorId} className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
