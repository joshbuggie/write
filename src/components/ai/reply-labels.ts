import type { AiScope, ApplyMode, QuickAction } from "@/lib/ai/settings";
import type { Target } from "./ai-target";

type Labels = { replaceLabel: string | null; insertLabel: string; primary: ApplyMode };

/**
 * The reply's buttons: "Whole note" rewrites the note, otherwise Replace rewrites the target; an empty
 * line has nothing to replace, and a whole note is never replaced by escaped plain text. The quick action
 * decides which button is primary; a typed request about the whole note is usually a question, so its
 * answer goes below rather than over the text.
 */
export function replyLabels(args: {
  scope: AiScope;
  target: Target;
  plain: boolean;
  quickAction: QuickAction | undefined;
}): Labels {
  const { scope, target, plain, quickAction } = args;
  let replaceLabel: string | null = `Replace ${target.name.toLowerCase()}`;
  if (scope === "note") replaceLabel = plain ? null : "Replace note";
  else if (target.kind === "cursor") replaceLabel = null;
  const primary: ApplyMode =
    replaceLabel === null ? "insert" : (quickAction?.apply ?? (scope === "note" ? "insert" : "replace"));
  return { replaceLabel, insertLabel: target.kind === "cursor" ? "Insert" : "Insert below", primary };
}
