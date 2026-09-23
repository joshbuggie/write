import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, resetPasswordGuard } from "@/lib/server/auth";
import { proxy } from "./proxy";

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";
const request = (path: string, headers?: HeadersInit) =>
  new NextRequest(new URL(path, "http://localhost:3000"), { headers });

afterEach(() => {
  vi.unstubAllEnvs();
  resetPasswordGuard();
});

describe("proxy", () => {
  it("lets everything through when WRITE_PASSWORD is unset", () => {
    vi.stubEnv("WRITE_PASSWORD", "");
    expect(passes(proxy(request("/api/tree")))).toBe(true);
    expect(passes(proxy(request("/notes/a/b")))).toBe(true);
  });

  describe("with WRITE_PASSWORD", () => {
    it("answers API calls without credentials with a JSON 401", async () => {
      vi.stubEnv("WRITE_PASSWORD", "pw");
      const res = proxy(request("/api/tree"));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
    });

    it("redirects pages to /login, remembering the destination", () => {
      vi.stubEnv("WRITE_PASSWORD", "pw");
      const res = proxy(request("/notes/a/b"));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fnotes%2Fa%2Fb");
      const withQuery = proxy(request("/notes?x=1"));
      expect(withQuery.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fnotes%3Fx%3D1");
    });

    it("passes a valid session cookie or Bearer token", () => {
      vi.stubEnv("WRITE_PASSWORD", "pw");
      const cookie = `write_session=${createSessionToken()}`;
      expect(passes(proxy(request("/notes/a/b", { cookie })))).toBe(true);
      expect(passes(proxy(request("/api/tree", { authorization: "Bearer pw" })))).toBe(true);
      expect(passes(proxy(request("/api/tree", { authorization: "Bearer wrong" })))).toBe(false);
    });

    it("answers Bearer guessing with a 429 once the password budget is spent", async () => {
      vi.stubEnv("WRITE_PASSWORD", "pw");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const guess = (password: string) =>
        proxy(request("/api/tree", { authorization: `Bearer ${password}` }));
      for (let i = 0; i < 10; i++) expect(guess(`g${i}`).status).toBe(401);
      const locked = guess("pw");
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await locked.json()).toEqual({
        error: {
          code: "rate_limited",
          message: expect.stringMatching(/^Too many sign-in attempts. Try again in \d+ minutes?\.$/),
        },
      });
      // A signed-in browser is unaffected.
      expect(passes(proxy(request("/api/tree", { cookie: `write_session=${createSessionToken()}` })))).toBe(
        true,
      );
    });
  });
});
