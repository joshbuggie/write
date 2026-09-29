import type { CSSProperties } from "react";

/**
 * The heading list's frosted glass: the surface color at the opacity chosen in Settings, with the note
 * behind it blurred so the headings stay readable (docs/design-decisions.md#d32). Shared with the preview
 * in Settings so the two always match. Fully opaque needs no blur.
 */
export function rolodexSurface(opacity: number): CSSProperties {
  const blur = opacity < 100 ? "blur(14px) saturate(1.4)" : undefined;
  return {
    backgroundColor: `color-mix(in srgb, var(--surface) ${opacity}%, transparent)`,
    backdropFilter: blur,
    WebkitBackdropFilter: blur,
  };
}

/** The heading list's frame, shared with the Settings preview. */
export const ROLODEX_FRAME = "rounded-[10px] border border-line-strong/70 shadow-pop";
