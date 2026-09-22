"use client";

import { ChevronRight } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { noteHref } from "@/lib/routes";
import type { NoteSummary } from "@/lib/types";

type NoteRowProps = { note: NoteSummary; active: boolean; variant: "panel" | "page" };

/**
 * One note in the sidebar or phone library. The open note is highlighted (with aria-current) and scrolled
 * into view; a small dot pulses while its page is loading.
 */
export function NoteRow({ note, active, variant }: NoteRowProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <li>
      <Link
        ref={ref}
        href={noteHref(note)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex items-center gap-2 rounded-md pr-2 pl-7 text-ink",
          variant === "page" ? "h-11 text-[16px]" : "h-8 text-[14px] pointer-coarse:h-11",
          active
            ? "bg-active font-medium before:absolute before:top-1/2 before:left-3 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-accent"
            : "hover:bg-hover active:bg-active",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{note.name}</span>
        <PendingDot />
        {variant === "page" && <ChevronRight aria-hidden strokeWidth={1.75} className="size-4 text-subtle" />}
      </Link>
    </li>
  );
}

/** Fixed-size, always rendered so the row never shifts; only its opacity changes. */
function PendingDot() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full bg-subtle transition-opacity",
        pending ? "animate-pulse opacity-100" : "opacity-0",
      )}
    />
  );
}
