"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { EditorHandle } from "@/components/editor/note-editor";
import { api, isApiError } from "@/lib/api-client";
import { createAutosaver, type Autosaver, type SaveState } from "@/lib/autosave";
import { UNTITLED } from "@/lib/constants";
import { clearDraft, writeDraft } from "@/lib/drafts";
import type { Note } from "@/lib/types";

const UNTITLED_NAME = new RegExp(`^${UNTITLED}( \\d+)?$`);

/** "Untitled", "Untitled 2", …: the names "New note" hands out, which we may clean up if left empty. */
export const isUntitledName = (name: string) => UNTITLED_NAME.test(name);

const ignore = () => {};

export type NoteSync = {
  autosaver: Autosaver;
  state: SaveState;
  /** The mount-time revalidation found no file (deleted or renamed elsewhere). */
  missing: boolean;
  clearMissing: () => void;
  /** Connect the editor that just mounted; saves read its content from now on. */
  attach: (handle: EditorHandle) => void;
  /** Disconnect before the editor unmounts or remounts; its last text stands in until the next attach. */
  detach: () => void;
  /** The mounted editor, if any (for focus, draft restore, locking during a rename). */
  editor: () => EditorHandle | null;
  /** Full file text as it is in the editor right now. */
  getContent: () => string;
  /** Stop saving this note for good (deleted, renamed, moved, saved as a copy) and drop its draft. */
  abandon: () => void;
};

/**
 * Keeps one note in sync with its file (§8.4, §8.5, §17.1). Owns the autosaver and wires it to the
 * browser: ⌘S, tab hidden, page hide, beforeunload, and leaving the note. Also notices when the file
 * changed on disk (refreshed props or the mount-time revalidation) and hands clean notes to
 * `onDiskChange`; dirty ones are left to the next save's 409.
 */
export function useNoteSync(note: Note, onDiskChange: (fresh: Note) => void): NoteSync {
  const router = useRouter();
  const { folder, name } = note;
  const handleRef = useRef<EditorHandle | null>(null);
  const standInRef = useRef(note.content);
  const abandonedRef = useRef(false);
  const requestedVersionRef = useRef<string | null>(null);
  const teardownRef = useRef<number | undefined>(undefined);
  const [missing, setMissing] = useState(false);

  const [autosaver] = useState(() =>
    createAutosaver(
      {
        getContent: () => handleRef.current?.getContent() ?? standInRef.current,
        save: ({ content, baseVersion, force }, { keepalive }) =>
          api.saveNote({ folder, name, content, baseVersion, force }, { keepalive }).then((r) => r.note),
        drafts: {
          write: (content, baseVersion) =>
            writeDraft({ folder, name }, { content, baseVersion, savedAt: Date.now() }),
          clear: () => clearDraft({ folder, name }),
        },
      },
      { baseline: note.content, version: note.version },
    ),
  );
  const state = useSyncExternalStore(autosaver.subscribe, autosaver.getState, autosaver.getState);

  const actions = useMemo(() => {
    const getContent = () => handleRef.current?.getContent() ?? standInRef.current;
    return {
      getContent,
      editor: () => handleRef.current,
      attach: (handle: EditorHandle) => {
        handleRef.current = handle;
      },
      detach: () => {
        if (handleRef.current) standInRef.current = handleRef.current.getContent();
        handleRef.current = null;
      },
      abandon: () => {
        if (abandonedRef.current) return;
        abandonedRef.current = true;
        handleRef.current?.setEditable(false);
        autosaver.dispose();
        clearDraft({ folder, name });
      },
      /** An empty "Untitled" note was never really written; leaving it should not leave a file behind. */
      isThrowaway: () => isUntitledName(name) && getContent().trim() === "",
    };
  }, [autosaver, folder, name]);

  const refreshTree = useEffectEvent(() => router.refresh());

  // Browser lifecycle. The unmount work is deferred one tick: React Strict Mode (dev) unmounts and
  // immediately remounts every effect, and must not trigger a save or delete an empty new note.
  // All dependencies are stable for the life of the note (the page is keyed by folder/name).
  useEffect(() => {
    const ref = { folder, name };
    window.clearTimeout(teardownRef.current);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (!abandonedRef.current) autosaver.flush().catch(ignore);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && !abandonedRef.current) autosaver.flush().catch(ignore);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (abandonedRef.current || !autosaver.hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = ""; // Safari still needs this to show the prompt
    };
    // The page may be discarded after this; only keepalive requests are sure to go out.
    const onPageHide = () => {
      if (abandonedRef.current) return;
      if (actions.isThrowaway() && !autosaver.hasUnsavedChanges()) {
        clearDraft(ref);
        api.discardIfEmpty(ref, { keepalive: true }).catch(ignore);
      } else {
        autosaver.flushKeepalive();
      }
    };
    // In-app navigation: the page lives on, so besides the keepalive PUT (which survives closing the
    // tab right after) a normal flush can finish edits that were waiting on a save already in flight.
    const onLeave = () => {
      if (abandonedRef.current) return;
      const throwaway = actions.isThrowaway();
      if (!throwaway) autosaver.flushKeepalive();
      const settled = autosaver.hasUnsavedChanges() ? autosaver.flush().catch(ignore) : Promise.resolve();
      settled.finally(() => {
        autosaver.dispose();
        if (!throwaway) return;
        clearDraft(ref);
        api.discardIfEmpty(ref).then(({ deleted }) => deleted && refreshTree(), ignore);
      });
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      actions.detach(); // capture the text now, while the editor still exists
      teardownRef.current = window.setTimeout(onLeave, 0);
    };
  }, [actions, autosaver, folder, name]);

  const checkDisk = useEffectEvent((fresh: Note) => {
    if (fresh.readOnly || abandonedRef.current || autosaver.hasUnsavedChanges()) return;
    const v = fresh.version;
    if (v === autosaver.getVersion() || autosaver.isKnownVersion(v) || v === requestedVersionRef.current)
      return;
    requestedVersionRef.current = v;
    onDiskChange(fresh);
  });

  // Refreshed server props (router.refresh on focus, after mutations) carry the current version.
  useEffect(() => {
    checkDisk(note);
  }, [note]);

  // One revalidation on mount covers back/forward-cache pages and edits made while the tab slept.
  useEffect(() => {
    const controller = new AbortController();
    api.getNote({ folder, name }, { signal: controller.signal }).then(
      ({ note: fresh }) => checkDisk(fresh),
      (err: unknown) => {
        if (isApiError(err, "not_found")) setMissing(true);
      },
    );
    return () => controller.abort();
  }, [folder, name]);

  return {
    autosaver,
    state,
    missing,
    clearMissing: () => setMissing(false),
    attach: actions.attach,
    detach: actions.detach,
    editor: actions.editor,
    getContent: actions.getContent,
    abandon: actions.abandon,
  };
}
