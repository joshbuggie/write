"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { api, isApiError } from "@/lib/api-client";
import { safeNextPath } from "@/lib/routes";

/** "Try again in N minutes." for a wait in seconds, rounded up like the server's own lockout message. */
function waitHint(seconds: number | null): string {
  if (seconds === null) return "Try again later.";
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/**
 * Turns a failed login into a short, human message. The server's 401/429 text says wrong vs locked out;
 * during a lockout it names the wait ("Try again in 15 minutes.", the same value as Retry-After). A 429
 * without that JSON body (a reverse proxy's own rate limit, say) still names the wait from Retry-After.
 */
export function loginErrorMessage(err: unknown): string {
  // Only the server's own JSON message is shown; a body-less response gets the generic wording.
  const serverMessage = isApiError(err) ? err.body?.error?.message : undefined;
  if (isApiError(err, "unauthorized")) return serverMessage || "Wrong username or password.";
  if (isApiError(err, "rate_limited"))
    return serverMessage || `Too many sign-in attempts. ${waitHint(err.retryAfterSeconds)}`;
  if (isApiError(err, "network")) return "Can't reach the server.";
  return "Couldn't sign in. Try again.";
}

/**
 * Username and password form, named so password managers fill it. On success it replaces /login in history
 * (so Back doesn't return here) and refreshes so the server components re-render with the new session
 * cookie.
 */
export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.login({ username, password });
      router.replace(safeNextPath(next));
      router.refresh();
    } catch (err) {
      // 400 means sign-in was switched off since this page loaded: nothing to sign in to.
      if (isApiError(err, "bad_request")) {
        router.replace(safeNextPath(next));
        return;
      }
      setError(loginErrorMessage(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <TextField
        label="Username"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="next"
        autoFocus
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="w-full"
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        enterKeyHint="go"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={error}
        className="w-full"
      />
      <Button type="submit" variant="primary" pending={pending} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
