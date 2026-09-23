import { presetFor, type ProviderId } from "./providers";

// The provider presets live in ./providers; re-exported so settings code has one import.
export { PROVIDER_IDS, PROVIDER_PRESETS, presetFor } from "./providers";
export type { ProviderApi, ProviderId, ProviderPreset } from "./providers";

/** What the prompt window sends when nothing else is chosen: the selection (or paragraph), or the whole note. */
export type AiScope = "selection" | "note";

/** Where a quick action's result goes by default; the other choice is always one click away. */
export type ApplyMode = "replace" | "insert";

/** A one-click request in the prompt window. The prompt is sent exactly as written here. */
export type QuickAction = { id: string; label: string; prompt: string; apply: ApplyMode };

/**
 * One saved place to send requests: a hosted API or a server on the network. Several can be saved (say, a
 * local model and a hosted one) and switched between in the prompt window. The browser only ever sees
 * `keyHint` (the key's last four characters, or "••••" for a key too short to show part of), never the
 * key itself.
 */
export type AiConnection = {
  id: string;
  /** What the prompt window's picker shows; empty means the provider's name. */
  name: string;
  provider: ProviderId;
  baseUrl: string;
  keyHint: string | null;
  model: string;
};

/**
 * Everything the AI assistant needs. Stored on the write server, in its config folder rather than next to
 * the notes, so a notes folder synced to iCloud or Dropbox never carries the API keys.
 */
export type AiSettings = {
  /** Off means no AI button, no shortcut, and nothing is ever sent anywhere. */
  enabled: boolean;
  connections: AiConnection[];
  /** The connection the prompt window starts with. */
  defaultConnectionId: string | null;
  /** "Mod+J" style; Mod is ⌘ on a Mac and Ctrl elsewhere. */
  shortcut: string;
  defaultScope: AiScope;
  /** The system prompt, shown and editable in Settings as "Instructions". */
  instructions: string;
  quickActions: QuickAction[];
};

/**
 * Sent before the note text on every request. It exists so replies can be dropped straight into a note:
 * Markdown only, no chatter, and only the passage when a passage is being edited.
 */
export const DEFAULT_INSTRUCTIONS = `You are a writing assistant built into a Markdown notes app.
- Reply in Markdown only: no preamble, no closing remarks, no code fence around the whole reply.
- When the request is about a passage, return only the new text for that passage.
- Keep the author's voice, language and formatting unless asked to change them.
- If the request is a question, answer it briefly and directly.`;

/** The common writing jobs, as a starting point; every one can be edited, removed or restored in Settings. */
export const DEFAULT_QUICK_ACTIONS: QuickAction[] = [
  {
    id: "improve",
    label: "Improve writing",
    prompt: "Improve the clarity and flow of this text. Keep its meaning, tone and formatting.",
    apply: "replace",
  },
  {
    id: "fix",
    label: "Fix spelling & grammar",
    prompt: "Fix spelling, grammar and punctuation. Change nothing else.",
    apply: "replace",
  },
  {
    id: "shorter",
    label: "Make shorter",
    prompt: "Make this text about half as long without losing its key points.",
    apply: "replace",
  },
  {
    id: "continue",
    label: "Continue writing",
    prompt: "Continue from where this text ends, in the same voice. Write one or two paragraphs.",
    apply: "insert",
  },
  {
    id: "summarize",
    label: "Summarize",
    prompt: "Summarize this as a short bulleted list of the key points.",
    apply: "insert",
  },
];

/** A fresh install: off, and not connected to anything. */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  connections: [],
  defaultConnectionId: null,
  shortcut: "Mod+J",
  defaultScope: "selection",
  instructions: DEFAULT_INSTRUCTIONS,
  quickActions: DEFAULT_QUICK_ACTIONS,
};

/** Complete enough to send a request to (a key may be optional, a URL and model are not). */
export function isUsable(c: AiConnection): boolean {
  return c.baseUrl.trim() !== "" && c.model.trim() !== "";
}

/** The connections a request can go to, the default first. */
export function usableConnections(s: AiSettings): AiConnection[] {
  const usable = s.connections.filter(isUsable);
  const first = usable.find((c) => c.id === s.defaultConnectionId);
  return first ? [first, ...usable.filter((c) => c !== first)] : usable;
}

/** The name a connection goes by: its own, or its provider's. */
export const connectionName = (c: AiConnection) => c.name.trim() || presetFor(c.provider).label;

/** A new, empty connection for the Settings form, starting from a preset's URL. */
export function newConnection(provider: ProviderId = "ollama"): AiConnection {
  const id = `conn-${Date.now().toString(36)}`;
  return { id, name: "", provider, baseUrl: presetFor(provider).baseUrl, keyHint: null, model: "" };
}

/**
 * Size limits the server enforces on saved settings and requests (400 beyond them). Generous for real use;
 * they only stop a runaway client or a pasted novel from ending up in the settings file.
 */
export const AI_LIMITS = {
  connections: 20,
  quickActions: 40,
  /** Instructions (system prompt), in characters. */
  instructions: 20_000,
  /** A quick action's prompt, in characters. */
  prompt: 4_000,
  /** Names, URLs, model names and API keys, in characters. */
  field: 500,
  /** Turns in one prompt window conversation (the first request plus follow-ups and their replies). */
  turns: 41,
} as const;
