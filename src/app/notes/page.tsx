import type { Metadata } from "next";
import { EmptyState } from "@/components/shell/empty-state";
import { Sidebar } from "@/components/sidebar/sidebar";
import { isAuthEnabled, loadTree } from "@/lib/server/loaders";
import { StorageError } from "@/lib/server/storage";
import type { Tree } from "@/lib/types";

export const metadata: Metadata = { title: "Notes" };

/**
 * /notes. Phones: the library (the sidebar as a full page, with a bottom bar).
 * md and up: the sidebar is already on screen, so this is just an empty state.
 */
export default async function NotesPage() {
  let tree: Tree;
  try {
    tree = await loadTree(); // cached: the layout already loaded it for this request
  } catch (err) {
    if (err instanceof StorageError) return null; // the layout renders the explanation
    throw err;
  }
  return (
    <>
      <div className="md:hidden">
        <Sidebar variant="page" tree={tree} authEnabled={isAuthEnabled()} />
      </div>
      <div className="hidden h-full md:block">
        <EmptyState tree={tree} />
      </div>
    </>
  );
}
