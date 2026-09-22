import Link from "next/link";
import { LIBRARY_HREF } from "@/lib/routes";

/** A note URL that points at nothing: renamed, moved or deleted, possibly outside write. */
export default function NoteNotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 pt-[env(safe-area-inset-top)] text-center">
      <h1 className="text-[20px] font-semibold text-ink">This note doesn’t exist</h1>
      <p className="mt-2 max-w-sm text-[15px] text-muted">
        It may have been renamed, moved or deleted, here or by another app.
      </p>
      <Link
        href={LIBRARY_HREF}
        className="mt-6 inline-flex h-11 items-center rounded-md px-3 text-[15px] text-accent hover:bg-hover md:h-9"
      >
        Back to notes
      </Link>
    </div>
  );
}
