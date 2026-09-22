// Vitest turns every CSS import (even `?raw`) into an empty string, so read the stylesheet as a file.
// eslint-disable-next-line no-restricted-imports -- a test reading source, not app code touching notes
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

/** The custom properties declared in the first block that follows `marker` in globals.css. */
function tokens(marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  const block = css.slice(css.indexOf("{", css.indexOf(":root", start)) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    Array.from(block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi), (m) => [m[1], m[2]]),
  );
}

/** WCAG 2.x relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { light: tokens(":root"), dark: tokens("@media (prefers-color-scheme: dark)") };
const TEXT = ["ink", "muted", "subtle"];
const BACKGROUNDS = ["canvas", "surface", "sidebar", "hover"];

describe.each(Object.entries(THEMES))("%s theme", (_, theme) => {
  it.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg])))(
    "%s text on %s meets WCAG AA (4.5:1)",
    (fg, bg) => {
      expect(theme[fg], fg).toBeDefined();
      expect(theme[bg], bg).toBeDefined();
      expect(contrast(theme[fg], theme[bg])).toBeGreaterThanOrEqual(4.5);
    },
  );
});
