"use client";

import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { useFlushActiveNote } from "@/components/shell/shell-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { MAX_NOTE_BYTES } from "@/lib/constants";
import { downloadFolderHref, LIBRARY_HREF, noteHref } from "@/lib/routes";
import type { NoteRef } from "@/lib/types";
import { importSummary, noteNameFromFileName } from "./import-notes";

/**
 * Everything the folder ⋯ menu does. Each action saves the open note first when it lives in this folder,
 * calls the API, then refreshes the server-rendered tree. If the open note's folder is renamed or deleted,
 * the URL follows (new folder name, or back to the library).
 * `rename` and `remove` reject with ApiError so their dialogs can show the message inline.
 */
export function useFolderActions(folder: string, openRef: NoteRef | null) {
  const router = useRouter();
  const toast = useToast();
  const flushActiveNote = useFlushActiveNote();
  const holdsOpenNote = openRef !== null && openRef.folder === folder;

  async function rename(newName: string): Promise<void> {
    if (holdsOpenNote) await flushActiveNote();
    const { folder: renamed } = await api.renameFolder(folder, newName);
    startTransition(() => {
      if (holdsOpenNote) router.replace(noteHref({ folder: renamed.name, name: openRef.name }));
      router.refresh();
    });
  }

  async function remove(): Promise<void> {
    if (holdsOpenNote) await flushActiveNote();
    await api.deleteFolder(folder);
    startTransition(() => {
      if (holdsOpenNote) router.replace(LIBRARY_HREF);
      router.refresh();
    });
  }

  async function download(): Promise<void> {
    await flushActiveNote();
    window.location.assign(downloadFolderHref(folder));
  }

  /** One file at a time, so the server's " 2", " 3" suffixing stays predictable. */
  async function importFiles(files: File[]): Promise<void> {
    let imported = 0;
    let skipped = 0;
    for (const file of files) {
      if (file.size > MAX_NOTE_BYTES) {
        skipped++;
        continue;
      }
      try {
        const content = await file.text();
        await api.createNote({ folder, name: noteNameFromFileName(file.name), content });
        imported++;
      } catch {
        skipped++;
      }
    }
    toast.show({
      message: importSummary(imported, skipped),
      tone: imported === 0 && skipped > 0 ? "error" : "neutral",
    });
    router.refresh();
  }

  return { rename, remove, download, importFiles };
}
