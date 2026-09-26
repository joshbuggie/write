import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { type AiSettings, DEFAULT_AI_SETTINGS } from "@/lib/ai/settings";
import { SESSION_COOKIE } from "@/lib/constants";
import { loginHref, SETUP_HREF } from "@/lib/routes";
import type { NoteSendState } from "@/lib/launch/types";
import type { CreatedBy, ProposalSummary } from "@/lib/proposals/types";
import type { Note, NoteRef, Tree } from "@/lib/types";
import { isAuthEnabled, readAuthState, verifySessionToken } from "./auth";
import { sendStateFor } from "./launch/targets";
import { summariesFor } from "./proposal-review";
import {
  createdRecordFor,
  ensureBootstrap,
  listTree,
  mostRecentNote,
  readAiSettings,
  readNote,
  StorageError,
  toAiSettingsView,
} from "./storage";

/**
 * Data access for Server Components (see docs/design-decisions.md#d1). Pages and layouts read through these
 * instead of the API. Every loader calls connection() first so nothing is prerendered at build time (notes
 * live on disk and change at runtime), then re-checks auth as defense in depth behind the proxy.
 */

export { isAuthEnabled };

/**
 * Sends a visitor without a valid session to /login, or to /setup before the account exists. Throws
 * storage_unavailable when the account file can't be read, which the notes layout explains.
 */
export async function requirePageAuth(): Promise<void> {
  const state = await readAuthState();
  if (state.mode === "off") return;
  if (state.mode === "setup") redirect(SETUP_HREF);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(token, state.account)) redirect(loginHref());
}

/**
 * The folder tree. cache() dedupes the call between the notes layout and its page within one request.
 * Throws StorageError("storage_unavailable"); notes/layout.tsx renders <StorageUnavailable> for it.
 */
export const loadTree = cache(async (): Promise<Tree> => {
  await connection();
  await requirePageAuth();
  await ensureBootstrap();
  return listTree();
});

// Keyed by primitives: cache() compares arguments by identity, and callers build fresh NoteRef objects.
const loadNoteCached = cache(async (folder: string, name: string): Promise<Note> => {
  await connection();
  await requirePageAuth();
  try {
    return await readNote({ folder, name });
  } catch (err) {
    if (err instanceof StorageError && err.code === "not_found") notFound();
    throw err;
  }
});

/** One note for the editor page. A missing note renders the nearest not-found.tsx. */
export const loadNote = (ref: NoteRef): Promise<Note> => loadNoteCached(ref.folder, ref.name);

/** Where "/" should send the user: the most recently edited note, or null when there are none. */
export async function loadMostRecentNote(): Promise<NoteRef | null> {
  await connection();
  await requirePageAuth();
  await ensureBootstrap();
  return mostRecentNote();
}

/**
 * The signed-in account's username for Settings, or null while sign-in is off. Only the name: the hash
 * and session secret never leave the server.
 */
export const loadUsername = cache(async (): Promise<string | null> => {
  await connection();
  await requirePageAuth();
  const state = await readAuthState();
  return state.mode === "on" ? state.account.username : null;
});

/**
 * The AI settings as the browser may see them (keys reduced to their last four characters). A broken
 * settings file must never take the notes down, so any error is logged and the assistant reads as off.
 */
export const loadAiSettings = cache(async (): Promise<AiSettings> => {
  await connection();
  await requirePageAuth();
  try {
    return toAiSettingsView(await readAiSettings());
  } catch (err) {
    console.error("[write] Couldn't read the AI settings, so the assistant is off:", err);
    return DEFAULT_AI_SETTINGS;
  }
});

/**
 * The note's pending proposals, for the banner above it (docs/design-decisions.md#d31). A problem reading
 * them must never keep the note from opening, so any error is logged and the banner stays away.
 */
export async function loadNoteProposals(note: Note): Promise<ProposalSummary[]> {
  await connection();
  await requirePageAuth();
  try {
    return await summariesFor(note);
  } catch (err) {
    console.error("[write] Couldn't read the note's proposals:", err);
    return [];
  }
}

/**
 * Where this note can be sent, and which jobs are still working on it (docs/design-decisions.md#d31). Like
 * the proposals, a problem here must never keep the note from opening.
 */
export async function loadSendState(note: Note): Promise<NoteSendState> {
  await connection();
  await requirePageAuth();
  try {
    return await sendStateFor(note);
  } catch (err) {
    console.error("[write] Couldn't read where the note can be sent:", err);
    return { targets: [], working: [] };
  }
}

/**
 * Which integration created this note, if one did and the owner hasn't dismissed it
 * (docs/design-decisions.md#d31). Like the proposals, a problem here must never keep the note from opening.
 */
export async function loadCreatedBy(note: Note): Promise<CreatedBy | null> {
  await connection();
  await requirePageAuth();
  try {
    const record = await createdRecordFor(note);
    return record && { id: record.id, source: record.source, createdAt: record.createdAt };
  } catch (err) {
    console.error("[write] Couldn't read who created the note:", err);
    return null;
  }
}
