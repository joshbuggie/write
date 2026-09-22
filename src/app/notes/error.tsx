"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for the notes screens. Never shows the error text: server messages are redacted in
 * production and wouldn't help anyway. `retry` re-fetches the segment from the server.
 */
export default function NotesError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <TriangleAlert aria-hidden strokeWidth={1.75} className="size-6 text-warning" />
      <div>
        <h1 className="text-[18px] font-semibold tracking-tight">Couldn&apos;t load your notes</h1>
        <p className="mt-1 text-[15px] text-muted md:text-[14px]">
          Check that the server is running, then try again.
        </p>
      </div>
      <Button variant="primary" onClick={() => retry()}>
        Retry
      </Button>
    </div>
  );
}
