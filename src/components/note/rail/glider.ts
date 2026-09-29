/** An animated scroll the rail starts, which the reader's own scrolling or typing interrupts. */
export type Glider = {
  /** Scrolls `area` to `target`, then calls `onDone` (not called when interrupted). */
  to: (target: number, onDone?: () => void) => void;
  cancel: () => void;
};

const DURATION_MS = 360;
/** Input that means the reader took over; the rail's own wheel handler stops its event reaching these. */
const TAKEOVER = ["wheel", "touchstart", "keydown"] as const;

/**
 * Landing on a heading eases out over a third of a second rather than jumping, so the reader sees which
 * way the note moved. Reduced motion jumps. Plain rAF rather than `scrollTo({ behavior: "smooth" })`,
 * because only this can be cancelled and followed by the landing mark.
 */
export function createGlider(area: HTMLElement): Glider {
  let frame = 0;
  const cancel = () => {
    cancelAnimationFrame(frame);
    for (const type of TAKEOVER) window.removeEventListener(type, cancel);
  };
  const to = (target: number, onDone?: () => void) => {
    cancel();
    const from = area.scrollTop;
    if (Math.abs(target - from) < 1 || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      area.scrollTop = target;
      onDone?.();
      return;
    }
    for (const type of TAKEOVER) window.addEventListener(type, cancel, { passive: true });
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION_MS);
      area.scrollTop = from + (target - from) * (1 - (1 - p) ** 3);
      if (p < 1) {
        frame = requestAnimationFrame(step);
      } else {
        cancel();
        onDone?.();
      }
    };
    frame = requestAnimationFrame(step);
  };
  return { to, cancel };
}
