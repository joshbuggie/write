/**
 * Storage public API: the ONLY code in the app that touches the filesystem. Notes are plain .md files in
 * folders under the data dir; see the sibling modules for the rules (atomic writes, trash, versions).
 * write's own settings (the AI assistant's, with its API keys) are one JSON file in the separate config dir.
 */
export { StorageError, type StorageErrorCode } from "./errors";
export { getConfigDir, getDataDir } from "./config";
export { ensureBootstrap } from "./bootstrap";
export { checkHealth } from "./health";
export { listTree, createFolder, renameFolder, deleteFolder } from "./folders";
export {
  readNote,
  createNote,
  saveNote,
  updateNote,
  deleteNote,
  discardIfEmpty,
  readNoteFile,
  mostRecentNote,
} from "./notes";
export { zipAll, zipFolder } from "./export";
export {
  readAiSettings,
  saveAiSettings,
  apiKeyFor,
  toAiSettingsView,
  type StoredAiSettings,
  type StoredConnection,
} from "./settings";
