import { checkCsrf, errorResponse, HttpError } from "./http";
import { authenticateIntegration } from "./integration-auth";
import type { StoredIntegration } from "./storage";

/**
 * handle() for the routes agents call (/api/agent, docs/design-decisions.md#d31): the same CSRF check and
 * error mapping, but the caller must be an integration, and the handler learns which one, so it can keep
 * to that integration's folders. A session cookie or the account password is not enough here.
 */

/** The message for a request to /api/agent without a working integration token. */
export const AGENT_UNAUTHORIZED =
  "Send an integration token as `Authorization: Bearer wrt_…`. Make one in write under Integrations.";

/** Wrap every /api/agent Route Handler: integration token → CSRF (non-GET/HEAD) → fn → error mapping. */
export function handleAgent(
  fn: (req: Request, integration: StoredIntegration) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      const integration = await authenticateIntegration(req);
      if (!integration) throw new HttpError("unauthorized", AGENT_UNAUTHORIZED);
      checkCsrf(req);
      return await fn(req, integration);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
