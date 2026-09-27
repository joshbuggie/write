"use client";

import { useHydrated } from "@/lib/use-hydrated";

/**
 * Says why the sign-in button is still disabled when the page's scripts are slow or never arrive (Safari
 * behind iCloud Private Relay's notice, say). It is in the server HTML and goes away once React hydrates.
 * The animation keeps it hidden for a normal load; when the stylesheet is blocked too, it shows at once,
 * which is exactly when it is needed (docs/design-decisions.md#d30).
 */
export function LoadingHint() {
  const hydrated = useHydrated();
  if (hydrated) return null;
  return (
    <p className="animate-appear-late text-center text-[13px] text-balance text-muted">
      Still loading. If this doesn’t go away, reload the page.
    </p>
  );
}
