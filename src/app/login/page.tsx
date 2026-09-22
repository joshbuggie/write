import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";
import { safeNextPath } from "@/lib/routes";
import { isAuthEnabled, verifySessionToken } from "@/lib/server/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Sign-in screen, only meaningful when WRITE_PASSWORD is set. Without a password (or when already signed in)
 * it just forwards you on, so bookmarking /login is harmless.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Auth is configured at runtime, so this page must never be prerendered with build-time env.
  await connection();
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;

  if (!isAuthEnabled()) redirect("/");
  if (verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value)) redirect(safeNextPath(nextPath));

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6">
        <h1 className="mb-1 text-[22px] font-semibold tracking-tight text-ink">write</h1>
        <p className="mb-6 text-[14px] text-muted">Enter the password to open your notes.</p>
        <LoginForm next={nextPath} />
      </div>
    </main>
  );
}
