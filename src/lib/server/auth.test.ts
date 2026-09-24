import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticateRequest,
  checkCredentials,
  clearSessionCookie,
  createSessionToken,
  isAuthEnabled,
  isSecureRequest,
  readAuthState,
  resetPasswordGuard,
  SESSION_MAX_AGE_S,
  sessionCookie,
  verifySessionToken,
} from "./auth";
import { sessionCookieFor, setUpTestAccount } from "./auth-test-utils";
import { withTempDataDir, writeTestConfigFile } from "./storage/test-utils";

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const req = (headers: HeadersInit = {}) => new Request("http://localhost/api/tree", { headers });

beforeEach(() => void vi.spyOn(console, "warn").mockImplementation(() => {})); // lockout log line

afterEach(() => {
  vi.unstubAllEnvs();
  resetPasswordGuard();
});

describe("auth modes", () => {
  it("is on by default and off only with WRITE_AUTH=off", () => {
    vi.stubEnv("WRITE_AUTH", "");
    expect(isAuthEnabled()).toBe(true);
    vi.stubEnv("WRITE_AUTH", " OFF ");
    expect(isAuthEnabled()).toBe(false);
    vi.stubEnv("WRITE_AUTH", "of"); // a typo keeps sign-in on, the safe way round
    expect(isAuthEnabled()).toBe(true);
  });

  it("lets every request through when off, without reading the config folder", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_AUTH", "off");
      await setUpTestAccount();
      expect(await readAuthState()).toEqual({ mode: "off" });
      expect(await authenticateRequest(req())).toBe("ok");
    }));

  it("waits for setup until the account exists", () =>
    withTempDataDir(async () => {
      expect(await readAuthState()).toEqual({ mode: "setup" });
      expect(await authenticateRequest(req({ authorization: "Bearer pw" }))).toBe("setup");
      const account = await setUpTestAccount();
      expect(await readAuthState()).toEqual({ mode: "on", account });
    }));

  it("keeps everyone out when the account file is broken, instead of reopening setup", () =>
    withTempDataDir(async () => {
      await writeTestConfigFile("account.json", "{ nope");
      await expect(readAuthState()).rejects.toMatchObject({ code: "storage_unavailable" });
      await expect(authenticateRequest(req())).rejects.toMatchObject({ code: "storage_unavailable" });
    }));
});

describe("session tokens", () => {
  it("round-trip, expire after 30 days, and reject tampering", () =>
    withTempDataDir(async () => {
      const account = await setUpTestAccount();
      const token = createSessionToken(account, NOW);
      expect(token).toMatch(/^v2\.\d+\.[A-Za-z0-9_-]+$/);
      expect(verifySessionToken(token, account, NOW)).toBe(true);
      expect(verifySessionToken(token, account, NOW + SESSION_MAX_AGE_S * 1000 - 1)).toBe(true);
      expect(verifySessionToken(token, account, NOW + SESSION_MAX_AGE_S * 1000)).toBe(false);

      const [version, expiry, signature] = token.split(".");
      const flipped = signature[0] === "A" ? "B" + signature.slice(1) : "A" + signature.slice(1);
      for (const bad of [
        `${version}.${expiry}.${flipped}`,
        `${version}.${Number(expiry) + 1000}.${signature}`,
        `v1.${expiry}.${signature}`,
        `${token}.extra`,
        "",
        undefined,
      ]) {
        expect(verifySessionToken(bad, account, NOW)).toBe(false);
      }
    }));

  it("stop working when the account is created again", () =>
    withTempDataDir(async () => {
      const token = createSessionToken(await setUpTestAccount(), NOW);
      await withTempDataDir(async () => {
        const again = await setUpTestAccount();
        expect(verifySessionToken(token, again, NOW)).toBe(false);
      });
    }));
});

describe("checkCredentials", () => {
  it("needs the right password and username, ignoring the username's case and spaces", () =>
    withTempDataDir(async () => {
      const account = await setUpTestAccount("Sam", "hunter22");
      expect(await checkCredentials(account, "sam ", "hunter22")).toBe("ok");
      expect(await checkCredentials(account, "SAM", "hunter22")).toBe("ok");
      expect(await checkCredentials(account, "sam", "Hunter22")).toBe("unauthorized");
      expect(await checkCredentials(account, "alex", "hunter22")).toBe("unauthorized");
      expect(await checkCredentials(account, "sam", "")).toBe("unauthorized");
    }));

  it("counts a wrong username against the lockout like a wrong password", () =>
    withTempDataDir(async () => {
      const account = await setUpTestAccount("sam", "hunter22");
      for (let i = 0; i < 10; i++) await checkCredentials(account, `user${i}`, "hunter22");
      expect(await checkCredentials(account, "sam", "hunter22")).toBe("rate_limited");
    }));
});

describe("authenticateRequest", () => {
  it("accepts a valid session cookie among others, or a Bearer password", () =>
    withTempDataDir(async () => {
      const account = await setUpTestAccount("sam", "hunter22");
      expect(
        await authenticateRequest(req({ cookie: `write-sidebar=open; ${sessionCookieFor(account)}` })),
      ).toBe("ok");
      expect(await authenticateRequest(req({ authorization: "Bearer hunter22" }))).toBe("ok");
      expect(await authenticateRequest(req({ authorization: "Bearer nope" }))).toBe("unauthorized");
      expect(await authenticateRequest(req())).toBe("unauthorized");
      expect(await authenticateRequest(req({ cookie: "write_session=v2.1.abc" }))).toBe("unauthorized");
    }));

  it("counts wrong Bearer passwords against the lockout, but session cookies keep working", () =>
    withTempDataDir(async () => {
      const account = await setUpTestAccount("sam", "hunter22");
      for (let i = 0; i < 10; i++) await authenticateRequest(req({ authorization: `Bearer guess${i}` }));
      expect(await authenticateRequest(req({ authorization: "Bearer hunter22" }))).toBe("rate_limited");
      expect(await authenticateRequest(req({ cookie: sessionCookieFor(account) }))).toBe("ok");
    }));
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
