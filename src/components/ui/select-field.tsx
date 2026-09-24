import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type React from "react";
import { cn } from "@/lib/cn";

export type SelectFieldProps = Omit<React.ComponentPropsWithRef<"select">, "children"> & {
  label: string;
  options: { value: string; label: string }[];
};

/**
 * Labelled native <select>, styled like TextField. Native so phones get their own picker and nothing
 * needs a listbox implementation.
 */
export function SelectField({ label, options, id, className, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={selectId} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          {...rest}
          className={cn(
            "h-9 w-full min-w-0 appearance-none rounded-md border border-line-strong bg-surface pr-8 pl-2.5 text-base",
            "text-ink transition-colors focus-visible:border-accent focus-visible:outline-offset-0 md:text-[14px]",
            "pointer-coarse:h-11",
            className,
          )}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden
          strokeWidth={1.75}
          className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted"
        />
      </div>
    </div>
  );
}
