import { presetFor } from "@/lib/ai/settings";
import { anthropicModels, anthropicReply } from "./anthropic";
import { openAiModels, openAiReply } from "./openai";
import type { ConnectionTarget, ModelRequest, ReplyEvent } from "./types";

/**
 * Model adapters (see docs/design-decisions.md#d29). Every model call goes through the write server, so
 * keys stay there, LAN servers work from phones, and no model server needs CORS. Two APIs cover the
 * presets: OpenAI-compatible chat completions and Anthropic Messages, both over plain fetch.
 */

export type { ConnectionTarget, ModelRequest, ReplyEvent } from "./types";
export { MAX_REPLY_CHARS } from "./reply";

/**
 * Sends a request and resolves once the model server has answered 2xx, so the route can still answer a
 * failure (ai_unreachable / ai_upstream HttpError) as plain JSON before it starts streaming. The generator
 * yields `{text}` events and ends with exactly one `{stop}`; a failure mid-reply throws an ai_upstream
 * HttpError. If `signal` aborts, its AbortError is rethrown unchanged and the upstream request ends. Stop
 * iterating (or `return()`) to end the upstream request early.
 */
export function openReply(
  target: ConnectionTarget,
  request: ModelRequest,
  signal: AbortSignal,
): Promise<AsyncGenerator<ReplyEvent>> {
  return presetFor(target.provider).api === "anthropic"
    ? anthropicReply(target, request, signal)
    : openAiReply(target, request, signal);
}

/**
 * Model ids the server lists, unique and sorted, for "Test connection" and the model picker. May be empty
 * for a server whose list has no entries. Errors as for openReply.
 */
export function listModels(target: Omit<ConnectionTarget, "model">, signal: AbortSignal): Promise<string[]> {
  return presetFor(target.provider).api === "anthropic"
    ? anthropicModels(target, signal)
    : openAiModels(target, signal);
}
