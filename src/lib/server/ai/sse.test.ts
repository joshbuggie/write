import { describe, expect, it } from "vitest";
import { MAX_SSE_EVENT, readSse, SseEventTooLarge, type SseEvent } from "./sse";
import { bytewise, chunked } from "./test-utils";

async function events(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const e of readSse(body)) out.push(e);
  return out;
}

/** A byte order mark, which a stream may start with. */
const BOM = String.fromCharCode(0xfeff);
const STREAM = [
  `${BOM}: a comment, like a keep-alive`,
  "event: greeting",
  "data: first line",
  "data:second line",
  "id: 7",
  "retry: 1000",
  "",
  'data: {"x":"é👋"}',
  "",
  "",
  "data",
  "",
];
const EXPECTED: SseEvent[] = [
  { event: "greeting", data: "first line\nsecond line" },
  { event: "message", data: '{"x":"é👋"}' },
  { event: "message", data: "" },
];

describe("readSse", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("parses events with %s line ends, byte by byte", async (_, eol) => {
    const text = STREAM.join(eol);
    expect(await events(chunked([text]))).toEqual(EXPECTED);
    expect(await events(bytewise(text))).toEqual(EXPECTED);
  });

  it("reads a CRLF split across chunks as one line end, not a blank line", async () => {
    const body = chunked(["data: a\r", "\ndata: b\r", "\n\r", "\n"]);
    expect(await events(body)).toEqual([{ event: "message", data: "a\nb" }]);
  });

  it("keeps UTF-8 characters split across chunks whole", async () => {
    const bytes = new TextEncoder().encode("data: né 👋 ok\n\n");
    const body = chunked([bytes.slice(0, 8), bytes.slice(8, 11), bytes.slice(11)]);
    expect(await events(body)).toEqual([{ event: "message", data: "né 👋 ok" }]);
  });

  it("reads a last event that has no blank line after it", async () => {
    expect(await events(chunked(["data: one\n\ndata: [DONE]"]))).toEqual([
      { event: "message", data: "one" },
      { event: "message", data: "[DONE]" },
    ]);
  });

  it("ignores unknown fields and events without data", async () => {
    expect(await events(chunked(["event: ping\n\nfoo: bar\nid: 1\n\ndata: x\n\n"]))).toEqual([
      { event: "message", data: "x" },
    ]);
  });

  /** An endless body that repeats `piece`. */
  const endless = (piece: string) =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(piece));
      },
    });

  it("refuses a line that never ends", async () => {
    await expect(events(endless("x".repeat(1024 * 1024)))).rejects.toBeInstanceOf(SseEventTooLarge);
    expect(MAX_SSE_EVENT).toBeGreaterThan(1024 * 1024);
  });

  it("refuses an event whose data lines never end, however short each line is", async () => {
    await expect(events(endless(`data: ${"x".repeat(64 * 1024)}\n`))).rejects.toBeInstanceOf(
      SseEventTooLarge,
    );
  });

  it("counts each event on its own, so a long stream of big events is fine", async () => {
    const big = `data: ${"x".repeat(MAX_SSE_EVENT / 4)}\n`;
    const text = `${big.repeat(3)}\n`.repeat(4);
    const out = await events(chunked(text.match(/[^]{1,65536}/g)!));
    expect(out).toHaveLength(4);
    expect(out[0].data).toHaveLength((MAX_SSE_EVENT / 4) * 3 + 2);
  });

  it("cancels the body when the reader stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("data: more\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const e of readSse(body)) {
      expect(e.data).toBe("more");
      break;
    }
    expect(cancelled).toBe(true);
  });
});
