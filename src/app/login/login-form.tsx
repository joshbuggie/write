"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { api, isApiError } from "@/lib/api-client";
import { safeNextPath } from "@/lib/routes";

/**
 * Turns a failed login into a short, human message. The server's 401/429 text says wrong vs locked out;
 * during a lockout it names the wait ("Try again in 15 minutes.", the same value as Retry-After).
 */
function loginErrorMessage(err: unknown): string {
  // Only the server's own JSON message is shown; a body-less response gets the generic wording.
  const serverMessage = isApiError(err) ? err.body?.error?.message : undefined;
  if (isApiError(err, "unauthorized")) return serverMessage || "Wrong password.";
  if (isApiError(err, "rate_limited")) return serverMessage || "Too many sign-in attempts. Try again later.";
  if (isApiError(err, "network")) return "Can't reach the server.";
  return "Couldn't sign in. Try again.";
}

/**
 * Password form. On success it replaces /login in history (so Back doesn't return here) and refreshes
 * so the server components re-render with the new session cookie.
 */
export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setError("Enter the password.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.login(password);
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
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        enterKeyHint="go"
        autoFocus
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
