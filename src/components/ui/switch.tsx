import { cn } from "@/lib/cn";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Becomes aria-label, unless `labelledBy` points at a visible heading instead. */
  label: string;
  labelledBy?: string;
};

/**
 * On/off control for settings that take effect as a whole (the AI assistant). A button with
 * role="switch", so it is announced as on/off and toggles with Space and Enter. The knob uses muted/accent
 * tokens rather than white, so it stays visible on the track in both themes. On touch screens an
 * invisible margin makes the target 44px tall (docs/design-decisions.md#d25) without a bigger track.
 */
export function Switch({ checked, onChange, label, labelledBy }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors",
        "pointer-coarse:h-7 pointer-coarse:w-12 pointer-coarse:before:absolute pointer-coarse:before:-inset-2",
        checked ? "border-accent bg-accent" : "border-line-strong bg-active",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-4.5 rounded-full transition-transform pointer-coarse:size-5.5",
          checked
            ? "translate-x-[18px] bg-accent-ink pointer-coarse:translate-x-[22px]"
            : "translate-x-[2px] bg-muted",
        )}
      />
    </button>
  );
}
