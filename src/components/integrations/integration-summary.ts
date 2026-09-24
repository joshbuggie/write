import { kindLabel, type IntegrationView } from "@/lib/integrations";
import { compareNames, nameKey } from "@/lib/names";

/**
 * Pure helpers for the Integrations dialog, kept apart from the components so they can be tested without
 * a browser (docs/design-decisions.md#d31).
 */

/** "Essays, Journal", "no folders yet", or "Essays and 3 more" once the list gets long. */
export function foldersLabel(folders: string[]): string {
  if (folders.length === 0) return "no folders yet";
  if (folders.length <= 3) return folders.join(", ");
  return `${folders.slice(0, 2).join(", ")} and ${folders.length - 2} more`;
}

/** "Turnstone · Essays, Journal · token ••ab12": one line to recognize an integration by. */
export function summarizeIntegration(i: IntegrationView): string {
  return [kindLabel(i.kind), foldersLabel(i.folders), `token ••${i.tokenHint}`].join(" · ");
}

/** "Last used Sep 24, 3:46 PM", or that it hasn't been used since the server started. */
export function lastUsedLabel(lastUsedAt: string | null): string {
  if (!lastUsedAt) return "Not used since write started";
  const when = new Date(lastUsedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `Last used ${when}`;
}

/** A folder the form offers: the ones in the library, plus any the integration has that are gone. */
export type FolderChoice = { name: string; missing: boolean };

/**
 * The folders to offer as checkboxes, sorted like the sidebar. A chosen folder that's no longer in the
 * library (renamed outside write, say) is still listed, marked missing, so it can be unticked.
 */
export function folderChoices(library: string[], chosen: string[]): FolderChoice[] {
  const inLibrary = new Set(library.map(nameKey));
  const gone = chosen.filter((f) => !inLibrary.has(nameKey(f)));
  return [
    ...library.map((name) => ({ name, missing: false })),
    ...gone.map((name) => ({ name, missing: true })),
  ].sort((a, b) => compareNames(a.name, b.name));
}

/** `chosen` with `folder` added or removed, keeping the library's order. */
export function toggleFolder(chosen: string[], folder: string, on: boolean): string[] {
  const rest = chosen.filter((f) => nameKey(f) !== nameKey(folder));
  return on ? [...rest, folder].sort(compareNames) : rest;
}

/** Where agents reach write, from the address this page was opened at. */
export const agentApiBase = (origin: string) => `${origin}/api/agent`;
