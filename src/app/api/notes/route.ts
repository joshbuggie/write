import type {
  DiscardNoteResponse,
  NoteResponse,
  SaveNoteResponse,
  UpdateNoteResponse,
} from "@/lib/api-contract";
import { handle, json, noContent, readJson, requireParam } from "@/lib/server/http";
import { createNote, deleteNote, discardIfEmpty, readNote, saveNote, updateNote } from "@/lib/server/storage";
import { isCreateNoteRequest, isSaveNoteRequest, isUpdateNoteRequest } from "@/lib/server/validate";
import type { NoteRef } from "@/lib/types";

/** Names always come from the query string (§1 #2), never from path segments. */
function refFromQuery(req: Request): NoteRef {
  const url = new URL(req.url);
  return { folder: requireParam(url, "folder"), name: requireParam(url, "name") };
}

/** Read one note. `?folder=&name=` */
export const GET = handle(async (req) => {
  const body: NoteResponse = { note: await readNote(refFromQuery(req)) };
  return json(body);
});

/** Create a note; a taken name is auto-suffixed (" 2", " 3"…), so this never returns name_taken. */
export const POST = handle(async (req) => {
  const input = await readJson(req, isCreateNoteRequest);
  const body: NoteResponse = { note: await createNote(input) };
  return json(body, 201);
});

/** Autosave. 409 version_conflict carries `current` so the client can offer "Keep mine / Use disk version". */
export const PUT = handle(async (req) => {
  const { folder, name, content, baseVersion, force } = await readJson(req, isSaveNoteRequest);
  const body: SaveNoteResponse = {
    note: await saveNote({ ref: { folder, name }, content, baseVersion, force }),
  };
  return json(body);
});

/** Rename and/or move a note. */
export const PATCH = handle(async (req) => {
  const { folder, name, newName, newFolder } = await readJson(req, isUpdateNoteRequest);
  const body: UpdateNoteResponse = { note: await updateNote({ ref: { folder, name }, newName, newFolder }) };
  return json(body);
});

/**
 * `?folder=&name=` moves the note to .trash (204).
 * With `&ifEmpty=1` (§17.1) it instead deletes the note only if it is blank, for abandoned "Untitled" notes,
 * and answers 200 `{ deleted }`.
 */
export const DELETE = handle(async (req) => {
  const ref = refFromQuery(req);
  if (new URL(req.url).searchParams.get("ifEmpty") === "1") {
    const body: DiscardNoteResponse = { deleted: await discardIfEmpty(ref) };
    return json(body);
  }
  await deleteNote(ref);
  return noContent();
});
