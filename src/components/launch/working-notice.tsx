"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Notice } from "@/components/note/notice";
import type { WorkingJob } from "@/lib/launch/types";

/** Checking this often is cheap (one page refresh), and a harness usually answers within a minute or two. */
const CHECK_EVERY_MS = 15_000;

/** "3 minutes ago", "just now". */
function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return minutes < 1 ? "just now" : minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
}

/**
 * Above the note while a harness works on it (docs/design-decisions.md#d31). The page checks for its
 * proposal every few seconds, so the review banner appears on its own when it arrives; the server stops
 * counting a job as working after an hour, which ends the checking too.
 */
export function WorkingNotice({ working }: { working: WorkingJob[] }) {
  const router = useRouter();
  const active = working.length > 0;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, CHECK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [active, router]);

  return (
    <>
      {working.map((j) => (
        <Notice key={j.jobId}>
          {j.source} is working on this note (sent {ago(j.createdAt)}). Its changes will show up here for
          review.
          {j.mayNeedApproval && (
            <span className="text-muted">
              {" "}
              If nothing arrives, check {j.source}: a coordinator waits for you to approve write&apos;s tools
              there (choose “always” once).
            </span>
          )}
        </Notice>
      ))}
    </>
  );
}
