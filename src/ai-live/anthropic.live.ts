import { describe, expect, it } from "vitest";
import { listModels, openReply } from "@/lib/server/ai";
import { replyOf } from "@/lib/server/ai/test-utils";
import { LIVE_PROVIDERS, targetOf } from "./providers";

/**
 * Anthropic's required max_tokens (docs/design-decisions.md#d29): write asks for 64,000 and, when a model
 * allows fewer, retries once with the limit the 400 names. Only the real API can say whether its wording
 * still matches, so this asks a model with a lower output limit, if the key can use one.
 */

const anthropic = LIVE_PROVIDERS.find((p) => p.provider === "anthropic")!;

/** Models with an output limit under 64,000 tokens, newest first; the first one the key lists is used. */
const LOW_LIMIT_MODELS = (
  process.env.AI_LIVE_ANTHROPIC_LOW_LIMIT_MODEL ??
  "claude-opus-4-1-20250805,claude-opus-4-20250514,claude-3-5-haiku-20241022,claude-3-haiku-20240307"
).split(",");

describe.skipIf(!anthropic.apiKey)("anthropic max_tokens", () => {
  it("retries with the limit a lower-limit model names", async ({ annotate, skip }) => {
    const listed = await listModels(targetOf(anthropic), new AbortController().signal);
    const model = LOW_LIMIT_MODELS.find((m) => listed.includes(m.trim()))?.trim();
    if (!model) {
      await annotate(`None of ${LOW_LIMIT_MODELS.join(", ")} is listed for this key.`);
      return skip();
    }
    await annotate(`using ${model}`);
    const reply = await openReply(
      targetOf(anthropic, model),
      { system: "", messages: [{ role: "user", content: "Reply with the single word: pong" }] },
      new AbortController().signal,
    );
    const { text, stop } = await replyOf(reply);
    expect(stop).toBe("end");
    expect(text.toLowerCase()).toContain("pong");
  });
});
