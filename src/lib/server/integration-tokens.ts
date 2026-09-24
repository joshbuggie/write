import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { TOKEN_PREFIX } from "@/lib/integrations";

/**
 * Integration tokens (docs/design-decisions.md#d31). A token is 32 random bytes, so a plain SHA-256 is
 * enough to store it: there is nothing to guess, unlike a password, and no slow hash is needed. Only
 * the hash and the last four characters are ever saved.
 */

/** A new token: "wrt_" + 43 base64url characters. */
export const newToken = () => TOKEN_PREFIX + randomBytes(32).toString("base64url");

/** Hex SHA-256 of the token, as saved in integrations.json. */
export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Last four characters, shown in the dialog to tell tokens apart. */
export const tokenHint = (token: string) => token.slice(-4);

/** Constant-time comparison of two hex hashes of the same length. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
