import { readdir, symlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS } from "@/lib/ai/settings";
import { getConfigDir } from "./config";
import { StorageError } from "./errors";
import { readAiSettings, saveAiSettings } from "./settings";
import { withTempDataDir } from "./test-utils";

/** The config folder must stay out of the notes folder (docs/design-decisions.md#d28), symlinks included. */

const INSIDE = /must not be inside the notes folder/;

const expectUnavailable = async (p: Promise<unknown>, message: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(StorageError);
  expect(err).toMatchObject({ code: "storage_unavailable", message: expect.stringMatching(message) });
};

const noSettings = { ...DEFAULT_AI_SETTINGS, connections: [] };

describe("getConfigDir", () => {
  it("refuses the data folder, a folder inside it, and a folder inside .next", () =>
    withTempDataDir(async (dataDir) => {
      const scratch = process.env.WRITE_CONFIG_DIR as string;
      for (const dir of [dataDir, path.join(dataDir, "config"), path.join(dataDir, "notebook", "deep")]) {
        process.env.WRITE_CONFIG_DIR = dir;
        await expectUnavailable(getConfigDir(), INSIDE);
        await expectUnavailable(readAiSettings(), /WRITE_CONFIG_DIR/);
        await expectUnavailable(saveAiSettings(noSettings), /WRITE_CONFIG_DIR/);
      }
      expect(await readdir(dataDir)).toEqual([]);

      process.env.WRITE_CONFIG_DIR = path.join(scratch, ".next", "config");
      await expectUnavailable(getConfigDir(), /inside a \.next build directory/);
    }));

  it("accepts a sibling of the data folder that shares its name as a prefix", () =>
    withTempDataDir(async (dataDir) => {
      process.env.WRITE_CONFIG_DIR = `${dataDir}-config`;
      expect(await getConfigDir()).toBe(`${dataDir}-config`);
      expect(await readAiSettings()).toMatchObject({ connections: [] }); // a missing folder, never created
    }));

  it("follows symlinks: a linked data folder, or a config path through a link into the notes", () =>
    withTempDataDir(async (dataDir) => {
      const scratch = process.env.WRITE_CONFIG_DIR as string;
      // WRITE_DATA_DIR is a link into a synced folder; the config folder names the real, synced path.
      const linkedData = path.join(scratch, "data");
      await symlink(dataDir, linkedData);
      process.env.WRITE_DATA_DIR = linkedData;
      process.env.WRITE_CONFIG_DIR = path.join(dataDir, ".write-config");
      await expectUnavailable(getConfigDir(), INSIDE);
      await expectUnavailable(saveAiSettings(noSettings), INSIDE);

      // The config folder, not there yet, sits below a link that points into the notes.
      process.env.WRITE_DATA_DIR = dataDir;
      const intoNotes = path.join(scratch, "notes-link");
      await symlink(dataDir, intoNotes);
      process.env.WRITE_CONFIG_DIR = path.join(intoNotes, "nested", "config");
      await expectUnavailable(getConfigDir(), INSIDE);
      await expectUnavailable(saveAiSettings(noSettings), INSIDE);
      expect(await readdir(dataDir)).toEqual([]);

      // A linked data folder with a config folder beside the real one is fine.
      process.env.WRITE_DATA_DIR = linkedData;
      process.env.WRITE_CONFIG_DIR = `${dataDir}-config`;
      expect(await getConfigDir()).toBe(`${dataDir}-config`);
    }));
});
