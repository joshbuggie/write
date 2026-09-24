import { describe, expect, it, vi } from "vitest";
import { hashPassword } from "../password-hash";
import { createAccount, readAccount } from "./account";
import { withTempDataDir } from "./test-utils";

// A filesystem without hard links (some network shares and Docker volume drivers): the no-clobber write
// falls back to checking for the file, then renaming onto it.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const refuse = async () => {
    throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
  };
  return { ...actual, default: { ...actual, link: refuse }, link: refuse };
});

describe("account storage without hard links", () => {
  it("still lets only one of two simultaneous setups win", () =>
    withTempDataDir(async () => {
      const hash = await hashPassword("pw", { N: 1024, r: 8, p: 1 });
      const results = await Promise.all([createAccount("a", hash), createAccount("b", hash)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await readAccount())?.username).toBe(results.find(Boolean)?.username);
    }));
});
