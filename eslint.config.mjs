import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Architecture boundaries (see CONTRIBUTING.md, "Rules"). They are lint errors so they hold in review.
const fsPaths = ["fs", "node:fs", "fs/promises", "node:fs/promises"].map((name) => ({
  name,
  message: "Only src/lib/server/storage may touch the filesystem.",
}));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local notes and test coverage output:
    "data/**",
    "coverage/**",
  ]),
  // 1) Everywhere except storage: no fs.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/server/storage/**"],
    rules: { "no-restricted-imports": ["error", { paths: fsPaths }] },
  },
  // 2) Client-reachable code: no fs AND no server modules. Same rule key, so fsPaths must be repeated.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    ignores: ["src/lib/server/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: fsPaths,
          patterns: [
            {
              group: ["@/lib/server", "@/lib/server/*", "@/lib/server/**"],
              message: "Server-only. Use @/lib/api-client in client code.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
