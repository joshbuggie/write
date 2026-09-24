import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { changePasswordErrors, changePasswordFailure } from "./account-section";

const apiError = (status: number, code: "wrong_password" | "rate_limited", message: string) =>
  new ApiError(status, code, message, { error: { code, message } });

describe("changePasswordErrors", () => {
  it("is empty when the form can be sent", () => {
    expect(changePasswordErrors("old", "new password", "new password")).toEqual({});
  });

  it("names each field that needs fixing", () => {
    expect(changePasswordErrors("", "short", "")).toEqual({
      current: "Enter your current password.",
      next: "Use at least 8 characters.",
    });
    expect(changePasswordErrors("old", "new password", "new pasword")).toEqual({
      confirm: "The passwords don’t match.",
    });
  });
});

describe("changePasswordFailure", () => {
  it("puts a wrong current password on its field and anything else under the form", () => {
    expect(changePasswordFailure(apiError(403, "wrong_password", "The current password is wrong."))).toEqual({
      current: "The current password is wrong.",
    });
    const locked = "Too many sign-in attempts. Try again in 15 minutes.";
    expect(changePasswordFailure(apiError(429, "rate_limited", locked))).toEqual({ form: locked });
    expect(changePasswordFailure(new ApiError(0, "network", "offline"))).toEqual({
      form: "Can't reach the server.",
    });
  });
});
