import type { AiSettings, ProviderId } from "./ai/settings";
import type { FolderSummary, Note, NoteSummary, SavedNote, Tree } from "./types";

export type ErrorCode =
  | "bad_request"
  | "invalid_name"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "name_taken"
  | "version_conflict"
  | "read_only"
  | "too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "storage_unavailable"
  | "ai_disabled"
  | "ai_unreachable"
  | "ai_upstream"
  | "internal";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  invalid_name: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  name_taken: 409,
  version_conflict: 409,
  read_only: 409,
  too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  /** The AI assistant is switched off in Settings, so nothing may be sent. */
  ai_disabled: 409,
  internal: 500,
  /** The model server couldn't be reached (down, wrong URL, DNS, timeout). */
  ai_unreachable: 502,
  /** The model server answered with an error (key refused, unknown model, rate limit…). */
  ai_upstream: 502,
  storage_unavailable: 503,
};

/** Every non-2xx JSON response has this shape. `message` is human-readable and safe to show. */
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
  /** Only with version_conflict: the note as it is on disk now, or null if it no longer exists. */
  current?: Note | null;
}

export const API = {
  health: "/api/health",
  tree: "/api/tree",
  folders: "/api/folders",
  notes: "/api/notes",
  download: "/api/download",
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  settings: "/api/settings",
  aiModels: "/api/ai/models",
  aiComplete: "/api/ai/complete",
} as const;

export type HealthResponse = { ok: true } | { ok: false; error: string };
export type TreeResponse = Tree;

export interface CreateFolderRequest {
  name: string;
}
export interface RenameFolderRequest {
  name: string;
  newName: string;
}
export interface FolderResponse {
  folder: FolderSummary;
}

export interface CreateNoteRequest {
  folder: string;
  name?: string;
  content?: string;
}
export interface NoteResponse {
  note: Note;
}

export interface SaveNoteRequest {
  folder: string;
  name: string;
  /** Full file text (front matter + body), LF line endings. */
  content: string;
  /** Version the client's edit is based on; null only with force (re-create a deleted note). */
  baseVersion: string | null;
  /** Overwrite regardless of version (conflict "keep mine"); re-creates a missing file. */
  force?: boolean;
}
export interface SaveNoteResponse {
  note: SavedNote;
}

export interface UpdateNoteRequest {
  folder: string;
  name: string;
  newName?: string;
  newFolder?: string;
}
export interface UpdateNoteResponse {
  note: NoteSummary;
}

/**
 * Response of `DELETE /api/notes?folder=&name=&ifEmpty=1` (see docs/design-decisions.md#d11): whether the
 * empty note was removed.
 */
export interface DiscardNoteResponse {
  deleted: boolean;
}

export interface LoginRequest {
  password: string;
}

/** `GET` and `PUT /api/settings`. API keys never appear: each connection only carries `keyHint`. */
export interface SettingsResponse {
  ai: AiSettings;
}

/**
 * A connection as the Settings form sends it. The saved key is kept unless `apiKey` replaces it or
 * `clearKey` removes it; the browser never has the key to send back.
 */
export interface ConnectionInput {
  id: string;
  name: string;
  provider: ProviderId;
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearKey?: boolean;
}

/** `PUT /api/settings`: the whole AI settings object, with connections as ConnectionInput. */
export interface SaveSettingsRequest {
  ai: Omit<AiSettings, "connections"> & { connections: ConnectionInput[] };
}

/** `POST /api/ai/models` ("Test connection"): a connection from the form, saved or not. */
export interface TestConnectionRequest {
  connection: ConnectionInput;
}
export interface TestConnectionResponse {
  /** Model ids the server lists, sorted; may be empty for servers without a models list. */
  models: string[];
}

/** One turn of a prompt window conversation: the first request, then replies and follow-ups. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * `POST /api/ai/complete`: exactly what "What gets sent" shows. The server adds the connection's URL, key
 * and model, and what its API needs to stream (such as Anthropic's max_tokens).
 */
export interface CompleteRequest {
  connectionId: string;
  system: string;
  /** Starts and ends with a user turn. */
  messages: ChatTurn[];
}

/** Why a reply ended: finished, cut off by the length limit, or declined by the model. */
export type StopReason = "end" | "length" | "refusal";

/**
 * One line of the newline-delimited JSON that `POST /api/ai/complete` streams back (content type
 * application/x-ndjson). Failures before the stream starts are ordinary ApiErrorBody responses instead.
 */
export type CompleteEvent =
  { text: string } | { done: true; stop: StopReason } | { error: { code: ErrorCode; message: string } };
