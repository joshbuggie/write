import { vi } from "vitest";
import type { StopReason } from "@/lib/api-contract";
import { HttpError } from "../http";
import type { ConnectionTarget, ReplyEvent } from "./types";

/**
 * Helpers for the model adapter tests: a fake `fetch` that records what was sent, bodies that arrive in
 * chosen chunks (to put chunk boundaries inside lines and characters), and ways to drain a reply.
 */

const encoder = new TextEncoder();

/** A local server without a key, the most common setup. */
export const OLLAMA: ConnectionTarget = {
  provider: "ollama",
  baseUrl: "http://localhost:11434/v1",
  apiKey: null,
  model: "llama3.1:8b",
};

/** A hosted OpenAI-compatible API with a key. */
export const OPENAI: ConnectionTarget = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test-secret-1234",
  model: "gpt-5-mini",
};

/** The Anthropic API with a key. */
export const ANTHROPIC: ConnectionTarget = {
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  apiKey: "sk-ant-secret-9876",
  model: "claude-opus-5",
};

/** A body that delivers exactly these chunks; strings are UTF-8 encoded first. */
export function chunked(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === "string" ? encoder.encode(c) : c);
      controller.close();
    },
  });
}

/** Every byte of `text` as its own chunk: boundaries inside every line ending and every character. */
export function bytewise(text: string): ReadableStream<Uint8Array> {
  return chunked([...encoder.encode(text)].map((b) => Uint8Array.of(b)));
}

/**
 * A body that sends `chunks`, then waits until `signal` aborts and fails with its reason, as Node's fetch
 * body does; `fail` makes it fail with that error instead of waiting.
 */
export function hangingBody(
  signal: AbortSignal,
  chunks: string[],
  fail?: unknown,
): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) return controller.enqueue(encoder.encode(chunks[i++]));
      if (fail !== undefined) return Promise.reject(fail);
      return new Promise<void>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
}

/** A 2xx event stream answer. */
export function sse(body: ReadableStream<Uint8Array> | string, contentType = "text/event-stream"): Response {
  const stream = typeof body === "string" ? chunked([body]) : body;
  return new Response(stream, { headers: { "Content-Type": contentType } });
}

/** A JSON answer with any status. */
export function jsonAnswer(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** An OpenAI-style `data:` line holding one chunk. */
export function chunkLine(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
}

/** An Anthropic-style event. */
export function eventLine(type: string, data: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

/** One request the fake fetch received, with its JSON body parsed and headers normalized. */
export type FetchCall = { url: string; method: string; headers: Headers; body: unknown; init: RequestInit };

/** Replaces global fetch; returns the calls it receives, in order. Undo with vi.unstubAllGlobals(). */
export function mockFetch(
  answer: (init: RequestInit, url: string) => Response | Promise<Response>,
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method: init.method ?? "GET", headers: new Headers(init.headers), body, init });
    return answer(init, url);
  });
  return calls;
}

/** Every event of a reply. */
export async function collect(reply: AsyncGenerator<ReplyEvent>): Promise<ReplyEvent[]> {
  const events: ReplyEvent[] = [];
  for await (const event of reply) events.push(event);
  return events;
}

/** A reply's text and how it ended; also checks that the stop came exactly once, last. */
export async function replyOf(
  reply: AsyncGenerator<ReplyEvent>,
): Promise<{ text: string; stop: StopReason }> {
  const events = await collect(reply);
  const stops = events.filter((e) => "stop" in e);
  const last = events.at(-1);
  if (stops.length !== 1 || !last || !("stop" in last)) throw new Error("expected exactly one final stop");
  const text = events.map((e) => ("text" in e ? e.text : "")).join("");
  return { text, stop: last.stop };
}

/** The HttpError a promise rejects with, as { code, message }. */
export async function failure(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpError) return { code: err.code, message: err.message };
    throw err;
  }
  throw new Error("expected an HttpError");
}
