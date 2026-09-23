import type { SettingsResponse } from "@/lib/api-contract";
import { handle, json, readJson } from "@/lib/server/http";
import { readAiSettings, saveAiSettings, toAiSettingsView } from "@/lib/server/storage";
import { isSaveSettingsRequest } from "@/lib/server/validate";

/**
 * write's own settings, today only the AI assistant's (see docs/design-decisions.md#d29). API keys go in
 * and never come back out: every response carries a key hint instead (the last four characters of a long
 * key, "••••" for a short one).
 */

/** The saved settings, or the defaults before anything was saved. 503 storage_unavailable (corrupt file). */
export const GET = handle(async () => {
  const body: SettingsResponse = { ai: toAiSettingsView(await readAiSettings()) };
  return json(body);
});

/**
 * Saves the whole settings object from the Settings dialog and returns what was saved. A connection keeps
 * its saved key unless it sends a new one or clearKey, and loses it when its URL moves to another origin.
 * 400 bad_request (shape, limits, duplicate ids, unknown default), 503 storage_unavailable.
 */
export const PUT = handle(async (req) => {
  const { ai } = await readJson(req, isSaveSettingsRequest);
  const body: SettingsResponse = { ai: await saveAiSettings(ai) };
  return json(body);
});
