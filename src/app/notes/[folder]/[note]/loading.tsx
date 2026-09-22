import { EditorSkeleton, TEXT_COLUMN } from "@/components/editor/editor-skeleton";

/**
 * Shown while a note loads on the server: an empty header bar, a title bar and six body lines at the
 * real metrics, so the text doesn't jump when it arrives.
 */
export default function NoteLoading() {
  return (
    <div aria-busy="true" aria-label="Loading note">
      <div className="sticky top-0 border-b border-line bg-canvas/85 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="h-11 md:h-12" />
      </div>
      <div className={TEXT_COLUMN}>
        <div className="pt-6 md:pt-14">
          <div className="flex h-[32px] items-center md:h-[40px] xl:h-[42px]">
            <div className="h-[0.8em] w-1/2 rounded bg-hover text-[26px] motion-safe:animate-pulse md:text-[32px] xl:text-[34px]" />
          </div>
        </div>
        <EditorSkeleton />
      </div>
    </div>
  );
}
