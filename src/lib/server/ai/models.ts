import { AI_LIMITS } from "@/lib/ai/settings";
import { HttpError } from "../http";
import { parseJson, prop, str } from "./json";
import { displayUrl, readBody, type Upstream } from "./upstream";

/**
 * Reading a server's models list for "Test connection" (see docs/design-decisions.md#d29). Lists differ:
 * OpenAI-style `data[].id`, Ollama-style `models[].name`, sometimes plain strings, so all are accepted.
 */

/** OpenRouter's list, with descriptions and prices, is a few megabytes; this leaves room for growth. */
const MAX_MODELS_BYTES = 16 * 1024 * 1024;

const collator = new Intl.Collator("en", { numeric: true });

/** Model ids in any of the list shapes, unique and sorted (numbers in order: "gpt-4" before "gpt-10"). */
export function modelIds(value: unknown): string[] {
  const lists = [value, prop(value, "data"), prop(value, "models")];
  const ids = lists
    .flatMap((list) => (Array.isArray(list) ? list : []))
    .map((entry) => (str(prop(entry, "id")) ?? str(prop(entry, "name")) ?? str(entry) ?? "").trim())
    // A model name the Settings form couldn't save is no use in its picker.
    .filter((id) => id !== "" && id.length <= AI_LIMITS.field);
  return [...new Set(ids)].sort(collator.compare);
}

/** The ids from an answered models request; throws when the answer isn't a JSON list. */
export async function readModelIds(up: Upstream, url: URL): Promise<string[]> {
  const { text, complete } = await readBody(up, MAX_MODELS_BYTES);
  if (!complete) throw new HttpError("ai_upstream", `${up.host} sent a models list too large to read.`);
  const value = parseJson(text);
  if (value === undefined) {
    throw new HttpError(
      "ai_upstream",
      `${displayUrl(url)} didn't answer with a models list. Check the server URL.`,
    );
  }
  return modelIds(value);
}
