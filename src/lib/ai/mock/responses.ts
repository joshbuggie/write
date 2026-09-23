import type { ContextKind } from "../prompt";

/**
 * MOCKUP ONLY: canned replies so the prompt window can be tried without a model. The built-in quick
 * actions get a crude but plausible transform of the real text, so Replace and Insert show something
 * that fits the note; anything typed gets an honest placeholder.
 */

const FILLER = /\b(really|very|just|basically|actually|quite|simply|literally)\s+/gi;

const sentences = (text: string) =>
  text
    .match(/[^.!?]+[.!?]*/g)
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [];

function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\bi\b/g, "I")
    .replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
    .trim();
}

function shorter(text: string): string {
  const all = sentences(text.replace(FILLER, ""));
  return all.slice(0, Math.max(1, Math.ceil(all.length / 2))).join(" ");
}

function summarize(text: string): string {
  const points = text
    .split(/\n\s*\n/)
    .map((para) => sentences(para.replace(/^[#>*\-\s]+/, ""))[0])
    .filter(Boolean)
    .slice(0, 4)
    .map(
      (s) =>
        `- ${s
          .split(/\s+/)
          .slice(0, 14)
          .join(" ")
          .replace(/[,;:]$/, "")}`,
    );
  return points.length > 0 ? points.join("\n") : "- (Nothing to summarize yet.)";
}

const CONTINUATION =
  "From here, the next step is to turn these notes into a short plan: what has to happen first, who needs " +
  "to be involved, and what a good outcome looks like. Once that is written down, the rest usually follows.";

const SCOPE_WORDS: Record<ContextKind, string> = {
  selection: "the selected text",
  paragraph: "the paragraph at the cursor",
  cursor: "no note text",
  note: "the whole note",
};

/** A fake reply for a request, based on the note text it would have carried. */
export function mockReply(actionId: string | null, request: string, text: string, kind: ContextKind): string {
  const source = text.trim();
  switch (source ? actionId : null) {
    case "improve":
      return tidy(source.replace(FILLER, ""));
    case "fix":
      return tidy(source);
    case "shorter":
      return shorter(source);
    case "continue":
      return CONTINUATION;
    case "summarize":
      return summarize(source);
  }
  return (
    `This is a sample reply from the mockup: no model was called. With a model connected, the answer ` +
    `to “${request.trim()}” would stream in here, with ${SCOPE_WORDS[kind]} as context.`
  );
}
