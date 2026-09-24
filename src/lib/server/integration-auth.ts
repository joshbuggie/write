import type { IntegrationView } from "@/lib/integrations";
import { isTokenShaped } from "@/lib/integrations";
import { findIntegrationByToken, type StoredIntegration } from "./storage";

/**
 * Who is calling /api/agent (docs/design-decisions.md#d31): the integration whose token is in
 * `Authorization: Bearer wrt_…`. Integration tokens open only these routes, and these routes accept only
 * integration tokens, even with sign-in off, because the token is what says which folders are readable.
 */

// "Last used" is kept in memory: saving it would rewrite the config file on every agent request. It lives
// on globalThis so the proxy and the route handlers share it, like the lockout (docs/design-decisions.md#d12).
const store = globalThis as typeof globalThis & { __writeIntegrationLastUsed?: Map<string, string> };
const lastUsed = (store.__writeIntegrationLastUsed ??= new Map<string, string>());

/** The bearer token from the request, if it has the shape of an integration token. */
function bearerToken(req: Request): string | null {
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)\s*$/i);
  return match && isTokenShaped(match[1]) ? match[1] : null;
}

/**
 * The integration that sent this request, or null for a missing, malformed or unknown token. Records the
 * time as its "last used". Throws storage_unavailable when integrations.json can't be read, so a broken
 * file fails closed.
 */
export async function authenticateIntegration(req: Request): Promise<StoredIntegration | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const integration = await findIntegrationByToken(token);
  if (integration) lastUsed.set(integration.id, new Date().toISOString());
  return integration;
}

/** The browser's view: no hash, and "last used" from memory. */
export function toIntegrationView(i: StoredIntegration): IntegrationView {
  return {
    id: i.id,
    name: i.name,
    kind: i.kind,
    folders: i.folders,
    tokenHint: i.tokenHint,
    createdAt: i.createdAt,
    lastUsedAt: lastUsed.get(i.id) ?? null,
  };
}

/** Forgets when this integration was last used, after its token is replaced: the new one hasn't been yet. */
export function forgetLastUsed(id: string): void {
  lastUsed.delete(id);
}

/** Forgets every "last used" time. Tests only. */
export function resetIntegrationLastUsed(): void {
  lastUsed.clear();
}
