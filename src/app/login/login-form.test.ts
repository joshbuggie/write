import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { loginErrorMessage } from "./login-form";

const rateLimited = (retryAfterSeconds: number | null, message?: string) =>
  new ApiError(
    429,
    "rate_limited",
    message ?? "Request failed (429).",
    message ? { error: { code: "rate_limited", message } } : null,
    retryAfterSeconds,
  );

describe("loginErrorMessage", () => {
  it("shows the server's own lockout message as is", () => {
    expect(loginErrorMessage(rateLimited(900, "Try again in 15 minutes."))).toBe("Try again in 15 minutes.");
  });

  it("names the wait from Retry-After when a 429 has no JSON body", () => {
    expect(loginErrorMessage(rateLimited(900))).toBe("Too many sign-in attempts. Try again in 15 minutes.");
    expect(loginErrorMessage(rateLimited(61))).toBe("Too many sign-in attempts. Try again in 2 minutes.");
    expect(loginErrorMessage(rateLimited(5))).toBe("Too many sign-in attempts. Try again in 1 minute.");
  });

  it("falls back to a generic wait without Retry-After", () => {
    expect(loginErrorMessage(rateLimited(null))).toBe("Too many sign-in attempts. Try again later.");
  });
});
