"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { cn } from "@/lib/cn";
import { clamp } from "@/lib/rail/geometry";
import type { RailHeading } from "./rail-headings";
import { ROLODEX_FRAME, rolodexSurface } from "./rolodex-surface";

/** What the rail drives, every frame, without re-rendering React. */
export type RolodexHandle = {
  /** Turns the list to fractional heading index `f`. */
  turn: (f: number) => void;
  /** Opens the list beside viewport y `clientY`; `lifted` raises it above a fingertip. */
  show: (clientY: number, lifted: boolean) => void;
  hide: (delayMs?: number) => void;
  isOpen: () => boolean;
  /** "½ speed" and so on while the reader drags away from the rail; "" hides it. */
  setSpeed: (label: string) => void;
};

/** Degrees between neighbouring headings on the drum, the angle where they disappear, and a row's height. */
const STEP = 24;
const CUT = 56;
const ROW = 24;
const RADIUS = ROW / (2 * Math.sin(((STEP / 2) * Math.PI) / 180));
/** How far above the fingertip the list sits on a touch screen, so the thumb doesn't cover it. */
const LIFT = 56;
const MAX_WIDTH = 250;

type RolodexProps = {
  heads: RailHeading[];
  /** Percent, from Settings. */
  opacity: number;
  /** The rail's top in the viewport; the list never goes above it. */
  minTop: number;
  onPick: (index: number) => void;
  ref: Ref<RolodexHandle>;
};

/**
 * The heading list beside the rail: the current heading in the middle and its neighbours turning away on
 * a drum, like a rolodex, so scrubbing shows where you are without reading every heading. Sized to the
 * longest heading, up to 250 px (docs/design-decisions.md#d32).
 */
export function Rolodex({ heads, opacity, minTop, onPick, ref }: RolodexProps) {
  const box = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const count = useRef<HTMLSpanElement>(null);
  const speed = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef(0);

  useImperativeHandle(ref, () => ({
    turn(index) {
      // After the last heading, index runs on toward the end of the note; the list stays on that heading.
      const f = Math.min(index, heads.length - 1);
      const at = Math.round(f);
      rows.current.forEach((row, i) => {
        if (!row) return;
        const angle = (i - f) * STEP;
        const shown = Math.abs(angle) <= CUT;
        row.style.visibility = shown ? "visible" : "hidden";
        row.toggleAttribute("data-current", i === at);
        if (!shown) return;
        row.style.transform = `rotateX(${-angle}deg) translateZ(${RADIUS}px)`;
        row.style.opacity = String(1 - Math.abs(angle) / (CUT * 1.3));
      });
      if (count.current) count.current.textContent = `${at + 1}/${heads.length}`;
    },
    show(clientY, lifted) {
      const el = box.current;
      if (!el) return;
      clearTimeout(hideTimer.current);
      const y = clientY - (lifted ? LIFT : 0) - el.offsetHeight / 2;
      el.style.top = `${clamp(y, minTop + 8, window.innerHeight - el.offsetHeight - 28)}px`;
      el.toggleAttribute("data-open", true);
    },
    hide(delayMs = 0) {
      clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => box.current?.toggleAttribute("data-open", false), delayMs);
    },
    isOpen: () => box.current?.hasAttribute("data-open") ?? false,
    setSpeed(label) {
      if (!speed.current) return;
      speed.current.textContent = label;
      speed.current.hidden = !label;
    },
  }));

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  // Wide enough for the longest heading, measured in the list's own bold face.
  useEffect(() => {
    const el = box.current;
    const context = document.createElement("canvas").getContext("2d");
    if (!el || !context) return;
    context.font = `600 13px ${getComputedStyle(el).fontFamily}`;
    const longest = Math.max(
      ...heads.map((h) => context.measureText(h.title).width + (h.level === 3 ? 12 : 0)),
    );
    el.style.width = `${Math.ceil(clamp(longest + 70, 140, MAX_WIDTH))}px`;
  }, [heads]);

  return (
    <div
      ref={box}
      aria-hidden
      style={rolodexSurface(opacity)}
      className={cn(
        ROLODEX_FRAME,
        "pointer-events-none fixed right-10 z-30 flex max-w-[calc(100vw-56px)] origin-right scale-95 items-center opacity-0",
        "transition-[opacity,scale] duration-150 ease-out data-open:pointer-events-auto data-open:scale-100 data-open:opacity-100",
      )}
    >
      <div className="relative h-[120px] min-w-0 flex-1 overflow-hidden rounded-[10px] [mask-image:linear-gradient(transparent,var(--ink)_30%,var(--ink)_70%,transparent)] perspective-[400px]">
        <div className="absolute inset-x-[3px] top-1/2 h-6 -translate-y-1/2 rounded-[7px] bg-accent/15" />
        <div className="absolute inset-0 transform-3d" style={{ transform: `translateZ(${-RADIUS}px)` }}>
          {heads.map((h, i) => (
            <button
              key={i}
              ref={(el) => {
                rows.current[i] = el;
              }}
              type="button"
              tabIndex={-1}
              onClick={() => onPick(i)}
              className={cn(
                "group absolute inset-x-0 top-1/2 -mt-3 flex h-6 items-center gap-[7px] pr-2 pl-[11px] text-left text-[13px] whitespace-nowrap text-muted backface-hidden",
                "data-current:font-semibold data-current:text-ink",
                h.level === 3 && "pl-[23px]",
              )}
            >
              <i className="size-1 shrink-0 rounded-full bg-line-strong group-data-current:bg-accent" />
              <span className="truncate">{h.title}</span>
            </button>
          ))}
        </div>
      </div>
      <span ref={count} className="shrink-0 pr-2.5 pl-0.5 text-[11px] text-subtle tabular-nums" />
      <span
        ref={speed}
        hidden
        className="absolute top-full right-0 mt-1 rounded-full bg-accent-soft px-[7px] text-[11px] whitespace-nowrap text-accent"
      />
    </div>
  );
}
