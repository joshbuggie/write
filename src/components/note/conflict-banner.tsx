"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, isApiError } from "@/lib/api-client";
import { DEFAULT_FOLDER } from "@/lib/constants";
import { clearDraft, type Draft } from "@/lib/drafts";
import { toSafeName } from "@/lib/names";
import { LIBRARY_HREF, noteHref } from "@/lib/routes";
import type { Note } from "@/lib/types";
import type { NoteSync } from "./use-note-sync";

/** The element id SaveStatus's "Conflict" button scrolls to. */
export const CONFLICT_BANNER_ID = "conflict-banner";

/**
 * changed: the file on disk changed while you had unsaved edits.
 * deleted: the file (or its folder) is gone, e.g. renamed in Finder.
 * draft:   this device kept unsaved changes that are based on an older version of the file.
 */
type Variant = "changed" | "deleted" | "draft";

const MESSAGES: Record<Variant, string> = {
  changed: "This note changed on disk since you opened it.",
  deleted: "This note was deleted or renamed outside write.",
  draft: "Unsaved changes on this device are based on an older version.",
};

type ConflictBannerProps = {
  note: Note;
  sync: NoteSync;
  /** A draft found at open that is based on an older version of the file, if any. */
  draft: Draft | null;
  onDraftResolved: () => void;
  /** Load the given disk text into the editor as the new, clean baseline. */
  onReload: (content: string, version: string) => void;
};

const messageOf = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/**
 * The one place a user resolves a save conflict (§8.6). Renders nothing when there is none. Every
 * choice is explicit: write never overwrites a file that changed elsewhere, and never drops your
 * edits without asking.
 */
export function ConflictBanner({ note, sync, draft, onDraftResolved, onReload }: ConflictBannerProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const { state, autosaver } = sync;
  const ref = { folder: note.folder, name: note.name };

  const variant: Variant | null =
    state.kind === "conflict"
      ? state.current
        ? "changed"
        : "deleted"
      : sync.missing
        ? "deleted"
        : draft
          ? "draft"
          : null;
  if (!variant) return null;

  /** Force-save what this device has (re-creates the file if it is gone). */
  async function keepMine() {
    if (variant === "draft" && draft) {
      sync.editor()?.setContent(draft.content);
      onDraftResolved();
    }
    await autosaver.keepMine();
    sync.clearMissing();
  }

  /** "Use disk version" (changed, draft) or "Close" (deleted). */
  function discardMine() {
    if (variant === "draft") {
      clearDraft(ref);
      onDraftResolved();
    } else if (variant === "deleted") {
      sync.abandon();
      router.push(LIBRARY_HREF);
    } else if (state.kind === "conflict" && state.current) {
      onReload(state.current.content, state.current.version);
    }
  }

  /** Creates the copy next to the note, or in the default folder if the note's folder is gone. */
  async function createCopy(name: string, content: string): Promise<Note> {
    try {
      return (await api.createNote({ folder: note.folder, name, content })).note;
    } catch (err) {
      if (!isApiError(err, "not_found") || note.folder === DEFAULT_FOLDER) throw err;
      return (await api.createNote({ folder: DEFAULT_FOLDER, name, content })).note;
    }
  }

  /** "Save mine as a copy" / "Save as new note": your text goes to a new file; the original is left as is. */
  async function saveCopy() {
    const content = variant === "draft" && draft ? draft.content : sync.getContent();
    const name = toSafeName(variant === "deleted" ? note.name : `${note.name} (conflict)`, "note");
    const copy = await createCopy(name, content);
    if (variant === "draft") {
      clearDraft(ref);
      onDraftResolved();
    } else {
      sync.abandon();
    }
    startTransition(() => {
      router.push(noteHref(copy));
      router.refresh();
    });
  }

  const actions: Array<{ label: string; run: () => Promise<void> | void; primary?: boolean }> = [
    { label: "Keep mine", run: keepMine, primary: true },
    variant === "deleted"
      ? { label: "Save as new note", run: saveCopy }
      : { label: "Use disk version", run: discardMine },
    variant === "deleted"
      ? { label: "Close", run: discardMine }
      : { label: "Save mine as a copy", run: saveCopy },
  ];

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
        <span>{MESSAGES[variant]}</span>
      </p>
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
