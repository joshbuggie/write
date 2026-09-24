import type { ResolveProposalResponse } from "@/lib/api-contract";
import { handle, json, readJson } from "@/lib/server/http";
import { resolveProposal } from "@/lib/server/proposal-review";
import { isResolveProposalRequest } from "@/lib/server/validate-proposals";

/**
 * The owner's decisions on a proposal (docs/design-decisions.md#d31): accepted sections go into the note
 * in one save, conditional on the version the review was worked out against.
 */
export const POST = handle(async (req) => {
  const body: ResolveProposalResponse = await resolveProposal(await readJson(req, isResolveProposalRequest));
  return json(body);
});
