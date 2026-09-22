"use client";

import { useEffect, useEffectEvent } from "react";
import { api, isApiError } from "@/lib/api-client";
import type { Note, NoteRef } from "@/lib/types";

/** A revalidation that failed for a reason that may pass (network, busy server) is tried again. */
const RETRY_MS = [2000, 5000, 15000];
const TRANSIENT = ["network", "internal", "storage_unavailable"] as const;

/**
 * Fetches the note on mount (edits made while the tab slept, a page replayed from the router cache) and
 * when the page comes back from the back/forward cache, which restores it frozen instead of remounting it.
 * A failure that may pass is retried: until a fetch succeeds, a stale page is only caught by a 409.
 */
export function useRevalidation(ref: NoteRef, onFresh: (fresh: Note) => void, onMissing: () => void) {
  const fresh = useEffectEvent((note: Note) => onFresh(note));
  const missing = useEffectEvent(() => onMissing());
  const { folder, name } = ref;

  useEffect(() => {
    const controller = new AbortController();
    let retry: number | undefined;
    const revalidate = (attempt = 0) => {
      window.clearTimeout(retry);
      api.getNote({ folder, name }, { signal: controller.signal }).then(
        ({ note }) => fresh(note),
        (err: unknown) => {
          if (controller.signal.aborted) return;
          if (isApiError(err, "not_found")) return missing();
          if (TRANSIENT.some((code) => isApiError(err, code)) && attempt < RETRY_MS.length)
            retry = window.setTimeout(() => revalidate(attempt + 1), RETRY_MS[attempt]);
        },
      );
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) revalidate();
    };
    revalidate();
    window.addEventListener("pageshow", onPageShow);
    return () => {
      controller.abort();
      window.clearTimeout(retry);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [folder, name]);
}
