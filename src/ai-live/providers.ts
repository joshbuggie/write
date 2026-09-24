import { describe } from "vitest";
import { presetFor, type ProviderId } from "@/lib/ai/settings";
import type { ConnectionInput } from "@/lib/api-contract";
import type { ConnectionTarget } from "@/lib/server/ai";

/**
 * The hosted providers the opt-in live suite calls (`npm run test:ai-live`, never CI). Keys come from
 * `.env.ai-live` (gitignored), loaded by vitest.ai-live.config.mts; a provider without a key is skipped,
 * so one key is enough to run part of the suite. Models default to cheap ones, so a full run costs cents.
 */
export type LiveProvider = {
  provider: ProviderId;
  /** The key, or null when the provider is skipped. */
  apiKey: string | null;
  model: string;
  baseUrl: string;
};

function live(provider: ProviderId, keyVar: string, modelVar: string, model: string): LiveProvider {
  const env = (name: string) => process.env[name]?.trim() || null;
  return {
    provider,
    apiKey: env(keyVar),
    model: env(modelVar) ?? model,
    baseUrl: presetFor(provider).baseUrl,
  };
}

/** Every provider the suite knows, keyed or not; `describeEach` skips the unkeyed ones. */
export const LIVE_PROVIDERS: LiveProvider[] = [
  live("anthropic", "ANTHROPIC_API_KEY", "AI_LIVE_ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
  live("openai", "OPENAI_API_KEY", "AI_LIVE_OPENAI_MODEL", "gpt-5.4-nano"),
  live("openrouter", "OPENROUTER_API_KEY", "AI_LIVE_OPENROUTER_MODEL", "google/gemini-2.5-flash-lite"),
];

/** Where the adapters send a request; the key is present because unkeyed providers never run. */
export const targetOf = (p: LiveProvider, model = p.model): ConnectionTarget => ({
  provider: p.provider,
  baseUrl: p.baseUrl,
  apiKey: p.apiKey,
  model,
});

/** The connection as the Settings dialog saves it, with the key typed in. */
export const connectionOf = (p: LiveProvider): ConnectionInput => ({
  id: `live-${p.provider}`,
  name: "",
  provider: p.provider,
  baseUrl: p.baseUrl,
  model: p.model,
  apiKey: p.apiKey ?? undefined,
});

/** One describe block per provider, skipped (and named as such) when its key is missing. */
export function describeEach(name: string, fn: (p: LiveProvider) => void, options: { retry?: number } = {}) {
  for (const p of LIVE_PROVIDERS) {
    describe.skipIf(!p.apiKey)(`${name} · ${p.provider} (${p.model})`, options, () => fn(p));
  }
}

/** The key's text must never appear in anything a user or log could see. */
export const leaks = (p: LiveProvider, text: string) => p.apiKey !== null && text.includes(p.apiKey);
