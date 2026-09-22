"use client";

import { Search, SquarePen } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useCreateNote } from "@/components/shell/use-create-note";
import { IconButton } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { nameKey } from "@/lib/names";
import { noteRefFromParams } from "@/lib/routes";
import type { NoteRef, NoteSummary, Tree } from "@/lib/types";
import { FolderSection } from "./folder-section";
import { LibraryBottomBar, SidebarActions } from "./sidebar-footer";

type SidebarProps = {
  tree: Tree;
  authEnabled: boolean;
  /** "panel": the desktop sidebar (md+). "page": the phone library at /notes (44px rows, bottom bar). */
  variant: "panel" | "page";
};

/** The folder/note list with a client-side filter. One component serves the desktop sidebar and the phone library. */
export function Sidebar({ tree, authEnabled, variant }: SidebarProps) {
  const [query, setQuery] = useState("");
  const openRef = useOpenNoteRef();
  const { createNote, pending } = useCreateNote(tree);
  const page = variant === "page";
  const needle = nameKey(query.trim());
  const sections = tree.folders
    .map((folder) => ({ folder, notes: matching(folder.notes, needle) }))
    .filter((s) => !needle || s.notes.length > 0);

  return (
    <div className={cn("flex flex-col", page ? "min-h-dvh" : "min-h-0 flex-1")}>
      {page ? (
        <h1 className="px-[max(1rem,env(safe-area-inset-left))] pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-3 text-[28px] font-bold tracking-tight">
          Notes
        </h1>
      ) : (
        <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
          <span className="text-[15px] font-semibold tracking-tight">write</span>
          <IconButton
            label="New note"
            shortcut="⌘⌥N"
            icon={SquarePen}
            pending={pending}
            onClick={() => createNote()}
          />
        </div>
      )}

      <div
        className={cn("relative shrink-0 pb-2", page ? "px-[max(1rem,env(safe-area-inset-left))]" : "px-3")}
      >
        <Search
          aria-hidden
          strokeWidth={1.75}
          className={cn(
            "pointer-events-none absolute top-[calc(50%-4px)] size-4 -translate-y-1/2 text-subtle",
            page ? "left-[calc(max(1rem,env(safe-area-inset-left))+0.625rem)]" : "left-5.5",
          )}
        />
        <TextField
          type="search"
          aria-label="Filter notes"
          placeholder="Filter notes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className={cn(
            "border-transparent! bg-hover! pl-8! focus-visible:border-accent!",
            page ? "h-10!" : "h-8! md:text-[13px]! pointer-coarse:h-11!",
          )}
        />
      </div>

      <nav
        aria-label="Notes"
        className={cn(
          page
            ? "px-[max(0.5rem,env(safe-area-inset-left))] pb-[calc(env(safe-area-inset-bottom)+5.5rem)]"
            : "min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3",
        )}
      >
        {sections.map(({ folder, notes }) => (
          <FolderSection
            key={folder.name}
            folder={folder}
            visibleNotes={notes}
            openRef={openRef}
            variant={variant}
            forceOpen={needle !== ""}
            onNewNote={() => createNote(folder.name)}
          />
        ))}
        {needle && sections.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-subtle">{`No notes match "${query.trim()}"`}</p>
        )}
        {page && (
          <div className="mt-4 border-t border-line pt-2">
            <SidebarActions variant="page" authEnabled={authEnabled} />
          </div>
        )}
      </nav>

      {page ? (
        <LibraryBottomBar onNewNote={() => createNote()} pending={pending} />
      ) : (
        <SidebarActions variant="panel" authEnabled={authEnabled} />
      )}
    </div>
  );
}

function matching(notes: NoteSummary[], needle: string): NoteSummary[] {
  return needle ? notes.filter((n) => nameKey(n.name).includes(needle)) : notes;
}

/** The note open in the editor, read from the URL (/notes/<folder>/<note>), so it's right on the first render. */
function useOpenNoteRef(): NoteRef | null {
  const parts = usePathname().split("/");
  if (parts.length !== 4 || parts[1] !== "notes") return null;
  return noteRefFromParams({ folder: parts[2], note: parts[3] });
}
