"use client";

import { useCallback } from "react";
import type React from "react";
import { errorMessage } from "@/components/shell/error-message";
import { useFlushActiveNote } from "@/components/shell/shell-context";
import { isApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { flushThenDownload, type DownloadTarget } from "@/lib/download";
import { loginHref } from "@/lib/routes";
import { useToast } from "./toast";

/**
 * Every download in the app (header ⬇, ⋯ menus, "Download all") goes through this: it saves the open note
 * first, so the file or zip includes your latest edits, then downloads without leaving the page. A failure
 * becomes an error toast instead of a raw JSON page. Pass a function to name the open note after a rename
 * in flight lands (see DownloadTarget).
 */
export function useDownload(): (target: DownloadTarget) => Promise<void> {
  const flushActiveNote = useFlushActiveNote();
  const toast = useToast();
  return useCallback(
    async (target: DownloadTarget) => {
      try {
        await flushThenDownload(flushActiveNote, target);
      } catch (err) {
        toast.show({ tone: "error", ...failure(err) });
      }
    },
    [flushActiveNote, toast],
  );
}

function failure(err: unknown): { message: string; action?: { label: string; onClick: () => void } } {
  if (isApiError(err, "not_found")) {
    return { message: "Couldn't download: it was just renamed, moved or deleted. Try again." };
  }
  if (isApiError(err, "unauthorized")) {
    const here = window.location.pathname + window.location.search;
    return {
      message: "Couldn't download: you're signed out.",
      action: { label: "Sign in", onClick: () => window.location.assign(loginHref(here)) },
    };
  }
  return { message: `Couldn't download. ${errorMessage(err)}` };
}

// Callers size the link for a mouse (e.g. the header's `md:size-8`); min-size wins over size, so touch
// screens of any width still get a 44px target without every caller repeating it.
const TOUCH_TARGET = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";

type DownloadLinkProps = {
  /** The link as the browser sees it (modified clicks, "Save link as…", the status bar). */
  href: string;
  /**
   * What a plain click downloads, when it may differ from `href` by the time the open note is saved: the
   * header's link names the note, which a rename in flight is about to move.
   */
  resolveHref?: () => Promise<string>;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
  title?: string;
};

/**
 * Download anchor backed by useDownload. It stays a real link, so modified clicks (⌘/Ctrl/Shift/Alt) and
 * "Save link as…" keep the browser's default behavior.
 */
export function DownloadLink({ href, resolveHref, className, children, ...rest }: DownloadLinkProps) {
  const download = useDownload();
  return (
    <a
      href={href}
      download
      className={cn(TOUCH_TARGET, className)}
      {...rest}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void download(resolveHref ?? href);
      }}
    >
      {children}
    </a>
  );
}
