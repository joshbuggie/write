"use client";

import { useEffect, type RefObject } from "react";
import { clamp, indexAt, stepFrom } from "@/lib/rail/geometry";
import type { Glider } from "./glider";
import type { RolodexHandle } from "./rolodex";
import type { RailLayout } from "./use-rail-layout";

type ScrubParts = {
  rail: HTMLElement | null;
  track: HTMLElement | null;
  tip: HTMLElement | null;
  area: HTMLElement | null;
  glider: Glider | null;
  layout: RefObject<RailLayout | null>;
  rolodex: RefObject<RolodexHandle | null>;
  /** Lands on heading `index` (rounded), then calls `then`. */
  land: (index: number, then?: () => void) => void;
};

/** Pixels the pointer must travel left of the rail before scrubbing slows to each step. */
const SLOWER = [
  { from: 200, factor: 0.1, label: "Fine" },
  { from: 120, factor: 0.25, label: "¼ speed" },
  { from: 50, factor: 0.5, label: "½ speed" },
];
/** Wheel travel that counts as one step between headings. */
const WHEEL_STEP = 40;

/**
 * Dragging the rail (docs/design-decisions.md#d32). Pressing it jumps there, unless the press is on the
 * thumb; dragging scrubs, slower the further the pointer moves left of the rail, as when scrubbing video
 * on iOS; letting go lands on the nearest heading. With a mouse, hovering names the heading under the
 * pointer and the wheel steps one heading at a time. Native listeners, because the wheel handler has to
 * call preventDefault.
 */
export function useRailScrub({ rail, track, tip, area, glider, layout, rolodex, land }: ScrubParts) {
  useEffect(() => {
    if (!rail || !track || !tip || !area || !glider) return;
    const thumbSize = () => parseFloat(track.style.getPropertyValue("--thumb")) || 28;
    /** The scroll position the rail maps viewport y to, with the thumb centred on it. */
    const scrollFor = (clientY: number) => {
      const span = Math.max(1, track.clientHeight - thumbSize());
      const y = clientY - track.getBoundingClientRect().top - thumbSize() / 2;
      return clamp(y / span, 0, 1) * (layout.current?.max ?? 0);
    };
    let scrub: { y: number; s: number; touch: boolean } | null = null;
    let wheel = 0;
    /** The heading a wheel step is already heading for, so quick steps don't count from mid-flight. */
    let aimed: number | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      rail.setPointerCapture(e.pointerId);
      glider.cancel();
      const thumb = track.querySelector("[data-thumb]")?.getBoundingClientRect();
      const onThumb = thumb && e.clientY >= thumb.top - 6 && e.clientY <= thumb.bottom + 6;
      scrub = {
        y: e.clientY,
        s: onThumb ? area.scrollTop : scrollFor(e.clientY),
        touch: e.pointerType !== "mouse",
      };
      area.scrollTop = scrub.s;
      rail.toggleAttribute("data-active", true);
      tip.hidden = true;
      rolodex.current?.setSpeed("");
      rolodex.current?.show(e.clientY, scrub.touch);
      rolodex.current?.turn(indexAt(layout.current?.stops ?? [0], area.scrollTop));
    };

    const onMove = (e: PointerEvent) => {
      const current = layout.current;
      if (!current) return;
      if (!scrub) {
        if (e.pointerType !== "mouse") return;
        tip.textContent =
          current.heads[Math.round(indexAt(current.stops, scrollFor(e.clientY)))]?.title ?? "";
        tip.style.top = `${e.clientY}px`;
        tip.hidden = false;
        return;
      }
      const away = rail.getBoundingClientRect().left - e.clientX;
      const slower = SLOWER.find((s) => away >= s.from);
      rolodex.current?.setSpeed(slower?.label ?? "");
      const span = Math.max(1, track.clientHeight - thumbSize());
      const perPixel = (current.max / span) * (slower?.factor ?? 1);
      scrub.s = clamp(scrub.s + (e.clientY - scrub.y) * perPixel, 0, current.max);
      scrub.y = e.clientY;
      area.scrollTop = scrub.s;
      rolodex.current?.show(e.clientY, scrub.touch);
    };

    const onUp = () => {
      if (!scrub) return;
      scrub = null;
      rail.toggleAttribute("data-active", false);
      rolodex.current?.setSpeed("");
      const stops = layout.current?.stops ?? [0];
      land(indexAt(stops, area.scrollTop), () => rolodex.current?.hide(450));
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation(); // the glider treats a wheel reaching window as the reader taking over
      wheel += e.deltaY;
      if (Math.abs(wheel) < WHEEL_STEP) return;
      const stops = layout.current?.stops ?? [0];
      const target = clamp(
        stepFrom(aimed ?? indexAt(stops, area.scrollTop), wheel > 0 ? 1 : -1),
        0,
        stops.length - 1,
      );
      wheel = 0;
      aimed = target;
      tip.hidden = true;
      rolodex.current?.show(e.clientY, false);
      rolodex.current?.turn(indexAt(stops, area.scrollTop));
      land(target, () => {
        aimed = null;
        rolodex.current?.hide(700);
      });
    };

    const onLeave = () => {
      tip.hidden = true;
      aimed = null;
    };

    rail.addEventListener("pointerdown", onDown);
    rail.addEventListener("pointermove", onMove);
    rail.addEventListener("pointerup", onUp);
    rail.addEventListener("pointercancel", onUp);
    rail.addEventListener("pointerleave", onLeave);
    rail.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      rail.removeEventListener("pointerdown", onDown);
      rail.removeEventListener("pointermove", onMove);
      rail.removeEventListener("pointerup", onUp);
      rail.removeEventListener("pointercancel", onUp);
      rail.removeEventListener("pointerleave", onLeave);
      rail.removeEventListener("wheel", onWheel);
    };
  }, [rail, track, tip, area, glider, layout, rolodex, land]);
}
