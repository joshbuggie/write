import { describe, expect, it } from "vitest";
import type { LauncherInput } from "@/lib/integrations";
import { createFolder, createIntegration, createNote, readNote } from "../storage";
import { withTempDataDir } from "../storage/test-utils";
import { sendStateFor } from "./targets";

/** Where a note can be sent, and which harnesses would need its folder first (docs/design-decisions.md#d31). */

const launcher: LauncherInput = {
  url: "https://127.0.0.1:9",
  key: "ts_secret_key_123456",
  ca: "",
  turnstoneMode: "workstream",
  mcpServerName: "write",
};

async function setUp() {
  await createFolder("Essays");
  await createFolder("Journal");
  await createNote({ folder: "Essays", name: "Tides", content: "x\n" });
  await createNote({ folder: "Journal", name: "Private", content: "x\n" });
}

describe("sendStateFor", () => {
  it("lists a harness that can't read the folder as blocked, not as a target", () =>
    withTempDataDir(async () => {
      await setUp();
      await createIntegration({ name: "Turnstone", kind: "turnstone", folders: ["Essays"], launcher });
      const essays = await sendStateFor(await readNote({ folder: "Essays", name: "Tides" }));
      expect(essays.targets.map((t) => t.name)).toEqual(["Turnstone"]);
      expect(essays.blocked).toEqual([]);
      const journal = await sendStateFor(await readNote({ folder: "Journal", name: "Private" }));
      expect(journal.targets).toEqual([]);
      expect(journal.blocked).toEqual(["Turnstone"]);
    }));

  it("leaves out integrations without a launcher, so people without one see no Send button", () =>
    withTempDataDir(async () => {
      await setUp();
      await createIntegration({ name: "MCP only", kind: "other", folders: ["Essays"], launcher: null });
      const state = await sendStateFor(await readNote({ folder: "Journal", name: "Private" }));
      expect(state).toEqual({ targets: [], blocked: [], working: [] });
    }));
});
