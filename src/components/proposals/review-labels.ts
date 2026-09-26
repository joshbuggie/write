import type { ChangeKind, ProposalChange, ProposalSummary } from "@/lib/proposals/types";

/**
 * Words for the proposal banner and review cards (docs/design-decisions.md#d31), kept apart from the
 * components so they can be tested without a browser.
 */

/** "Plan" for "## Plan", or "Opening text" for what comes before the first heading. */
export function changeTitle(change: Pick<ProposalChange, "heading">): string {
  if (change.heading === null) return "Opening text";
  return change.heading.replace(/^#+\s*/, "").replace(/\s+#+$/, "") || "Untitled section";
}

export const KIND_LABELS: Record<ChangeKind, string> = {
  modified: "Changed",
  added: "New section",
  removed: "Removed",
};

/** What accepting means when the owner changed the same section too, or null for a clean change. */
export function conflictNote(change: ProposalChange, source: string): string | null {
  if (change.state === "gone") {
    return `You removed this section after ${source} read the note. Accepting adds it back with their changes.`;
  }
  if (change.state !== "conflict") return null;
  if (change.kind === "added") return "You added a section with the same heading. Accepting replaces yours.";
  if (change.kind === "removed") {
    return `You edited this section after ${source} read the note. Accepting removes it, with your edits.`;
  }
  return `You edited this section after ${source} read the note. Accepting replaces your version with theirs.`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Turnstone proposed changes to 3 sections, 1 of which you also edited." */
export function bannerText(p: ProposalSummary): string {
  const what = `${p.source} proposed changes to ${plural(p.changes, "section")}`;
  if (p.conflicts === 0) return `${what}.`;
  return `${what}, ${p.conflicts === 1 ? "1 of which" : `${p.conflicts} of which`} you also edited.`;
}

export type Decision = "accept" | "reject";

/** The Apply button: "Apply 2 changes", "Reject 1 change", or both; null when nothing is decided. */
export function applyLabel(decisions: Record<string, Decision>): string | null {
  const values = Object.values(decisions);
  const accepted = values.filter((d) => d === "accept").length;
  const rejected = values.length - accepted;
  if (accepted && rejected) return `Apply ${accepted}, reject ${rejected}`;
  if (accepted) return `Apply ${plural(accepted, "change")}`;
  if (rejected) return `Reject ${plural(rejected, "change")}`;
  return null;
}

/**
 * The toast after applying: what happened and what still waits. `unrecordedRejections` counts rejections
 * write couldn't record, which will be offered again.
 */
export function appliedMessage(accepted: number, waiting: number, unrecordedRejections = 0): string {
  const done = accepted ? `Applied ${plural(accepted, "change")}` : "Rejected the changes";
  if (unrecordedRejections > 0) {
    return `${done}, but write couldn't record your decisions, so ${plural(unrecordedRejections, "change")} you rejected will be offered again.`;
  }
  return waiting ? `${done}. ${plural(waiting, "change")} still waiting.` : `${done}.`;
}
