import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE } from "@/lib/constants";

/**
 * Optional single-password auth (§7.2). Everything here is stateless except the login throttle:
 * a session is an HMAC-signed expiry, so no session store is needed and changing WRITE_PASSWORD
 * signs out every device (the password is part of the signing key).
 */

/** Session lifetime: 30 days, in seconds (also the cookie Max-Age). */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const TOKEN_VERSION = "v1";

/** Auth is on only when WRITE_PASSWORD is set. Read per call so tests and restarts pick up changes. */
export function isAuthEnabled(): boolean {
  return !!process.env.WRITE_PASSWORD;
}

function currentPassword(): string {
  return process.env.WRITE_PASSWORD ?? "";
}

function sha256(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

/** Derived from the password so a password change invalidates every existing token. */
function sessionKey(): Buffer {
  return sha256("write-session\x00" + currentPassword());
}

function sign(payload: string): string {
  return createHmac("sha256", sessionKey()).update(payload).digest("base64url");
}

/** Constant-time comparison of two strings (false when lengths differ). */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** New session token: "v1.<expMs>.<base64url HMAC-SHA256(key, "v1.<expMs>")>". */
export function createSessionToken(now: number = Date.now()): string {
  const payload = `${TOKEN_VERSION}.${now + SESSION_MAX_AGE_S * 1000}`;
  return `${payload}.${sign(payload)}`;
}

/** True only for an unexpired token signed with the current password. Always false when auth is off. */
export function verifySessionToken(token: string | undefined, now: number = Date.now()): boolean {
  if (!isAuthEnabled() || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expiry, signature] = parts;
  if (version !== TOKEN_VERSION || !/^\d{1,15}$/.test(expiry)) return false;
  if (Number(expiry) <= now) return false;
  return safeEqual(signature, sign(`${version}.${expiry}`));
}

/** Compares sha256 digests so the comparison is constant-time regardless of input length. */
export function checkPassword(input: string): boolean {
  if (!isAuthEnabled()) return false;
  return timingSafeEqual(sha256(input), sha256(currentPassword()));
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

/** True if auth is off, the session cookie is valid, or `Authorization: Bearer <WRITE_PASSWORD>` (scripts). */
export function isRequestAuthenticated(req: Request): boolean {
  if (!isAuthEnabled()) return true;
  if (verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE))) return true;
  const authorization = req.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return !!match && checkPassword(match[1]);
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

// Login throttle (§7.2): module-level, so it is per server process, which matches "one instance per data dir".
const THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const THROTTLE_AFTER_FAILURES = 5;
/** Extra delay for every attempt once throttled. */
export const THROTTLED_DELAY_MS = 2000;
/** Delay after every failed attempt. */
export const FAILURE_DELAY_MS = 250;

let failures: number[] = [];

function recentFailures(now: number): number[] {
  failures = failures.filter((t) => now - t < THROTTLE_WINDOW_MS);
  return failures;
}

/** True after 5 failed logins within 10 minutes; the login route then slows every attempt down. */
export function isLoginThrottled(now: number = Date.now()): boolean {
  return recentFailures(now).length >= THROTTLE_AFTER_FAILURES;
}

/** Remember a failed login for the throttle. */
export function recordLoginFailure(now: number = Date.now()): void {
  recentFailures(now).push(now);
}

/** Test helper: forget all recorded failures. */
export function resetLoginThrottle(): void {
  failures = [];
}
