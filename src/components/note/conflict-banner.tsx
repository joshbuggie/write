"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, isApiError } from "@/lib/api-client";
import { DEFAULT_FOLDER } from "@/lib/constants";
import type { Draft } from "@/lib/drafts";
import { toSafeName } from "@/lib/names";
import { LIBRARY_HREF, noteHref } from "@/lib/routes";
import type { Note, NoteRef } from "@/lib/types";
import { isSameNote, isSavedHere, movedTo, noteCreated, noteRecreated } from "./known-notes";
import type { NoteSync } from "./use-note-sync";

/** The element id SaveStatus's "Conflict" button scrolls to. */
export const CONFLICT_BANNER_ID = "conflict-banner";

/**
 * changed: the file on disk changed while you had unsaved edits.
 * own:     the same, but the version on disk is one this tab saved (e.g. a save from the last visit
 *          landed after this editor opened), so it is your own newer text, not someone else's.
 * deleted: the file (or its folder) is gone, e.g. renamed in Finder.
 * moved:   gone because this tab renamed or moved it (a page of the old name came back from history).
 * draft:   this device kept unsaved changes that are based on an older version of the file.
 */
type Variant = "changed" | "own" | "deleted" | "moved" | "draft";

const TRASH_HINT = "Keep mine replaces it; the version on disk is kept in .trash.";

function message(variant: Variant, to: NoteRef | null): string {
  switch (variant) {
    case "changed":
      return `This note changed on disk since you opened it. ${TRASH_HINT}`;
    case "own":
      return `This tab saved newer changes to this note after this editor opened it. ${TRASH_HINT}`;
    case "deleted":
      return "This note was deleted or renamed outside write.";
    case "moved":
      return `This note was renamed or moved to “${to?.name}” in ${to?.folder}.`;
    case "draft":
      return `Unsaved changes on this device are based on an older version. ${TRASH_HINT}`;
  }
}

type ConflictBannerProps = {
  note: Note;
  sync: NoteSync;
  /** A draft found at open that is based on an older version of the file, if any. */
  draft: Draft | null;
  /** "Keep mine" for that draft: load it into the editor and force-save it. */
  onKeepDraft: (draft: Draft) => Promise<void>;
  /** The draft was dealt with some other way (disk version kept, or saved as a copy). */
  onDraftResolved: () => void;
  /** Load the given disk text into the editor as the new, clean baseline. */
  onReload: (content: string, version: string) => void;
  /** Remount the note screen: a copy was just created under this note's own name (see saveCopy). */
  onReopen: () => void;
};

const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/**
 * The one place a user resolves a save conflict (see docs/design-decisions.md#d20). Renders nothing when
 * there is none. Every choice is explicit: write never overwrites a file that changed elsewhere, and never
 * drops your edits without asking.
 */
export function ConflictBanner(props: ConflictBannerProps) {
  const { note, sync, draft, onKeepDraft, onDraftResolved, onReload, onReopen } = props;
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const { state, autosaver } = sync;
  const ref = { folder: note.folder, name: note.name };
  const to = movedTo(ref);
  const current = state.kind === "conflict" ? state.current : null;

  let variant: Variant | null = null;
  if (current) variant = isSavedHere(ref, current.version) ? "own" : "changed";
  else if (state.kind === "conflict" || sync.missing) variant = to ? "moved" : "deleted";
  else if (draft) variant = "draft";
  if (!variant) return null;

  /** Force-save what this device has (re-creates the file if it is gone). */
  async function keepMine() {
    if (variant === "draft" && draft) return onKeepDraft(draft);
    await autosaver.keepMine();
    sync.clearMissing();
  }

  /** "Use disk version" / "Use saved version" (changed, own, draft) or "Close" (deleted). */
  function discardMine() {
    if (variant === "draft") {
      onDraftResolved();
    } else if (variant === "deleted") {
      sync.abandon({ gone: true });
      router.push(LIBRARY_HREF);
    } else if (current) {
      onReload(current.content, current.version);
    }
  }

  /** Follow the note to its new name; unsaved text goes along as a draft (restored or flagged there). */
  function openMoved() {
    if (!to) return;
    sync.handOff(to, false);
    router.replace(noteHref(to));
  }

  /** Creates the copy next to the note, or in the default folder if the note's folder is gone. */
  async function createCopy(name: string, content: string): Promise<Note> {
    let copy: Note;
    try {
      copy = (await api.createNote({ folder: note.folder, name, content })).note;
    } catch (err) {
      if (!isApiError(err, "not_found") || note.folder === DEFAULT_FOLDER) throw err;
      copy = (await api.createNote({ folder: DEFAULT_FOLDER, name, content })).note;
    }
    noteCreated(copy);
    return copy;
  }

  /** "Save mine as a copy" / "Save as new note": your text goes to a new file; the original is left as is. */
  async function saveCopy() {
    const content = variant === "draft" && draft ? draft.content : sync.getContent();
    const gone = variant === "deleted" || variant === "moved";
    const name = toSafeName(gone ? note.name : `${note.name} (conflict)`, "note");
    const copy = await createCopy(name, content);
    if (variant === "draft") {
      onDraftResolved();
    } else {
      sync.abandon({ gone }); // "changed" and "own" leave the original file in place
    }
    if (isSameNote(copy, ref)) {
      // The old name was free, so the copy took it: same URL, so the page wouldn't remount and this
      // (abandoned) editor would stay frozen. Reopen the screen on the copy instead.
      noteRecreated(copy, note);
      onReopen();
      startTransition(() => router.refresh());
      return;
    }
    startTransition(() => {
      router.push(noteHref(copy));
      router.refresh();
    });
  }

  type Action = { label: string; run: () => Promise<void> | void; primary?: boolean };
  const byVariant: Record<Variant, Action[]> = {
    changed: [
      { label: "Keep mine", run: keepMine, primary: true },
      { label: "Use disk version", run: discardMine },
      { label: "Save mine as a copy", run: saveCopy },
    ],
    // The disk has the user's own newer text, so taking it is the safe default here.
    own: [
      { label: "Use saved version", run: discardMine, primary: true },
      { label: "Keep mine", run: keepMine },
      { label: "Save mine as a copy", run: saveCopy },
    ],
    deleted: [
      { label: "Keep mine", run: keepMine, primary: true },
      { label: "Save as new note", run: saveCopy },
      { label: "Close", run: discardMine },
    ],
    // No "Keep mine": it would recreate a stale duplicate under the old name.
    moved: [
      { label: `Open “${to?.name}”`, run: openMoved, primary: true },
      { label: "Save as new note", run: saveCopy },
    ],
    draft: [
      { label: "Keep mine", run: keepMine, primary: true },
      { label: "Use disk version", run: discardMine },
      { label: "Save mine as a copy", run: saveCopy },
    ],
  };
  const actions = byVariant[variant];

  async function run(label: string, action: () => Promise<void> | void) {
    setPending(label);
    try {
      await action();
    } catch (err) {
      toast.show({ message: messageOf(err), tone: "error" });
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      id={CONFLICT_BANNER_ID}
      tabIndex={-1}
      aria-label="Conflict"
      className="mt-4 rounded-lg bg-warning-soft px-3 py-3 text-[14px] leading-[1.5] text-ink outline-none"
    >
      <p className="flex gap-3">
        <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-[18px] shrink-0 text-warning" />
        <span>{message(variant, to)}</span>
      </p>
      {variant === "draft" && draft && (
        <details className="mt-2 pl-[30px]">
          <summary className="cursor-pointer text-muted">Show the unsaved changes</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-canvas p-2 font-mono text-[13px] whitespace-pre-wrap">
            {draft.content}
          </pre>
        </details>
      )}
      <div className="mt-3 flex flex-wrap gap-2 pl-[30px]">
        {actions.map((action) => (
          <Button
            key={action.label}
            size="sm"
            variant={action.primary ? "primary" : "secondary"}
            pending={pending === action.label}
            disabled={pending !== null}
            onClick={() => run(action.label, action.run)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
