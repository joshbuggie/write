import type { AiSettings } from "./settings";

/** Which part of the note travels with a request. "cursor" means an empty line: no note text at all. */
export type ContextKind = "selection" | "paragraph" | "cursor" | "note";

/** The note text a request carries, as captured when the prompt window opened. */
export type AiContext = { kind: ContextKind; text: string; noteTitle: string };

/** The exact messages sent to the model: shown verbatim under "What gets sent" before anything is sent. */
export type AiMessages = { system: string; user: string };

const PART: Record<ContextKind, string> = {
  selection: "selection",
  paragraph: "paragraph at the cursor",
  cursor: "",
  note: "whole note",
};

/**
 * Builds the request. The note text is fenced in a tag so the model can tell it apart from the request,
 * and the note title is included because it often says what the note is about.
 */
export function buildMessages(settings: AiSettings, context: AiContext, request: string): AiMessages {
  const title = context.noteTitle.replace(/"/g, "'");
  const note =
    context.kind === "cursor" || !context.text.trim()
      ? `The cursor is on an empty line in the note "${title}".`
      : `<note title="${title}" part="${PART[context.kind]}">\n${context.text.trim()}\n</note>`;
  return { system: settings.instructions.trim(), user: `${note}\n\n${request.trim()}` };
}

/** Words in a passage, for the "Selection · 42 words" labels. Markdown markers ("-", "##", ">") aren't words. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}
