import {
  attemptPassword,
  createSessionToken,
  isAuthEnabled,
  isSecureRequest,
  sessionCookie,
} from "@/lib/server/auth";
import { handle, HttpError, noContent, rateLimitedError, readJson } from "@/lib/server/http";
import { isLoginRequest } from "@/lib/server/validate";

/**
 * Exchange WRITE_PASSWORD for a session cookie. Public (it's how you get in), but still CSRF-checked.
 * Wrong passwords count against the shared brute-force budget; once it is spent every attempt gets an
 * immediate 429 until the lockout ends (no sleeping, so concurrency can't buy extra guesses).
 */
export const POST = handle(
  async (req) => {
    if (!isAuthEnabled()) throw new HttpError("bad_request", "Sign-in isn't enabled on this server.");
    const { password } = await readJson(req, isLoginRequest);
    const status = attemptPassword(password);
    if (status === "rate_limited") throw rateLimitedError();
    if (status === "unauthorized") throw new HttpError("unauthorized", "Wrong password.");
    return noContent({ "Set-Cookie": sessionCookie(createSessionToken(), isSecureRequest(req)) });
  },
  { public: true },
);
