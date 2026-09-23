import { afterEach, describe, expect, it, vi } from "vitest";
import { api, isApiError, parseRetryAfter } from "./api-client";

describe("parseRetryAfter", () => {
  const now = Date.UTC(2026, 8, 22, 12, 0, 0);

  it("reads delta seconds and HTTP dates, never negative", () => {
    expect(parseRetryAfter("900", now)).toBe(900);
    expect(parseRetryAfter(" 0 ", now)).toBe(0);
    expect(parseRetryAfter("Tue, 22 Sep 2026 12:05:00 GMT", now)).toBe(300);
    expect(parseRetryAfter("Tue, 22 Sep 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("is null without a usable header", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter("-5", now)).toBeNull();
  });
});

describe("request errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (res: Response) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res),
    );
  const failure = () =>
    api.login("x").then(
      () => null,
      (err: unknown) => err,
    );

  it("exposes Retry-After on a 429 that has no JSON body", async () => {
    respond(new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "120" } }));
    const err = await failure();
    expect(isApiError(err, "rate_limited")).toBe(true);
    expect(isApiError(err) && err.retryAfterSeconds).toBe(120);
    expect(isApiError(err) && err.body).toBeNull();
  });

  it("keeps the server's JSON body alongside Retry-After", async () => {
    const body = { error: { code: "rate_limited", message: "Try again in 15 minutes." } };
    respond(Response.json(body, { status: 429, headers: { "Retry-After": "900" } }));
    const err = await failure();
    expect(isApiError(err) && [err.retryAfterSeconds, err.body]).toEqual([900, body]);
  });

  it("is null when the response names no wait", async () => {
    respond(Response.json({ error: { code: "unauthorized", message: "Wrong password." } }, { status: 401 }));
    const err = await failure();
    expect(isApiError(err, "unauthorized") && err.retryAfterSeconds).toBeNull();
  });
});
