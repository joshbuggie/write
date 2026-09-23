import type { ProviderId } from "../settings";

/**
 * MOCKUP ONLY: what "Test connection" pretends each server offers. The real version asks the server
 * (`GET <base>/models`) through the write server.
 */
export const MOCK_MODELS: Record<ProviderId, string[]> = {
  ollama: ["llama3.1:8b", "qwen2.5:14b", "mistral-nemo:12b", "gemma2:9b"],
  lmstudio: ["qwen2.5-7b-instruct", "llama-3.1-8b-instruct"],
  openai: ["gpt-5", "gpt-5-mini"],
  anthropic: ["claude-sonnet-5", "claude-opus-5-5", "claude-haiku-4-5"],
  openrouter: ["anthropic/claude-sonnet-5", "meta-llama/llama-3.1-70b-instruct"],
  custom: ["default"],
};
