"use client";

import { useEffect, useState, type RefObject } from "react";
import { railStops } from "@/lib/rail/geometry";
import { readHeadings, type RailHeading, type ToPage } from "./rail-headings";

/** Everything the rail draws from, measured together so the marks, thumb and heading list agree. */
export type RailLayout = {
  /** The note's title first, then its headings. */
  heads: RailHeading[];
  /** The scroll position that lands on each of `heads` (see railStops). */
  stops: number[];
  /** How far the scroll area can scroll. */
  max: number;
  /** The scroll area's visible height and its content's full height. */
  visible: number;
  total: number;
  /** Where the rail starts, in viewport pixels: just below the sticky header and toolbar. */
  top: number;
};

/** Room left above a heading the rail lands on, below the sticky header. */
const LANDING_GAP = 16;

/**
 * What scrolls the note: the `<main>` pane from 768 px up, the page itself on phones
 * (docs/design-decisions.md#d25).
 */
export function scrollAreaOf(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** The scroll area's top edge in the viewport; the page's own is the viewport's. */
export const areaTop = (area: HTMLElement) =>
  area === document.scrollingElement ? 0 : area.getBoundingClientRect().top;

/** Where scroll events for `area` arrive: the page's go to window. */
export const scrollTargetOf = (area: HTMLElement): HTMLElement | Window =>
  area === document.scrollingElement ? window : area;

function measure(root: HTMLElement, area: HTMLElement, title: HTMLElement | null): RailLayout {
  const top = areaTop(area);
  const toPage: ToPage = (rect) => ({
    top: rect.top - top + area.scrollTop,
    left: rect.left,
    height: rect.height,
  });
  // The sticky header and toolbar mark themselves; the rail and landings stay clear of them.
  let stuck = top;
  for (const el of document.querySelectorAll("[data-sticky-top]")) {
    stuck = Math.max(stuck, el.getBoundingClientRect().bottom);
  }
  const titleBox = toPage(title?.getBoundingClientRect() ?? root.getBoundingClientRect());
  const titleText = title instanceof HTMLInputElement ? title.value : "";
  const heads = [{ title: titleText || "Untitled", level: 0, ...titleBox }, ...readHeadings(root, toPage)];
  const visible = area === document.scrollingElement ? window.innerHeight : area.clientHeight;
  const max = Math.max(0, area.scrollHeight - visible);
  const stops = railStops(
    heads.map((h) => h.top),
    stuck - top + LANDING_GAP,
    max,
  );
  return { heads, stops, max, visible, total: area.scrollHeight, top: stuck };
}

/** True when nothing the rail draws has moved, so a re-measure doesn't re-render it. */
function sameLayout(a: RailLayout | null, b: RailLayout): boolean {
  if (!a || a.heads.length !== b.heads.length) return false;
  if (a.max !== b.max || a.visible !== b.visible || a.top !== b.top || a.total !== b.total) return false;
  return a.heads.every(
    (h, i) => h.title === b.heads[i].title && h.level === b.heads[i].level && a.stops[i] === b.stops[i],
  );
}

/** How long typing has to pause before the headings are measured again. */
const SETTLE_MS = 250;

/**
 * Measures the note for the rail, and again whenever the text, the window or the note's layout changes
 * (typing pauses, the editor loads, a banner appears). Returns the scroll area with the layout; a resize
 * across 768 px changes the area, and the rail follows it.
 */
export function useRailLayout(
  root: HTMLElement | null,
  titleRef: RefObject<HTMLElement | null>,
): { area: HTMLElement | null; layout: RailLayout | null } {
  const [state, setState] = useState<{ area: HTMLElement | null; layout: RailLayout | null }>({
    area: null,
    layout: null,
  });

  useEffect(() => {
    if (!root) return;
    let timer = 0;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Looked up on every measure: crossing 768 px moves scrolling between the page and <main>.
        const area = scrollAreaOf(root);
        const next = measure(root, area, titleRef.current);
        setState((prev) =>
          prev.area === area && sameLayout(prev.layout, next) ? prev : { area, layout: next },
        );
      });
    };
    const settle = () => {
      clearTimeout(timer);
      timer = window.setTimeout(update, SETTLE_MS);
    };

    update();
    const resize = new ResizeObserver(update);
    resize.observe(root);
    const mutations = new MutationObserver(settle);
    mutations.observe(root, { subtree: true, childList: true, characterData: true });
    root.addEventListener("input", settle); // a textarea's text changes without DOM mutations
    window.addEventListener("resize", update);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      root.removeEventListener("input", settle);
      window.removeEventListener("resize", update);
    };
  }, [root, titleRef]);

  return state;
}
