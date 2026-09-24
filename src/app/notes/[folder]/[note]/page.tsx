import type { Metadata } from "next";
import { NoteView } from "@/components/note/note-view";
import { noteRefFromParams } from "@/lib/routes";
import { loadNote, loadNoteProposals, loadTree } from "@/lib/server/loaders";

type NotePageProps = { params: Promise<{ folder: string; note: string }> };

/** The tab shows the note's title (the root layout's template appends " · write"). */
export async function generateMetadata({ params }: NotePageProps): Promise<Metadata> {
  return { title: noteRefFromParams(await params).name };
}

/**
 * The editor screen for one note. Page params arrive still percent-encoded in Next 16, so they are
 * decoded exactly once, by noteRefFromParams. A missing note renders ./not-found.tsx (loadNote calls
 * notFound()).
 */
export default async function NotePage({ params }: NotePageProps) {
  const ref = noteRefFromParams(await params);
  const [note, folders] = await Promise.all([
    loadNote(ref),
    // Only feeds the "Move to…" list. If the tree can't load, notes/layout.tsx already shows why.
    loadTree().then(
      (tree) => tree.folders.map((f) => f.name),
      () => [],
    ),
  ]);
  const proposals = await loadNoteProposals(note);
  // Keyed by the on-disk name: a rename or move is a fresh editor with a fresh autosaver.
  return <NoteView key={`${note.folder}/${note.name}`} note={note} folders={folders} proposals={proposals} />;
}
