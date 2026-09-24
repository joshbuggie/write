import { randomBytes } from "node:crypto";
import path from "node:path";
import { isPasswordHash } from "../password-hash";
import { getConfigDir } from "./config";
import { readConfigText, writeConfigText } from "./config-files";
import { StorageError } from "./errors";
import { withWriteLock } from "./mutex";

/**
 * The one account that signs in to write, in `<configDir>/account.json` (docs/design-decisions.md#d30):
 * `{ "version": 1, "username", "passwordHash", "sessionSecret" }`. No file means setup hasn't happened yet,
 * so a file that exists but can't be read must never look like "no account": that would let the next
 * visitor create a new one.
 */

const FILE_VERSION = 1;

export interface StoredAccount {
  username: string;
  /** From hashPassword(): scrypt with its parameters and salt. */
  passwordHash: string;
  /** Signs session cookies. A new account gets a new secret, so older cookies stop working. */
  sessionSecret: string;
}

const accountFile = async () => path.join(await getConfigDir(), "account.json");
const serialize = (account: StoredAccount) =>
  JSON.stringify({ version: FILE_VERSION, ...account }, null, 2) + "\n";
const newSecret = () => randomBytes(32).toString("base64url");

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function parseAccount(text: string, file: string): StoredAccount {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const { username, passwordHash, sessionSecret } = v;
  if (
    v.version !== FILE_VERSION ||
    !nonEmpty(username) ||
    !nonEmpty(passwordHash) ||
    !isPasswordHash(passwordHash) ||
    !nonEmpty(sessionSecret) ||
    sessionSecret.length < 32
  ) {
    throw new StorageError(
      "storage_unavailable",
      `${file} isn't a valid write account file. Restore it from a backup, or delete it and open write to create the account again.`,
    );
  }
  return { username, passwordHash, sessionSecret };
}

/**
 * The saved account, or null before setup. Throws storage_unavailable when the file can't be read or
 * isn't valid, never null, so a broken file keeps everyone out instead of reopening setup.
 */
export async function readAccount(): Promise<StoredAccount | null> {
  const file = await accountFile();
  const text = await readConfigText(file);
  return text === null ? null : parseAccount(text, file);
}

/**
 * Saves the account made at setup, with a fresh session secret, and returns it. Returns null when an
 * account already exists: the file is created without ever replacing one, so two people finishing setup
 * at the same moment can't both win. The write lock matters where hard links don't work (some network
 * shares and Docker volume drivers): there the no-clobber write falls back to check-then-rename, which
 * two setups in flight could both pass.
 */
export function createAccount(username: string, passwordHash: string): Promise<StoredAccount | null> {
  return withWriteLock(async () => {
    const account: StoredAccount = { username, passwordHash, sessionSecret: newSecret() };
    try {
      await writeConfigText(await accountFile(), serialize(account), { noClobber: true });
    } catch (err) {
      if (err instanceof StorageError && err.code === "name_taken") return null;
      throw err;
    }
    return account;
  });
}

/**
 * Replaces the password, and the session secret with it, so every other signed-in device is signed out.
 * `checkedHash` is the hash the caller verified the current password against: if the file holds another
 * one by now (changed from another device in the meantime), nothing is written and this returns null.
 */
export function changePassword(checkedHash: string, newHash: string): Promise<StoredAccount | null> {
  return withWriteLock(async () => {
    const account = await readAccount();
    if (!account || account.passwordHash !== checkedHash) return null;
    const next: StoredAccount = { ...account, passwordHash: newHash, sessionSecret: newSecret() };
    await writeConfigText(await accountFile(), serialize(next));
    return next;
  });
}
