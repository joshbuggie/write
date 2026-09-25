import {
  checkIntegrationName,
  INTEGRATION_LIMITS,
  launcherProblem,
  type IntegrationKind,
  type LauncherInput,
} from "@/lib/integrations";
import { nameKey } from "@/lib/names";
import { hashToken, newToken, sameHash, tokenHint } from "../integration-tokens";
import { getDataDir } from "./config";
import { StorageError } from "./errors";
import { mapFsError, randomHex } from "./fs-utils";
import {
  readIntegrationsFile,
  writeIntegrationsFile,
  type StoredIntegration,
  type StoredLauncher,
} from "./integrations-file";
import { withWriteLock } from "./mutex";
import { resolveFolder } from "./paths";

/**
 * Creating, changing and removing integrations, and keeping their folder lists in step with folder renames
 * and deletes (docs/design-decisions.md#d31). Every change runs under the write lock, like the notes.
 */

export type { StoredIntegration, StoredLauncher };

/** What the Integrations dialog sends when it makes or changes an integration. */
export interface IntegrationInput {
  name: string;
  kind: IntegrationKind;
  folders: string[];
  /** Absent keeps the saved launcher; null removes it. */
  launcher?: LauncherInput | null;
}

const originOf = (url: string) => {
  try {
    return new URL(url.trim()).origin;
  } catch {
    return null;
  }
};

/**
 * The launcher to save: the typed key, none when cleared, or the saved key only when the address is on the
 * same origin, so a key is never sent to another server by a typo (docs/design-decisions.md#d29, #d31).
 */
export function mergeLauncher(input: LauncherInput, saved: StoredLauncher | null): StoredLauncher {
  const problem = launcherProblem(input);
  if (problem) throw new StorageError("bad_request", problem);
  const typed = input.key?.trim();
  const sameOrigin = saved !== null && originOf(saved.url) === originOf(input.url);
  const key = typed || (input.clearKey || !sameOrigin ? null : saved.key);
  return {
    url: input.url.trim(),
    key,
    ca: input.ca.trim(),
    turnstoneMode: input.turnstoneMode,
    mcpServerName: input.mcpServerName,
  };
}

/** Same folder as saved: exact on-disk names, compared in NFC like resolveFolder's fallback. */
const sameFolder = (a: string, b: string) => a.normalize("NFC") === b.normalize("NFC");

const notFound = () => new StorageError("not_found", "That integration no longer exists.");

/** The checked name, and each folder as its exact on-disk name, without repeats. Missing folders fail. */
async function checkedInput(input: IntegrationInput): Promise<IntegrationInput> {
  const name = checkIntegrationName(input.name);
  if (!name.ok) throw new StorageError("invalid_name", name.message);
  if (input.folders.length > INTEGRATION_LIMITS.maxFolders) {
    throw new StorageError("bad_request", `Choose at most ${INTEGRATION_LIMITS.maxFolders} folders.`);
  }
  const dataDir = getDataDir();
  const folders: string[] = [];
  for (const folder of input.folders) {
    let onDisk: string;
    try {
      onDisk = (await resolveFolder(dataDir, folder)).name;
    } catch (err) {
      const mapped = mapFsError(err, "Folder not found.");
      if (mapped instanceof StorageError && mapped.code === "not_found") {
        throw new StorageError("not_found", `There is no folder named "${folder}" any more.`);
      }
      throw mapped;
    }
    if (!folders.some((f) => nameKey(f) === nameKey(onDisk))) folders.push(onDisk);
  }
  return { name: name.name, kind: input.kind, folders, launcher: input.launcher };
}

/** The launcher an integration ends up with: kept when not sent, removed with null, else merged. */
function nextLauncher(input: IntegrationInput, saved: StoredLauncher | null): StoredLauncher | null {
  if (input.launcher === undefined) return saved;
  return input.launcher === null ? null : mergeLauncher(input.launcher, saved);
}

/** Every saved integration, in the order they were made. */
export const readIntegrations = () => readIntegrationsFile();

/** The integration this token belongs to, or null. Compares hashes in constant time. */
export async function findIntegrationByToken(token: string): Promise<StoredIntegration | null> {
  const hash = hashToken(token);
  const all = await readIntegrationsFile();
  let found: StoredIntegration | null = null;
  for (const integration of all) if (sameHash(integration.tokenHash, hash)) found = integration;
  return found;
}

/** Makes an integration and its first token. The token is returned once and never saved. */
export function createIntegration(
  input: IntegrationInput,
): Promise<{ integration: StoredIntegration; token: string }> {
  return withWriteLock(async () => {
    const checked = await checkedInput(input);
    const all = await readIntegrationsFile();
    if (all.length >= INTEGRATION_LIMITS.maxIntegrations) {
      throw new StorageError(
        "bad_request",
        `You can have at most ${INTEGRATION_LIMITS.maxIntegrations} integrations.`,
      );
    }
    const token = newToken();
    const integration: StoredIntegration = {
      id: randomHex(8),
      name: checked.name,
      kind: checked.kind,
      folders: checked.folders,
      tokenHash: hashToken(token),
      tokenHint: tokenHint(token),
      createdAt: new Date().toISOString(),
      launcher: nextLauncher(checked, null),
    };
    await writeIntegrationsFile([...all, integration]);
    return { integration, token };
  });
}

/** Changes an integration's name, kind or folders. Its token keeps working. */
export function updateIntegration(id: string, input: IntegrationInput): Promise<StoredIntegration> {
  return withWriteLock(async () => {
    const checked = await checkedInput(input);
    const all = await readIntegrationsFile();
    const current = all.find((i) => i.id === id);
    if (!current) throw notFound();
    const updated: StoredIntegration = {
      ...current,
      name: checked.name,
      kind: checked.kind,
      folders: checked.folders,
      launcher: nextLauncher(checked, current.launcher),
    };
    await writeIntegrationsFile(all.map((i) => (i.id === id ? updated : i)));
    return updated;
  });
}

/** Replaces an integration's token: the old one stops working at once. The new one is returned once. */
export function rotateIntegrationToken(
  id: string,
): Promise<{ integration: StoredIntegration; token: string }> {
  return withWriteLock(async () => {
    const all = await readIntegrationsFile();
    const current = all.find((i) => i.id === id);
    if (!current) throw notFound();
    const token = newToken();
    const integration = { ...current, tokenHash: hashToken(token), tokenHint: tokenHint(token) };
    await writeIntegrationsFile(all.map((i) => (i.id === id ? integration : i)));
    return { integration, token };
  });
}

/** Removes an integration; its token stops working at once. */
export function deleteIntegration(id: string): Promise<void> {
  return withWriteLock(async () => {
    const all = await readIntegrationsFile();
    if (!all.some((i) => i.id === id)) throw notFound();
    await writeIntegrationsFile(all.filter((i) => i.id !== id));
  });
}

/**
 * Applies `change` to every integration's folder list, writing only when something changed. Called from
 * inside folder renames and deletes, which already hold the write lock, so it must not take it again.
 * A failure is logged, not thrown: the folder change itself already happened on disk.
 */
async function changeFolderScopes(change: (folders: string[]) => string[]): Promise<void> {
  try {
    const all = await readIntegrationsFile();
    let changed = false;
    const next = all.map((i) => {
      const folders = change(i.folders);
      if (folders.length === i.folders.length && folders.every((f, n) => f === i.folders[n])) return i;
      changed = true;
      return { ...i, folders };
    });
    if (changed) await writeIntegrationsFile(next);
  } catch (err) {
    console.error("[write] couldn't update the integrations' folders", err);
  }
}

/** A renamed folder stays readable by the integrations that could read it. Inside the write lock only. */
export const followFolderRename = (from: string, to: string) =>
  changeFolderScopes((folders) => folders.map((f) => (sameFolder(f, from) ? to : f)));

/**
 * A deleted folder leaves every integration's list, so a new folder made later with the same name isn't
 * readable by accident. Inside the write lock only.
 */
export const dropFolderScope = (name: string) =>
  changeFolderScopes((folders) => folders.filter((f) => !sameFolder(f, name)));

/** Whether this integration may read the folder with this exact on-disk name. */
export const canReadFolder = (integration: StoredIntegration, folder: string) =>
  integration.folders.some((f) => sameFolder(f, folder));
