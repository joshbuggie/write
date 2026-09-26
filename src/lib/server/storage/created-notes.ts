import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Note, NoteRef } from "@/lib/types";
import { getDataDir } from "./config";
import { atomicWrite, errorCode, mapFsError, randomHex } from "./fs-utils";
import { withWriteLock } from "./mutex";
import { createNoteUnlocked, readNote } from "./notes";
import { PROPOSALS_DIR } from "./proposals-file";
import { sameNoteRef } from "./proposals";

/**
 * Notes an integration created (docs/design-decisions.md#d31), kept in `.proposals/created.json` so the
 * note can say who made it until the owner dismisses that, and so a retried create (same requestId)
 * returns the note instead of failing on its own name. Records follow their note through renames and go
 * with it when it is deleted, so a note made later under the same name never inherits one.
 */

export interface CreatedRecord {
  id: string;
  integrationId: string;
  /** The integration's name when it created the note. */
  source: string;
  requestId: string | null;
  /** On-disk names of the note. */
  note: NoteRef;
  /** ISO 8601. */
  createdAt: string;
}

const FILE_VERSION = 1;
/** Older records are dropped when a new one is added; by then the owner has long seen the note. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const file = () => path.join(getDataDir(), PROPOSALS_DIR, "created.json");

const isRecord = (v: unknown): v is CreatedRecord => {
  const r = v as Partial<CreatedRecord> | null;
  return (
    typeof r?.id === "string" &&
    typeof r.integrationId === "string" &&
    typeof r.source === "string" &&
    (r.requestId === null || typeof r.requestId === "string") &&
    typeof r.note?.folder === "string" &&
    typeof r.note.name === "string" &&
    typeof r.createdAt === "string"
  );
};

/** Every record; a missing or unreadable file reads as none, since they only label notes. */
async function readRecords(): Promise<CreatedRecord[]> {
  let text: string;
  try {
    text = await readFile(file(), "utf8");
  } catch (err) {
    if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return [];
    throw mapFsError(err);
  }
  try {
    const v = JSON.parse(text) as { version?: unknown; created?: unknown };
    return v.version === FILE_VERSION && Array.isArray(v.created) ? v.created.filter(isRecord) : [];
  } catch {
    return [];
  }
}

async function writeRecords(records: CreatedRecord[]): Promise<void> {
  try {
    await mkdir(path.dirname(file()), { recursive: true });
  } catch (err) {
    throw mapFsError(err);
  }
  const text = JSON.stringify({ version: FILE_VERSION, created: records }, null, 2) + "\n";
  await atomicWrite(file(), Buffer.from(text, "utf8"));
}

/**
 * Creates a note for an integration under exactly the name it gave (name_taken otherwise, never " 2") and
 * records who made it. A request it sent before returns that note, `created: false`, while it still exists.
 */
export function createNoteFor(input: {
  integrationId: string;
  source: string;
  requestId: string | null;
  ref: NoteRef;
  content: string;
}): Promise<{ note: Note; created: boolean }> {
  return withWriteLock(async () => {
    const records = await readRecords();
    const earlier = input.requestId
      ? records.find((r) => r.integrationId === input.integrationId && r.requestId === input.requestId)
      : undefined;
    if (earlier) {
      const note = await readNote(earlier.note).catch(() => null);
      if (note) return { note, created: false };
    }
    const note = await createNoteUnlocked({ ...input.ref, content: input.content, exact: true });
    const cutoff = Date.now() - KEEP_MS;
    const record: CreatedRecord = {
      id: randomHex(8),
      integrationId: input.integrationId,
      source: input.source,
      requestId: input.requestId,
      note: { folder: note.folder, name: note.name },
      createdAt: new Date().toISOString(),
    };
    try {
      await writeRecords([...records.filter((r) => Date.parse(r.createdAt) >= cutoff), record]);
    } catch (err) {
      // The note exists either way; only its "created by" line is missing.
      console.error("[write] couldn't record who created a note", err);
    }
    return { note, created: true };
  });
}

/** Who created this note, if an integration did and the owner hasn't dismissed it. */
export async function createdRecordFor(ref: NoteRef): Promise<CreatedRecord | null> {
  return (await readRecords()).find((r) => sameNoteRef(r.note, ref)) ?? null;
}

/** Forgets a record: the note stops saying who created it. Unknown ids are fine. */
export function dismissCreatedRecord(id: string): Promise<void> {
  return withWriteLock(async () => {
    const records = await readRecords();
    if (records.some((r) => r.id === id)) await writeRecords(records.filter((r) => r.id !== id));
  });
}

/**
 * Moves each record `match` gives a new note for, and drops each it returns "drop" for. Called inside note
 * and folder operations, which hold the write lock. Failures are logged, not thrown.
 */
export async function createdFollowNote(match: (note: NoteRef) => NoteRef | "drop" | null): Promise<void> {
  try {
    const records = await readRecords();
    let changed = false;
    const next: CreatedRecord[] = [];
    for (const r of records) {
      const to = match(r.note);
      if (to !== null) changed = true;
      if (to === null) next.push(r);
      else if (to !== "drop") next.push({ ...r, note: to });
    }
    if (changed) await writeRecords(next);
  } catch (err) {
    console.error("[write] couldn't update who created a note", err);
  }
}
