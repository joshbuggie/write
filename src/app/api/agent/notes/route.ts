import type { AgentCreateNoteResponse, NoteResponse } from "@/lib/api-contract";
import { agentCreateNote, agentReadNote } from "@/lib/server/agent-actions";
import { handleAgent } from "@/lib/server/agent-http";
import { json, MAX_NOTE_JSON_BYTES, readJson, requireParam } from "@/lib/server/http";
import { isAgentCreateNoteRequest } from "@/lib/server/validate-proposals";

/**
 * For integrations (docs/design-decisions.md#d31): one note, `?folder=&name=`, with the version a later
 * proposal is based on. A folder the integration can't read answers exactly like a missing note.
 */
export const GET = handleAgent(async (req, integration) => {
  const url = new URL(req.url);
  const ref = { folder: requireParam(url, "folder"), name: requireParam(url, "name") };
  const body: NoteResponse = { note: await agentReadNote(integration, ref) };
  return json(body);
});

/**
 * A new note, for an integration the owner let create them: 201, or 200 with the same note when the
 * request is sent again. 403 without that permission, 409 name_taken for a name already in use.
 */
export const POST = handleAgent(async (req, integration) => {
  const input = await readJson(req, isAgentCreateNoteRequest, MAX_NOTE_JSON_BYTES);
  const { note, created } = await agentCreateNote(integration, input);
  const body: AgentCreateNoteResponse = {
    note: { folder: note.folder, name: note.name, version: note.version },
  };
  return json(body, created ? 201 : 200);
});
