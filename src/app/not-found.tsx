import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { LIBRARY_HREF } from "@/lib/routes";

/**
 * 404 for every URL no route matches, /notes/a/b/c included; it renders outside the notes shell.
 * A note URL that matches the route but names a missing note gets notes/[folder]/[note]/not-found.tsx.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">Page not found</h1>
        <p className="mt-1 text-[15px] text-muted">There&apos;s nothing at this address.</p>
      </div>
      <Link href={LIBRARY_HREF} className={buttonStyles("secondary")}>
        Go to your notes
      </Link>
    </main>
  );
}
