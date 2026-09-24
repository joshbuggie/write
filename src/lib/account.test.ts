import { describe, expect, it } from "vitest";
import {
  cleanUsername,
  passwordError,
  PASSWORD_MAX,
  sameUsername,
  usernameError,
  USERNAME_MAX,
} from "./account";

describe("account rules", () => {
  it("accepts ordinary usernames, trimmed", () => {
    expect(usernameError("sam")).toBeNull();
    expect(usernameError("  Sam Lee  ")).toBeNull();
    expect(cleanUsername("  Sam Lee  ")).toBe("Sam Lee");
    expect(usernameError("x".repeat(USERNAME_MAX))).toBeNull();
  });

  it("refuses empty, overlong and unreadable usernames", () => {
    expect(usernameError("   ")).toBe("Enter a username.");
    expect(usernameError("x".repeat(USERNAME_MAX + 1))).toMatch(/at most/);
    expect(usernameError("sam\u0000")).toMatch(/control/);
    expect(usernameError("sa\nm")).toMatch(/control/);
  });

  it("needs passwords of 8 characters or more, spaces included", () => {
    expect(passwordError("1234567")).toMatch(/at least 8/);
    expect(passwordError("four words at once")).toBeNull();
    expect(passwordError("        ")).toBeNull();
    expect(passwordError("x".repeat(PASSWORD_MAX + 1))).toMatch(/at most/);
  });

  it("matches usernames regardless of case, spacing and Unicode form", () => {
    expect(sameUsername("Sam", " sam ")).toBe(true);
    expect(sameUsername("José", "josé")).toBe(true);
    expect(sameUsername("sam", "samuel")).toBe(false);
  });
});
