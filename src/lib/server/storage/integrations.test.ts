import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTokenShaped } from "@/lib/integrations";
import { hashToken } from "../integration-tokens";
import {
  canReadFolder,
  createFolder,
  createIntegration,
  deleteFolder,
  deleteIntegration,
  findIntegrationByToken,
  readIntegrations,
  renameFolder,
  rotateIntegrationToken,
  updateIntegration,
} from "./index";
import { withTempDataDir, writeTestConfigFile } from "./test-utils";

afterEach(() => vi.restoreAllMocks());

const configPath = () => path.join(process.env.WRITE_CONFIG_DIR!, "integrations.json");

describe("integrations storage", () => {
  it("saves only the token's hash, owner-only, and finds the integration by its token", () =>
    withTempDataDir(async () => {
      await createFolder("Essays");
      const { integration, token } = await createIntegration({
        name: "  Turnstone ",
        kind: "turnstone",
        folders: ["Essays"],
      });
      expect(isTokenShaped(token)).toBe(true);
      expect(integration).toMatchObject({
        name: "Turnstone",
        folders: ["Essays"],
        tokenHint: token.slice(-4),
      });

      const text = await readFile(configPath(), "utf8");
      expect(text).not.toContain(token);
      expect(text).toContain(hashToken(token));
      expect((await stat(configPath())).mode & 0o777).toBe(0o600);

      expect((await findIntegrationByToken(token))?.id).toBe(integration.id);
      expect(await findIntegrationByToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).toBeNull();
    }));

  it("keeps folders as their on-disk names, without repeats, and refuses missing ones", () =>
    withTempDataDir(async () => {
      await createFolder("Essays");
      const { integration } = await createIntegration({
        name: "Hermes",
        kind: "hermes",
        folders: ["Essays", "Essays"],
      });
      expect(integration.folders).toEqual(["Essays"]);
      await expect(
        updateIntegration(integration.id, { name: "Hermes", kind: "hermes", folders: ["Journal"] }),
      ).rejects.toMatchObject({ code: "not_found", message: 'There is no folder named "Journal" any more.' });
      await expect(createIntegration({ name: " ", kind: "other", folders: [] })).rejects.toMatchObject({
        code: "invalid_name",
      });
    }));

  it("replaces and removes tokens: the old one stops working at once", () =>
    withTempDataDir(async () => {
      const first = await createIntegration({ name: "A", kind: "other", folders: [] });
      const rotated = await rotateIntegrationToken(first.integration.id);
      expect(await findIntegrationByToken(first.token)).toBeNull();
      expect((await findIntegrationByToken(rotated.token))?.id).toBe(first.integration.id);

      await deleteIntegration(first.integration.id);
      expect(await findIntegrationByToken(rotated.token)).toBeNull();
      await expect(deleteIntegration(first.integration.id)).rejects.toMatchObject({ code: "not_found" });
    }));

  it("follows a folder rename, and a deleted folder's name doesn't come back with a new folder", () =>
    withTempDataDir(async () => {
      await createFolder("Essays");
      await createFolder("Journal");
      const { integration } = await createIntegration({
        name: "A",
        kind: "other",
        folders: ["Essays", "Journal"],
      });

      await renameFolder("Essays", "Writing");
      let [saved] = await readIntegrations();
      expect(saved.folders).toEqual(["Writing", "Journal"]);
      expect(canReadFolder(saved, "Writing")).toBe(true);
      expect(canReadFolder(saved, "Essays")).toBe(false);

      await deleteFolder("Journal");
      await createFolder("Journal");
      [saved] = await readIntegrations();
      expect(saved.id).toBe(integration.id);
      expect(canReadFolder(saved, "Journal")).toBe(false);
    }));

  it("doesn't write the file for a folder change that touches no integration", () =>
    withTempDataDir(async () => {
      await createFolder("Essays");
      await createFolder("Other");
      await createIntegration({ name: "A", kind: "other", folders: ["Essays"] });
      const before = (await stat(configPath())).mtimeMs;
      await renameFolder("Other", "Elsewhere");
      expect((await stat(configPath())).mtimeMs).toBe(before);
    }));

  it("refuses a file that isn't valid instead of reading it as no integrations", () =>
    withTempDataDir(async () => {
      await writeTestConfigFile("integrations.json", '{"version":1,"integrations":[{"id":"x"}]}');
      await expect(readIntegrations()).rejects.toMatchObject({ code: "storage_unavailable" });
      await expect(findIntegrationByToken("wrt_" + "a".repeat(43))).rejects.toMatchObject({
        code: "storage_unavailable",
      });
    }));

  it("still renames a folder when the integrations file is broken, and says so in the log", () =>
    withTempDataDir(async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      await createFolder("Essays");
      await writeTestConfigFile("integrations.json", "not json");
      await expect(renameFolder("Essays", "Writing")).resolves.toMatchObject({ name: "Writing" });
      expect(logged).toHaveBeenCalled();
    }));
});
