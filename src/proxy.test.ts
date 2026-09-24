import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetPasswordGuard } from "@/lib/server/auth";
import { sessionCookieFor, setUpTestAccount } from "@/lib/server/auth-test-utils";
import { withTempDataDir, writeTestConfigFile } from "@/lib/server/storage/test-utils";
import { config, proxy } from "./proxy";

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";
const request = (path: string, headers?: HeadersInit) =>
  new NextRequest(new URL(path, "http://localhost:3000"), { headers });

afterEach(() => {
  vi.unstubAllEnvs();
  resetPasswordGuard();
});

describe("proxy", () => {
  it("lets everything through with WRITE_AUTH=off", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_AUTH", "off");
      expect(passes(await proxy(request("/api/tree")))).toBe(true);
      expect(passes(await proxy(request("/notes/a/b")))).toBe(true);
    }));

  it("leaves the setup and sign-in pages and endpoints, and the health check, to themselves", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const open of ["/setup", "/login", "/api/auth/setup", "/api/auth/login", "/api/health"]) {
      expect(matcher.test(open)).toBe(false);
    }
    for (const gated of ["/", "/notes", "/api/tree", "/api/auth/logout", "/api/settings"]) {
      expect(matcher.test(gated)).toBe(true);
    }
  });

  describe("before setup", () => {
    it("sends pages to /setup and answers API calls with a 401 that says so", () =>
      withTempDataDir(async () => {
        const page = await proxy(request("/notes/a/b"));
        expect(page.status).toBe(307);
        expect(page.headers.get("location")).toBe("http://localhost:3000/setup");
        const api = await proxy(request("/api/tree", { authorization: "Bearer anything" }));
        expect(api.status).toBe(401);
        expect(await api.json()).toEqual({
          error: { code: "unauthorized", message: expect.stringContaining("create the account") },
        });
      }));
  });

  describe("after setup", () => {
    it("answers API calls without credentials with a JSON 401", () =>
      withTempDataDir(async () => {
        await setUpTestAccount();
        const res = await proxy(request("/api/tree"));
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({
          error: { code: "unauthorized", message: "Sign in to continue." },
        });
      }));

    it("redirects pages to /login, remembering the destination", () =>
      withTempDataDir(async () => {
        await setUpTestAccount();
        const res = await proxy(request("/notes/a/b"));
        expect(res.status).toBe(307);
        expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fnotes%2Fa%2Fb");
        const withQuery = await proxy(request("/notes?x=1"));
        expect(withQuery.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fnotes%3Fx%3D1");
      }));

    it("passes a valid session cookie or Bearer password", () =>
      withTempDataDir(async () => {
        const account = await setUpTestAccount("sam", "pw");
        const cookie = sessionCookieFor(account);
        expect(passes(await proxy(request("/notes/a/b", { cookie })))).toBe(true);
        expect(passes(await proxy(request("/api/tree", { authorization: "Bearer pw" })))).toBe(true);
        expect(passes(await proxy(request("/api/tree", { authorization: "Bearer wrong" })))).toBe(false);
      }));

    it("answers Bearer guessing with a 429 once the password budget is spent", () =>
      withTempDataDir(async () => {
        const account = await setUpTestAccount("sam", "pw");
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const guess = (password: string) =>
          proxy(request("/api/tree", { authorization: `Bearer ${password}` }));
        for (let i = 0; i < 10; i++) expect((await guess(`g${i}`)).status).toBe(401);
        const locked = await guess("pw");
        expect(locked.status).toBe(429);
        expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
        expect(await locked.json()).toEqual({
          error: {
            code: "rate_limited",
            message: expect.stringMatching(/^Too many sign-in attempts. Try again in \d+ minutes?\.$/),
          },
        });
        // A signed-in browser is unaffected.
        expect(passes(await proxy(request("/api/tree", { cookie: sessionCookieFor(account) })))).toBe(true);
      }));
  });

  it("keeps everything closed when the account file can't be read", () =>
    withTempDataDir(async () => {
      await writeTestConfigFile("account.json", "{ broken");
      const page = await proxy(request("/notes/a/b"));
      expect(page.status).toBe(307);
      expect(page.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fnotes%2Fa%2Fb");
      const api = await proxy(request("/api/tree"));
      expect(api.status).toBe(503);
      expect(await api.json()).toEqual({
        error: { code: "storage_unavailable", message: expect.stringContaining("account.json") },
      });
    }));
});
