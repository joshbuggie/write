import type {
  IntegrationRequest,
  LaunchRequest,
  RotateTokenRequest,
  TestLauncherRequest,
  UpdateIntegrationRequest,
} from "@/lib/api-contract";
import { isIntegrationKind, type LauncherInput } from "@/lib/integrations";

/**
 * Type guards for the Integrations dialog's requests and "Send to…" (docs/design-decisions.md#d31), apart
 * from validate.ts to keep both short. Shapes only; addresses, folders and names are checked later.
 */

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isStringList = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every(isString);

export function isLauncherInput(v: unknown): v is LauncherInput {
  return (
    isObject(v) &&
    isString(v.url) &&
    (v.key === undefined || isString(v.key)) &&
    (v.clearKey === undefined || typeof v.clearKey === "boolean") &&
    isString(v.ca) &&
    (v.turnstoneMode === "coordinator" || v.turnstoneMode === "workstream") &&
    isString(v.mcpServerName)
  );
}

/** An integration from the dialog: a name, its kind, folder names and, optionally, creation and a launcher. */
export function isIntegrationRequest(v: unknown): v is IntegrationRequest {
  return (
    isObject(v) &&
    isString(v.name) &&
    isIntegrationKind(v.kind) &&
    isStringList(v.folders, 1000) &&
    (v.canCreate === undefined || typeof v.canCreate === "boolean") &&
    (v.launcher === undefined || v.launcher === null || isLauncherInput(v.launcher))
  );
}

export function isUpdateIntegrationRequest(v: unknown): v is UpdateIntegrationRequest {
  return isObject(v) && isString(v.id) && isIntegrationRequest(v);
}

export function isRotateTokenRequest(v: unknown): v is RotateTokenRequest {
  return isObject(v) && isString(v.id);
}

export function isLaunchRequest(v: unknown): v is LaunchRequest {
  return (
    isObject(v) &&
    isString(v.integrationId) &&
    isString(v.folder) &&
    isString(v.name) &&
    isString(v.instruction) &&
    v.instruction.length <= 20_000 &&
    isStringList(v.sections, 200) &&
    typeof v.fresh === "boolean"
  );
}

export function isTestLauncherRequest(v: unknown): v is TestLauncherRequest {
  return (
    isObject(v) &&
    (v.integrationId === null || isString(v.integrationId)) &&
    isIntegrationKind(v.kind) &&
    isLauncherInput(v.launcher)
  );
}
