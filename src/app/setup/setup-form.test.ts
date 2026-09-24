import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { setupErrorMessage, setupErrors } from "./setup-form";

describe("setupErrors", () => {
  it("is empty for a usable username and matching passwords", () => {
    expect(setupErrors("sam", "long enough", "long enough")).toEqual({});
  });

  it("names each field that needs fixing", () => {
    expect(setupErrors("", "short", "short")).toEqual({
      username: "Enter a username.",
      password: "Use at least 8 characters.",
    });
    expect(setupErrors("sam", "long enough", "long enuogh")).toEqual({
      confirm: "The passwords don’t match.",
    });
  });
});

describe("setupErrorMessage", () => {
  it("shows the server's message, or a plain fallback", () => {
    const refused = new ApiError(400, "bad_request", "x", {
      error: { code: "bad_request", message: "Use at least 8 characters." },
    });
    expect(setupErrorMessage(refused)).toBe("Use at least 8 characters.");
    expect(setupErrorMessage(new ApiError(0, "network", "offline", null))).toBe("Can't reach the server.");
    expect(setupErrorMessage(new Error("?"))).toBe("Couldn't create the account. Try again.");
  });
});
