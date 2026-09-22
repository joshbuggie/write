"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type React from "react";
import { errorMessage } from "@/components/shell/error-message";
import { TextField } from "@/components/ui/text-field";
import { api, isApiError } from "@/lib/api-client";
import { validateName } from "@/lib/names";

/**
 * Inline "New folder" input at the bottom of the sidebar. Enter creates, Esc (or leaving it empty) cancels.
 * Invalid names are explained live; the server's duplicate check is shown after submit.
 */
export function NewFolderForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const check = validateName(name, "folder");
  const liveError = name.trim() && !check.ok ? check.message : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!check.ok) {
      setSubmitError(check.message);
      return;
    }
    setPending(true);
    try {
      await api.createFolder(check.name);
      router.refresh();
      onDone();
    } catch (err) {
      setSubmitError(
        isApiError(err, "name_taken") ? `A folder named "${check.name}" already exists.` : errorMessage(err),
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="p-1">
      <TextField
        autoFocus
        aria-label="New folder name"
        placeholder="Folder name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setSubmitError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
        onBlur={() => {
          if (!name.trim() && !pending) onDone();
        }}
        error={submitError ?? liveError}
        readOnly={pending}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="done"
        spellCheck={false}
        className="h-8! md:text-[13px]! pointer-coarse:h-11!"
      />
    </form>
  );
}
