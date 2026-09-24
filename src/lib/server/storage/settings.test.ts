import { chmod, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS } from "@/lib/ai/settings";
import type { ConnectionInput, SaveSettingsRequest } from "@/lib/api-contract";
import { StorageError } from "./errors";
import { apiKeyFor, readAiSettings, saveAiSettings, toAiSettingsView } from "./settings";
import { withTempDataDir } from "./test-utils";

const configDir = () => process.env.WRITE_CONFIG_DIR as string;
const settingsPath = () => path.join(configDir(), "settings.json");
const KEY = "sk-test-0123456789abcd";

const conn = (over: Partial<ConnectionInput> = {}): ConnectionInput => ({
  id: "c1",
  name: "OpenAI",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  ...over,
});

const input = (connections: ConnectionInput[], over: Partial<SaveSettingsRequest["ai"]> = {}) => ({
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  connections,
  defaultConnectionId: connections[0]?.id ?? null,
  ...over,
});

const savedKey = async (id = "c1") => (await readAiSettings()).connections.find((c) => c.id === id)?.apiKey;

const expectUnavailable = async (p: Promise<unknown>, message: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(StorageError);
  expect(err).toMatchObject({ code: "storage_unavailable", message: expect.stringMatching(message) });
};

describe("readAiSettings", () => {
  it("reads the defaults without a file, and creates nothing", () =>
    withTempDataDir(async () => {
      expect(await readAiSettings()).toEqual({ ...DEFAULT_AI_SETTINGS, connections: [] });
      expect(await readdir(configDir())).toEqual([]);

      const missing = path.join(configDir(), "not", "there");
      process.env.WRITE_CONFIG_DIR = missing;
      expect((await readAiSettings()).enabled).toBe(false);
      expect(await readdir(path.dirname(path.dirname(missing)))).toEqual([]);
    }));

  it("returns copies, so callers can't change the defaults", () =>
    withTempDataDir(async () => {
      (await readAiSettings()).quickActions[0].label = "changed";
      expect(DEFAULT_AI_SETTINGS.quickActions[0].label).toBe("Improve writing");
    }));

  it("throws storage_unavailable for a corrupt file, and a save leaves it untouched", () =>
    withTempDataDir(async () => {
      for (const text of ['{"version": 1, "ai": {', "[]", "null", '"text"']) {
        await writeFile(settingsPath(), text);
        await expectUnavailable(
          readAiSettings(),
          /settings\.json (isn't valid JSON|doesn't hold a settings)/,
        );
        await expectUnavailable(saveAiSettings(input([conn({ apiKey: KEY })])), /Fix it or delete it/);
        expect(await readFile(settingsPath(), "utf8")).toBe(text);
      }
    }));

  it("reads a blank file, or one with a BOM", () =>
    withTempDataDir(async () => {
      await writeFile(settingsPath(), "  \n");
      expect((await readAiSettings()).connections).toEqual([]);
      await writeFile(settingsPath(), '\uFEFF{"ai": {"enabled": true}}');
      expect((await readAiSettings()).enabled).toBe(true);
    }));

  it("parses a hand-edited file defensively", () =>
    withTempDataDir(async () => {
      const ai = {
        enabled: "yes",
        connections: [
          {
            id: "a",
            name: 3,
            provider: "mistral",
            baseUrl: " http://10.0.0.2:11434/v1 ",
            model: "m",
            apiKey: "k1",
          },
          { id: "a", name: "duplicate id", provider: "openai" },
          { name: "no id" },
          "junk",
          { id: "b", provider: "openai", baseUrl: "file:///etc/passwd", apiKey: "  " },
          { id: "c", provider: "openai", baseUrl: "https://user:pw@example.com/v1" },
        ],
        defaultConnectionId: "gone",
        shortcut: 5,
        defaultScope: "everything",
        quickActions: [{ id: "q", label: "Q", prompt: "P", apply: "sideways" }, { id: "no label" }],
      };
      await writeFile(settingsPath(), JSON.stringify({ version: 1, ai, extra: true }));
      expect(await readAiSettings()).toEqual({
        enabled: false,
        connections: [
          {
            id: "a",
            name: "",
            provider: "custom",
            baseUrl: "http://10.0.0.2:11434/v1",
            model: "m",
            apiKey: "k1",
          },
          { id: "b", name: "", provider: "openai", baseUrl: "", model: "", apiKey: null },
          { id: "c", name: "", provider: "openai", baseUrl: "", model: "", apiKey: null },
        ],
        defaultConnectionId: "a",
        shortcut: DEFAULT_AI_SETTINGS.shortcut,
        defaultScope: DEFAULT_AI_SETTINGS.defaultScope,
        instructions: DEFAULT_AI_SETTINGS.instructions,
        quickActions: [{ id: "q", label: "Q", prompt: "P", apply: "replace" }],
      });

      await writeFile(settingsPath(), JSON.stringify({ ai: { connections: "none", quickActions: {} } }));
      const empty = await readAiSettings();
      expect(empty.defaultConnectionId).toBeNull();
      expect(empty.quickActions).toEqual(DEFAULT_AI_SETTINGS.quickActions);
      await writeFile(settingsPath(), JSON.stringify({ ai: { quickActions: [], instructions: "" } }));
      expect(await readAiSettings()).toMatchObject({ quickActions: [], instructions: "" });
    }));
});

describe("saveAiSettings", () => {
  it("round-trips, trimming fields, as 2-space JSON with a final newline", () =>
    withTempDataDir(async () => {
      const view = await saveAiSettings(
        input(
          [
            conn({
              name: " Work ",
              baseUrl: " https://api.openai.com/v1 ",
              model: " gpt ",
              apiKey: ` ${KEY} `,
            }),
          ],
          {
            quickActions: [{ id: "q", label: "Q", prompt: "P", apply: "insert" }],
          },
        ),
      );
      const stored = await readAiSettings();
      expect(stored.connections).toEqual([
        {
          id: "c1",
          name: "Work",
          provider: "openai",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt",
          apiKey: KEY,
        },
      ]);
      expect(stored.quickActions).toEqual([{ id: "q", label: "Q", prompt: "P", apply: "insert" }]);
      expect(view).toEqual(toAiSettingsView(stored));

      const text = await readFile(settingsPath(), "utf8");
      expect(text).toBe(`${JSON.stringify({ version: 1, ai: stored }, null, 2)}\n`);
      expect(text.startsWith('{\n  "version": 1,\n  "ai": {\n    "enabled": true,')).toBe(true);
    }));

  it("creates the folder 0700 and writes the file 0600, even over a looser file", () =>
    withTempDataDir(async () => {
      process.env.WRITE_CONFIG_DIR = path.join(configDir(), "nested", "config");
      await saveAiSettings(input([conn({ apiKey: KEY })]));
      expect((await stat(configDir())).mode & 0o777).toBe(0o700);
      expect((await stat(settingsPath())).mode & 0o777).toBe(0o600);

      await chmod(settingsPath(), 0o644);
      await saveAiSettings(input([conn({ apiKey: "sk-other-key" })]));
      expect((await stat(settingsPath())).mode & 0o777).toBe(0o600);
      expect(await readdir(configDir())).toEqual(["settings.json"]);
    }));

  it("never rewrites identical bytes", () =>
    withTempDataDir(async () => {
      await saveAiSettings(input([conn({ apiKey: KEY })]));
      const before = await stat(settingsPath());
      await saveAiSettings(input([conn()]));
      expect((await stat(settingsPath())).ino).toBe(before.ino);
    }));

  it("keeps the key out of the view", () =>
    withTempDataDir(async () => {
      const view = await saveAiSettings(input([conn({ apiKey: KEY }), conn({ id: "c2" })]));
      expect(view.connections.map((c) => c.keyHint)).toEqual(["abcd", null]);
      expect(JSON.stringify(view)).not.toContain("0123456789");
      expect(JSON.stringify(toAiSettingsView(await readAiSettings()))).not.toContain("0123456789");
    }));

  it("hints at a short key without showing any of it", () =>
    withTempDataDir(async () => {
      const keys = ["1234", "local", "sk-abcdefgh", "sk-abcdefghi"];
      const view = await saveAiSettings(input(keys.map((apiKey, i) => conn({ id: `c${i}`, apiKey }))));
      expect(view.connections.map((c) => c.keyHint)).toEqual(["••••", "••••", "••••", "fghi"]);
      expect(JSON.stringify(view)).not.toMatch(/1234|local|efgh"/);
    }));

  it("keeps, replaces and clears keys", () =>
    withTempDataDir(async () => {
      await saveAiSettings(input([conn({ apiKey: KEY })]));
      await saveAiSettings(input([conn({ name: "Renamed", apiKey: "  " })]));
      expect(await savedKey()).toBe(KEY);
      await saveAiSettings(input([conn({ baseUrl: "https://API.openai.com:443/v2", model: "other" })]));
      expect(await savedKey()).toBe(KEY);
      await saveAiSettings(input([conn({ apiKey: "sk-new" })]));
      expect(await savedKey()).toBe("sk-new");
      await saveAiSettings(input([conn({ clearKey: true })]));
      expect(await savedKey()).toBeNull();
    }));

  it("drops a saved key when the origin or the id changes", () =>
    withTempDataDir(async () => {
      for (const baseUrl of [
        "https://evil.example/v1",
        "http://api.openai.com/v1",
        "https://api.openai.com:8443/v1",
        "",
      ]) {
        await saveAiSettings(input([conn({ apiKey: KEY })]));
        await saveAiSettings(input([conn({ baseUrl })]));
        expect(await savedKey()).toBeNull();
      }
      await saveAiSettings(input([conn({ apiKey: KEY })]));
      await saveAiSettings(input([conn({ id: "c2" })]));
      expect(await savedKey("c2")).toBeNull();
    }));

  it("points the default at the first connection when it has none", () =>
    withTempDataDir(async () => {
      const view = await saveAiSettings(input([conn(), conn({ id: "c2" })], { defaultConnectionId: null }));
      expect(view.defaultConnectionId).toBe("c1");
      expect((await saveAiSettings(input([]))).defaultConnectionId).toBeNull();
    }));
});

describe("apiKeyFor", () => {
  it("uses the typed key, no key when cleared, else the saved key on the same origin only", () =>
    withTempDataDir(async () => {
      expect(await apiKeyFor(conn())).toBeNull();
      await saveAiSettings(input([conn({ apiKey: KEY })]));
      expect(await apiKeyFor(conn())).toBe(KEY);
      expect(await apiKeyFor(conn({ baseUrl: "https://api.openai.com/other" }))).toBe(KEY);
      expect(await apiKeyFor(conn({ apiKey: " typed " }))).toBe("typed");
      expect(await apiKeyFor(conn({ clearKey: true }))).toBeNull();
      expect(await apiKeyFor(conn({ baseUrl: "http://192.168.1.5:11434/v1" }))).toBeNull();
      expect(await apiKeyFor(conn({ id: "unsaved" }))).toBeNull();
    }));

  it("doesn't need the settings file for a typed key", () =>
    withTempDataDir(async () => {
      await writeFile(settingsPath(), "{");
      expect(await apiKeyFor(conn({ apiKey: "typed" }))).toBe("typed");
      await expectUnavailable(apiKeyFor(conn()), /isn't valid JSON/);
    }));
});
