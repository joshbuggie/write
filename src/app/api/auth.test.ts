import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "@/lib/api-contract";
import { resetPasswordGuard } from "@/lib/server/auth";
import { setUpTestAccount } from "@/lib/server/auth-test-utils";
import { readAccount } from "@/lib/server/storage";
import { withTempDataDir } from "@/lib/server/storage/test-utils";
import * as health from "./health/route";
import * as login from "./auth/login/route";
import * as logout from "./auth/logout/route";
import * as setup from "./auth/setup/route";
import * as tree from "./tree/route";

/** Setup, sign-in and sign-out through the real route exports, each test in its own temp folders. */

type Handler = (req: Request, ctx: unknown) => Promise<Response>;
type Init = { body?: unknown; headers?: Record<string, string> };

function call(handler: Handler, method: string, url: string, init: Init = {}): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.body !== undefined) headers["content-type"] ??= "application/json";
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  return handler(new Request(`http://localhost${url}`, { method, body, headers }), {
    params: Promise.resolve({}),
  });
}

const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error;
const setUp = (body: unknown, headers?: Record<string, string>) =>
  call(setup.POST, "POST", "/api/auth/setup", { body, headers });
const signIn = (username: string, password: string) =>
  call(login.POST, "POST", "/api/auth/login", { body: { username, password } });
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {})); // setup and lockout log lines
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetPasswordGuard();
});

describe("setup", () => {
  it("creates the account, signs this browser in, and is closed from then on", () =>
    withTempDataDir(async () => {
      expect((await call(tree.GET, "GET", "/api/tree")).status).toBe(401);

      const res = await setUp({ username: "  Sam ", password: "correct horse" });
      expect(res.status).toBe(204);
      expect(res.headers.get("set-cookie")).toMatch(
        /^write_session=v2\.\d+\.[\w-]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/,
      );
      expect((await call(tree.GET, "GET", "/api/tree", { headers: { cookie: cookieOf(res) } })).status).toBe(
        200,
      );

      const account = await readAccount();
      expect(account?.username).toBe("Sam");
      expect(account?.passwordHash).toMatch(/^scrypt\$/);

      const again = await setUp({ username: "mallory", password: "taken over" });
      expect(again.status).toBe(409);
      expect((await errorOf(again)).code).toBe("already_set_up");
      expect(await readAccount()).toEqual(account);
    }));

  it("refuses a username or password that breaks the rules, and creates nothing", () =>
    withTempDataDir(async () => {
      for (const body of [
        { username: "", password: "long enough" },
        { username: "sam", password: "short" },
        { username: "sam\u0000", password: "long enough" },
        { username: "sam" },
      ]) {
        const res = await setUp(body);
        expect(res.status).toBe(400);
        expect((await errorOf(res)).code).toBe("bad_request");
      }
      expect(await readAccount()).toBeNull();
    }));

  it("is refused cross-site, so a web page can't claim a fresh server on the LAN", () =>
    withTempDataDir(async () => {
      const res = await setUp(
        { username: "sam", password: "long enough" },
        { "sec-fetch-site": "cross-site" },
      );
      expect(res.status).toBe(403);
      expect(await readAccount()).toBeNull();
    }));

  it("lets exactly one of two simultaneous setups win", () =>
    withTempDataDir(async () => {
      const results = await Promise.all([
        setUp({ username: "a", password: "long enough" }),
        setUp({ username: "b", password: "long enough" }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    }));

  it("is 400 while sign-in is off", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_AUTH", "off");
      expect((await setUp({ username: "sam", password: "long enough" })).status).toBe(400);
      expect(await readAccount()).toBeNull();
    }));
});

describe("sign-in", () => {
  it("is 400 while sign-in is off, and 401 before setup", () =>
    withTempDataDir(async () => {
      expect((await signIn("sam", "pw")).status).toBe(401);
      vi.stubEnv("WRITE_AUTH", "off");
      expect((await signIn("sam", "pw")).status).toBe(400);
    }));

  it("401 without credentials; 200 with Bearer; login cookie works; logout clears it", () =>
    withTempDataDir(async () => {
      await setUpTestAccount("sam", "pw");
      const denied = await call(tree.GET, "GET", "/api/tree");
      expect(denied.status).toBe(401);
      expect((await errorOf(denied)).code).toBe("unauthorized");
      expect((await call(health.GET, "GET", "/api/health")).status).toBe(200);
      expect(
        (await call(tree.GET, "GET", "/api/tree", { headers: { authorization: "Bearer pw" } })).status,
      ).toBe(200);

      const wrongUser = await signIn("alex", "pw");
      expect(wrongUser.status).toBe(401);
      expect((await errorOf(wrongUser)).message).toBe("Wrong username or password.");

      const signedIn = await signIn("SAM", "pw");
      expect(signedIn.status).toBe(204);
      const cookie = cookieOf(signedIn);
      expect((await call(tree.GET, "GET", "/api/tree", { headers: { cookie } })).status).toBe(200);

      const out = await call(logout.POST, "POST", "/api/auth/logout", { body: {}, headers: { cookie } });
      expect(out.status).toBe(204);
      expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
      expect((await call(logout.POST, "POST", "/api/auth/logout", { body: {} })).status).toBe(401);
    }));

  it("sets Secure behind an https reverse proxy", () =>
    withTempDataDir(async () => {
      await setUpTestAccount("sam", "pw");
      const res = await call(login.POST, "POST", "/api/auth/login", {
        body: { username: "sam", password: "pw" },
        headers: { "x-forwarded-proto": "https" },
      });
      expect(res.headers.get("set-cookie")).toMatch(/; Secure$/);
    }));

  it("wrong passwords get 401, then an immediate 429 with Retry-After once the budget is spent", () =>
    withTempDataDir(async () => {
      await setUpTestAccount("sam", "pw");
      for (let i = 0; i < 10; i++) expect((await signIn("sam", "nope")).status).toBe(401);
      const locked = await signIn("sam", "pw");
      expect(locked.status).toBe(429);
      // The login form shows this message as is, so it must carry the same wait as Retry-After.
      const retryAfterS = Number(locked.headers.get("retry-after"));
      expect(retryAfterS).toBeGreaterThan(0);
      expect(await locked.json()).toEqual({
        error: {
          code: "rate_limited",
          message: `Too many sign-in attempts. Try again in ${Math.ceil(retryAfterS / 60)} minutes.`,
        },
      });
    }));

  it("parallel wrong passwords (login and Bearer) share one budget", () =>
    withTempDataDir(async () => {
      await setUpTestAccount("sam", "pw");
      const statuses = await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          i % 2
            ? call(tree.GET, "GET", "/api/tree", { headers: { authorization: `Bearer guess${i}` } })
            : signIn("sam", `guess${i}`),
        ).map(async (res) => (await res).status),
      );
      expect(statuses.filter((s) => s === 401)).toHaveLength(10);
      expect(statuses.filter((s) => s === 429)).toHaveLength(40);
      const bearer = await call(tree.GET, "GET", "/api/tree", { headers: { authorization: "Bearer pw" } });
      expect(bearer.status).toBe(429);
    }));
});
