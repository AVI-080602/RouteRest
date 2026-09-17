import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // In-app links and page changes go through utils/appNavigation.tsx, which
  // keeps the /iteration2 part of the address. The plain Next.js versions
  // would drop it on the first click.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["utils/appNavigation.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message:
                'Import { Link } from "@/utils/appNavigation" so links keep the /iteration2 address.',
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "redirect", "permanentRedirect"],
              message:
                'Import { useRouter } from "@/utils/appNavigation" so page changes keep the /iteration2 address.',
            },
          ],
        },
      ],
    },
  },
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
    "public/iteration1-root/**",
    "app/iteration1/**/pages.generated.ts",
    "app/iteration1-root/**/pages.generated.ts",
  ]),
]);

export default eslintConfig;
