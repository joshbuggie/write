import { cn } from "@/lib/cn";

/**
 * The text column of the note screen (§10.2). Shared by the note view, the desktop toolbar and the
 * loading skeletons so everything lines up with the text at every breakpoint.
 */
export const TEXT_COLUMN =
  "mx-auto w-full max-w-[42rem] px-[max(1rem,env(safe-area-inset-left))] md:px-10 lg:max-w-[44rem] xl:max-w-[46rem]";

/** Widths of the placeholder lines, so the skeleton reads like a paragraph rather than a barcode. */
const LINE_WIDTHS = ["w-[92%]", "w-full", "w-[86%]", "w-[95%]", "w-[78%]", "w-[40%]"];

/**
 * Six lines of body text at the real type metrics (17px / 1.65). Stands in while the editor chunk
 * loads (next/dynamic `loading`) and inside the route's loading.tsx, so nothing jumps when text appears.
 */
export function EditorSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pt-[0.85em] text-[17px] xl:text-[18px]", className)}>
      {LINE_WIDTHS.map((width, i) => (
        <div key={i} className="flex h-[1.65em] items-center xl:h-[1.7em]">
          <div className={cn("h-[0.8em] rounded bg-hover motion-safe:animate-pulse", width)} />
        </div>
      ))}
    </div>
  );
}
