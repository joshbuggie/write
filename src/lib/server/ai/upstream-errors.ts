import { HttpError } from "../http";
import { parseJson, prop, str } from "./json";
import { SseEventTooLarge } from "./sse";

/**
 * Model server failures as messages people can act on (see docs/design-decisions.md#d3 and #d29). Every
 * message names the host, never the key; upstream text is shown cut short, with the key blanked out in case
 * a server echoes it.
 */

/** Upstream text shown to people is cut to this, so an error page can't flood the dialog. */
export const MAX_UPSTREAM_TEXT = 300;

/** Anthropic's own wording for its busy signal (HTTP 529, or an `overloaded_error` event mid-reply). */
export const OVERLOADED = "Anthropic is overloaded right now. Try again in a moment.";

/** What a failed request was about: the messages name the host and depend on whether a key was sent. */
export type UpstreamContext = { host: string; secret: string | null };

/** What an error body says, from `{error:{message,type}}`, `{error:"…"}`, `{message}` or `{detail}`. */
export type Problem = { message: string | null; type: string | null };

/** Reads an upstream error object in any of the shapes servers use. */
export function problemOf(value: unknown): Problem {
  const error = prop(value, "error");
  const message =
    str(prop(error, "message")) ??
    str(error) ??
    str(prop(value, "message")) ??
    str(prop(value, "detail")) ??
    str(value);
  return { message, type: str(prop(error, "type")) };
}

/** An error body as text: JSON in a known shape, or plain text; an HTML page says nothing useful. */
export function problemFromText(text: string): Problem {
  const value = parseJson(text);
  if (value !== undefined) return problemOf(value);
  const plain = text.trim();
  return { message: plain !== "" && !plain.startsWith("<") ? plain : null, type: null };
}

/** Upstream text made fit to show: the key blanked out, whitespace collapsed, cut to MAX_UPSTREAM_TEXT. */
export function upstreamText(text: string, secret: string | null): string {
  const safe = secret && secret.length >= 4 ? text.split(secret).join("[key]") : text;
  const flat = safe.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_UPSTREAM_TEXT ? flat : `${flat.slice(0, MAX_UPSTREAM_TEXT - 1).trimEnd()}…`;
}

type Cause = { name: string; code: string | null; message: string };

/** Node's fetch fails with TypeError("fetch failed"); the reason is in `cause`, or an AggregateError's list. */
function causes(err: unknown, depth = 0): Cause[] {
  if (!(err instanceof Error) || depth > 4) return [];
  const own = { name: err.name, code: str(prop(err, "code")), message: err.message };
  const listed = err instanceof AggregateError ? err.errors.flatMap((e) => causes(e, depth + 1)) : [];
  return [own, ...listed, ...causes(err.cause, depth + 1)];
}

const TIMEOUT_CODES = [
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
];

/** Our own deadline (AbortSignal.timeout) or one of Node's socket timeouts. */
export function isTimeout(err: unknown): boolean {
  return causes(err).some((c) => c.name === "TimeoutError" || TIMEOUT_CODES.includes(c.code ?? ""));
}

/** A request that got no answer at all: down, wrong address, DNS, TLS or timeout. */
export function networkError(host: string, err: unknown): HttpError {
  const list = causes(err);
  const has = (...codes: string[]) => list.some((c) => c.code !== null && codes.includes(c.code));
  const unreachable = (message: string) => new HttpError("ai_unreachable", message);
  if (isTimeout(err)) return unreachable(`${host} didn't answer in time.`);
  if (has("ECONNREFUSED")) {
    return unreachable(`Couldn't reach ${host}: nothing answered there. Is the server running?`);
  }
  if (has("ENOTFOUND", "EAI_AGAIN")) return unreachable(`Couldn't find ${host}. Check the server URL.`);
  if (list.some((c) => c.message === "unexpected redirect")) {
    // Keys are never sent on to another address (redirect: "error"); the fix is the final URL.
    return new HttpError(
      "ai_upstream",
      `${host} answered with a redirect. Enter the exact server URL (https:// rather than http://, say).`,
    );
  }
  if (has("ERR_SSL_WRONG_VERSION_NUMBER", "ERR_SSL_PACKET_LENGTH_TOO_LONG")) {
    return unreachable(`${host} doesn't answer HTTPS here. Try http:// instead.`);
  }
  if (list.some((c) => /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(c.code ?? ""))) {
    return unreachable(`Couldn't reach ${host} securely: its HTTPS certificate isn't trusted.`);
  }
  return unreachable(`Couldn't reach ${host}.`);
}

/**
 * A request that failed before it got an answer. fetch throws a bare TypeError, with no network error as
 * its cause, when it can't even send the request; with a key set, that is a key header value HTTP can't
 * carry (a zero-width space or a curly dash pasted along with it), which a network message would hide.
 */
export function sendError(ctx: UpstreamContext, err: unknown): HttpError {
  if (ctx.secret && err instanceof TypeError && err.cause === undefined) {
    return new HttpError(
      "ai_upstream",
      `The API key for ${ctx.host} has a character that can't be sent, such as a space or an invisible one. Enter the key again in Settings.`,
    );
  }
  return networkError(ctx.host, err);
}

/** What a request was for: the wording of a 404 depends on it (unknown model vs. wrong URL). */
export type StatusContext = UpstreamContext & { notFound: string };

/**
 * A non-2xx answer as an ai_upstream HttpError that still knows the status and what the server said, so
 * an adapter can react to one it can fix itself (Anthropic's max_tokens limit, say).
 */
export class UpstreamStatusError extends HttpError {
  constructor(
    message: string,
    readonly status: number,
    readonly problem: Problem,
  ) {
    super("ai_upstream", message);
  }
}

/** A non-2xx answer. */
export function statusError(status: number, ctx: StatusContext, problem: Problem): UpstreamStatusError {
  const { host, secret } = ctx;
  const detail = problem.message === null ? null : upstreamText(problem.message, secret);
  const upstream = (message: string) => new UpstreamStatusError(message, status, problem);
  if (status === 401 && !secret) {
    return upstream(`${host} asks for an API key. Add one to this connection in Settings.`);
  }
  if (status === 401 || (status === 403 && secret)) return upstream(`${host} refused the API key.`);
  if (status === 404) return upstream(ctx.notFound);
  if (status === 429) return upstream(`${host} is limiting requests. Wait a moment and try again.`);
  if (problem.type === "overloaded_error") return upstream(OVERLOADED);
  if (status >= 500) return upstream(`${host} had a problem (${status}). Try again in a moment.`);
  return upstream(detail ? `${host} answered ${status}: ${detail}` : `${host} answered ${status}.`);
}

/** An error the server reported after answering 2xx: an error event or error line mid-reply. */
export function reportedError(ctx: UpstreamContext, problem: Problem): HttpError {
  if (problem.type === "overloaded_error") return new HttpError("ai_upstream", OVERLOADED);
  const detail = problem.message === null ? null : upstreamText(problem.message, ctx.secret);
  return new HttpError(
    "ai_upstream",
    detail ? `${ctx.host} reported an error: ${detail}` : `${ctx.host} reported an error.`,
  );
}

/** A 2xx answer that isn't what the API sends: usually a server URL pointing at something else. */
export function unreadable(host: string): HttpError {
  return new HttpError(
    "ai_upstream",
    `${host} sent something that isn't a model reply. Check the server URL and provider.`,
  );
}

/** The stream ended without the API's end marker, so the text so far may be cut off anywhere. */
export function brokeOff(host: string): HttpError {
  return new HttpError("ai_upstream", `${host} stopped before the reply was complete.`);
}

/** A failure while reading a body that had started to arrive. */
export function readError(host: string, err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof SseEventTooLarge) return unreadable(host);
  // The inactivity timeout (./idle.ts): nothing arrived for a long while after the reply had started.
  if (isTimeout(err)) return new HttpError("ai_upstream", `${host} went silent partway through its answer.`);
  return new HttpError("ai_upstream", `The connection to ${host} broke off.`);
}
