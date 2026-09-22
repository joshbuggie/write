import { NOTE_EXT } from "@/lib/constants";
import { attachment } from "@/lib/server/content-disposition";
import { handle, requireParam } from "@/lib/server/http";
import { readNoteFile, zipAll, zipFolder } from "@/lib/server/storage";

/** Binary download with headers that force "save as" and stop browsers from sniffing the content. */
function download(bytes: Uint8Array, filename: string, contentType: string): Response {
  // fs and fflate always return ArrayBuffer-backed arrays; the cast only narrows TS's ArrayBufferLike.
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": attachment(filename),
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * - no params: every note as write-notes-YYYY-MM-DD.zip
 * - `?folder=`: one folder as <folder>.zip
 * - `?folder=&name=`: the exact bytes of <name>.md on disk
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.has("name")) {
    const ref = { folder: requireParam(url, "folder"), name: requireParam(url, "name") };
    const { bytes } = await readNoteFile(ref);
    return download(bytes, ref.name + NOTE_EXT, "text/markdown; charset=utf-8");
  }
  const zip = url.searchParams.has("folder") ? await zipFolder(requireParam(url, "folder")) : await zipAll();
  return download(zip.bytes, zip.filename, "application/zip");
});
