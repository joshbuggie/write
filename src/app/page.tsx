import { redirect } from "next/navigation";
import { LIBRARY_HREF, noteHref } from "@/lib/routes";
import { loadMostRecentNote } from "@/lib/server/loaders";
import { StorageError } from "@/lib/server/storage";
import type { NoteRef } from "@/lib/types";

/**
 * "/" has no UI of its own: it reopens the most recently modified note, or the library when there are none.
 * Storage failures fall through to /notes, whose layout explains them.
 */
export default async function Home() {
  let recent: NoteRef | null = null;
  try {
    recent = await loadMostRecentNote();
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
  }
  redirect(recent ? noteHref(recent) : LIBRARY_HREF);
}
