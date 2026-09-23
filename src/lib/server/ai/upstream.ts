import { HttpError } from "../http";
import { idleTimer, watchBody } from "./idle";
import { problemFromText, readError, sendError, statusError } from "./upstream-errors";

/**
 * The one place that calls a model server (see docs/design-decisions.md#d29): plain fetch (no SDK, rule 8),
 * no redirects (a key is only ever sent to the origin it was saved for), an inactivity timeout (./idle.ts),
 * and failures mapped to ai_unreachable / ai_upstream. The caller's own abort (Stop, a closed tab) is
 * rethrown untouched.
 */

/** An answered (2xx) request, with what reading and cancelling it needs. */
export type Upstream = {
  headers: Headers;
  /** The answer's body; every chunk read from it restarts the inactivity timeout. */
  body: ReadableStream<Uint8Array> | null;
  host: string;
  /** The key that was sent, only so that upstream text echoing it can be blanked out. */
  secret: string | null;
  /** The caller's signal: once it fired, errors are its AbortError, passed on unchanged. */
  callerSignal: AbortSignal;
  /** Ends the request early, e.g. when a reply hits its cap or its reader stops. */
  abort: () => void;
};

/** One request to a model server. `notFound` is the message for a 404, which depends on the endpoint. */
export type UpstreamRequest = {
  url: URL;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: unknown;
  apiKey: string | null;
  signal: AbortSignal;
  /**
   * How long the server may send nothing: first while it prepares its answer, then between two chunks of
   * the body. Never a limit on the whole request, so a reply that keeps streaming is never cut off.
   */
  idleTimeoutMs: number;
  notFound: string;
};

/** An error body is only read for its message; anything past this is dropped. */
const MAX_ERROR_BYTES = 64 * 1024;

/**
 * `path` appended to the base URL, ignoring trailing slashes and keeping a query string (some gateways
 * need one). `dropSuffix` lets a base that already ends in it (Anthropic's "/v1") be accepted too.
 */
export function endpoint(baseUrl: string, path: string, dropSuffix?: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new HttpError("bad_request", "The connection's server URL isn't a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError("bad_request", "The connection's server URL must start with http:// or https://.");
  }
  let dir = url.pathname.replace(/\/+$/, "");
  if (dropSuffix && dir.endsWith(dropSuffix)) dir = dir.slice(0, -dropSuffix.length);
  url.pathname = dir + path;
  url.hash = "";
  return url;
}

/** A URL as messages show it: no query string, which is the one part that could carry a secret. */
export function displayUrl(url: URL): string {
  return url.origin + url.pathname;
}

/** Sends the request; resolves on a 2xx answer, throws a mapped HttpError otherwise. */
export async function callUpstream(req: UpstreamRequest): Promise<Upstream> {
  const host = req.url.host;
  const local = new AbortController();
  const idle = idleTimer(req.idleTimeoutMs, local);
  const signal = AbortSignal.any([req.signal, local.signal]);
  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    redirect: "error",
    cache: "no-store",
    signal,
  };
  if (req.body !== undefined) init.body = JSON.stringify(req.body);
  let res: Response;
  try {
    res = await fetch(req.url, init);
  } catch (err) {
    idle.stop();
    if (req.signal.aborted) throw err;
    throw sendError({ host, secret: req.apiKey }, err);
  }
  idle.touch(); // it answered: from here on, the countdown runs between chunks of the body
  if (!res.body) idle.stop();
  const up: Upstream = {
    headers: res.headers,
    body: res.body && watchBody(res.body, idle),
    host,
    secret: req.apiKey,
    callerSignal: req.signal,
    abort: () => {
      idle.stop();
      local.abort();
    },
  };
  if (res.ok) return up;
  let text = "";
  try {
    text = (await readBody(up, MAX_ERROR_BYTES)).text;
  } catch (err) {
    if (req.signal.aborted) throw err; // otherwise the status alone still makes a message
  }
  up.abort();
  throw statusError(res.status, { host, secret: req.apiKey, notFound: req.notFound }, problemFromText(text));
}

/** Reads a whole body up to `maxBytes`; `complete` is false when there was more (which is dropped). */
export async function readBody(up: Upstream, maxBytes: number): Promise<{ text: string; complete: boolean }> {
  const body = up.body;
  if (!body) return { text: "", complete: true };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { text: text + decoder.decode(), complete: true };
      size += value.byteLength;
      if (size > maxBytes) {
        reader.cancel().catch(() => {});
        up.abort();
        return { text, complete: false };
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (err) {
    if (up.callerSignal.aborted) throw err;
    throw readError(up.host, err);
  }
}
