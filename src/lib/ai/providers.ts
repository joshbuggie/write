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
    modelPlaceholder: "claude-opus-5",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    api: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    modelPlaceholder: "anthropic/claude-opus-5",
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

/** Provider ids the server accepts; anything else in a settings file reads as "custom". */
export const PROVIDER_IDS: ProviderId[] = PROVIDER_PRESETS.map((p) => p.id);

/** The preset for an id; unknown ids (an older settings file) fall back to "Other". */
export function presetFor(id: ProviderId): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}
