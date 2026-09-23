"use client";

import { useRef, useState, type RefObject } from "react";
import type { EditorMode, EditorReady, EditorRequest, SourceReason } from "@/components/editor/note-editor";
import {
  clearDraftConflict,
  draftAction,
  readDraftConflict,
  takeDraft,
  writeDraft,
  writeDraftConflict,
  type Draft,
} from "@/lib/drafts";
import { splitFrontmatter } from "@/lib/markdown/file-format";
import type { Note } from "@/lib/types";
import { takeHandover, type Handover } from "./known-notes";
import { isUntitledName, useNoteSync } from "./use-note-sync";

/** What the inner editor is loaded from. Bumping `key` remounts it (mode switch, reload from disk, draft). */
export type EditorSource = { content: string; version: string; request: EditorRequest; key: number };

/** A draft on its way into a remounted editor (see restoreDraft). */
type Restore = {
  key: number;
  draft: Draft;
  /** What is on disk, as the autosaver compares it: the draft must stay an unsaved edit. */
  baseline: string;
  /** Force-save it right away ("Keep mine" on a draft conflict). */
  force: boolean;
  /** What the editor had before a rename remounted it (its exact document and caret), if this is one. */
  handover: Handover | null;
};

/**
 * The editor half of an open note: its sync with the file (useNoteSync), which text and mode the
 * editor is loaded with, draft recovery and draft conflicts, and focus on open. The note screen owns the
 * file operations around it. `onUpdatedFromDisk` runs after a clean note was reloaded with `fresh`.
 */
export function useEditorSession(
  note: Note,
  titleRef: RefObject<HTMLInputElement | null>,
  onUpdatedFromDisk: (fresh: Note) => void,
) {
  const sync = useNoteSync(note, (fresh) => {
    reloadEditor(fresh.content, fresh.version);
    onUpdatedFromDisk(fresh);
  });
  const { autosaver, opened } = sync;
  const ref = { folder: opened.folder, name: opened.name };
  const [source, setSource] = useState<EditorSource>(() => ({
    content: opened.content,
    version: opened.version,
    request: "auto",
    key: 0,
  }));
  const [sourceReason, setSourceReason] = useState<SourceReason>(null);
  const [mode, setMode] = useState<EditorMode | null>(null);
  const [restored, setRestored] = useState(false);
  const [draftConflict, setDraftConflict] = useState<Draft | null>(null);
  const adoptedKeyRef = useRef(-1);
  const lastKeyRef = useRef(0);
  const restoreRef = useRef<Restore | null>(null);
  /** The rename handover given to the editor with this key, for a re-announced editor (see handleReady). */
  const handedOverRef = useRef<{ key: number; handover: Handover } | null>(null);

  /** Remounts the editor with `content` as the clean baseline at `version`; returns the new key. */
  function reloadEditor(content: string, version: string, request = source.request) {
    sync.detach();
    restoreRef.current = null; // a newer load wins over a draft that was on its way in
    const key = ++lastKeyRef.current;
    setSource({ content, version, request, key });
    return key;
  }

  /**
   * Loads a draft through a remount instead of setContent: the visual editor then checks its fidelity
   * like any file's, and a draft with HTML or footnotes (written in source mode) opens in source mode
   * instead of being silently stripped.
   */
  function restoreDraft(draft: Draft, opts: Omit<Restore, "key" | "draft">) {
    const request = source.request === "source" ? "source" : "auto";
    const key = reloadEditor(draft.content, autosaver.getVersion(), request);
    restoreRef.current = { key, draft, ...opts };
  }

  function handleReady(ready: EditorReady) {
    sync.attach(ready.handle);
    setMode(ready.mode);
    setSourceReason(ready.sourceReason);
    if (adoptedKeyRef.current === source.key) return resumeHandover(ready); // Strict Mode re-ran its effects
    const firstOpen = adoptedKeyRef.current === -1;
    adoptedKeyRef.current = source.key;
    const restore = restoreRef.current;
    restoreRef.current = null;
    if (restore?.key === source.key) return finishRestore(restore, ready);
    // Taken whichever tab wrote it; adopt() only clears this tab's own drafts.
    const draft = firstOpen ? takeDraft(ref) : null;
    autosaver.adopt(ready.baseline, source.version);
    if (firstOpen) openDrafts(draft, ready);
  }

  /**
   * Drafts on open (see docs/design-decisions.md#d18): a draft left by a crash, a failed save or a rename,
   * and any unresolved draft conflict.
   */
  function openDrafts(draft: Draft | null, ready: EditorReady) {
    const disk = { content: opened.content, baseline: ready.baseline, version: source.version };
    const handover = takeHandover(ref);
    const pending = readDraftConflict(ref);
    if (pending && draftAction(pending, disk) === "drop") clearDraftConflict(ref);
    else if (pending) setDraftConflict(pending);

    const action = draft ? draftAction(draft, disk) : "drop";
    if (draft && action === "restore") {
      writeDraft(ref, draft); // taken above, and the remount that restores it takes a moment
      return restoreDraft(draft, { baseline: ready.baseline, force: false, handover });
    }
    if (draft && action === "conflict") {
      writeDraftConflict(ref, draft); // kept apart from autosave's draft until the user decides
      setDraftConflict(draft);
    }
    focusOnOpen(ready, handover);
  }

  function finishRestore(restore: Restore, ready: EditorReady) {
    // "Keep mine" saves the draft on the version it was based on, so the server sees a forced save over a
    // version this tab never saw and keeps the file on disk in .trash (as the banner promises).
    const base = restore.force ? restore.draft.baseVersion : source.version;
    autosaver.adopt(restore.baseline, base);
    writeDraft(ref, { ...restore.draft, baseVersion: base }); // adopt() just cleared it
    if (restore.force) {
      autosaver.keepMine().catch(() => {}); // a failure shows in the save status
      clearDraftConflict(ref);
      return;
    }
    autosaver.markDirty();
    if (!restore.handover) setRestored(true); // a rename's own handover is not news to the user
    focusOnOpen(ready, restore.handover);
  }

  /**
   * After a rename, the editor first takes over the old one's exact document (Markdown drops a trailing
   * empty paragraph or space), then its caret if the user was writing in the body, so the next keystroke
   * lands exactly where it would have without the rename.
   */
  function focusOnOpen(ready: EditorReady, handover: Handover | null) {
    if (handover) {
      handedOverRef.current = { key: source.key, handover };
      ready.handle.restore(handover.snapshot);
    }
    if (handover?.focus) return ready.handle.focus(handover.snapshot.caret);
    const isNew = isUntitledName(ref.name) && splitFrontmatter(opened.content).body.trim() === "";
    if (isNew) {
      titleRef.current?.focus();
      titleRef.current?.select();
    } else if (window.matchMedia("(pointer: fine)").matches) {
      ready.handle.focus("start"); // on phones, don't pop the keyboard just for opening a note
    }
  }

  /**
   * The same editor announced itself again: Strict Mode re-ran its effects, which re-attaches Tiptap's DOM
   * and drops the focus, or Tiptap replaced the instance. Either way a rename handover must reach the
   * editor that stays. The restore is a no-op when it already has the document, and the focus is only
   * taken back when nothing else holds it.
   */
  function resumeHandover(ready: EditorReady) {
    const applied = handedOverRef.current;
    if (applied?.key !== source.key) return;
    ready.handle.restore(applied.handover.snapshot);
    const idle = !document.activeElement || document.activeElement === document.body;
    if (applied.handover.focus && idle) ready.handle.focus(applied.handover.snapshot.caret);
  }

  return {
    sync,
    source,
    mode,
    sourceReason,
    restored,
    dismissRestored: () => setRestored(false),
    draftConflict,
    handleReady,
    reloadEditor,
    /** "Keep mine" on a draft conflict: the draft replaces the file; the version on disk goes to .trash. */
    async keepDraft(draft: Draft) {
      await autosaver.flush().catch(() => {}); // so the copy in .trash has everything typed so far
      setDraftConflict(null);
      restoreDraft(draft, { baseline: sync.getContent(), force: true, handover: null });
    },
    /** "Use disk version" or "Save mine as a copy": the pending draft is resolved and can go. */
    dismissDraftConflict() {
      clearDraftConflict(ref);
      setDraftConflict(null);
    },
  };
}
