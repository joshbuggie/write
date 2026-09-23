import {
  API,
  type ApiErrorBody,
  type CreateNoteRequest,
  type DiscardNoteResponse,
  type ErrorCode,
  type FolderResponse,
  type NoteResponse,
  type SaveNoteRequest,
  type SaveNoteResponse,
  type TreeResponse,
  type UpdateNoteRequest,
  type UpdateNoteResponse,
} from "./api-contract";
import { byteLength } from "./names";
import { apiQuery } from "./routes";
import type { NoteRef } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** "network" = request never got a response (offline, DNS, server down). */
    readonly code: ErrorCode | "network",
    message: string,
    readonly body: ApiErrorBody | null = null,
    /** The response's Retry-After, in seconds (a 429 during a sign-in lockout), or null without one. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const isApiError = (e: unknown, code?: ErrorCode | "network"): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code);

export type RequestOptions = { keepalive?: boolean; signal?: AbortSignal };

/** Fallback for an error response without our JSON body (a proxy's page, a body-less 429). */
export function codeFromStatus(status: number): ErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 413) return "too_large";
  if (status === 415) return "unsupported_media_type";
  if (status === 429) return "rate_limited";
  if (status === 503) return "storage_unavailable";
  return status >= 400 && status < 500 ? "bad_request" : "internal";
}

/**
 * Seconds to wait from a Retry-After header: either a number of seconds or an HTTP date. Null when the
 * header is missing or unreadable; never negative.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  if (!/[a-z]/i.test(text)) return null; // an HTTP date names its weekday and month; "-5" is not one
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

const encodeBody = (body: unknown) => JSON.stringify(body);

/**
 * UTF-8 size of the body `api.saveNote` sends for `input`. The browser's 64 KiB keepalive quota counts
 * this whole body (JSON escapes, folder and name included), so a tab-close save must be sized by it.
 */
export const saveNoteBodyBytes = (input: SaveNoteRequest) => byteLength(encodeBody(input));

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : encodeBody(body),
      keepalive: opts.keepalive,
      signal: opts.signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network", "Can't reach the server.");
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const b = data as ApiErrorBody | null;
    const code = b?.error?.code ?? codeFromStatus(res.status);
    const message = b?.error?.message ?? `Request failed (${res.status}).`;
    throw new ApiError(res.status, code, message, b, parseRetryAfter(res.headers.get("Retry-After")));
  }
  return data as T;
}

export const api = {
  getTree: () => request<TreeResponse>("GET", API.tree),
  createFolder: (name: string) => request<FolderResponse>("POST", API.folders, { name }),
  renameFolder: (name: string, newName: string) =>
    request<FolderResponse>("PATCH", API.folders, { name, newName }),
  deleteFolder: (name: string) => request<void>("DELETE", API.folders + apiQuery({ name })),
  getNote: (ref: NoteRef, opts?: RequestOptions) =>
    request<NoteResponse>(
      "GET",
      API.notes + apiQuery({ folder: ref.folder, name: ref.name }),
      undefined,
      opts,
    ),
  createNote: (input: CreateNoteRequest) => request<NoteResponse>("POST", API.notes, input),
  saveNote: (input: SaveNoteRequest, opts?: RequestOptions) =>
    request<SaveNoteResponse>("PUT", API.notes, input, opts),
  updateNote: (input: UpdateNoteRequest) => request<UpdateNoteResponse>("PATCH", API.notes, input),
  deleteNote: (ref: NoteRef) =>
    request<void>("DELETE", API.notes + apiQuery({ folder: ref.folder, name: ref.name })),
  /**
   * Removes an abandoned, whitespace-only note permanently (see docs/design-decisions.md#d11). Safe to call
   * with keepalive on unmount.
   */
  discardIfEmpty: (ref: NoteRef, opts?: RequestOptions) =>
    request<DiscardNoteResponse>(
      "DELETE",
      API.notes + apiQuery({ folder: ref.folder, name: ref.name, ifEmpty: "1" }),
      undefined,
      opts,
    ),
  login: (password: string) => request<void>("POST", API.login, { password }),
  logout: () => request<void>("POST", API.logout, {}),
};
