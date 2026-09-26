import { handleAgent } from "@/lib/server/agent-http";
import { HttpError, json, MAX_NOTE_JSON_BYTES, readJson } from "@/lib/server/http";
import { failure, isMessage, RPC, type Reply } from "@/lib/server/mcp/jsonrpc";
import { handleMessage } from "@/lib/server/mcp/server";

/**
 * The MCP endpoint for integrations (docs/design-decisions.md#d31): Streamable HTTP, stateless, tools only,
 * behind the same integration token and folders as the rest of /api/agent. Every answer is plain JSON; no
 * SSE stream, no session.
 */

const send = (reply: Reply) =>
  reply.body ? json(reply.body, reply.status) : new Response(null, { status: reply.status });

/**
 * The spec requires refusing a request whose Origin names another site (DNS rebinding). Agents are
 * servers and send no Origin; a browser page on write itself sends write's own.
 */
function foreignOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

const anyJson = (v: unknown): v is unknown => v !== undefined;

export const POST = handleAgent(async (req, integration) => {
  if (foreignOrigin(req))
    return send(failure(null, RPC.invalidRequest, "Requests from other sites are not allowed.", 403));
  let body: unknown;
  try {
    body = await readJson(req, anyJson, MAX_NOTE_JSON_BYTES);
  } catch (err) {
    if (err instanceof HttpError && err.code === "bad_request")
      return send(failure(null, RPC.parseError, "Parse error", 400));
    throw err;
  }
  if (Array.isArray(body)) {
    // A batch, which 2025-03-26 clients may send: each message answered in order, notifications skipped.
    const answers = [];
    for (const m of body) {
      const reply = isMessage(m)
        ? await handleMessage(m, integration, req.headers)
        : failure(null, RPC.invalidRequest, "Invalid request");
      if (reply.body) answers.push(reply.body);
    }
    return answers.length ? json(answers) : new Response(null, { status: 202 });
  }
  if (!isMessage(body)) return send(failure(null, RPC.invalidRequest, "Invalid request", 400));
  return send(await handleMessage(body, integration, req.headers));
});

/**
 * No server-to-client stream and no sessions: GET and DELETE are 405, as the spec asks. The body is a
 * JSON-RPC error, so a client probing the endpoint (Hermes Agent does) sees an MCP answer, not a web page.
 */
const notAllowed = () => {
  const { body } = failure(null, RPC.invalidRequest, "Method not allowed: send JSON-RPC messages with POST.");
  return json(body, 405, { Allow: "POST" });
};
export const GET = notAllowed;
export const DELETE = notAllowed;
