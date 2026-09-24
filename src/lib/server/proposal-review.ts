import type { ResolveProposalResponse } from "@/lib/api-contract";
import { applyChanges } from "@/lib/proposals/apply";
import { buildChanges } from "@/lib/proposals/review";
import type { ChangeDecision, ProposalChange, ProposalReview, ProposalSummary } from "@/lib/proposals/types";
import type { Note } from "@/lib/types";
import {
  getProposal,
  pendingProposalsFor,
  readNote,
  saveNote,
  StorageError,
  updateProposal,
  type StoredProposal,
} from "./storage";

/**
 * Reviewing proposals against the note as it is now, and applying the owner's decisions
 * (docs/design-decisions.md#d31). Nothing here writes a note except an owner's accept.
 */

/** The changes still to decide: already in the note, or already accepted or rejected, are left out. */
export function openChanges(p: StoredProposal, currentContent: string): ProposalChange[] {
  const decided = new Set(p.decisions.map((d) => d.key));
  return buildChanges(p.base, p.proposed, currentContent, p.reasons).filter((c) => !decided.has(c.key));
}

/** A pending proposal as the review dialog shows it. */
export function toReview(p: StoredProposal, note: Note): ProposalReview {
  return {
    id: p.id,
    source: p.source,
    createdAt: p.createdAt,
    summary: p.summary,
    noteVersion: note.version,
    changes: openChanges(p, note.content),
  };
}

/** The note's pending proposals that still have something to decide, reviewed against `note`. */
export async function reviewsFor(note: Note): Promise<ProposalReview[]> {
  if (note.readOnly) return [];
  const pending = await pendingProposalsFor(note);
  return pending.map((p) => toReview(p, note)).filter((r) => r.changes.length > 0);
}

/** One line per pending proposal, for the banner above the note. */
export async function summariesFor(note: Note): Promise<ProposalSummary[]> {
  return (await reviewsFor(note)).map((r) => ({
    id: r.id,
    source: r.source,
    createdAt: r.createdAt,
    summary: r.summary,
    changes: r.changes.length,
    conflicts: r.changes.filter((c) => c.state !== "clean").length,
  }));
}

const closed = () => new StorageError("not_found", "This proposal is no longer waiting for review.");

/**
 * Applies the owner's decisions. The note must still be at `noteVersion`, the version the review was
 * worked out against (else 409 with the note as it is now). Accepted changes go into the note in one
 * conditional save; rejected ones are recorded so they aren't offered again. The proposal closes once
 * nothing is left to decide.
 */
export async function resolveProposal(input: {
  id: string;
  noteVersion: string;
  accept: string[];
  reject: string[];
}): Promise<ResolveProposalResponse> {
  const proposal = await getProposal(input.id);
  if (!proposal || proposal.status !== "pending") throw closed();
  const note = await readNote(proposal.note);
  if (note.readOnly) throw new StorageError("read_only", "This note can't be edited here.");
  if (note.version !== input.noteVersion) {
    throw new StorageError("version_conflict", "The note changed while you were reviewing.", note);
  }
  const changes = openChanges(proposal, note.content);
  const accepted = changes.filter((c) => input.accept.includes(c.key));
  const rejected = changes.filter((c) => input.reject.includes(c.key) && !input.accept.includes(c.key));
  const content = applyChanges(note.content, proposal.proposed, accepted);
  const saved =
    content === note.content
      ? {
          folder: note.folder,
          name: note.name,
          updatedAt: note.updatedAt,
          size: note.size,
          version: note.version,
        }
      : await saveNote({ ref: proposal.note, content, baseVersion: note.version });

  const at = new Date().toISOString();
  const decide = (c: ProposalChange, decision: ChangeDecision["decision"]): ChangeDecision => ({
    key: c.key,
    heading: c.heading,
    kind: c.kind,
    decision,
    at,
  });
  const decisions = [
    ...accepted.map((c) => decide(c, "accepted")),
    ...rejected.map((c) => decide(c, "rejected")),
  ];
  const waiting = changes.length - decisions.length;
  await updateProposal(proposal.id, (p) => {
    if (p.status !== "pending") throw closed();
    const all = [...p.decisions, ...decisions];
    const status =
      waiting > 0 ? "pending" : all.some((d) => d.decision === "accepted") ? "applied" : "dismissed";
    return { ...p, decisions: all, status };
  });
  return { note: saved, content, previousContent: note.content, waiting };
}
