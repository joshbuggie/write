import type { NoteRef } from "@/lib/types";

/**
 * The message write sends a harness when "Send to…" starts or continues a job (docs/design-decisions.md#d31).
 * The same words for every harness: it names the note, passes the owner's instruction on as written, and
 * asks for the proposal under the job's id, so write can tell when this job's changes have arrived. How to
 * use the tools is in write's MCP server instructions, not here.
 */

export interface BriefInput {
  note: NoteRef;
  instruction: string;
  /** Headings the owner limited the job to; empty for the whole note. */
  sections: string[];
  jobId: string;
  /** True when this continues the harness's earlier conversation about the note. */
  continuing: boolean;
}

const quote = (s: string) => `"${s.replace(/"/g, "'")}"`;

export function buildBrief({ note, instruction, sections, jobId, continuing }: BriefInput): string {
  const lines = [
    `Work on a note in write, the owner's notes app, using write's tools: the note ${quote(note.name)} in the folder ${quote(note.folder)}.`,
    "",
    "The owner's request:",
    instruction.trim() || "Improve the note.",
  ];
  if (sections.length > 0) {
    lines.push("", `Change only these sections: ${sections.map(quote).join(", ")}. Leave the rest as it is.`);
  }
  lines.push("");
  if (continuing) {
    lines.push(
      "This continues your earlier work on this note. First check what the owner decided on your last proposal with get_proposal, then read the note again: build on it as it is now.",
    );
  } else {
    lines.push("Read the note with read_note first.");
  }
  lines.push(
    `Send your changes with propose_changes, using sections, a short reason for each, and requestId ${quote(jobId)}. The owner reviews them in write, so don't wait for the review: stop once you have proposed.`,
  );
  return lines.join("\n");
}
