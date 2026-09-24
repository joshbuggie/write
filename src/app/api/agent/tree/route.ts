import type { AgentTreeResponse } from "@/lib/api-contract";
import { agentTree } from "@/lib/server/agent-actions";
import { handleAgent } from "@/lib/server/agent-http";
import { json } from "@/lib/server/http";

/**
 * For integrations (docs/design-decisions.md#d31): the folders this integration can read, with their notes.
 * Other folders are left out entirely, so their names aren't shown either.
 */
export const GET = handleAgent(async (_req, integration) => {
  const body: AgentTreeResponse = await agentTree(integration);
  return json(body);
});
