import type { StopReason } from "@/lib/api-contract";
import { parseJson, prop, str } from "./json";
import { readModelIds } from "./models";
import { readReply, type ReplyDecoder } from "./reply";
import type { SseEvent } from "./sse";
import type { ConnectionTarget, ModelRequest, ReplyEvent } from "./types";
import { callUpstream, displayUrl, endpoint } from "./upstream";
import { brokeOff, problemOf, reportedError, unreadable, type UpstreamContext } from "./upstream-errors";

/**
 * OpenAI-compatible chat completions (see docs/design-decisions.md#d29): OpenAI, OpenRouter, Ollama, LM
 * Studio and most other servers. The base URL already ends in /v1. Only the fields every server knows are
 * sent (no max_tokens: servers disagree on its name and limits), and only `delta.content` is read, so
 * reasoning text (`reasoning_content`) never ends up in a note.
 */

/**
 * How long a model server may send nothing (./idle.ts). A model may think for minutes before its first
 * token on slow hardware, and some servers send their headers first and think after, so the same
 * allowance applies between chunks. A reply that keeps streaming is never cut off.
 */
const REPLY_IDLE_MS = 10 * 60_000;
/** A models list is quick to make: a server silent this long isn't going to answer. */
const MODELS_IDLE_MS = 20_000;

/** The key goes in a Bearer header, and only when there is one: local servers usually run without. */
function headers(apiKey: string | null, accept: string): Record<string, string> {
  const h: Record<string, string> = { Accept: accept };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

function stopFor(finishReason: string): StopReason {
  if (finishReason === "length") return "length";
  if (finishReason === "content_filter") return "refusal";
  return "end"; // "stop", and anything a server invents
}

/** `value`, unless it is an error report (`{"error": …}`), which some servers send even with a 2xx. */
function checked(value: unknown, ctx: UpstreamContext): unknown {
  const error = prop(value, "error");
  if (error !== undefined && error !== null) throw reportedError(ctx, problemOf(value));
  return value;
}

/** A data line as JSON; anything else means the server isn't speaking this API. */
function parse(data: string, ctx: UpstreamContext): unknown {
  const value = parseJson(data);
  if (value === undefined) throw unreadable(ctx.host);
  return checked(value, ctx);
}

/** The first choice of a chunk or a whole completion; replies are always requested with n = 1. */
function firstChoice(value: unknown): unknown {
  const choices = prop(value, "choices");
  return Array.isArray(choices) ? choices[0] : undefined;
}

/** Text deltas, then a stop at `data: [DONE]` (or at the end of a stream that gave a finish_reason). */
async function* decodeStream(
  events: AsyncIterable<SseEvent>,
  ctx: UpstreamContext,
): AsyncGenerator<ReplyEvent> {
  let stop: StopReason | null = null;
  for await (const { data } of events) {
    const line = data.trim();
    if (line === "") continue;
    if (line === "[DONE]") {
      yield { stop: stop ?? "end" };
      return;
    }
    const choice = firstChoice(parse(line, ctx));
    const text = str(prop(prop(choice, "delta"), "content"));
    if (text !== null) yield { text };
    const reason = str(prop(choice, "finish_reason"));
    if (reason !== null) stop = stopFor(reason);
  }
  if (stop === null) throw brokeOff(ctx.host);
  yield { stop };
}

function decodeJson(value: unknown, ctx: UpstreamContext): ReplyEvent[] {
  const choice = firstChoice(checked(value, ctx));
  const content = prop(prop(choice, "message"), "content");
  if (typeof content !== "string") throw unreadable(ctx.host);
  const reason = str(prop(choice, "finish_reason"));
  const stop: ReplyEvent = { stop: reason === null ? "end" : stopFor(reason) };
  return content === "" ? [stop] : [{ text: content }, stop];
}

const decoder: ReplyDecoder = { stream: decodeStream, json: decodeJson };

/** Starts a streamed chat completion; see openReply in ./index.ts. */
export async function openAiReply(
  target: ConnectionTarget,
  request: ModelRequest,
  signal: AbortSignal,
): Promise<AsyncGenerator<ReplyEvent>> {
  const url = endpoint(target.baseUrl, "/chat/completions");
  const system = request.system.trim() === "" ? [] : [{ role: "system", content: request.system }];
  const messages = request.messages.map(({ role, content }) => ({ role, content }));
  const up = await callUpstream({
    url,
    method: "POST",
    headers: { ...headers(target.apiKey, "text/event-stream"), "Content-Type": "application/json" },
    body: { model: target.model, messages: [...system, ...messages], stream: true },
    apiKey: target.apiKey,
    signal,
    idleTimeoutMs: REPLY_IDLE_MS,
    notFound: `${url.host} doesn't know the model “${target.model}”, or the server URL is wrong.`,
  });
  return readReply(up, decoder);
}

/**
 * Where the models list is. OpenRouter's `/models` is public, so it answers a wrong key with the full list
 * and "Test connection" would pass; `/models/user` is the same list for the key, and refuses a bad one.
 */
const modelsPath = (target: Omit<ConnectionTarget, "model">) =>
  target.provider === "openrouter" ? "/models/user" : "/models";

/** `GET {base}/models` (OpenRouter: `/models/user`); see listModels in ./index.ts. */
export async function openAiModels(
  target: Omit<ConnectionTarget, "model">,
  signal: AbortSignal,
): Promise<string[]> {
  const url = endpoint(target.baseUrl, modelsPath(target));
  const up = await callUpstream({
    url,
    method: "GET",
    headers: headers(target.apiKey, "application/json"),
    apiKey: target.apiKey,
    signal,
    idleTimeoutMs: MODELS_IDLE_MS,
    notFound: `No models list at ${displayUrl(url)}. Check the server URL (OpenAI-compatible servers usually end in /v1).`,
  });
  return readModelIds(up, url);
}
