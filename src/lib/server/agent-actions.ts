import type { Note, NoteRef, Tree } from "@/lib/types";
import type { AgentCreateNoteRequest } from "@/lib/api-contract";
import { isOnlyFrontmatter } from "@/lib/markdown/file-format";
import { HttpError } from "./http";
import { rememberBase } from "./proposal-bases";
import {
  canReadFolder,
  createNoteFor,
  listTree,
  readNote,
  StorageError,
  type StoredIntegration,
} from "./storage";

/**
 * What an integration can do to read and create notes (docs/design-decisions.md#d31), shared by the REST
 * routes and the MCP tools so both keep to its folders the same way.
 */

const hidden = () => new StorageError("not_found", "Note not found.");

const ONLY_FRONTMATTER =
  "Nothing was written: this content is only front matter. It starts with a --- line, so everything up to the next --- line would be stored as the note's properties, and the note would show no text. Start the content at its first heading, without a leading --- line. If you do want front matter, put the note's text after its closing ---.";

/** The folders this integration can read, with their notes. Others are left out, names and all. */
export async function agentTree(integration: StoredIntegration): Promise<Tree> {
  const tree = await listTree();
  return { folders: tree.folders.filter((f) => canReadFolder(integration, f.name)) };
}

/**
 * One note in a folder this integration can read; anything else answers like a missing note, so probing
 * can't tell which folders exist. Its text is remembered by version, so a proposal based on it can still
 * be compared after the owner edits the note.
 */
export async function agentReadNote(integration: StoredIntegration, ref: NoteRef): Promise<Note> {
  if (!canReadFolder(integration, ref.folder)) throw hidden();
  const note = await readNote(ref);
  if (!canReadFolder(integration, note.folder)) throw hidden();
  if (!note.readOnly) rememberBase(note.version, note.content);
  return note;
}

/**
 * A new note in a folder this integration can read, if the owner let it create notes. Written at once:
 * a new note can't overwrite anything, and later changes to it go through proposals like any other note.
 * A folder it can't read answers like a missing one. Content that is only front matter is refused: a
 * story wrapped in --- lines would otherwise be saved as the note's properties, with no text to show.
 */
export async function agentCreateNote(
  integration: StoredIntegration,
  input: AgentCreateNoteRequest,
): Promise<{ note: Note; created: boolean }> {
  if (!integration.canCreate) {
    throw new HttpError(
      "forbidden",
      "This integration can't create notes. The owner can allow it under Integrations in write.",
    );
  }
  if (!canReadFolder(integration, input.folder)) throw new StorageError("not_found", "Folder not found.");
  if (isOnlyFrontmatter(input.content)) throw new HttpError("bad_request", ONLY_FRONTMATTER);
  const result = await createNoteFor({
    integrationId: integration.id,
    source: integration.name,
    requestId: input.requestId ?? null,
    ref: { folder: input.folder, name: input.name },
    content: input.content,
    canRead: (folder) => canReadFolder(integration, folder),
  });
  rememberBase(result.note.version, result.note.content);
  return result;
}
