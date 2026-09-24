import type { AiSettings, ProviderId } from "./ai/settings";
import type { IntegrationKind, IntegrationView } from "./integrations";
import type { SectionEdit } from "./proposals/apply";
import type { ChangeDecision, ProposalReview, ProposalStatus } from "./proposals/types";
import type { FolderSummary, Note, NoteRef, NoteSummary, SavedNote, Tree } from "./types";

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
  | "already_set_up"
  | "wrong_password"
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
  /** First-run setup was already done (by another tab or person): sign in instead. */
  already_set_up: 409,
  /** Changing the password: the current password given doesn't match. */
  wrong_password: 403,
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
  setup: "/api/auth/setup",
  password: "/api/auth/password",
  settings: "/api/settings",
  aiModels: "/api/ai/models",
  aiComplete: "/api/ai/complete",
  integrations: "/api/integrations",
  integrationToken: "/api/integrations/token",
  agentTree: "/api/agent/tree",
  agentNotes: "/api/agent/notes",
  agentProposals: "/api/agent/proposals",
  proposals: "/api/proposals",
  resolveProposal: "/api/proposals/resolve",
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
  username: string;
  password: string;
}

/**
 * `POST /api/auth/password`, from Settings. Answers 204 with a new session cookie for this browser; every
 * other device is signed out.
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** `POST /api/auth/setup`: the account to create on first run. Answers 204 with a session cookie. */
export interface SetupRequest {
  username: string;
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

/** `GET /api/integrations`: every integration, without tokens (docs/design-decisions.md#d31). */
export interface IntegrationsResponse {
  integrations: IntegrationView[];
}

/** `POST /api/integrations` makes one; `PATCH` changes one, with its `id`. Folders must exist. */
export interface IntegrationRequest {
  name: string;
  kind: IntegrationKind;
  folders: string[];
}
export interface UpdateIntegrationRequest extends IntegrationRequest {
  id: string;
}
export interface IntegrationResponse {
  integration: IntegrationView;
}

/** `POST /api/integrations/token`: replaces the integration's token. The old one stops working at once. */
export interface RotateTokenRequest {
  id: string;
}

/** Making an integration or replacing its token: the only time the token is ever shown. */
export interface IntegrationTokenResponse {
  integration: IntegrationView;
  token: string;
}

/** `GET /api/agent/tree`, for integrations: only the folders the integration can read. */
export type AgentTreeResponse = Tree;

/**
 * `POST /api/agent/proposals`: changes to one note, for the owner to review (docs/design-decisions.md#d31).
 * `baseVersion` is the version the harness read with `GET /api/agent/notes`. Send the whole revised note
 * as `content`, or only the sections that changed as `sections`, never both.
 */
export interface AgentProposalRequest {
  folder: string;
  name: string;
  baseVersion: string;
  content?: string;
  sections?: SectionEdit[];
  /** One line on what changed and why, shown with the review. */
  summary?: string;
  /** Why each section changed, by heading ("Plan" or "## Plan"). */
  reasons?: Record<string, string>;
  /** The harness's own id for this request: sending it again returns the first proposal instead of a new one. */
  requestId?: string;
}

/** A proposal as its harness sees it. */
export interface AgentProposal {
  id: string;
  status: ProposalStatus;
  note: NoteRef;
  summary: string;
  /** ISO 8601. */
  createdAt: string;
  /** Changes still waiting for the owner; 0 once everything is decided. */
  waiting: number;
  /** The owner's decisions so far, one per section. */
  decisions: ChangeDecision[];
  /** The note's version now, to read it again from; null when the note is gone. */
  noteVersion: string | null;
}

/** Answer to creating a proposal (201) or to a retry of one already made (200), and to looking one up. */
export interface AgentProposalResponse {
  proposal: AgentProposal;
}

/** `GET /api/proposals?folder=&name=`: the note's pending proposals, each reviewed against the note now. */
export interface ProposalsResponse {
  reviews: ProposalReview[];
}

/**
 * `POST /api/proposals/resolve`: the owner's decisions. Accepted sections are applied to the note in one
 * save, which needs the note still at `noteVersion` (else 409 with the note as it is now). Changes left
 * undecided keep waiting.
 */
export interface ResolveProposalRequest {
  id: string;
  noteVersion: string;
  accept: string[];
  reject: string[];
}
export interface ResolveProposalResponse {
  /** The note after the save, or as it was when nothing was accepted. */
  note: SavedNote;
  /** The note's whole text now. */
  content: string;
  /** The whole text before, for Undo. */
  previousContent: string;
  /** Changes still waiting after these decisions. */
  waiting: number;
}
