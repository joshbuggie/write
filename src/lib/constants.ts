export const DEFAULT_FOLDER = "notebook";
export const UNTITLED = "Untitled";
export const NOTE_EXT = ".md";
/** Hard cap for a note file (also the PUT body cap). Must stay below the proxy's 10 MB body buffer. */
export const MAX_NOTE_BYTES = 5 * 1024 * 1024;
/** Above this, notes open in Markdown source mode (Tiptap parse is superlinear). */
export const VISUAL_EDITOR_MAX_BYTES = 256 * 1024;
/** Max UTF-8 bytes for a note title or folder name (ext4 counts bytes; leaves room for ".md" and suffixes). */
export const MAX_NAME_BYTES = 200;
/** fetch keepalive bodies share a 64 KiB quota. */
export const KEEPALIVE_MAX_BYTES = 60 * 1024;
export const SIDEBAR_COOKIE = "write-sidebar";
export const SESSION_COOKIE = "write_session";
