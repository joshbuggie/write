/**
 * JSON-RPC 2.0 messages as MCP uses them (docs/design-decisions.md#d31). Hand-written instead of the MCP
 * SDK: a stateless, tools-only server is a few message types (rule 8, docs/design-decisions.md#d4).
 */

export type JsonRpcId = string | number;

/** A request (with an id) or a notification (without one). */
export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: JsonRpcId | null;
  method: string;
  params?: Record<string, unknown>;
}

/** Error codes from JSON-RPC and the MCP specification. */
export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  headerMismatch: -32020,
  unsupportedVersion: -32022,
} as const;

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId | null; result: Record<string, unknown> }
  | { jsonrpc: "2.0"; id: JsonRpcId | null; error: { code: number; message: string; data?: unknown } };

/** What to send back for one message: an HTTP status and a body, or no body (202 for a notification). */
export type Reply = { status: number; body: JsonRpcResponse | null };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** True for a well-formed JSON-RPC 2.0 request or notification. */
export function isMessage(v: unknown): v is JsonRpcMessage {
  if (!isRecord(v) || v.jsonrpc !== "2.0" || typeof v.method !== "string") return false;
  const idOk = v.id === undefined || v.id === null || typeof v.id === "string" || typeof v.id === "number";
  return idOk && (v.params === undefined || isRecord(v.params));
}

/** A notification has no id and gets no response. */
export const isNotification = (m: JsonRpcMessage) => m.id === undefined;

export const result = (
  id: JsonRpcId | null | undefined,
  value: Record<string, unknown>,
  status = 200,
): Reply => ({
  status,
  body: { jsonrpc: "2.0", id: id ?? null, result: value },
});

export const failure = (
  id: JsonRpcId | null | undefined,
  code: number,
  message: string,
  status = 200,
  data?: unknown,
): Reply => ({
  status,
  body: {
    jsonrpc: "2.0",
    id: id ?? null,
    error: data === undefined ? { code, message } : { code, message, data },
  },
});
