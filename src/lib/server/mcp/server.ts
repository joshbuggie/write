import type { StoredIntegration } from "../storage";
import { SERVER_INSTRUCTIONS } from "./instructions";
import { failure, isNotification, result, RPC, type JsonRpcMessage, type Reply } from "./jsonrpc";
import { isToolName, TOOL_DEFINITIONS } from "./tool-definitions";
import { callTool } from "./tools";
import { classify, SUPPORTED_VERSIONS } from "./versions";

/**
 * write's MCP server (docs/design-decisions.md#d31): stateless and tools only. One message in, one reply
 * out, for both eras (see versions.ts). Legacy clients get `initialize` and a 202 for notifications;
 * modern ones get `server/discover`, `resultType` and `serverInfo` on every result, and a 404 for methods
 * write doesn't have.
 */

const SERVER_INFO = { name: "write", title: "write notes", version: "1" };
const CAPABILITIES = { tools: { listChanged: false } };

type Handled = Record<string, unknown> | Reply;
const isReply = (v: Handled): v is Reply => "status" in v && "body" in v;

async function dispatch(
  m: JsonRpcMessage,
  integration: StoredIntegration,
  era: "modern" | "legacy",
  version: string,
): Promise<Handled | null> {
  const params = m.params ?? {};
  switch (m.method) {
    case "initialize":
      return {
        protocolVersion: version,
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      };
    case "server/discover":
      return {
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: CAPABILITIES,
        instructions: SERVER_INSTRUCTIONS,
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOL_DEFINITIONS };
    case "tools/call": {
      if (!isToolName(params.name))
        return failure(m.id, RPC.invalidParams, `Unknown tool: ${String(params.name)}`);
      const args = typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {};
      return { ...(await callTool(integration, params.name, args as Record<string, unknown>)) };
    }
    default:
      return era === "modern"
        ? failure(m.id, RPC.methodNotFound, `Method not found: ${m.method}`, 404)
        : failure(m.id, RPC.methodNotFound, `Method not found: ${m.method}`);
  }
}

/** Handles one JSON-RPC message from an integration. */
export async function handleMessage(
  m: JsonRpcMessage,
  integration: StoredIntegration,
  headers: Headers,
): Promise<Reply> {
  // Legacy clients send notifications (initialized, cancelled…); stateless, there is nothing to do.
  if (isNotification(m)) return { status: 202, body: null };
  const era = classify(m, headers);
  if ("status" in era) return era;
  const handled = await dispatch(m, integration, era.era, era.version);
  if (handled === null) return { status: 202, body: null };
  if (isReply(handled)) return handled;
  if (era.era === "legacy") return result(m.id, handled);
  return result(m.id, {
    resultType: "complete",
    ...handled,
    _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
  });
}
