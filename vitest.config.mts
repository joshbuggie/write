import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true }, // Vite 8 built-in; no plugin needed
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
    // The seeded fuzz tests take a few seconds locally; shared CI runners are several times slower.
    testTimeout: process.env.CI ? 30_000 : 5_000,
  },
});
