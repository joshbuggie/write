import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth/auth-card";
import { StorageUnavailable } from "@/components/shell/storage-unavailable";
import { SESSION_COOKIE } from "@/lib/constants";
import { safeNextPath, SETUP_HREF } from "@/lib/routes";
import { readAuthState, verifySessionToken, type AuthState } from "@/lib/server/auth";
import { StorageError } from "@/lib/server/storage";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Sign-in screen. With sign-in off, or when already signed in, it forwards you on, so bookmarking /login is
 * harmless; before first-run setup it sends you to /setup. When the account file can't be read it explains
 * that instead (the proxy sends every page here in that case).
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Auth is configured at runtime, so this page must never be prerendered with build-time env.
  await connection();
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;

  let state: AuthState;
  try {
    state = await readAuthState();
  } catch (err) {
    if (err instanceof StorageError) return <StorageUnavailable message={err.message} folder="config" />;
    throw err;
  }
  if (state.mode === "off") redirect("/");
  if (state.mode === "setup") redirect(SETUP_HREF);
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (verifySessionToken(token, state.account)) redirect(safeNextPath(nextPath));

  return (
    <AuthCard intro="Sign in to open your notes.">
      <LoginForm next={nextPath} />
    </AuthCard>
  );
}
