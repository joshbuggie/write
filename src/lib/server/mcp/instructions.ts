/**
 * What an MCP client is told about write when it connects (docs/design-decisions.md#d31). It carries the
 * whole workflow, so any harness can use write without a skill or prompt written for it.
 */
export const SERVER_INSTRUCTIONS = `write is the owner's Markdown notes app. You can read the notes in the folders the owner shared with you, and propose changes to them. You can't edit notes directly: the owner reviews each proposal section by section (a section starts at a # or ## heading) and accepts or rejects each one.

Workflow:
1. Use list_notes to find the note, unless you were given its folder and name.
2. Call read_note and keep the version it returns. You need it to propose changes.
3. Call propose_changes with that version as baseVersion. Prefer "sections": send only the sections you changed, each as its heading plus the section's complete new text, heading line included. Give each changed section a short reason. Send a requestId that is unique to this attempt, so a retry never makes a second proposal.
4. Don't wait for the review. Later, get_proposal shows which sections the owner accepted or rejected. Before another pass, call read_note again and work from the note as it is then.

Rules:
- Keep the owner's voice and formatting, and change only what the task asks for.
- Keep a section's heading when you rewrite it: the heading identifies the section. A new heading is a new section, and a section you leave out of "content" is removed.
- Keep the sections in the note's order: a proposal can't move a section, and one that does is refused.
- Front matter (the --- block at the top) is never changed, whatever you send.
- If propose_changes says the note changed since you read it, read it again and redo your changes on the new text.
- Only if you have the create_note tool (the owner chooses): use it for a new note, in a folder list_notes shows. It is written at once and never replaces a note: a taken name is an error, so pick another name or propose changes to that note instead.
- The owner may be editing the note while you work. That is expected: sections they also changed are shown to them as conflicts.`;
