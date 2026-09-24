import type React from "react";

/**
 * The centered card around the sign-in and setup forms, padded clear of the notch and home indicator.
 * A server component: it only lays out what the page passes in.
 */
export function AuthCard({ intro, children }: { intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6">
        <h1 className="mb-1 text-[22px] font-semibold tracking-tight text-ink">write</h1>
        <div className="mb-6 text-[14px] text-muted">{intro}</div>
        {children}
      </div>
    </main>
  );
}
