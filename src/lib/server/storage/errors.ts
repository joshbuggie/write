import type { ErrorCode } from "@/lib/api-contract";
import type { Note } from "@/lib/types";

export type StorageErrorCode = Extract<
  ErrorCode,
  | "bad_request"
  | "invalid_name"
  | "not_found"
  | "name_taken"
  | "version_conflict"
  | "read_only"
  | "too_large"
  | "storage_unavailable"
>;

export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    /** Human-readable; safe to show. Only storage_unavailable may mention the data dir path. */
    message: string,
    /** Only for version_conflict: current on-disk note, or null if the file is gone. */
    readonly current?: Note | null,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
