"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-renders the server components (tree + open note) when the tab becomes visible or the window regains
 * focus, at most once per `minIntervalMs`. This is how edits made by other apps (vim, Syncthing, another
 * device) show up without a file watcher.
 */
export function useRefreshOnFocus(minIntervalMs = 5000): void {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < minIntervalMs) return;
      last = now;
      router.refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, minIntervalMs]);
}
