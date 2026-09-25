import { describe, expect, it } from "vitest";
import type { IntegrationView } from "@/lib/integrations";
import {
  folderChoices,
  foldersLabel,
  lastUsedLabel,
  mcpUrl,
  setupSteps,
  summarizeIntegration,
  toggleFolder,
} from "./integration-summary";

const view = (patch: Partial<IntegrationView> = {}): IntegrationView => ({
  id: "a",
  name: "Turnstone",
  kind: "turnstone",
  folders: ["Essays"],
  tokenHint: "ab12",
  createdAt: "2026-09-24T10:00:00.000Z",
  lastUsedAt: null,
  launcher: null,
  ...patch,
});

describe("integration summary", () => {
  it("names the kind, the folders and the token's hint", () => {
    expect(summarizeIntegration(view())).toBe("Turnstone · Essays · token ••ab12");
    expect(foldersLabel([])).toBe("no folders yet");
    expect(foldersLabel(["A", "B", "C", "D", "E"])).toBe("A, B and 3 more");
  });

  it("says when a token hasn't been used since the server started", () => {
    expect(lastUsedLabel(null)).toBe("Not used since write started");
    expect(lastUsedLabel("2026-09-24T10:00:00.000Z")).toMatch(/^Last used /);
  });

  it("keeps a chosen folder that left the library, marked missing, so it can be unticked", () => {
    expect(folderChoices(["Journal", "Essays"], ["Old", "essays"])).toEqual([
      { name: "Essays", missing: false },
      { name: "Journal", missing: false },
      { name: "Old", missing: true },
    ]);
  });

  it("toggles folders without repeats, ignoring case", () => {
    expect(toggleFolder(["Essays"], "Journal", true)).toEqual(["Essays", "Journal"]);
    expect(toggleFolder(["Essays", "Journal"], "essays", false)).toEqual(["Journal"]);
    expect(toggleFolder(["Essays"], "essays", true)).toEqual(["essays"]);
  });

  it("gives each harness its own setup, with the token kept out of the snippet", () => {
    const url = mcpUrl("http://192.168.0.82:3223");
    expect(url).toBe("http://192.168.0.82:3223/api/agent/mcp");
    expect(setupSteps("hermes", url).snippet).toContain('Authorization: "Bearer ${WRITE_TOKEN}"');
    expect(setupSteps("turnstone", url).snippet).toContain("transport: streamable-http");
    expect(setupSteps("other", url).snippet).toContain("Bearer <token>");
  });
});
