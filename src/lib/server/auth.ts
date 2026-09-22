import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE } from "@/lib/constants";

/**
 * Optional single-password auth (see docs/design-decisions.md#d12). Everything here is stateless except the
 * brute-force guard: a session is an HMAC-signed expiry, so no session store is needed and changing
 * WRITE_PASSWORD signs out every device (the password is part of the signing key).
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

/** Compares sha256 digests so the comparison is constant-time. Callers go through attemptPassword(). */
function checkPassword(input: string): boolean {
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

/**
 * "ok" if auth is off, the session cookie is valid, or `Authorization: Bearer <WRITE_PASSWORD>` (scripts).
 * The Bearer password counts against the same brute-force budget as the login form.
 */
export function authenticateRequest(req: Request): AuthStatus {
  if (!isAuthEnabled()) return "ok";
  if (verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE))) return "ok";
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match ? attemptPassword(match[1]) : "unauthorized";
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

/**
 * Brute-force guard shared by every password check (login form and Bearer header). One global budget:
 * after MAX_FAILURES wrong passwords within FAILURE_WINDOW_MS, every password check is refused outright
 * (429) for LOCKOUT_MS, even a correct one, so parallel requests can't multiply the guess rate. It is
 * global rather than per client IP because X-Forwarded-For is trivially spoofed. The tradeoff: an
 * attacker can keep the owner from signing in with the password, but existing session cookies keep
 * working. State lives on globalThis because proxy.ts and the Route Handlers are separate bundles that
 * run in the same Node process.
 */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
/** How long every password check is refused once the failure budget is spent. */
export const LOCKOUT_MS = 15 * 60 * 1000;

interface GuardState {
  failures: number[];
  lockedUntil: number;
}
const holder = globalThis as typeof globalThis & { __writePasswordGuard?: GuardState };
const guardState = (): GuardState => (holder.__writePasswordGuard ??= { failures: [], lockedUntil: 0 });

/** Outcome of an authentication check; the non-"ok" values are the matching ErrorCodes (401 / 429). */
export type AuthStatus = "ok" | "unauthorized" | "rate_limited";

/**
 * The only way to check a password. Synchronous on purpose: the lockout check, the comparison and the
 * failure bookkeeping happen in one tick, so a burst of concurrent requests can't slip past the budget.
 * A success does not clear earlier failures, otherwise a script using the right password would keep
 * refilling an attacker's budget.
 */
export function attemptPassword(input: string, now: number = Date.now()): AuthStatus {
  if (!isAuthEnabled()) return "unauthorized";
  const state = guardState();
  if (now < state.lockedUntil) return "rate_limited";
  if (checkPassword(input)) return "ok";
  state.failures = state.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
  state.failures.push(now);
  if (state.failures.length >= MAX_FAILURES) {
    state.failures = [];
    state.lockedUntil = now + LOCKOUT_MS;
    console.warn(
      `[write] ${MAX_FAILURES} wrong passwords: password sign-in is locked for ${LOCKOUT_MS / 60_000} minutes.`,
    );
  }
  return "unauthorized";
}

/** Seconds until the lockout ends (for Retry-After), or 0 when password checks are allowed. */
export function lockoutRetryAfterS(now: number = Date.now()): number {
  return Math.max(0, Math.ceil((guardState().lockedUntil - now) / 1000));
}

/** User-facing text for a 429, shared by the login route and the proxy. */
export function lockoutMessage(now: number = Date.now()): string {
  const minutes = Math.max(1, Math.ceil(lockoutRetryAfterS(now) / 60));
  return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** Test helper: forget all recorded failures and lift any lockout. */
export function resetPasswordGuard(): void {
  holder.__writePasswordGuard = { failures: [], lockedUntil: 0 };
}
