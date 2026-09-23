import { DEFAULT_AI_SETTINGS, type AiSettings } from "../settings";

/**
 * MOCKUP ONLY. The real settings live on the write server (GET/PUT /api/settings), and the API key never
 * comes back to the browser. Until that exists, this localStorage store stands in so the mockup keeps its
 * state across reloads. It starts switched on with two sample connections (a LAN server and a hosted API)
 * so there is something to click and switch between.
 */
const KEY = "write-ai-mockup-settings-v2";

const MOCK_START: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  connections: [
    {
      id: "home",
      name: "Home server",
      provider: "ollama",
      baseUrl: "http://192.168.1.20:11434/v1",
      keyHint: null,
      model: "llama3.1:8b",
    },
    {
      id: "claude",
      name: "Claude",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      keyHint: "a3F9",
      model: "claude-sonnet-5",
    },
  ],
  defaultConnectionId: "home",
};

/** Off until the client has read the setting, so a switched-off assistant never flashes into the header. */
const SERVER_SNAPSHOT: AiSettings = { ...MOCK_START, enabled: false };

let cached: AiSettings | null = null;
const listeners = new Set<() => void>();

function read(): AiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...MOCK_START, ...(JSON.parse(raw) as Partial<AiSettings>) } : MOCK_START;
  } catch {
    return MOCK_START;
  }
}

/** useSyncExternalStore snapshot: the same object until something is saved. */
export function getMockSettings(): AiSettings {
  cached ??= read();
  return cached;
}

/** What the server render and hydration use, before localStorage can be read. */
export function getServerMockSettings(): AiSettings {
  return SERVER_SNAPSHOT;
}

/** Stands in for PUT /api/settings: stores the settings and re-renders every subscriber. */
export function saveMockSettings(next: AiSettings): void {
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or storage full: the change still applies until the page reloads.
  }
  listeners.forEach((listener) => listener());
}

/** useSyncExternalStore subscription. */
export function subscribeMockSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
