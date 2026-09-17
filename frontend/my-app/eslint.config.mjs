import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    // Generated copies of MapLibre's worker, see scripts/copy-maplibre-worker.mjs.
    "public/maplibre/**",
    // Archived Iteration 1 build output and the copies made from it, see
    // scripts/prepare-iteration1.mjs.
    "archive/**",
    "public/iteration1/**",
    "app/iteration1/**/pages.generated.ts",
  ]),
]);

export default eslintConfig;
