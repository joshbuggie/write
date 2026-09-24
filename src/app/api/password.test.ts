import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorBody } from "@/lib/api-contract";
import { resetPasswordGuard } from "@/lib/server/auth";
import { sessionCookieFor, setUpTestAccount } from "@/lib/server/auth-test-utils";
import { readAccount } from "@/lib/server/storage";
import { withTempDataDir } from "@/lib/server/storage/test-utils";
import * as login from "./auth/login/route";
import * as password from "./auth/password/route";
import * as tree from "./tree/route";

/** Changing the password from Settings, through the real route exports, each test in its own temp folders. */

type Handler = (req: Request, ctx: unknown) => Promise<Response>;

function call(handler: Handler, url: string, body: unknown, headers: Record<string, string> = {}) {
  const init = {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  };
  return handler(new Request(`http://localhost${url}`, init), { params: Promise.resolve({}) });
}
const getTree = (cookie: string) =>
  tree.GET(new Request("http://localhost/api/tree", { headers: { cookie } }), {
    params: Promise.resolve({}),
  });
const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error;
const change = (cookie: string, currentPassword: string, newPassword: string) =>
  call(password.POST, "/api/auth/password", { currentPassword, newPassword }, { cookie });

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {})); // change and lockout log lines
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetPasswordGuard();
});

describe("POST /api/auth/password", () => {
  it("changes the password, keeps this browser signed in and signs out the others", () =>
    withTempDataDir(async () => {
      const account = await setUpTestAccount("sam", "old password");
      const here = sessionCookieFor(account);
      const elsewhere = sessionCookieFor(account);

      const res = await change(here, "old password", "new password");
      expect(res.status).toBe(204);
      const fresh = (res.headers.get("set-cookie") ?? "").split(";")[0];
      expect(fresh).toMatch(/^write_session=v2\./);
      expect((await getTree(fresh)).status).toBe(200);
      expect((await getTree(elsewhere)).status).toBe(401);

      const signIn = (pw: string) => call(login.POST, "/api/auth/login", { username: "sam", password: pw });
      expect((await signIn("old password")).status).toBe(401);
      expect((await signIn("new password")).status).toBe(204);
    }));

  it("needs a session: no signed-out request can change it", () =>
    withTempDataDir(async () => {
      await setUpTestAccount("sam", "old password");
      const res = await call(password.POST, "/api/auth/password", {
        currentPassword: "old password",
        newPassword: "new password",
      });
      expect(res.status).toBe(401);
    }));

  it("refuses a wrong current password with wrong_password, and changes nothing", () =>
    withTempDataDir(async () => {
      const account = await setUpTestAccount("sam", "old password");
      const res = await change(sessionCookieFor(account), "guess", "new password");
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toEqual({
        code: "wrong_password",
        message: "The current password is wrong.",
      });
      expect(await readAccount()).toEqual(account);
    }));

  it("counts wrong current passwords against the sign-in lockout", () =>
    withTempDataDir(async () => {
      const cookie = sessionCookieFor(await setUpTestAccount("sam", "old password"));
      for (let i = 0; i < 10; i++)
        expect((await change(cookie, `guess${i}`, "new password")).status).toBe(403);
      const locked = await change(cookie, "old password", "new password");
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    }));

  it("refuses a new password that breaks the rules, before checking the current one", () =>
    withTempDataDir(async () => {
      const account = await setUpTestAccount("sam", "old password");
      const res = await change(sessionCookieFor(account), "old password", "short");
      expect(res.status).toBe(400);
      expect((await errorOf(res)).message).toBe("Use at least 8 characters.");
      expect(await readAccount()).toEqual(account);
    }));

  it("is refused cross-site", () =>
    withTempDataDir(async () => {
      const account = await setUpTestAccount("sam", "old password");
      const res = await call(
        password.POST,
        "/api/auth/password",
        { currentPassword: "old password", newPassword: "new password" },
        { cookie: sessionCookieFor(account), "sec-fetch-site": "cross-site" },
      );
      expect(res.status).toBe(403);
      expect(await readAccount()).toEqual(account);
    }));

  it("is 400 while sign-in is off", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_AUTH", "off");
      const res = await call(password.POST, "/api/auth/password", {
        currentPassword: "a",
        newPassword: "long enough",
      });
      expect(res.status).toBe(400);
    }));
});
