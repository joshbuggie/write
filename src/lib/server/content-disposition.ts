/**
 * `Content-Disposition: attachment` for any file name. Header values must be Latin-1, so the plain
 * `filename` gets an ASCII fallback while `filename*` (RFC 5987/6266) carries the exact UTF-8 name,
 * which every current browser prefers.
 */
export function attachment(filename: string): string {
  const ascii = filename
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // drop combining marks left by NFKD, so "Café" falls back to "Cafe"
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
