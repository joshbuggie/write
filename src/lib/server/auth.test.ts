import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkPassword,
  clearSessionCookie,
  createSessionToken,
  isAuthEnabled,
  isLoginThrottled,
  isRequestAuthenticated,
  isSecureRequest,
  recordLoginFailure,
  resetLoginThrottle,
  SESSION_MAX_AGE_S,
  sessionCookie,
  verifySessionToken,
} from "./auth";

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);

afterEach(() => {
  vi.unstubAllEnvs();
  resetLoginThrottle();
});

describe("auth disabled", () => {
  beforeEach(() => vi.stubEnv("WRITE_PASSWORD", ""));

  it("lets every request through and never accepts tokens or passwords", () => {
    expect(isAuthEnabled()).toBe(false);
    expect(isRequestAuthenticated(new Request("http://localhost/api/tree"))).toBe(true);
    expect(verifySessionToken(createSessionToken(NOW), NOW)).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
});

describe("session tokens", () => {
  beforeEach(() => vi.stubEnv("WRITE_PASSWORD", "hunter2"));

  it("round-trips a fresh token", () => {
    const token = createSessionToken(NOW);
    expect(token).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]+$/);
    expect(verifySessionToken(token, NOW)).toBe(true);
  });

  it("expires after 30 days", () => {
    const token = createSessionToken(NOW);
    expect(verifySessionToken(token, NOW + SESSION_MAX_AGE_S * 1000 - 1)).toBe(true);
    expect(verifySessionToken(token, NOW + SESSION_MAX_AGE_S * 1000)).toBe(false);
  });

  it("rejects tampered tokens", () => {
    const token = createSessionToken(NOW);
    const [version, expiry, signature] = token.split(".");
    const flipped = signature[0] === "A" ? "B" + signature.slice(1) : "A" + signature.slice(1);
    expect(verifySessionToken(`${version}.${expiry}.${flipped}`, NOW)).toBe(false);
    expect(verifySessionToken(`${version}.${Number(expiry) + 1000}.${signature}`, NOW)).toBe(false);
    expect(verifySessionToken(`v2.${expiry}.${signature}`, NOW)).toBe(false);
    expect(verifySessionToken(`${token}.extra`, NOW)).toBe(false);
    expect(verifySessionToken("", NOW)).toBe(false);
    expect(verifySessionToken(undefined, NOW)).toBe(false);
  });

  it("is invalidated by a password change", () => {
    const token = createSessionToken(NOW);
    vi.stubEnv("WRITE_PASSWORD", "correct horse");
    expect(verifySessionToken(token, NOW)).toBe(false);
  });
});

describe("checkPassword", () => {
  beforeEach(() => vi.stubEnv("WRITE_PASSWORD", "hunter2"));

  it("accepts only the exact password", () => {
    expect(checkPassword("hunter2")).toBe(true);
    expect(checkPassword("hunter")).toBe(false);
    expect(checkPassword("Hunter2")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
});

describe("isRequestAuthenticated", () => {
  beforeEach(() => vi.stubEnv("WRITE_PASSWORD", "hunter2"));
  const req = (headers: HeadersInit) => new Request("http://localhost/api/tree", { headers });

  it("accepts a valid session cookie among others", () => {
    const token = createSessionToken();
    expect(isRequestAuthenticated(req({ cookie: `write-sidebar=open; write_session=${token}` }))).toBe(true);
  });

  it("accepts a Bearer password", () => {
    expect(isRequestAuthenticated(req({ authorization: "Bearer hunter2" }))).toBe(true);
    expect(isRequestAuthenticated(req({ authorization: "Bearer nope" }))).toBe(false);
  });

  it("rejects requests without credentials or with a bad cookie", () => {
    expect(isRequestAuthenticated(req({}))).toBe(false);
    expect(isRequestAuthenticated(req({ cookie: "write_session=v1.1.abc" }))).toBe(false);
  });
});

describe("cookies", () => {
  it("builds the session cookie with the right attributes", () => {
    expect(sessionCookie("tok", false)).toBe(
      "write_session=tok; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000",
    );
    expect(sessionCookie("tok", true)).toMatch(/; Secure$/);
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });

  it("detects https directly or behind a reverse proxy", () => {
    expect(isSecureRequest(new Request("https://notes.example.com/"))).toBe(true);
    expect(isSecureRequest(new Request("http://localhost/"))).toBe(false);
    const proxied = new Request("http://localhost/", { headers: { "x-forwarded-proto": "https,http" } });
    expect(isSecureRequest(proxied)).toBe(true);
  });
});

describe("login throttle", () => {
  it("throttles after 5 failures within 10 minutes", () => {
    for (let i = 0; i < 4; i++) recordLoginFailure(NOW + i);
    expect(isLoginThrottled(NOW + 10)).toBe(false);
    recordLoginFailure(NOW + 10);
    expect(isLoginThrottled(NOW + 10)).toBe(true);
    expect(isLoginThrottled(NOW + 10 * 60 * 1000 + 11)).toBe(false);
  });
});
