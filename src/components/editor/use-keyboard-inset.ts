"use client";

import { useEffect, useState } from "react";

export type KeyboardInset = {
  /** The on-screen keyboard covers part of the layout viewport (iOS ignores interactive-widget). */
  keyboardOpen: boolean;
  /** The user pinch-zoomed; a fixed toolbar would float mid-page, so the caller hides it. */
  zoomed: boolean;
};

/**
 * Tracks the iPhone keyboard through `visualViewport` and publishes its height as the `--kb` CSS
 * variable on <html>, so the docked toolbar can sit on top of the keyboard with
 * `bottom-[var(--kb)]`. On Android (which honors `interactive-widget=resizes-content`) and on
 * desktop the inset is simply 0.
 */
export function useKeyboardInset(): KeyboardInset {
  const [state, setState] = useState<KeyboardInset>({ keyboardOpen: false, zoomed: false });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        root.style.setProperty("--kb", `${inset}px`);
        const next = { keyboardOpen: inset > 0, zoomed: vv.scale > 1.01 };
        setState((prev) =>
          prev.keyboardOpen === next.keyboardOpen && prev.zoomed === next.zoomed ? prev : next,
        );
      });
    };

    measure();
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
      root.style.removeProperty("--kb");
    };
  }, []);

  return state;
}
