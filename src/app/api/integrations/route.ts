import type { IntegrationResponse, IntegrationsResponse, IntegrationTokenResponse } from "@/lib/api-contract";
import { handle, json, noContent, readJson, requireParam } from "@/lib/server/http";
import { toIntegrationView } from "@/lib/server/integration-auth";
import {
  createIntegration,
  deleteIntegration,
  readIntegrations,
  updateIntegration,
} from "@/lib/server/storage";
import { isIntegrationRequest, isUpdateIntegrationRequest } from "@/lib/server/validate-integrations";

/**
 * The Integrations dialog's API (docs/design-decisions.md#d31). Signed-in owner only: an integration token
 * can't manage integrations, so an agent can't widen its own folders or mint more tokens.
 */

/** Every integration, without tokens. */
export const GET = handle(async () => {
  const body: IntegrationsResponse = { integrations: (await readIntegrations()).map(toIntegrationView) };
  return json(body);
});

/** Makes an integration. The answer carries its token, the only time it is ever shown. */
export const POST = handle(async (req) => {
  const { name, kind, folders, launcher } = await readJson(req, isIntegrationRequest);
  const { integration, token } = await createIntegration({ name, kind, folders, launcher });
  const body: IntegrationTokenResponse = { integration: toIntegrationView(integration), token };
  return json(body, 201);
});

/** Changes an integration's name, kind, folders or launcher. Its token keeps working. */
export const PATCH = handle(async (req) => {
  const { id, name, kind, folders, launcher } = await readJson(req, isUpdateIntegrationRequest);
  const body: IntegrationResponse = {
    integration: toIntegrationView(await updateIntegration(id, { name, kind, folders, launcher })),
  };
  return json(body);
});

/** `?id=` removes the integration; its token stops working at once. */
export const DELETE = handle(async (req) => {
  await deleteIntegration(requireParam(new URL(req.url), "id"));
  return noContent();
});
