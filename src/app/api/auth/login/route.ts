import {
  checkCredentials,
  createSessionToken,
  isSecureRequest,
  readAuthState,
  sessionCookie,
} from "@/lib/server/auth";
import { handle, HttpError, noContent, rateLimitedError, readJson, SETUP_FIRST } from "@/lib/server/http";
import { isLoginRequest } from "@/lib/server/validate";

/**
 * Exchange the username and password for a session cookie. Public (it's how you get in), but still
 * CSRF-checked. Wrong passwords count against the shared brute-force budget; once it is spent every attempt
 * gets an immediate 429 until the lockout ends (no sleeping, so concurrency can't buy extra guesses).
 */
export const POST = handle(
  async (req) => {
    const state = await readAuthState();
    if (state.mode === "off") throw new HttpError("bad_request", "Sign-in isn't enabled on this server.");
    if (state.mode === "setup") throw new HttpError("unauthorized", SETUP_FIRST);
    const { username, password } = await readJson(req, isLoginRequest);
    const status = await checkCredentials(state.account, username, password);
    if (status === "rate_limited") throw rateLimitedError();
    if (status === "unauthorized") throw new HttpError("unauthorized", "Wrong username or password.");
    const token = createSessionToken(state.account);
    return noContent({ "Set-Cookie": sessionCookie(token, isSecureRequest(req)) });
  },
  { public: true },
);
