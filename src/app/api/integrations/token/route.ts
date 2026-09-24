import type { IntegrationTokenResponse } from "@/lib/api-contract";
import { handle, json, readJson } from "@/lib/server/http";
import { forgetLastUsed, toIntegrationView } from "@/lib/server/integration-auth";
import { rotateIntegrationToken } from "@/lib/server/storage";
import { isRotateTokenRequest } from "@/lib/server/validate";

/**
 * Replaces an integration's token, for a token that leaked or was lost (docs/design-decisions.md#d31). The
 * old one stops working at once; the new one is in the answer and never shown again.
 */
export const POST = handle(async (req) => {
  const { id } = await readJson(req, isRotateTokenRequest);
  const { integration, token } = await rotateIntegrationToken(id);
  forgetLastUsed(integration.id);
  const body: IntegrationTokenResponse = { integration: toIntegrationView(integration), token };
  return json(body);
});
