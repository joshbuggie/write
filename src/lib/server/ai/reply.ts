import { HttpError } from "../http";
import { parseJson } from "./json";
import { readSse, type SseEvent } from "./sse";
import type { ReplyEvent } from "./types";
import { readBody, type Upstream } from "./upstream";
import { brokeOff, readError, unreadable, type UpstreamContext } from "./upstream-errors";

/**
 * Turns an answered completion request into reply events, whatever the API (see
 * docs/design-decisions.md#d29): picks the reader by content type, caps the reply, maps failures, and
 * always lets go of the upstream connection when the reply ends or its reader stops.
 */

/**
 * Characters one reply may have. Far beyond any real answer; it stops a model stuck in a loop, which the
 * inactivity timeout never would (./idle.ts): a reply that keeps streaming is never cut off by time. A
 * capped reply ends with stop "length", like a model limit.
 */
export const MAX_REPLY_CHARS = 1_000_000;

/** A whole-body JSON reply (from a server that ignored `stream: true`) is read up to this size. */
const MAX_JSON_REPLY_BYTES = 8 * 1024 * 1024;

/** How one API's answer becomes reply events. Both end with exactly one stop, or throw an HttpError. */
export type ReplyDecoder = {
  /** Reads the event stream; throws for errors reported mid-reply and for a stream that breaks off. */
  stream: (events: AsyncIterable<SseEvent>, ctx: UpstreamContext) => AsyncGenerator<ReplyEvent>;
  /** Reads a whole JSON body instead. */
  json: (value: unknown, ctx: UpstreamContext) => ReplyEvent[];
};

/**
 * The reply events of an answered request. A web page or a JSON error in a 2xx answer fails here, before
 * the generator is returned, so the route can still answer with a plain JSON error.
 */
export async function readReply(up: Upstream, decoder: ReplyDecoder): Promise<AsyncGenerator<ReplyEvent>> {
  const type = up.headers.get("content-type")?.toLowerCase() ?? "";
  if (type.includes("text/html")) {
    up.abort();
    throw new HttpError(
      "ai_upstream",
      `${up.host} answered with a web page instead of a model reply. Check the server URL.`,
    );
  }
  if (/\bjson\b/.test(type)) {
    const { text, complete } = await readBody(up, MAX_JSON_REPLY_BYTES);
    const value = complete ? parseJson(text) : undefined;
    if (value === undefined) throw unreadable(up.host);
    return guard(up, fromList(decoder.json(value, up)));
  }
  if (!up.body) throw unreadable(up.host);
  return guard(up, decoder.stream(readSse(up.body), up));
}

async function* fromList(events: ReplyEvent[]): AsyncGenerator<ReplyEvent> {
  yield* events;
}

/** `text` cut to `n` characters, one fewer if that would split a surrogate pair (an emoji, say). */
function cut(text: string, n: number): string {
  const end = n > 0 && /[\uD800-\uDBFF]/.test(text.charAt(n - 1)) ? n - 1 : n;
  return text.slice(0, end);
}

/** Applies the reply cap, maps read failures (the caller's abort passes unchanged), frees the connection. */
async function* guard(up: Upstream, events: AsyncGenerator<ReplyEvent>): AsyncGenerator<ReplyEvent> {
  let length = 0;
  try {
    for await (const event of events) {
      if ("stop" in event) {
        yield event;
        return;
      }
      const room = MAX_REPLY_CHARS - length;
      if (event.text.length <= room) {
        length += event.text.length;
        yield event;
        continue;
      }
      const rest = cut(event.text, room);
      if (rest !== "") yield { text: rest };
      yield { stop: "length" };
      return;
    }
    throw brokeOff(up.host); // decoders end with a stop; this only guards against one that doesn't
  } catch (err) {
    if (up.callerSignal.aborted) throw err;
    throw readError(up.host, err);
  } finally {
    up.abort();
  }
}
