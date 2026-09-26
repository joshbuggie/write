"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import { recordDiskState } from "@/components/note/known-notes";
import { useToast } from "@/components/ui/toast";
import type { ResolveProposalResponse } from "@/lib/api-contract";
import { api, isApiError } from "@/lib/api-client";
import type { NoteRef } from "@/lib/types";
import { appliedMessage } from "./review-labels";

type ReviewDeps = {
  noteRef: NoteRef;
  /** Saves pending edits; throws when that fails. */
  flush: () => Promise<void>;
  /** Remounts the editor on `content` as the clean text at `version` (see useEditorSession). */
  reloadEditor: (content: string, version: string) => void;
};

/**
 * The note screen's side of a proposal review (docs/design-decisions.md#d31). The note is saved before
 * the review opens, so the server compares against its latest text. After Apply the editor reloads the
 * saved text, recorded as this tab's own save so it isn't reported as "Updated from disk", and the toast
 * offers Undo, which puts the previous text back only if the note hasn't changed since.
 */
export function useProposalReview({ noteRef, flush, reloadEditor }: ReviewDeps) {
  const router = useRouter();
  const toast = useToast();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Puts `content` in the editor as the note's saved text at `version`, if this screen is still open. */
  function adopt(content: string, saved: { version: string; updatedAt: string }) {
    recordDiskState(noteRef, { content, version: saved.version, updatedAt: saved.updatedAt }, "saved");
    if (mounted.current) reloadEditor(content, saved.version);
    startTransition(() => router.refresh());
  }

  async function open(id: string) {
    try {
      await flush();
    } catch {
      toast.show({ message: "Couldn't save your changes, so the review didn't open.", tone: "error" });
      return;
    }
    setReviewing(id);
  }

  async function undo(result: ResolveProposalResponse) {
    try {
      await flush();
      const { note } = await api.saveNote({
        ...noteRef,
        content: result.previousContent,
        baseVersion: result.note.version,
      });
      adopt(result.previousContent, note);
      toast.show({ message: "Undone" });
    } catch (err) {
      const message = isApiError(err, "version_conflict")
        ? "The note changed since, so the changes weren't undone."
        : "Couldn't undo the changes.";
      toast.show({ message, tone: "error" });
    }
  }

  function applied(result: ResolveProposalResponse, accepted: number) {
    const changed = result.content !== result.previousContent;
    if (changed) adopt(result.content, result.note);
    else startTransition(() => router.refresh());
    const unrecordedRejections = result.unrecorded.filter((d) => d.decision === "rejected").length;
    toast.show({
      message: appliedMessage(accepted, result.waiting, unrecordedRejections),
      tone: result.unrecorded.length > 0 ? "error" : undefined,
      action: changed ? { label: "Undo", onClick: () => void undo(result) } : undefined,
      // The editor reloaded, so ⌘Z can't reach this change: the toast is the only undo, so it stays longer.
      durationMs: changed ? 10_000 : undefined,
    });
  }

  return { reviewing, open, close: () => setReviewing(null), applied };
}
