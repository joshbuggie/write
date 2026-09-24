import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_LIMITS, type AiSettings, DEFAULT_AI_SETTINGS } from "@/lib/ai/settings";
import type {
  ApiErrorBody,
  CompleteEvent,
  CompleteRequest,
  ConnectionInput,
  SaveSettingsRequest,
  SettingsResponse,
  TestConnectionResponse,
} from "@/lib/api-contract";
import { chunkLine, eventLine, hangingBody, jsonAnswer, mockFetch, sse } from "@/lib/server/ai/test-utils";
import { resetPasswordGuard } from "@/lib/server/auth";
import { withTempDataDir } from "@/lib/server/storage/test-utils";
import * as complete from "./ai/complete/route";
import * as models from "./ai/models/route";
import * as settings from "./settings/route";

/**
 * The AI assistant's routes (docs/design-decisions.md#d29) with real storage and a fake model server:
 * global fetch is replaced, so every request a route makes upstream is recorded and nothing leaves.
 */

type Handler = (req: Request, ctx: unknown) => Promise<Response>;
type Init = { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal };

async function call(handler: Handler, method: string, url: string, init: Init = {}): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.body !== undefined) headers["content-type"] ??= "application/json";
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  const req = new Request(`http://localhost${url}`, { method, body, headers, signal: init.signal });
  const res = await handler(req, { params: Promise.resolve({}) });
  expect(res.headers.get("cache-control")).toBe("no-store");
  return res;
}

const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error;

const KEY = "sk-saved-secret-7a3f";
const GPT: ConnectionInput = {
  id: "gpt",
  name: "GPT",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
};
const CLAUDE: ConnectionInput = {
  id: "claude",
  name: "",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  model: "claude-opus-5",
};

/** Settings as the dialog sends them: switched on, the first connection as default. */
const aiWith = (connections: ConnectionInput[], extra: Partial<SaveSettingsRequest["ai"]> = {}) => ({
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  connections,
  defaultConnectionId: connections[0]?.id ?? null,
  ...extra,
});

const putSettings = (ai: unknown) => call(settings.PUT, "PUT", "/api/settings", { body: { ai } });
async function save(ai: SaveSettingsRequest["ai"]): Promise<AiSettings> {
  const res = await putSettings(ai);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).not.toContain("secret"); // every test key contains it; only hints may come back
  return (JSON.parse(text) as SettingsResponse).ai;
}
const hints = (ai: AiSettings) => ai.connections.map((c) => c.keyHint);

const testConnection = (connection: ConnectionInput, signal?: AbortSignal) =>
  call(models.POST, "POST", "/api/ai/models", { body: { connection }, signal });

const REQUEST: CompleteRequest = {
  connectionId: "gpt",
  system: "Be brief.",
  messages: [{ role: "user", content: "<note>Hi there</note>\n\nMake it shorter." }],
};
const ask = (body: unknown = REQUEST, signal?: AbortSignal) =>
  call(complete.POST, "POST", "/api/ai/complete", { body, signal });

/** Every NDJSON line of a streamed reply. */
async function linesOf(res: Response): Promise<CompleteEvent[]> {
  const text = await res.text();
  expect(text === "" || text.endsWith("\n")).toBe(true);
  return text === ""
    ? []
    : text
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l) as CompleteEvent);
}

/** The next NDJSON line; the route sends one line per chunk. */
async function nextLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<CompleteEvent | null> {
  const { done, value } = await reader.read();
  return done ? null : (JSON.parse(new TextDecoder().decode(value)) as CompleteEvent);
}

/** A fake model server that never answers, like a slow one, until the request is aborted. */
const never = (init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  });

const refused = () =>
  Promise.reject(
    new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) }),
  );

// Auth off unless a test turns it on, even if the developer shell exports WRITE_PASSWORD.
beforeEach(() => vi.stubEnv("WRITE_PASSWORD", ""));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetPasswordGuard();
});

describe("/api/settings", () => {
  it("GET answers the defaults before anything is saved", () =>
    withTempDataDir(async () => {
      const res = await call(settings.GET, "GET", "/api/settings");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ai: DEFAULT_AI_SETTINGS });
    }));

  it("PUT saves and answers the view: a key hint, never the key", () =>
    withTempDataDir(async () => {
      const saved = await save(aiWith([{ ...GPT, name: " GPT ", apiKey: KEY }, CLAUDE]));
      expect(saved.connections[0]).toEqual({ ...GPT, keyHint: "7a3f" });
      expect(saved.connections[1]).toEqual({ ...CLAUDE, keyHint: null });
      expect(saved).toMatchObject({ enabled: true, defaultConnectionId: "gpt" });

      const res = await call(settings.GET, "GET", "/api/settings");
      const text = await res.text();
      expect(text).not.toContain(KEY);
      expect((JSON.parse(text) as SettingsResponse).ai).toEqual(saved);
    }));

  it("keeps a saved key while the URL stays on its origin; drops it otherwise, or when cleared", () =>
    withTempDataDir(async () => {
      expect(hints(await save(aiWith([{ ...GPT, apiKey: KEY }])))).toEqual(["7a3f"]);
      expect(hints(await save(aiWith([GPT])))).toEqual(["7a3f"]);
      const samePlace = { ...GPT, baseUrl: "https://api.openai.com/v2/" };
      expect(hints(await save(aiWith([samePlace])))).toEqual(["7a3f"]);
      const elsewhere = { ...GPT, baseUrl: "https://proxy.example.com/v1" };
      expect(hints(await save(aiWith([elsewhere])))).toEqual([null]);
      expect(hints(await save(aiWith([GPT])))).toEqual([null]); // gone for good, not just hidden

      expect(hints(await save(aiWith([{ ...GPT, apiKey: "  sk-new-secret-9999 " }])))).toEqual(["9999"]);
      expect(hints(await save(aiWith([{ ...GPT, clearKey: true }])))).toEqual([null]);
    }));

  it("PUT refuses invalid settings with 400 and saves nothing", () =>
    withTempDataDir(async () => {
      const invalid: unknown[] = [
        aiWith([{ ...GPT, provider: "gemini" as ConnectionInput["provider"] }]),
        aiWith([{ ...GPT, baseUrl: "file:///etc/passwd" }]),
        aiWith([{ ...GPT, baseUrl: "https://me:pw@api.openai.com/v1" }]),
        aiWith([GPT], { defaultConnectionId: "nope" }),
        aiWith([GPT, { ...CLAUDE, id: "gpt" }]),
        aiWith([{ ...GPT, name: "x".repeat(AI_LIMITS.field + 1) }]),
        aiWith([GPT], { instructions: "x".repeat(AI_LIMITS.instructions + 1) }),
        aiWith(Array.from({ length: AI_LIMITS.connections + 1 }, (_, i) => ({ ...GPT, id: `c${i}` }))),
        { ...aiWith([GPT]), enabled: "yes" },
      ];
      for (const ai of invalid) {
        const res = await putSettings(ai);
        expect(res.status).toBe(400);
        expect((await errorOf(res)).code).toBe("bad_request");
      }
      const res = await call(settings.GET, "GET", "/api/settings");
      expect(await res.json()).toEqual({ ai: DEFAULT_AI_SETTINGS });
    }));
});

describe("POST /api/ai/models", () => {
  it("sends the saved key only to its own origin, a typed key otherwise; works while switched off", () =>
    withTempDataDir(async () => {
      await save(aiWith([{ ...GPT, apiKey: KEY }], { enabled: false }));
      const calls = mockFetch(() =>
        jsonAnswer({ data: [{ id: "gpt-5" }, { id: "gpt-4.1" }, { id: "gpt-5" }] }),
      );
      const auth = (i: number) => calls[i].headers.get("authorization");

      const res = await testConnection(GPT);
      expect(res.status).toBe(200);
      expect((await res.json()) as TestConnectionResponse).toEqual({ models: ["gpt-4.1", "gpt-5"] });
      expect(calls[0].url).toBe("https://api.openai.com/v1/models");
      expect(auth(0)).toBe(`Bearer ${KEY}`);

      const elsewhere = { ...GPT, baseUrl: "https://proxy.example.com/v1" };
      expect((await testConnection(elsewhere)).status).toBe(200);
      expect(calls[1].url).toBe("https://proxy.example.com/v1/models");
      expect(auth(1)).toBeNull();

      await testConnection({ ...elsewhere, apiKey: "sk-typed-1111" });
      expect(auth(2)).toBe("Bearer sk-typed-1111");
      await testConnection({ ...GPT, clearKey: true });
      expect(auth(3)).toBeNull();
      await testConnection({ ...GPT, id: "unsaved" });
      expect(auth(4)).toBeNull();
    }));

  it("400 without a server URL; upstream failures are 502", () =>
    withTempDataDir(async () => {
      const calls = mockFetch(() => jsonAnswer({ error: { message: "Incorrect API key" } }, 401));
      const blank = await testConnection({ ...GPT, baseUrl: "  " });
      expect(blank.status).toBe(400);
      expect(await errorOf(blank)).toEqual({ code: "bad_request", message: "Enter the server URL first." });
      expect(calls).toHaveLength(0);

      const rejected = await testConnection({ ...GPT, apiKey: "sk-typed-1111" });
      expect(rejected.status).toBe(502);
      expect(await errorOf(rejected)).toEqual({
        code: "ai_upstream",
        message: "api.openai.com refused the API key.",
      });

      mockFetch(refused);
      const down = await testConnection({ ...GPT, provider: "ollama", baseUrl: "http://localhost:11434/v1" });
      expect(down.status).toBe(502);
      expect((await errorOf(down)).code).toBe("ai_unreachable");
    }));

  it("answers 499 without logging when the browser gives up", () =>
    withTempDataDir(async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const calls = mockFetch(never);
      const browser = new AbortController();
      const pending = testConnection(GPT, browser.signal);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      browser.abort();
      expect((await pending).status).toBe(499);
      expect(logged).not.toHaveBeenCalled();
    }));
});

describe("POST /api/ai/complete", () => {
  it("409 ai_disabled while the assistant is off, and nothing is sent", () =>
    withTempDataDir(async () => {
      const calls = mockFetch(() => jsonAnswer({}));
      await save(aiWith([{ ...GPT, apiKey: KEY }], { enabled: false }));
      const res = await ask();
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toEqual({
        code: "ai_disabled",
        message: "The AI assistant is switched off in Settings.",
      });
      expect(calls).toHaveLength(0);
    }));

  it("400 for a connection that is gone or incomplete, and for a malformed conversation", () =>
    withTempDataDir(async () => {
      const calls = mockFetch(() => jsonAnswer({}));
      await save(aiWith([GPT, { ...CLAUDE, model: " " }]));
      const gone = await ask({ ...REQUEST, connectionId: "deleted" });
      expect(gone.status).toBe(400);
      expect((await errorOf(gone)).message).toBe("That connection isn't saved anymore. Pick another one.");
      const incomplete = await ask({ ...REQUEST, connectionId: "claude" });
      expect(incomplete.status).toBe(400);
      expect((await errorOf(incomplete)).message).toBe("That connection has no server URL or model yet.");
      const endsWithReply = {
        ...REQUEST,
        messages: [...REQUEST.messages, { role: "assistant", content: "x" }],
      };
      expect((await ask(endsWithReply)).status).toBe(400);
      expect(calls).toHaveLength(0);
    }));

  it("streams an OpenAI-compatible reply as NDJSON", () =>
    withTempDataDir(async () => {
      await save(aiWith([{ ...GPT, apiKey: KEY }]));
      const calls = mockFetch(() =>
        sse(
          chunkLine({ role: "assistant", content: "" }) +
            chunkLine({ content: "Hel" }) +
            chunkLine({ content: "lo 👋" }) +
            chunkLine({}, "stop") +
            "data: [DONE]\n\n",
        ),
      );
      const res = await ask();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
      expect(res.headers.get("x-accel-buffering")).toBe("no");
      expect(await linesOf(res)).toEqual([{ text: "Hel" }, { text: "lo 👋" }, { done: true, stop: "end" }]);

      expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
      expect(calls[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
      expect(calls[0].body).toEqual({
        model: "gpt-5-mini",
        messages: [{ role: "system", content: "Be brief." }, ...REQUEST.messages],
        stream: true,
      });
    }));

  it("streams an Anthropic reply as NDJSON", () =>
    withTempDataDir(async () => {
      await save(aiWith([{ ...CLAUDE, apiKey: "sk-ant-secret-5555" }]));
      const calls = mockFetch(() =>
        sse(
          eventLine("message_start", { message: { id: "msg_1" } }) +
            eventLine("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Bonjour" } }) +
            eventLine("message_delta", { delta: { stop_reason: "max_tokens" } }) +
            eventLine("message_stop"),
        ),
      );
      const res = await ask({ ...REQUEST, connectionId: "claude" });
      expect(res.status).toBe(200);
      expect(await linesOf(res)).toEqual([{ text: "Bonjour" }, { done: true, stop: "length" }]);

      expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
      expect(calls[0].headers.get("x-api-key")).toBe("sk-ant-secret-5555");
      expect(calls[0].headers.get("anthropic-version")).toBe("2023-06-01");
      expect(calls[0].headers.get("authorization")).toBeNull();
      expect(calls[0].body).toMatchObject({ model: "claude-opus-5", system: "Be brief.", stream: true });
    }));

  it("a failure before the reply starts is a plain JSON error", () =>
    withTempDataDir(async () => {
      await save(aiWith([GPT]));
      mockFetch(() => jsonAnswer({ error: { message: "model not found" } }, 404));
      const unknownModel = await ask();
      expect(unknownModel.status).toBe(502);
      expect(unknownModel.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await errorOf(unknownModel)).toEqual({
        code: "ai_upstream",
        message: "api.openai.com doesn't know the model “gpt-5-mini”, or the server URL is wrong.",
      });

      mockFetch(refused);
      const down = await ask();
      expect(down.status).toBe(502);
      expect((await errorOf(down)).code).toBe("ai_unreachable");
    }));

  it("a failure mid-reply is the last line", () =>
    withTempDataDir(async () => {
      await save(aiWith([GPT]));
      mockFetch(() =>
        sse(chunkLine({ content: "Half" }) + `data: {"error":{"message":"GPU fell over"}}\n\n`),
      );
      const res = await ask();
      expect(res.status).toBe(200);
      expect(await linesOf(res)).toEqual([
        { text: "Half" },
        { error: { code: "ai_upstream", message: "api.openai.com reported an error: GPU fell over" } },
      ]);
    }));

  it("cancelling the stream ends the upstream request", () =>
    withTempDataDir(async () => {
      await save(aiWith([GPT]));
      const calls = mockFetch((init) => sse(hangingBody(init.signal!, [chunkLine({ content: "Once" })])));
      const reader = (await ask()).body!.getReader();
      expect(await nextLine(reader)).toEqual({ text: "Once" });
      expect(calls[0].init.signal!.aborted).toBe(false);
      await reader.cancel();
      expect(calls[0].init.signal!.aborted).toBe(true);
    }));

  it("a closed request ends the upstream request and the stream, without an error line", () =>
    withTempDataDir(async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      await save(aiWith([GPT]));
      const calls = mockFetch((init) => sse(hangingBody(init.signal!, [chunkLine({ content: "Once" })])));
      const browser = new AbortController();
      const reader = (await ask(REQUEST, browser.signal)).body!.getReader();
      expect(await nextLine(reader)).toEqual({ text: "Once" });
      browser.abort();
      expect(await nextLine(reader)).toBeNull();
      expect(calls[0].init.signal!.aborted).toBe(true);
      expect(logged).not.toHaveBeenCalled();
    }));

  it("answers 499 without logging when Stop comes before the model answers", () =>
    withTempDataDir(async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      await save(aiWith([GPT]));
      const calls = mockFetch(never);
      const browser = new AbortController();
      const pending = ask(REQUEST, browser.signal);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      browser.abort();
      expect((await pending).status).toBe(499);
      expect(calls[0].init.signal!.aborted).toBe(true);
      expect(logged).not.toHaveBeenCalled();
    }));
});

describe("auth and CSRF", () => {
  it("401 without a session when a password is set", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_PASSWORD", "pw");
      const calls = mockFetch(() => jsonAnswer({ data: [] }));
      const responses = [
        await call(settings.GET, "GET", "/api/settings"),
        await putSettings(aiWith([GPT])),
        await testConnection(GPT),
        await ask(),
      ];
      for (const res of responses) {
        expect(res.status).toBe(401);
        expect((await errorOf(res)).code).toBe("unauthorized");
      }
      expect(calls).toHaveLength(0);
      const signedIn = await call(settings.GET, "GET", "/api/settings", {
        headers: { authorization: "Bearer pw" },
      });
      expect(signedIn.status).toBe(200);
    }));

  it("403 for cross-site requests, 415 for bodies that aren't JSON", () =>
    withTempDataDir(async () => {
      const calls = mockFetch(() => jsonAnswer({ data: [] }));
      await save(aiWith([GPT]));
      const crossSite = { "sec-fetch-site": "cross-site" };
      const responses = [
        await call(settings.PUT, "PUT", "/api/settings", { body: { ai: aiWith([]) }, headers: crossSite }),
        await call(models.POST, "POST", "/api/ai/models", { body: { connection: GPT }, headers: crossSite }),
        await call(complete.POST, "POST", "/api/ai/complete", { body: REQUEST, headers: crossSite }),
      ];
      for (const res of responses) {
        expect(res.status).toBe(403);
        expect((await errorOf(res)).code).toBe("forbidden");
      }
      const plain = await call(complete.POST, "POST", "/api/ai/complete", {
        body: REQUEST,
        headers: { "content-type": "text/plain" },
      });
      expect(plain.status).toBe(415);
      expect(calls).toHaveLength(0);
      const kept = (await (await call(settings.GET, "GET", "/api/settings")).json()) as SettingsResponse;
      expect(kept.ai.connections.map((c) => c.id)).toEqual(["gpt"]);
    }));
});
