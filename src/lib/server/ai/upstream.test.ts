import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels, openReply } from ".";
import {
  chunkLine,
  collect,
  failure,
  hangingBody,
  jsonAnswer,
  mockFetch,
  OLLAMA,
  OPENAI,
  sse,
} from "./test-utils";
import { endpoint } from "./upstream";
import { MAX_UPSTREAM_TEXT } from "./upstream-errors";

afterEach(() => vi.unstubAllGlobals());

const never = () => new AbortController().signal;
const REQUEST = { system: "", messages: [{ role: "user" as const, content: "Hi" }] };
const reply = (target = OPENAI, signal = never()) => openReply(target, REQUEST, signal);

/** Node's fetch fails with TypeError("fetch failed") and the socket error as its cause. */
const fetchFailed = (cause: unknown) => new TypeError("fetch failed", { cause });
const withCode = (code: string, message = code) => Object.assign(new Error(message), { code });

describe("HTTP errors", () => {
  const MODEL_404 = "api.openai.com doesn't know the model “gpt-5-mini”, or the server URL is wrong.";
  it.each([
    [401, { error: { message: "Incorrect API key" } }, OPENAI, "api.openai.com refused the API key."],
    [403, { error: { message: "No access" } }, OPENAI, "api.openai.com refused the API key."],
    [401, {}, OLLAMA, "localhost:11434 asks for an API key. Add one to this connection in Settings."],
    [403, { message: "Blocked" }, OLLAMA, "localhost:11434 answered 403: Blocked"],
    [404, { error: { message: "model not found" } }, OPENAI, MODEL_404],
    [429, {}, OPENAI, "api.openai.com is limiting requests. Wait a moment and try again."],
    [500, {}, OPENAI, "api.openai.com had a problem (500). Try again in a moment."],
    [503, "Service Unavailable", OPENAI, "api.openai.com had a problem (503). Try again in a moment."],
    [529, {}, OPENAI, "api.openai.com had a problem (529). Try again in a moment."],
    [
      400,
      { error: { message: "max_tokens too large", type: "invalid_request_error" } },
      OPENAI,
      "api.openai.com answered 400: max_tokens too large",
    ],
    [
      400,
      { error: "context   window\nexceeded" },
      OPENAI,
      "api.openai.com answered 400: context window exceeded",
    ],
    [422, { detail: "Field required" }, OPENAI, "api.openai.com answered 422: Field required"],
    [400, {}, OPENAI, "api.openai.com answered 400."],
  ])("maps %i %j to a message", async (status, body, target, message) => {
    mockFetch(() => (typeof body === "string" ? new Response(body, { status }) : jsonAnswer(body, status)));
    expect(await failure(reply(target))).toEqual({ code: "ai_upstream", message });
  });

  it("shows plain-text bodies, never HTML pages, cut short and without the key", async () => {
    mockFetch(() => new Response("bad request for key sk-test-secret-1234", { status: 400 }));
    expect((await failure(reply())).message).toBe("api.openai.com answered 400: bad request for key [key]");
    mockFetch(() => new Response("<html><body>Bad gateway page</body></html>", { status: 418 }));
    expect((await failure(reply())).message).toBe("api.openai.com answered 418.");
    mockFetch(() => jsonAnswer({ message: "word ".repeat(200) }, 400));
    const { message } = await failure(reply());
    expect(message.length).toBeLessThanOrEqual("api.openai.com answered 400: ".length + MAX_UPSTREAM_TEXT);
    expect(message.endsWith("…")).toBe(true);
  });

  it("names the models URL on a 404 from the models list", async () => {
    mockFetch(() => new Response("404 page not found", { status: 404 }));
    expect(await failure(listModels(OLLAMA, never()))).toEqual({
      code: "ai_upstream",
      message:
        "No models list at http://localhost:11434/v1/models. Check the server URL (OpenAI-compatible servers usually end in /v1).",
    });
  });
});

describe("network errors", () => {
  const TIMEOUT = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  it.each([
    [
      "ECONNREFUSED",
      fetchFailed(withCode("ECONNREFUSED")),
      "Couldn't reach localhost:11434: nothing answered there. Is the server running?",
    ],
    [
      "ECONNREFUSED on every address",
      fetchFailed(
        Object.assign(new AggregateError([withCode("ECONNREFUSED"), withCode("ECONNREFUSED")]), {
          code: "ECONNREFUSED",
        }),
      ),
      "Couldn't reach localhost:11434: nothing answered there. Is the server running?",
    ],
    ["ENOTFOUND", fetchFailed(withCode("ENOTFOUND")), "Couldn't find localhost:11434. Check the server URL."],
    ["EAI_AGAIN", fetchFailed(withCode("EAI_AGAIN")), "Couldn't find localhost:11434. Check the server URL."],
    ["our deadline", TIMEOUT, "localhost:11434 didn't answer in time."],
    [
      "a connect timeout",
      fetchFailed(withCode("UND_ERR_CONNECT_TIMEOUT")),
      "localhost:11434 didn't answer in time.",
    ],
    [
      "an untrusted certificate",
      fetchFailed(withCode("DEPTH_ZERO_SELF_SIGNED_CERT")),
      "Couldn't reach localhost:11434 securely: its HTTPS certificate isn't trusted.",
    ],
    [
      "HTTPS to an HTTP server",
      fetchFailed(withCode("ERR_SSL_WRONG_VERSION_NUMBER")),
      "localhost:11434 doesn't answer HTTPS here. Try http:// instead.",
    ],
    ["anything else", fetchFailed(withCode("EHOSTUNREACH")), "Couldn't reach localhost:11434."],
  ])("maps %s to ai_unreachable", async (_, error, message) => {
    mockFetch(() => Promise.reject(error));
    expect(await failure(reply(OLLAMA))).toEqual({ code: "ai_unreachable", message });
    expect(await failure(listModels(OLLAMA, never()))).toEqual({ code: "ai_unreachable", message });
  });

  it("blames the key when fetch can't even send it", async () => {
    // What Node's fetch throws for a header value outside Latin-1: a bare TypeError, no network cause.
    const unsendable = new TypeError(
      "Cannot convert argument to a ByteString because the character at index 13 has a value of 8203 which is greater than 255.",
    );
    mockFetch(() => Promise.reject(unsendable));
    expect(await failure(reply())).toEqual({
      code: "ai_upstream",
      message:
        "The API key for api.openai.com has a character that can't be sent, such as a space or an invisible one. Enter the key again in Settings.",
    });
    expect(await failure(listModels(OPENAI, never()))).toMatchObject({ code: "ai_upstream" });
    // Without a key it can't be the key; a failed request with a network cause is never the key.
    expect(await failure(reply(OLLAMA))).toEqual({
      code: "ai_unreachable",
      message: "Couldn't reach localhost:11434.",
    });
    mockFetch(() => Promise.reject(fetchFailed(withCode("EHOSTUNREACH"))));
    expect((await failure(reply())).code).toBe("ai_unreachable");
  });

  it("maps a redirect (never followed) to ai_upstream", async () => {
    mockFetch(() => Promise.reject(fetchFailed(new Error("unexpected redirect"))));
    expect(await failure(reply())).toEqual({
      code: "ai_upstream",
      message:
        "api.openai.com answered with a redirect. Enter the exact server URL (https:// rather than http://, say).",
    });
  });

  it("maps a connection lost or a server gone silent mid-reply to ai_upstream", async () => {
    const lost = fetchFailed(withCode("UND_ERR_SOCKET", "other side closed"));
    mockFetch((init) => sse(hangingBody(init.signal!, [chunkLine({ content: "Hi" })], lost)));
    expect(await failure(collect(await reply()))).toEqual({
      code: "ai_upstream",
      message: "The connection to api.openai.com broke off.",
    });
    const late = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    mockFetch((init) => sse(hangingBody(init.signal!, [chunkLine({ content: "Hi" })], late)));
    expect((await failure(collect(await reply()))).message).toBe(
      "api.openai.com went silent partway through its answer.",
    );
  });
});

describe("endpoint", () => {
  it("joins paths, keeps a query string and refuses URLs it can't fetch", () => {
    expect(String(endpoint("http://h:1/v1//", "/models"))).toBe("http://h:1/v1/models");
    expect(String(endpoint(" https://h/x?api-version=2 ", "/chat/completions"))).toBe(
      "https://h/x/chat/completions?api-version=2",
    );
    expect(String(endpoint("https://api.anthropic.com/v1", "/v1/messages", "/v1"))).toBe(
      "https://api.anthropic.com/v1/messages",
    );
    expect(() => endpoint("localhost:11434", "/models")).toThrow("must start with http:// or https://");
    expect(() => endpoint("not a url", "/models")).toThrow("isn't a valid URL");
  });
});
