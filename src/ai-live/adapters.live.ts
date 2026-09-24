import { expect, it } from "vitest";
import { listModels, openReply, type ReplyEvent } from "@/lib/server/ai";
import { failure, replyOf } from "@/lib/server/ai/test-utils";
import { describeEach, leaks, type LiveProvider, targetOf } from "./providers";

/**
 * The model adapters against the real APIs (docs/design-decisions.md#d29): what the offline tests fake
 * with recorded answers. Prompts are tiny and replies short, so each provider costs a fraction of a cent.
 */

const never = () => new AbortController().signal;
const ask = (content: string, system = "Follow the instruction exactly. No other text.") => ({
  system,
  messages: [{ role: "user" as const, content }],
});

describeEach("adapters", (p: LiveProvider) => {
  it("lists models, and the configured model is among them", async () => {
    const models = await listModels(targetOf(p), never());
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain(p.model);
  });

  it("streams a reply in pieces and ends it with stop 'end'", async ({ annotate }) => {
    const reply = await openReply(
      targetOf(p),
      ask("Write the numbers 1 to 30 separated by spaces."),
      never(),
    );
    const events: ReplyEvent[] = [];
    for await (const event of reply) events.push(event);
    const text = events.map((e) => ("text" in e ? e.text : "")).join("");
    await annotate(`${events.length - 1} text events: ${JSON.stringify(text)}`);
    expect(events.at(-1)).toEqual({ stop: "end" });
    expect(events.filter((e) => "stop" in e)).toHaveLength(1);
    expect(events.length).toBeGreaterThan(2); // streamed, not one piece
    expect(text).toMatch(/1 2 3\b[\s\S]*\b30\b/);
  });

  it("sends the system prompt and follow-ups as alternating turns", async () => {
    const reply = await openReply(
      targetOf(p),
      {
        system: "You answer with a single word in lowercase, nothing else.",
        messages: [
          { role: "user", content: "Name the color of a clear daytime sky." },
          { role: "assistant", content: "blue" },
          { role: "user", content: "Now the color of fresh grass." },
        ],
      },
      never(),
    );
    const { text, stop } = await replyOf(reply);
    expect(stop).toBe("end");
    expect(text.trim().toLowerCase()).toMatch(/^green\.?$/);
  });

  it("keeps multi-byte characters whole across chunks", async () => {
    const reply = await openReply(
      targetOf(p),
      ask("Repeat exactly, ten times on one line: 日本語🙂naïve"),
      never(),
    );
    const { text } = await replyOf(reply);
    expect(text).not.toContain("\uFFFD");
    expect(text.match(/日本語🙂naïve/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it("stops the upstream request when the signal aborts mid-reply", async () => {
    const abort = new AbortController();
    const reply = await openReply(
      targetOf(p),
      ask("Write the numbers 1 to 2000, one per line."),
      abort.signal,
    );
    const first = await reply.next();
    expect(first.done).toBe(false);
    const started = Date.now();
    abort.abort();
    // Pieces already read from the network may still come out; the reply must not reach its end.
    const rest = (async () => {
      for (let next = await reply.next(); !next.done; next = await reply.next()) {
        expect(next.value).not.toHaveProperty("stop");
      }
    })();
    await expect(rest).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("names the host, never the key, when the key is refused", async () => {
    const wrongKey = `${p.apiKey}x`;
    const target = { ...targetOf(p), apiKey: wrongKey };
    const err = await failure(openReply(target, ask("Say hi."), never()));
    expect(err.code).toBe("ai_upstream");
    expect(err.message).toContain(new URL(p.baseUrl).host);
    expect(err.message).not.toContain(wrongKey);
    expect(leaks(p, err.message)).toBe(false);
    const list = await failure(listModels(target, never()));
    expect(list.code).toBe("ai_upstream");
  });

  it("says which model is unknown", async ({ annotate }) => {
    const err = await failure(openReply(targetOf(p, "no-such-model-write-live"), ask("Say hi."), never()));
    await annotate(err.message);
    expect(err.code).toBe("ai_upstream");
    expect(err.message).toContain("no-such-model-write-live");
  });

  it("answers a wrong server URL with a readable error", async ({ annotate }) => {
    const target = { ...targetOf(p), baseUrl: new URL("/nothing-here/v1", p.baseUrl).href };
    const err = await failure(listModels(target, never()));
    await annotate(err.message);
    expect(err.code).toMatch(/^ai_(upstream|unreachable)$/);
    expect(leaks(p, err.message)).toBe(false);
  });
});
