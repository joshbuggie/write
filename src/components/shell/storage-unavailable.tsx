"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Full-screen explanation when the data folder can't be read or written (wrong path, Docker volume owned
 * by another uid, read-only disk). The server message is safe to show and names the folder.
 */
export function StorageUnavailable({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-[max(1rem,env(safe-area-inset-left))] py-12">
      <div className="w-full max-w-md">
        <TriangleAlert aria-hidden strokeWidth={1.75} className="size-6 text-warning" />
        <h1 className="mt-4 text-[22px] font-semibold tracking-tight">Can&apos;t open your notes folder</h1>
        <p className="mt-2 text-[15px] leading-relaxed break-words text-muted">{message}</p>
        <div className="mt-5 rounded-lg border border-line bg-sidebar p-4 text-[14px] leading-relaxed text-muted">
          Check that <code className="font-mono text-[13px] text-ink">WRITE_DATA_DIR</code> points to a folder
          this server can write to. With Docker, the volume must be writable by uid 1000:{" "}
          <code className="font-mono text-[13px] break-all text-ink">sudo chown -R 1000:1000 ./data</code>
        </div>
        <Button variant="primary" className="mt-6" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </main>
  );
}
