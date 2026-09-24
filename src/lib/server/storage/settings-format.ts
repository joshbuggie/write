import {
  type AiConnection,
  type AiSettings,
  DEFAULT_AI_SETTINGS,
  PROVIDER_IDS,
  type QuickAction,
} from "@/lib/ai/settings";
import { StorageError } from "./errors";

/**
 * The on-disk format of `<configDir>/settings.json` (docs/design-decisions.md#d29):
 * `{ "version": 1, "ai": StoredAiSettings }`. Parsing is forgiving, because the file may be edited by hand
 * or written by another version of write, except that a file that isn't a JSON object at all throws, so a
 * save never overwrites something it didn't understand.
 */

const FILE_VERSION = 1;

/** A saved connection as the server holds it: the key itself instead of the browser's `keyHint`. */
export type StoredConnection = Omit<AiConnection, "keyHint"> & { apiKey: string | null };

/** The AI settings as saved on disk. Server-only: send toAiSettingsView() to the browser. */
export type StoredAiSettings = Omit<AiSettings, "connections"> & { connections: StoredConnection[] };

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** An http(s) URL, or null for anything else (empty, malformed, another scheme). Keys follow its origin. */
export function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The prompt window starts with the default connection, so there is one whenever any connection exists. */
export function withDefaultConnection(s: StoredAiSettings): StoredAiSettings {
  if (s.connections.some((c) => c.id === s.defaultConnectionId)) return s;
  return { ...s, defaultConnectionId: s.connections[0]?.id ?? null };
}

/** A fresh copy of the defaults, so callers can't change DEFAULT_AI_SETTINGS through it. */
const defaults = (): StoredAiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  connections: [],
  quickActions: DEFAULT_AI_SETTINGS.quickActions.map((q) => ({ ...q })),
});

/** A hand-edited URL the Settings form couldn't save (another scheme, a user:password@) reads as unset. */
function parseBaseUrl(v: unknown): string {
  const url = httpUrl(str(v));
  return url && !url.username && !url.password ? str(v).trim() : "";
}

function parseConnection(v: unknown): StoredConnection | null {
  if (!isObject(v) || typeof v.id !== "string" || v.id === "") return null;
  const provider = PROVIDER_IDS.find((id) => id === v.provider) ?? "custom";
  const apiKey = str(v.apiKey).trim() || null;
  return {
    id: v.id,
    name: str(v.name),
    provider,
    baseUrl: parseBaseUrl(v.baseUrl),
    model: str(v.model),
    apiKey,
  };
}

function parseQuickAction(v: unknown): QuickAction | null {
  if (
    !isObject(v) ||
    typeof v.id !== "string" ||
    typeof v.label !== "string" ||
    typeof v.prompt !== "string"
  ) {
    return null;
  }
  return { id: v.id, label: v.label, prompt: v.prompt, apply: v.apply === "insert" ? "insert" : "replace" };
}

/** Bad parts fall back to defaults; malformed connections (and repeated ids) and quick actions are dropped. */
function parseSettings(raw: Fields): StoredAiSettings {
  const ai = isObject(raw.ai) ? raw.ai : {};
  const d = DEFAULT_AI_SETTINGS;
  const connections: StoredConnection[] = [];
  for (const parsed of (Array.isArray(ai.connections) ? ai.connections : []).map(parseConnection)) {
    if (parsed && !connections.some((c) => c.id === parsed.id)) connections.push(parsed);
  }
  const quickActions = Array.isArray(ai.quickActions)
    ? ai.quickActions.map(parseQuickAction).filter((q): q is QuickAction => q !== null)
    : defaults().quickActions;
  return withDefaultConnection({
    enabled: ai.enabled === true,
    connections,
    defaultConnectionId: typeof ai.defaultConnectionId === "string" ? ai.defaultConnectionId : null,
    shortcut: str(ai.shortcut, d.shortcut),
    defaultScope:
      ai.defaultScope === "note" || ai.defaultScope === "selection" ? ai.defaultScope : d.defaultScope,
    instructions: str(ai.instructions, d.instructions),
    quickActions,
  });
}

const fixOrDelete = "Fix it or delete it (deleting it resets the AI settings and API keys).";

/**
 * The settings in a file's text; null (no file) or a blank file means the defaults. Throws
 * storage_unavailable for text that isn't a JSON object, naming `file` so the user knows what to fix.
 */
export function parseSettingsText(text: string | null, file: string): StoredAiSettings {
  const json = text?.trim(); // trim() also drops the BOM some Windows editors add, which JSON.parse refuses
  if (!json) return defaults();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new StorageError("storage_unavailable", `${file} isn't valid JSON. ${fixOrDelete}`);
  }
  if (!isObject(raw)) {
    throw new StorageError("storage_unavailable", `${file} doesn't hold a settings object. ${fixOrDelete}`);
  }
  return parseSettings(raw);
}

/** 2-space JSON with a final newline. Field order is the order the settings object was built in. */
export const serializeSettings = (s: StoredAiSettings): string =>
  `${JSON.stringify({ version: FILE_VERSION, ai: s }, null, 2)}\n`;
