import type { AgentProposal, AgentProposalRequest } from "@/lib/api-contract";
import { MAX_NOTE_BYTES } from "@/lib/constants";
import { isOnlyFrontmatter, splitFrontmatter } from "@/lib/markdown/file-format";
import { proposedFromSections } from "@/lib/proposals/apply";
import { buildChanges, reordersSections } from "@/lib/proposals/review";
import { HttpError } from "./http";
import { baseFor } from "./proposal-bases";
import { openChanges } from "./proposal-review";
import {
  addProposal,
  canReadFolder,
  getProposal,
  proposalForRequest,
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
 * What to tell a harness whose whole-note `content` has other front matter than the note's, since that
 * part of what it sent is dropped without a trace: a story wrapped in --- lines is front matter, and
 * resending a story the note holds as front matter adds it a second time. null when they match.
 */
function frontmatterNotice(base: string, content: string): string | null {
  const kept = splitFrontmatter(base).frontmatter;
  if (splitFrontmatter(content).frontmatter.trimEnd() === kept.trimEnd()) return null;
  if (!kept) {
    return "Your content starts with front matter (everything from its first --- line to the next one), and it was left out: a proposal never adds or changes front matter. If that is the note's text, send it again without the leading --- line.";
  }
  return `The note keeps its own front matter (${Buffer.byteLength(kept)} bytes, the block between the --- lines at the top), not what your content has there: a proposal never changes front matter. Only the owner can, in source mode. If that block holds text meant for the note's body, ask the owner to remove it there instead of sending the text again.`;
}

/**
 * Makes a proposal for a note the integration can read. The base is the version the harness read: the
 * note itself when it hasn't changed since, else the text remembered when the harness read it. When
 * neither is at hand (the server restarted), it answers 409 with the note as it is now, to read again.
 * `notice` says when the front matter it sent was not what the note keeps; it is stored with the
 * proposal, so a retry whose first answer was lost still says it.
 */
export async function proposeFromAgent(
  integration: StoredIntegration,
  req: AgentProposalRequest,
): Promise<{ proposal: AgentProposal; created: boolean; notice: string | null }> {
  if (!canReadFolder(integration, req.folder)) throw hidden();
  // A retry answers from what was saved, before anything that needs the version it read: after a restart
  // and an owner edit that version is gone, and the proposal it sent is already there.
  const earlier = req.requestId ? await proposalForRequest(integration.id, req.requestId) : null;
  if (earlier) {
    if (!canReadFolder(integration, earlier.note.folder)) throw hidden();
    const proposal = await toAgentProposal(earlier, integration);
    return { proposal, created: false, notice: earlier.notice ?? null };
  }
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
  if (req.content !== undefined && isOnlyFrontmatter(req.content)) {
    throw new HttpError(
      "bad_request",
      "Nothing was proposed: this content is only front matter. It starts with a --- line, so everything up to the next --- line is front matter, and a proposal never changes front matter: none of it would reach the note. Send the note's text without the leading --- line.",
    );
  }
  const built = req.sections
    ? proposedFromSections(base, req.sections)
    : { ok: true as const, file: toLf(req.content ?? "") };
  if (!built.ok) throw new HttpError("bad_request", built.message);
  const proposed = built.file;
  const notice = req.sections ? null : frontmatterNotice(base, proposed);
  if (Buffer.byteLength(proposed) > MAX_NOTE_BYTES) {
    throw new StorageError("too_large", "The proposed note is larger than 5 MB, the maximum note size.");
  }
  if (reordersSections(base, proposed)) {
    throw new HttpError(
      "bad_request",
      "This proposal moves sections, and write can't apply a move: keep the note's sections in their order and change only their text. Say in your summary if you suggest a different order.",
    );
  }
  if (buildChanges(base, proposed, base).length === 0) {
    const unchanged = "This proposal doesn't change the note (front matter is never changed).";
    throw new HttpError("bad_request", notice ? `${unchanged} ${notice}` : unchanged);
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
    notice,
  });
  // The stored notice: the same change sent again answers with the first proposal, and what it was told.
  return {
    proposal: await toAgentProposal(proposal, integration),
    created,
    notice: proposal.notice ?? null,
  };
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
