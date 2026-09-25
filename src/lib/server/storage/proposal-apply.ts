import type { ChangeDecision, ProposalStatus } from "@/lib/proposals/types";
import type { Note, SavedNote } from "@/lib/types";
import { StorageError } from "./errors";
import { withWriteLock } from "./mutex";
import { readNote, saveNoteUnlocked } from "./notes";
import { withStatus } from "./proposals";
import { readProposal, writeProposal, type StoredProposal } from "./proposals-file";

/**
 * Applying the owner's decisions on a proposal as one step (docs/design-decisions.md#d31). The proposal's
 * status, the note's version, the save and the recorded decisions all happen under the write lock, so a
 * newer proposal can't replace this one, and nothing can close it, between the save and the record: Apply
 * either changes the note and says so, or changes nothing. If the decisions can't be written, a request
 * that saved nothing fails; one that saved the note succeeds with `recorded: false`, so the caller can say
 * which decisions will be asked again.
 */

/** What to do, worked out from the proposal and the note as they are under the lock. */
export interface ProposalPlan {
  /** The note's whole text after the decisions; the same text writes nothing. */
  content: string;
  decisions: ChangeDecision[];
  status: ProposalStatus;
}

const closed = () => new StorageError("not_found", "This proposal is no longer waiting for review.");

export function applyProposal(
  id: string,
  noteVersion: string,
  plan: (proposal: StoredProposal, note: Note) => ProposalPlan,
): Promise<{ saved: SavedNote; before: Note; plan: ProposalPlan; recorded: boolean }> {
  return withWriteLock(async () => {
    const proposal = await readProposal(id);
    if (!proposal || proposal.status !== "pending") throw closed();
    const before = await readNote(proposal.note);
    if (before.readOnly) throw new StorageError("read_only", "This note can't be edited here.");
    if (before.version !== noteVersion) {
      throw new StorageError("version_conflict", "The note changed while you were reviewing.", before);
    }
    const planned = plan(proposal, before);
    const unchanged: SavedNote = {
      folder: before.folder,
      name: before.name,
      updatedAt: before.updatedAt,
      size: before.size,
      version: before.version,
    };
    const saved =
      planned.content === before.content
        ? unchanged
        : await saveNoteUnlocked({ ref: proposal.note, content: planned.content, baseVersion: noteVersion });
    const next = withStatus(
      { ...proposal, decisions: [...proposal.decisions, ...planned.decisions] },
      planned.status,
    );
    let recorded = true;
    try {
      await writeProposal({ ...next, updatedAt: new Date().toISOString() });
    } catch (err) {
      // Nothing else was saved: the whole request failed, and must say so.
      if (saved === unchanged) throw err;
      // The note is saved, so the request did something; the caller reports what wasn't recorded.
      console.error("[write] couldn't record the decisions on a proposal", err);
      recorded = false;
    }
    return { saved, before, plan: planned, recorded };
  });
}
