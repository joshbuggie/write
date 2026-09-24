import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "@/lib/api-contract";
import { MAX_NOTE_BYTES } from "@/lib/constants";
import type { Note } from "@/lib/types";
import { sessionCookieFor, setUpTestAccount } from "./auth-test-utils";
import {
  errorResponse,
  handle,
  HttpError,
  json,
  MAX_JSON_BYTES,
  MAX_NOTE_JSON_BYTES,
  noContent,
  readJson,
  requireParam,
} from "./http";
import { StorageError } from "./storage";
import { withTempDataDir } from "./storage/test-utils";

const URL_BASE = "http://localhost/api/test";
const isNamed = (v: unknown): v is { name: string } =>
  typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string";
const ok = handle(async () => json({ ok: true }));
const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error;

// Sign-in off unless a test turns it on, so most tests need no account.
beforeEach(() => vi.stubEnv("WRITE_AUTH", "off"));
afterEach(() => vi.unstubAllEnvs());

describe("json / noContent", () => {
  it("never lets responses be cached", async () => {
    const res = json({ a: 1 }, 201, { "X-Test": "1" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-test")).toBe("1");
    expect(await res.json()).toEqual({ a: 1 });
    const empty = noContent({ "Set-Cookie": "a=b" });
    expect(empty.status).toBe(204);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect(empty.headers.get("set-cookie")).toBe("a=b");
  });
});

describe("errorResponse", () => {
  it("maps StorageError codes to ERROR_STATUS", async () => {
    const res = errorResponse(new StorageError("name_taken", "Taken."));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "name_taken", message: "Taken." } });
  });

  it("includes current for version_conflict (null when the file is gone)", async () => {
    const current = { folder: "a", name: "b", content: "x", version: "v2" } as Note;
    const res = errorResponse(new StorageError("version_conflict", "Changed.", current));
    expect(((await res.json()) as ApiErrorBody).current).toEqual(current);
    const gone = errorResponse(new StorageError("version_conflict", "Gone."));
    expect(await gone.json()).toEqual({
      error: { code: "version_conflict", message: "Gone." },
      current: null,
    });
  });

  it("maps HttpError and hides unknown errors behind a 500", async () => {
    expect(errorResponse(new HttpError("forbidden", "No.")).status).toBe(403);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(new Error("/secret/path exploded"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
    expect(spy).toHaveBeenCalled();
  });
});

describe("handle: auth", () => {
  it("returns 401 without credentials when auth is on, unless public", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_AUTH", "");
      await setUpTestAccount();
      const res = await ok(new Request(URL_BASE), undefined);
      expect(res.status).toBe(401);
      expect((await errorOf(res)).code).toBe("unauthorized");
      const open = handle(async () => json({ ok: true }), { public: true });
      expect((await open(new Request(URL_BASE), undefined)).status).toBe(200);
    }));

  it("returns 401 before setup, saying the account doesn't exist yet", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_AUTH", "");
      const res = await ok(new Request(URL_BASE), undefined);
      expect(res.status).toBe(401);
      expect((await errorOf(res)).message).toMatch(/create the account/);
    }));

  it("accepts a session cookie or a Bearer token", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_AUTH", "");
      const cookie = sessionCookieFor(await setUpTestAccount("sam", "pw"));
      expect((await ok(new Request(URL_BASE, { headers: { cookie } }), undefined)).status).toBe(200);
      const bearer = { authorization: "Bearer pw" };
      expect((await ok(new Request(URL_BASE, { headers: bearer }), undefined)).status).toBe(200);
    }));
});

describe("handle: CSRF", () => {
  const post = (headers: Record<string, string>) =>
    ok(new Request(URL_BASE, { method: "POST", body: "{}", headers }), undefined);

  it("rejects cross-site and same-site writes", async () => {
    const json = { "content-type": "application/json" };
    expect((await post({ ...json, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post({ ...json, "sec-fetch-site": "same-site" })).status).toBe(403);
  });

  it("allows same-origin, user-initiated (none) and non-browser requests", async () => {
    const json = { "content-type": "application/json" };
    expect((await post({ ...json, "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await post({ ...json, "sec-fetch-site": "none" })).status).toBe(200);
    expect((await post(json)).status).toBe(200);
  });

  it("requires JSON for POST/PUT/PATCH but not DELETE or GET", async () => {
    expect((await post({ "content-type": "text/plain" })).status).toBe(415);
    expect((await post({ "content-type": "application/json; charset=utf-8" })).status).toBe(200);
    expect((await ok(new Request(URL_BASE, { method: "DELETE" }), undefined)).status).toBe(200);
    const crossSiteGet = new Request(URL_BASE, { headers: { "sec-fetch-site": "cross-site" } });
    expect((await ok(crossSiteGet, undefined)).status).toBe(200);
  });
});

describe("readJson", () => {
  const jsonRequest = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request(URL_BASE, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
    });
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (err) {
      return err instanceof HttpError ? err.code : "unexpected";
    }
  };

  it("parses a body that passes the guard", async () => {
    expect(await readJson(jsonRequest('{"name":"Work"}'), isNamed)).toEqual({ name: "Work" });
  });

  it("rejects bad JSON, guard failures and non-JSON content types", async () => {
    expect(await codeOf(readJson(jsonRequest("{nope"), isNamed))).toBe("bad_request");
    expect(await codeOf(readJson(jsonRequest('{"name":1}'), isNamed))).toBe("bad_request");
    const text = new Request(URL_BASE, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "text/plain" },
    });
    expect(await codeOf(readJson(text, isNamed))).toBe("unsupported_media_type");
  });

  it("rejects oversize bodies by Content-Length and by actual bytes", async () => {
    const declared = jsonRequest("{}", { "content-length": String(MAX_JSON_BYTES + 1) });
    expect(await codeOf(readJson(declared, isNamed))).toBe("too_large");
    const big = JSON.stringify({ name: "x".repeat(MAX_NOTE_BYTES + 64 * 1024) });
    expect(await codeOf(readJson(jsonRequest(big), isNamed))).toBe("too_large");
  });

  it("gives note bodies room for JSON escaping, up to MAX_NOTE_JSON_BYTES", async () => {
    // A 4 MiB note of quoted code grows past MAX_JSON_BYTES once escaped.
    const escaped = JSON.stringify({ name: '  x = "y";\n'.repeat(Math.floor((4 * 1024 * 1024) / 11)) });
    expect(new TextEncoder().encode(escaped).length).toBeGreaterThan(MAX_JSON_BYTES);
    expect(await readJson(jsonRequest(escaped), isNamed, MAX_NOTE_JSON_BYTES)).toHaveProperty("name");
    const declared = jsonRequest("{}", { "content-length": String(MAX_NOTE_JSON_BYTES + 1) });
    expect(await codeOf(readJson(declared, isNamed, MAX_NOTE_JSON_BYTES))).toBe("too_large");
  });
});

describe("requireParam", () => {
  it("returns non-empty values and rejects missing or empty ones", () => {
    const url = new URL("http://localhost/api/notes?folder=Work&name=");
    expect(requireParam(url, "folder")).toBe("Work");
    expect(() => requireParam(url, "name")).toThrow(HttpError);
    expect(() => requireParam(url, "missing")).toThrow(/missing/);
  });
});
