"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { EditorHandle } from "@/components/editor/note-editor";
import { api, isApiError, saveNoteBodyBytes } from "@/lib/api-client";
import { createAutosaver, type Autosaver, type SaveState } from "@/lib/autosave";
import { UNTITLED } from "@/lib/constants";
import { clearDraft, forgetDrafts, writeDraft } from "@/lib/drafts";
import { noteHref } from "@/lib/routes";
import type { Note, NoteRef } from "@/lib/types";
import { expectHandover, forgetMove, forgetNote, latestKnown, movedTo, recordDiskState } from "./known-notes";
import { createLifecycleHandlers } from "./note-lifecycle";
import { useRevalidation } from "./use-revalidation";

const UNTITLED_NAME = new RegExp(`^${UNTITLED}( \\d+)?$`);

/** "Untitled", "Untitled 2", …: the names "New note" hands out, which we may clean up if left empty. */
export const isUntitledName = (name: string) => UNTITLED_NAME.test(name);

const ignore = () => {};

export type NoteSync = {
  autosaver: Autosaver;
  state: SaveState;
  /** What the editor opens: the props, or this tab's newer save when the props came from the router cache. */
  opened: Note;
  /** The mount-time revalidation found no file (deleted or renamed elsewhere). */
  missing: boolean;
  clearMissing: () => void;
  /** Connect the editor that just mounted; saves read its content from now on. */
  attach: (handle: EditorHandle) => void;
  /** Disconnect before the editor unmounts or remounts; its last text stands in until the next attach. */
  detach: () => void;
  /** The mounted editor, if any (for focus, draft restore, locking). */
  editor: () => EditorHandle | null;
  /** Full file text as it is in the editor right now. */
  getContent: () => string;
  /**
   * Stop saving this note for good (deleted, closed, saved as a copy) and drop its draft. With `gone`
   * (the file was deleted), a pending draft conflict goes too, or it would greet the next note created
   * under this name.
   */
  abandon: (opts?: { gone?: boolean }) => void;
  /** A rename or move is in progress, so leaving must not discard the note under it. */
  setRelocating: (relocating: boolean) => void;
  /**
   * The note now lives at `to`: stop saving under the old name, and hand text typed since the last save
   * to the editor that opens there. With `stay` (the app follows the note there), that editor also gets
   * this one's exact document and, if the body had focus, its caret. The editor stays editable, so
   * nothing typed while the rename lands is lost.
   */
  handOff: (to: NoteRef, stay: boolean) => void;
};

/**
 * Keeps one note in sync with its file (see docs/design-decisions.md#d19, #d20 and #d11). Owns the autosaver
 * and wires it to the browser: ⌘S, tab hidden, page hide, beforeunload, and leaving the note. Also notices
 * when the file changed on disk (refreshed props or the mount-time revalidation) and hands clean notes to
 * `onDiskChange`; dirty ones are left to the next save's 409.
 */
export function useNoteSync(note: Note, onDiskChange: (fresh: Note) => void): NoteSync {
  const router = useRouter();
  const { folder, name } = note;
  // Never base an editing session on props that may be stale; see known-notes.ts.
  const [opened] = useState(() => (typeof window === "undefined" ? note : latestKnown(note)));
  const handleRef = useRef<EditorHandle | null>(null);
  const standInRef = useRef(opened.content);
  const abandonedRef = useRef(false);
  const relocatingRef = useRef(false);
  const handoffRef = useRef<{ to: NoteRef; stay: boolean; focus: boolean } | null>(null);
  const requestedVersionRef = useRef<string | null>(null);
  const teardownRef = useRef<number | undefined>(undefined);
  const [missing, setMissing] = useState(false);

  const [autosaver] = useState(() => {
    const ref = { folder, name };
    return createAutosaver(
      {
        getContent: () => handleRef.current?.getContent() ?? standInRef.current,
        save: (input, { keepalive }) =>
          api.saveNote({ ...ref, ...input }, { keepalive }).then(
            ({ note: saved }) => {
              const state = { content: input.content, version: saved.version, updatedAt: saved.updatedAt };
              recordDiskState(ref, state, "saved");
              return saved;
            },
            (err: unknown) => {
              if (isApiError(err, "version_conflict") && err.body?.current)
                recordDiskState(ref, err.body.current, "fetched");
              throw err;
            },
          ),
        bodyBytes: (input) => saveNoteBodyBytes({ ...ref, ...input }),
        drafts: {
          write: (content, baseVersion) => writeDraft(ref, { content, baseVersion, savedAt: Date.now() }),
          clear: () => clearDraft(ref),
        },
      },
      { baseline: opened.content, version: opened.version },
    );
  });
  const state = useSyncExternalStore(autosaver.subscribe, autosaver.getState, autosaver.getState);

  const actions = useMemo(() => {
    const ref = { folder, name };
    const getContent = () => handleRef.current?.getContent() ?? standInRef.current;
    /**
     * `gone`: no file has this name any more, so nothing parked or known under it (see forgetDrafts and
     * forgetNote) is wanted: the next note created with this name must open clean.
     */
    const stop = (gone: boolean) => {
      abandonedRef.current = true;
      autosaver.dispose();
      if (gone) {
        forgetDrafts(ref);
        forgetNote(ref);
      } else {
        clearDraft(ref);
      }
    };
    /**
     * Unsaved text becomes the renamed note's draft, which its editor restores on open. The draft is
     * Markdown, which can't hold a trailing empty paragraph or space, so the editor's exact state goes
     * along too (see EditorSnapshot). Runs again at unmount, so it includes the very last keystroke.
     */
    const handOverEdits = () => {
      const handoff = handoffRef.current;
      if (!handoff) return;
      const content = autosaver.unsavedContent();
      if (content !== null)
        writeDraft(handoff.to, { content, baseVersion: autosaver.getVersion(), savedAt: Date.now() });
      const handle = handleRef.current;
      if (handoff.stay && handle)
        expectHandover(handoff.to, { snapshot: handle.snapshot(), focus: handoff.focus });
    };
    return {
      getContent,
      handOverEdits,
      editor: () => handleRef.current,
      attach: (handle: EditorHandle) => {
        handleRef.current = handle;
      },
      detach: () => {
        if (handleRef.current) standInRef.current = handleRef.current.getContent();
        handleRef.current = null;
      },
      abandon: ({ gone = false }: { gone?: boolean } = {}) => {
        if (abandonedRef.current) return;
        handleRef.current?.setEditable(false);
        stop(gone);
      },
      handOff: (to: NoteRef, stay: boolean) => {
        if (abandonedRef.current) return;
        stop(true); // the drafts already moved to `to`; the old name is free now
        handoffRef.current = { to, stay, focus: stay && !!handleRef.current?.hasFocus() };
        handOverEdits();
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
    const { onKeyDown, onVisibilityChange, onBeforeUnload, onPageHide, onLeave } = createLifecycleHandlers({
      autosaver,
      isAbandoned: () => abandonedRef.current,
      isRelocating: () => relocatingRef.current,
      isThrowaway: actions.isThrowaway,
      discard: () => {
        clearDraft(ref);
        api.discardIfEmpty(ref).then(({ deleted }) => {
          if (!deleted) return; // the file isn't empty after all: an unresolved draft conflict stays
          forgetDrafts(ref);
          forgetNote(ref);
          refreshTree();
        }, ignore);
      },
    });
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      actions.handOverEdits(); // after a rename: includes what was typed until this very moment
      actions.detach(); // capture the text now, while the editor still exists
      teardownRef.current = window.setTimeout(onLeave, 0);
    };
  }, [actions, autosaver, folder, name]);

  /**
   * A newer state of the file: load it into a clean editor; a dirty one waits for its save's 409.
   * `source` says whether `fresh` came from page props (possibly replayed) or straight from the server.
   */
  function checkDisk(fresh: Note, source: "props" | "fetched") {
    if (fresh.readOnly || abandonedRef.current) return;
    const latest = latestKnown(fresh, source); // a state this tab already saw replaced is stale, not news
    if (autosaver.hasUnsavedChanges()) return;
    const v = latest.version;
    if (v === autosaver.getVersion() || autosaver.isKnownVersion(v) || v === requestedVersionRef.current)
      return;
    requestedVersionRef.current = v;
    onDiskChange(latest);
  }
  const checkProps = useEffectEvent((fresh: Note) => checkDisk(fresh, "props"));

  // Refreshed server props (router.refresh on focus, after mutations) carry the current version.
  useEffect(() => {
    checkProps(note);
  }, [note]);

  useRevalidation(
    { folder, name },
    (fresh) => {
      forgetMove(fresh); // the name exists on disk, whatever this tab renamed away from it earlier
      checkDisk(fresh, "fetched");
    },
    () => {
      const to = movedTo({ folder, name });
      if (to && !abandonedRef.current && !autosaver.hasUnsavedChanges()) {
        actions.abandon({ gone: true }); // a cached page of a note this tab renamed: go where it lives now
        router.replace(noteHref(to));
      } else {
        setMissing(true);
      }
    },
  );

  return {
    autosaver,
    state,
    opened,
    missing,
    clearMissing: () => setMissing(false),
    attach: actions.attach,
    detach: actions.detach,
    editor: actions.editor,
    getContent: actions.getContent,
    abandon: actions.abandon,
    setRelocating: (relocating) => {
      relocatingRef.current = relocating;
    },
    handOff: actions.handOff,
  };
}
