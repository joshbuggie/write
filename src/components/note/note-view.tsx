"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { EditorSkeleton, TEXT_COLUMN } from "@/components/editor/editor-skeleton";
import type { EditorRequest } from "@/components/editor/note-editor";
import { useRegisterActiveNote } from "@/components/shell/shell-context";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useDownload } from "@/components/ui/download-link";
import { useToast } from "@/components/ui/toast";
import { api, isApiError } from "@/lib/api-client";
import { moveDraft } from "@/lib/drafts";
import { downloadNoteHref, LIBRARY_HREF, noteHref } from "@/lib/routes";
import type { Note, NoteRef } from "@/lib/types";
import { CONFLICT_BANNER_ID, ConflictBanner } from "./conflict-banner";
import { isSavedHere, recordMove } from "./known-notes";
import { MoveNoteDialog } from "./move-note-dialog";
import { NoteHeader } from "./note-header";
import { watchForLeaving } from "./note-lifecycle";
import { NoteMenu } from "./note-menu";
import { Notice, SourceModeNotice } from "./notice";
import { ReadOnlyNote } from "./read-only-note";
import { SaveStatus } from "./save-status";
import { TitleInput } from "./title-input";
import { useEditorSession } from "./use-editor-session";

// Tiptap is a big chunk; load it only on the client and only on the note screen.
const NoteEditor = dynamic(() => import("@/components/editor/note-editor"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/**
 * The note screen: read-only notes get a preview, everything else the editor. The page is keyed by the
 * note's folder and name; `mount` also remounts the editor when a new file takes this same name from this
 * screen ("Save as new note" after the note was deleted), so it opens as a live editor on that file.
 */
export function NoteView({ note, folders }: { note: Note; folders: string[] }) {
  const [mount, setMount] = useState(0);
  if (note.readOnly) return <ReadOnlyNote note={{ ...note, readOnly: note.readOnly }} />;
  return <EditableNote key={mount} note={note} folders={folders} onReopen={() => setMount((n) => n + 1)} />;
}

/**
 * Orchestrates one open note: header, banners, title and editor, plus every file-level action
 * (rename, move, delete, conflicts, mode switch). Saving itself lives in useNoteSync.
 */
function EditableNote(props: { note: Note; folders: string[]; onReopen: () => void }) {
  const { note, folders, onReopen } = props;
  const router = useRouter();
  const toast = useToast();
  const ref: NoteRef = { folder: note.folder, name: note.name };
  const titleRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<"move" | "delete" | "edit-visually" | null>(null);

  const session = useEditorSession(note, titleRef, (fresh) => {
    // A late save of this tab's own (e.g. the keepalive from the last visit) is not news from elsewhere.
    if (!isSavedHere(ref, fresh.version)) toast.show({ message: "Updated from disk" });
  });
  const { sync, source, mode, sourceReason } = session;
  const { autosaver, state } = sync;
  // A rename or move started by blurring the title may still be in flight when a download or a folder
  // action asks for a flush; waiting for it keeps that action from using the old name mid-rename. It
  // resolves with where the note lives afterwards (the old ref if it failed).
  const pendingRelocate = useRef<Promise<NoteRef> | null>(null);
  useRegisterActiveNote(ref, async () => {
    await pendingRelocate.current;
    await autosaver.flush();
  });
  const startDownload = useDownload();
  /** This note's download URL once any rename or move in flight has landed (see DownloadTarget). */
  const downloadHref = async () => downloadNoteHref((await pendingRelocate.current) ?? ref);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Save, then reload the editor in the other mode from what is now on disk. */
  async function switchMode(request: EditorRequest) {
    try {
      await autosaver.flush();
    } catch {
      toast.show({ message: "Couldn't save your changes, so the editor wasn't switched.", tone: "error" });
      return;
    }
    // Nothing saved since this editor opened → show the file as it is, not our normalized version.
    const onDisk = autosaver.getVersion() === source.version ? source.content : sync.getContent();
    session.reloadEditor(onDisk, autosaver.getVersion(), request);
  }

  function toggleMode() {
    if (mode === "visual") void switchMode("source");
    else if (sourceReason?.kind === "lossy") setDialog("edit-visually");
    else void switchMode("auto");
  }

  /**
   * Saves pending edits, runs a file operation, and follows the note to where it now lives, unless the
   * user has already headed elsewhere (clicking a link blurs the title, which is what started a rename).
   * The editor stays editable throughout; text typed meanwhile is handed to the note's new name.
   */
  async function relocate(to: NoteRef, request: () => Promise<unknown>): Promise<string | null> {
    const leaving = watchForLeaving();
    sync.setRelocating(true);
    try {
      await autosaver.flush();
      await request();
    } catch (err) {
      sync.setRelocating(false);
      if (isApiError(err, "name_taken")) return `A note named "${to.name}" already exists in ${to.folder}.`;
      return messageOf(err);
    } finally {
      leaving.stop();
    }
    const stay = mountedRef.current && !leaving.hasLeft();
    moveDraft(ref, to);
    recordMove(ref, to);
    sync.handOff(to, stay);
    startTransition(() => {
      if (stay) router.replace(noteHref(to));
      router.refresh(); // the sidebar shows the new name either way
    });
    return null;
  }

  /** Runs a relocate and remembers it as the one in flight; resolves with an error message or null. */
  function track(to: NoteRef, request: () => Promise<unknown>): Promise<string | null> {
    const pending = relocate(to, request);
    pendingRelocate.current = pending.then((failure) => (failure ? ref : to));
    return pending;
  }
  const rename = (newName: string) =>
    track({ folder: note.folder, name: newName }, () =>
      api.updateNote({ folder: note.folder, name: note.name, newName }),
    );
  const move = (newFolder: string) =>
    track({ folder: newFolder, name: note.name }, () =>
      api.updateNote({ folder: note.folder, name: note.name, newFolder }),
    );

  /** Throws on failure, so the confirm dialog stays open and shows the message. */
  async function deleteNote() {
    await autosaver.flush().catch(() => {}); // the trashed copy should include the latest edits
    try {
      await api.deleteNote(ref);
    } catch (err) {
      if (!isApiError(err, "not_found")) throw err; // already gone is as good as deleted
    }
    sync.abandon({ gone: true });
    startTransition(() => {
      router.replace(LIBRARY_HREF);
      router.refresh();
    });
  }

  /** "Rename" in the ⋯ menu: the title is the file name, so renaming is editing it. */
  function focusTitle() {
    titleRef.current?.focus();
    titleRef.current?.select();
  }

  function showConflict() {
    const banner = document.getElementById(CONFLICT_BANNER_ID);
    banner?.scrollIntoView({ block: "center", behavior: "smooth" });
    banner?.focus({ preventScroll: true });
  }

  return (
    <>
      <NoteHeader
        noteRef={ref}
        resolveDownloadHref={downloadHref}
        status={<SaveStatus state={state} onRetry={() => autosaver.retry()} onShowConflict={showConflict} />}
        menu={
          <NoteMenu
            mode={mode}
            canEditVisually={sourceReason?.kind !== "large"}
            onRename={focusTitle}
            onMove={() => setDialog("move")}
            onDownload={() => void startDownload(downloadHref)}
            onToggleMode={toggleMode}
            onDelete={() => setDialog("delete")}
          />
        }
      />
      <div ref={setToolbarSlot} className="sticky top-12 z-10 hidden md:block" />
      <article className={TEXT_COLUMN}>
        <ConflictBanner
          note={note}
          sync={sync}
          draft={session.draftConflict}
          onKeepDraft={session.keepDraft}
          onDraftResolved={session.dismissDraftConflict}
          onReload={session.reloadEditor}
          onReopen={onReopen}
        />
        {sourceReason && (
          <SourceModeNotice reason={sourceReason} onEditVisually={() => setDialog("edit-visually")} />
        )}
        {session.restored && (
          <Notice onDismiss={session.dismissRestored}>Restored unsaved changes from this device.</Notice>
        )}
        <TitleInput
          name={note.name}
          inputRef={titleRef}
          onRename={rename}
          onFocusBody={() => sync.editor()?.focus("start")}
        />
        <NoteEditor
          key={source.key}
          content={source.content}
          request={source.request}
          toolbarSlot={toolbarSlot}
          onReady={session.handleReady}
          onChange={() => autosaver.markDirty()}
        />
      </article>

      {dialog === "move" && (
        <MoveNoteDialog
          noteName={note.name}
          currentFolder={note.folder}
          folders={folders}
          onClose={() => setDialog(null)}
          onMove={move}
        />
      )}
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={deleteNote}
        title={`Delete “${note.name}”?`}
        description="It moves to .trash in your data folder."
        confirmLabel="Delete"
        destructive
      />
      <ConfirmDialog
        open={dialog === "edit-visually"}
        onClose={() => setDialog(null)}
        onConfirm={() => switchMode("visual")}
        title="Edit visually?"
        description="Some formatting (HTML, footnotes…) will be removed from this file when you edit it visually."
        confirmLabel="Edit visually"
      />
    </>
  );
}
