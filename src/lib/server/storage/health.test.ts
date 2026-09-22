import * as fs from "node:fs/promises";
import { chmod, readdir, stat } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth, WRITE_PROBE_TTL_MS } from "./health";
import { withTempDataDir } from "./test-utils";

// Count the write probes without changing what they do.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});
const probes = () => vi.mocked(fs.writeFile).mock.calls.length;

const isRoot = process.getuid?.() === 0;

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(fs.writeFile).mockClear();
});

describe("checkHealth write probe", () => {
  it("writes once for a burst of concurrent checks, then not again within the TTL", () =>
    withTempDataDir(async (dir) => {
      const results = await Promise.all(Array.from({ length: 100 }, () => checkHealth()));
      expect(results.every((r) => r.ok)).toBe(true);
      expect(probes()).toBe(1);

      const mtime = (await stat(dir)).mtimeMs;
      expect(await checkHealth()).toEqual({ ok: true });
      expect(probes()).toBe(1);
      expect((await stat(dir)).mtimeMs).toBe(mtime);
      expect(await readdir(dir)).toEqual([]);
    }));

  it("probes again once the TTL has passed", () =>
    withTempDataDir(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      await checkHealth();
      vi.setSystemTime(Date.now() + WRITE_PROBE_TTL_MS + 1);
      await checkHealth();
      expect(probes()).toBe(2);
    }));

  it.skipIf(isRoot)("reports a data dir that became unwritable right away, despite the cache", () =>
    withTempDataDir(async (dir) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await checkHealth()).toEqual({ ok: true });
      await chmod(dir, 0o500);
      try {
        expect(await checkHealth()).toEqual({ ok: false, error: "storage unavailable" });
      } finally {
        await chmod(dir, 0o700);
      }
      // Failures aren't cached: the next check probes again and recovers.
      expect(await checkHealth()).toEqual({ ok: true });
      expect(probes()).toBe(2);
    }),
  );
});
