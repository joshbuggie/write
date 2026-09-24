import type { ConnectionInput, SaveSettingsRequest } from "@/lib/api-contract";
import type { AiConnection, AiSettings } from "@/lib/ai/settings";

/**
 * A connection in the Settings form: what the server sent (with `keyHint`, never the key), plus a newly
 * typed key or a request to remove the saved one. Both only leave the browser on Save or Test.
 */
export type DraftConnection = AiConnection & { apiKey?: string; clearKey?: boolean };

/** The Settings form's state: the saved settings, with connections that can carry a new key. */
export type SettingsDraft = Omit<AiSettings, "connections"> & { connections: DraftConnection[] };

/** Origin of a URL, or null when it isn't one. Keys are tied to origins (docs/design-decisions.md#d29). */
export function originOf(url: string): string | null {
  try {
    return new URL(url.trim()).origin;
  } catch {
    return null;
  }
}

/**
 * True when the server will keep this connection's saved key: nothing new typed, not removed, and still
 * the same origin as when it was saved (a key is only ever sent where it was saved for).
 */
export function keepsSavedKey(draft: DraftConnection, saved: AiConnection | undefined): boolean {
  if (!saved?.keyHint || draft.clearKey || cleanKey(draft.apiKey ?? "")) return false;
  const origin = originOf(withScheme(draft.baseUrl));
  return origin !== null && origin === originOf(saved.baseUrl);
}

/**
 * A server address as typed, with "http://" added when it has no scheme: "192.168.1.20:11434/v1" is how
 * people write a LAN address, and "localhost:11434" would otherwise read as a URL with scheme "localhost:".
 */
export function withScheme(url: string): string {
  const trimmed = url.trim();
  return !trimmed || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** A pasted key without the spaces, line breaks and invisible characters chat apps and PDFs add to it. */
export const cleanKey = (key: string) => key.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "");

/**
 * Why a typed key can't be used, or null. Keys go into an HTTP header, which only carries visible ASCII,
 * so the server refuses anything else; saying so here beats its generic "invalid fields".
 */
export function keyProblem(c: DraftConnection): string | null {
  const key = cleanKey(c.apiKey ?? "");
  if (!key || /^[\x21-\x7e]+$/.test(key)) return null;
  return "This API key has a character keys never contain (such as a curly quote or a dash from a document). Paste it again from where you got it.";
}

/** "••a3F9" for a saved key's hint, or "saved" when the key was too short to show any of it. */
export const keyHintLabel = (hint: string) => (hint.startsWith("•") ? "saved" : `••${hint}`);

/** What the server needs for one connection; the display-only `keyHint` stays behind. */
export function toConnectionInput(c: DraftConnection): ConnectionInput {
  const input: ConnectionInput = {
    id: c.id,
    name: c.name,
    provider: c.provider,
    baseUrl: withScheme(c.baseUrl),
    model: c.model,
  };
  const key = cleanKey(c.apiKey ?? "");
  if (key) input.apiKey = key;
  else if (c.clearKey) input.clearKey = true;
  return input;
}

/** The PUT /api/settings body for a draft. */
export function toSaveRequest(draft: SettingsDraft): SaveSettingsRequest["ai"] {
  return { ...draft, connections: draft.connections.map(toConnectionInput) };
}
