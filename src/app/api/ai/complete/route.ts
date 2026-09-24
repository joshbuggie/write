import type { CompleteEvent } from "@/lib/api-contract";
import { isUsable } from "@/lib/ai/settings";
import { type ConnectionTarget, openReply, type ReplyEvent } from "@/lib/server/ai";
import { handle, HttpError, readJson } from "@/lib/server/http";
import { readAiSettings, type StoredAiSettings } from "@/lib/server/storage";
import { isCompleteRequest } from "@/lib/server/validate";

/**
 * The prompt window's requests (see docs/design-decisions.md#d29). The browser names a saved connection by
 * id and sends exactly what "What gets sent" shows; the server adds the URL, key and model (and what the
 * API needs, such as Anthropic's max_tokens), then streams the reply back as newline-delimited JSON
 * (CompleteEvent lines).
 */

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  // nginx buffers proxied responses by default, which would hold the whole reply back until it ends.
  "X-Accel-Buffering": "no",
};

/** The saved connection a request names, key included; the key never travels through the browser. */
function targetFor(settings: StoredAiSettings, id: string): ConnectionTarget {
  const saved = settings.connections.find((c) => c.id === id);
  if (!saved) throw new HttpError("bad_request", "That connection isn't saved anymore. Pick another one.");
  if (!isUsable({ ...saved, keyHint: null })) {
    throw new HttpError("bad_request", "That connection has no server URL or model yet.");
  }
  const { provider, baseUrl, apiKey, model } = saved;
  return { provider, baseUrl, apiKey, model };
}

/** A failure mid-reply. The 200 status is already sent, so it travels in-band as the last line. */
function errorEvent(err: unknown): CompleteEvent {
  if (err instanceof HttpError) return { error: { code: err.code, message: err.message } };
  console.error("[write] unexpected AI reply error", err);
  return { error: { code: "internal", message: "Something went wrong on the server." } };
}

/**
 * The answer once the browser gave up (Stop, a closed tab) before the model answered. Nobody reads it, and
 * it isn't a server error to log; 499 is the usual status for a request the client closed.
 */
const clientClosed = () => new Response(null, { status: 499, headers: { "Cache-Control": "no-store" } });

const encoder = new TextEncoder();
const line = (event: CompleteEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

/**
 * The reply as NDJSON: `{text}` lines, then one `{done, stop}` or `{error}` line. It pulls one event at a
 * time, so a slow reader holds the upstream back instead of piling the reply up in memory. `stop` ends
 * the upstream request; it runs when the reply ends or fails and when the browser cancels the stream.
 * Once `signal` fired (the browser went away, or Stop), a failure is that abort, not an error line.
 */
function ndjson(
  reply: AsyncGenerator<ReplyEvent>,
  signal: AbortSignal,
  stop: () => void,
): ReadableStream<Uint8Array> {
  let open = true;
  const end = () => {
    open = false;
    stop();
    reply.return(undefined).catch(() => {}); // runs the adapter's cleanup; queued behind a pending read
  };
  const finish = (controller: ReadableStreamDefaultController<Uint8Array>, last?: CompleteEvent) => {
    if (!open) return;
    if (last) controller.enqueue(line(last));
    controller.close();
    end();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let next: IteratorResult<ReplyEvent>;
      try {
        next = await reply.next();
      } catch (err) {
        return finish(controller, signal.aborted ? undefined : errorEvent(err));
      }
      if (!open) return;
      if (next.done) return finish(controller);
      const event = next.value;
      if ("stop" in event) return finish(controller, { done: true, stop: event.stop });
      controller.enqueue(line({ text: event.text }));
    },
    cancel() {
      if (open) end();
    },
  });
}

/**
 * Sends the conversation to the named connection and streams the reply. Failures before the model starts
 * answering are ordinary JSON errors: 400 bad_request (fields, unknown or incomplete connection), 409
 * ai_disabled, 502 ai_unreachable / ai_upstream, 503 storage_unavailable. Later failures are an `{error}`
 * line. Closing the request (Stop, a closed tab) ends the upstream request too.
 */
export const POST = handle(async (req) => {
  const body = await readJson(req, isCompleteRequest);
  const settings = await readAiSettings();
  if (!settings.enabled) {
    throw new HttpError("ai_disabled", "The AI assistant is switched off in Settings.");
  }
  const target = targetFor(settings, body.connectionId);
  const cancel = new AbortController();
  const signal = AbortSignal.any([req.signal, cancel.signal]);
  let reply: AsyncGenerator<ReplyEvent>;
  try {
    reply = await openReply(target, { system: body.system, messages: body.messages }, signal);
  } catch (err) {
    if (req.signal.aborted) return clientClosed();
    throw err;
  }
  const stream = ndjson(reply, signal, () => cancel.abort());
  return new Response(stream, { headers: NDJSON_HEADERS });
});
