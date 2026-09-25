import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { IntegrationKind } from "@/lib/integrations";
import type { NoteRef } from "@/lib/types";
import { getDataDir } from "./config";
import { atomicWrite, errorCode, mapFsError } from "./fs-utils";
import { withWriteLock } from "./mutex";
import { PROPOSALS_DIR } from "./proposals-file";
import { sameNoteRef } from "./proposals";

/**
 * Jobs write started in a harness with "Send to…" (docs/design-decisions.md#d31): one JSON file each in
 * `.proposals/jobs/`. A job remembers the harness's own reference (Turnstone's workstream, Hermes's
 * session), so the next "Send to…" for the same note continues that conversation instead of starting over.
 */

/** The harness's reference for a job, whatever it needs to continue it. */
export interface JobRef {
  /** Turnstone: the workstream or coordinator. */
  wsId?: string;
  /** Turnstone: whether `wsId` is a coordinator, which the console itself hosts. */
  coordinator?: boolean;
  /** Hermes Agent: the session the runs share. */
  sessionId?: string;
  /** Hermes Agent: the run itself. */
  runId?: string;
}

export interface StoredJob {
  /** 32 hex characters: Turnstone takes it as the workstream id, Hermes as the idempotency key. */
  id: string;
  integrationId: string;
  kind: IntegrationKind;
  note: NoteRef;
  instruction: string;
  sections: string[];
  ref: JobRef;
  continued: boolean;
  /** ISO 8601. */
  createdAt: string;
}

const ID = /^[0-9a-f]{32}$/;
/** Jobs older than this are removed when a new one is saved; by then the conversation has gone cold. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const dir = () => path.join(getDataDir(), PROPOSALS_DIR, "jobs");

function parse(text: string): StoredJob | null {
  try {
    const v = JSON.parse(text) as Partial<StoredJob> & { version?: number };
    if (v.version !== 1 || typeof v.id !== "string" || !ID.test(v.id) || !v.note || !v.ref) return null;
    const job: Record<string, unknown> = { ...v };
    delete job.version; // the file format's version, not part of the job
    return job as unknown as StoredJob;
  } catch {
    return null;
  }
}

/** Every job on disk, newest first. Files that aren't valid are skipped. */
export async function listJobs(): Promise<StoredJob[]> {
  let names: string[];
  try {
    names = await readdir(dir());
  } catch (err) {
    if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return [];
    throw mapFsError(err);
  }
  const jobs = await Promise.all(
    names
      .filter((n) => ID.test(n.replace(/\.json$/, "")))
      .map(async (n) => parse(await readFile(path.join(dir(), n), "utf8").catch(() => ""))),
  );
  return jobs
    .filter((j): j is StoredJob => j !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The newest job this integration has for the note, to continue, or null. */
export async function latestJob(integrationId: string, note: NoteRef): Promise<StoredJob | null> {
  return (
    (await listJobs()).find((j) => j.integrationId === integrationId && sameNoteRef(j.note, note)) ?? null
  );
}

async function writeJob(job: StoredJob): Promise<void> {
  try {
    await mkdir(dir(), { recursive: true });
  } catch (err) {
    throw mapFsError(err);
  }
  const text = JSON.stringify({ version: 1, ...job }, null, 2) + "\n";
  await atomicWrite(path.join(dir(), `${job.id}.json`), Buffer.from(text, "utf8"));
}

/** Saves a job, removing ones gone cold. */
export function saveJob(job: StoredJob): Promise<void> {
  return withWriteLock(async () => {
    const cutoff = Date.now() - KEEP_MS;
    for (const old of await listJobs()) {
      if (Date.parse(old.createdAt) >= cutoff) continue;
      await unlink(path.join(dir(), `${old.id}.json`)).catch(() => {});
    }
    await writeJob(job);
  });
}

/**
 * Jobs follow their note through renames and moves, so "Send to…" still continues the same conversation.
 * Called inside note and folder operations, which hold the write lock. Failures are logged, not thrown.
 */
export async function jobsFollowNote(match: (note: NoteRef) => NoteRef | null): Promise<void> {
  try {
    for (const job of await listJobs()) {
      const to = match(job.note);
      if (to) await writeJob({ ...job, note: to });
    }
  } catch (err) {
    console.error("[write] couldn't update the jobs for a note", err);
  }
}
