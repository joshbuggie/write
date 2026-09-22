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
  | "storage_unavailable"
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
  internal: 500,
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

/** Response of `DELETE /api/notes?folder=&name=&ifEmpty=1` (§17.1): whether the empty note was removed. */
export interface DiscardNoteResponse {
  deleted: boolean;
}

export interface LoginRequest {
  password: string;
}
