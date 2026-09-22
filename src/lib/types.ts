/** Shared domain types. Isomorphic: must not import Node or browser APIs. */

/** Identifies a note. `name` is the file name without ".md" (the title). Both are exact on-disk names. */
export type NoteRef = { folder: string; name: string };

export type NoteSummary = NoteRef & {
  /** ISO 8601, from the file mtime. */
  updatedAt: string;
  /** Size on disk in bytes. */
  size: number;
};

export type ReadOnlyReason = "not-utf8" | "too-large";

export type Note = NoteSummary & {
  /** Full file text: front matter included, BOM stripped, CRLF normalized to LF. "" when readOnly === "too-large". */
  content: string;
  /** Opaque version: first 16 hex chars of sha256(raw bytes on disk). */
  version: string;
  /** Non-null → the UI must not offer editing. */
  readOnly: ReadOnlyReason | null;
};

export type SavedNote = NoteSummary & { version: string };

export type FolderSummary = {
  name: string;
  /** Sorted with compareNames. */
  notes: NoteSummary[];
};

export type Tree = {
  /** Sorted with compareNames. Never empty after bootstrap. */
  folders: FolderSummary[];
};
