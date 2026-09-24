import { cleanUsername, passwordError, usernameError } from "@/lib/account";
import { createSessionToken, isSecureRequest, readAuthState, sessionCookie } from "@/lib/server/auth";
import { handle, HttpError, noContent, readJson } from "@/lib/server/http";
import { hashPassword } from "@/lib/server/password-hash";
import { createAccount } from "@/lib/server/storage";
import { isSetupRequest } from "@/lib/server/validate";

const alreadySetUp = () =>
  new HttpError("already_set_up", "This server already has an account. Sign in with it instead.");

/**
 * First-run setup: creates the one account and signs this browser in (see docs/design-decisions.md#d30).
 * Public, because nobody can sign in yet, and only possible while no account exists: whoever finishes
 * first owns the server, and everyone after gets 409 already_set_up. CSRF-checked like every write.
 */
export const POST = handle(
  async (req) => {
    const state = await readAuthState();
    if (state.mode === "off") throw new HttpError("bad_request", "Sign-in isn't enabled on this server.");
    if (state.mode === "on") throw alreadySetUp();
    const { username, password } = await readJson(req, isSetupRequest);
    const invalid = usernameError(username) ?? passwordError(password);
    if (invalid) throw new HttpError("bad_request", invalid);
    const account = await createAccount(cleanUsername(username), await hashPassword(password));
    if (!account) throw alreadySetUp();
    console.warn(`[write] Created the account "${account.username}". Sign-in is on.`);
    const token = createSessionToken(account);
    return noContent({ "Set-Cookie": sessionCookie(token, isSecureRequest(req)) });
  },
  { public: true },
);
