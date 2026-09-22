import {
  checkPassword,
  createSessionToken,
  FAILURE_DELAY_MS,
  isAuthEnabled,
  isLoginThrottled,
  isSecureRequest,
  recordLoginFailure,
  sessionCookie,
  THROTTLED_DELAY_MS,
} from "@/lib/server/auth";
import { handle, HttpError, noContent, readJson } from "@/lib/server/http";
import { isLoginRequest } from "@/lib/server/validate";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exchange WRITE_PASSWORD for a session cookie. Public (it's how you get in), but still CSRF-checked.
 * Failures are slowed down: 250 ms each, and 2 s for every attempt after 5 failures in 10 minutes.
 */
export const POST = handle(
  async (req) => {
    if (!isAuthEnabled()) throw new HttpError("bad_request", "Sign-in isn't enabled on this server.");
    const { password } = await readJson(req, isLoginRequest);
    if (isLoginThrottled()) await sleep(THROTTLED_DELAY_MS);

    if (!checkPassword(password)) {
      recordLoginFailure();
      await sleep(FAILURE_DELAY_MS);
      const message = isLoginThrottled() ? "Too many attempts — wait a moment." : "Wrong password.";
      throw new HttpError("unauthorized", message);
    }
    return noContent({ "Set-Cookie": sessionCookie(createSessionToken(), isSecureRequest(req)) });
  },
  { public: true },
);
