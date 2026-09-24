/**
 * Integrations: agent harnesses (Turnstone, Hermes Agent, any MCP client) that read notes and, later,
 * propose changes (see docs/design-decisions.md#d31). Shared by the Integrations dialog and the server, so
 * the rules below are checked the same way on both sides. Isomorphic: no Node or browser APIs.
 */

/** Which harness an integration is for. It only picks labels and setup help; the access is the same. */
export type IntegrationKind = "turnstone" | "hermes" | "other";

export const INTEGRATION_KINDS: readonly { id: IntegrationKind; label: string }[] = [
  { id: "turnstone", label: "Turnstone" },
  { id: "hermes", label: "Hermes Agent" },
  { id: "other", label: "Other MCP client" },
];

/** The kind's display name, e.g. "Hermes Agent". */
export const kindLabel = (kind: IntegrationKind) =>
  INTEGRATION_KINDS.find((k) => k.id === kind)?.label ?? "Other MCP client";

export const isIntegrationKind = (v: unknown): v is IntegrationKind =>
  INTEGRATION_KINDS.some((k) => k.id === v);

/** Bounds that keep the config file small and the dialog readable. */
export const INTEGRATION_LIMITS = { maxIntegrations: 20, maxNameChars: 64, maxFolders: 200 } as const;

/**
 * Every integration token looks like this: a fixed prefix and 32 random bytes as base64url. The exact
 * shape lets auth tell a token from a password without hashing either, so a stale token never counts as
 * a password guess (docs/design-decisions.md#d31).
 */
export const TOKEN_PREFIX = "wrt_";
const TOKEN_SHAPE = /^wrt_[A-Za-z0-9_-]{43}$/;

/** True for a string shaped like an integration token (not necessarily a valid one). */
export const isTokenShaped = (s: string) => TOKEN_SHAPE.test(s);

/** An integration as the browser sees it. The token itself is shown once, when it is made. */
export interface IntegrationView {
  id: string;
  name: string;
  kind: IntegrationKind;
  /** Folder names the token can read, as they are on disk. Empty means nothing is readable yet. */
  folders: string[];
  /** The token's last four characters, to tell tokens apart. */
  tokenHint: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601 of the last request with this token since the server started, or null. */
  lastUsedAt: string | null;
}

/** The trimmed name, or a message saying what's wrong with it. */
export function checkIntegrationName(
  input: string,
): { ok: true; name: string } | { ok: false; message: string } {
  const name = input.trim();
  if (!name) return { ok: false, message: "Give the integration a name." };
  if ([...name].length > INTEGRATION_LIMITS.maxNameChars)
    return { ok: false, message: `Use at most ${INTEGRATION_LIMITS.maxNameChars} characters for the name.` };
  if (/\p{Cc}/u.test(name)) return { ok: false, message: "The name can't contain control characters." };
  return { ok: true, name };
}
