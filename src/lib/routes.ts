import { API } from "./api-contract";
import type { NoteRef } from "./types";

const enc = encodeURIComponent;
function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export const LIBRARY_HREF = "/notes";
export const noteHref = (r: NoteRef) => `/notes/${enc(r.folder)}/${enc(r.name)}`;
export const downloadNoteHref = (r: NoteRef) => `${API.download}${query({ folder: r.folder, name: r.name })}`;
export const downloadFolderHref = (folder: string) => `${API.download}${query({ folder })}`;
export const downloadAllHref = () => API.download;
export const loginHref = (next?: string) => `/login${query({ next })}`;
export const SETUP_HREF = "/setup";
export const apiQuery = query;

/**
 * Page `params` are RAW percent-encoded in Next 16.3 (verified); Route Handler params are decoded.
 * Pages call this exactly once per segment. Tolerant: malformed input is returned unchanged.
 */
export function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function noteRefFromParams(p: { folder: string; note: string }): NoteRef {
  return { folder: decodeSegment(p.folder), name: decodeSegment(p.note) };
}

const NEXT_BASE = "http://next.invalid";
/** Browsers strip tabs/newlines and treat "\\" as "/" in URLs, so "/\t/evil.com" means "//evil.com". */
const UNSAFE_IN_NEXT = /[\p{Cc}\s\\]/u;

/**
 * True for a path a browser resolves against the current origin. "//host" and "/\\host" are
 * protocol-relative: they keep the scheme but switch to another host.
 */
function isOriginRelativePath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}

/**
 * Open-redirect guard for ?next=: returns a same-origin path, or "/" for anything else. Prefix checks
 * aren't enough (see UNSAFE_IN_NEXT), so the value is parsed the way a browser would and its origin
 * compared. The re-serialized path is returned, so nothing the parser dropped can reach a Location header.
 * Parsing also resolves dot segments ("/.//evil.com", "/a/%2e%2e//evil.com" become "//evil.com"), so the
 * serialized result is checked again before it is returned.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !isOriginRelativePath(next) || UNSAFE_IN_NEXT.test(next)) return "/";
  let url: URL;
  try {
    url = new URL(next, NEXT_BASE);
  } catch {
    return "/";
  }
  if (url.origin !== NEXT_BASE) return "/";
  const path = url.pathname + url.search + url.hash;
  return isOriginRelativePath(path) ? path : "/";
}
