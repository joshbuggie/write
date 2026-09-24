import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth/auth-card";
import { StorageUnavailable } from "@/components/shell/storage-unavailable";
import { loginHref } from "@/lib/routes";
import { readAuthState, type AuthState } from "@/lib/server/auth";
import { StorageError } from "@/lib/server/storage";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up write" };

/**
 * First-run setup (see docs/design-decisions.md#d30): until an account exists, every page comes here. Once
 * one does, this page only forwards to /login, so it can't be used to replace the account.
 */
export default async function SetupPage() {
  // Whether an account exists is only known at runtime, so this page must never be prerendered.
  await connection();
  let state: AuthState;
  try {
    state = await readAuthState();
  } catch (err) {
    if (err instanceof StorageError) return <StorageUnavailable message={err.message} folder="config" />;
    throw err;
  }
  if (state.mode === "off") redirect("/");
  if (state.mode === "on") redirect(loginHref());

  return (
    <AuthCard
      intro={
        <>
          <p>Create the account for this server. You&apos;ll sign in with it on every device.</p>
          <p className="mt-2">Until you do, anyone who opens write here can create it instead.</p>
        </>
      }
    >
      <SetupForm />
    </AuthCard>
  );
}
