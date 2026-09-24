"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { passwordError } from "@/lib/account";
import { api, isApiError } from "@/lib/api-client";

type Field = "current" | "next" | "confirm";
type Errors = Partial<Record<Field | "form", string>>;

/** What's wrong with the password form, per field, before anything is sent. Empty when it can be sent. */
export function changePasswordErrors(current: string, next: string, confirm: string): Errors {
  const errors: Errors = {};
  if (!current) errors.current = "Enter your current password.";
  const badNext = passwordError(next);
  if (badNext) errors.next = badNext;
  else if (confirm !== next) errors.confirm = "The passwords don’t match.";
  return errors;
}

/** Where a failed change is shown: a wrong current password belongs to that field, the rest to the form. */
export function changePasswordFailure(err: unknown): Errors {
  const serverMessage = isApiError(err) ? err.body?.error?.message : undefined;
  if (isApiError(err, "wrong_password"))
    return { current: serverMessage || "The current password is wrong." };
  if (isApiError(err, "network")) return { form: "Can't reach the server." };
  return { form: serverMessage || "Couldn't change the password. Try again." };
}

/**
 * Settings' Account section: who is signed in, and changing the password. It asks for the current
 * password (a device left signed in shouldn't be enough to lock the owner out) and the new one twice.
 * The server signs out every other device and keeps this one signed in.
 */
export function AccountSection({ username }: { username: string }) {
  const headingId = useId();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<Field, string>>({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setValues({ current: "", next: "", confirm: "" });
    setErrors({});
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const invalid = changePasswordErrors(values.current, values.next, values.confirm);
    setErrors(invalid);
    if (Object.keys(invalid).length > 0) return;
    setPending(true);
    try {
      await api.changePassword({ currentPassword: values.current, newPassword: values.next });
      toast.show({ message: "Password changed. Other devices are signed out." });
      close();
    } catch (err) {
      const failure = changePasswordFailure(err);
      setErrors(failure);
      if (failure.current) currentRef.current?.focus();
    } finally {
      setPending(false);
    }
  }

  const field = (name: Field) => ({
    value: values[name],
    error: errors[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setValues((v) => ({ ...v, [name]: value }));
      if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
    },
  });

  return (
    <section aria-labelledby={headingId} className="mb-5 border-b border-line pb-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-[15px] font-semibold tracking-tight">
            Account
          </h3>
          <p className="mt-0.5 truncate text-[13px] leading-relaxed text-muted">
            Signed in as <span className="font-medium text-ink">{username}</span>
          </p>
        </div>
        {!open && (
          <Button size="sm" onClick={() => setOpen(true)}>
            Change password
          </Button>
        )}
      </div>
      {open && (
        <form noValidate onSubmit={(e) => void submit(e)} className="mt-4 flex flex-col gap-3.5">
          {/* Lets password managers file the new password under the right account. */}
          <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
          <TextField
            ref={currentRef}
            label="Current password"
            type="password"
            autoComplete="current-password"
            autoFocus
            enterKeyHint="next"
            {...field("current")}
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            enterKeyHint="next"
            {...field("next")}
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            enterKeyHint="go"
            {...field("confirm")}
          />
          <p className="text-[12.5px] leading-relaxed text-subtle">
            At least 8 characters. Your other devices will be signed out; this one stays signed in.
          </p>
          {errors.form && (
            <p role="alert" className="text-[13px] text-danger">
              {errors.form}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" pending={pending}>
              Change password
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
