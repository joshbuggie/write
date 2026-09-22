"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";

type MoveNoteDialogProps = {
  noteName: string;
  currentFolder: string;
  /** All folder names (sorted by the server). The current one is left out of the choices. */
  folders: string[];
  onClose: () => void;
  /** Performs the move; resolves with an error message to show, or null on success. */
  onMove: (folder: string) => Promise<string | null>;
};

/** Pick a destination folder for the open note ("Move to…" in the ⋯ menu). Mount only while open. */
export function MoveNoteDialog({ noteName, currentFolder, folders, onClose, onMove }: MoveNoteDialogProps) {
  const choices = folders.filter((f) => f !== currentFolder);
  const [target, setTarget] = useState<string | null>(choices[0] ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move() {
    if (!target) return;
    setPending(true);
    const failure = await onMove(target);
    setPending(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Move “${noteName}”`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" pending={pending} disabled={!target} onClick={move}>
            Move
          </Button>
        </>
      }
    >
      {choices.length === 0 ? (
        <p className="text-[14px] text-muted">There are no other folders. Create one in the sidebar first.</p>
      ) : (
        <fieldset className="max-h-[50dvh] overflow-y-auto">
          <legend className="sr-only">Destination folder</legend>
          {choices.map((folder) => (
            <label
              key={folder}
              className={cn(
                "flex h-11 cursor-pointer items-center gap-3 rounded-md px-2 text-[16px] md:h-9 md:text-[14px]",
                target === folder ? "bg-active" : "hover:bg-hover",
              )}
            >
              <input
                type="radio"
                name="move-target"
                value={folder}
                checked={target === folder}
                onChange={() => {
                  setTarget(folder);
                  setError(null);
                }}
                className="size-4 accent-accent"
              />
              <span className="truncate">{folder}</span>
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
