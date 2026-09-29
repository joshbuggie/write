"use client";

import { useEffect, useState } from "react";

/** True for a text field or editor, where arrow keys and touches belong to the text. */
export const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "INPUT");

/**
 * True while someone types on a touch screen. The rail steps aside then: the keyboard and the docked
 * toolbar take the bottom of the screen, and a thumb at the right edge is placing the caret, not scrubbing.
 */
export function useEditingOnTouch(): boolean {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const coarse = matchMedia("(pointer: coarse)");
    let frame = 0;
    // After a blur, focus lands somewhere a frame later; checking then avoids a flicker between fields.
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setEditing(coarse.matches && isEditable(document.activeElement)));
    };
    update();
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  return editing;
}
