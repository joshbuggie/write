"use client";

import { ChevronRight, Download, FileUp, Pencil, Plus, SquarePen, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import type { FolderSummary, NoteRef, NoteSummary } from "@/lib/types";
import { IMPORT_ACCEPT } from "./import-notes";
import { NoteRow } from "./note-row";
import { RenameFolderDialog } from "./rename-folder-dialog";
import { useFolderActions } from "./use-folder-actions";

type FolderSectionProps = {
  folder: FolderSummary;
  /** The notes to list: all of them, or the filter matches. */
  visibleNotes: NoteSummary[];
  /** The note open in the editor (from the URL), to highlight its row and follow folder renames. */
  openRef: NoteRef | null;
  variant: "panel" | "page";
  /** While filtering, sections are always expanded. */
  forceOpen: boolean;
  onNewNote: () => void;
};

/** A collapsible folder: header with count, "+" and a ⋯ menu (rename, import, download, delete), then its notes. */
export function FolderSection({
  folder,
  visibleNotes,
  openRef,
  variant,
  forceOpen,
  onNewNote,
}: FolderSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const listId = useId();
  const actions = useFolderActions(folder.name, openRef);
  const open = forceOpen || expanded;
  const page = variant === "page";
  const count = folder.notes.length;

  const menuItems: MenuItem[] = [
    { label: "New note", icon: SquarePen, onSelect: onNewNote },
    { label: "Rename…", icon: Pencil, onSelect: () => setDialog("rename") },
    { label: "Import .md files…", icon: FileUp, onSelect: () => fileInput.current?.click() },
    { label: "Download folder (.zip)", icon: Download, onSelect: () => void actions.download() },
    "separator",
    { label: "Delete folder…", icon: Trash2, destructive: true, onSelect: () => setDialog("delete") },
  ];

  return (
    <section aria-label={folder.name} className="mt-2 first:mt-0">
      <div className={cn("group flex items-center gap-0.5 pr-1", page ? "h-11" : "h-8 pointer-coarse:h-11")}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          disabled={forceOpen}
          onClick={() => setExpanded((e) => !e)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2 text-left text-muted hover:text-ink disabled:cursor-default"
        >
          <ChevronRight
            aria-hidden
            strokeWidth={2}
            className={cn("size-3.5 shrink-0 text-subtle transition-transform", open && "rotate-90")}
          />
          <span className={cn("truncate font-medium", page ? "text-[15px]" : "text-[13px]")}>
            {folder.name}
          </span>
          <span className="shrink-0 text-[12px] text-subtle tabular-nums">{count}</span>
        </button>
        <div className="flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          <IconButton label={`New note in ${folder.name}`} icon={Plus} onClick={onNewNote} />
          <Menu label={`${folder.name} folder actions`} items={menuItems} />
        </div>
      </div>

      <div id={listId} hidden={!open}>
        {visibleNotes.length > 0 ? (
          <ul role="list" className="flex flex-col gap-px">
            {visibleNotes.map((note) => (
              <NoteRow key={note.name} note={note} active={isOpen(note, openRef)} variant={variant} />
            ))}
          </ul>
        ) : (
          <div className="pb-1 pl-7">
            <p className="py-1 text-[13px] text-subtle">No notes yet</p>
            <button
              type="button"
              onClick={onNewNote}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 text-muted hover:bg-hover hover:text-ink",
                page ? "h-11 text-[16px]" : "h-8 text-[14px] pointer-coarse:h-11",
              )}
            >
              <Plus aria-hidden strokeWidth={1.75} className="size-4" />
              New note
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ""; // so choosing the same file again fires change
          if (files.length > 0) void actions.importFiles(files);
        }}
      />
      <RenameFolderDialog
        open={dialog === "rename"}
        folder={folder.name}
        onClose={() => setDialog(null)}
        onRename={actions.rename}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={actions.remove}
        title={`Delete "${folder.name}"?`}
        description={deleteDescription(count)}
        confirmLabel="Delete folder"
        destructive
      />
    </section>
  );
}

function isOpen(note: NoteRef, openRef: NoteRef | null): boolean {
  if (!openRef) return false;
  return (
    note.folder.normalize("NFC") === openRef.folder.normalize("NFC") &&
    note.name.normalize("NFC") === openRef.name.normalize("NFC")
  );
}

function deleteDescription(count: number): string {
  if (count === 0) return "The empty folder moves to .trash in your data folder.";
  return `Its ${count} ${count === 1 ? "note moves" : "notes move"} to .trash in your data folder.`;
}
