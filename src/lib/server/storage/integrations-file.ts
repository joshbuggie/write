import { isIntegrationKind, type IntegrationKind } from "@/lib/integrations";
import { configFile } from "./config";
import { readConfigText, writeConfigText } from "./config-files";
import { StorageError } from "./errors";

/**
 * `<configDir>/integrations.json` (docs/design-decisions.md#d31): `{ "version": 1, "integrations": [...] }`.
 * It decides who may read which notes, so unlike settings.json it is read strictly: a file that exists but
 * isn't valid refuses every integration request instead of being read as "no integrations".
 */

const FILE_VERSION = 1;

/** One integration as saved. Only the token's hash is kept, never the token. */
export interface StoredIntegration {
  id: string;
  name: string;
  kind: IntegrationKind;
  /** On-disk folder names the token can read. */
  folders: string[];
  /** Hex SHA-256 of the token. */
  tokenHash: string;
  tokenHint: string;
  /** ISO 8601. */
  createdAt: string;
}

const integrationsFile = () => configFile("integrations.json");

const isString = (v: unknown): v is string => typeof v === "string";

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
    isString(i.tokenHash) &&
    /^[0-9a-f]{64}$/.test(i.tokenHash) &&
    isString(i.tokenHint) &&
    isString(i.createdAt)
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
  return v.integrations.map(({ id, name, kind, folders, tokenHash, tokenHint, createdAt }) => ({
    id,
    name,
    kind,
    folders,
    tokenHash,
    tokenHint,
    createdAt,
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
