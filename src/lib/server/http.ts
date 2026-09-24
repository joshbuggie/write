import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from "@/lib/api-contract";
import { MAX_NOTE_BYTES } from "@/lib/constants";
import { authenticateRequest, lockoutResponse } from "./auth";
import { StorageError } from "./storage";

/**
 * Shared plumbing for every Route Handler (see docs/design-decisions.md#d3): auth, CSRF, JSON parsing and
 * error mapping live here so each route file only contains its happy path.
 */

/** An expected, user-facing failure raised by the HTTP layer itself (bad input, CSRF, auth). */
export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    /** Extra response headers, e.g. Retry-After on a 429. */
    readonly headers?: HeadersInit,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** JSON bodies may carry a full note plus some JSON overhead; anything bigger is rejected before parsing. */
export const MAX_JSON_BYTES = MAX_NOTE_BYTES + 64 * 1024;

/**
 * For bodies that carry a note's text (create, save). JSON escaping grows text (a quote or newline becomes
 * two bytes), so a note under MAX_NOTE_BYTES can need up to about twice that. 10 MiB is also the most
 * Next.js's proxy passes on intact (experimental.proxyClientMaxBodySize); a bigger body would arrive
 * truncated. Storage still enforces MAX_NOTE_BYTES on the decoded text.
 */
export const MAX_NOTE_JSON_BYTES = 10 * 1024 * 1024;

const NO_STORE = "no-store";

/** JSON response that is never cached (notes change underneath the browser all the time). */
export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("Cache-Control", NO_STORE);
  return Response.json(data, { status, headers: h });
}

/** 204 response; `headers` lets login/logout attach a Set-Cookie. */
export function noContent(headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("Cache-Control", NO_STORE);
  return new Response(null, { status: 204, headers: h });
}

function errorJson(
  code: ErrorCode,
  message: string,
  extra?: Pick<ApiErrorBody, "current">,
  headers?: HeadersInit,
): Response {
  const body: ApiErrorBody = { error: { code, message }, ...extra };
  return json(body, ERROR_STATUS[code], headers);
}

/** 429 for a password check refused by the brute-force lockout; Retry-After tells scripts when to retry. */
export function rateLimitedError(): HttpError {
  const { retryAfterS, message } = lockoutResponse();
  return new HttpError("rate_limited", message, { "Retry-After": String(retryAfterS) });
}

/** Maps any thrown value to an ApiErrorBody response. Unknown errors are logged and never leak details. */
export function errorResponse(err: unknown): Response {
  if (err instanceof StorageError) {
    const extra = err.code === "version_conflict" ? { current: err.current ?? null } : undefined;
    return errorJson(err.code, err.message, extra);
  }
  if (err instanceof HttpError) return errorJson(err.code, err.message, undefined, err.headers);
  console.error("[write] unexpected API error", err);
  return errorJson("internal", "Something went wrong on the server.");
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

function isJsonRequest(req: Request): boolean {
  const type = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return type === "application/json";
}

/**
 * CSRF (see docs/design-decisions.md#d14): browsers send Sec-Fetch-Site on every request, so a cross-site
 * write is refused outright; requiring a JSON content type forces a CORS preflight that we never answer. No
 * Origin/Host comparison, so reverse proxies need no configuration.
 */
export function checkCsrf(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    throw new HttpError("forbidden", "Cross-site requests are not allowed.");
  }
  if (BODY_METHODS.has(req.method) && !isJsonRequest(req)) {
    throw new HttpError("unsupported_media_type", "Send the request body as application/json.");
  }
}

async function requireAuth(req: Request): Promise<void> {
  const status = await authenticateRequest(req);
  if (status === "rate_limited") throw rateLimitedError();
  if (status === "unauthorized") throw new HttpError("unauthorized", "Sign in to continue.");
  if (status === "setup") throw new HttpError("unauthorized", SETUP_FIRST);
}

/** What API calls get before first-run setup: there is no account to sign in to yet. */
export const SETUP_FIRST = "Open write in a browser to create the account first.";

/** Wrap every Route Handler: auth (unless opts.public) → CSRF (non-GET/HEAD) → fn → error mapping. */
export function handle<C = unknown>(
  fn: (req: Request, ctx: C) => Promise<Response>,
  opts: { public?: boolean } = {},
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    try {
      if (!opts.public) await requireAuth(req);
      checkCsrf(req);
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

const tooLarge = () => new HttpError("too_large", "The request is too large.");

/** Reads the body with a hard byte cap, so a missing or lying Content-Length can't exhaust memory. */
async function readCappedBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Parses and validates a JSON body. 415 if content-type isn't application/json; 413 if Content-Length or the
 * actual bytes exceed `maxBytes` (MAX_NOTE_JSON_BYTES for note text); 400 on bad JSON or when `guard`
 * rejects the shape.
 */
export async function readJson<T>(
  req: Request,
  guard: (v: unknown) => v is T,
  maxBytes = MAX_JSON_BYTES,
): Promise<T> {
  if (!isJsonRequest(req)) {
    throw new HttpError("unsupported_media_type", "Send the request body as application/json.");
  }
  const bytes = await readCappedBody(req, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError("bad_request", "The request body isn't valid JSON.");
  }
  if (!guard(value)) throw new HttpError("bad_request", "The request body has missing or invalid fields.");
  return value;
}

/**
 * Required, non-empty query parameter. Names always travel in the query string, never in the path (see
 * docs/design-decisions.md#d2).
 */
export function requireParam(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) throw new HttpError("bad_request", `Missing "${key}" query parameter.`);
  return value;
}
