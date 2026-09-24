"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

const FOLDERS = {
  data: { title: "Can’t open your notes folder", variable: "WRITE_DATA_DIR", volume: "./data" },
  config: { title: "Can’t open write’s config folder", variable: "WRITE_CONFIG_DIR", volume: "./config" },
} as const;

/**
 * Full-screen explanation when the data folder, or the config folder with the account in it, can't be read
 * or written (wrong path, Docker volume owned by another uid, read-only disk). The server message is safe
 * to show and names the folder.
 */
export function StorageUnavailable({
  message,
  folder = "data",
}: {
  message: string;
  folder?: "data" | "config";
}) {
  const { title, variable, volume } = FOLDERS[folder];
  return (
    <main className="flex min-h-dvh items-center justify-center px-[max(1rem,env(safe-area-inset-left))] py-12">
      <div className="w-full max-w-md">
        <TriangleAlert aria-hidden strokeWidth={1.75} className="size-6 text-warning" />
        <h1 className="mt-4 text-[22px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed break-words text-muted">{message}</p>
        <div className="mt-5 rounded-lg border border-line bg-sidebar p-4 text-[14px] leading-relaxed text-muted">
          Check that <code className="font-mono text-[13px] text-ink">{variable}</code> points to a folder
          this server can write to. With Docker, the volume must be writable by uid 1000:{" "}
          <code className="font-mono text-[13px] break-all text-ink">sudo chown -R 1000:1000 {volume}</code>
        </div>
        <Button variant="primary" className="mt-6" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    </main>
  );
}
