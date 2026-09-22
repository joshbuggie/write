"use client";

import { PanelLeft, SquarePen } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import type { Tree } from "@/lib/types";
import { useSidebar } from "./shell-context";
import { useCreateNote } from "./use-create-note";

/**
 * What /notes shows next to the sidebar on tablets and larger (phones get the library instead).
 * When the sidebar is collapsed it also offers the toggle, since there's no note header to hold it.
 */
export function EmptyState({ tree }: { tree: Tree }) {
  const { collapsed, toggle } = useSidebar();
  const { createNote, pending } = useCreateNote(tree);
  return (
    <div className="flex h-full min-h-dvh flex-col md:min-h-0">
      <div className="flex h-12 shrink-0 items-center px-3">
        {collapsed && <IconButton label="Show sidebar" shortcut="⌘\" icon={PanelLeft} onClick={toggle} />}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-24 text-center">
        <p className="text-[15px] text-muted">Select a note or start a new one</p>
        <Button variant="primary" pending={pending} onClick={() => createNote()} title="New note ⌘⌥N">
          {!pending && <SquarePen aria-hidden strokeWidth={1.75} className="size-4" />}
          New note
        </Button>
      </div>
    </div>
  );
}
