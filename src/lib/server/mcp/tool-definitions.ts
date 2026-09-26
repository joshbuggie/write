/**
 * The tools write offers over MCP (docs/design-decisions.md#d31), as `tools/list` returns them. The
 * descriptions are written for the model: each says when to use the tool and what comes back. Reading
 * tools are marked read-only, so clients that ask before write-capable tools (Hermes Agent's "untrusted"
 * servers) don't ask for them, and may retry them safely.
 */

const noteRef = {
  folder: { type: "string", description: "The folder's name, exactly as list_notes shows it." },
  name: { type: "string", description: "The note's name (its title), without .md." },
} as const;

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOL_DEFINITIONS = [
  {
    name: "list_notes",
    title: "List notes",
    description:
      "Lists the folders you can read in write, with each note's name, last change and size. Use it to find a note before reading it.",
    inputSchema: {
      type: "object",
      properties: { folder: { type: "string", description: "Only list this folder." } },
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "read_note",
    title: "Read a note",
    description:
      "Reads one note: its Markdown, its sections (the # and ## headings the owner reviews by), and its version. Keep the version: propose_changes needs it as baseVersion.",
    inputSchema: {
      type: "object",
      properties: noteRef,
      required: ["folder", "name"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
  {
    name: "propose_changes",
    title: "Propose changes to a note",
    description:
      "Proposes changes to a note you read, for the owner to review section by section. Nothing changes until the owner accepts. Send either `sections` (preferred: only the sections you changed) or `content` (the whole revised note), never both. Returns the proposal's id and how many changes wait for review.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef,
        baseVersion: { type: "string", description: "The version read_note returned." },
        sections: {
          type: "array",
          description:
            "The sections you changed. A heading the note doesn't have adds a new section at the end; empty content removes the section.",
          items: {
            type: "object",
            properties: {
              heading: {
                type: ["string", "null"],
                description:
                  'Which section to replace, by its heading ("## Plan" or "Plan"); include the #s when the same text is used at two levels. null for the text before the first heading.',
              },
              content: {
                type: "string",
                description: "The section's complete new text, heading line included.",
              },
            },
            required: ["heading", "content"],
            additionalProperties: false,
          },
        },
        content: { type: "string", description: "The whole revised note, instead of sections." },
        summary: { type: "string", description: "One line on what you changed and why, shown to the owner." },
        reasons: {
          type: "object",
          description: "Why each section changed, by heading text.",
          additionalProperties: { type: "string" },
        },
        requestId: {
          type: "string",
          description:
            "Unique to this attempt (letters, digits, _ . : -); sending it again returns the first proposal.",
        },
      },
      required: ["folder", "name", "baseVersion"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "create_note",
    title: "Create a note",
    description:
      "Creates a new note in a folder list_notes shows. It is written at once, under exactly this name. If a note already has that name nothing is written and you get an error: choose another name, or read that note and propose changes to it. To change the new note later, use propose_changes as for any note.",
    inputSchema: {
      type: "object",
      properties: {
        ...noteRef,
        content: { type: "string", description: "The note's complete Markdown." },
        requestId: {
          type: "string",
          description:
            "Unique to this attempt (letters, digits, _ . : -); sending it again returns the note it made instead of failing.",
        },
      },
      required: ["folder", "name", "content"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_proposal",
    title: "Check a proposal",
    description:
      "Shows where a proposal stands: pending, applied or dismissed, and which sections the owner accepted or rejected. Read the note again before another pass.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The id propose_changes returned." } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: readOnly,
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export const isToolName = (name: unknown): name is ToolName => TOOL_DEFINITIONS.some((t) => t.name === name);

/** The tools this integration is offered: create_note only when the owner let it create notes. */
export const toolsFor = (integration: { canCreate: boolean }) =>
  TOOL_DEFINITIONS.filter((t) => t.name !== "create_note" || integration.canCreate);
