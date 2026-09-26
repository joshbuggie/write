import type { AgentProposalResponse } from "@/lib/api-contract";
import { handleAgent } from "@/lib/server/agent-http";
import { json, MAX_NOTE_JSON_BYTES, readJson, requireParam } from "@/lib/server/http";
import { agentProposal, proposeFromAgent } from "@/lib/server/proposal-service";
import { isAgentProposalRequest } from "@/lib/server/validate-proposals";

/**
 * For integrations (docs/design-decisions.md#d31): propose changes to a note, and see what the owner
 * decided. A proposal never changes the note; the owner reviews it section by section in write.
 */

/** Makes a proposal: 201, or 200 with the first one when the same request is sent again. */
export const POST = handleAgent(async (req, integration) => {
  const input = await readJson(req, isAgentProposalRequest, MAX_NOTE_JSON_BYTES);
  const { proposal, created } = await proposeFromAgent(integration, input);
  const body: AgentProposalResponse = { proposal };
  return json(body, created ? 201 : 200);
});

/** `?id=`: where one of this integration's proposals stands. */
export const GET = handleAgent(async (req, integration) => {
  const body: AgentProposalResponse = {
    proposal: await agentProposal(integration, requireParam(new URL(req.url), "id")),
  };
  return json(body);
});
