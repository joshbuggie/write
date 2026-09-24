import type {
  ChatTurn,
  CompleteRequest,
  ConnectionInput,
  CreateFolderRequest,
  CreateNoteRequest,
  LoginRequest,
  RenameFolderRequest,
  SaveNoteRequest,
  SaveSettingsRequest,
  TestConnectionRequest,
  UpdateNoteRequest,
} from "@/lib/api-contract";
import { AI_LIMITS, PROVIDER_IDS, type QuickAction } from "@/lib/ai/settings";

/**
 * Hand-written type guards for request bodies (no schema library, see docs/design-decisions.md#d4). They
 * check shapes only; name rules and existence are enforced by storage so the error codes stay precise
 * (invalid_name, not_found…).
 */

type Fields = Record<string, unknown>;

const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isOptionalString = (v: unknown): v is string | undefined => v === undefined || isString(v);

export function isCreateFolderRequest(v: unknown): v is CreateFolderRequest {
  return isObject(v) && isString(v.name);
}

export function isRenameFolderRequest(v: unknown): v is RenameFolderRequest {
  return isObject(v) && isString(v.name) && isString(v.newName);
}

export function isCreateNoteRequest(v: unknown): v is CreateNoteRequest {
  return isObject(v) && isString(v.folder) && isOptionalString(v.name) && isOptionalString(v.content);
}

export function isSaveNoteRequest(v: unknown): v is SaveNoteRequest {
  return (
    isObject(v) &&
    isString(v.folder) &&
    isString(v.name) &&
    isString(v.content) &&
    (v.baseVersion === null || isString(v.baseVersion)) &&
    (v.force === undefined || typeof v.force === "boolean")
  );
}

/** A rename/move must ask for at least one change. */
export function isUpdateNoteRequest(v: unknown): v is UpdateNoteRequest {
  return (
    isObject(v) &&
    isString(v.folder) &&
    isString(v.name) &&
    isOptionalString(v.newName) &&
    isOptionalString(v.newFolder) &&
    (v.newName !== undefined || v.newFolder !== undefined)
  );
}

export function isLoginRequest(v: unknown): v is LoginRequest {
  return isObject(v) && isString(v.password);
}

// ---- AI assistant (see docs/design-decisions.md#d29) ----

const isShortString = (v: unknown, max: number = AI_LIMITS.field): v is string =>
  isString(v) && v.length <= max;
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

/** http(s) only: the server fetches this URL, so file:, data: and friends are refused. Empty means unset. */
const isBaseUrl = (v: unknown): v is string => {
  if (!isShortString(v)) return false;
  if (v.trim() === "") return true;
  try {
    const url = new URL(v.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
};

/**
 * Visible ASCII only, once trimmed. Keys are, and HTTP headers can't carry much else: a zero-width space
 * or a curly dash pasted along with a key would otherwise fail every request with a misleading error.
 */
const isApiKey = (v: unknown): v is string => isShortString(v) && /^[\x21-\x7e]*$/.test(v.trim());

function isConnectionInput(v: unknown): v is ConnectionInput {
  return (
    isObject(v) &&
    isShortString(v.id) &&
    v.id !== "" &&
    isShortString(v.name) &&
    PROVIDER_IDS.includes(v.provider as ConnectionInput["provider"]) &&
    isBaseUrl(v.baseUrl) &&
    isShortString(v.model) &&
    (v.apiKey === undefined || isApiKey(v.apiKey)) &&
    (v.clearKey === undefined || isBoolean(v.clearKey))
  );
}

function isQuickAction(v: unknown): v is QuickAction {
  return (
    isObject(v) &&
    isShortString(v.id) &&
    isShortString(v.label) &&
    isShortString(v.prompt, AI_LIMITS.prompt) &&
    (v.apply === "replace" || v.apply === "insert")
  );
}

const isArrayOf = <T>(v: unknown, max: number, item: (x: unknown) => x is T): v is T[] =>
  Array.isArray(v) && v.length <= max && v.every(item);

/** The whole AI settings object from the Settings dialog; ids must be unique and the default must exist. */
export function isSaveSettingsRequest(v: unknown): v is SaveSettingsRequest {
  if (!isObject(v) || !isObject(v.ai)) return false;
  const ai = v.ai;
  if (
    !isBoolean(ai.enabled) ||
    !isArrayOf(ai.connections, AI_LIMITS.connections, isConnectionInput) ||
    !(ai.defaultConnectionId === null || isShortString(ai.defaultConnectionId)) ||
    !isShortString(ai.shortcut, 40) ||
    !(ai.defaultScope === "selection" || ai.defaultScope === "note") ||
    !isShortString(ai.instructions, AI_LIMITS.instructions) ||
    !isArrayOf(ai.quickActions, AI_LIMITS.quickActions, isQuickAction)
  ) {
    return false;
  }
  const ids = ai.connections.map((c) => c.id);
  if (new Set(ids).size !== ids.length) return false;
  return ai.defaultConnectionId === null || ids.includes(ai.defaultConnectionId);
}

export function isTestConnectionRequest(v: unknown): v is TestConnectionRequest {
  return isObject(v) && isConnectionInput(v.connection);
}

const isChatTurn = (v: unknown): v is ChatTurn =>
  isObject(v) && (v.role === "user" || v.role === "assistant") && isString(v.content);

/** A conversation that starts and ends with the user, alternating, within the turn limit. */
export function isCompleteRequest(v: unknown): v is CompleteRequest {
  if (!isObject(v) || !isShortString(v.connectionId) || !isShortString(v.system, AI_LIMITS.instructions)) {
    return false;
  }
  const turns = v.messages;
  if (!isArrayOf(turns, AI_LIMITS.turns, isChatTurn) || turns.length === 0) return false;
  return turns.every((t, i) => t.role === (i % 2 === 0 ? "user" : "assistant")) && turns.length % 2 === 1;
}
