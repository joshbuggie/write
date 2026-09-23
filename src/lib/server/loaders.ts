import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { type AiSettings, DEFAULT_AI_SETTINGS } from "@/lib/ai/settings";
import { SESSION_COOKIE } from "@/lib/constants";
import { loginHref } from "@/lib/routes";
import type { Note, NoteRef, Tree } from "@/lib/types";
import { isAuthEnabled, verifySessionToken } from "./auth";
import {
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

/** If WRITE_PASSWORD is set and the session cookie is invalid, redirect to the login page. */
export async function requirePageAuth(): Promise<void> {
  if (!isAuthEnabled()) return;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(token)) redirect(loginHref());
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
