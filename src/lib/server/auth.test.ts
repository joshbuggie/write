import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attemptPassword,
  authenticateRequest,
  clearSessionCookie,
  createSessionToken,
  isAuthEnabled,
  isSecureRequest,
  lockoutResponse,
  lockoutRetryAfterS,
  LOCKOUT_MS,
  resetPasswordGuard,
  SESSION_MAX_AGE_S,
  sessionCookie,
  verifySessionToken,
} from "./auth";

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);

beforeEach(() => void vi.spyOn(console, "warn").mockImplementation(() => {})); // lockout log line

afterEach(() => {
  vi.unstubAllEnvs();
  resetPasswordGuard();
});

describe("auth disabled", () => {
  beforeEach(() => vi.stubEnv("WRITE_PASSWORD", ""));

  it("lets every request through and never accepts tokens or passwords", () => {
    expect(isAuthEnabled()).toBe(false);
    expect(authenticateRequest(new Request("http://localhost/api/tree"))).toBe("ok");
    expect(verifySessionToken(createSessionToken(NOW), NOW)).toBe(false);
    expect(attemptPassword("")).toBe("unauthorized");
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

describe("attemptPassword", () => {
  beforeEach(() => vi.stubEnv("WRITE_PASSWORD", "hunter2"));

  it("accepts only the exact password", () => {
    expect(attemptPassword("hunter2")).toBe("ok");
    expect(attemptPassword("hunter")).toBe("unauthorized");
    expect(attemptPassword("Hunter2")).toBe("unauthorized");
    expect(attemptPassword("")).toBe("unauthorized");
  });

  it("locks every password check out after 10 failures, even the right password", () => {
    for (let i = 0; i < 10; i++) expect(attemptPassword(`guess${i}`, NOW + i)).toBe("unauthorized");
    expect(attemptPassword("guess", NOW + 10)).toBe("rate_limited");
    expect(attemptPassword("hunter2", NOW + 10)).toBe("rate_limited");
    expect(lockoutRetryAfterS(NOW + 9)).toBe(LOCKOUT_MS / 1000);
    expect(lockoutResponse(NOW + 9)).toEqual({
      retryAfterS: LOCKOUT_MS / 1000,
      message: "Too many sign-in attempts. Try again in 15 minutes.",
    });
    // Minutes round up from the same seconds as Retry-After, and never say "0 minutes".
    expect(lockoutResponse(NOW + 9 + LOCKOUT_MS - 61_000).message).toBe(
      "Too many sign-in attempts. Try again in 2 minutes.",
    );
    expect(lockoutResponse(NOW + 9 + LOCKOUT_MS - 1_000)).toEqual({
      retryAfterS: 1,
      message: "Too many sign-in attempts. Try again in 1 minute.",
    });

    // After the lockout the budget starts over.
    const after = NOW + 9 + LOCKOUT_MS;
    expect(lockoutRetryAfterS(after)).toBe(0);
    expect(attemptPassword("hunter2", after)).toBe("ok");
    for (let i = 0; i < 9; i++) expect(attemptPassword("nope", after + i)).toBe("unauthorized");
    expect(attemptPassword("hunter2", after + 9)).toBe("ok");
  });

  it("forgets failures older than the window, but not because of a success", () => {
    for (let i = 0; i < 9; i++) attemptPassword("nope", NOW);
    expect(attemptPassword("hunter2", NOW)).toBe("ok");
    expect(attemptPassword("nope", NOW + 1)).toBe("unauthorized");
    expect(attemptPassword("hunter2", NOW + 2)).toBe("rate_limited");

    resetPasswordGuard();
    for (let i = 0; i < 9; i++) attemptPassword("nope", NOW);
    expect(attemptPassword("nope", NOW + 15 * 60 * 1000)).toBe("unauthorized");
    expect(attemptPassword("hunter2", NOW + 15 * 60 * 1000)).toBe("ok");
  });

  it("shares one budget between separately bundled copies of this module (proxy vs routes)", async () => {
    vi.resetModules();
    const proxyCopy = await import("./auth");
    vi.resetModules();
    const routeCopy = await import("./auth");
    expect(proxyCopy).not.toBe(routeCopy);
    for (let i = 0; i < 10; i++) proxyCopy.attemptPassword("nope", NOW);
    expect(routeCopy.attemptPassword("hunter2", NOW)).toBe("rate_limited");
  });
});

describe("isRequestAuthenticated", () => {
  beforeEach(() => vi.stubEnv("WRITE_PASSWORD", "hunter2"));
  const req = (headers: HeadersInit) => new Request("http://localhost/api/tree", { headers });

  it("accepts a valid session cookie among others", () => {
    const token = createSessionToken();
    expect(authenticateRequest(req({ cookie: `write-sidebar=open; write_session=${token}` }))).toBe("ok");
  });

  it("accepts a Bearer password", () => {
    expect(authenticateRequest(req({ authorization: "Bearer hunter2" }))).toBe("ok");
    expect(authenticateRequest(req({ authorization: "Bearer nope" }))).toBe("unauthorized");
  });

  it("rejects requests without credentials or with a bad cookie", () => {
    expect(authenticateRequest(req({}))).toBe("unauthorized");
    expect(authenticateRequest(req({ cookie: "write_session=v1.1.abc" }))).toBe("unauthorized");
  });

  it("counts wrong Bearer passwords against the lockout, but session cookies keep working", () => {
    const cookie = `write_session=${createSessionToken()}`;
    for (let i = 0; i < 10; i++) authenticateRequest(req({ authorization: `Bearer guess${i}` }));
    expect(authenticateRequest(req({ authorization: "Bearer hunter2" }))).toBe("rate_limited");
    expect(authenticateRequest(req({ cookie }))).toBe("ok");
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
