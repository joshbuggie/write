import { passwordError } from "@/lib/account";
import {
  attemptPassword,
  createSessionToken,
  isSecureRequest,
  readAuthState,
  sessionCookie,
} from "@/lib/server/auth";
import { handle, HttpError, noContent, rateLimitedError, readJson } from "@/lib/server/http";
import { hashPassword, verifyPassword } from "@/lib/server/password-hash";
import { changePassword } from "@/lib/server/storage";
import { isChangePasswordRequest } from "@/lib/server/validate";

/**
 * Change the password from Settings (see docs/design-decisions.md#d30). Signed in, and the current password
 * again, so an unlocked device left open can't lock its owner out; that check counts against the same
 * brute-force budget as sign-in. The session secret changes with the password, so every other device is
 * signed out, and this browser gets a fresh cookie so it stays in.
 */
export const POST = handle(async (req) => {
  const state = await readAuthState();
  if (state.mode !== "on") throw new HttpError("bad_request", "Sign-in is off on this server.");
  const { currentPassword, newPassword } = await readJson(req, isChangePasswordRequest);
  const invalid = passwordError(newPassword);
  if (invalid) throw new HttpError("bad_request", invalid);

  const { passwordHash } = state.account;
  const status = await attemptPassword(() => verifyPassword(currentPassword, passwordHash));
  if (status === "rate_limited") throw rateLimitedError();
  if (status === "unauthorized") throw new HttpError("wrong_password", "The current password is wrong.");

  const account = await changePassword(passwordHash, await hashPassword(newPassword));
  if (!account) {
    throw new HttpError(
      "wrong_password",
      "The password was just changed on another device. Use the new one.",
    );
  }
  console.warn("[write] The password was changed. Other devices are signed out.");
  return noContent({ "Set-Cookie": sessionCookie(createSessionToken(account), isSecureRequest(req)) });
});
