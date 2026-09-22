"use client";

import { Download } from "lucide-react";
import { TEXT_COLUMN } from "@/components/editor/editor-skeleton";
import { useRegisterActiveNote } from "@/components/shell/shell-context";
import { DownloadLink } from "@/components/ui/download-link";
import { cn } from "@/lib/cn";
import { downloadNoteHref } from "@/lib/routes";
import type { Note } from "@/lib/types";
import { NoteHeader } from "./note-header";
import { Notice } from "./notice";

const noFlush = async () => {};

const MESSAGES = {
  "not-utf8":
    "This file isn't valid UTF-8 text, so write shows it read-only rather than risk damaging it. The preview below may show replacement characters.",
  "too-large":
    "This note is larger than 5 MB, so it can't be opened here. Download it to open it in another app.",
} as const;

/**
 * A note write must not edit (see docs/design-decisions.md#d18): invalid UTF-8 or over the size cap. Shows
 * why, offers the exact file as a download, and (for not-UTF-8) a plain preview.
 */
export function ReadOnlyNote({ note }: { note: Note & { readOnly: "not-utf8" | "too-large" } }) {
  const ref = { folder: note.folder, name: note.name };
  useRegisterActiveNote(ref, noFlush);

  return (
    <>
      <NoteHeader noteRef={ref} />
      <article className={cn(TEXT_COLUMN, "pb-[40vh]")}>
        <h1 className="pt-6 text-[26px] leading-[32px] font-[650] tracking-[-0.01em] break-words md:pt-14 md:text-[32px] md:leading-[40px] xl:text-[34px] xl:leading-[42px]">
          {note.name}
        </h1>
        <Notice
          tone="warning"
          actions={
            <DownloadLink
              href={downloadNoteHref(ref)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-[14px] text-ink hover:bg-hover"
            >
              <Download aria-hidden strokeWidth={1.75} className="size-[18px]" />
              Download .md
            </DownloadLink>
          }
        >
          {MESSAGES[note.readOnly]}
        </Notice>
        {note.readOnly === "not-utf8" && (
          <pre className="mt-6 overflow-x-auto font-mono text-[14px] leading-[1.6] whitespace-pre-wrap text-muted">
            {note.content}
          </pre>
        )}
      </article>
    </>
  );
}
