import { failure, RPC, type JsonRpcMessage, type Reply } from "./jsonrpc";

/**
 * Which MCP revision a request speaks (docs/design-decisions.md#d31). write is "dual-era": a modern request
 * (2026-07-28) carries its version in `_meta` and mirrors it into headers, which must match; a legacy
 * client (2025-11-25 and earlier) opens with `initialize` and names its version in a header afterwards.
 * Both are served statelessly, so no session is ever kept.
 */

export const MODERN_VERSIONS = ["2026-07-28"] as const;
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SUPPORTED_VERSIONS: string[] = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";

export type Era = { era: "modern"; version: string } | { era: "legacy"; version: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A header value, decoded when it uses the `=?base64?…?=` form the spec requires for unsafe values. */
function headerValue(headers: Headers, name: string): string | null {
  const raw = headers.get(name);
  const encoded = raw?.match(/^=\?base64\?(.*)\?=$/);
  if (!encoded) return raw;
  try {
    return Buffer.from(encoded[1], "base64").toString("utf8");
  } catch {
    return null;
  }
}

const mismatch = (m: JsonRpcMessage, what: string) =>
  failure(m.id, RPC.headerMismatch, `Header mismatch: ${what}`, 400);

/** The legacy version to answer an `initialize` with: the client's when write speaks it, else the newest. */
export function negotiateLegacy(requested: unknown): string {
  const known: readonly string[] = LEGACY_VERSIONS;
  return typeof requested === "string" && known.includes(requested) ? requested : LEGACY_VERSIONS[0];
}

/**
 * The era and version of a request, or the error reply that refuses it. Modern requests must mirror the
 * version, method and (for tools/call) tool name into headers; legacy ones may omit the version header,
 * which the spec says to read as 2025-03-26.
 */
export function classify(m: JsonRpcMessage, headers: Headers): Era | Reply {
  const meta = isRecord(m.params?._meta) ? m.params._meta : null;
  const version = meta?.[META_VERSION];
  const header = headerValue(headers, "mcp-protocol-version");
  if (m.method === "initialize" || typeof version !== "string") {
    if (m.method === "initialize")
      return { era: "legacy", version: negotiateLegacy(m.params?.protocolVersion) };
    if (header === null) return { era: "legacy", version: "2025-03-26" };
    const legacy: readonly string[] = LEGACY_VERSIONS;
    if (legacy.includes(header)) return { era: "legacy", version: header };
    return failure(m.id, RPC.unsupportedVersion, "Unsupported protocol version", 400, {
      supported: SUPPORTED_VERSIONS,
      requested: header,
    });
  }
  if (header === null) return mismatch(m, "the MCP-Protocol-Version header is missing");
  if (header !== version)
    return mismatch(m, `MCP-Protocol-Version header '${header}' does not match '${version}'`);
  if (headerValue(headers, "mcp-method") !== m.method)
    return mismatch(m, "the Mcp-Method header does not match the method");
  if (m.method === "tools/call" && headerValue(headers, "mcp-name") !== m.params?.name) {
    return mismatch(m, "the Mcp-Name header does not match the tool name");
  }
  const modern: readonly string[] = MODERN_VERSIONS;
  if (!modern.includes(version)) {
    return failure(m.id, RPC.unsupportedVersion, "Unsupported protocol version", 400, {
      supported: SUPPORTED_VERSIONS,
      requested: version,
    });
  }
  if (!isRecord(meta?.[META_CAPABILITIES])) {
    return failure(m.id, RPC.invalidParams, `Missing _meta["${META_CAPABILITIES}"]`, 400);
  }
  return { era: "modern", version };
}
