"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { passwordError, usernameError } from "@/lib/account";
import { api, isApiError } from "@/lib/api-client";
import { loginHref } from "@/lib/routes";

type Field = "username" | "password" | "confirm";
type Errors = Partial<Record<Field | "form", string>>;

/** What's wrong with the form, per field, using the same rules as the server. Empty when it can be sent. */
export function setupErrors(username: string, password: string, confirm: string): Errors {
  const errors: Errors = {};
  const badUsername = usernameError(username);
  const badPassword = passwordError(password);
  if (badUsername) errors.username = badUsername;
  if (badPassword) errors.password = badPassword;
  else if (confirm !== password) errors.confirm = "The passwords don’t match.";
  return errors;
}

/** A failed setup request as a short message, shown under the form. */
export function setupErrorMessage(err: unknown): string {
  if (isApiError(err, "network")) return "Can't reach the server.";
  const serverMessage = isApiError(err) ? err.body?.error?.message : undefined;
  return serverMessage || "Couldn't create the account. Try again.";
}

/**
 * Creates the account and signs this browser in. The password is typed twice, because a typo here would
 * lock the owner out of their own server. If someone else finished setup first, it goes to sign-in.
 */
export function SetupForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = setupErrors(username, password, confirm);
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) return;
    setPending(true);
    try {
      await api.setup({ username, password });
      router.replace("/");
      router.refresh();
    } catch (err) {
      // Someone finished setup first (another tab, or another person): their account stands.
      if (isApiError(err, "already_set_up")) {
        router.replace(loginHref());
        return;
      }
      setErrors({ form: setupErrorMessage(err) });
      setPending(false);
    }
  }

  const clear = (field: Field) => {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

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
        onChange={(e) => {
          setUsername(e.target.value);
          clear("username");
        }}
        error={errors.username}
        className="w-full"
      />
      <TextField
        label="Password"
        name="new-password"
        type="password"
        autoComplete="new-password"
        enterKeyHint="next"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          clear("password");
        }}
        error={errors.password}
        className="w-full"
      />
      <TextField
        label="Confirm password"
        name="confirm-password"
        type="password"
        autoComplete="new-password"
        enterKeyHint="go"
        value={confirm}
        onChange={(e) => {
          setConfirm(e.target.value);
          clear("confirm");
        }}
        error={errors.confirm}
        className="w-full"
      />
      {errors.form && (
        <p role="alert" className="text-[13px] text-danger">
          {errors.form}
        </p>
      )}
      <Button type="submit" variant="primary" pending={pending} className="w-full">
        Create account
      </Button>
    </form>
  );
}
