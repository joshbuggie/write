"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useSettings } from "@/components/settings/settings-provider";
import { cn } from "@/lib/cn";
import { clamp, indexAt, stepFrom, thumbSize } from "@/lib/rail/geometry";
import { createGlider } from "./glider";
import { Rolodex, type RolodexHandle } from "./rolodex";
import { isEditable, useEditingOnTouch } from "./use-editing-on-touch";
import { areaTop, scrollTargetOf, useRailLayout, type RailLayout } from "./use-rail-layout";
import { useRailScrub } from "./use-rail-scrub";

/** Where a landing mark shows, in viewport pixels; `key` restarts its fade for a second landing. */
type Landing = { top: number; left: number; height: number; key: number };

/** The note must scroll by at least this share of a screen for the rail to show; short notes don't need it. */
const MIN_OVERFLOW = 0.5;

type NoteRailProps = {
  /** The note's column: title, banners and whichever editor is mounted. */
  root: HTMLElement | null;
  titleRef: RefObject<HTMLElement | null>;
};

/**
 * The rail at the right edge of a note, in place of the scrollbar (docs/design-decisions.md#d32): a mark
 * per heading, a thumb to drag, and the heading list turning beside it while you scrub. Letting go lands
 * on the nearest heading and marks it; ⌥↑/⌥↓ step between headings when you aren't typing. It only reads
 * the page and scrolls it, so it never touches the note.
 */
export function NoteRail({ root, titleRef }: NoteRailProps) {
  const { settings } = useSettings();
  const { area, layout } = useRailLayout(root, titleRef);
  const editingOnTouch = useEditingOnTouch();
  const [rail, setRail] = useState<HTMLDivElement | null>(null);
  const [track, setTrack] = useState<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<HTMLDivElement | null>(null);
  const [landing, setLanding] = useState<Landing | null>(null);
  const rolodex = useRef<RolodexHandle>(null);
  const layoutRef = useRef<RailLayout | null>(null);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  const glider = useMemo(() => (area ? createGlider(area) : null), [area]);
  useEffect(() => () => glider?.cancel(), [glider]);

  const land = useCallback(
    (index: number, then?: () => void) => {
      const current = layoutRef.current;
      if (!current || !area || !glider) return;
      const i = clamp(Math.round(index), 0, current.heads.length - 1);
      glider.to(current.stops[i], () => {
        const { top, left, height } = current.heads[i];
        if (i > 0)
          setLanding({ top: top - area.scrollTop + areaTop(area), left, height, key: performance.now() });
        then?.();
      });
    },
    [area, glider],
  );

  const shown = layout !== null && layout.max > layout.visible * MIN_OVERFLOW && !editingOnTouch;
  useRailScrub({ rail, track, tip, area, glider, layout: layoutRef, rolodex, land });

  // Thumb, current mark and heading list follow the scroll position, once per frame, outside React.
  useEffect(() => {
    if (!shown || !layout || !area || !track) return;
    const target = scrollTargetOf(area);
    const marks = track.querySelectorAll<HTMLElement>("[data-mark]");
    let frame = 0;
    let current = -1;
    const sync = () => {
      frame = 0;
      const f = indexAt(layout.stops, area.scrollTop);
      track.style.setProperty("--thumb", `${thumbSize(layout.visible, layout.total, track.clientHeight)}px`);
      track.style.setProperty("--pos", String(layout.max ? clamp(area.scrollTop / layout.max, 0, 1) : 0));
      const open = rolodex.current?.isOpen() ?? false;
      if (Math.round(f) !== current) {
        marks[current]?.removeAttribute("data-on");
        current = Math.round(f);
        marks[current]?.setAttribute("data-on", "");
        if (open && "vibrate" in navigator) navigator.vibrate(3); // a tick per heading, where phones allow it
      }
      if (open) rolodex.current?.turn(f);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    sync();
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", onScroll);
    };
  }, [shown, area, track, layout]);

  useEffect(() => {
    if (!shown || !area) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.defaultPrevented) return;
      if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || isEditable(e.target)) return;
      const current = layoutRef.current;
      if (!current || document.querySelector("dialog:modal")) return;
      e.preventDefault();
      const next = stepFrom(indexAt(current.stops, area.scrollTop), e.key === "ArrowDown" ? 1 : -1);
      land(clamp(next, 0, current.heads.length - 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shown, area, land]);

  if (!shown || !layout) return null;
  return (
    <>
      <div
        ref={setRail}
        data-note-rail
        aria-hidden
        style={{ top: layout.top }}
        className="group fixed right-0 bottom-[env(safe-area-inset-bottom)] z-20 w-[34px] cursor-ns-resize touch-none select-none"
      >
        <div ref={setTrack} className="absolute inset-x-0 top-3.5 bottom-3.5 [--thumb:28px]">
          <div className="absolute inset-y-0 right-2.5 w-0.5 rounded-full bg-line" />
          {layout.heads.map((h, i) => (
            <div
              key={i}
              data-mark
              style={{
                top: `calc((100% - var(--thumb)) * ${layout.max ? layout.stops[i] / layout.max : 0} + var(--thumb) / 2)`,
              }}
              className={cn(
                "absolute right-2 -mt-px h-0.5 rounded-full bg-line-strong transition-colors data-on:bg-accent",
                h.level === 3 ? "w-2" : "w-3.5",
              )}
            />
          ))}
          <div
            data-thumb
            style={{ top: "calc((100% - var(--thumb)) * var(--pos, 0))" }}
            className={cn(
              "absolute right-2 h-(--thumb) w-1.5 rounded-full bg-muted opacity-55 transition-[opacity,width,right]",
              "group-hover:right-[7px] group-hover:w-2 group-hover:bg-accent group-hover:opacity-100",
              "group-data-active:right-[7px] group-data-active:w-2 group-data-active:bg-accent group-data-active:opacity-100",
            )}
          />
        </div>
      </div>
      <div
        ref={setTip}
        hidden
        className="pointer-events-none fixed right-9 z-30 max-w-[60vw] -translate-y-1/2 truncate rounded-md bg-ink px-2 py-1 text-[12px] text-canvas"
      />
      <Rolodex
        ref={rolodex}
        heads={layout.heads}
        opacity={settings.appearance.railOpacity}
        minTop={layout.top}
        onPick={(i) => land(i, () => rolodex.current?.hide(300))}
      />
      {landing && (
        <div
          key={landing.key}
          onAnimationEnd={() => setLanding(null)}
          style={{ top: landing.top, left: landing.left - 12, height: landing.height }}
          className="pointer-events-none fixed z-10 w-[3px] animate-rail-landed rounded-full bg-accent"
        />
      )}
    </>
  );
}
