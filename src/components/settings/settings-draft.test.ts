import { describe, expect, it } from "vitest";
import type { AiConnection } from "@/lib/ai/settings";
import {
  cleanKey,
  keepsSavedKey,
  toConnectionInput,
  toSaveRequest,
  withScheme,
  type DraftConnection,
} from "./settings-draft";

const saved: AiConnection = {
  id: "claude",
  name: "Claude",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  keyHint: "a3F9",
  model: "claude-opus-5",
};

describe("keepsSavedKey", () => {
  it("keeps the saved key while nothing about it changes", () => {
    expect(keepsSavedKey({ ...saved, name: "Renamed" }, saved)).toBe(true);
    expect(keepsSavedKey({ ...saved, baseUrl: "https://api.anthropic.com/" }, saved)).toBe(true);
  });

  it("doesn't when the key is replaced, removed, never saved, or the address moves to another origin", () => {
    expect(keepsSavedKey({ ...saved, apiKey: "new" }, saved)).toBe(false);
    expect(keepsSavedKey({ ...saved, clearKey: true }, saved)).toBe(false);
    expect(keepsSavedKey(saved, undefined)).toBe(false);
    expect(keepsSavedKey({ ...saved, baseUrl: "https://evil.example" }, saved)).toBe(false);
    expect(keepsSavedKey({ ...saved, baseUrl: "not a url" }, saved)).toBe(false);
  });
});

describe("toConnectionInput", () => {
  it("never carries the key hint, and sends a new key or a removal only when asked", () => {
    const draft: DraftConnection = { ...saved };
    expect(toConnectionInput(draft)).toEqual({
      id: "claude",
      name: "Claude",
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-opus-5",
    });
    expect(toConnectionInput({ ...draft, apiKey: "  sk-new  " }).apiKey).toBe("sk-new");
    expect(toConnectionInput({ ...draft, apiKey: "   ", clearKey: true })).toMatchObject({ clearKey: true });
    expect(toConnectionInput({ ...draft, apiKey: "" })).not.toHaveProperty("apiKey");
  });

  it("builds the whole save request", () => {
    const request = toSaveRequest({
      enabled: true,
      connections: [{ ...saved, apiKey: "sk-x" }],
      defaultConnectionId: "claude",
      shortcut: "Mod+J",
      defaultScope: "selection",
      instructions: "Be brief.",
      quickActions: [],
    });
    expect(request.connections[0]).toMatchObject({ id: "claude", apiKey: "sk-x" });
    expect(request.connections[0]).not.toHaveProperty("keyHint");
  });
});

describe("withScheme and cleanKey", () => {
  it("adds http:// to an address typed without a scheme, and leaves real URLs alone", () => {
    expect(withScheme("192.168.1.20:11434/v1")).toBe("http://192.168.1.20:11434/v1");
    expect(withScheme(" localhost:1234/v1 ")).toBe("http://localhost:1234/v1");
    expect(withScheme("https://api.anthropic.com")).toBe("https://api.anthropic.com");
    expect(withScheme("")).toBe("");
  });

  it("removes spaces, line breaks and invisible characters a paste brings along", () => {
    expect(cleanKey(" sk-abc\u200B\n")).toBe("sk-abc");
    expect(toConnectionInput({ ...saved, apiKey: "sk-new\uFEFF" }).apiKey).toBe("sk-new");
  });
});
