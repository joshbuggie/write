/**
 * Storage public API: the ONLY code in the app that touches the filesystem. Notes are plain .md files in
 * folders under the data dir; see the sibling modules for the rules (atomic writes, trash, versions).
 */
export { StorageError, type StorageErrorCode } from "./errors";
export { getDataDir } from "./config";
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
