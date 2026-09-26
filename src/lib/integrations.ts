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
  /** How write starts jobs in this harness, or null when it doesn't. */
  launcher: LauncherView | null;
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

/**
 * How write starts a job in the harness (docs/design-decisions.md#d31): Turnstone's API, Hermes Agent's
 * runs API, or, for any other harness, a webhook. Optional: without it the harness is started from its own
 * UI and still reads and proposes through write's MCP endpoint.
 */
export interface LauncherView {
  /** Turnstone's console, Hermes's API base (…/v1), or the webhook to call. */
  url: string;
  /** The saved key's last four characters ("••••" for a short one), or null without a key. */
  keyHint: string | null;
  /** A certificate authority to trust for this server (PEM), for private certificates; "" for none. */
  ca: string;
  /** Turnstone only: start a coordinator (several agents) or a single workstream. */
  turnstoneMode: TurnstoneMode;
  /** Turnstone only: the name write's MCP server has in Turnstone, which prefixes its tool names. */
  mcpServerName: string;
}

export type TurnstoneMode = "coordinator" | "workstream";

/** A launcher as the dialog sends it. The saved key is kept unless `key` replaces it or `clearKey` removes it. */
export interface LauncherInput {
  url: string;
  key?: string;
  clearKey?: boolean;
  ca: string;
  turnstoneMode: TurnstoneMode;
  mcpServerName: string;
}

export const DEFAULT_LAUNCHER: LauncherInput = {
  url: "",
  ca: "",
  // A coordinator stops for approval at write's tools (docs/design-decisions.md#d31); a workstream doesn't.
  turnstoneMode: "workstream",
  mcpServerName: "write",
};

/** What's wrong with a launcher from the dialog, or null. Shared so the form can say it before sending. */
export function launcherProblem(l: LauncherInput): string | null {
  let url: URL;
  try {
    url = new URL(l.url.trim());
  } catch {
    return "Enter the server's address, starting with http:// or https://.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return "The address must start with http:// or https://.";
  if (url.username || url.password) return "Put the key in its own field, not in the address.";
  if (l.key && !/^[\x21-\x7e]+$/.test(l.key.trim())) {
    return "This key has a character keys never contain (such as a curly quote). Paste it again from where you got it.";
  }
  if (l.ca.trim() && !l.ca.includes("-----BEGIN CERTIFICATE-----")) {
    return "The certificate must be PEM text, starting with -----BEGIN CERTIFICATE-----.";
  }
  if (l.ca.length > 64 * 1024) return "The certificate is too long.";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(l.mcpServerName)) {
    return "The MCP server name can only use letters, digits, - and _.";
  }
  return null;
}
