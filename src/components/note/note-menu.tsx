"use client";

import { Download, FileCode, FolderInput, Pencil, Pilcrow, Send, Trash2 } from "lucide-react";
import { Menu, type MenuItem } from "@/components/ui/menu";

type NoteMenuProps = {
  /** Editing mode currently shown; null while the editor chunk is still loading or for read-only notes. */
  mode: "visual" | "source" | null;
  /** False for notes too large for the visual editor. */
  canEditVisually: boolean;
  onRename?: () => void;
  onMove: () => void;
  onDownload: () => void;
  onToggleMode?: () => void;
  /** "Send to…" a harness (docs/design-decisions.md#d31); absent when no integration can take this note. */
  onSend?: () => void;
  onDelete: () => void;
};

/** The note's ⋯ menu in the header: everything you can do to the note as a file. */
export function NoteMenu({
  mode,
  canEditVisually,
  onRename,
  onMove,
  onDownload,
  onToggleMode,
  onSend,
  onDelete,
}: NoteMenuProps) {
  const items: MenuItem[] = [];
  if (onRename) items.push({ label: "Rename", icon: Pencil, onSelect: onRename });
  items.push({ label: "Move to…", icon: FolderInput, onSelect: onMove });
  items.push({ label: "Download (.md)", icon: Download, onSelect: onDownload });
  if (onToggleMode && mode === "visual") {
    items.push({ label: "Edit as Markdown", icon: FileCode, onSelect: onToggleMode });
  } else if (onToggleMode && mode === "source") {
    items.push({ label: "Edit visually", icon: Pilcrow, onSelect: onToggleMode, disabled: !canEditVisually });
  }
  if (onSend) items.push("separator", { label: "Send to…", icon: Send, onSelect: onSend });
  items.push("separator", { label: "Delete", icon: Trash2, onSelect: onDelete, destructive: true });

  return <Menu label="Note actions" items={items} align="end" />;
}
