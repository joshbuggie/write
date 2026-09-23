import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels, openReply } from ".";
import {
  bytewise,
  chunkLine,
  collect,
  failure,
  jsonAnswer,
  mockFetch,
  OLLAMA,
  OPENAI,
  replyOf,
  sse,
} from "./test-utils";

afterEach(() => vi.unstubAllGlobals());

const never = () => new AbortController().signal;
const REQUEST = {
  system: "Be brief.",
  messages: [
    { role: "user" as const, content: "Hi" },
    { role: "assistant" as const, content: "Hello" },
    { role: "user" as const, content: "Again" },
  ],
};
const HELLO =
  chunkLine({ role: "assistant", content: "" }) +
  chunkLine({ content: "Hel" }) +
  chunkLine({ content: "lo 👋" });

describe("openReply (OpenAI-compatible)", () => {
  it("streams the text and ends at [DONE]", async () => {
    const calls = mockFetch(() => sse(HELLO + chunkLine({}, "stop") + "data: [DONE]\n\n"));
    const reply = await openReply(OPENAI, REQUEST, never());
    expect(await replyOf(reply)).toEqual({ text: "Hello 👋", stop: "end" });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call.method).toBe("POST");
    expect(call.init.redirect).toBe("error");
    expect(call.headers.get("authorization")).toBe("Bearer sk-test-secret-1234");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.headers.get("accept")).toBe("text/event-stream");
    expect(call.body).toEqual({
      model: "gpt-5-mini",
      messages: [{ role: "system", content: "Be brief." }, ...REQUEST.messages],
      stream: true,
    });
  });

  it("sends no Authorization without a key, and no system message when it is empty", async () => {
    const calls = mockFetch(() => sse(HELLO + "data: [DONE]\n\n"));
    const target = { ...OLLAMA, baseUrl: "http://localhost:11434/v1/" };
    await collect(await openReply(target, { system: "  ", messages: REQUEST.messages }, never()));
    expect(calls[0].url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0].headers.has("authorization")).toBe(false);
    expect(calls[0].body).toEqual({ model: "llama3.1:8b", messages: REQUEST.messages, stream: true });
  });

  it.each([
    ["stop", "end"],
    ["length", "length"],
    ["content_filter", "refusal"],
    ["tool_calls", "end"],
  ])("maps finish_reason %s to %s", async (reason, stop) => {
    mockFetch(() => sse(HELLO + chunkLine({}, reason) + "data: [DONE]\n\n"));
    expect((await replyOf(await openReply(OLLAMA, REQUEST, never()))).stop).toBe(stop);
  });

  it("ends a stream that gives a finish_reason but no [DONE], and one with [DONE] but no reason", async () => {
    mockFetch(() => sse(HELLO + chunkLine({}, "length")));
    expect(await replyOf(await openReply(OLLAMA, REQUEST, never()))).toEqual({
      text: "Hello 👋",
      stop: "length",
    });
    mockFetch(() => sse(HELLO + "data: [DONE]"));
    expect(await replyOf(await openReply(OLLAMA, REQUEST, never()))).toEqual({
      text: "Hello 👋",
      stop: "end",
    });
  });

  it("reads a stream chunked byte by byte, with CRLF, comments and fields it ignores", async () => {
    const text = [
      ": OPENROUTER PROCESSING\r\n\r\n",
      chunkLine({ reasoning_content: "thinking…", content: null }),
      chunkLine({ content: "Grüße, " }),
      'data: {"choices":[],"usage":{"total_tokens":9}}\r\n\r\n',
      chunkLine({ content: "日本" }, "stop"),
      "data: [DONE]\r\n\r\n",
    ].join("");
    mockFetch(() => sse(bytewise(text)));
    expect(await replyOf(await openReply(OLLAMA, REQUEST, never()))).toEqual({
      text: "Grüße, 日本",
      stop: "end",
    });
  });

  it("throws ai_upstream for an error line mid-reply, with the key blanked out", async () => {
    const error = { error: { message: "Bad key sk-test-secret-1234 at step 2", type: "server_error" } };
    mockFetch(() => sse(HELLO + `data: ${JSON.stringify(error)}\n\n`));
    const reply = await openReply(OPENAI, REQUEST, never());
    expect(await reply.next()).toEqual({ done: false, value: { text: "Hel" } });
    expect(await failure(collect(reply))).toEqual({
      code: "ai_upstream",
      message: "api.openai.com reported an error: Bad key [key] at step 2",
    });
  });

  it("throws ai_upstream when the stream stops before the end, or isn't JSON", async () => {
    mockFetch(() => sse(HELLO));
    expect(await failure(collect(await openReply(OLLAMA, REQUEST, never())))).toEqual({
      code: "ai_upstream",
      message: "localhost:11434 stopped before the reply was complete.",
    });
    mockFetch(() => sse("data: hello\n\n"));
    expect((await failure(collect(await openReply(OLLAMA, REQUEST, never())))).message).toBe(
      "localhost:11434 sent something that isn't a model reply. Check the server URL and provider.",
    );
  });

  it("accepts a whole JSON reply from a server that doesn't stream", async () => {
    mockFetch(() =>
      jsonAnswer({
        choices: [{ message: { role: "assistant", content: "Whole" }, finish_reason: "length" }],
      }),
    );
    expect(await replyOf(await openReply(OLLAMA, REQUEST, never()))).toEqual({
      text: "Whole",
      stop: "length",
    });
  });

  it("fails before streaming for a 2xx error body or a web page", async () => {
    mockFetch(() => jsonAnswer({ error: "model is loading" }));
    expect(await failure(openReply(OLLAMA, REQUEST, never()))).toEqual({
      code: "ai_upstream",
      message: "localhost:11434 reported an error: model is loading",
    });
    mockFetch(
      () => new Response("<!doctype html><p>My NAS</p>", { headers: { "Content-Type": "text/html" } }),
    );
    expect((await failure(openReply(OLLAMA, REQUEST, never()))).message).toBe(
      "localhost:11434 answered with a web page instead of a model reply. Check the server URL.",
    );
  });
});

describe("listModels (OpenAI-compatible)", () => {
  it("reads data[].id, unique and sorted, with the key when set", async () => {
    const calls = mockFetch(() =>
      jsonAnswer({
        object: "list",
        data: [{ id: "gpt-10" }, { id: "gpt-4" }, { id: "b" }, { id: "gpt-4" }, {}],
      }),
    );
    expect(await listModels(OPENAI, never())).toEqual(["b", "gpt-4", "gpt-10"]);
    expect(calls[0].url).toBe("https://api.openai.com/v1/models");
    expect(calls[0].method).toBe("GET");
    expect(calls[0].init.redirect).toBe("error");
    expect(calls[0].headers.get("authorization")).toBe("Bearer sk-test-secret-1234");
  });

  it("reads models[].name and models[].id, and sends no key when none is set", async () => {
    const calls = mockFetch(() =>
      jsonAnswer({
        models: [{ name: "qwen2.5:7b" }, { id: "llama3.1:8b" }, "mistral", { name: "x".repeat(501) }],
      }),
    );
    expect(await listModels(OLLAMA, never())).toEqual(["llama3.1:8b", "mistral", "qwen2.5:7b"]);
    expect(calls[0].headers.has("authorization")).toBe(false);
  });

  it("gives an empty list for a JSON answer without one, and fails for one that isn't JSON", async () => {
    mockFetch(() => jsonAnswer({ object: "list" }));
    expect(await listModels(OLLAMA, never())).toEqual([]);
    mockFetch(() => new Response("hello"));
    expect(await failure(listModels(OLLAMA, never()))).toEqual({
      code: "ai_upstream",
      message: "http://localhost:11434/v1/models didn't answer with a models list. Check the server URL.",
    });
  });
});
