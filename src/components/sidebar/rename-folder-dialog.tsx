"use client";

import { useState } from "react";
import type React from "react";
import { errorMessage } from "@/components/shell/error-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";
import { isApiError } from "@/lib/api-client";
import { validateName } from "@/lib/names";

type RenameFolderDialogProps = {
  open: boolean;
  folder: string;
  onClose: () => void;
  /** Performs the rename; rejects with ApiError (shown inline, dialog stays open). */
  onRename: (newName: string) => Promise<void>;
};

/** "Rename folder" dialog with live name validation and the server's duplicate-name error inline. */
export function RenameFolderDialog({ open, folder, onClose, onRename }: RenameFolderDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Rename folder">
      <RenameForm folder={folder} onClose={onClose} onRename={onRename} />
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so it starts from the current name every time. */
function RenameForm({ folder, onClose, onRename }: Omit<RenameFolderDialogProps, "open">) {
  const [value, setValue] = useState(folder);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const check = validateName(value, "folder");
  const liveError = value.trim() && !check.ok ? check.message : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!check.ok) {
      setSubmitError(check.message);
      return;
    }
    if (check.name === folder) {
      onClose();
      return;
    }
    setPending(true);
    try {
      await onRename(check.name);
      onClose();
    } catch (err) {
      setSubmitError(
        isApiError(err, "name_taken") ? `A folder named "${check.name}" already exists.` : errorMessage(err),
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <TextField
        label="Name"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSubmitError(null);
        }}
        onFocus={(e) => e.currentTarget.select()}
        error={submitError ?? liveError}
        readOnly={pending}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="done"
        spellCheck={false}
      />
      <DialogFooter>
        <Button onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" pending={pending}>
          Rename
        </Button>
      </DialogFooter>
    </form>
  );
}
