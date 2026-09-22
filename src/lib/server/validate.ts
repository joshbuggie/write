import type {
  CreateFolderRequest,
  CreateNoteRequest,
  LoginRequest,
  RenameFolderRequest,
  SaveNoteRequest,
  UpdateNoteRequest,
} from "@/lib/api-contract";

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
