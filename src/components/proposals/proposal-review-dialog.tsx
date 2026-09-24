"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { ResolveProposalResponse } from "@/lib/api-contract";
import { api, isApiError } from "@/lib/api-client";
import type { ProposalReview } from "@/lib/proposals/types";
import type { NoteRef } from "@/lib/types";
import { ChangeCard } from "./change-card";
import { applyLabel, type Decision } from "./review-labels";

type ProposalReviewDialogProps = {
  noteRef: NoteRef;
  proposalId: string;
  onClose: () => void;
  /** After the server applied the decisions; `accepted` is how many changes went in. */
  onApplied: (result: ResolveProposalResponse, accepted: number) => void;
};

const messageOf = (err: unknown) =>
  err instanceof Error && err.message ? err.message : "Something went wrong.";

/**
 * Reviewing one proposal, section by section (docs/design-decisions.md#d31). The note is saved before this
 * opens, so the review is worked out against its latest text. Nothing changes until Apply; changes left
 * undecided keep waiting for another time.
 */
export function ProposalReviewDialog({ noteRef, proposalId, onClose, onApplied }: ProposalReviewDialogProps) {
  // undefined while loading; null when the proposal has nothing left to review.
  const [review, setReview] = useState<ProposalReview | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [pending, setPending] = useState(false);
  const [reloads, setReloads] = useState(0);

  const { folder, name } = noteRef;
  useEffect(() => {
    let live = true;
    api.listProposals({ folder, name }).then(
      ({ reviews }) => {
        if (!live) return;
        const found = reviews.find((r) => r.id === proposalId) ?? null;
        setReview(found);
        // Keep the decisions for changes that are still there after a reload.
        setDecisions((d) =>
          Object.fromEntries(Object.entries(d).filter(([k]) => found?.changes.some((c) => c.key === k))),
        );
      },
      (err: unknown) => live && setLoadError(messageOf(err)),
    );
    return () => {
      live = false;
    };
  }, [folder, name, proposalId, reloads]);

  const decideAll = (d: Decision) =>
    setDecisions(Object.fromEntries((review?.changes ?? []).map((c) => [c.key, d])));

  async function apply() {
    if (!review) return;
    const keys = (d: Decision) => Object.keys(decisions).filter((k) => decisions[k] === d);
    setPending(true);
    try {
      const result = await api.resolveProposal({
        id: review.id,
        noteVersion: review.noteVersion,
        accept: keys("accept"),
        reject: keys("reject"),
      });
      onApplied(result, keys("accept").length);
      onClose();
    } catch (err) {
      if (isApiError(err, "version_conflict")) {
        setNotice(
          "The note changed, so the changes below are compared with its latest text. Check them again.",
        );
        setReloads((n) => n + 1);
      } else {
        setNotice(messageOf(err));
      }
    } finally {
      setPending(false);
    }
  }

  const label = applyLabel(decisions);
  const date = review
    ? new Date(review.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={review ? `Changes from ${review.source}` : "Proposed changes"}
      description={review ? [review.summary, date].filter(Boolean).join(" · ") : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Decide later
          </Button>
          <Button variant="primary" pending={pending} disabled={!label} onClick={() => void apply()}>
            {label ?? "Apply"}
          </Button>
        </>
      }
    >
      {loadError ? (
        <p role="alert" className="text-[14px] text-danger">
          {loadError}
        </p>
      ) : review === undefined ? (
        <Spinner />
      ) : review === null ? (
        <p className="text-[14px] text-muted">
          Nothing left to review: these changes are already in the note.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {notice && (
            <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink">
              {notice}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="basis-full text-[13px] text-muted md:flex-1 md:basis-auto">
              Undecided changes keep waiting. Your edits outside these sections stay as they are.
            </span>
            <Button size="sm" variant="ghost" onClick={() => decideAll("accept")}>
              Accept all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => decideAll("reject")}>
              Reject all
            </Button>
          </div>
          {review.changes.map((change) => (
            <ChangeCard
              key={change.key}
              change={change}
              source={review.source}
              decision={decisions[change.key]}
              onDecide={(d) =>
                setDecisions((current) => {
                  const next = { ...current };
                  if (d) next[change.key] = d;
                  else delete next[change.key];
                  return next;
                })
              }
            />
          ))}
        </div>
      )}
    </Dialog>
  );
}
