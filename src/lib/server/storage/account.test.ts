import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashPassword } from "../password-hash";
import { changePassword, createAccount, readAccount } from "./account";
import { withTempDataDir } from "./test-utils";

const file = () => path.join(process.env.WRITE_CONFIG_DIR!, "account.json");
const hash = () => hashPassword("pw", { N: 1024, r: 8, p: 1 });

describe("account storage", () => {
  it("reads null before setup and creates nothing", () =>
    withTempDataDir(async () => {
      process.env.WRITE_CONFIG_DIR = path.join(process.env.WRITE_CONFIG_DIR!, "not-yet");
      expect(await readAccount()).toBeNull();
      await expect(stat(process.env.WRITE_CONFIG_DIR)).rejects.toMatchObject({ code: "ENOENT" });
    }));

  it("creates the account once, owner-only, and never replaces it", () =>
    withTempDataDir(async () => {
      process.env.WRITE_CONFIG_DIR = path.join(process.env.WRITE_CONFIG_DIR!, "new");
      const account = await createAccount("sam", await hash());
      expect(account?.sessionSecret.length).toBeGreaterThanOrEqual(43);
      expect(await readAccount()).toEqual(account);
      expect((await stat(file())).mode & 0o777).toBe(0o600);
      expect((await stat(process.env.WRITE_CONFIG_DIR)).mode & 0o777).toBe(0o700);

      const before = await readFile(file(), "utf8");
      expect(await createAccount("mallory", await hash())).toBeNull();
      expect(await readFile(file(), "utf8")).toBe(before);
    }));

  it("lets only one of two simultaneous setups win", () =>
    withTempDataDir(async () => {
      const results = await Promise.all([createAccount("a", await hash()), createAccount("b", await hash())]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await readAccount())?.username).toBe(results.find(Boolean)?.username);
    }));

  it("refuses a broken file instead of treating it as no account", () =>
    withTempDataDir(async () => {
      const valid = {
        version: 1,
        username: "sam",
        passwordHash: await hash(),
        sessionSecret: "s".repeat(43),
      };
      for (const broken of [
        "not json",
        "[]",
        JSON.stringify({ ...valid, version: 2 }),
        JSON.stringify({ ...valid, username: "" }),
        JSON.stringify({ ...valid, passwordHash: "hunter2" }),
        JSON.stringify({ ...valid, sessionSecret: "short" }),
      ]) {
        await writeFile(file(), broken);
        await expect(readAccount()).rejects.toMatchObject({
          code: "storage_unavailable",
          message: expect.stringContaining("account.json"),
        });
      }
      await writeFile(file(), JSON.stringify(valid));
      expect(await readAccount()).toEqual({
        username: "sam",
        passwordHash: valid.passwordHash,
        sessionSecret: valid.sessionSecret,
      });
    }));

  it("changes the password and the session secret, and nothing else", () =>
    withTempDataDir(async () => {
      const before = (await createAccount("sam", await hash()))!;
      const newHash = await hash();
      const after = await changePassword(before.passwordHash, newHash);
      expect(after).toEqual({ username: "sam", passwordHash: newHash, sessionSecret: expect.any(String) });
      expect(after?.sessionSecret).not.toBe(before.sessionSecret);
      expect(await readAccount()).toEqual(after);
      expect((await stat(file())).mode & 0o777).toBe(0o600);
    }));

  it("writes nothing when the password changed since it was checked, or the account is gone", () =>
    withTempDataDir(async () => {
      expect(await changePassword("scrypt$stale", await hash())).toBeNull();
      expect(await readAccount()).toBeNull();
      const account = (await createAccount("sam", await hash()))!;
      expect(await changePassword("scrypt$stale", await hash())).toBeNull();
      expect(await readAccount()).toEqual(account);
    }));
});
