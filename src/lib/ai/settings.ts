/** Which API a provider speaks. Most hosted platforms and local servers speak OpenAI's chat format. */
export type ProviderApi = "openai" | "anthropic";

/** The presets in the Provider menu; saved with the settings so the form reopens on the same one. */
export type ProviderId = "ollama" | "lmstudio" | "openai" | "anthropic" | "openrouter" | "custom";

/**
 * A starting point for the connection fields. Presets only prefill the URL and hint the model name;
 * every field stays editable, so any OpenAI-compatible server works through "Other".
 */
export type ProviderPreset = {
  id: ProviderId;
  label: string;
  api: ProviderApi;
  baseUrl: string;
  /** Local servers usually run without a key. */
  needsKey: boolean;
  modelPlaceholder: string;
};

/** Local servers first: they need no account, and they keep note text on the user's own network. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "ollama",
    label: "Ollama",
    api: "openai",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    modelPlaceholder: "llama3.1:8b",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    api: "openai",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    modelPlaceholder: "qwen2.5-7b-instruct",
  },
  {
    id: "openai",
    label: "OpenAI",
    api: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    modelPlaceholder: "gpt-5-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    api: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsKey: true,
    modelPlaceholder: "claude-sonnet-5",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    api: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    modelPlaceholder: "anthropic/claude-sonnet-5",
  },
  {
    id: "custom",
    label: "Other (OpenAI-compatible)",
    api: "openai",
    baseUrl: "",
    needsKey: false,
    modelPlaceholder: "model name",
  },
];

/** The preset for an id; unknown ids (an older settings file) fall back to "Other". */
export function presetFor(id: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

/** What the prompt window sends when nothing else is chosen: the selection (or paragraph), or the whole note. */
export type AiScope = "selection" | "note";

/** Where a quick action's result goes by default; the other choice is always one click away. */
export type ApplyMode = "replace" | "insert";

/** A one-click request in the prompt window. The prompt is sent exactly as written here. */
export type QuickAction = { id: string; label: string; prompt: string; apply: ApplyMode };

/**
 * One saved place to send requests: a hosted API or a server on the network. Several can be saved (say, a
 * local model and a hosted one) and switched between in the prompt window. The browser only ever sees
 * `keyHint` (the key's last four characters), never the key itself.
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
