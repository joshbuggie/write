import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { ChangeDecision, ProposalStatus } from "@/lib/proposals/types";
import type { NoteRef } from "@/lib/types";
import { getDataDir } from "./config";
import { StorageError } from "./errors";
import { atomicWrite, errorCode, mapFsError } from "./fs-utils";

/**
 * Proposals on disk (docs/design-decisions.md#d31): one JSON file each in `<dataDir>/.proposals/`. They
 * hold note text awaiting review, so they live with the notes, and the folder is hidden like `.trash`:
 * never listed, exported or reachable as a note.
 */

export const PROPOSALS_DIR = ".proposals";
const FILE_VERSION = 1;
const ID = /^[0-9a-f]{16}$/;

/** A proposal as saved. `base` and `proposed` are whole files, front matter included. */
export interface StoredProposal {
  id: string;
  integrationId: string;
  /** The integration's name when it proposed, so the review can say who it came from. */
  source: string;
  /** The harness's own id for the request, to make a retried request harmless. */
  requestId: string | null;
  /** On-disk names of the note it is for. */
  note: NoteRef;
  baseVersion: string;
  base: string;
  proposed: string;
  summary: string;
  /** Why each section changed, by heading text as the harness wrote it. */
  reasons: Record<string, string>;
  status: ProposalStatus;
  decisions: ChangeDecision[];
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

/** True for an id write could have made; anything else is never joined into a path. */
export const isProposalId = (id: string) => ID.test(id);

const dir = () => path.join(getDataDir(), PROPOSALS_DIR);
const fileOf = (id: string) => path.join(dir(), `${id}.json`);

const isString = (v: unknown): v is string => typeof v === "string";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parse(text: string): StoredProposal | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(v) || v.version !== FILE_VERSION || !isString(v.id) || !isProposalId(v.id)) return null;
  const note = v.note;
  const ok =
    isString(v.integrationId) &&
    isString(v.source) &&
    (v.requestId === null || isString(v.requestId)) &&
    isRecord(note) &&
    isString(note.folder) &&
    isString(note.name) &&
    isString(v.baseVersion) &&
    isString(v.base) &&
    isString(v.proposed) &&
    isString(v.summary) &&
    isRecord(v.reasons) &&
    isString(v.status) &&
    Array.isArray(v.decisions) &&
    isString(v.createdAt) &&
    isString(v.updatedAt);
  if (!ok) return null;
  const proposal: Record<string, unknown> = { ...v };
  delete proposal.version; // the file format's version, not part of the proposal
  return proposal as unknown as StoredProposal;
}

/** One proposal, or null when there is none by that id (or its file isn't one write can read). */
export async function readProposal(id: string): Promise<StoredProposal | null> {
  if (!isProposalId(id)) return null;
  try {
    return parse(await readFile(fileOf(id), "utf8"));
  } catch (err) {
    if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return null;
    throw mapFsError(err);
  }
}

/** Every proposal on disk, oldest first. Files that aren't valid are skipped. */
export async function listProposals(): Promise<StoredProposal[]> {
  let names: string[];
  try {
    names = await readdir(dir());
  } catch (err) {
    if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return [];
    throw mapFsError(err);
  }
  const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
  const all = await Promise.all(ids.filter(isProposalId).map(readProposal));
  return all
    .filter((p): p is StoredProposal => p !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Saves a proposal (atomically). Call inside withWriteLock. */
export async function writeProposal(proposal: StoredProposal): Promise<void> {
  if (!isProposalId(proposal.id)) throw new StorageError("bad_request", "Not a proposal id.");
  try {
    await mkdir(dir(), { recursive: true });
  } catch (err) {
    throw mapFsError(err);
  }
  const text = JSON.stringify({ version: FILE_VERSION, ...proposal }, null, 2) + "\n";
  await atomicWrite(fileOf(proposal.id), Buffer.from(text, "utf8"));
}

/** Removes a resolved proposal's file for good. Call inside withWriteLock. */
export async function removeProposalFile(id: string): Promise<void> {
  if (!isProposalId(id)) return;
  try {
    await unlink(fileOf(id));
  } catch (err) {
    if (errorCode(err) !== "ENOENT") throw mapFsError(err);
  }
}
