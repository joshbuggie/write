import type { AgentTreeResponse } from "@/lib/api-contract";
import { handleAgent } from "@/lib/server/agent-http";
import { json } from "@/lib/server/http";
import { canReadFolder, listTree } from "@/lib/server/storage";

/**
 * For integrations (docs/design-decisions.md#d31): the folders this integration can read, with their notes.
 * Other folders are left out entirely, so their names aren't shown either.
 */
export const GET = handleAgent(async (_req, integration) => {
  const tree = await listTree();
  const body: AgentTreeResponse = { folders: tree.folders.filter((f) => canReadFolder(integration, f.name)) };
  return json(body);
});
