import type { NoteResponse } from "@/lib/api-contract";
import { agentReadNote } from "@/lib/server/agent-actions";
import { handleAgent } from "@/lib/server/agent-http";
import { json, requireParam } from "@/lib/server/http";

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
