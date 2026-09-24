import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attemptPassword,
  LOCKOUT_MS,
  lockoutResponse,
  lockoutRetryAfterS,
  resetPasswordGuard,
} from "./password-guard";

const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const right = async () => true;
const wrong = async () => false;

beforeEach(() => void vi.spyOn(console, "warn").mockImplementation(() => {})); // lockout log line
afterEach(() => resetPasswordGuard());

describe("attemptPassword", () => {
  it("answers ok or unauthorized from the check", async () => {
    expect(await attemptPassword(right, NOW)).toBe("ok");
    expect(await attemptPassword(wrong, NOW)).toBe("unauthorized");
  });

  it("locks every password check out after 10 failures, even the right password", async () => {
    for (let i = 0; i < 10; i++) expect(await attemptPassword(wrong, NOW + i)).toBe("unauthorized");
    expect(await attemptPassword(wrong, NOW + 10)).toBe("rate_limited");
    expect(await attemptPassword(right, NOW + 10)).toBe("rate_limited");
    expect(lockoutRetryAfterS(NOW + 9)).toBe(LOCKOUT_MS / 1000);
    expect(lockoutResponse(NOW + 9)).toEqual({
      retryAfterS: LOCKOUT_MS / 1000,
      message: "Too many sign-in attempts. Try again in 15 minutes.",
    });
    // Minutes round up from the same seconds as Retry-After, and never say "0 minutes".
    expect(lockoutResponse(NOW + 9 + LOCKOUT_MS - 61_000).message).toBe(
      "Too many sign-in attempts. Try again in 2 minutes.",
    );
    expect(lockoutResponse(NOW + 9 + LOCKOUT_MS - 1_000)).toEqual({
      retryAfterS: 1,
      message: "Too many sign-in attempts. Try again in 1 minute.",
    });

    // After the lockout the budget starts over.
    const after = NOW + 9 + LOCKOUT_MS;
    expect(lockoutRetryAfterS(after)).toBe(0);
    expect(await attemptPassword(right, after)).toBe("ok");
    for (let i = 0; i < 9; i++) expect(await attemptPassword(wrong, after + i)).toBe("unauthorized");
    expect(await attemptPassword(right, after + 9)).toBe("ok");
  });

  it("forgets failures older than the window, but not because of a success", async () => {
    for (let i = 0; i < 9; i++) await attemptPassword(wrong, NOW);
    expect(await attemptPassword(right, NOW)).toBe("ok");
    expect(await attemptPassword(wrong, NOW + 1)).toBe("unauthorized");
    expect(await attemptPassword(right, NOW + 2)).toBe("rate_limited");

    resetPasswordGuard();
    for (let i = 0; i < 9; i++) await attemptPassword(wrong, NOW);
    expect(await attemptPassword(wrong, NOW + 15 * 60 * 1000)).toBe("unauthorized");
    expect(await attemptPassword(right, NOW + 15 * 60 * 1000)).toBe("ok");
  });

  it("gives concurrent checks only the budget that is left, never more", async () => {
    let checks = 0;
    const slowWrong = async () => {
      checks++;
      await new Promise((r) => setTimeout(r, 5));
      return false;
    };
    for (let i = 0; i < 3; i++) await attemptPassword(wrong, NOW);
    const results = await Promise.all(Array.from({ length: 20 }, () => attemptPassword(slowWrong, NOW)));
    expect(checks).toBe(7);
    expect(results.filter((r) => r === "unauthorized")).toHaveLength(7);
    expect(results.filter((r) => r === "rate_limited")).toHaveLength(13);
  });

  it("hands a successful check's reserved unit back", async () => {
    await Promise.all(Array.from({ length: 10 }, () => attemptPassword(right, NOW)));
    expect(await attemptPassword(wrong, NOW)).toBe("unauthorized");
  });

  it("shares one budget between separately bundled copies of this module (proxy vs routes)", async () => {
    vi.resetModules();
    const proxyCopy = await import("./password-guard");
    vi.resetModules();
    const routeCopy = await import("./password-guard");
    expect(proxyCopy).not.toBe(routeCopy);
    for (let i = 0; i < 10; i++) await proxyCopy.attemptPassword(wrong, NOW);
    expect(await routeCopy.attemptPassword(right, NOW)).toBe("rate_limited");
  });
});
