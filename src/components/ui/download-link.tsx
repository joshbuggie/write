"use client";

import type React from "react";
import { useFlushActiveNote } from "@/components/shell/shell-context";

type DownloadLinkProps = {
  href: string;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
  title?: string;
};

/**
 * Download anchor that saves the open note first, so the file (or zip) you get includes your latest edits.
 * The server answers with `Content-Disposition: attachment`, so the page stays where it is.
 * Modified clicks (⌘/Ctrl/Shift/Alt) keep the browser's default behavior.
 */
export function DownloadLink({ href, className, children, ...rest }: DownloadLinkProps) {
  const flushActiveNote = useFlushActiveNote();
  return (
    <a
      href={href}
      download
      className={className}
      {...rest}
      onClick={async (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        await flushActiveNote();
        window.location.assign(href);
      }}
    >
      {children}
    </a>
  );
}
