/**
 * How write looks, as saved in the settings file next to the AI settings (docs/design-decisions.md#d32).
 * Shared by the Settings dialog, the note screen and the server, so it stays framework-free.
 */
export type AppearanceSettings = {
  /** How opaque the heading list beside the note rail is, in percent (it is frosted glass below 100). */
  railOpacity: number;
};

/** The Settings slider's range, in percent. Below 30 the headings stop being readable over the note. */
export const RAIL_OPACITY = { min: 30, max: 100, step: 5 } as const;

/** What a new install, or a settings file from before appearance settings existed, gets. */
export const DEFAULT_APPEARANCE: AppearanceSettings = { railOpacity: 80 };

/** True for an opacity the slider can produce: a whole percent within RAIL_OPACITY. */
export const isRailOpacity = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= RAIL_OPACITY.min && v <= RAIL_OPACITY.max;
