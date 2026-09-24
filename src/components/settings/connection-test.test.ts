import { describe, expect, it } from "vitest";
import { connectionIdentity, runConnectionTest } from "./connection-test";
import type { DraftConnection } from "./settings-draft";

const connection: DraftConnection = {
  id: "c1",
  name: "Local",
  provider: "ollama",
  baseUrl: "http://localhost:11434/v1",
  keyHint: null,
  model: "",
};

/** A models request that answers only when told to, so the form can change while it is pending. */
function delayed() {
  let answer!: (models: string[]) => void;
  let fail!: (err: Error) => void;
  const pending = new Promise<string[]>((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  return { fetchModels: () => pending, answer, fail };
}

/** Starts a test of `connection`; `form.now` is the form as the user keeps editing it. */
function start(fetchModels: () => Promise<string[]>) {
  const form = { now: connection };
  return { form, outcome: runConnectionTest(connection, fetchModels, () => form.now) };
}

describe("runConnectionTest", () => {
  it("fills an empty model from the answer when nothing changed", async () => {
    const request = delayed();
    const { outcome } = start(request.fetchModels);
    request.answer(["llama3", "qwen3"]);
    expect(await outcome).toEqual({
      models: ["llama3", "qwen3"],
      autofill: "llama3",
      result: { ok: true, message: "Connected · 2 models available" },
    });
  });

  it("keeps a model typed while the test was pending", async () => {
    const request = delayed();
    const { form, outcome } = start(request.fetchModels);
    form.now = { ...connection, model: "mistral" };
    request.answer(["llama3", "qwen3"]);
    const done = await outcome;
    expect(done?.autofill).toBeNull();
    expect(done?.result).toEqual({
      ok: false,
      message: "Connected · 2 models available, but not “mistral”.",
    });
  });

  it("drops an answer once the provider, server URL or key changed", async () => {
    const changes: Partial<DraftConnection>[] = [
      { provider: "openai", baseUrl: "https://api.openai.com/v1" },
      { baseUrl: "http://192.168.1.20:11434/v1" },
      { apiKey: "sk-new" },
      { clearKey: true },
    ];
    for (const change of changes) {
      const request = delayed();
      const { form, outcome } = start(request.fetchModels);
      form.now = { ...connection, ...change };
      request.answer(["llama3"]);
      expect(await outcome).toBeNull();
    }
  });

  it("drops a failure too once the connection changed, and reports it when it didn't", async () => {
    const stale = delayed();
    const changed = start(stale.fetchModels);
    changed.form.now = { ...connection, baseUrl: "http://other:11434/v1" };
    stale.fail(new Error("Couldn't reach the server."));
    expect(await changed.outcome).toBeNull();

    const current = delayed();
    const same = start(current.fetchModels);
    current.fail(new Error("Couldn't reach the server."));
    expect((await same.outcome)?.result).toEqual({ ok: false, message: "Couldn't reach the server." });
  });
});

describe("connectionIdentity", () => {
  it("ignores the name and model, and a URL typed without its scheme", () => {
    const same = { ...connection, name: "Other", model: "llama3", baseUrl: "localhost:11434/v1" };
    expect(connectionIdentity(same)).toBe(connectionIdentity(connection));
  });
});
