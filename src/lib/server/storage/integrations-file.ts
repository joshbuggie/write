import { isIntegrationKind, type IntegrationKind, type TurnstoneMode } from "@/lib/integrations";
import { configFile } from "./config";
import { readConfigText, writeConfigText } from "./config-files";
import { StorageError } from "./errors";

/**
 * `<configDir>/integrations.json` (docs/design-decisions.md#d31): `{ "version": 1, "integrations": [...] }`.
 * It decides who may read which notes, so unlike settings.json it is read strictly: a file that exists but
 * isn't valid refuses every integration request instead of being read as "no integrations".
 */

const FILE_VERSION = 1;

/** How write starts jobs in the harness. The key is kept in plain text, like the AI keys (0600 file). */
export interface StoredLauncher {
  url: string;
  key: string | null;
  ca: string;
  turnstoneMode: TurnstoneMode;
  mcpServerName: string;
}

/** One integration as saved. Only the token's hash is kept, never the token. */
export interface StoredIntegration {
  id: string;
  name: string;
  kind: IntegrationKind;
  /** On-disk folder names the token can read. */
  folders: string[];
  /** Whether it may also create notes in those folders; it never overwrites one. */
  canCreate: boolean;
  /** Hex SHA-256 of the token. */
  tokenHash: string;
  tokenHint: string;
  /** ISO 8601. */
  createdAt: string;
  launcher: StoredLauncher | null;
}

const integrationsFile = () => configFile("integrations.json");

const isString = (v: unknown): v is string => typeof v === "string";

function isLauncher(v: unknown): v is StoredLauncher {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  return (
    isString(l.url) &&
    (l.key === null || isString(l.key)) &&
    isString(l.ca) &&
    (l.turnstoneMode === "coordinator" || l.turnstoneMode === "workstream") &&
    isString(l.mcpServerName)
  );
}

function isStoredIntegration(v: unknown): v is StoredIntegration {
  if (typeof v !== "object" || v === null) return false;
  const i = v as Record<string, unknown>;
  return (
    isString(i.id) &&
    i.id.length > 0 &&
    isString(i.name) &&
    isIntegrationKind(i.kind) &&
    Array.isArray(i.folders) &&
    i.folders.every(isString) &&
    // Files from before note creation have no flag: missing reads as false.
    (i.canCreate === undefined || typeof i.canCreate === "boolean") &&
    isString(i.tokenHash) &&
    /^[0-9a-f]{64}$/.test(i.tokenHash) &&
    isString(i.tokenHint) &&
    isString(i.createdAt) &&
    // Files from before launchers have none: missing reads as null.
    (i.launcher === undefined || i.launcher === null || isLauncher(i.launcher))
  );
}

function parse(text: string, file: string): StoredIntegration[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (
    v.version !== FILE_VERSION ||
    !Array.isArray(v.integrations) ||
    !v.integrations.every(isStoredIntegration)
  ) {
    throw new StorageError(
      "storage_unavailable",
      `${file} isn't a valid write integrations file. Restore it from a backup, or delete it and make the integrations again (their tokens stop working).`,
    );
  }
  return v.integrations.map((i) => ({
    id: i.id,
    name: i.name,
    kind: i.kind,
    folders: i.folders,
    canCreate: i.canCreate === true,
    tokenHash: i.tokenHash,
    tokenHint: i.tokenHint,
    createdAt: i.createdAt,
    launcher: i.launcher ?? null,
  }));
}

/** The saved integrations; empty when the file doesn't exist. Throws storage_unavailable for a bad file. */
export async function readIntegrationsFile(): Promise<StoredIntegration[]> {
  const file = await integrationsFile();
  const text = await readConfigText(file);
  return text === null ? [] : parse(text, file);
}

/** Replaces the file (0600, atomically). Call inside withWriteLock. */
export async function writeIntegrationsFile(integrations: StoredIntegration[]): Promise<void> {
  const text = JSON.stringify({ version: FILE_VERSION, integrations }, null, 2) + "\n";
  await writeConfigText(await integrationsFile(), text);
}
