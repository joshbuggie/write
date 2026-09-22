import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "@/lib/server/auth";
import { proxy } from "./proxy";

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";
const request = (path: string, headers?: HeadersInit) =>
  new NextRequest(new URL(path, "http://localhost:3000"), { headers });

afterEach(() => vi.unstubAllEnvs());

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
  });
});
