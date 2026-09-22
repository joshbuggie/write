"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { startTransition, useRef, useState } from "react";
import { EditorSkeleton, TEXT_COLUMN } from "@/components/editor/editor-skeleton";
import type { EditorReady, EditorRequest, SourceReason } from "@/components/editor/note-editor";
import { useRegisterActiveNote } from "@/components/shell/shell-context";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, isApiError } from "@/lib/api-client";
import { clearDraft, moveDraft, readDraft, writeDraft, type Draft } from "@/lib/drafts";
import { splitFrontmatter } from "@/lib/markdown/file-format";
import { downloadNoteHref, LIBRARY_HREF, noteHref } from "@/lib/routes";
import type { Note, NoteRef } from "@/lib/types";
import { CONFLICT_BANNER_ID, ConflictBanner } from "./conflict-banner";
import { MoveNoteDialog } from "./move-note-dialog";
import { NoteHeader } from "./note-header";
import { NoteMenu } from "./note-menu";
import { Notice, SourceModeNotice } from "./notice";
import { ReadOnlyNote } from "./read-only-note";
import { SaveStatus } from "./save-status";
import { TitleInput } from "./title-input";
import { isUntitledName, useNoteSync } from "./use-note-sync";

// Tiptap is a big chunk; load it only on the client and only on the note screen.
const NoteEditor = dynamic(() => import("@/components/editor/note-editor"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

/** What the inner editor is loaded from. Bumping `key` remounts it (mode switch, reload from disk). */
type EditorSource = { content: string; version: string; request: EditorRequest; key: number };

const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/** The note screen: read-only notes get a preview, everything else the editor. */
export function NoteView({ note, folders }: { note: Note; folders: string[] }) {
  if (note.readOnly) return <ReadOnlyNote note={{ ...note, readOnly: note.readOnly }} />;
  return <EditableNote note={note} folders={folders} />;
}

/**
 * Orchestrates one open note: header, banners, title and editor, plus every file-level action
 * (rename, move, delete, conflicts, mode switch). Saving itself lives in useNoteSync.
 */
function EditableNote({ note, folders }: { note: Note; folders: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const ref: NoteRef = { folder: note.folder, name: note.name };
  const titleRef = useRef<HTMLInputElement>(null);
  const adoptedKeyRef = useRef(-1);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  const [source, setSource] = useState<EditorSource>({
    content: note.content,
    version: note.version,
    request: "auto",
    key: 0,
  });
  const [sourceReason, setSourceReason] = useState<SourceReason>(null);
  const [mode, setMode] = useState<"visual" | "source" | null>(null);
  const [restored, setRestored] = useState(false);
  const [draftConflict, setDraftConflict] = useState<Draft | null>(null);
  const [dialog, setDialog] = useState<"move" | "delete" | "edit-visually" | null>(null);

  const sync = useNoteSync(note, (fresh) => {
    reloadEditor(fresh.content, fresh.version);
    toast.show({ message: "Updated from disk" });
  });
  const { autosaver, state } = sync;
  useRegisterActiveNote(ref, () => autosaver.flush());

  function reloadEditor(content: string, version: string, request = source.request) {
    sync.detach();
    setSource((s) => ({ content, version, request, key: s.key + 1 }));
  }

  function handleReady(ready: EditorReady) {
    sync.attach(ready.handle);
    setMode(ready.mode);
    setSourceReason(ready.sourceReason);
    if (adoptedKeyRef.current === source.key) return; // Strict Mode re-ran the editor's effect
    const firstOpen = adoptedKeyRef.current === -1;
    adoptedKeyRef.current = source.key;
    const draft = firstOpen ? readDraft(ref) : null; // read before adopt(), which may clear it
    autosaver.adopt(ready.baseline, source.version);
    if (!firstOpen) return;
    if (draft) recoverDraft(draft, ready);
    focusOnOpen(ready);
  }

  /** §8.3 step 5: a draft left by a crash or a failed save. */
  function recoverDraft(draft: Draft, ready: EditorReady) {
    if (draft.content === note.content || draft.content === ready.baseline) return clearDraft(ref);
    if (draft.baseVersion !== note.version) {
      writeDraft(ref, draft); // adopt() just cleared it; keep it on this device until the user decides
      return setDraftConflict(draft);
    }
    ready.handle.setContent(draft.content);
    autosaver.markDirty();
    setRestored(true);
  }

  function focusOnOpen(ready: EditorReady) {
    const isNew = isUntitledName(note.name) && splitFrontmatter(note.content).body.trim() === "";
    if (isNew) {
      titleRef.current?.focus();
      titleRef.current?.select();
    } else if (window.matchMedia("(pointer: fine)").matches) {
      ready.handle.focusStart(); // on phones, don't pop the keyboard just for opening a note
    }
  }

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
    reloadEditor(onDisk, autosaver.getVersion(), request);
  }

  function toggleMode() {
    if (mode === "visual") void switchMode("source");
    else if (sourceReason?.kind === "lossy") setDialog("edit-visually");
    else void switchMode("auto");
  }

  /** Saves pending edits, runs a file operation, and navigates to where the note now lives. */
  async function relocate(to: NoteRef, request: () => Promise<unknown>): Promise<string | null> {
    sync.editor()?.setEditable(false);
    try {
      await autosaver.flush();
      await request();
    } catch (err) {
      sync.editor()?.setEditable(true);
      if (isApiError(err, "name_taken")) return `A note named "${to.name}" already exists in ${to.folder}.`;
      return messageOf(err);
    }
    moveDraft(ref, to);
    sync.abandon();
    startTransition(() => {
      router.replace(noteHref(to));
      router.refresh();
    });
    return null;
  }

  const rename = (newName: string) =>
    relocate({ folder: note.folder, name: newName }, () =>
      api.updateNote({ folder: note.folder, name: note.name, newName }),
    );
  const move = (newFolder: string) =>
    relocate({ folder: newFolder, name: note.name }, () =>
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
    sync.abandon();
    startTransition(() => {
      router.replace(LIBRARY_HREF);
      router.refresh();
    });
  }

  async function download() {
    await autosaver.flush().catch(() => {});
    window.location.assign(downloadNoteHref(ref));
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
        status={<SaveStatus state={state} onRetry={() => autosaver.retry()} onShowConflict={showConflict} />}
        menu={
          <NoteMenu
            mode={mode}
            canEditVisually={sourceReason?.kind !== "large"}
            onRename={focusTitle}
            onMove={() => setDialog("move")}
            onDownload={download}
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
          draft={draftConflict}
          onDraftResolved={() => setDraftConflict(null)}
          onReload={reloadEditor}
        />
        {sourceReason && (
          <SourceModeNotice reason={sourceReason} onEditVisually={() => setDialog("edit-visually")} />
        )}
        {restored && (
          <Notice onDismiss={() => setRestored(false)}>Restored unsaved changes from this device.</Notice>
        )}
        <TitleInput
          name={note.name}
          inputRef={titleRef}
          onRename={rename}
          onFocusBody={() => sync.editor()?.focusStart()}
        />
        <NoteEditor
          key={source.key}
          content={source.content}
          request={source.request}
          toolbarSlot={toolbarSlot}
          onReady={handleReady}
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
