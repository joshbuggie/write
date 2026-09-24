import { describe, expect, it } from "vitest";
import { hashPassword, isPasswordHash, verifyPassword } from "./password-hash";

const CHEAP = { N: 1024, r: 8, p: 1 };

describe("password hashing", () => {
  it("verifies the same password and nothing else", async () => {
    const hash = await hashPassword("correct horse", CHEAP);
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(isPasswordHash(hash)).toBe(true);
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("correct horse ", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same", CHEAP)).not.toBe(await hashPassword("same", CHEAP));
  });

  it("treats composed and decomposed accents as the same password", async () => {
    const hash = await hashPassword("café-crème", CHEAP);
    expect(await verifyPassword("café-crème", hash)).toBe(true);
  });

  it("uses the default cost when none is given", async () => {
    expect(await hashPassword("x")).toMatch(/^scrypt\$32768\$8\$1\$/);
  });

  it("refuses hashes it can't use, including costs that would exhaust memory", async () => {
    const hash = await hashPassword("x", CHEAP);
    const withCost = (n: string) => hash.replace(/^scrypt\$\d+/, `scrypt$${n}`);
    await expect(verifyPassword("x", withCost("1000"))).rejects.toThrow(); // not a power of two
    await expect(verifyPassword("x", withCost(String(2 ** 24)))).rejects.toThrow();
    await expect(verifyPassword("x", "plain-text")).rejects.toThrow();
    expect(isPasswordHash("plain-text")).toBe(false);
  });
});
