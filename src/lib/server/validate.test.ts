import { describe, expect, it } from "vitest";
import type { ConnectionInput } from "@/lib/api-contract";
import { isTestConnectionRequest } from "./validate";

/** The connection guard's API key rule (see docs/design-decisions.md#d29); other fields are covered by the route tests. */

const connection = (apiKey?: string): ConnectionInput => ({
  id: "c1",
  name: "OpenAI",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  ...(apiKey === undefined ? {} : { apiKey }),
});

const accepts = (apiKey?: string) => isTestConnectionRequest({ connection: connection(apiKey) });

describe("API keys", () => {
  it("accepts visible ASCII, surrounding whitespace (trimmed on save), an empty key or none", () => {
    for (const key of [
      undefined,
      "",
      "   ",
      "sk-proj-AbC_123.xyz~!",
      "  sk-test-1234 \n",
      "\ufeffsk-bom",
      "1234",
    ]) {
      expect(accepts(key)).toBe(true);
    }
  });

  it("refuses characters HTTP headers can't carry, or that no key has", () => {
    for (const key of ["sk-abc\u200b", "sk-ab\u2014c", "sk-\u00e9t\u00e9", "sk-a b", "sk-a\tb"]) {
      expect(accepts(key)).toBe(false);
    }
  });
});
