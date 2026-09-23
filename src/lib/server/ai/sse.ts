/**
 * A server-sent events reader for model replies (see docs/design-decisions.md#d29). Both model APIs stream
 * SSE, and servers differ in the details, so this follows the WHATWG parsing rules instead of splitting on
 * "\n\n": LF, CRLF or CR line ends, `data:` spread over several lines, `:` comments (keep-alives), and chunk
 * boundaries anywhere, including inside a line ending or a UTF-8 character.
 */

/** One dispatched event. `event` is "message" when the server named none. */
export type SseEvent = { event: string; data: string };

/**
 * Thrown when a server sends an event bigger than any real one, as one endless line or as endless `data:`
 * lines with no blank line to end the event, so a runaway or hostile stream can't fill the server's memory.
 */
export class SseEventTooLarge extends Error {
  constructor() {
    super("An event stream event exceeded the size limit.");
    this.name = "SseEventTooLarge";
  }
}

/**
 * Characters one event may hold before it is dispatched: its `data:` lines so far plus the unfinished
 * line. A text delta is a few bytes; this leaves room for odd servers' big events.
 */
export const MAX_SSE_EVENT = 4 * 1024 * 1024;

const LINE_END = /\r\n|\r|\n/g;

/**
 * Splits complete lines off `buffer`. A trailing CR is held back until the next chunk shows whether an LF
 * follows it, so a CRLF split across chunks doesn't read as an extra, event-dispatching blank line.
 */
function takeLines(buffer: string, final: boolean): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  LINE_END.lastIndex = 0;
  for (let m = LINE_END.exec(buffer); m; m = LINE_END.exec(buffer)) {
    if (!final && m[0] === "\r" && m.index === buffer.length - 1) break;
    lines.push(buffer.slice(start, m.index));
    start = LINE_END.lastIndex;
  }
  const rest = buffer.slice(start);
  if (!final) return { lines, rest };
  if (rest !== "") lines.push(rest);
  return { lines, rest: "" };
}

/** Parses the body as it arrives; cancels it when the consumer stops early. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder(); // drops a leading BOM; `stream: true` keeps split characters whole
  const reader = body.getReader();
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let pending = 0; // characters held in `data`, counted so the limit covers the whole event
  let finished = false;
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      finished = done;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const { lines, rest } = takeLines(buffer, done);
      buffer = rest;
      if (done) lines.push(""); // a server that ends without a blank line still gets its last event read
      for (const line of lines) {
        if (line === "") {
          if (data.length > 0) yield { event: event || "message", data: data.join("\n") };
          event = "";
          data = [];
          pending = 0;
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const raw = colon === -1 ? "" : line.slice(colon + 1);
        const value = raw.startsWith(" ") ? raw.slice(1) : raw;
        if (field === "data") {
          data.push(value);
          pending += value.length + 1; // the "\n" that joins it to the next line
          if (pending > MAX_SSE_EVENT) throw new SseEventTooLarge();
        } else if (field === "event") event = value;
      }
      if (pending + buffer.length > MAX_SSE_EVENT) throw new SseEventTooLarge(); // incl. a line that never ends
    }
  } finally {
    if (finished) reader.releaseLock();
    else reader.cancel().catch(() => {}); // stopped early or failed: let the connection go
  }
}
