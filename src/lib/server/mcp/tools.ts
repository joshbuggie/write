import type { AgentProposal } from "@/lib/api-contract";
import { splitFrontmatter } from "@/lib/markdown/file-format";
import { bodySections } from "@/lib/proposals/review";
import { agentCreateNote, agentReadNote, agentTree } from "../agent-actions";
import { HttpError } from "../http";
import { agentProposal, proposeFromAgent } from "../proposal-service";
import { StorageError, type StoredIntegration } from "../storage";
import { isAgentCreateNoteRequest, isAgentProposalRequest } from "../validate-proposals";
import type { ToolName } from "./tool-definitions";

/**
 * Running the MCP tools (docs/design-decisions.md#d31) on the same code as the REST routes. Each answers
 * with text for the model and the same data as `structuredContent`. Anything the model can fix (a missing
 * note, a stale version, bad arguments) comes back as a tool error it can read, not a protocol error.
 */

export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

const ok = (text: string, data: unknown): ToolResult => ({
  content: [{ type: "text", text }],
  structuredContent: data,
});
const toolError = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** The # and ## headings a note's body has, as read_note and create_note report them. */
const headings = (content: string) =>
  bodySections(content)
    .filter((s) => s.heading !== null)
    .map((s) => s.heading);

const listed = (sections: (string | null)[]) => sections.join(" | ") || "(no # or ## headings)";

function describeProposal(p: AgentProposal): string {
  const lines = [`Proposal ${p.id} for ${p.note.folder}/${p.note.name}: ${p.status}.`];
  if (p.status === "pending") lines.push(`${p.waiting} change(s) wait for the owner's review.`);
  for (const d of p.decisions) lines.push(`- ${d.heading ?? "(opening text)"}: ${d.decision}`);
  if (p.noteVersion)
    lines.push(`The note is now at version ${p.noteVersion}; read it again before another pass.`);
  else lines.push("The note is gone, or you can no longer read it.");
  return lines.join("\n");
}

async function run(
  integration: StoredIntegration,
  name: ToolName,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (name === "list_notes") {
    const tree = await agentTree(integration);
    const folders = str(args.folder) ? tree.folders.filter((f) => f.name === args.folder) : tree.folders;
    if (folders.length === 0) return ok("There are no folders you can read.", { folders });
    const text = folders
      .map((f) =>
        [`${f.name}/`, ...f.notes.map((n) => `  ${n.name} (changed ${n.updatedAt}, ${n.size} bytes)`)].join(
          "\n",
        ),
      )
      .join("\n");
    return ok(text, { folders });
  }
  if (name === "read_note") {
    if (!str(args.folder) || !str(args.name)) return toolError("Give the note's folder and name.");
    const note = await agentReadNote(integration, { folder: args.folder, name: args.name });
    if (note.readOnly) return toolError("This note can't be edited in write (too large, or not UTF-8).");
    const sections = headings(note.content);
    const header = [`Version: ${note.version}`, `Sections: ${listed(sections)}`];
    return ok(`${header.join("\n")}\n\n${note.content}`, {
      folder: note.folder,
      name: note.name,
      version: note.version,
      sections,
      content: note.content,
    });
  }
  if (name === "propose_changes") {
    if (!isAgentProposalRequest(args)) {
      return toolError(
        "Check the arguments: folder, name and baseVersion (16 hex characters from read_note), and exactly one of sections or content.",
      );
    }
    const { proposal, created, notice } = await proposeFromAgent(integration, args);
    const note = created ? "" : " (you sent this before; this is the first proposal)";
    const text = describeProposal(proposal) + note + (notice ? `\n\n${notice}` : "");
    return ok(text, notice ? { ...proposal, notice } : proposal);
  }
  if (name === "create_note") {
    if (!isAgentCreateNoteRequest(args))
      return toolError("Give the folder, the name and the note's content.");
    const { note, created } = await agentCreateNote(integration, args);
    const again = created ? "Created" : "You sent this before; this is the note it made:";
    // What write made of the text, so the harness can check its headings landed where it meant them.
    const sections = headings(note.content);
    const frontmatterBytes = Buffer.byteLength(splitFrontmatter(note.content).frontmatter);
    const lines = [`${again} ${note.folder}/${note.name}, version ${note.version}.`];
    lines.push(`Sections: ${listed(sections)}`);
    if (frontmatterBytes > 0) {
      lines.push(
        `Front matter: ${frontmatterBytes} bytes (the block between the --- lines at the top; the owner sees it as properties, not as text).`,
      );
    }
    return ok(lines.join("\n"), {
      folder: note.folder,
      name: note.name,
      version: note.version,
      sections,
      frontmatterBytes,
    });
  }
  if (!str(args.id)) return toolError("Give the id propose_changes returned.");
  const proposal = await agentProposal(integration, args.id);
  return ok(describeProposal(proposal), proposal);
}

/** Runs a tool. Expected failures become tool errors with a message; anything else is thrown. */
export async function callTool(
  integration: StoredIntegration,
  name: ToolName,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    return await run(integration, name, args);
  } catch (err) {
    if (err instanceof StorageError && err.code === "version_conflict" && err.current) {
      return toolError(`${err.message} The note is now at version ${err.current.version}.`);
    }
    if (err instanceof StorageError || err instanceof HttpError) return toolError(err.message);
    throw err;
  }
}
