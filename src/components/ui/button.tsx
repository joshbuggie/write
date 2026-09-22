import type { LucideIcon } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export type ButtonProps = React.ComponentPropsWithRef<"button"> & {
  variant?: Variant;
  size?: Size;
  pending?: boolean;
};

const BASE =
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium " +
  "transition-colors disabled:cursor-default disabled:opacity-50";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent/90 active:bg-accent/80",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-hover active:bg-active",
  ghost: "text-muted hover:bg-hover hover:text-ink active:bg-active",
  danger: "bg-danger text-accent-ink hover:bg-danger/90 active:bg-danger/80",
};

const PRESSED = "bg-active text-ink";

// Touch devices always get 44px targets (§10.6); fine pointers keep the compact desktop metrics.
const TEXT_SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[13px] pointer-coarse:h-11 pointer-coarse:text-[15px]",
  md: "h-9 px-3.5 text-[14px] pointer-coarse:h-11 pointer-coarse:text-[16px]",
};
const ICON_SIZES: Record<Size, string> = {
  sm: "size-8 pointer-coarse:size-11",
  md: "size-9 pointer-coarse:size-11",
};

/** Button classes for elements that must look like a Button but aren't one (e.g. a DownloadLink). */
export function buttonStyles(variant: Variant = "secondary", size: Size = "md"): string {
  return cn(BASE, VARIANTS[variant], TEXT_SIZES[size]);
}

/** IconButton classes for non-button elements (e.g. the ⬇ DownloadLink in a header). Put the icon inside. */
export function iconButtonStyles(variant: Variant = "ghost", size: Size = "sm"): string {
  return cn(BASE, VARIANTS[variant], ICON_SIZES[size]);
}

/**
 * The app's only button. `pending` disables it and shows a Spinner, so async actions can't be double-fired.
 * Defaults to type="button" so it never submits a form by accident. Use `className` for layout (margins,
 * width); colors and heights come from `variant` and `size`.
 */
export function Button({
  variant = "secondary",
  size = "md",
  pending = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(buttonStyles(variant, size), className)}
    >
      {pending && <Spinner />}
      {children}
    </button>
  );
}

export type IconButtonProps = Omit<ButtonProps, "children"> & {
  /** Becomes aria-label and the tooltip, so every icon-only control is announced. */
  label: string;
  icon: LucideIcon;
  /** Toggle buttons (toolbar marks, sidebar toggle): sets aria-pressed and the active look. */
  pressed?: boolean;
  /** Shown in the tooltip, e.g. "⌘B". */
  shortcut?: string;
};

/** Square, icon-only button. 32px on desktop (`size="sm"`, the default look for toolbars), 44px on touch. */
export function IconButton({
  label,
  icon: Icon,
  pressed,
  shortcut,
  variant = "ghost",
  size = "sm",
  pending = false,
  disabled,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} ${shortcut}` : label}
      {...rest}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      className={cn(BASE, pressed ? PRESSED : VARIANTS[variant], ICON_SIZES[size], className)}
    >
      {pending ? (
        <Spinner className="size-5 md:size-[18px]" />
      ) : (
        <Icon aria-hidden strokeWidth={1.75} className="size-5 md:size-[18px]" />
      )}
    </button>
  );
}
