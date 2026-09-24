import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listModels, openReply } from ".";
import {
  chunkLine,
  eventLine,
  failure,
  hangingBody,
  mockFetch,
  OLLAMA,
  ANTHROPIC,
  replyOf,
  sse,
} from "./test-utils";

/**
 * The inactivity timeout (./idle.ts) with fake timers: a model server may stay silent for 10 minutes while
 * a reply is prepared or between chunks, but a reply that keeps streaming is never cut off by time.
 */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const MINUTE = 60_000;
const never = () => new AbortController().signal;
const REQUEST = { system: "", messages: [{ role: "user" as const, content: "Hi" }] };
const encoder = new TextEncoder();

/**
 * A body that sends each chunk `gapMs` after the one before. Like Node's fetch body, it fails with the
 * signal's reason once the request is aborted, so a timeout that fired would show.
 */
function slowBody(signal: AbortSignal, chunks: string[], gapMs: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      await new Promise((resolve, reject) => {
        setTimeout(resolve, gapMs);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else controller.close();
    },
  });
}

/** A fetch that never answers; it fails with the signal's reason once aborted, as Node's fetch does. */
const unanswered = (init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
  });

describe("inactivity timeout", () => {
  it("never cuts off a reply that keeps streaming, however long it takes", async () => {
    const words = Array.from({ length: 12 }, (_, i) => chunkLine({ content: `w${i} ` }));
    const end = [chunkLine({}, "stop"), "data: [DONE]\n\n"];
    mockFetch((init) => sse(slowBody(init.signal!, [...words, ...end], 5 * MINUTE)));
    const reply = openReply(OLLAMA, REQUEST, never()).then(replyOf);
    await vi.advanceTimersByTimeAsync(80 * MINUTE); // an hour and more, a chunk every 5 minutes
    expect((await reply).text).toBe(words.map((_, i) => `w${i} `).join(""));
    expect(vi.getTimerCount()).toBe(0); // the countdown stopped with the reply
  });

  it("counts Anthropic's pings as signs of life", async () => {
    const chunks = [
      ...Array.from({ length: 4 }, () => eventLine("ping")),
      eventLine("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Done" } }),
      eventLine("message_stop"),
    ];
    mockFetch((init) => sse(slowBody(init.signal!, chunks, 9 * MINUTE)));
    const reply = openReply(ANTHROPIC, REQUEST, never()).then(replyOf);
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(await reply).toEqual({ text: "Done", stop: "end" });
  });

  it("fails a reply once the server has sent nothing for 10 minutes", async () => {
    const calls = mockFetch((init) => sse(hangingBody(init.signal!, [chunkLine({ content: "Hi" })])));
    let settled = false;
    const result = failure(openReply(OLLAMA, REQUEST, never()).then(replyOf)).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(9 * MINUTE);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1 * MINUTE);
    expect(await result).toEqual({
      code: "ai_upstream",
      message: "localhost:11434 went silent partway through its answer.",
    });
    expect(calls[0].init.signal!.aborted).toBe(true);
  });

  it("fails a request that gets no answer: 10 minutes for a reply, 20 seconds for a models list", async () => {
    mockFetch(unanswered);
    const reply = failure(openReply(OLLAMA, REQUEST, never()));
    const models = failure(listModels(OLLAMA, never()));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await models).toEqual({
      code: "ai_unreachable",
      message: "localhost:11434 didn't answer in time.",
    });
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(await reply).toEqual({
      code: "ai_unreachable",
      message: "localhost:11434 didn't answer in time.",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
