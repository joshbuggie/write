"use client";

import { ChevronLeft, Download, PanelLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useSidebar } from "@/components/shell/shell-context";
import { IconButton } from "@/components/ui/button";
import { DownloadLink } from "@/components/ui/download-link";
import { downloadNoteHref, LIBRARY_HREF } from "@/lib/routes";
import type { NoteRef } from "@/lib/types";

type NoteHeaderProps = {
  noteRef: NoteRef;
  /** SaveStatus, or nothing for read-only notes. */
  status?: ReactNode;
  /** The ⋯ menu. */
  menu?: ReactNode;
};

/**
 * Sticky bar above a note (§10.2). Phone: "‹ Notes" back to the library, since there is no sidebar.
 * Tablet and up: sidebar toggle and a folder / name breadcrumb. Download is one click everywhere.
 */
export function NoteHeader({ noteRef, status, menu }: NoteHeaderProps) {
  const sidebar = useSidebar();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="flex h-11 items-center gap-1 pr-[max(0.25rem,env(safe-area-inset-right))] pl-[max(0.25rem,env(safe-area-inset-left))] md:h-12 md:px-3">
        <Link
          href={LIBRARY_HREF}
          className="flex h-11 shrink-0 items-center gap-0.5 rounded-md pr-2 text-[17px] text-accent md:hidden"
        >
          <ChevronLeft aria-hidden strokeWidth={1.75} className="size-6" />
          Notes
        </Link>
        <div className="hidden md:block">
          <IconButton
            label={sidebar.collapsed ? "Show sidebar" : "Hide sidebar"}
            shortcut="⌘\"
            icon={PanelLeft}
            onClick={sidebar.toggle}
          />
        </div>
        <p className="ml-1 hidden min-w-0 truncate text-[13px] text-muted md:block">
          <span>{noteRef.folder}</span>
          <span aria-hidden className="px-1.5 text-subtle">
            /
          </span>
          <span className="text-ink">{noteRef.name}</span>
        </p>
        <div className="flex-1" />
        {status}
        <DownloadLink
          href={downloadNoteHref(noteRef)}
          aria-label="Download note"
          title="Download .md"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink md:size-8"
        >
          <Download aria-hidden strokeWidth={1.75} className="size-5 md:size-[18px]" />
        </DownloadLink>
        {menu}
      </div>
    </header>
  );
}
