/**
 * Proposals as the review UI and the agent API see them (docs/design-decisions.md#d31). Isomorphic.
 */

/** What a change does to the note, section by section. */
export type ChangeKind = "modified" | "added" | "removed";

/**
 * How a change meets the note as it is now. "clean": the section is as the harness read it. "conflict":
 * you changed it too (or, for an added section, wrote one with the same heading). "gone": you removed a
 * section the harness changed.
 */
export type ChangeState = "clean" | "conflict" | "gone";

/** One section-level change to review. */
export interface ProposalChange {
  /** The section's key (see Section.key): what Accept and Reject name. */
  key: string;
  kind: ChangeKind;
  /** The heading line ("## Plan"), or null for the text before the first heading. */
  heading: string | null;
  state: ChangeState;
  /** The harness's reason for this change, if it gave one. */
  reason: string | null;
  /** The section as the harness read it; null for an added section. */
  base: string | null;
  /** The section in the note now; null when it isn't there. */
  current: string | null;
  /** The section as proposed; null for a removal. */
  proposed: string | null;
}

/** A pending proposal, reviewed against the note as it is now. */
export interface ProposalReview {
  id: string;
  /** The integration's name when it proposed ("Turnstone"). */
  source: string;
  /** ISO 8601. */
  createdAt: string;
  summary: string;
  /** The note's version these changes were worked out against; applying needs it unchanged. */
  noteVersion: string;
  /** Only changes still to decide: ones already in the note or already rejected are left out. */
  changes: ProposalChange[];
}

/** The note banner's view of a pending proposal. */
export interface ProposalSummary {
  id: string;
  source: string;
  createdAt: string;
  summary: string;
  changes: number;
  conflicts: number;
}

/** Where a proposal stands, for the harness that sent it. */
export type ProposalStatus = "pending" | "applied" | "dismissed" | "replaced" | "orphaned";

/** The owner's decision on one change. */
export interface ChangeDecision {
  key: string;
  heading: string | null;
  kind: ChangeKind;
  decision: "accepted" | "rejected";
  /** ISO 8601. */
  at: string;
}
