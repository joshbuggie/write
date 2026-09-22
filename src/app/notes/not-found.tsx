import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { LIBRARY_HREF } from "@/lib/routes";

/** Shown inside the shell when a notes URL doesn't match anything (e.g. a note renamed in another app). */
export default function NotesNotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div>
        <h1 className="text-[18px] font-semibold tracking-tight">Nothing here</h1>
        <p className="mt-1 text-[15px] text-muted md:text-[14px]">
          This note may have been renamed, moved or deleted.
        </p>
      </div>
      <Link href={LIBRARY_HREF} className={buttonStyles("secondary")}>
        Back to notes
      </Link>
    </div>
  );
}
