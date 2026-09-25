import type { AgentProposal, AgentProposalRequest } from "@/lib/api-contract";
import { MAX_NOTE_BYTES } from "@/lib/constants";
import { proposedFromSections } from "@/lib/proposals/apply";
import { buildChanges } from "@/lib/proposals/review";
import { HttpError } from "./http";
import { baseFor } from "./proposal-bases";
import { openChanges } from "./proposal-review";
import {
  addProposal,
  canReadFolder,
  getProposal,
  readNote,
  StorageError,
  type StoredIntegration,
  type StoredProposal,
} from "./storage";

/**
 * Proposals from the harness's side (docs/design-decisions.md#d31): making one from what it sends, and
 * telling it where one stands. Its folders limit both, and a note outside them reads as missing.
 */

const hidden = () => new StorageError("not_found", "Note not found.");
const toLf = (s: string) => s.replace(/\r\n?/g, "\n");

/**
 * Makes a proposal for a note the integration can read. The base is the version the harness read: the
 * note itself when it hasn't changed since, else the text remembered when the harness read it. When
 * neither is at hand (the server restarted), it answers 409 with the note as it is now, to read again.
 */
export async function proposeFromAgent(
  integration: StoredIntegration,
  req: AgentProposalRequest,
): Promise<{ proposal: AgentProposal; created: boolean }> {
  if (!canReadFolder(integration, req.folder)) throw hidden();
  const note = await readNote({ folder: req.folder, name: req.name });
  if (!canReadFolder(integration, note.folder)) throw hidden();
  if (note.readOnly) {
    throw new StorageError("read_only", "This note can't be edited in write, so it can't take proposals.");
  }
  const base = note.version === req.baseVersion ? note.content : baseFor(req.baseVersion);
  if (base === null) {
    throw new StorageError(
      "version_conflict",
      "This note changed since you read it, and write no longer has the version you read. Read the note again and send your changes against the new version.",
      note,
    );
  }
  const built = req.sections
    ? proposedFromSections(base, req.sections)
    : { ok: true as const, file: toLf(req.content ?? "") };
  if (!built.ok) throw new HttpError("bad_request", built.message);
  const proposed = built.file;
  if (Buffer.byteLength(proposed) > MAX_NOTE_BYTES) {
    throw new StorageError("too_large", "The proposed note is larger than 5 MB, the maximum note size.");
  }
  if (buildChanges(base, proposed, base).length === 0) {
    throw new HttpError(
      "bad_request",
      "This proposal doesn't change the note (front matter is never changed).",
    );
  }
  const { proposal, created } = await addProposal({
    integrationId: integration.id,
    source: integration.name,
    requestId: req.requestId ?? null,
    note: { folder: note.folder, name: note.name },
    baseVersion: req.baseVersion,
    base,
    proposed,
    summary: req.summary?.trim() ?? "",
    reasons: req.reasons ?? {},
  });
  return { proposal: await toAgentProposal(proposal, integration), created };
}

/** The proposal's note, or null when it is gone. */
async function readNoteIfThere(p: StoredProposal) {
  try {
    return await readNote(p.note);
  } catch (err) {
    if (err instanceof StorageError && err.code === "not_found") return null;
    throw err;
  }
}

/**
 * Where a proposal stands, read against the note as it is now. A note whose folder the integration can no
 * longer read tells it nothing more about the note.
 */
async function toAgentProposal(p: StoredProposal, integration: StoredIntegration): Promise<AgentProposal> {
  let noteVersion: string | null = null;
  let waiting = 0;
  const note = canReadFolder(integration, p.note.folder) ? await readNoteIfThere(p) : null;
  if (note) {
    noteVersion = note.version;
    if (p.status === "pending" && !note.readOnly) waiting = openChanges(p, note.content).length;
  }
  return {
    id: p.id,
    status: p.status,
    note: p.note,
    summary: p.summary,
    createdAt: p.createdAt,
    waiting,
    decisions: p.decisions,
    noteVersion,
  };
}

/** One of this integration's proposals; any other id reads as missing. */
export async function agentProposal(integration: StoredIntegration, id: string): Promise<AgentProposal> {
  const p = await getProposal(id);
  if (!p || p.integrationId !== integration.id) throw new StorageError("not_found", "Proposal not found.");
  return toAgentProposal(p, integration);
}
