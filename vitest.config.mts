import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true }, // Vite 8 built-in; no plugin needed
  test: { environment: "node", include: ["src/**/*.test.ts"], restoreMocks: true },
});
