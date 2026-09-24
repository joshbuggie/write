import { SESSION_COOKIE } from "@/lib/constants";
import { createSessionToken } from "./auth";
import { hashPassword } from "./password-hash";
import { createAccount, type StoredAccount } from "./storage";

/**
 * Test helpers for signed-in requests. Call inside withTempDataDir(), so the account lands in that test's
 * own config folder. The hash uses a tiny scrypt cost: tests check the logic, not the hashing time.
 */

/** Creates the account (sign-in on, setup done) and returns it. */
export async function setUpTestAccount(username = "owner", password = "pw"): Promise<StoredAccount> {
  const account = await createAccount(username, await hashPassword(password, { N: 1024, r: 8, p: 1 }));
  if (!account) throw new Error("setUpTestAccount: an account already exists");
  return account;
}

/** A Cookie header value with a fresh session for `account`. */
export const sessionCookieFor = (account: StoredAccount, now?: number) =>
  `${SESSION_COOKIE}=${createSessionToken(account, now)}`;
