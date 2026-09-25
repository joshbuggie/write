import type { NoteSendState } from "@/lib/launch/types";
import type { Note } from "@/lib/types";
import { canReadFolder, listJobs, readIntegrations, type StoredJob } from "../storage";
import { listProposals } from "../storage/proposals-file";
import { sameNoteRef } from "../storage/proposals";

/**
 * What the note screen needs for "Send to…" (docs/design-decisions.md#d31): the harnesses this note can be
 * sent to (a launcher, and the note's folder among its folders), and the jobs still working on it, so the
 * note can say so until their proposal arrives. Read-only, like every loader.
 */

/** A job still counts as working this long; a harness that never answers doesn't leave the note waiting. */
const WORKING_MS = 60 * 60 * 1000;

export async function sendStateFor(note: Note): Promise<NoteSendState> {
  const ref = { folder: note.folder, name: note.name };
  const integrations = await readIntegrations();
  const jobs = (await listJobs()).filter((j) => sameNoteRef(j.note, ref));
  const targets = integrations
    .filter((i) => i.launcher && canReadFolder(i, note.folder))
    .map((i) => ({
      integrationId: i.id,
      name: i.name,
      kind: i.kind,
      hasConversation: jobs.some((j) => j.integrationId === i.id),
    }));

  const recent = jobs.filter((j) => Date.now() - Date.parse(j.createdAt) < WORKING_MS);
  if (recent.length === 0) return { targets, working: [] };
  const proposals = (await listProposals()).filter((p) => sameNoteRef(p.note, ref));
  const answered = (j: StoredJob) =>
    proposals.some(
      (p) => p.requestId === j.id || (p.integrationId === j.integrationId && p.createdAt > j.createdAt),
    );
  const names = new Map(integrations.map((i) => [i.id, i.name]));
  const working = recent
    .filter((j) => !answered(j))
    .map((j) => ({
      jobId: j.id,
      source: names.get(j.integrationId) ?? "The harness",
      createdAt: j.createdAt,
    }));
  return { targets, working };
}
