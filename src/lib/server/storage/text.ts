import { createHash } from "node:crypto";

export type Eol = "lf" | "crlf";

/** What a note file looked like on disk, so a save can write it back the same way. */
export type DecodedText = {
  /** BOM stripped, CRLF normalized to LF. Lossy (U+FFFD) when utf8Ok is false. */
  text: string;
  eol: Eol;
  bom: boolean;
  utf8Ok: boolean;
};

const BOM = [0xef, 0xbb, 0xbf];
const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const lossy = new TextDecoder("utf-8", { ignoreBOM: true });

const hasBom = (bytes: Uint8Array) => BOM.every((b, i) => bytes[i] === b);

/** Decodes note bytes for the editor. The EOL style comes from the first line break (LF if none). */
export function decode(bytes: Uint8Array): DecodedText {
  const bom = hasBom(bytes);
  const body = bom ? bytes.subarray(BOM.length) : bytes;
  let text: string;
  let utf8Ok = true;
  try {
    text = strict.decode(body);
  } catch {
    text = lossy.decode(body);
    utf8Ok = false;
  }
  const firstBreak = text.indexOf("\n");
  const eol: Eol = firstBreak > 0 && text[firstBreak - 1] === "\r" ? "crlf" : "lf";
  return { text: text.replace(/\r\n/g, "\n"), eol, bom, utf8Ok };
}

/** Inverse of decode: re-applies the file's original EOL style and BOM so Windows files stay intact. */
export function encode(text: string, style: { eol: Eol; bom: boolean }): Buffer {
  const body = Buffer.from(style.eol === "crlf" ? text.replace(/\n/g, "\r\n") : text, "utf8");
  return style.bom ? Buffer.concat([Buffer.from(BOM), body]) : body;
}

/** Opaque note version: first 16 hex chars of sha256 over the exact bytes on disk (catches EOL-only edits). */
export function versionOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** Normalizes any line endings a client sends (CRLF or lone CR) to LF. */
export const toLf = (text: string) => text.replace(/\r\n?/g, "\n");

/** Same as versionOf, for files too large to buffer (read-only "too-large" notes). */
export async function versionOfStream(chunks: AsyncIterable<Uint8Array | string>): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of chunks) hash.update(chunk);
  return hash.digest("hex").slice(0, 16);
}
