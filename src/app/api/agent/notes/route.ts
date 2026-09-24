import type { NoteResponse } from "@/lib/api-contract";
import { handleAgent } from "@/lib/server/agent-http";
import { json, requireParam } from "@/lib/server/http";
import { canReadFolder, readNote, StorageError } from "@/lib/server/storage";

/**
 * For integrations (docs/design-decisions.md#d31): one note, `?folder=&name=`, with the version a later
 * proposal is based on. A folder the integration can't read answers exactly like a missing note, so
 * probing can't tell which folders exist.
 */
export const GET = handleAgent(async (req, integration) => {
  const url = new URL(req.url);
  const ref = { folder: requireParam(url, "folder"), name: requireParam(url, "name") };
  const hidden = () => new StorageError("not_found", "Note not found.");
  if (!canReadFolder(integration, ref.folder)) throw hidden();
  const note = await readNote(ref);
  if (!canReadFolder(integration, note.folder)) throw hidden();
  const body: NoteResponse = { note };
  return json(body);
});
