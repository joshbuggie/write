import type { NoteRef } from "@/lib/types";
import { StorageError } from "./errors";
import { randomHex } from "./fs-utils";
import { withWriteLock } from "./mutex";
import {
  listProposals,
  readProposal,
  removeProposalFile,
  writeProposal,
  type StoredProposal,
} from "./proposals-file";

/**
 * Keeping proposals (docs/design-decisions.md#d31): adding one, recording decisions, and keeping each
 * pending proposal with its note through renames, moves and deletes. Every change runs under the write
 * lock, like the notes themselves.
 */

export type { StoredProposal };

/** An integration may have this many proposals waiting at once, so a runaway harness can't fill the disk. */
export const MAX_PENDING_PER_INTEGRATION = 20;
/** Handled proposals are kept this long for the harness to look up, then removed. */
const KEEP_RESOLVED_MS = 30 * 24 * 60 * 60 * 1000;

/** Same note: exact on-disk names, compared in NFC like resolveFolder's fallback. */
export const sameNoteRef = (a: NoteRef, b: NoteRef) =>
  a.folder.normalize("NFC") === b.folder.normalize("NFC") &&
  a.name.normalize("NFC") === b.name.normalize("NFC");

/**
 * A proposal with a new status. A closed one drops the note text it carried: all that is looked up
 * afterwards is the decisions, and the text is either in the note now or was turned down.
 */
export function withStatus(p: StoredProposal, status: StoredProposal["status"]): StoredProposal {
  return status === "pending" ? { ...p, status } : { ...p, status, base: "", proposed: "" };
}

/** What a new proposal starts from; the storage layer adds the id, status and times. */
export type NewProposal = Omit<StoredProposal, "id" | "status" | "decisions" | "createdAt" | "updatedAt">;

/**
 * Saves a new proposal and returns it with `created: true`. A retry (same integration and request id), or
 * the same change sent again while the first still waits, returns the existing one instead. An older
 * pending proposal from the same integration for the same note is marked replaced: only the newest waits.
 */
export function addProposal(input: NewProposal): Promise<{ proposal: StoredProposal; created: boolean }> {
  return withWriteLock(async () => {
    const all = await listProposals();
    const mine = all.filter((p) => p.integrationId === input.integrationId);
    const retried = input.requestId ? mine.find((p) => p.requestId === input.requestId) : undefined;
    const repeated = mine.find(
      (p) =>
        p.status === "pending" &&
        sameNoteRef(p.note, input.note) &&
        p.base === input.base &&
        p.proposed === input.proposed,
    );
    if (retried ?? repeated) return { proposal: (retried ?? repeated)!, created: false };

    const older = mine.filter((p) => p.status === "pending" && sameNoteRef(p.note, input.note));
    const waiting = mine.filter((p) => p.status === "pending").length - older.length;
    if (waiting >= MAX_PENDING_PER_INTEGRATION) {
      throw new StorageError(
        "bad_request",
        `${MAX_PENDING_PER_INTEGRATION} proposals are already waiting for review. Wait until the owner has looked at them.`,
      );
    }
    const now = new Date().toISOString();
    for (const p of older) await writeProposal({ ...withStatus(p, "replaced"), updatedAt: now });
    const cutoff = Date.now() - KEEP_RESOLVED_MS;
    for (const p of all) {
      if (p.status !== "pending" && Date.parse(p.updatedAt) < cutoff) await removeProposalFile(p.id);
    }
    const proposal: StoredProposal = {
      ...input,
      id: randomHex(8),
      status: "pending",
      decisions: [],
      createdAt: now,
      updatedAt: now,
    };
    await writeProposal(proposal);
    return { proposal, created: true };
  });
}

/** The pending proposals for a note, oldest first. */
export async function pendingProposalsFor(ref: NoteRef): Promise<StoredProposal[]> {
  return (await listProposals()).filter((p) => p.status === "pending" && sameNoteRef(p.note, ref));
}

/** One proposal by id, or null. */
export const getProposal = (id: string) => readProposal(id);

/**
 * Changes a proposal under the lock. `update` gets the saved proposal and returns the new one; it may
 * throw to refuse. A proposal that no longer exists is not_found.
 */
export function updateProposal(
  id: string,
  update: (p: StoredProposal) => StoredProposal,
): Promise<StoredProposal> {
  return withWriteLock(async () => {
    const current = await readProposal(id);
    if (!current) throw new StorageError("not_found", "That proposal no longer exists.");
    const updated = update(current);
    const next = { ...withStatus(updated, updated.status), updatedAt: new Date().toISOString() };
    await writeProposal(next);
    return next;
  });
}

/**
 * Applies `change` to every pending proposal it returns a new version for. Called from inside note and
 * folder operations, which already hold the write lock, so it must not take it again. A failure is logged,
 * not thrown: the note operation itself already happened on disk.
 */
async function changePending(change: (p: StoredProposal) => StoredProposal | null): Promise<void> {
  try {
    const now = new Date().toISOString();
    for (const p of await listProposals()) {
      if (p.status !== "pending") continue;
      const next = change(p);
      if (next) await writeProposal({ ...next, updatedAt: now });
    }
  } catch (err) {
    console.error("[write] couldn't update the proposals for a note", err);
  }
}

/** A renamed or moved note keeps its pending proposals. Inside the write lock only. */
export const proposalsFollowNote = (from: NoteRef, to: NoteRef) =>
  changePending((p) => (sameNoteRef(p.note, from) ? { ...p, note: { ...to } } : null));

/** A renamed folder keeps the pending proposals for its notes. Inside the write lock only. */
export const proposalsFollowFolder = (from: string, to: string) =>
  changePending((p) =>
    p.note.folder.normalize("NFC") === from.normalize("NFC")
      ? { ...p, note: { ...p.note, folder: to } }
      : null,
  );

/**
 * A deleted note's (or folder's) pending proposals are closed as "orphaned", so a note made later under
 * the same name doesn't inherit them. Inside the write lock only.
 */
export const orphanProposals = (match: (note: NoteRef) => boolean) =>
  changePending((p) => (match(p.note) ? withStatus(p, "orphaned") : null));
