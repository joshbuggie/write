import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { AiSettings } from "@/lib/ai/settings";
import type { ConnectionInput, SaveSettingsRequest } from "@/lib/api-contract";
import { getConfigDir } from "./config";
import { StorageError } from "./errors";
import { atomicWrite, errorCode } from "./fs-utils";
import { withWriteLock } from "./mutex";
import {
  httpUrl,
  parseSettingsText,
  serializeSettings,
  type StoredAiSettings,
  type StoredConnection,
  withDefaultConnection,
} from "./settings-format";

/**
 * The AI assistant's settings, in `<configDir>/settings.json` (docs/design-decisions.md#d29). That file is
 * the only place API keys live: the server reads them to call a model, and the browser only ever gets
 * toAiSettingsView(), which carries at most each key's last four characters.
 */

export type { StoredAiSettings, StoredConnection };

const settingsFile = async () => path.join(await getConfigDir(), "settings.json");

/** fs errors for the config folder. mapFsError's messages name the data folder, which would mislead here. */
function configFsError(err: unknown, file: string): unknown {
  if (err instanceof StorageError) return err;
  const code = errorCode(err);
  if (code === "ENOSPC") return new StorageError("storage_unavailable", "Disk is full.");
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return new StorageError(
      "storage_unavailable",
      `Cannot use ${file} (${code}). In Docker, make sure the config volume is writable by uid 1000 (e.g. \`sudo chown -R 1000:1000 ./config\`).`,
    );
  }
  return code ? new StorageError("storage_unavailable", `Cannot use ${file} (${code}).`) : err;
}

/** The file's text, or null when it (or the config folder) doesn't exist yet. Never creates anything. */
async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if (errorCode(err) === "ENOENT" || errorCode(err) === "ENOTDIR") return null;
    throw configFsError(err, file);
  }
}

/** Keys are plain text, so the folder is created owner-only and the file is always written 0600. */
async function writeText(file: string, text: string) {
  const mapError = (err: unknown) => configFsError(err, file);
  try {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  } catch (err) {
    throw mapError(err);
  }
  await atomicWrite(file, Buffer.from(text, "utf8"), { mode: 0o600, mapError });
}

/**
 * The key a connection from the Settings form ends up with: a typed key, none when cleared, else the saved
 * one of the same id, but only while it stays on the same origin. A saved key is only ever sent where it
 * was saved for, so pointing a connection somewhere else means typing the key again.
 */
function keyFor(input: ConnectionInput, saved: StoredConnection | undefined): string | null {
  const typed = input.apiKey?.trim();
  if (typed) return typed;
  if (input.clearKey || !saved?.apiKey) return null;
  const origin = httpUrl(saved.baseUrl)?.origin;
  return origin !== undefined && origin === httpUrl(input.baseUrl)?.origin ? saved.apiKey : null;
}

/**
 * The saved AI settings, keys included (server-only). A missing file or config folder reads as the
 * defaults and nothing is created; a file that isn't valid JSON throws storage_unavailable.
 */
export async function readAiSettings(): Promise<StoredAiSettings> {
  const file = await settingsFile();
  return parseSettingsText(await readText(file), file);
}

/** Keys shorter than this (a LAN server's "1234", say) show no characters: four would give most away. */
const MIN_KEY_FOR_HINT = 12;

/** A saved key's hint: its last four characters, or dots for a short key. Truthy whenever there is a key. */
function keyHint(apiKey: string | null): string | null {
  if (!apiKey) return null;
  return apiKey.length >= MIN_KEY_FOR_HINT ? apiKey.slice(-4) : "••••";
}

/** What the browser may see: each key becomes a hint (see keyHint). The key never leaves here. */
export function toAiSettingsView(s: StoredAiSettings): AiSettings {
  return {
    ...s,
    connections: s.connections.map(({ apiKey, ...c }) => ({ ...c, keyHint: keyHint(apiKey) })),
  };
}

/**
 * Saves the Settings dialog's AI settings and returns the browser's view of them. Keys are merged in (see
 * keyFor), so the browser never needs the saved key. A corrupt file makes this throw rather than be
 * overwritten, and identical bytes are never rewritten.
 */
export function saveAiSettings(input: SaveSettingsRequest["ai"]): Promise<AiSettings> {
  return withWriteLock(async () => {
    const file = await settingsFile();
    const text = await readText(file);
    const saved = new Map(parseSettingsText(text, file).connections.map((c) => [c.id, c]));
    const next = withDefaultConnection({
      enabled: input.enabled,
      connections: input.connections.map((c) => ({
        id: c.id,
        name: c.name.trim(),
        provider: c.provider,
        baseUrl: c.baseUrl.trim(),
        model: c.model.trim(),
        apiKey: keyFor(c, saved.get(c.id)),
      })),
      defaultConnectionId: input.defaultConnectionId,
      shortcut: input.shortcut,
      defaultScope: input.defaultScope,
      instructions: input.instructions,
      quickActions: input.quickActions.map(({ id, label, prompt, apply }) => ({ id, label, prompt, apply })),
    });
    const bytes = serializeSettings(next);
    if (bytes !== text) await writeText(file, bytes);
    return toAiSettingsView(next);
  });
}

/**
 * The key "Test connection" should use for a connection from the form, saved or not: the same rule as
 * saving (typed key, cleared, or the saved key of the same id on the same origin), without writing.
 */
export async function apiKeyFor(input: ConnectionInput): Promise<string | null> {
  if (input.apiKey?.trim() || input.clearKey) return keyFor(input, undefined);
  const saved = (await readAiSettings()).connections.find((c) => c.id === input.id);
  return keyFor(input, saved);
}
