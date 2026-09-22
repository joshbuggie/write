"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { DEFAULT_FOLDER } from "@/lib/constants";
import { nameKey } from "@/lib/names";
import { noteHref } from "@/lib/routes";
import type { Tree } from "@/lib/types";
import { errorMessage } from "./error-message";
import { useActiveNote } from "./shell-context";

/** Where "New note" goes when no folder is given: the open note's folder, else "notebook", else the first. */
export function defaultNoteFolder(tree: Tree, activeFolder: string | undefined): string {
  if (activeFolder) return activeFolder;
  const notebook = tree.folders.find((f) => nameKey(f.name) === nameKey(DEFAULT_FOLDER));
  return notebook?.name ?? tree.folders[0]?.name ?? DEFAULT_FOLDER;
}

/**
 * "New note" everywhere (sidebar, folder +, phone bottom bar, empty state, ⌘⌥N): create an Untitled note on
 * the server, then open it. `pending` stays true until the navigation has rendered.
 */
export function useCreateNote(tree: Tree): { createNote: (folder?: string) => void; pending: boolean } {
  const router = useRouter();
  const toast = useToast();
  const active = useActiveNote();
  const [pending, startTransition] = useTransition();
  const activeFolder = active?.ref.folder;

  const createNote = useCallback(
    (folder?: string) => {
      if (pending) return; // e.g. ⌘⌥N held down
      startTransition(async () => {
        try {
          const { note } = await api.createNote({ folder: folder ?? defaultNoteFolder(tree, activeFolder) });
          startTransition(() => {
            router.push(noteHref(note));
            router.refresh();
          });
        } catch (err) {
          toast.show({ message: errorMessage(err), tone: "error" });
        }
      });
    },
    [pending, tree, activeFolder, router, toast],
  );

  return { createNote, pending };
}
