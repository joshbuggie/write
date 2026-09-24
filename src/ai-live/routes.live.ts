import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as complete from "@/app/api/ai/complete/route";
import * as models from "@/app/api/ai/models/route";
import * as settings from "@/app/api/settings/route";
import { DEFAULT_AI_SETTINGS } from "@/lib/ai/settings";
import type {
  ApiErrorBody,
  CompleteEvent,
  CompleteRequest,
  SettingsResponse,
  TestConnectionResponse,
} from "@/lib/api-contract";
import { resetPasswordGuard } from "@/lib/server/auth";
import { withTempDataDir } from "@/lib/server/storage/test-utils";
import { connectionOf, describeEach, leaks, type LiveProvider } from "./providers";

/**
 * The routes the browser calls (docs/design-decisions.md#d29), with real storage in a temp config folder
 * and real model servers: saving a key, "Test connection", and a streamed reply as the prompt window
 * reads it. Every answer is checked for the key, which must never travel back.
 */

type Handler = (req: Request, ctx: unknown) => Promise<Response>;

async function call(handler: Handler, method: string, url: string, body?: unknown, signal?: AbortSignal) {
  const headers = body === undefined ? undefined : { "content-type": "application/json" };
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal };
  return handler(new Request(`http://localhost${url}`, init), { params: Promise.resolve({}) });
}

const lines = (text: string) =>
  text
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l) as CompleteEvent);

const request = (p: LiveProvider, content: string): CompleteRequest => ({
  connectionId: connectionOf(p).id,
  system: DEFAULT_AI_SETTINGS.instructions,
  messages: [{ role: "user", content }],
});

/** Saves the provider as the only connection, switched on or off, and returns the settings text. */
async function saveConnection(p: LiveProvider, enabled = true): Promise<string> {
  const connection = connectionOf(p);
  const ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled,
    connections: [connection],
    defaultConnectionId: connection.id,
  };
  const res = await call(settings.PUT, "PUT", "/api/settings", { ai });
  expect(res.status).toBe(200);
  return res.text();
}

beforeEach(() => vi.stubEnv("WRITE_AUTH", "off"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetPasswordGuard();
});

describeEach("routes", (p: LiveProvider) => {
  it("saves the key and only ever answers its hint", () =>
    withTempDataDir(async () => {
      const text = await saveConnection(p);
      expect(leaks(p, text)).toBe(false);
      const [saved] = (JSON.parse(text) as SettingsResponse).ai.connections;
      expect(saved.keyHint).toBe(p.apiKey!.slice(-4));
      const got = await (await call(settings.GET, "GET", "/api/settings")).text();
      expect(leaks(p, got)).toBe(false);
    }));

  it("Test connection uses the saved key and lists the model", () =>
    withTempDataDir(async () => {
      await saveConnection(p, false); // works before the switch is saved
      const withoutKey = { ...connectionOf(p), apiKey: undefined }; // as the form sends a saved key
      const res = await call(models.POST, "POST", "/api/ai/models", { connection: withoutKey });
      const text = await res.text();
      expect(res.status, text).toBe(200);
      expect(leaks(p, text)).toBe(false);
      expect((JSON.parse(text) as TestConnectionResponse).models).toContain(p.model);
    }));

  it("refuses to send while switched off", () =>
    withTempDataDir(async () => {
      await saveConnection(p, false);
      const res = await call(complete.POST, "POST", "/api/ai/complete", request(p, "Say hi."));
      expect(res.status).toBe(409);
      expect(((await res.json()) as ApiErrorBody).error.code).toBe("ai_disabled");
    }));

  it("streams a reply as NDJSON: text lines, then done", ({ annotate }) =>
    withTempDataDir(async () => {
      await saveConnection(p);
      const body = request(
        p,
        '<note title="Groceries" part="selection">\nmilk, eggs\n</note>\n\nTranslate to Spanish.',
      );
      const res = await call(complete.POST, "POST", "/api/ai/complete", body);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
      const text = await res.text();
      expect(leaks(p, text)).toBe(false);
      const events = lines(text);
      const reply = events.map((e) => ("text" in e ? e.text : "")).join("");
      await annotate(JSON.stringify(reply));
      expect(events.at(-1)).toEqual({ done: true, stop: "end" });
      expect(reply.toLowerCase()).toMatch(/leche/);
      expect(reply.toLowerCase()).toMatch(/huevos/);
    }));

  it("answers a refused key as a 502 that names the host, not the key", () =>
    withTempDataDir(async () => {
      const wrong = { ...connectionOf(p), apiKey: `${p.apiKey}x` };
      const res = await call(models.POST, "POST", "/api/ai/models", { connection: wrong });
      const text = await res.text();
      expect(res.status).toBe(502);
      expect(text).not.toContain(wrong.apiKey);
      expect((JSON.parse(text) as ApiErrorBody).error.message).toContain(new URL(p.baseUrl).host);
    }));

  it("ends the stream when the browser cancels it mid-reply", () =>
    withTempDataDir(async () => {
      await saveConnection(p);
      const upstream = vi.spyOn(globalThis, "fetch"); // calls through; records the upstream signal
      const browser = new AbortController();
      const body = request(p, "Write the numbers 1 to 2000, one per line.");
      const res = await call(complete.POST, "POST", "/api/ai/complete", body, browser.signal);
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      expect((await reader.read()).done).toBe(false);
      await reader.cancel(); // what fetch does when the page aborts
      browser.abort();
      const upstreamSignal = upstream.mock.calls.at(-1)?.[1]?.signal;
      expect(upstreamSignal?.aborted).toBe(true); // the model stops generating, and billing
    }));
});
