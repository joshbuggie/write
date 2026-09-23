import type { ApiErrorBody } from "./api-contract";
import { ApiError, codeFromStatus } from "./api-client";

/** How long the object URL stays alive after the click. Safari and Firefox read it asynchronously. */
const REVOKE_AFTER_MS = 60_000;

/**
 * Downloads `href` (an /api/download URL) without leaving the page.
 * Navigating to the URL would replace the whole app with the JSON body of any error response (a note renamed
 * a moment ago, an expired session), and an iOS home-screen app has no back button to recover from that.
 * So the response is fetched first: errors reject with the same ApiError the api-client throws, and only a
 * successful body is saved, through a temporary object URL and an `<a download>` click. The whole file is
 * held in memory, which is fine for notes and zips of notes.
 */
export async function downloadFile(href: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(href, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError(0, "network", "Can't reach the server.");
  }
  if (!res.ok) throw await errorFrom(res);
  const blob = await res.blob();
  saveBlob(blob, filenameFromDisposition(res.headers.get("Content-Disposition")) ?? "download");
}

/**
 * What to download: an /api/download URL, or a function that works it out once the open note is saved.
 * The function form is for the open note itself: a rename or move may still be in flight when the user
 * clicks, and the URL must name the note where it ends up, not where it was.
 */
export type DownloadTarget = string | (() => string | Promise<string>);

/**
 * Saves the open note (`flush`, which also waits for a rename or move in flight), then resolves the target
 * and downloads it. Resolving after the flush is what makes a download clicked mid-rename fetch the new
 * name instead of failing with "not found".
 */
export async function flushThenDownload(
  flush: () => Promise<void>,
  target: DownloadTarget,
  download: (href: string) => Promise<void> = downloadFile,
): Promise<void> {
  await flush();
  await download(typeof target === "string" ? target : await target());
}

/**
 * The file name from a Content-Disposition header: the exact UTF-8 `filename*` first (the server sends it
 * for every download), then the ASCII `filename` fallback. Null when the header has neither.
 */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*UTF-8''([^;\s]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1]);
    } catch {
      // Malformed percent-encoding: use the plain filename instead.
    }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i.exec(header);
  if (!plain) return null;
  return plain[1] !== undefined ? plain[1].replace(/\\(.)/g, "$1") : plain[2];
}

/** Every /api error carries an ApiErrorBody; the status fallback covers bodies that aren't ours. */
async function errorFrom(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  const code = body?.error?.code ?? codeFromStatus(res.status);
  return new ApiError(res.status, code, body?.error?.message ?? `Download failed (${res.status}).`, body);
}

function saveBlob(blob: Blob, filename: string): void {
  // A generic type makes Safari save the file instead of previewing text/markdown in place.
  const url = URL.createObjectURL(blob.slice(0, blob.size, "application/octet-stream"));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.hidden = true;
  document.body.append(a); // Firefox ignores clicks on detached anchors
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
