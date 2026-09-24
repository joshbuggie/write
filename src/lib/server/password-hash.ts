import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt, so no dependency (docs/design-decisions.md#d30). The
 * parameters are stored with each hash, so the default cost can rise later without breaking old accounts.
 */

export interface ScryptCost {
  N: number;
  r: number;
  p: number;
}

/** 32 MiB and roughly 50–100 ms per check: slow for guessing, fine for a Raspberry Pi signing in. */
export const DEFAULT_COST: ScryptCost = { N: 2 ** 15, r: 8, p: 1 };

const KEY_BYTES = 32;
const SALT_BYTES = 16;
const FORMAT = /^scrypt\$(\d{1,8})\$(\d{1,3})\$(\d{1,3})\$([\w-]{16,})\$([\w-]{32,})$/;

/** Whether `stored` looks like a hash from hashPassword(), for checking the account file when it's read. */
export const isPasswordHash = (stored: string) => FORMAT.test(stored);

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  // scrypt needs about 128 * N * r bytes; Node refuses anything over 32 MiB unless maxmem says otherwise.
  const options: ScryptOptions = { ...cost, maxmem: 256 * cost.N * cost.r + 1024 * 1024 };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFC"), salt, KEY_BYTES, options, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** "scrypt$<N>$<r>$<p>$<salt>$<hash>", base64url. Passwords are NFC-normalized, like usernames. */
export async function hashPassword(password: string, cost: ScryptCost = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, cost);
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/**
 * Whether `password` matches a hash from hashPassword(), compared in constant time. Throws for a hash it
 * can't use, including parameters outside sane bounds, so a hand-edited account file can't make every
 * sign-in allocate gigabytes.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = FORMAT.exec(stored);
  const [N, r, p] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
  const powerOfTwo = N > 1 && (N & (N - 1)) === 0;
  if (!match || !powerOfTwo || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) {
    throw new Error("The saved password hash isn't one write can check.");
  }
  const expected = Buffer.from(match[5], "base64url");
  const key = await derive(password, Buffer.from(match[4], "base64url"), { N, r, p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
