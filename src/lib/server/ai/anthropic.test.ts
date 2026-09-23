import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels, openReply } from ".";
import {
  ANTHROPIC,
  bytewise,
  collect,
  eventLine,
  failure,
  jsonAnswer,
  mockFetch,
  replyOf,
  sse,
} from "./test-utils";
import { OVERLOADED } from "./upstream-errors";

afterEach(() => vi.unstubAllGlobals());

const never = () => new AbortController().signal;
const REQUEST = { system: "Be brief.", messages: [{ role: "user" as const, content: "Hi" }] };

const textDelta = (text: string) =>
  eventLine("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
const OPENING =
  eventLine("message_start", { message: { id: "msg_1", role: "assistant", content: [] } }) +
  eventLine("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } }) +
  eventLine("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "Hmm…" } }) +
  eventLine("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "abc" } }) +
  eventLine("content_block_stop", { index: 0 }) +
  eventLine("content_block_start", { index: 1, content_block: { type: "text", text: "" } }) +
  eventLine("ping") +
  textDelta("Hel") +
  textDelta("lo 👋") +
  eventLine("content_block_stop", { index: 1 });
const ending = (stopReason: string) =>
  eventLine("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: {} }) +
  eventLine("message_stop");

describe("openReply (Anthropic)", () => {
  it("streams the text deltas only and sends the Messages API request", async () => {
    const calls = mockFetch(() => sse(OPENING + ending("end_turn")));
    expect(await replyOf(await openReply(ANTHROPIC, REQUEST, never()))).toEqual({
      text: "Hello 👋",
      stop: "end",
    });

    const [call] = calls;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.method).toBe("POST");
    expect(call.init.redirect).toBe("error");
    expect(call.headers.get("x-api-key")).toBe("sk-ant-secret-9876");
    expect(call.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.headers.has("authorization")).toBe(false);
    expect(call.body).toEqual({
      model: "claude-opus-5",
      max_tokens: 64000,
      system: "Be brief.",
      messages: REQUEST.messages,
      stream: true,
    });
  });

  it("accepts a base URL ending in /v1, omits an empty system prompt, and sends no key when none is set", async () => {
    const calls = mockFetch(() => sse(OPENING + ending("end_turn")));
    const target = { ...ANTHROPIC, baseUrl: "https://proxy.example/anthropic/v1/", apiKey: null };
    await collect(await openReply(target, { ...REQUEST, system: "" }, never()));
    expect(calls[0].url).toBe("https://proxy.example/anthropic/v1/messages");
    expect(calls[0].headers.has("x-api-key")).toBe(false);
    expect(calls[0].body).not.toHaveProperty("system");
  });

  it.each([
    ["end_turn", "end"],
    ["stop_sequence", "end"],
    ["max_tokens", "length"],
    ["refusal", "refusal"],
  ])("maps stop_reason %s to %s", async (reason, stop) => {
    mockFetch(() => sse(OPENING + ending(reason)));
    expect((await replyOf(await openReply(ANTHROPIC, REQUEST, never()))).stop).toBe(stop);
  });

  it("reads a stream chunked byte by byte with CRLF line ends", async () => {
    mockFetch(() => sse(bytewise((OPENING + ending("max_tokens")).replaceAll("\n", "\r\n"))));
    expect(await replyOf(await openReply(ANTHROPIC, REQUEST, never()))).toEqual({
      text: "Hello 👋",
      stop: "length",
    });
  });

  it("ends a stream that gave a stop_reason but no message_stop; fails one that gave neither", async () => {
    mockFetch(() => sse(OPENING + eventLine("message_delta", { delta: { stop_reason: "end_turn" } })));
    expect((await replyOf(await openReply(ANTHROPIC, REQUEST, never()))).stop).toBe("end");
    mockFetch(() => sse(OPENING));
    expect(await failure(collect(await openReply(ANTHROPIC, REQUEST, never())))).toEqual({
      code: "ai_upstream",
      message: "api.anthropic.com stopped before the reply was complete.",
    });
  });

  it("throws ai_upstream for an error event mid-reply", async () => {
    const overloaded = eventLine("error", { error: { type: "overloaded_error", message: "Overloaded" } });
    mockFetch(() => sse(OPENING + overloaded));
    expect(await failure(collect(await openReply(ANTHROPIC, REQUEST, never())))).toEqual({
      code: "ai_upstream",
      message: OVERLOADED,
    });
    const other = eventLine("error", { error: { type: "api_error", message: "Internal error" } });
    mockFetch(() => sse(OPENING + other));
    expect((await failure(collect(await openReply(ANTHROPIC, REQUEST, never())))).message).toBe(
      "api.anthropic.com reported an error: Internal error",
    );
  });

  describe("a model with a lower output limit", () => {
    const refusal = (sent: number, limit: number) =>
      jsonAnswer(
        {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: `max_tokens: ${sent} > ${limit}, which is the maximum allowed number of output tokens for claude-opus-4-20250514`,
          },
        },
        400,
      );
    const sentLimits = (calls: { body: unknown }[]) =>
      calls.map((c) => (c.body as { max_tokens: number }).max_tokens);

    it("sends the request again, once, with the limit the refusal names", async () => {
      const calls = mockFetch((init) => {
        const { max_tokens } = JSON.parse(init.body as string) as { max_tokens: number };
        return max_tokens > 32_000 ? refusal(max_tokens, 32_000) : sse(OPENING + ending("end_turn"));
      });
      expect(await replyOf(await openReply(ANTHROPIC, REQUEST, never()))).toEqual({
        text: "Hello 👋",
        stop: "end",
      });
      expect(sentLimits(calls)).toEqual([64_000, 32_000]);
      expect(calls[1].body).toEqual({ ...(calls[0].body as object), max_tokens: 32_000 });
    });

    it("shows a second refusal, and never retries other 400s", async () => {
      const calls = mockFetch((init) => {
        const { max_tokens } = JSON.parse(init.body as string) as { max_tokens: number };
        return refusal(max_tokens, max_tokens / 2);
      });
      expect((await failure(openReply(ANTHROPIC, REQUEST, never()))).message).toMatch(
        /^api\.anthropic\.com answered 400: max_tokens: 32000 > 16000, which/,
      );
      expect(sentLimits(calls)).toEqual([64_000, 32_000]);

      const other = mockFetch(() =>
        jsonAnswer(
          { type: "error", error: { type: "invalid_request_error", message: "messages: empty" } },
          400,
        ),
      );
      expect((await failure(openReply(ANTHROPIC, REQUEST, never()))).message).toBe(
        "api.anthropic.com answered 400: messages: empty",
      );
      expect(other).toHaveLength(1);
    });
  });

  it("maps an overloaded answer (529) and accepts a whole JSON reply", async () => {
    mockFetch(() =>
      jsonAnswer({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529),
    );
    expect(await failure(openReply(ANTHROPIC, REQUEST, never()))).toEqual({
      code: "ai_upstream",
      message: OVERLOADED,
    });
    mockFetch(() =>
      jsonAnswer({
        type: "message",
        content: [
          { type: "thinking", thinking: "…" },
          { type: "text", text: "Who" },
          { type: "text", text: "le" },
        ],
        stop_reason: "refusal",
      }),
    );
    expect(await replyOf(await openReply(ANTHROPIC, REQUEST, never()))).toEqual({
      text: "Whole",
      stop: "refusal",
    });
  });
});

describe("listModels (Anthropic)", () => {
  it("asks for one big page with the Anthropic headers and returns sorted ids", async () => {
    const calls = mockFetch(() =>
      jsonAnswer({
        data: [
          { type: "model", id: "claude-sonnet-5", display_name: "Claude Sonnet 5" },
          { type: "model", id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" },
          { type: "model", id: "claude-opus-5", display_name: "Claude Opus 5" },
        ],
        has_more: false,
      }),
    );
    expect(await listModels(ANTHROPIC, never())).toEqual([
      "claude-haiku-4-5",
      "claude-opus-5",
      "claude-sonnet-5",
    ]);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers.get("x-api-key")).toBe("sk-ant-secret-9876");
    expect(calls[0].headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("names the URL without its query string when there is no list there", async () => {
    mockFetch(() =>
      jsonAnswer({ type: "error", error: { type: "not_found_error", message: "Not found" } }, 404),
    );
    expect(
      await failure(listModels({ ...ANTHROPIC, baseUrl: "https://api.anthropic.com/v1" }, never())),
    ).toEqual({
      code: "ai_upstream",
      message:
        "No models list at https://api.anthropic.com/v1/models. Check the server URL (Anthropic's is https://api.anthropic.com).",
    });
  });
});
