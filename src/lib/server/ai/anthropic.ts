import type { StopReason } from "@/lib/api-contract";
import { parseJson, prop, str } from "./json";
import { readModelIds } from "./models";
import { readReply, type ReplyDecoder } from "./reply";
import type { SseEvent } from "./sse";
import type { ConnectionTarget, ModelRequest, ReplyEvent } from "./types";
import { callUpstream, displayUrl, endpoint, type Upstream } from "./upstream";
import {
  brokeOff,
  problemOf,
  reportedError,
  unreadable,
  type UpstreamContext,
  UpstreamStatusError,
} from "./upstream-errors";

/**
 * The Anthropic Messages API over plain HTTP (see docs/design-decisions.md#d29; no SDK, rule 8). The base
 * URL is the host (https://api.anthropic.com); one that already ends in /v1 works too. Only text deltas are
 * read, so thinking blocks never end up in a note.
 */

const VERSION = "2023-06-01";
/**
 * Required by the API. Generous, since a reply's length is the user's call; the reply cap still applies.
 * A model with a lower output limit refuses it, and the request is sent again with that limit (lowerLimit).
 */
const MAX_TOKENS = 64_000;
/**
 * How long a model server may send nothing (./idle.ts). A model may think for minutes before its first
 * token, and some servers send their headers first and think after, so the same allowance applies between
 * chunks. A reply that keeps streaming is never cut off.
 */
const REPLY_IDLE_MS = 10 * 60_000;
/** A models list is quick to make: a server silent this long isn't going to answer. */
const MODELS_IDLE_MS = 20_000;

/** The key goes in x-api-key, and only when there is one (a local proxy may not need it). */
function headers(apiKey: string | null, accept: string): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, "anthropic-version": VERSION };
  if (apiKey) h["x-api-key"] = apiKey;
  return h;
}

function stopFor(stopReason: string): StopReason {
  if (stopReason === "max_tokens" || stopReason === "model_context_window_exceeded") return "length";
  if (stopReason === "refusal") return "refusal";
  return "end"; // "end_turn", "stop_sequence", and anything newer
}

/** Text deltas, then a stop at `message_stop` (or at the end of a stream that gave a stop_reason). */
async function* decodeStream(
  events: AsyncIterable<SseEvent>,
  ctx: UpstreamContext,
): AsyncGenerator<ReplyEvent> {
  let stop: StopReason | null = null;
  for await (const event of events) {
    if (event.data.trim() === "") continue;
    const value = parseJson(event.data);
    if (value === undefined) throw unreadable(ctx.host);
    const type = str(prop(value, "type")) ?? event.event;
    if (type === "error" || event.event === "error") throw reportedError(ctx, problemOf(value));
    if (type === "content_block_delta") {
      const delta = prop(value, "delta");
      const text = prop(delta, "type") === "text_delta" ? str(prop(delta, "text")) : null;
      if (text !== null) yield { text };
    } else if (type === "message_delta") {
      const reason = str(prop(prop(value, "delta"), "stop_reason"));
      if (reason !== null) stop = stopFor(reason);
    } else if (type === "message_stop") {
      yield { stop: stop ?? "end" };
      return;
    }
  }
  if (stop === null) throw brokeOff(ctx.host);
  yield { stop };
}

function decodeJson(value: unknown, ctx: UpstreamContext): ReplyEvent[] {
  if (prop(value, "type") === "error") throw reportedError(ctx, problemOf(value));
  const content = prop(value, "content");
  if (!Array.isArray(content)) throw unreadable(ctx.host);
  const text = content
    .filter((block) => prop(block, "type") === "text")
    .map((block) => str(prop(block, "text")) ?? "")
    .join("");
  const reason = str(prop(value, "stop_reason"));
  const stop: ReplyEvent = { stop: reason === null ? "end" : stopFor(reason) };
  return text === "" ? [stop] : [{ text }, stop];
}

const decoder: ReplyDecoder = { stream: decodeStream, json: decodeJson };

/**
 * The output limit a refused max_tokens names, as the API words it ("max_tokens: 64000 > 32000, which is
 * the maximum allowed number of output tokens for …"), or null for any other failure. Older models and
 * Anthropic-compatible servers allow less than MAX_TOKENS, and nobody can change it in Settings.
 */
function lowerLimit(err: unknown, sent: number): number | null {
  if (!(err instanceof UpstreamStatusError) || err.status !== 400) return null;
  const match = /max_tokens: \d+ > (\d+)/.exec(err.problem.message ?? "");
  const limit = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(limit) && limit > 0 && limit < sent ? limit : null;
}

/** Starts a streamed message; see openReply in ./index.ts. */
export async function anthropicReply(
  target: ConnectionTarget,
  request: ModelRequest,
  signal: AbortSignal,
): Promise<AsyncGenerator<ReplyEvent>> {
  const url = endpoint(target.baseUrl, "/v1/messages", "/v1");
  const messages = request.messages.map(({ role, content }) => ({ role, content }));
  const send = (maxTokens: number) =>
    callUpstream({
      url,
      method: "POST",
      headers: { ...headers(target.apiKey, "text/event-stream"), "Content-Type": "application/json" },
      body: {
        model: target.model,
        max_tokens: maxTokens,
        ...(request.system.trim() === "" ? {} : { system: request.system }),
        messages,
        stream: true,
      },
      apiKey: target.apiKey,
      signal,
      idleTimeoutMs: REPLY_IDLE_MS,
      notFound: `${url.host} doesn't know the model “${target.model}”, or the server URL is wrong.`,
    });
  let up: Upstream;
  try {
    up = await send(MAX_TOKENS);
  } catch (err) {
    const limit = lowerLimit(err, MAX_TOKENS);
    if (limit === null) throw err;
    up = await send(limit); // once: a second refusal is shown as it is
  }
  return readReply(up, decoder);
}

/** `GET {base}/v1/models?limit=1000` (the most one page holds); see listModels in ./index.ts. */
export async function anthropicModels(
  target: Omit<ConnectionTarget, "model">,
  signal: AbortSignal,
): Promise<string[]> {
  const url = endpoint(target.baseUrl, "/v1/models", "/v1");
  url.searchParams.set("limit", "1000");
  const up = await callUpstream({
    url,
    method: "GET",
    headers: headers(target.apiKey, "application/json"),
    apiKey: target.apiKey,
    signal,
    idleTimeoutMs: MODELS_IDLE_MS,
    notFound: `No models list at ${displayUrl(url)}. Check the server URL (Anthropic's is https://api.anthropic.com).`,
  });
  return readModelIds(up, url);
}
