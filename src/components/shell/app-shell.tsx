"use client";

import { useEffect } from "react";
import type React from "react";
import { Sidebar } from "@/components/sidebar/sidebar";
import { cn } from "@/lib/cn";
import type { Tree } from "@/lib/types";
import { useSidebar } from "./shell-context";
import { useCreateNote } from "./use-create-note";
import { useRefreshOnFocus } from "./use-refresh-on-focus";

type AppShellProps = { tree: Tree; authEnabled: boolean; children: React.ReactNode };

/**
 * Frame around every /notes screen.
 * - Phones (<md): one column with document scroll; the library is its own page, so no sidebar here.
 * - md and up: a collapsible sidebar and the main column, each scrolling on its own.
 * Also owns the global shortcuts ⌘\ (toggle sidebar) and ⌘⌥N (new note), and refreshes server data on focus.
 */
export function AppShell({ tree, authEnabled, children }: AppShellProps) {
  const { collapsed, toggle } = useSidebar();
  const { createNote } = useCreateNote(tree);
  useRefreshOnFocus();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.defaultPrevented) return;
      if (!e.altKey && (e.key === "\\" || e.code === "Backslash")) {
        e.preventDefault();
        toggle();
      } else if (e.altKey && e.code === "KeyN") {
        e.preventDefault(); // with ⌥ held, e.key is a symbol on macOS, so match the physical key
        createNote();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle, createNote]);

  return (
    <div className="md:flex md:h-dvh md:overflow-hidden">
      <aside
        className={cn(
          "shrink-0 flex-col border-r border-line bg-sidebar md:w-64 lg:w-[272px] xl:w-72",
          collapsed ? "hidden" : "hidden md:flex",
        )}
      >
        <Sidebar variant="panel" tree={tree} authEnabled={authEnabled} />
      </aside>
      <main className="min-w-0 flex-1 md:overflow-y-auto md:overscroll-contain">{children}</main>
    </div>
  );
}
