import type { AiSettings } from "@/lib/ai/settings";
import type { ConnectionInput, SaveSettingsRequest, SettingsResponse } from "@/lib/api-contract";
import { configFile } from "./config";
import { readConfigText, writeConfigText } from "./config-files";
import { withWriteLock } from "./mutex";
import {
  httpUrl,
  parseSettingsText,
  serializeSettings,
  type StoredAiSettings,
  type StoredConnection,
  type StoredSettings,
  withDefaultConnection,
} from "./settings-format";

/**
 * write's settings, in `<configDir>/settings.json`: the AI assistant's (docs/design-decisions.md#d29) and
 * the appearance settings (docs/design-decisions.md#d32). That file is the only place API keys live: the server reads them to call a model, and the browser only ever gets
 * toAiSettingsView(), which carries at most each key's last four characters.
 */

export type { StoredAiSettings, StoredConnection, StoredSettings };

const settingsFile = () => configFile("settings.json");

/**
 * The key a connection from the Settings form ends up with: a typed key, none when cleared, else the saved
 * one of the same id, but only while it stays on the same origin. A saved key is only ever sent where it
 * was saved for, so pointing a connection somewhere else means typing the key again.
 */
function keyFor(input: ConnectionInput, saved: StoredConnection | undefined): string | null {
  const typed = input.apiKey?.trim();
  if (typed) return typed;
  if (input.clearKey || !saved?.apiKey) return null;
  const origin = httpUrl(saved.baseUrl)?.origin;
  return origin !== undefined && origin === httpUrl(input.baseUrl)?.origin ? saved.apiKey : null;
}

/**
 * Everything in the settings file, keys included (server-only). A missing file or config folder reads as
 * the defaults and nothing is created; a file that isn't valid JSON throws storage_unavailable.
 */
export async function readSettings(): Promise<StoredSettings> {
  const file = await settingsFile();
  return parseSettingsText(await readConfigText(file), file);
}

/** The saved AI settings, keys included (server-only); see readSettings. */
export async function readAiSettings(): Promise<StoredAiSettings> {
  return (await readSettings()).ai;
}

/** Keys shorter than this (a LAN server's "1234", say) show no characters: four would give most away. */
const MIN_KEY_FOR_HINT = 12;

/** A saved key's hint: its last four characters, or dots for a short key. Truthy whenever there is a key. */
function keyHint(apiKey: string | null): string | null {
  if (!apiKey) return null;
  return apiKey.length >= MIN_KEY_FOR_HINT ? apiKey.slice(-4) : "••••";
}

/** What the browser may see: each key becomes a hint (see keyHint). The key never leaves here. */
export function toAiSettingsView(s: StoredAiSettings): AiSettings {
  return {
    ...s,
    connections: s.connections.map(({ apiKey, ...c }) => ({ ...c, keyHint: keyHint(apiKey) })),
  };
}

/** The whole file as the browser may see it: keys become hints (see toAiSettingsView). */
export const toSettingsView = (s: StoredSettings): SettingsResponse => ({
  ai: toAiSettingsView(s.ai),
  appearance: s.appearance,
});

/**
 * Saves the Settings dialog and returns the browser's view of what was saved. Keys are merged in (see
 * keyFor), so the browser never needs the saved key. A request without `appearance` (a tab opened before
 * it existed) keeps the saved one. A corrupt file makes this throw rather than be overwritten, and
 * identical bytes are never rewritten.
 */
export function saveSettings({ ai: input, appearance }: SaveSettingsRequest): Promise<SettingsResponse> {
  return withWriteLock(async () => {
    const file = await settingsFile();
    const text = await readConfigText(file);
    const current = parseSettingsText(text, file);
    const saved = new Map(current.ai.connections.map((c) => [c.id, c]));
    const ai = withDefaultConnection({
      enabled: input.enabled,
      connections: input.connections.map((c) => ({
        id: c.id,
        name: c.name.trim(),
        provider: c.provider,
        baseUrl: c.baseUrl.trim(),
        model: c.model.trim(),
        apiKey: keyFor(c, saved.get(c.id)),
      })),
      defaultConnectionId: input.defaultConnectionId,
      shortcut: input.shortcut,
      defaultScope: input.defaultScope,
      instructions: input.instructions,
      quickActions: input.quickActions.map(({ id, label, prompt, apply }) => ({ id, label, prompt, apply })),
    });
    const next: StoredSettings = { ai, appearance: appearance ?? current.appearance };
    const bytes = serializeSettings(next);
    if (bytes !== text) await writeConfigText(file, bytes);
    return toSettingsView(next);
  });
}

/** Saves the AI settings alone, keeping the saved appearance settings; see saveSettings. */
export async function saveAiSettings(ai: SaveSettingsRequest["ai"]): Promise<AiSettings> {
  return (await saveSettings({ ai })).ai;
}

/**
 * The key "Test connection" should use for a connection from the form, saved or not: the same rule as
 * saving (typed key, cleared, or the saved key of the same id on the same origin), without writing.
 */
export async function apiKeyFor(input: ConnectionInput): Promise<string | null> {
  if (input.apiKey?.trim() || input.clearKey) return keyFor(input, undefined);
  const saved = (await readAiSettings()).connections.find((c) => c.id === input.id);
  return keyFor(input, saved);
}
