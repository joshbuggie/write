/**
 * Brute-force guard shared by every password check (the sign-in page and Bearer headers), see
 * docs/design-decisions.md#d30. One global budget: after MAX_FAILURES wrong passwords within
 * FAILURE_WINDOW_MS, every password check is refused outright (429) for LOCKOUT_MS, even a correct one. It
 * is global rather than per client IP because X-Forwarded-For is trivially spoofed. The tradeoff: an
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
  /** Checks still hashing. Each may yet fail, so it holds one unit of the budget until it's done. */
  inFlight: number;
}
const holder = globalThis as typeof globalThis & { __writePasswordGuard?: GuardState };
const guardState = (): GuardState =>
  (holder.__writePasswordGuard ??= { failures: [], lockedUntil: 0, inFlight: 0 });

/** Outcome of a password check; the non-"ok" values are the matching ErrorCodes (401 / 429). */
export type PasswordCheck = "ok" | "unauthorized" | "rate_limited";

/**
 * The only way to check a password: `check` does the (slow, async) comparison. Before it starts, the
 * lockout and the budget are checked and a unit of budget is reserved in one synchronous step, so a burst
 * of concurrent requests gets at most the remaining budget of guesses, never more. A success hands its unit
 * back but does not clear earlier failures, otherwise a script using the right password would keep
 * refilling an attacker's budget.
 */
export async function attemptPassword(
  check: () => Promise<boolean>,
  now: number = Date.now(),
): Promise<PasswordCheck> {
  const state = guardState();
  if (now < state.lockedUntil) return "rate_limited";
  state.failures = state.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
  if (state.failures.length + state.inFlight >= MAX_FAILURES) return "rate_limited";
  state.inFlight++;
  let ok: boolean;
  try {
    ok = await check();
  } finally {
    state.inFlight--;
  }
  if (ok) return "ok";
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

/** Seconds until the lockout ends, or 0 when password checks are allowed. */
export function lockoutRetryAfterS(now: number = Date.now()): number {
  return Math.max(0, Math.ceil((guardState().lockedUntil - now) / 1000));
}

/**
 * Everything a 429 needs, computed from one clock reading so the Retry-After header and the minutes in
 * the message always agree. The login form shows `message` as is, so it must stand on its own for the
 * owner, who may be locked out by someone else's guesses. At least one second: a 429 can also come from
 * the budget being taken by checks still in progress, just before the lockout starts.
 */
export function lockoutResponse(now: number = Date.now()): { retryAfterS: number; message: string } {
  const retryAfterS = Math.max(1, lockoutRetryAfterS(now));
  const minutes = Math.max(1, Math.ceil(retryAfterS / 60));
  const message = `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  return { retryAfterS, message };
}

/** Test helper: forget all recorded failures and lift any lockout. */
export function resetPasswordGuard(): void {
  holder.__writePasswordGuard = { failures: [], lockedUntil: 0, inFlight: 0 };
}
