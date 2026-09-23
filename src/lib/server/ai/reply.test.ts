import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels, MAX_REPLY_CHARS, openReply } from ".";
import { chunkLine, collect, hangingBody, mockFetch, OLLAMA, OPENAI, sse } from "./test-utils";

afterEach(() => vi.unstubAllGlobals());

const never = () => new AbortController().signal;
const REQUEST = { system: "", messages: [{ role: "user" as const, content: "Hi" }] };
const reply = (target = OPENAI, signal = never()) => openReply(target, REQUEST, signal);
/** A fetch that never answers; it fails with the signal's reason once aborted, as Node's fetch does. */
const unanswered = (init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    const signal = init.signal!;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason));
  });

describe("aborting", () => {
  it("rethrows the caller's abort unchanged before the answer", async () => {
    const calls = mockFetch(unanswered);
    const ctrl = new AbortController();
    const pending = reply(OPENAI, ctrl.signal);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    ctrl.abort();
    await expect(pending).rejects.toBe(ctrl.signal.reason);
    await expect(listModels(OLLAMA, ctrl.signal)).rejects.toBe(ctrl.signal.reason); // already aborted
  });

  it("rethrows the caller's abort unchanged mid-reply and ends the upstream request", async () => {
    const calls = mockFetch((init) => sse(hangingBody(init.signal!, [chunkLine({ content: "Hi" })])));
    const ctrl = new AbortController();
    const events = await reply(OPENAI, ctrl.signal);
    expect(await events.next()).toEqual({ done: false, value: { text: "Hi" } });
    const next = events.next();
    ctrl.abort();
    await expect(next).rejects.toBe(ctrl.signal.reason);
    expect(calls[0].init.signal!.aborted).toBe(true);
  });

  it("ends the upstream request when the reader stops early", async () => {
    const calls = mockFetch((init) => sse(hangingBody(init.signal!, [chunkLine({ content: "Hi" })])));
    const events = await reply();
    await events.next();
    await events.return(undefined);
    expect(calls[0].init.signal!.aborted).toBe(true);
  });
});

describe("reply cap", () => {
  /** An endless stream of chunks holding `piece`. */
  const endless = (piece: string) =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(chunkLine({ content: piece })));
      },
    });

  it("cuts a runaway reply at MAX_REPLY_CHARS with stop length, and ends the upstream request", async () => {
    const calls = mockFetch(() => sse(endless("x".repeat(10_000))));
    const events = await collect(await reply());
    const text = events.map((e) => ("text" in e ? e.text : "")).join("");
    expect(text).toHaveLength(MAX_REPLY_CHARS);
    expect(events.at(-1)).toEqual({ stop: "length" });
    expect(calls[0].init.signal!.aborted).toBe(true);
  });

  it("never cuts a character in half", async () => {
    mockFetch(() => sse(endless("a" + "👋".repeat(4_999))));
    const events = await collect(await reply());
    const text = events.map((e) => ("text" in e ? e.text : "")).join("");
    expect(text).toHaveLength(MAX_REPLY_CHARS - 1);
    expect(text.isWellFormed()).toBe(true);
  });
});
