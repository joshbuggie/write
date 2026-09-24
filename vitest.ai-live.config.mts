import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// The opt-in live AI suite: real model servers, real API credits. `npm test` and CI never include
// *.live.ts; this config is the only way in (`npm run test:ai-live`). Keys come from .env.ai-live.
if (process.env.CI) {
  throw new Error("The live AI suite spends real API credits and never runs in CI.");
}
if (existsSync(".env.ai-live")) process.loadEnvFile(".env.ai-live");

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/ai-live/**/*.live.ts"],
    // Verbose prints every reply (annotated by the tests) under its test, for reading what models send.
    reporters: ["verbose"],
    restoreMocks: true,
    // Real models: a reply can take a while, and a flaky network shouldn't fail the whole run.
    testTimeout: 120_000,
    // One file at a time keeps the request rate low enough for new accounts' rate limits.
    fileParallelism: false,
  },
});
