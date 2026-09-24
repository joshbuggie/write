import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sameUsername } from "@/lib/account";
import { SESSION_COOKIE } from "@/lib/constants";
import { isTokenShaped } from "@/lib/integrations";
import { attemptPassword, type PasswordCheck } from "./password-guard";
import { verifyPassword } from "./password-hash";
import { readAccount, type StoredAccount } from "./storage";

/**
 * Sign-in with one account, made at first-run setup (see docs/design-decisions.md#d30). A session is an
 * HMAC-signed expiry, keyed by the account's session secret, so no session store is needed. The account
 * file is read on every check, so deleting it takes effect at once.
 */

export {
  attemptPassword,
  LOCKOUT_MS,
  lockoutResponse,
  lockoutRetryAfterS,
  resetPasswordGuard,
} from "./password-guard";

/** Session lifetime: 30 days, in seconds (also the cookie Max-Age). */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const TOKEN_VERSION = "v2";

/**
 * Sign-in is on unless WRITE_AUTH=off, for servers that already have auth in front (a VPN, or a reverse
 * proxy that signs people in). Read per call so tests and restarts pick up changes.
 */
export function isAuthEnabled(): boolean {
  return process.env.WRITE_AUTH?.trim().toLowerCase() !== "off";
}

/** Sign-in off; on but waiting for first-run setup; or on, with the account. */
export type AuthState = { mode: "off" } | { mode: "setup" } | { mode: "on"; account: StoredAccount };

/** Throws storage_unavailable when the account file can't be read, so callers fail closed. */
export async function readAuthState(): Promise<AuthState> {
  if (!isAuthEnabled()) return { mode: "off" };
  const account = await readAccount();
  return account ? { mode: "on", account } : { mode: "setup" };
}

function sha256(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

function sign(payload: string, account: StoredAccount): string {
  const key = sha256("write-session\x00" + account.sessionSecret);
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Constant-time comparison of two strings (false when lengths differ). */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** New session token: "v2.<expMs>.<base64url HMAC-SHA256(key, "v2.<expMs>")>". */
export function createSessionToken(account: StoredAccount, now: number = Date.now()): string {
  const payload = `${TOKEN_VERSION}.${now + SESSION_MAX_AGE_S * 1000}`;
  return `${payload}.${sign(payload, account)}`;
}

/** True only for an unexpired token signed with this account's session secret. */
export function verifySessionToken(
  token: string | undefined,
  account: StoredAccount,
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expiry, signature] = parts;
  if (version !== TOKEN_VERSION || !/^\d{1,15}$/.test(expiry)) return false;
  if (Number(expiry) <= now) return false;
  return safeEqual(signature, sign(`${version}.${expiry}`, account));
}

/**
 * The sign-in page's check, through the brute-force guard. The password is hashed even for a wrong
 * username, so the answer takes as long either way and never says which one was wrong.
 */
export function checkCredentials(
  account: StoredAccount,
  username: string,
  password: string,
): Promise<PasswordCheck> {
  return attemptPassword(async () => {
    const passwordOk = await verifyPassword(password, account.passwordHash);
    return passwordOk && sameUsername(username, account.username);
  });
}

/** Reads one cookie from a raw Cookie header (plain `Request` has no cookie jar). */
function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Outcome of authenticating a request: a PasswordCheck, or "setup" while there is no account yet. */
export type AuthStatus = PasswordCheck | "setup";

/**
 * "ok" if sign-in is off, the session cookie is valid, or `Authorization: Bearer <password>` (scripts).
 * The Bearer password counts against the same brute-force budget as the sign-in page. An integration token
 * is never a password guess: it only opens /api/agent (docs/design-decisions.md#d31), so here it is simply
 * refused, without touching the lockout budget. Throws storage_unavailable when the account file can't be
 * read.
 */
export async function authenticateRequest(req: Request): Promise<AuthStatus> {
  const state = await readAuthState();
  if (state.mode === "off") return "ok";
  if (state.mode === "setup") return "setup";
  const { account } = state;
  if (verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE), account)) return "ok";
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match || isTokenShaped(match[1])) return "unauthorized";
  return attemptPassword(() => verifyPassword(match[1], account.passwordHash));
}

/** The cookie should be Secure when the browser reached us over https, including via a TLS reverse proxy. */
export function isSecureRequest(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return forwarded === "https" || new URL(req.url).protocol === "https:";
}

/** Set-Cookie value for a fresh session. HttpOnly + SameSite=Lax keep it away from scripts and cross-site posts. */
export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_S}${secure ? "; Secure" : ""}`;
}

/** Set-Cookie value that removes the session cookie (sign out). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
