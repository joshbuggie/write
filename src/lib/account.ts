/**
 * Rules for the one account that signs in to write (docs/design-decisions.md#d30), shared by the setup form
 * and the server so both say the same thing about the same input.
 */

export const USERNAME_MAX = 64;
export const PASSWORD_MIN = 8;
/** Long enough for any passphrase or password manager, short enough that hashing it stays cheap. */
export const PASSWORD_MAX = 1024;

/** Control characters can't be typed, and would make the username unreadable in logs and files. */
const CONTROL = /\p{Cc}/u;

/** The username as it is saved: trimmed, and in NFC so the same letters always compare equal. */
export const cleanUsername = (username: string) => username.trim().normalize("NFC");

/**
 * Why a username can't be used, or null when it can. Only length and control characters are refused:
 * there is one account, so the username never has to be unique or fit a URL.
 */
export function usernameError(username: string): string | null {
  const clean = cleanUsername(username);
  if (!clean) return "Enter a username.";
  if (clean.length > USERNAME_MAX) return `Use at most ${USERNAME_MAX} characters.`;
  if (CONTROL.test(clean)) return "The username can't contain control characters.";
  return null;
}

/** Why a new password can't be used, or null when it can. Spaces count: passphrases are welcome. */
export function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

/**
 * Usernames match regardless of case, because phones capitalize the first letter of a field and nobody
 * expects "Sam" and "sam" to be different people on a one-account server.
 */
export function sameUsername(a: string, b: string): boolean {
  return cleanUsername(a).toLowerCase() === cleanUsername(b).toLowerCase();
}
