"use client";

import { Ellipsis, type LucideIcon } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

export type MenuItem =
  | { label: string; icon?: LucideIcon; onSelect: () => void; destructive?: boolean; disabled?: boolean }
  | "separator";

type MenuProps = {
  label: string;
  icon?: LucideIcon;
  items: MenuItem[];
  align?: "start" | "end";
  className?: string;
};

const GAP = 4;
const EDGE = 8;

/**
 * Icon button that opens a list of actions (the note and folder ⋯ menus).
 * The list is a manual popover in the browser's top layer, positioned next to the trigger, so it is never
 * clipped by a scrolling sidebar or trapped by a blurred sticky header. Closes on outside click, Esc, Tab,
 * scroll and resize; arrow keys, Home and End move between items.
 */
export function Menu({ label, icon = Ellipsis, items, align = "end", className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Show in the top layer, place next to the trigger (flipping up when there's no room below), focus item 1.
  useLayoutEffect(() => {
    const list = listRef.current;
    const trigger = triggerRef.current;
    if (!open || !list || !trigger) return;
    list.showPopover();
    const t = trigger.getBoundingClientRect();
    const m = list.getBoundingClientRect();
    const left = align === "end" ? t.right - m.width : t.left;
    const below = t.bottom + GAP;
    const top = below + m.height > window.innerHeight - EDGE ? Math.max(EDGE, t.top - GAP - m.height) : below;
    list.style.left = `${Math.min(Math.max(EDGE, left), window.innerWidth - m.width - EDGE)}px`;
    list.style.top = `${top}px`;
    menuItems(list)[0]?.focus({ preventScroll: true });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function closeAndRefocus() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const list = listRef.current;
    if (!list) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // don't also close a surrounding dialog
      closeAndRefocus();
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    const all = menuItems(list);
    const current = all.indexOf(document.activeElement as HTMLButtonElement);
    const targets: Record<string, number> = {
      ArrowDown: (current + 1) % all.length,
      ArrowUp: (current - 1 + all.length) % all.length,
      Home: 0,
      End: all.length - 1,
    };
    const next = targets[e.key];
    if (next === undefined) return;
    e.preventDefault();
    all[next]?.focus();
  }

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <IconButton
        ref={triggerRef}
        label={label}
        icon={icon}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          ref={listRef}
          id={menuId}
          popover="manual"
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="fixed inset-auto m-0 min-w-48 rounded-lg border border-line bg-surface p-1 text-ink shadow-pop"
        >
          {items.map((item, i) =>
            item === "separator" ? (
              <div key={`sep-${i}`} role="separator" className="-mx-1 my-1 border-t border-line" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                onClick={() => {
                  closeAndRefocus();
                  item.onSelect(); // synchronous, so a file picker opened here keeps the user gesture
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[14px] whitespace-nowrap",
                  "hover:bg-hover focus:bg-hover focus:outline-none disabled:opacity-40",
                  "pointer-coarse:h-11 pointer-coarse:text-[16px]",
                  item.destructive ? "text-danger" : "text-ink",
                )}
              >
                {item.icon && (
                  <item.icon
                    aria-hidden
                    strokeWidth={1.75}
                    className={cn("size-4 shrink-0", !item.destructive && "text-muted")}
                  />
                )}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Enabled items in DOM order, for keyboard navigation. */
function menuItems(list: HTMLElement): HTMLButtonElement[] {
  return Array.from(list.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
}
