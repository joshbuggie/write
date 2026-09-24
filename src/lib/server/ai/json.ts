/**
 * Tolerant JSON access for model server replies. Servers that call themselves OpenAI-compatible differ in
 * which fields they send, so every read checks the shape instead of trusting it.
 */

/** A plain JSON object, as opposed to null, an array or a primitive. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The parsed value, or undefined when the text isn't JSON (an HTML error page, say). */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `v[key]` when `v` is an object, else undefined; saves a type guard at every step of a nested read. */
export function prop(v: unknown, key: string): unknown {
  return isRecord(v) ? v[key] : undefined;
}

/** A non-empty string, or null. */
export function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
