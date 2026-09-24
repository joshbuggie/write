import type { TestConnectionResponse } from "@/lib/api-contract";
import { listModels } from "@/lib/server/ai";
import { handle, HttpError, json, readJson } from "@/lib/server/http";
import { apiKeyFor } from "@/lib/server/storage";
import { isTestConnectionRequest } from "@/lib/server/validate";

/**
 * The answer once the browser gave up (the dialog or the tab closed) before the model server answered.
 * Nobody reads it, and it isn't a server error to log; 499 is the usual status for a request the client
 * closed.
 */
const clientClosed = () => new Response(null, { status: 499, headers: { "Cache-Control": "no-store" } });

/**
 * "Test connection" (see docs/design-decisions.md#d29): lists the models a connection's server offers,
 * for the connection as the Settings form has it, saved or not. It works while the assistant is switched
 * off, because this is how it gets set up. The key is the typed one, else the saved one of the same
 * connection while its URL stays on the origin the key was saved for.
 * 400 bad_request (no server URL, bad fields), 502 ai_unreachable / ai_upstream, 503 storage_unavailable.
 */
export const POST = handle(async (req) => {
  const { connection } = await readJson(req, isTestConnectionRequest);
  const baseUrl = connection.baseUrl.trim();
  if (baseUrl === "") throw new HttpError("bad_request", "Enter the server URL first.");
  const apiKey = await apiKeyFor(connection);
  try {
    const body: TestConnectionResponse = {
      models: await listModels({ provider: connection.provider, baseUrl, apiKey }, req.signal),
    };
    return json(body);
  } catch (err) {
    if (req.signal.aborted) return clientClosed();
    throw err;
  }
});
