import type { ConnectionInput } from "@/lib/api-contract";
import { toConnectionInput, type DraftConnection } from "./settings-draft";

/** What "Test connection" says under the button. */
export type TestResult = { ok: boolean; message: string };

/** A finished test: its answer, and the model to fill in when the Model field is still empty. */
export type TestOutcome = { models: string[]; autofill: string | null; result: TestResult };

/** "Connected · 4 models available", plus a warning when the chosen model isn't among them. */
export function describeModels(models: string[], model: string): TestResult {
  if (models.length === 0) return { ok: true, message: "Connected. The server didn't list its models." };
  const listed = `Connected · ${models.length} ${models.length === 1 ? "model" : "models"} available`;
  if (model && !models.includes(model)) return { ok: false, message: `${listed}, but not “${model}”.` };
  return { ok: true, message: listed };
}

/**
 * The fields a test answers for: provider, server URL and key. A result belongs to these and is stale
 * once any of them changes. Name and model aren't among them: the model list doesn't depend on either.
 */
export function connectionIdentity(c: DraftConnection): string {
  const { provider, baseUrl, apiKey, clearKey } = toConnectionInput(c);
  return JSON.stringify([provider, baseUrl, apiKey ?? null, clearKey ?? false]);
}

/**
 * Tests `draft` and says what the answer does to the form, judged against `latest()` (the form as it is
 * when the answer arrives, since the fields stay editable meanwhile): null when the connection changed
 * since, so an answer never fills suggestions or a model from a server the form no longer points at, and
 * the model is filled in only if it is still empty, never over one typed while waiting.
 */
export async function runConnectionTest(
  draft: DraftConnection,
  fetchModels: (input: ConnectionInput) => Promise<string[]>,
  latest: () => DraftConnection,
): Promise<TestOutcome | null> {
  const identity = connectionIdentity(draft);
  let found: string[];
  try {
    found = await fetchModels(toConnectionInput(draft));
  } catch (err) {
    if (connectionIdentity(latest()) !== identity) return null;
    const message = err instanceof Error ? err.message : "The test failed.";
    return { models: [], autofill: null, result: { ok: false, message } };
  }
  const now = latest();
  if (connectionIdentity(now) !== identity) return null;
  const model = now.model.trim();
  const autofill = !model && found[0] ? found[0] : null;
  return { models: found, autofill, result: describeModels(found, model || (autofill ?? "")) };
}
